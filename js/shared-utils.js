export function createEmptyStateRow(message) {
    const row = document.createElement("div");
    row.className = "empty-state";
    row.textContent = message;
    return row;
}

export function formatAccuracy(timesCorrect, timesSeen) {
    if (!timesSeen) {
        return "0% accuracy";
    }

    return `${Math.round((timesCorrect / timesSeen) * 100)}% accuracy`;
}

export function formatSessionTimestamp(value) {
    const timestamp = Date.parse(value || "");

    if (Number.isNaN(timestamp)) {
        return "Unknown date";
    }

    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(new Date(timestamp));
}

export function formatRelativeDateLabel(value) {
    const timestamp = Date.parse(value || "");

    if (Number.isNaN(timestamp)) {
        return "unknown";
    }

    const diffDays = Math.max(0, Math.round((Date.now() - timestamp) / 86400000));

    if (diffDays === 0) {
        return "today";
    }

    if (diffDays === 1) {
        return "yesterday";
    }

    return `${diffDays} days ago`;
}

export function formatSessionCompletionLabel(entry) {
    return entry.answeredCount < entry.totalCards ? "Ended early" : "Completed";
}

export function formatStudyModeLabel(mode) {
    const labels = {
        "de-en": "German → English",
        "mc-de-en": "Multiple choice",
        "en-de": "English → German",
        "image-de": "Image → German",
        random: "Random mix",
    };

    return labels[mode] || mode;
}

export function formatStudySessionTypeLabel(sessionType) {
    const labels = {
        free: "Free practice",
        srs: "SRS review",
    };

    return labels[sessionType] || "Free practice";
}

export function formatSrsIntervalLabel(intervalDays) {
    const interval = Number(intervalDays) || 0;

    if (interval <= 0) {
        return "New";
    }

    if (interval === 1) {
        return "1 day";
    }

    return `${interval} days`;
}

export function formatSrsDueDateLabel(dueDateIso, todayIso = getLocalIsoDate()) {
    const dueDate = String(dueDateIso || "").trim();

    if (!dueDate) {
        return "New";
    }

    if (dueDate < todayIso) {
        const overdueDays = differenceInLocalDateDays(dueDate, todayIso);
        return overdueDays === 1 ? "Overdue by 1 day" : `Overdue by ${overdueDays} days`;
    }

    if (dueDate === todayIso) {
        return "Due today";
    }

    const daysUntilDue = differenceInLocalDateDays(todayIso, dueDate);

    if (daysUntilDue === 1) {
        return "Due tomorrow";
    }

    return `Due in ${daysUntilDue} days`;
}

