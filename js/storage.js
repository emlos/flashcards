import {
    DEFAULT_SRS_EASE_FACTOR,
    DEFAULT_SRS_NEW_CARDS_PER_DAY,
    MIN_SRS_EASE_FACTOR,
    STUDY_SESSION_TYPES,
} from "./constants.js";

const LEGACY_STORAGE_KEY = "de_en_flashcards_app_v1";
const UI_PREFS_KEY = "de_en_flashcards_ui_prefs_v1";
const DEFAULT_COLLECTION_COLOR = "#64748b";
const DATABASE_NAME = "de_en_flashcards_app";
const DATABASE_VERSION = 2;
const STATE_STORE_NAME = "app_state";
const IMAGE_STORE_NAME = "flashcard_images";
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
        hasImage: Boolean(card?.hasImage || getInlineImageData(card)),
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
                const srsInterval = toNonNegativeInteger(stats?.srsInterval);
                const srsEaseFactor = Math.max(
                    MIN_SRS_EASE_FACTOR,
                    Number.isFinite(Number(stats?.srsEaseFactor))
                        ? Number(stats.srsEaseFactor)
                        : DEFAULT_SRS_EASE_FACTOR,
                );
                const srsDueDate = sanitizeLocalIsoDate(stats?.srsDueDate);

                return [
                    String(cardId),
                    {
                        timesSeen,
                        timesCorrect,
                        lastSeenAt: sanitizeIsoDate(stats?.lastSeenAt),
                        lastCorrectAt: sanitizeIsoDate(stats?.lastCorrectAt),
                        srsInterval,
                        srsEaseFactor: roundToTwoDecimals(srsEaseFactor),
                        srsDueDate,
                    },
                ];
            })
            .filter(([, stats]) => {
                return (
                    stats.timesSeen > 0
                    || stats.timesCorrect > 0
                    || stats.srsInterval > 0
                    || Boolean(stats.srsDueDate)
                    || stats.srsEaseFactor !== DEFAULT_SRS_EASE_FACTOR
                );
            }),
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
        sessionType: sanitizeStudySessionType(entry?.sessionType),
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
        studySessionType: sanitizeStudySessionType(rawPrefs?.studySessionType),
        studyCardLimit: sanitizeUiTextValue(rawPrefs?.studyCardLimit),
        srsNewCardsPerDay: sanitizeUiNumericTextValue(
            rawPrefs?.srsNewCardsPerDay,
            DEFAULT_SRS_NEW_CARDS_PER_DAY,
        ),
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

function sanitizeUiNumericTextValue(value, fallback) {
    const normalized = String(value ?? "").trim();

    if (!normalized) {
        return String(fallback);
    }

    const parsed = Number.parseInt(normalized, 10);
    return Number.isInteger(parsed) && parsed > 0 ? String(parsed) : String(fallback);
}

