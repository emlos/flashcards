import { OPEN_DOODLES_CATALOG } from "./illustration-catalogs.js";

const INITIAL_RESULTS_PER_PROVIDER = 2;
const MAX_RESULTS_PER_PROVIDER = 10;
const OPENVERSE_API_BASE_URL = "https://api.openverse.org/v1/images/";
const OPENMOJI_DATA_URL =
    "https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji@master/data/openmoji.json";
const OPENMOJI_SVG_BASE_URL = "https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji@master/color/svg";
const UNDRAW_DATA_URL =
    "https://cdn.jsdelivr.net/gh/cuuupid/undraw-illustrations@master/undraw.json";
const OPEN_DOODLES_COMPONENT_BASE_URL =
    "https://cdn.jsdelivr.net/gh/lunahq/react-open-doodles@master/src/components";
const OPEN_DOODLES_ACCENT = "#ff5678";
const OPEN_DOODLES_INK = "#000000";

const PROVIDER_METADATA = Object.freeze({
    openMoji: Object.freeze({ key: "openMoji", label: "OpenMoji" }),
    openDoodles: Object.freeze({ key: "openDoodles", label: "Open Doodles" }),
    unDraw: Object.freeze({ key: "unDraw", label: "unDraw" }),
    openverse: Object.freeze({ key: "openverse", label: "Openverse" }),
    wikimedia: Object.freeze({ key: "wikimedia", label: "Wikimedia Commons" }),
});

const SEARCH_PROVIDER_ORDER = Object.freeze([
    PROVIDER_METADATA.openMoji,
    PROVIDER_METADATA.openDoodles,
    PROVIDER_METADATA.unDraw,
    PROVIDER_METADATA.openverse,
    PROVIDER_METADATA.wikimedia,
]);

const AUTO_PICK_PROVIDER_ORDER = Object.freeze([
    PROVIDER_METADATA.openMoji.label,
    PROVIDER_METADATA.openDoodles.label,
    PROVIDER_METADATA.unDraw.label,
    PROVIDER_METADATA.openverse.label,
    PROVIDER_METADATA.wikimedia.label,
]);

let openMojiCatalogPromise = null;
let undrawCatalogPromise = null;
const openDoodlesSvgDataUrlPromiseByComponent = new Map();

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

function tokenize(value) {
    return normalizeToken(value)
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean);
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

function clampProviderLimit(value, defaultValue = INITIAL_RESULTS_PER_PROVIDER) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue) || numericValue <= 0) {
        return defaultValue;
    }

    return Math.min(Math.max(Math.round(numericValue), 1), MAX_RESULTS_PER_PROVIDER);
}

function scoreTextMatch(query, candidate) {
    const normalizedQuery = normalizeToken(query);
    const normalizedCandidate = normalizeToken(candidate);

    if (!normalizedQuery || !normalizedCandidate) {
        return 0;
    }

    let score = 0;

    if (normalizedCandidate === normalizedQuery) {
        score += 220;
    }

    if (normalizedCandidate.startsWith(normalizedQuery)) {
        score += 110;
    }

    if (normalizedCandidate.includes(normalizedQuery)) {
        score += 70;
    }

    const queryTokens = tokenize(normalizedQuery);
    queryTokens.forEach((token) => {
        if (normalizedCandidate === token) {
            score += 90;
            return;
        }

        if (normalizedCandidate.startsWith(token)) {
            score += 45;
        }

        if (normalizedCandidate.includes(token)) {
            score += 22;
        }
    });

    return score;
}

function scoreCatalogEntry(query, entry, { titleBoost = 1, keywordBoost = 1 } = {}) {
    const normalizedQuery = normalizeToken(query);

    if (!normalizedQuery || !entry) {
        return 0;
    }

    const titleScore = scoreTextMatch(normalizedQuery, entry.title || "") * titleBoost;
    const descriptionScore = scoreTextMatch(normalizedQuery, entry.description || "");
    const keywords = Array.isArray(entry.keywords) ? entry.keywords : [];
    const keywordScore =
        keywords.reduce((total, keyword) => total + scoreTextMatch(normalizedQuery, keyword), 0) *
        keywordBoost;

    return titleScore + descriptionScore + keywordScore;
}