export function formatStudyScore(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function downloadTextFile(content, filename) {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}

export function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

export function normalizeWord(value) {
    return String(value || "")
        .trim()
        .toLocaleLowerCase();
}

export function parseEnglishAnswersInput(value) {
    return [
        ...new Set(
            String(value || "")
                .split(";")
                .map((item) => item.trim())
                .filter(Boolean),
        ),
    ];
}

export function mergeEnglishAnswers(existingAnswers, incomingAnswers) {
    const merged = [...(existingAnswers || [])];
    const existingNormalized = new Set(merged.map((item) => normalizeWord(item)));

    const added = [];

    for (const answer of incomingAnswers || []) {
        const normalized = normalizeWord(answer);

        if (!normalized || existingNormalized.has(normalized)) {
            continue;
        }

        merged.push(answer.trim());
        existingNormalized.add(normalized);
        added.push(answer.trim());
    }

    return { merged, added };
}

export function matchesCardSearch(card, searchTerm) {
    const normalizedSearch = normalizeWord(searchTerm);

    if (!normalizedSearch) {
        return true;
    }

    return (
        normalizeWord(card.german).includes(normalizedSearch) ||
        (card.englishAnswers || []).some((answer) =>
            normalizeWord(answer).includes(normalizedSearch),
        )
    );
}

export function buildFlashcardSaveMessage({
    german,
    addedMeanings = [],
    imageUpdate = null,
    reusedExistingCard = false,
}) {
    const messageParts = [];

    if (reusedExistingCard) {
        messageParts.push(`Updated existing flashcard “${german}”.`);

        if (addedMeanings.length > 0) {
            messageParts.push(
                `Added meaning${addedMeanings.length === 1 ? "" : "s"}: ${addedMeanings.join(", ")}.`,
            );
        }
    } else {
        messageParts.push(`Saved flashcard “${german}”.`);
    }

    appendImageUpdateMessageParts(messageParts, imageUpdate);

    return messageParts.join(" ");
}

export function buildCollectionFlashcardSaveMessage({
    card,
    collectionName,
    addedMeanings = [],
    imageUpdate = null,
    reusedExistingCard = false,
}) {
    const messageParts = [];

    if (reusedExistingCard) {
        messageParts.push(`Updated flashcard “${card.german}” in “${collectionName}”.`);

        if (addedMeanings.length > 0) {
            messageParts.push(
                `Added meaning${addedMeanings.length === 1 ? "" : "s"}: ${addedMeanings.join(", ")}.`,
            );
        }
    } else {
        messageParts.push(`Added flashcard “${card.german}” to “${collectionName}”.`);
    }

    appendImageUpdateMessageParts(messageParts, imageUpdate);

    return messageParts.join(" ");
}

export function buildFlashcardEditSaveMessage({ german, imageUpdate = null }) {
    const messageParts = [`Saved changes to “${german}”.`];
    appendImageUpdateMessageParts(messageParts, imageUpdate);
    return messageParts.join(" ");
}

export function appendImageUpdateMessageParts(messageParts, imageUpdate) {
    if (!imageUpdate) {
        return;
    }

    if (imageUpdate.removed) {
        messageParts.push("Removed image.");
        return;
    }

    messageParts.push(imageUpdate.replacedExisting ? "Replaced image." : "Added image.");

    if (imageUpdate.wasResized || imageUpdate.wasCompressed) {
        messageParts.push(
            `Stored ${formatFileSize(imageUpdate.finalSizeBytes)} instead of ${formatFileSize(
                imageUpdate.originalSizeBytes,
            )}.`,
        );
    }
}

export function getStudyImageModeMessage({
    selectedCardCount,
    skippedCardsWithoutImages,
    remainingCardsCount,
}) {
    if (skippedCardsWithoutImages <= 0 || selectedCardCount <= 0) {
        return "";
    }

    if (remainingCardsCount <= 0) {
        return `Image → German only uses flashcards with images. ${skippedCardsWithoutImages} selected card${
            skippedCardsWithoutImages === 1 ? " was" : "s were"
        } skipped because ${skippedCardsWithoutImages === 1 ? "it has" : "they have"} no image.`;
    }

    return `Image → German will study ${remainingCardsCount} card${
        remainingCardsCount === 1 ? "" : "s"
    }. ${skippedCardsWithoutImages} selected card${skippedCardsWithoutImages === 1 ? " was" : "s were"} skipped because ${
        skippedCardsWithoutImages === 1 ? "it has" : "they have"
    } no image.`;
}

export function getEffectiveStudyCardCount(cards, cardLimit) {
    return cardLimit && cardLimit < cards.length ? cardLimit : cards.length;
}

export function parseStudyCardLimit(value) {
    const normalized = String(value || "").trim();

    if (!normalized) {
        return null;
    }

    const parsed = Number.parseInt(normalized, 10);

    if (!Number.isInteger(parsed) || parsed < 1) {
        return Number.NaN;
    }

    return parsed;
}

export function parseSrsNewCardsPerDay(value, fallback = 20) {
    const normalized = String(value ?? "").trim();

    if (!normalized) {
        return fallback;
    }

    const parsed = Number.parseInt(normalized, 10);

    if (!Number.isInteger(parsed) || parsed < 1) {
        return Number.NaN;
    }

    return parsed;
}

export function getLocalIsoDate(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

export function differenceInLocalDateDays(startIso, endIso) {
    const start = parseLocalDate(startIso);
    const end = parseLocalDate(endIso);

    if (!start || !end) {
        return 0;
    }

    return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
}

function parseLocalDate(value) {
    const iso = String(value || "").trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
        return null;
    }

    const [year, month, day] = iso.split("-").map((part) => Number.parseInt(part, 10));
    return new Date(year, month - 1, day);
}

export function getCollectionColor(collection) {
    return collection?.color || "#64748b";
}

export function formatFileSize(bytes) {
    const value = Number(bytes) || 0;

    if (value < 1024) {
        return `${value} B`;
    }

    if (value < 1024 * 1024) {
        return `${(value / 1024).toFixed(1)} KB`;
    }

    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}