function sanitizeLocalIsoDate(value) {
    const normalized = String(value || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function roundToTwoDecimals(value) {
    return Math.round(Number(value || 0) * 100) / 100;
}

export async function loadState() {
    const database = await openDatabase();
    const storedValue = await readStateRecord(database);

    if (storedValue) {
        if (stateNeedsImageMigration(storedValue)) {
            await writeCompleteState(database, storedValue, { replaceImages: true });
        }

        const safeState = sanitizeState(storedValue);
        return attachStoredImagesToState(database, safeState);
    }

    const legacyState = readLegacyState();

    if (legacyState) {
        const migratedState = await replaceState(legacyState);
        clearLegacyState();
        return migratedState;
    }

    return createEmptyState();
}

export async function saveState(state) {
    const database = await openDatabase();
    await writeMetadataState(database, state);
}

export async function replaceState(nextState) {
    const database = await openDatabase();
    await writeCompleteState(database, nextState, { replaceImages: true });
    return attachStoredImagesToState(database, sanitizeState(nextState));
}

export async function resetStoredAppData() {
    const emptyState = createEmptyState();
    const database = await openDatabase();
    await writeCompleteState(database, emptyState, { replaceImages: true });
    clearUiPrefs();
    clearLegacyState();
    return emptyState;
}

export async function saveFlashcardImage(cardId, imageSource) {
    const blob = await imageSourceToBlob(imageSource);
    const database = await openDatabase();

    await upsertImageRecord(database, String(cardId), blob);

    return URL.createObjectURL(blob);
}

export async function createExportState(state) {
    const database = await openDatabase();
    const safeState = sanitizeState(state);
    const imageDataUrlsByCardId = await readImageDataUrlsByCardId(
        database,
        safeState.flashcards.map((card) => card.id),
    );

    return {
        ...safeState,
        flashcards: safeState.flashcards.map((card) => ({
            ...card,
            imageData:
                imageDataUrlsByCardId.get(card.id) ||
                (isInlineDataUrl(card?.imageData) ? card.imageData : ""),
        })),
    };
}

export function releaseStateImageObjectUrls(state) {
    if (!Array.isArray(state?.flashcards)) {
        return;
    }

    state.flashcards.forEach((card) => {
        if (isBlobUrl(card?.imageData)) {
            URL.revokeObjectURL(card.imageData);
            card.imageData = "";
        }
    });
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

export function clearUiPrefs() {
    try {
        localStorage.removeItem(UI_PREFS_KEY);
    } catch (error) {
        console.warn("Failed to clear UI preferences.", error);
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

            if (!database.objectStoreNames.contains(IMAGE_STORE_NAME)) {
                database.createObjectStore(IMAGE_STORE_NAME, { keyPath: "cardId" });
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

function writeMetadataState(database, rawState) {
    const safeState = sanitizeState(rawState);
    const inlineImages = collectInlineImagesByCardId(rawState, safeState);

    return new Promise((resolve, reject) => {
        const transaction = database.transaction([STATE_STORE_NAME, IMAGE_STORE_NAME], "readwrite");
        const stateStore = transaction.objectStore(STATE_STORE_NAME);
        const imageStore = transaction.objectStore(IMAGE_STORE_NAME);
        const desiredImageIds = new Set(
            safeState.flashcards.filter((card) => card.hasImage).map((card) => card.id),
        );

        transaction.addEventListener("complete", () => resolve());
        transaction.addEventListener("abort", () => {
            reject(transaction.error || new Error("Could not save data to IndexedDB."));
        });
        transaction.addEventListener("error", () => {
            reject(transaction.error || new Error("Could not save data to IndexedDB."));
        });

        stateStore.put({ key: STATE_RECORD_KEY, value: safeState });

        inlineImages.forEach((imageBlob, cardId) => {
            imageStore.put({
                cardId,
                blob: imageBlob,
            });
        });

        const keysRequest = imageStore.getAllKeys();

        keysRequest.addEventListener("success", () => {
            (keysRequest.result || []).forEach((cardId) => {
                if (!desiredImageIds.has(String(cardId))) {
                    imageStore.delete(cardId);
                }
            });
        });
    });
}

function writeCompleteState(database, rawState, { replaceImages = false } = {}) {
    const safeState = sanitizeState(rawState);
    const inlineImages = collectInlineImagesByCardId(rawState, safeState);

    return new Promise((resolve, reject) => {
        const transaction = database.transaction([STATE_STORE_NAME, IMAGE_STORE_NAME], "readwrite");
        const stateStore = transaction.objectStore(STATE_STORE_NAME);
        const imageStore = transaction.objectStore(IMAGE_STORE_NAME);

        transaction.addEventListener("complete", () => resolve());
        transaction.addEventListener("abort", () => {
            reject(transaction.error || new Error("Could not save data to IndexedDB."));
        });
        transaction.addEventListener("error", () => {
            reject(transaction.error || new Error("Could not save data to IndexedDB."));
        });

        stateStore.put({ key: STATE_RECORD_KEY, value: safeState });

        if (replaceImages) {
            imageStore.clear();
        }

        inlineImages.forEach((imageBlob, cardId) => {
            imageStore.put({
                cardId,
                blob: imageBlob,
            });
        });
    });
}

function upsertImageRecord(database, cardId, blob) {
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(IMAGE_STORE_NAME, "readwrite");
        const store = transaction.objectStore(IMAGE_STORE_NAME);

        transaction.addEventListener("complete", () => resolve());
        transaction.addEventListener("abort", () => {
            reject(transaction.error || new Error("Could not save the flashcard image."));
        });
        transaction.addEventListener("error", () => {
            reject(transaction.error || new Error("Could not save the flashcard image."));
        });

        store.put({ cardId, blob });
    });
}

function attachStoredImagesToState(database, state) {
    const cardIds = state.flashcards.map((card) => card.id);

    if (cardIds.length === 0) {
        return Promise.resolve(state);
    }

    return new Promise((resolve, reject) => {
        const transaction = database.transaction(IMAGE_STORE_NAME, "readonly");
        const store = transaction.objectStore(IMAGE_STORE_NAME);
        const imageUrlsByCardId = new Map();
        let remaining = cardIds.length;
        let settled = false;

        const maybeResolve = () => {
            if (!settled && remaining === 0) {
                settled = true;
                resolve({
                    ...state,
                    flashcards: state.flashcards.map((card) => ({
                        ...card,
                        hasImage: imageUrlsByCardId.has(card.id) || Boolean(card.hasImage),
                        imageData: imageUrlsByCardId.get(card.id) || "",
                    })),
                });
            }
        };

        cardIds.forEach((cardId) => {
            const request = store.get(cardId);

            request.addEventListener("success", () => {
                const record = request.result;

                if (record?.blob instanceof Blob) {
                    imageUrlsByCardId.set(cardId, URL.createObjectURL(record.blob));
                }

                remaining -= 1;
                maybeResolve();
            });

            request.addEventListener("error", () => {
                if (!settled) {
                    settled = true;
                    reject(request.error || new Error("Could not read flashcard images from IndexedDB."));
                }
            });
        });
    });
}

function readImageDataUrlsByCardId(database, cardIds) {
    if (!Array.isArray(cardIds) || cardIds.length === 0) {
        return Promise.resolve(new Map());
    }

    return new Promise((resolve, reject) => {
        const transaction = database.transaction(IMAGE_STORE_NAME, "readonly");
        const store = transaction.objectStore(IMAGE_STORE_NAME);
        const result = new Map();
        let remaining = cardIds.length;
        let settled = false;

        const maybeResolve = () => {
            if (!settled && remaining === 0) {
                settled = true;
                resolve(result);
            }
        };

        cardIds.forEach((cardId) => {
            const request = store.get(cardId);

            request.addEventListener("success", async () => {
                try {
                    const record = request.result;

                    if (record?.blob instanceof Blob) {
                        result.set(cardId, await blobToDataUrl(record.blob));
                    }

                    remaining -= 1;
                    maybeResolve();
                } catch (error) {
                    if (!settled) {
                        settled = true;
                        reject(error);
                    }
                }
            });

            request.addEventListener("error", () => {
                if (!settled) {
                    settled = true;
                    reject(request.error || new Error("Could not read flashcard images from IndexedDB."));
                }
            });
        });
    });
}

function isBlobUrl(value) {
    return String(value || "").startsWith("blob:");
}

function collectInlineImagesByCardId(rawState, safeState) {
    const sanitizedCardIds = safeState.flashcards.map((card) => card.id);
    const imagesByCardId = new Map();

    (Array.isArray(rawState?.flashcards) ? rawState.flashcards : []).forEach((card, index) => {
        const cardId = sanitizedCardIds[index];

        if (!cardId) {
            return;
        }

        const inlineImageData = getInlineImageData(card);

        if (!inlineImageData) {
            return;
        }

        imagesByCardId.set(cardId, dataUrlToBlob(inlineImageData));
    });

    return imagesByCardId;
}

function stateNeedsImageMigration(rawState) {
    return Boolean(
        Array.isArray(rawState?.flashcards) &&
            rawState.flashcards.some(
                (card) => getInlineImageData(card) || typeof card?.hasImage !== "boolean",
            ),
    );
}

function getInlineImageData(card) {
    return isInlineDataUrl(card?.imageData) ? card.imageData : "";
}

function isInlineDataUrl(value) {
    return /^data:/i.test(String(value || ""));
}

function imageSourceToBlob(imageSource) {
    if (imageSource instanceof Blob) {
        return Promise.resolve(imageSource);
    }

    if (isInlineDataUrl(imageSource)) {
        return Promise.resolve(dataUrlToBlob(imageSource));
    }

    return Promise.reject(new Error("Unsupported flashcard image format."));
}

function dataUrlToBlob(dataUrl) {
    const [header, payload = ""] = String(dataUrl || "").split(",", 2);
    const mimeMatch = /^data:([^;]+);base64$/i.exec(header || "");
    const mimeType = mimeMatch?.[1] || "application/octet-stream";
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }

    return new Blob([bytes], { type: mimeType });
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Could not read image data for export."));
        reader.readAsDataURL(blob);
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
    return ["de-en", "en-de", "image-de", "mc-de-en", "random"].includes(value)
        ? value
        : "de-en";
}

function sanitizeStudySessionType(value) {
    return value === STUDY_SESSION_TYPES.srs ? STUDY_SESSION_TYPES.srs : STUDY_SESSION_TYPES.free;
}

function sanitizeTabName(value) {
    return ["flashcards", "collections", "study", "stats", "import-export"].includes(value)
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