function dedupeSearchResults(results) {
    const seenKeys = new Set();

    return results.filter((result) => {
        const key = [
            result.provider,
            result.pageUrl,
            result.fullImageUrl,
            result.imageUrl,
            result.title,
        ]
            .map((value) => String(value || "").trim())
            .filter(Boolean)
            .join("|");

        if (!key || seenKeys.has(key)) {
            return false;
        }

        seenKeys.add(key);
        return true;
    });
}

function fetchJson(url, { signal } = {}) {
    return fetch(url, { method: "GET", signal }).then((response) => {
        if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}.`);
        }

        return response.json();
    });
}

function fetchText(url, { signal } = {}) {
    return fetch(url, { method: "GET", signal }).then((response) => {
        if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}.`);
        }

        return response.text();
    });
}

function normalizeOpenMojiTags(value) {
    if (Array.isArray(value)) {
        return value.map((item) => String(item || "").trim()).filter(Boolean);
    }

    return String(value || "")
        .split(/[;,|]/)
        .map((item) => String(item || "").trim())
        .filter(Boolean);
}

function loadOpenMojiCatalog(signal) {
    if (!openMojiCatalogPromise) {
        openMojiCatalogPromise = fetchJson(OPENMOJI_DATA_URL, { signal }).catch((error) => {
            openMojiCatalogPromise = null;
            throw error;
        });
    }

    return openMojiCatalogPromise;
}

function loadUndrawCatalog(signal) {
    if (!undrawCatalogPromise) {
        undrawCatalogPromise = fetchJson(UNDRAW_DATA_URL, { signal }).catch((error) => {
            undrawCatalogPromise = null;
            throw error;
        });
    }

    return undrawCatalogPromise;
}

function toSvgDataUrl(svgMarkup) {
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svgMarkup)}`;
}

function escapeSvgText(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function buildProviderPlaceholderDataUrl(provider, label, detail = "") {
    const safeProvider = escapeSvgText(provider);
    const safeLabel = escapeSvgText(label);
    const safeDetail = escapeSvgText(detail);
    const svgMarkup = `
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640" role="img" aria-label="${safeProvider}">
  <rect width="640" height="640" rx="36" fill="#f8fafc" />
  <rect x="32" y="32" width="576" height="576" rx="28" fill="#ffffff" stroke="#cbd5e1" stroke-width="3" />
  <rect x="64" y="64" width="164" height="38" rx="19" fill="#e2e8f0" />
  <text x="82" y="88" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="22" fill="#475569">${safeProvider}</text>
  <text x="64" y="210" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="42" font-weight="700" fill="#0f172a">${safeLabel}</text>
  <text x="64" y="264" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="24" fill="#475569">${safeDetail}</text>
  <circle cx="462" cy="208" r="72" fill="#e0e7ff" />
  <rect x="392" y="322" width="148" height="128" rx="20" fill="#f1f5f9" stroke="#cbd5e1" stroke-width="3" />
  <path d="M420 420l38-44 42 36 40-56 36 64z" fill="#c7d2fe" />
  <circle cx="444" cy="350" r="14" fill="#94a3b8" />
