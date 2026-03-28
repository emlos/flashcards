export const STUDY_ALL_COLLECTION_ID = "__all__";
export const GERMAN_SPEECH_LANGUAGE = "de-DE";

export const DEFAULT_COLLECTION_COLORS = [
    "#4f46e5",
    "#0891b2",
    "#16a34a",
    "#e11d48",
    "#f59e0b",
    "#7c3aed",
    "#0f766e",
    "#ea580c",
    "#2563eb",
    "#65a30d",
];

export const MAX_IMPORT_ISSUES_TO_DISPLAY = 3;
export const SEARCH_INPUT_DEBOUNCE_MS = 120;
export const MAX_IMAGE_UPLOAD_SOURCE_BYTES = 5 * 1024 * 1024;
export const TARGET_IMAGE_UPLOAD_BYTES = Math.round(1.2 * 1024 * 1024);
export const HARD_IMAGE_UPLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_UPLOAD_DIMENSION = 1600;
export const IMAGE_UPLOAD_QUALITY_STEPS = [0.92, 0.84, 0.76, 0.68, 0.6];

export const PAGINATION_PAGE_SIZES = Object.freeze({
    flashcards: 50,
    collections: 20,
    collectionEditor: 50,
    studyHistory: 10,
    strugglingCards: 10,
    cardStats: 25,
});
