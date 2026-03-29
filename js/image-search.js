function stripHtml(value) {
    return String(value || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeToken(value) {
    return String(value || "")
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function removeLeadingArticle(value) {
    return String(value || "")
        .replace(/^(?:a|an|the)\s+/i, "")
        .replace(/^to\s+/i, "")
        .trim();
}

function singularizeSimplePlural(value) {
    const normalized = String(value || "").trim();

    if (normalized.length <= 3) {
        return normalized;
    }

    if (/ies$/i.test(normalized) && normalized.length > 4) {
        return `${normalized.slice(0, -3)}y`;
    }

    if (/ses$/i.test(normalized) || /xes$/i.test(normalized)) {
        return normalized.slice(0, -2);
    }

    if (/s$/i.test(normalized) && !/ss$/i.test(normalized)) {
        return normalized.slice(0, -1);
    }

    return normalized;
}

function buildFallbackPageUrl(title) {
    const pageTitle = String(title || "").replace(/\s+/g, "_");
    return `https://commons.wikimedia.org/wiki/${encodeURIComponent(pageTitle)}`;
}

function getExtMetadataValue(metadata, key) {
    return stripHtml(metadata?.[key]?.value || "");
}

export function deriveImageSearchQuery({ englishAnswers = [], german = "", manualQuery = "" } = {}) {
    const manual = normalizeToken(manualQuery);

    if (manual) {
        return manual;
    }

    const firstEnglish = Array.isArray(englishAnswers) ? englishAnswers[0] : "";
    const candidate = String(firstEnglish || german || "")
        .split(/[;,/]/, 1)[0]
        .replace(/\([^)]*\)/g, " ")
        .replace(/\[[^\]]*\]/g, " ")
        .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, " ")
        .replace(/\s+/g, " ")
        .trim();

    const withoutArticles = removeLeadingArticle(candidate);
    const singularized = singularizeSimplePlural(withoutArticles);
    return normalizeToken(singularized);
}

export async function searchWikimediaCommonsImages(query, { limit = 8, signal } = {}) {
    const normalizedQuery = normalizeToken(query);

    if (!normalizedQuery) {
        throw new Error("Enter a search term first.");
    }

    const params = new URLSearchParams({
        action: "query",
        format: "json",
        formatversion: "2",
        origin: "*",
        generator: "search",
        gsrsearch: normalizedQuery,
        gsrnamespace: "6",
        gsrlimit: String(Math.min(Math.max(limit, 1), 12)),
        prop: "imageinfo|info",
        iiprop: "url|mime|size|extmetadata",
        iiurlwidth: "900",
        iiurlheight: "900",
        inprop: "url",
    });

    const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params.toString()}`, {
        method: "GET",
        signal,
    });

    if (!response.ok) {
        throw new Error("Image search is temporarily unavailable.");
    }

    const payload = await response.json();
    const pages = Array.isArray(payload?.query?.pages) ? payload.query.pages : [];

    return pages
        .map((page) => {
            const imageInfo = Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null;

            if (!imageInfo || !String(imageInfo.mime || "").startsWith("image/")) {
                return null;
            }

            const title = String(page.title || "").replace(/^File:/i, "").replace(/_/g, " ");
            const metadata = imageInfo.extmetadata || {};
            const creator =
                getExtMetadataValue(metadata, "Artist") ||
                getExtMetadataValue(metadata, "Credit") ||
                "Unknown";
            const license =
                getExtMetadataValue(metadata, "LicenseShortName") ||
                getExtMetadataValue(metadata, "UsageTerms") ||
                "See source";
            const description =
                getExtMetadataValue(metadata, "ImageDescription") ||
                getExtMetadataValue(metadata, "ObjectName") ||
                title;
            const pageUrl = page.canonicalurl || page.fullurl || buildFallbackPageUrl(page.title);
            const displayUrl = imageInfo.thumburl || imageInfo.url || "";

            if (!displayUrl) {
                return null;
            }

            return {
                id: String(page.pageid || page.title || crypto.randomUUID()),
                title,
                description,
                imageUrl: displayUrl,
                fullImageUrl: imageInfo.url || displayUrl,
                pageUrl,
                width: Number(imageInfo.thumbwidth || imageInfo.width || 0),
                height: Number(imageInfo.thumbheight || imageInfo.height || 0),
                creator,
                license,
                licenseUrl: getExtMetadataValue(metadata, "LicenseUrl"),
                provider: "Wikimedia Commons",
                searchQuery: normalizedQuery,
            };
        })
        .filter(Boolean);
}

export function buildRemoteImageAttribution(selection) {
    if (!selection) {
        return null;
    }

    return {
        provider: String(selection.provider || "Wikimedia Commons"),
        title: String(selection.title || ""),
        creator: String(selection.creator || "Unknown"),
        license: String(selection.license || "See source"),
        licenseUrl: String(selection.licenseUrl || ""),
        pageUrl: String(selection.pageUrl || ""),
        imageUrl: String(selection.imageUrl || ""),
        fullImageUrl: String(selection.fullImageUrl || selection.imageUrl || ""),
        searchQuery: String(selection.searchQuery || ""),
    };
}

export function formatRemoteImageAttribution(attribution) {
    if (!attribution) {
        return "";
    }

    const parts = [String(attribution.provider || "Wikimedia Commons")];

    if (attribution.creator && attribution.creator !== "Unknown") {
        parts.push(`by ${attribution.creator}`);
    }

    if (attribution.license) {
        parts.push(attribution.license);
    }

    return parts.join(" · ");
}