</svg>`;
    return toSvgDataUrl(svgMarkup.trim());
}

function buildOpenDoodlesComponentUrl(componentName) {
    return `${OPEN_DOODLES_COMPONENT_BASE_URL}/${encodeURIComponent(componentName)}.tsx`;
}

function convertJsxSvgToPlainSvg(svgMarkup) {
    return String(svgMarkup || "")
        .replace(/\{accent\}/g, OPEN_DOODLES_ACCENT)
        .replace(/\{ink\}/g, OPEN_DOODLES_INK)
        .replace(/\bclassName=/g, "class=")
        .replace(/\bfillRule=/g, "fill-rule=")
        .replace(/\bclipRule=/g, "clip-rule=")
        .replace(/\bstrokeWidth=/g, "stroke-width=")
        .replace(/\bstrokeLinecap=/g, "stroke-linecap=")
        .replace(/\bstrokeLinejoin=/g, "stroke-linejoin=")
        .replace(/\bstrokeMiterlimit=/g, "stroke-miterlimit=")
        .replace(/\bstopColor=/g, "stop-color=")
        .replace(/\bstopOpacity=/g, "stop-opacity=")
        .replace(/\bcolorInterpolationFilters=/g, "color-interpolation-filters=")
        .replace(/\{[^}]+\}/g, "")
        .trim();
}

function loadOpenDoodlesSvgDataUrl(componentName, signal) {
    if (!openDoodlesSvgDataUrlPromiseByComponent.has(componentName)) {
        const promise = fetchText(buildOpenDoodlesComponentUrl(componentName), { signal })
            .then((tsxSource) => {
                const svgMatch = String(tsxSource || "").match(/<svg[\s\S]*?<\/svg>/i);

                if (!svgMatch) {
                    throw new Error(`Could not parse ${componentName}.`);
                }

                return toSvgDataUrl(convertJsxSvgToPlainSvg(svgMatch[0]));
            })
            .catch((error) => {
                openDoodlesSvgDataUrlPromiseByComponent.delete(componentName);
                throw error;
            });

        openDoodlesSvgDataUrlPromiseByComponent.set(componentName, promise);
    }

    return openDoodlesSvgDataUrlPromiseByComponent.get(componentName);
}

function extractScriptJsonBlocks(html) {
    const blocks = [];
    const pattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

    for (const match of String(html || "").matchAll(pattern)) {
        const value = String(match[1] || "").trim();
        if (value) {
            blocks.push(value);
        }
    }

    return blocks;
}

export function deriveImageSearchQuery({
    englishAnswers = [],
    german = "",
    manualQuery = "",
} = {}) {
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
        gsrlimit: String(clampProviderLimit(limit, 8)),
        prop: "imageinfo|info",
        iiprop: "url|mime|size|extmetadata",
        iiurlwidth: "900",
        iiurlheight: "900",
        inprop: "url",
    });

    const payload = await fetchJson(
        `https://commons.wikimedia.org/w/api.php?${params.toString()}`,
        {
            signal,
        },
    );
    const pages = Array.isArray(payload?.query?.pages) ? payload.query.pages : [];

    return dedupeSearchResults(
        pages
            .map((page) => {
                const imageInfo = Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null;

                if (!imageInfo || !String(imageInfo.mime || "").startsWith("image/")) {
                    return null;
                }

                const title = String(page.title || "")
                    .replace(/^File:/i, "")
                    .replace(/_/g, " ");
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
                const pageUrl =
                    page.canonicalurl || page.fullurl || buildFallbackPageUrl(page.title);
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
                    provider: PROVIDER_METADATA.wikimedia.label,
                    searchQuery: normalizedQuery,
                };
            })
            .filter(Boolean),
    );
}

export async function searchOpenverseImages(query, { limit = 8, signal } = {}) {
    const normalizedQuery = normalizeToken(query);

    if (!normalizedQuery) {
        throw new Error("Enter a search term first.");
    }

    const params = new URLSearchParams({
        q: normalizedQuery,
        page_size: String(clampProviderLimit(limit, 8)),
    });

    const payload = await fetchJson(`${OPENVERSE_API_BASE_URL}?${params.toString()}`, { signal });
    const results = Array.isArray(payload?.results) ? payload.results : [];

    return dedupeSearchResults(
        results
            .map((item) => {
                const imageUrl = String(item?.thumbnail || item?.url || "").trim();
                const fullImageUrl = String(item?.url || imageUrl).trim();
                const pageUrl = String(
                    item?.foreign_landing_url || item?.creator_url || fullImageUrl,
                ).trim();

                if (!imageUrl || !pageUrl) {
                    return null;
                }

                const licenseLabel =
                    [item?.license, item?.license_version]
                        .map((value) => String(value || "").trim())
                        .filter(Boolean)
                        .join(" ") || "See source";

                return {
                    id: String(item?.id || item?.identifier || pageUrl || crypto.randomUUID()),
                    title: String(item?.title || normalizedQuery).trim() || normalizedQuery,
                    description: stripHtml(
                        item?.meta_data?.description || item?.title || normalizedQuery,
                    ),
                    imageUrl,
                    fullImageUrl,
                    pageUrl,
                    width: Number(item?.width || 0),
                    height: Number(item?.height || 0),
                    creator: String(item?.creator || item?.provider || "Unknown"),
                    license: licenseLabel,
                    licenseUrl: String(item?.meta_data?.license_url || "").trim(),
                    provider: PROVIDER_METADATA.openverse.label,
                    searchQuery: normalizedQuery,
                };
            })
            .filter(Boolean),
    );
}

