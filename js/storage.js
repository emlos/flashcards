const LEGACY_STORAGE_KEY = "de_en_flashcards_app_v1";
const UI_PREFS_KEY = "de_en_flashcards_ui_prefs_v1";
const DEFAULT_COLLECTION_COLOR = "#64748b";
const DATABASE_NAME = "de_en_flashcards_app";
const DATABASE_VERSION = 1;
const STATE_STORE_NAME = "app_state";
const STATE_RECORD_KEY = "state";

export function createEmptyState() {
    return {
        flashcards: [],
        collections: [],
        studyHistory: [],
        cardStats: {},
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
    return /^#[0-9a-fA-F]{6}$/.test(String(value || "")) ? String(value) : DEFAULT_COLLECTION_COLOR;
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

function sanitizeCardStats(rawStats) {
    if (!rawStats || typeof rawStats !== "object") {
        return {};
    }

    return Object.fromEntries(
        Object.entries(rawStats)
            .map(([cardId, stats]) => {
                const timesSeen = toNonNegativeInteger(stats?.timesSeen);
                const timesCorrect = Math.min(toNonNegativeInteger(stats?.timesCorrect), timesSeen);

                return [
                    String(cardId),
                    {
                        timesSeen,
                        timesCorrect,
                        lastSeenAt: sanitizeIsoDate(stats?.lastSeenAt),
                        lastCorrectAt: sanitizeIsoDate(stats?.lastCorrectAt),
                    },
                ];
            })
            .filter(([, stats]) => stats.timesSeen > 0 || stats.timesCorrect > 0),
    );
}

function sanitizeStudyHistoryEntry(entry) {
    const totalCards = toNonNegativeInteger(entry?.totalCards);
    const answeredCount = Math.min(
        toNonNegativeInteger(entry?.answeredCount ?? totalCards),
        totalCards,
    );

    return {
        id: String(entry?.id || crypto.randomUUID()),
        finishedAt: sanitizeIsoDate(entry?.finishedAt) || new Date().toISOString(),
        collectionLabel:
            String(entry?.collectionLabel || "All flashcards").trim() || "All flashcards",
        collectionIds: Array.isArray(entry?.collectionIds)
            ? entry.collectionIds.map((id) => String(id)).filter(Boolean)
            : [],
        mode: sanitizeStudyMode(entry?.mode),
        score: toNonNegativeNumber(entry?.score),
        answeredCount,
        totalCards,
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
        studyHistory: Array.isArray(rawState?.studyHistory)
            ? rawState.studyHistory
                  .map(sanitizeStudyHistoryEntry)
                  .filter((entry) => entry.totalCards > 0)
                  .sort((left, right) => Date.parse(right.finishedAt) - Date.parse(left.finishedAt))
            : [],
        cardStats: sanitizeCardStats(rawState?.cardStats),
    };
}

function sanitizeUiPrefs(rawPrefs) {
    return {
        activeTab: sanitizeTabName(rawPrefs?.activeTab),
        studyMode: sanitizeStudyMode(rawPrefs?.studyMode),
        studyCardLimit: sanitizeUiTextValue(rawPrefs?.studyCardLimit),
        selectedStudyCollectionIds: Array.isArray(rawPrefs?.selectedStudyCollectionIds)
            ? [
                  ...new Set(
                      rawPrefs.selectedStudyCollectionIds.map((id) => String(id)).filter(Boolean),
                  ),
              ]
            : [],
        selectedCollectionId: sanitizeUiTextValue(rawPrefs?.selectedCollectionId),
    };
}

export async function loadState() {
    const database = await openDatabase();
    const storedValue = await readStateRecord(database);

    if (storedValue) {
        return sanitizeState(storedValue);
    }

    const legacyState = readLegacyState();

    if (legacyState) {
        const safeState = sanitizeState(legacyState);
        await writeStateRecord(database, safeState);
        clearLegacyState();
        return safeState;
    }

    return createEmptyState();
}

export async function saveState(state) {
    const database = await openDatabase();
    await writeStateRecord(database, sanitizeState(state));
}

export async function replaceState(nextState) {
    const safeState = sanitizeState(nextState);
    await saveState(safeState);
    return safeState;
}

export function loadUiPrefs() {
    try {
        const raw = localStorage.getItem(UI_PREFS_KEY);

        if (!raw) {
            return sanitizeUiPrefs({});
        }

        return sanitizeUiPrefs(JSON.parse(raw));
    } catch (error) {
        console.warn("Failed to load UI preferences.", error);
        return sanitizeUiPrefs({});
    }
}

export function saveUiPrefs(prefs) {
    try {
        localStorage.setItem(UI_PREFS_KEY, JSON.stringify(sanitizeUiPrefs(prefs)));
    } catch (error) {
        console.warn("Failed to save UI preferences.", error);
    }
}

function openDatabase() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === "undefined") {
            reject(new Error("IndexedDB is not available in this browser."));
            return;
        }

        const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

        request.addEventListener("upgradeneeded", () => {
            const database = request.result;

            if (!database.objectStoreNames.contains(STATE_STORE_NAME)) {
                database.createObjectStore(STATE_STORE_NAME, { keyPath: "key" });
            }
        });

        request.addEventListener("success", () => resolve(request.result));
        request.addEventListener("error", () => {
            reject(request.error || new Error("Could not open the IndexedDB database."));
        });
    });
}

function readStateRecord(database) {
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(STATE_STORE_NAME, "readonly");
        const store = transaction.objectStore(STATE_STORE_NAME);
        const request = store.get(STATE_RECORD_KEY);

        request.addEventListener("success", () => {
            resolve(request.result?.value || null);
        });
        request.addEventListener("error", () => {
            reject(request.error || new Error("Could not read saved data from IndexedDB."));
        });
    });
}

function writeStateRecord(database, state) {
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(STATE_STORE_NAME, "readwrite");
        const store = transaction.objectStore(STATE_STORE_NAME);

        transaction.addEventListener("complete", () => resolve());
        transaction.addEventListener("abort", () => {
            reject(transaction.error || new Error("Could not save data to IndexedDB."));
        });
        transaction.addEventListener("error", () => {
            reject(transaction.error || new Error("Could not save data to IndexedDB."));
        });

        store.put({ key: STATE_RECORD_KEY, value: sanitizeState(state) });
    });
}

function readLegacyState() {
    try {
        const raw = localStorage.getItem(LEGACY_STORAGE_KEY);

        if (!raw) {
            return null;
        }

        return JSON.parse(raw);
    } catch (error) {
        console.warn("Failed to read legacy localStorage data.", error);
        return null;
    }
}

function clearLegacyState() {
    try {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch (error) {
        console.warn("Failed to clear legacy localStorage data.", error);
    }
}

function sanitizeIsoDate(value) {
    const text = String(value || "").trim();

    if (!text) {
        return "";
    }

    const timestamp = Date.parse(text);
    return Number.isNaN(timestamp) ? "" : new Date(timestamp).toISOString();
}

function sanitizeStudyMode(value) {
    return ["de-en", "en-de", "image-de", "random"].includes(value) ? value : "de-en";
}

function sanitizeTabName(value) {
    return ["flashcards", "collections", "study", "import-export"].includes(value)
        ? value
        : "flashcards";
}

function sanitizeUiTextValue(value) {
    return String(value || "").trim();
}

function toNonNegativeInteger(value) {
    const number = Number.parseInt(value, 10);
    return Number.isInteger(number) && number > 0 ? number : 0;
}

function toNonNegativeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
}
