const STORAGE_KEY = "de_en_flashcards_app_v1";
const DEFAULT_COLLECTION_COLOR = "#64748b";

function defaultState() {
    return {
        flashcards: [],
        collections: [],
    };
}

function normalizeEnglishAnswers(value) {
    let answers = [];

    if (Array.isArray(value?.englishAnswers)) {
        answers = value.englishAnswers;
    } else if (typeof value?.english === "string") {
        answers = [value.english];
    } else if (Array.isArray(value?.english)) {
        answers = value.english;
    }

    return [...new Set(answers.map((item) => String(item || "").trim()).filter(Boolean))];
}

function sanitizeFlashcard(card) {
    return {
        id: String(card?.id || crypto.randomUUID()),
        german: String(card?.german || "").trim(),
        englishAnswers: normalizeEnglishAnswers(card),
        imageData: String(card?.imageData || ""),
    };
}

function sanitizeColor(value) {
    return /^#[0-9a-fA-F]{6}$/.test(String(value || ""))
        ? String(value)
        : DEFAULT_COLLECTION_COLOR;
}

function sanitizeCollection(collection) {
    return {
        id: String(collection?.id || crypto.randomUUID()),
        name: String(collection?.name || "").trim(),
        cardIds: Array.isArray(collection?.cardIds)
            ? collection.cardIds.map((id) => String(id))
            : [],
        color: sanitizeColor(collection?.color),
    };
}

function sanitizeState(rawState) {
    return {
        flashcards: Array.isArray(rawState?.flashcards)
            ? rawState.flashcards
                  .map(sanitizeFlashcard)
                  .filter((card) => card.german && card.englishAnswers.length > 0)
            : [],
        collections: Array.isArray(rawState?.collections)
            ? rawState.collections.map(sanitizeCollection).filter((collection) => collection.name)
            : [],
    };
}

export function loadState() {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
        return defaultState();
    }

    try {
        const parsed = JSON.parse(raw);
        return sanitizeState(parsed);
    } catch (error) {
        console.error("Failed to parse saved state.", error);
        return defaultState();
    }
}

export function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeState(state)));
}

export function replaceState(nextState) {
    const safeState = sanitizeState(nextState);
    saveState(safeState);
    return safeState;
}