export async function searchOpenMojiImages(query, { limit = 8, signal } = {}) {
    const normalizedQuery = normalizeToken(query);

    if (!normalizedQuery) {
        throw new Error("Enter a search term first.");
    }

    const catalogData = await loadOpenMojiCatalog(signal);
    const catalog = Array.isArray(catalogData) ? catalogData : [];
    const ranked = catalog
        .map((entry) => {
            const tags = normalizeOpenMojiTags(entry?.openmoji_tags || entry?.tags);
            const score = scoreCatalogEntry(
                normalizedQuery,
                {
                    title: entry?.annotation || entry?.emoji || "",
                    description: [entry?.group, entry?.subgroups].filter(Boolean).join(" "),
                    keywords: tags,
                },
                {
                    titleBoost: 1.4,
                    keywordBoost: 1.1,
                },
            );
            return { entry, score };
        })
        .filter((item) => item.score > 0 && !String(item.entry?.skintone || ""))
        .sort((left, right) => right.score - left.score)
        .slice(0, clampProviderLimit(limit, 8));

    return ranked.map(({ entry }) => {
        const hexcode = String(entry?.hexcode || "")
            .trim()
            .toUpperCase();
        const imageUrl = `${OPENMOJI_SVG_BASE_URL}/${encodeURIComponent(hexcode)}.svg`;
        const title =
            String(entry?.annotation || entry?.emoji || normalizedQuery).trim() || normalizedQuery;
        const tags = normalizeOpenMojiTags(entry?.openmoji_tags || entry?.tags);

        return {
            id: hexcode || String(entry?.emoji || title || crypto.randomUUID()),
            title,
            description: tags.join(", "),
            imageUrl,
            fullImageUrl: imageUrl,
            pageUrl: `https://openmoji.org/library/#${encodeURIComponent(hexcode)}`,
            width: 0,
            height: 0,
            creator: "OpenMoji",
            license: "CC BY-SA 4.0",
            licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
            provider: PROVIDER_METADATA.openMoji.label,
            searchQuery: normalizedQuery,
        };
    });
}

export async function searchUndrawImages(query, { limit = 8, signal } = {}) {
    const normalizedQuery = normalizeToken(query);

    if (!normalizedQuery) {
        throw new Error("Enter a search term first.");
    }

    const catalogData = await loadUndrawCatalog(signal);
    const catalog = Array.isArray(catalogData) ? catalogData : [];
    const ranked = catalog
        .map((entry) => {
            const keywords = String(entry?.tags || "")
                .split(/\s*,\s*/)
                .map((tag) => tag.trim())
                .filter(Boolean);
            const score = scoreCatalogEntry(
                normalizedQuery,
                {
                    title: entry?.title || "",
                    description: entry?.title || "",
                    keywords,
                },
                {
                    titleBoost: 1.3,
                    keywordBoost: 1.1,
                },
            );
            return { entry, score, keywords };
        })
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, clampProviderLimit(limit, 8));

    return ranked
        .map(({ entry, keywords }) => ({
            id: String(entry?.image || entry?.title || crypto.randomUUID()),
            title: String(entry?.title || normalizedQuery).trim() || normalizedQuery,
            description: keywords.join(", "),
            imageUrl: String(entry?.image || "").trim(),
            fullImageUrl: String(entry?.image || "").trim(),
            pageUrl: `https://undraw.co/search/${encodeURIComponent(normalizedQuery.replace(/\s+/g, "-"))}`,
            width: 0,
            height: 0,
            creator: "unDraw",
            license: "MIT",
            licenseUrl: "https://undraw.co/license",
            provider: PROVIDER_METADATA.unDraw.label,
            searchQuery: normalizedQuery,
        }))
        .filter((entry) => Boolean(entry.imageUrl));
}

export async function searchOpenDoodlesImages(query, { limit = 8, signal } = {}) {
    const normalizedQuery = normalizeToken(query);

    if (!normalizedQuery) {
        throw new Error("Enter a search term first.");
    }

    const rankedEntries = OPEN_DOODLES_CATALOG.map((entry) => ({
        entry,
        score: scoreCatalogEntry(normalizedQuery, entry, {
            titleBoost: 1.25,
            keywordBoost: 1.15,
        }),
    }))
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, clampProviderLimit(limit, 8));

    const resolvedResults = await Promise.all(
        rankedEntries.map(async ({ entry }) => {
            try {
                const imageUrl = await loadOpenDoodlesSvgDataUrl(entry.componentName, signal);
                return {
                    id: entry.id,
                    title: entry.title,
                    description: entry.description,
                    imageUrl,
                    fullImageUrl: imageUrl,
                    pageUrl: "https://www.opendoodles.com/",
                    width: 0,
                    height: 0,
                    creator: "Pablo Stanley",
                    license: "CC0",
                    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
                    provider: PROVIDER_METADATA.openDoodles.label,
                    searchQuery: normalizedQuery,
                };
            } catch (_error) {
                return null;
            }
        }),
    );

    return resolvedResults.filter(Boolean);
}

export async function searchImageProviders(
    query,
    {
        perProviderLimit = INITIAL_RESULTS_PER_PROVIDER,
        maxPerProvider = MAX_RESULTS_PER_PROVIDER,
        expanded = false,
        signal,
    } = {},
) {
    const normalizedQuery = normalizeToken(query);

    if (!normalizedQuery) {
        throw new Error("Enter a search term first.");
    }

    const activeProviderLimit = expanded
        ? clampProviderLimit(maxPerProvider, MAX_RESULTS_PER_PROVIDER)
        : clampProviderLimit(perProviderLimit, INITIAL_RESULTS_PER_PROVIDER);

    const providerSearchers = new Map([
        [PROVIDER_METADATA.openMoji.key, searchOpenMojiImages],
        [PROVIDER_METADATA.openDoodles.key, searchOpenDoodlesImages],
        [PROVIDER_METADATA.unDraw.key, searchUndrawImages],
        [PROVIDER_METADATA.openverse.key, searchOpenverseImages],
        [PROVIDER_METADATA.wikimedia.key, searchWikimediaCommonsImages],
    ]);

    const providerSections = await Promise.all(
        SEARCH_PROVIDER_ORDER.map(async (provider) => {
            const searcher = providerSearchers.get(provider.key);

            if (!searcher) {
                return { ...provider, results: [], error: "", canLoadMore: false };
            }

            try {
                const results = dedupeSearchResults(
                    await searcher(normalizedQuery, {
                        limit: activeProviderLimit,
                        signal,
                    }),
                ).slice(0, activeProviderLimit);

                const canLoadMore = !expanded && results.length >= activeProviderLimit;

                return {
                    ...provider,
                    results,
                    error: "",
                    canLoadMore,
                };
            } catch (error) {
                return {
                    ...provider,
                    results: [],
                    error: error?.message || "",
                    canLoadMore: false,
                };
            }
        }),
    );

    const visibleSections = providerSections.filter((section) => section.results.length > 0);
    const totalResults = visibleSections.reduce(
        (total, section) => total + section.results.length,
        0,
    );
    const canLoadMore = !expanded && visibleSections.some((section) => section.canLoadMore);

    return {
        query: normalizedQuery,
        expanded,
        perProviderLimit: activeProviderLimit,
        providerSections,
        visibleSections,
        totalResults,
        canLoadMore,
    };
}

export async function findBestImageMatch(query, { signal } = {}) {
    const resultSet = await searchImageProviders(query, {
        perProviderLimit: INITIAL_RESULTS_PER_PROVIDER,
        maxPerProvider: MAX_RESULTS_PER_PROVIDER,
        expanded: false,
        signal,
    });

    const sectionsByProviderLabel = new Map(
        resultSet.providerSections.map((section) => [section.label, section.results]),
    );

    for (const providerLabel of AUTO_PICK_PROVIDER_ORDER) {
        const providerResults = sectionsByProviderLabel.get(providerLabel) || [];
        const pick = providerResults.find((result) => !result.externalOnly);
        if (pick) {
            return pick;
        }
    }

    for (const section of resultSet.visibleSections) {
        const pick = section.results.find((result) => !result.externalOnly);
        if (pick) {
            return pick;
        }
    }

    return null;
}

export function buildRemoteImageAttribution(selection) {
    if (!selection) {
        return null;
    }

    return {
        provider: String(selection.provider || "Image source"),
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

    const parts = [String(attribution.provider || "Image source")];

    if (attribution.creator && attribution.creator !== "Unknown") {
        parts.push(`by ${attribution.creator}`);
    }

    if (attribution.license) {
        parts.push(attribution.license);
    }

    return parts.join(" · ");
}
