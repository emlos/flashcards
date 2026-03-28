import {
    createEmptyState,
    loadState,
    saveState,
    replaceState,
    resetStoredAppData,
    saveFlashcardImage,
    createExportState,
    releaseStateImageObjectUrls,
    loadUiPrefs,
    saveUiPrefs,
} from "./storage.js";
import { parseBulkWords, exportBackupText, parseBackupText } from "./import-export.js";
import {
    createStudySession,
    getCurrentPrompt,
    submitStudyAnswer,
    advanceSession,
    isSessionFinished,
} from "./study-mode.js";

const STUDY_ALL_COLLECTION_ID = "__all__";

const DEFAULT_COLLECTION_COLORS = [
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

let state = createEmptyState();
let uiPrefs = loadUiPrefs();
let selectedCollectionId = uiPrefs.selectedCollectionId || null;
let studySession = null;
let flashcardSearchTerm = "";
let collectionEditorSearchTerm = "";
let collectionEditorMembershipFilter = "all";
let collectionEditorFilterCollectionId = "";
let editingFlashcardId = null;
let selectedStudyCollectionIds = new Set(
    uiPrefs.selectedStudyCollectionIds.length > 0
        ? uiPrefs.selectedStudyCollectionIds
        : [STUDY_ALL_COLLECTION_ID],
);
const selectedFlashcardIds = new Set();
const MAX_IMPORT_ISSUES_TO_DISPLAY = 3;
const SEARCH_INPUT_DEBOUNCE_MS = 120;
const MAX_IMAGE_UPLOAD_SOURCE_BYTES = 15 * 1024 * 1024;
const TARGET_IMAGE_UPLOAD_BYTES = Math.round(1.2 * 1024 * 1024);
const HARD_IMAGE_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_UPLOAD_DIMENSION = 1600;
const IMAGE_UPLOAD_QUALITY_STEPS = [0.92, 0.84, 0.76, 0.68, 0.6];
let persistQueue = Promise.resolve(false);
let flashcardRenderDebounceId = 0;
let collectionEditorRenderDebounceId = 0;
let pendingBackupImportResolver = null;
let lastFocusedElementBeforeBackupImportModal = null;

const elements = {
    appStatusMessage: document.getElementById("app-status-message"),
    tabButtons: Array.from(document.querySelectorAll(".tab-button")),
    tabPanels: Array.from(document.querySelectorAll(".tab-panel")),

    flashcardForm: document.getElementById("flashcard-form"),
    flashcardGerman: document.getElementById("flashcard-german"),
    flashcardEnglish: document.getElementById("flashcard-english"),
    flashcardImage: document.getElementById("flashcard-image"),
    flashcardSearch: document.getElementById("flashcard-search"),
    flashcardSelectVisible: document.getElementById("flashcard-select-visible"),
    flashcardClearSelection: document.getElementById("flashcard-clear-selection"),
    flashcardDeleteSelected: document.getElementById("flashcard-delete-selected"),
    flashcardSelectionSummary: document.getElementById("flashcard-selection-summary"),
    flashcardsList: document.getElementById("flashcards-list"),
    flashcardsEmpty: document.getElementById("flashcards-empty"),
    flashcardCount: document.getElementById("flashcard-count"),

    collectionForm: document.getElementById("collection-form"),
    collectionName: document.getElementById("collection-name"),
    collectionColor: document.getElementById("collection-color"),
    collectionsList: document.getElementById("collections-list"),
    collectionsEmpty: document.getElementById("collections-empty"),
    collectionCount: document.getElementById("collection-count"),
    selectedCollectionName: document.getElementById("selected-collection-name"),
    collectionEditor: document.getElementById("collection-editor"),
    collectionEditorEmpty: document.getElementById("collection-editor-empty"),
    collectionSearch: document.getElementById("collection-search"),
    collectionMembershipFilter: document.getElementById("collection-membership-filter"),
    collectionFilterCollection: document.getElementById("collection-filter-collection"),
    collectionFlashcardForm: document.getElementById("collection-flashcard-form"),
    collectionFlashcardGerman: document.getElementById("collection-flashcard-german"),
    collectionFlashcardEnglish: document.getElementById("collection-flashcard-english"),
    collectionFlashcardImage: document.getElementById("collection-flashcard-image"),
    collectionEditorSummary: document.getElementById("collection-editor-summary"),
    collectionCardsEditor: document.getElementById("collection-cards-editor"),

    studySetupForm: document.getElementById("study-setup-form"),
    studyCollectionSummary: document.getElementById("study-collection-summary"),
    studyCollectionOptions: document.getElementById("study-collection-options"),
    studyMode: document.getElementById("study-mode"),
    studyCardLimit: document.getElementById("study-card-limit"),
    studySetupMessage: document.getElementById("study-setup-message"),
    studySessionBox: document.getElementById("study-session"),
    studyResultsBox: document.getElementById("study-results"),
    studyProgress: document.getElementById("study-progress"),
    studyPrompt: document.getElementById("study-prompt"),
    studyImageWrapper: document.getElementById("study-image-wrapper"),
    studyImage: document.getElementById("study-image"),
    studyAnswerForm: document.getElementById("study-answer-form"),
    studyAnswer: document.getElementById("study-answer"),
    studyCheckButton: document.getElementById("study-check-button"),
    studyGermanCharacters: document.getElementById("study-german-characters"),
    studyFeedback: document.getElementById("study-feedback"),
    studyFeedbackNote: document.getElementById("study-feedback-note"),
    studyNextButton: document.getElementById("study-next-button"),
    studyEndButton: document.getElementById("study-end-button"),
    studyResultText: document.getElementById("study-result-text"),
    studyResetButton: document.getElementById("study-reset-button"),
    studyHistorySummary: document.getElementById("study-history-summary"),
    studyHistoryList: document.getElementById("study-history-list"),
    strugglingCardsSummary: document.getElementById("struggling-cards-summary"),
    strugglingCardsList: document.getElementById("struggling-cards-list"),
    cardStatsSummary: document.getElementById("card-stats-summary"),
    cardStatsList: document.getElementById("card-stats-list"),

    bulkImportFile: document.getElementById("bulk-import-file"),
    bulkImportButton: document.getElementById("bulk-import-button"),
    backupImportFile: document.getElementById("backup-import-file"),
    backupImportButton: document.getElementById("backup-import-button"),
    exportButton: document.getElementById("export-button"),
    deleteAllButton: document.getElementById("delete-all-button"),
    importExportMessage: document.getElementById("import-export-message"),
    backupImportModal: document.getElementById("backup-import-modal"),
    backupImportModalSummary: document.getElementById("backup-import-modal-summary"),
    backupImportModalWarnings: document.getElementById("backup-import-modal-warnings"),
    backupImportMergeButton: document.getElementById("backup-import-merge-button"),
    backupImportReplaceButton: document.getElementById("backup-import-replace-button"),
    backupImportCancelButton: document.getElementById("backup-import-cancel-button"),
};

applyUiPrefsToControls();
bindEvents();
setCollectionColorInputDefault();
void initApp();

async function initApp() {
    try {
        replaceAppState(await loadState());
        clearAppStatusMessage();
    } catch (error) {
        console.error("Failed to load app data.", error);
        replaceAppState(createEmptyState());
        showAppStatusMessage(
            "Could not load your saved data from IndexedDB. The app is running with an empty in-memory state until storage works again.",
            false,
        );
    }

    sanitizeStudyCollectionSelection();
    const validSelectedCollectionId = getValidSelectedCollectionId(selectedCollectionId);
    if (validSelectedCollectionId !== selectedCollectionId) {
        selectedCollectionId = validSelectedCollectionId;
        updateUiPrefs({ selectedCollectionId: selectedCollectionId || "" });
    } else {
        selectedCollectionId = validSelectedCollectionId;
    }
    updateUiPrefs({
        selectedCollectionId: selectedCollectionId || "",
        selectedStudyCollectionIds: [...selectedStudyCollectionIds],
    });
    applyUiPrefsToControls();
    renderAll();
    switchTab(uiPrefs.activeTab || "flashcards");
}

function replaceAppState(nextState) {
    if (state && state !== nextState) {
        releaseStateImageObjectUrls(state);
    }

    state = nextState;
}

function onAppPageHide(event) {
    if (!event.persisted) {
        releaseStateImageObjectUrls(state);
    }
}

function bindEvents() {
    elements.tabButtons.forEach((button) => {
        button.addEventListener("click", () => switchTab(button.dataset.tab));
    });

    elements.flashcardForm.addEventListener("submit", onFlashcardSubmit);
    elements.flashcardSearch.addEventListener("input", onFlashcardSearchInput);
    elements.flashcardSelectVisible.addEventListener("click", onSelectVisibleFlashcards);
    elements.flashcardClearSelection.addEventListener("click", onClearFlashcardSelection);
    elements.flashcardDeleteSelected.addEventListener("click", onDeleteSelectedFlashcards);

    elements.collectionForm.addEventListener("submit", onCollectionSubmit);
    elements.collectionSearch.addEventListener("input", onCollectionSearchInput);
    elements.collectionMembershipFilter.addEventListener("change", onCollectionFilterChange);
    elements.collectionFilterCollection.addEventListener("change", onCollectionFilterChange);
    elements.collectionFlashcardForm.addEventListener("submit", onCollectionFlashcardSubmit);

    elements.studySetupForm.addEventListener("submit", onStudySetupSubmit);
    elements.studyCollectionOptions.addEventListener("change", onStudyCollectionOptionsChange);
    elements.studyMode.addEventListener("change", onStudyPreferencesChange);
    elements.studyCardLimit.addEventListener("input", onStudyPreferencesChange);
    elements.studyAnswerForm.addEventListener("submit", onStudyAnswerSubmit);
    elements.studyGermanCharacters.addEventListener("click", onStudyGermanCharacterClick);
    elements.studyNextButton.addEventListener("click", onStudyNext);
    elements.studyEndButton.addEventListener("click", endStudySession);
    elements.backupImportMergeButton.addEventListener("click", () =>
        closeBackupImportModal("merge"),
    );
    elements.backupImportReplaceButton.addEventListener("click", () =>
        closeBackupImportModal("replace"),
    );
    elements.backupImportCancelButton.addEventListener("click", () => closeBackupImportModal(null));
    elements.backupImportModal.addEventListener("click", onBackupImportModalClick);
    elements.backupImportModal.addEventListener("keydown", onBackupImportModalKeyDown);
    elements.studyResetButton.addEventListener("click", resetStudyView);

    elements.bulkImportButton.addEventListener("click", onBulkImport);
    elements.backupImportButton.addEventListener("click", onBackupImport);
    elements.exportButton.addEventListener("click", onExport);
    elements.deleteAllButton.addEventListener("click", onDeleteAll);
    window.addEventListener("pagehide", onAppPageHide);
}

function switchTab(tabName) {
    const nextTab = tabName || "flashcards";

    elements.tabButtons.forEach((button) => {
        button.classList.toggle("active", button.dataset.tab === nextTab);
    });

    elements.tabPanels.forEach((panel) => {
        panel.classList.toggle("active", panel.id === `tab-${nextTab}`);
    });

    updateUiPrefs({ activeTab: nextTab });
}

function debounceRender(timeoutId, callback) {
    if (timeoutId) {
        window.clearTimeout(timeoutId);
    }

    return window.setTimeout(() => {
        callback();
    }, SEARCH_INPUT_DEBOUNCE_MS);
}

function scheduleFlashcardRender() {
    flashcardRenderDebounceId = debounceRender(flashcardRenderDebounceId, () => {
        flashcardRenderDebounceId = 0;
        renderFlashcards();
    });
}

function scheduleCollectionEditorRender() {
    collectionEditorRenderDebounceId = debounceRender(collectionEditorRenderDebounceId, () => {
        collectionEditorRenderDebounceId = 0;
        renderCollectionEditor();
    });
}

function onStudyPreferencesChange() {
    updateUiPrefs({
        studyMode: elements.studyMode.value,
        studyCardLimit: elements.studyCardLimit.value.trim(),
    });
}

async function onFlashcardSubmit(event) {
    event.preventDefault();

    const german = elements.flashcardGerman.value.trim();
    const englishAnswers = parseEnglishAnswersInput(elements.flashcardEnglish.value);
    const imageFile = elements.flashcardImage.files[0];

    if (!german || englishAnswers.length === 0) {
        return;
    }

    const existingCard = findExistingFlashcardByGerman(german);
    let successMessage = "";

    try {
        if (existingCard) {
            const { merged, added } = mergeEnglishAnswers(
                existingCard.englishAnswers,
                englishAnswers,
            );
            let imageUpdate = null;

            if (imageFile) {
                imageUpdate = await applyUploadedImageToCard(existingCard, imageFile);
            }

            existingCard.englishAnswers = merged;

            console.info(
                `[Manual add] Reused existing card "${existingCard.german}". Added meanings: ${
                    added.length > 0 ? added.join(", ") : "none"
                }.` +
                    `${imageUpdate?.replacedExisting ? " Replaced image." : imageUpdate ? " Added image." : ""}`,
            );

            successMessage = buildFlashcardSaveMessage({
                german: existingCard.german,
                addedMeanings: added,
                imageUpdate,
                reusedExistingCard: true,
            });
        } else {
            const card = {
                id: crypto.randomUUID(),
                german,
                englishAnswers,
                imageData: "",
                hasImage: false,
            };

            state.flashcards.push(card);

            let imageUpdate = null;

            try {
                if (imageFile) {
                    imageUpdate = await applyUploadedImageToCard(card, imageFile);
                }
            } catch (error) {
                state.flashcards = state.flashcards.filter((item) => item.id !== card.id);
                throw error;
            }

            successMessage = buildFlashcardSaveMessage({
                german: card.german,
                imageUpdate,
                reusedExistingCard: false,
            });
        }

        const didPersist = await persist();

        if (didPersist && successMessage) {
            showAppStatusMessage(successMessage, true);
        }

        elements.flashcardForm.reset();
        renderAll();
    } catch (error) {
        console.error("Failed to save the flashcard.", error);
        showAppStatusMessage(error?.message || "Could not process that image upload.", false);
    }
}

function onFlashcardSearchInput(event) {
    flashcardSearchTerm = event.target.value;
    scheduleFlashcardRender();
}

function onSelectVisibleFlashcards() {
    getFilteredFlashcards().forEach((card) => {
        selectedFlashcardIds.add(card.id);
    });
    renderFlashcards();
}

function onClearFlashcardSelection() {
    selectedFlashcardIds.clear();
    renderFlashcards();
}

function onDeleteSelectedFlashcards() {
    const idsToDelete = state.flashcards
        .filter((card) => selectedFlashcardIds.has(card.id))
        .map((card) => card.id);

    if (idsToDelete.length === 0) {
        return;
    }

    const confirmed = window.confirm(
        `Delete ${idsToDelete.length} selected flashcard(s)? This also removes them from all collections.`,
    );

    if (!confirmed) {
        return;
    }

    deleteFlashcards(idsToDelete);
}

async function onCollectionSubmit(event) {
    event.preventDefault();

    const name = elements.collectionName.value.trim();
    if (!name) {
        return;
    }

    const { collection } = getOrCreateCollectionByName(name, elements.collectionColor.value);
    selectedCollectionId = collection.id;
    updateUiPrefs({ selectedCollectionId: selectedCollectionId || "" });

    await persist();
    elements.collectionForm.reset();
    setCollectionColorInputDefault();
    renderAll();
}

function onCollectionSearchInput(event) {
    collectionEditorSearchTerm = event.target.value;
    scheduleCollectionEditorRender();
}

function onCollectionFilterChange() {
    collectionEditorMembershipFilter = elements.collectionMembershipFilter.value;
    collectionEditorFilterCollectionId = elements.collectionFilterCollection.value;
    renderCollectionEditor();
}

async function onCollectionFlashcardSubmit(event) {
    event.preventDefault();

    const collection = state.collections.find((item) => item.id === selectedCollectionId);
    if (!collection) {
        return;
    }

    const german = elements.collectionFlashcardGerman.value.trim();
    const englishAnswers = parseEnglishAnswersInput(elements.collectionFlashcardEnglish.value);
    const imageFile = elements.collectionFlashcardImage.files[0];

    if (!german || englishAnswers.length === 0) {
        return;
    }

    let card = findExistingFlashcardByGerman(german);
    let successMessage = "";

    try {
        if (card) {
            const { merged, added } = mergeEnglishAnswers(card.englishAnswers, englishAnswers);
            let imageUpdate = null;

            if (imageFile) {
                imageUpdate = await applyUploadedImageToCard(card, imageFile);
            }

            card.englishAnswers = merged;

            if (added.length > 0 || !collection.cardIds.includes(card.id) || imageUpdate) {
                console.info(
                    `[Collection add] Reused existing card "${card.german}" in "${collection.name}". Added meanings: ${
                        added.length > 0 ? added.join(", ") : "none"
                    }.` +
                        `${imageUpdate?.replacedExisting ? " Replaced image." : imageUpdate ? " Added image." : ""}`,
                );
            }

            ensureCardInCollection(collection.id, card.id);
            successMessage = buildCollectionFlashcardSaveMessage({
                card,
                collectionName: collection.name,
                addedMeanings: added,
                imageUpdate,
                addedToCollection: true,
                reusedExistingCard: true,
            });
        } else {
            card = {
                id: crypto.randomUUID(),
                german,
                englishAnswers,
                imageData: "",
                hasImage: false,
            };
            state.flashcards.push(card);

            let imageUpdate = null;

            try {
                if (imageFile) {
                    imageUpdate = await applyUploadedImageToCard(card, imageFile);
                }
            } catch (error) {
                state.flashcards = state.flashcards.filter((item) => item.id !== card.id);
                throw error;
            }

            ensureCardInCollection(collection.id, card.id);
            successMessage = buildCollectionFlashcardSaveMessage({
                card,
                collectionName: collection.name,
                imageUpdate,
                addedToCollection: true,
                reusedExistingCard: false,
            });
        }

        const didPersist = await persist();

        if (didPersist && successMessage) {
            showAppStatusMessage(successMessage, true);
        }

        elements.collectionFlashcardForm.reset();
        renderAll();
    } catch (error) {
        console.error("Failed to save the collection flashcard.", error);
        showAppStatusMessage(error?.message || "Could not process that image upload.", false);
    }
}

function onStudySetupSubmit(event) {
    event.preventDefault();

    const mode = elements.studyMode.value;
    const cardLimit = parseStudyCardLimit(elements.studyCardLimit.value);

    updateUiPrefs({
        studyMode: mode,
        studyCardLimit: elements.studyCardLimit.value.trim(),
        selectedStudyCollectionIds: [...selectedStudyCollectionIds],
    });

    if (Number.isNaN(cardLimit)) {
        showStudySetupMessage(
            "Enter a whole number greater than 0 for the card limit, or leave it blank.",
        );
        return;
    }

    let cards = getStudyCardsForSelection();
    const selectedCardCount = cards.length;
    let skippedCardsWithoutImages = 0;

    if (mode === "image-de") {
        cards = cards.filter((card) => card.hasImage);
        skippedCardsWithoutImages = selectedCardCount - cards.length;
    }

    const studyableCardCount = cardLimit && cardLimit < cards.length ? cardLimit : cards.length;

    if (cards.length === 0) {
        showStudySetupMessage(
            getStudyImageModeMessage({
                selectedCardCount,
                skippedCardsWithoutImages,
                remainingCardsCount: cards.length,
            }) || getStudySelectionEmptyMessage(mode === "image-de"),
        );
        return;
    }

    showStudySetupMessage(
        getStudyImageModeMessage({
            selectedCardCount,
            skippedCardsWithoutImages,
            remainingCardsCount: studyableCardCount,
        }),
    );
    studySession = createStudySession(cards, mode);
    studySession.collectionIds = [...selectedStudyCollectionIds];
    studySession.collectionLabel = getStudyCollectionSummaryText();
    studySession.startedAt = new Date().toISOString();
    studySession.answeredCount = 0;
    studySession.historyRecorded = false;

    if (cardLimit && cardLimit < studySession.cards.length) {
        studySession.cards = studySession.cards.slice(0, cardLimit);
    }

    elements.studyResultsBox.classList.add("hidden");
    elements.studySessionBox.classList.remove("hidden");
    renderStudyQuestion();
}

async function onStudyAnswerSubmit(event) {
    event.preventDefault();

    if (!studySession) {
        return;
    }

    if (studySession.answered) {
        onStudyNext();
        return;
    }

    const currentCard = studySession.cards[studySession.currentIndex] || null;
    const result = submitStudyAnswer(studySession, elements.studyAnswer.value);

    if (!result) {
        return;
    }

    if (currentCard) {
        recordCardStudyResult(currentCard.id, result);
    }

    studySession.answeredCount = (studySession.answeredCount || 0) + 1;

    elements.studyFeedback.textContent = result.message;
    elements.studyFeedbackNote.textContent = result.note;
    elements.studyFeedback.className = `study-feedback ${result.feedbackClass}`;
    elements.studyAnswer.disabled = true;
    elements.studyCheckButton.disabled = true;
    elements.studyAnswerForm.classList.add("study-answer-form-complete");
    elements.studyNextButton.classList.remove("hidden");
    elements.studyNextButton.focus();

    await persist();
    renderStudyLiveInsights();
}

function onStudyNext() {
    if (!studySession) {
        return;
    }

    advanceSession(studySession);

    if (isSessionFinished(studySession)) {
        showStudyResults();
        return;
    }

    renderStudyQuestion();
}

function endStudySession() {
    if (!studySession) {
        resetStudyView();
        return;
    }

    showStudyResults();
}

function resetStudyView() {
    studySession = null;
    elements.studySessionBox.classList.add("hidden");
    elements.studyResultsBox.classList.add("hidden");
    elements.studyFeedback.textContent = "";
    elements.studyFeedbackNote.textContent = "";
    elements.studyFeedback.className = "study-feedback";
    elements.studyAnswerForm.reset();
    elements.studyAnswer.disabled = false;
    elements.studyCheckButton.disabled = false;
    elements.studyAnswerForm.classList.remove("study-answer-form-complete");
    elements.studyNextButton.classList.add("hidden");
    elements.studyImageWrapper.classList.add("hidden");
    elements.studyGermanCharacters.classList.add("hidden");
}

async function onBulkImport() {
    const file = elements.bulkImportFile.files[0];

    if (!file) {
        showImportExportMessage("Choose a bulk-import TXT file first.", false);
        return;
    }

    try {
        const text = await file.text();
        const { entries, issues } = parseBulkWords(text);

        if (entries.length === 0) {
            if (issues.length > 0) {
                logImportIssues("Bulk import", issues);
            }

            showImportExportMessage(
                issues.length > 0
                    ? `No flashcards were imported. ${formatImportIssuesSummary(issues)}`
                    : "No valid flashcards were found in that file.",
                false,
            );
            return;
        }

        const importResult = await applyImportedFlashcardEntries(entries, {
            logLabel: "Bulk import",
        });

        await persist();
        finalizeImportState();

        if (issues.length > 0) {
            logImportIssues("Bulk import", issues);
        }

        showImportExportMessage(
            [
                `Imported ${entries.length} valid line(s). Created ${importResult.createdCardsCount} new flashcard(s), reused ${importResult.reusedCardsCount} duplicate(s), created ${importResult.createdCollectionsCount} new collection(s).`,
                issues.length > 0 ? formatImportIssuesSummary(issues) : "",
            ]
                .filter(Boolean)
                .join(" "),
            true,
        );

        elements.bulkImportFile.value = "";
    } catch (error) {
        showImportExportMessage(error.message || "Bulk import failed.", false);
    }
}

async function onBackupImport() {
    const file = elements.backupImportFile.files[0];

    if (!file) {
        showImportExportMessage("Choose a backup TXT file first.", false);
        return;
    }

    try {
        const text = await file.text();
        const { state: importedState, issues } = parseBackupText(text);
        const importMode = await chooseBackupImportMode(importedState, issues);

        if (!importMode) {
            showImportExportMessage("Backup import cancelled.", false);
            return;
        }

        if (importMode === "replace") {
            replaceAppState(await replaceState(importedState));
            finalizeImportState({ resetStudySelection: true, resetSelectedCollection: true });
        } else {
            const mergeResult = await mergeBackupStateIntoCurrentState(importedState);
            await persist();
            finalizeImportState();

            showImportExportMessage(
                [
                    `Backup merged successfully. Created ${mergeResult.createdCardsCount} new flashcard(s), reused ${mergeResult.reusedCardsCount} duplicate(s), created ${mergeResult.createdCollectionsCount} new collection(s), merged ${mergeResult.mergedSessionCount} session(s), and merged stats for ${mergeResult.mergedCardStatsCount} card(s).`,
                    issues.length > 0 ? formatImportIssuesSummary(issues) : "",
                ]
                    .filter(Boolean)
                    .join(" "),
                true,
            );

            if (issues.length > 0) {
                logImportIssues("Backup import", issues);
            }

            elements.backupImportFile.value = "";
            return;
        }

        if (issues.length > 0) {
            logImportIssues("Backup import", issues);
        }

        showImportExportMessage(
            [
                "Backup replaced your current data successfully.",
                issues.length > 0 ? formatImportIssuesSummary(issues) : "",
            ]
                .filter(Boolean)
                .join(" "),
            true,
        );
        elements.backupImportFile.value = "";
    } catch (error) {
        showImportExportMessage(error.message || "Backup import failed.", false);
    }
}

async function onExport() {
    try {
        const content = exportBackupText(await createExportState(state));
        downloadTextFile(content, "flashcards-backup.txt");
        showImportExportMessage("Export created.", true);
    } catch (error) {
        showImportExportMessage(error.message || "Export failed.", false);
    }
}

async function onDeleteAll() {
    const confirmed = window.confirm(
        "Delete all flashcards, collections, images, study progress, session history, and saved preferences? This cannot be undone.",
    );

    if (!confirmed) {
        showImportExportMessage("Delete All cancelled.", false);
        return;
    }

    try {
        await persistQueue.catch(() => false);
        replaceAppState(await resetStoredAppData());
        persistQueue = Promise.resolve(true);
        uiPrefs = loadUiPrefs();
        selectedCollectionId = null;
        selectedStudyCollectionIds = new Set([STUDY_ALL_COLLECTION_ID]);
        flashcardSearchTerm = "";
        collectionEditorSearchTerm = "";
        collectionEditorMembershipFilter = "all";
        collectionEditorFilterCollectionId = "";
        editingFlashcardId = null;
        selectedFlashcardIds.clear();
        clearAppStatusMessage();

        elements.flashcardForm.reset();
        elements.collectionForm.reset();
        elements.collectionFlashcardForm.reset();
        elements.bulkImportFile.value = "";
        elements.backupImportFile.value = "";
        elements.flashcardSearch.value = "";
        elements.collectionSearch.value = "";
        elements.collectionMembershipFilter.value = "all";
        elements.collectionFilterCollection.value = "";

        applyUiPrefsToControls();
        finalizeImportState({ resetStudySelection: true, resetSelectedCollection: true });
        showImportExportMessage("Everything was deleted and the app was reset.", true);
    } catch (error) {
        console.error("Failed to delete all app data.", error);
        showImportExportMessage(error.message || "Could not delete all app data.", false);
    }
}

function renderAll() {
    pruneSelectedFlashcardIds();
    renderFlashcards();
    renderCollections();
    renderCollectionEditor();
    renderStudySetup();
    renderStudyInsights();
}

function renderFlashcards() {
    const filteredCards = getFilteredFlashcards();
    const selectedCount = state.flashcards.filter((card) =>
        selectedFlashcardIds.has(card.id),
    ).length;

    elements.flashcardCount.textContent = `${filteredCards.length} shown / ${state.flashcards.length} total`;
    elements.flashcardSelectionSummary.textContent = `${selectedCount} selected`;
    elements.flashcardsEmpty.classList.toggle("hidden", filteredCards.length > 0);
    elements.flashcardsEmpty.textContent =
        state.flashcards.length === 0 ? "No flashcards yet." : "No flashcards match your search.";
    elements.flashcardsList.innerHTML = "";

    elements.flashcardSelectVisible.disabled = filteredCards.length === 0;
    elements.flashcardClearSelection.disabled = selectedCount === 0;
    elements.flashcardDeleteSelected.disabled = selectedCount === 0;

    filteredCards.forEach((card) => {
        const row = document.createElement("div");
        row.className = "item-row selectable-row";

        const left = document.createElement("div");
        left.className = "selection-cell";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = selectedFlashcardIds.has(card.id);
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) {
                selectedFlashcardIds.add(card.id);
            } else {
                selectedFlashcardIds.delete(card.id);
            }
            renderFlashcards();
        });
        left.appendChild(checkbox);

        const main = document.createElement("div");
        main.className = "item-row-main";
        main.innerHTML = `
      <div class="item-title">${escapeHtml(card.german)} — ${escapeHtml(card.englishAnswers.join(", "))}</div>
      <div class="item-tags">${card.hasImage ? "Has image card" : "No image"}</div>
    `;
        main.appendChild(createCollectionPillsContainer(card.id));

        if (editingFlashcardId === card.id) {
            main.appendChild(createFlashcardEditPanel(card));
        }

        const side = document.createElement("div");
        side.className = "item-row-side";

        if (card.imageData) {
            const img = document.createElement("img");
            img.className = "flashcard-thumbnail";
            img.src = card.imageData;
            img.alt = card.german;
            side.appendChild(img);
        }

        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className = editingFlashcardId === card.id ? "" : "secondary";
        editButton.textContent = editingFlashcardId === card.id ? "Editing" : "Edit";
        editButton.addEventListener("click", () => toggleFlashcardEdit(card.id));
        side.appendChild(editButton);

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "secondary";
        deleteButton.textContent = "Delete";
        deleteButton.addEventListener("click", () => deleteFlashcards([card.id]));
        side.appendChild(deleteButton);

        row.append(left, main, side);
        elements.flashcardsList.appendChild(row);
    });
}

function renderCollections() {
    elements.collectionCount.textContent = `${state.collections.length} total`;
    elements.collectionsEmpty.classList.toggle("hidden", state.collections.length > 0);
    elements.collectionsList.innerHTML = "";

    selectedCollectionId = getValidSelectedCollectionId(selectedCollectionId);

    state.collections.forEach((collection) => {
        const row = document.createElement("div");
        row.className = "item-row";

        const main = document.createElement("div");
        main.className = "item-row-main";

        const titleRow = document.createElement("div");
        titleRow.className = "collection-title-row";

        const pip = document.createElement("span");
        pip.className = "collection-color-dot";
        pip.style.backgroundColor = getCollectionColor(collection);
        titleRow.appendChild(pip);

        const title = document.createElement("div");
        title.className = "item-title";
        title.textContent = collection.name;
        titleRow.appendChild(title);
        main.appendChild(titleRow);

        const subtitle = document.createElement("div");
        subtitle.className = "item-subtitle";
        subtitle.textContent = `${collection.cardIds.length} card(s)`;
        main.appendChild(subtitle);

        const side = document.createElement("div");
        side.className = "item-row-side";

        const colorInput = document.createElement("input");
        colorInput.type = "color";
        colorInput.value = getCollectionColor(collection);
        colorInput.className = "color-input";
        colorInput.title = `Color for ${collection.name}`;
        colorInput.addEventListener("input", () => {
            updateCollectionColor(collection.id, colorInput.value);
        });

        const selectButton = document.createElement("button");
        selectButton.type = "button";
        selectButton.className = collection.id === selectedCollectionId ? "" : "secondary";
        selectButton.textContent = collection.id === selectedCollectionId ? "Selected" : "Edit";
        selectButton.addEventListener("click", () => {
            selectedCollectionId = collection.id;
            updateUiPrefs({ selectedCollectionId: selectedCollectionId || "" });
            renderCollections();
            renderCollectionEditor();
        });

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "secondary";
        deleteButton.textContent = "Delete";
        deleteButton.addEventListener("click", () => deleteCollection(collection.id));

        side.append(colorInput, selectButton, deleteButton);
        row.append(main, side);
        elements.collectionsList.appendChild(row);
    });
}

function renderCollectionEditor() {
    const collection = state.collections.find((item) => item.id === selectedCollectionId);

    populateCollectionFilterOptions();

    if (!collection) {
        elements.collectionEditor.classList.add("hidden");
        elements.collectionEditorEmpty.classList.remove("hidden");
        elements.selectedCollectionName.textContent = "Select a collection";
        elements.collectionFlashcardForm.reset();
        elements.collectionCardsEditor.innerHTML = "";
        elements.collectionEditorSummary.textContent = "";
        return;
    }

    elements.collectionEditor.classList.remove("hidden");
    elements.collectionEditorEmpty.classList.add("hidden");
    elements.selectedCollectionName.textContent = collection.name;
    elements.collectionCardsEditor.innerHTML = "";

    const filteredCards = getFilteredCollectionEditorCards(collection);
    elements.collectionEditorSummary.textContent = `${filteredCards.length} shown / ${state.flashcards.length} total`;

    if (state.flashcards.length === 0) {
        elements.collectionCardsEditor.innerHTML = `<div class="empty-state">Create flashcards first.</div>`;
        return;
    }

    if (filteredCards.length === 0) {
        elements.collectionCardsEditor.innerHTML = `<div class="empty-state">No flashcards match the current filters.</div>`;
        return;
    }

    filteredCards.forEach((card) => {
        const wrapper = document.createElement("label");
        wrapper.className = "checkbox-item";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = collection.cardIds.includes(card.id);
        checkbox.addEventListener("change", () =>
            toggleCardInCollection(collection.id, card.id, checkbox.checked),
        );

        const text = document.createElement("div");
        text.className = "checkbox-item-content";
        text.innerHTML = `
      <div class="item-title">${escapeHtml(card.german)} — ${escapeHtml(card.englishAnswers.join(", "))}</div>
      <div class="item-subtitle">${card.hasImage ? "Has image" : "No image"}</div>
    `;
        text.appendChild(createCollectionPillsContainer(card.id));

        wrapper.append(checkbox, text);
        elements.collectionCardsEditor.appendChild(wrapper);
    });
}

function renderStudySetup() {
    sanitizeStudyCollectionSelection();
    elements.studyCollectionOptions.innerHTML = "";
    applyUiPrefsToControls();

    elements.studyCollectionOptions.appendChild(
        createStudyCollectionOption({
            id: STUDY_ALL_COLLECTION_ID,
            label: "All flashcards",
            count: state.flashcards.length,
            checked: selectedStudyCollectionIds.has(STUDY_ALL_COLLECTION_ID),
            note: "Includes every flashcard, even if it is not in a collection.",
        }),
    );

    state.collections.forEach((collection) => {
        elements.studyCollectionOptions.appendChild(
            createStudyCollectionOption({
                id: collection.id,
                label: collection.name,
                count: collection.cardIds.length,
                checked: selectedStudyCollectionIds.has(collection.id),
            }),
        );
    });

    if (state.collections.length === 0) {
        const empty = document.createElement("div");
        empty.className = "multiselect-empty muted";
        empty.textContent =
            "No saved collections yet. “All flashcards” will still study every card you have.";
        elements.studyCollectionOptions.appendChild(empty);
    }

    elements.studyCollectionSummary.textContent = getStudyCollectionSummaryText();
}

function renderStudyInsights() {
    renderStudyHistory();
    renderStudyLiveInsights();
}

function renderStudyLiveInsights() {
    renderStrugglingCards();
    renderCardStats();
}

function renderStudyHistory() {
    const historyEntries = [...(state.studyHistory || [])]
        .sort((left, right) => Date.parse(right.finishedAt) - Date.parse(left.finishedAt))
        .slice(0, 12);

    elements.studyHistorySummary.textContent = `${state.studyHistory.length} saved session${state.studyHistory.length === 1 ? "" : "s"}`;
    elements.studyHistoryList.innerHTML = "";

    if (historyEntries.length === 0) {
        elements.studyHistoryList.appendChild(
            createEmptyStateRow(
                "No study sessions yet. Finish a session and it will show up here.",
            ),
        );
        return;
    }

    historyEntries.forEach((entry) => {
        const row = document.createElement("div");
        row.className = "item-row stat-row";

        const main = document.createElement("div");
        main.className = "item-row-main";
        main.innerHTML = `
      <div class="item-title">${escapeHtml(entry.collectionLabel || "All flashcards")}</div>
      <div class="item-subtitle">${escapeHtml(formatSessionTimestamp(entry.finishedAt))}</div>
      <div class="item-tags">${escapeHtml(formatStudyModeLabel(entry.mode))} · Answered ${entry.answeredCount}/${entry.totalCards}</div>
    `;

        const side = document.createElement("div");
        side.className = "item-row-side stat-side";
        side.innerHTML = `
      <div class="stat-score">${escapeHtml(formatStudyScore(entry.score))} / ${escapeHtml(formatStudyScore(entry.totalCards))}</div>
      <div class="item-subtitle">${escapeHtml(formatSessionCompletionLabel(entry))}</div>
    `;

        row.append(main, side);
        elements.studyHistoryList.appendChild(row);
    });
}

function renderStrugglingCards() {
    const strugglingEntries = getStrugglingCardEntries().slice(0, 10);
    const studiedCardsCount = getStudiedCardEntries().length;

    elements.strugglingCardsSummary.textContent =
        studiedCardsCount > 0
            ? `${studiedCardsCount} card${studiedCardsCount === 1 ? "" : "s"} with study stats`
            : "No card stats yet";
    elements.strugglingCardsList.innerHTML = "";

    if (strugglingEntries.length === 0) {
        elements.strugglingCardsList.appendChild(
            createEmptyStateRow(
                "No struggling cards yet. Wrong answers will bubble up here automatically.",
            ),
        );
        return;
    }

    strugglingEntries.forEach(({ card, stats }) => {
        const row = document.createElement("div");
        row.className = "item-row stat-row";

        const main = document.createElement("div");
        main.className = "item-row-main";
        main.innerHTML = `
      <div class="item-title">${escapeHtml(card.german)}</div>
      <div class="item-subtitle">${escapeHtml((card.englishAnswers || []).join(", "))}</div>
      <div class="item-tags">Seen ${stats.timesSeen} time(s) · Correct ${stats.timesCorrect} time(s)</div>
    `;

        const side = document.createElement("div");
        side.className = "item-row-side stat-side";
        side.innerHTML = `
      <div class="stat-score">${escapeHtml(formatAccuracy(stats.timesCorrect, stats.timesSeen))}</div>
      <div class="item-subtitle">${escapeHtml(stats.lastSeenAt ? `Last seen ${formatRelativeDateLabel(stats.lastSeenAt)}` : "")}</div>
    `;

        row.append(main, side);
        elements.strugglingCardsList.appendChild(row);
    });
}

function renderCardStats() {
    const studiedEntries = getStudiedCardEntries()
        .sort((left, right) => {
            if (right.stats.timesSeen !== left.stats.timesSeen) {
                return right.stats.timesSeen - left.stats.timesSeen;
            }

            const leftAccuracy =
                left.stats.timesSeen > 0 ? left.stats.timesCorrect / left.stats.timesSeen : 0;
            const rightAccuracy =
                right.stats.timesSeen > 0 ? right.stats.timesCorrect / right.stats.timesSeen : 0;

            if (leftAccuracy !== rightAccuracy) {
                return leftAccuracy - rightAccuracy;
            }

            return left.card.german.localeCompare(right.card.german);
        })
        .slice(0, 25);

    elements.cardStatsSummary.textContent =
        studiedEntries.length > 0
            ? `Showing ${studiedEntries.length} studied card${studiedEntries.length === 1 ? "" : "s"}`
            : "No card stats yet";
    elements.cardStatsList.innerHTML = "";

    if (studiedEntries.length === 0) {
        elements.cardStatsList.appendChild(
            createEmptyStateRow("Per-card study stats will appear after you answer some cards."),
        );
        return;
    }

    studiedEntries.forEach(({ card, stats }) => {
        const row = document.createElement("div");
        row.className = "item-row stat-row";

        const main = document.createElement("div");
        main.className = "item-row-main";
        main.innerHTML = `
      <div class="item-title">${escapeHtml(card.german)}</div>
      <div class="item-subtitle">${escapeHtml((card.englishAnswers || []).join(", "))}</div>
      <div class="item-tags">Seen ${stats.timesSeen} · Correct ${stats.timesCorrect}</div>
    `;

        const side = document.createElement("div");
        side.className = "item-row-side stat-side";
        side.innerHTML = `
      <div class="stat-score">${escapeHtml(formatAccuracy(stats.timesCorrect, stats.timesSeen))}</div>
      <div class="item-subtitle">${escapeHtml(stats.lastSeenAt ? formatSessionTimestamp(stats.lastSeenAt) : "Never")}</div>
    `;

        row.append(main, side);
        elements.cardStatsList.appendChild(row);
    });
}

function renderStudyQuestion() {
    const prompt = getCurrentPrompt(studySession);

    elements.studyProgress.textContent = `${studySession.currentIndex + 1} / ${studySession.cards.length}`;
    elements.studyPrompt.textContent = prompt.promptText;
    elements.studyAnswerForm.reset();
    elements.studyAnswer.disabled = false;
    elements.studyCheckButton.disabled = false;
    elements.studyAnswerForm.classList.remove("study-answer-form-complete");
    elements.studyAnswer.focus();
    elements.studyFeedback.textContent = "";
    elements.studyFeedbackNote.textContent = "";
    elements.studyFeedback.className = "study-feedback";
    elements.studyNextButton.classList.add("hidden");
    elements.studyGermanCharacters.classList.toggle("hidden", !prompt.expectsGermanAnswer);

    if (prompt.imageData) {
        elements.studyImage.src = prompt.imageData;
        elements.studyImageWrapper.classList.remove("hidden");
    } else {
        elements.studyImage.src = "";
        elements.studyImageWrapper.classList.add("hidden");
    }
}

function showStudyResults() {
    finalizeStudySession();
    elements.studySessionBox.classList.add("hidden");
    elements.studyResultsBox.classList.remove("hidden");

    const total = studySession?.cards.length || 0;
    const score = studySession?.score || 0;
    const answeredCount = studySession?.answeredCount || 0;
    const completionNote =
        answeredCount < total ? ` You answered ${answeredCount} of ${total} card(s).` : "";
    elements.studyResultText.textContent = `You scored ${formatStudyScore(score)} out of ${formatStudyScore(total)}.${completionNote}`;
}

function onStudyCollectionOptionsChange(event) {
    const checkbox = event.target.closest('input[type="checkbox"][data-study-collection-id]');

    if (!checkbox) {
        return;
    }

    const collectionId = checkbox.dataset.studyCollectionId || "";

    if (collectionId === STUDY_ALL_COLLECTION_ID) {
        selectedStudyCollectionIds = new Set([STUDY_ALL_COLLECTION_ID]);
        updateUiPrefs({ selectedStudyCollectionIds: [...selectedStudyCollectionIds] });
        renderStudySetup();
        return;
    }

    selectedStudyCollectionIds.delete(STUDY_ALL_COLLECTION_ID);

    if (checkbox.checked) {
        selectedStudyCollectionIds.add(collectionId);
    } else {
        selectedStudyCollectionIds.delete(collectionId);
    }

    if (selectedStudyCollectionIds.size === 0) {
        selectedStudyCollectionIds = new Set([STUDY_ALL_COLLECTION_ID]);
    }

    updateUiPrefs({ selectedStudyCollectionIds: [...selectedStudyCollectionIds] });
    renderStudySetup();
}

function finalizeStudySession() {
    if (!studySession || studySession.historyRecorded) {
        return;
    }

    const answeredCount = studySession.answeredCount || 0;
    const totalCards = studySession.cards?.length || 0;

    if (answeredCount === 0 || totalCards === 0) {
        studySession.historyRecorded = true;
        return;
    }

    const entry = {
        id: crypto.randomUUID(),
        finishedAt: new Date().toISOString(),
        collectionLabel: studySession.collectionLabel || getStudyCollectionSummaryText(),
        collectionIds: Array.isArray(studySession.collectionIds)
            ? [...studySession.collectionIds]
            : [STUDY_ALL_COLLECTION_ID],
        mode: studySession.mode,
        score: studySession.score || 0,
        answeredCount,
        totalCards,
    };

    state.studyHistory = [entry, ...(state.studyHistory || [])].slice(0, 200);
    studySession.historyRecorded = true;
    persist();
    renderStudyInsights();
}

function recordCardStudyResult(cardId, result) {
    if (!cardId) {
        return;
    }

    if (!state.cardStats) {
        state.cardStats = {};
    }

    const stats = state.cardStats[cardId] || {
        timesSeen: 0,
        timesCorrect: 0,
        lastSeenAt: "",
        lastCorrectAt: "",
    };

    const now = new Date().toISOString();
    stats.timesSeen += 1;
    stats.lastSeenAt = now;

    if ((result?.pointsAwarded || 0) > 0) {
        stats.timesCorrect += 1;
        stats.lastCorrectAt = now;
    }

    state.cardStats[cardId] = stats;
}

function getStudiedCardEntries() {
    return state.flashcards
        .map((card) => ({ card, stats: getCardStatsForCard(card.id) }))
        .filter(({ stats }) => stats.timesSeen > 0);
}

function getStrugglingCardEntries() {
    return getStudiedCardEntries()
        .filter(({ stats }) => stats.timesSeen > 0 && stats.timesCorrect < stats.timesSeen)
        .sort((left, right) => {
            const leftAccuracy =
                left.stats.timesSeen > 0 ? left.stats.timesCorrect / left.stats.timesSeen : 0;
            const rightAccuracy =
                right.stats.timesSeen > 0 ? right.stats.timesCorrect / right.stats.timesSeen : 0;

            if (leftAccuracy !== rightAccuracy) {
                return leftAccuracy - rightAccuracy;
            }

            if (right.stats.timesSeen !== left.stats.timesSeen) {
                return right.stats.timesSeen - left.stats.timesSeen;
            }

            return left.card.german.localeCompare(right.card.german);
        });
}

function getCardStatsForCard(cardId) {
    return (
        state.cardStats?.[cardId] || {
            timesSeen: 0,
            timesCorrect: 0,
            lastSeenAt: "",
            lastCorrectAt: "",
        }
    );
}

function createEmptyStateRow(message) {
    const row = document.createElement("div");
    row.className = "empty-state";
    row.textContent = message;
    return row;
}

function formatAccuracy(timesCorrect, timesSeen) {
    if (!timesSeen) {
        return "0% accuracy";
    }

    return `${Math.round((timesCorrect / timesSeen) * 100)}% accuracy`;
}

function formatSessionTimestamp(value) {
    const timestamp = Date.parse(value || "");

    if (Number.isNaN(timestamp)) {
        return "Unknown date";
    }

    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(new Date(timestamp));
}

function formatRelativeDateLabel(value) {
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

function createImportedCollectionRefs(collections) {
    const refsByCardId = new Map();

    (collections || []).forEach((collection) => {
        (collection.cardIds || []).forEach((cardId) => {
            const existingRefs = refsByCardId.get(cardId) || [];
            existingRefs.push({
                id: collection.id,
                name: collection.name,
                color: collection.color,
            });
            refsByCardId.set(cardId, existingRefs);
        });
    });

    return refsByCardId;
}

function convertBackupStateToImportedEntries(backupState) {
    const collectionRefsByCardId = createImportedCollectionRefs(backupState.collections || []);

    return (backupState.flashcards || []).map((card) => ({
        card: {
            id: card.id,
            german: card.german,
            englishAnswers: [...(card.englishAnswers || [])],
            imageData: card.imageData || "",
            hasImage: Boolean(card.imageData),
        },
        collections: collectionRefsByCardId.get(card.id) || [],
    }));
}

async function applyImportedFlashcardEntries(entries, { logLabel = "Import" } = {}) {
    let createdCardsCount = 0;
    let reusedCardsCount = 0;
    let createdCollectionsCount = 0;
    const duplicateLogs = [];
    const cardIdMap = {};
    const collectionIdMap = {};

    for (const entry of entries) {
        let card = findExistingFlashcardByGerman(entry.card.german);
        const isDuplicate = Boolean(card);
        let addedMeanings = [];
        let adoptedImage = false;

        if (!card) {
            card = {
                id: entry.card.id || crypto.randomUUID(),
                german: entry.card.german,
                englishAnswers: [...(entry.card.englishAnswers || [])],
                imageData: "",
                hasImage: false,
            };
            state.flashcards.push(card);

            if (entry.card.imageData) {
                await setFlashcardImage(card, entry.card.imageData);
            }

            createdCardsCount += 1;
        } else {
            reusedCardsCount += 1;

            const mergeResult = mergeEnglishAnswers(card.englishAnswers, entry.card.englishAnswers);
            card.englishAnswers = mergeResult.merged;
            addedMeanings = mergeResult.added;

            if (entry.card.imageData) {
                await setFlashcardImage(card, entry.card.imageData);
                adoptedImage = true;
            }
        }

        if (entry.card.id) {
            cardIdMap[entry.card.id] = card.id;
        }

        const importedCollections = Array.isArray(entry.collections)
            ? entry.collections
            : (entry.collectionNames || []).map((name) => ({ name }));
        const addedToCollections = [];

        for (const collectionRef of importedCollections) {
            const { collection, created } = getOrCreateCollectionByName(
                collectionRef.name,
                collectionRef.color || getSuggestedCollectionColor(),
            );

            if (!collection) {
                continue;
            }

            if (collectionRef.id) {
                collectionIdMap[collectionRef.id] = collection.id;
            }

            if (created) {
                createdCollectionsCount += 1;
            }

            if (!collection.cardIds.includes(card.id)) {
                collection.cardIds.push(card.id);
                addedToCollections.push(collection.name);
            }
        }

        if (isDuplicate) {
            duplicateLogs.push({
                german: entry.card.german,
                reusedId: card.id,
                addedMeanings,
                addedToCollections,
                adoptedImage,
            });
        }
    }

    if (duplicateLogs.length > 0) {
        console.groupCollapsed(`[${logLabel}] Reused ${duplicateLogs.length} duplicate word(s)`);

        duplicateLogs.forEach((item) => {
            console.info(
                `Duplicate word reused: "${item.german}" (card id: ${item.reusedId}). ` +
                    `Added meanings: ${item.addedMeanings.length > 0 ? item.addedMeanings.join(", ") : "none"}. ` +
                    `Added to collections: ${item.addedToCollections.length > 0 ? item.addedToCollections.join(", ") : "none"}. ` +
                    `Adopted image: ${item.adoptedImage ? "yes" : "no"}.`,
            );
        });

        console.groupEnd();
    }

    return {
        createdCardsCount,
        reusedCardsCount,
        createdCollectionsCount,
        cardIdMap,
        collectionIdMap,
    };
}

function mergeBackupCardStats(importedCardStats, cardIdMap) {
    if (!state.cardStats) {
        state.cardStats = {};
    }

    let mergedCardStatsCount = 0;

    Object.entries(importedCardStats || {}).forEach(([sourceCardId, importedStats]) => {
        const targetCardId = cardIdMap[sourceCardId];

        if (!targetCardId) {
            return;
        }

        const existingStats = getCardStats(targetCardId);
        state.cardStats[targetCardId] = {
            timesSeen: existingStats.timesSeen + toSafeNonNegativeInteger(importedStats?.timesSeen),
            timesCorrect:
                existingStats.timesCorrect + toSafeNonNegativeInteger(importedStats?.timesCorrect),
            lastSeenAt: getLatestIsoDate(existingStats.lastSeenAt, importedStats?.lastSeenAt),
            lastCorrectAt: getLatestIsoDate(
                existingStats.lastCorrectAt,
                importedStats?.lastCorrectAt,
            ),
        };
        mergedCardStatsCount += 1;
    });

    return mergedCardStatsCount;
}

function mergeBackupStudyHistory(importedHistory, collectionIdMap) {
    const existingIds = new Set((state.studyHistory || []).map((entry) => entry.id));
    const nextHistoryEntries = [];

    (importedHistory || []).forEach((entry) => {
        const nextId = entry.id && !existingIds.has(entry.id) ? entry.id : crypto.randomUUID();
        existingIds.add(nextId);
        nextHistoryEntries.push({
            ...entry,
            id: nextId,
            collectionIds: (entry.collectionIds || [])
                .map((collectionId) => collectionIdMap[collectionId])
                .filter(Boolean),
        });
    });

    state.studyHistory = [...nextHistoryEntries, ...(state.studyHistory || [])]
        .sort((left, right) => {
            return Date.parse(right.finishedAt || 0) - Date.parse(left.finishedAt || 0);
        })
        .slice(0, 200);

    return nextHistoryEntries.length;
}

async function mergeBackupStateIntoCurrentState(importedState) {
    const importedEntries = convertBackupStateToImportedEntries(importedState);
    const flashcardImportResult = await applyImportedFlashcardEntries(importedEntries, {
        logLabel: "Backup import",
    });
    const mergedCardStatsCount = mergeBackupCardStats(
        importedState.cardStats,
        flashcardImportResult.cardIdMap,
    );
    const mergedSessionCount = mergeBackupStudyHistory(
        importedState.studyHistory,
        flashcardImportResult.collectionIdMap,
    );

    return {
        ...flashcardImportResult,
        mergedCardStatsCount,
        mergedSessionCount,
    };
}

function chooseBackupImportMode(importedState, issues) {
    return openBackupImportModal(importedState, issues);
}

function finalizeImportState({
    resetStudySelection = false,
    resetSelectedCollection = false,
} = {}) {
    sanitizeStudyCollectionSelection();

    if (resetSelectedCollection) {
        selectedCollectionId = getValidSelectedCollectionId(state.collections[0]?.id || null);
    } else {
        selectedCollectionId = getValidSelectedCollectionId(selectedCollectionId);
    }

    if (resetStudySelection) {
        selectedStudyCollectionIds = new Set([STUDY_ALL_COLLECTION_ID]);
    }

    updateUiPrefs({
        selectedCollectionId: selectedCollectionId || "",
        selectedStudyCollectionIds: [...selectedStudyCollectionIds],
    });
    selectedFlashcardIds.clear();
    resetStudyView();
    setCollectionColorInputDefault();
    renderAll();
}

function openBackupImportModal(importedState, issues) {
    if (pendingBackupImportResolver) {
        closeBackupImportModal(null);
    }

    const totalCards = importedState.flashcards?.length || 0;
    const totalCollections = importedState.collections?.length || 0;
    const totalSessions = importedState.studyHistory?.length || 0;
    const totalCardStats = Object.keys(importedState.cardStats || {}).length;

    elements.backupImportModalSummary.innerHTML = `
      <div class="modal-summary-grid">
        <div class="modal-summary-item">
          <span class="modal-summary-label">Flashcards</span>
          <div class="modal-summary-value">${escapeHtml(String(totalCards))}</div>
        </div>
        <div class="modal-summary-item">
          <span class="modal-summary-label">Collections</span>
          <div class="modal-summary-value">${escapeHtml(String(totalCollections))}</div>
        </div>
        <div class="modal-summary-item">
          <span class="modal-summary-label">Saved sessions</span>
          <div class="modal-summary-value">${escapeHtml(String(totalSessions))}</div>
        </div>
        <div class="modal-summary-item">
          <span class="modal-summary-label">Cards with stats</span>
          <div class="modal-summary-value">${escapeHtml(String(totalCardStats))}</div>
        </div>
      </div>
    `;

    if (issues.length > 0) {
        elements.backupImportModalWarnings.textContent = formatImportIssuesSummary(issues);
        elements.backupImportModalWarnings.classList.remove("hidden");
    } else {
        elements.backupImportModalWarnings.textContent = "";
        elements.backupImportModalWarnings.classList.add("hidden");
    }

    lastFocusedElementBeforeBackupImportModal =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.classList.add("modal-open");
    elements.backupImportModal.classList.remove("hidden");

    return new Promise((resolve) => {
        pendingBackupImportResolver = resolve;
        window.requestAnimationFrame(() => {
            elements.backupImportMergeButton.focus();
        });
    });
}

function closeBackupImportModal(selection) {
    if (!pendingBackupImportResolver) {
        return;
    }

    const resolver = pendingBackupImportResolver;
    pendingBackupImportResolver = null;

    elements.backupImportModal.classList.add("hidden");
    elements.backupImportModalWarnings.textContent = "";
    elements.backupImportModalWarnings.classList.add("hidden");
    elements.backupImportModalSummary.innerHTML = "";
    document.body.classList.remove("modal-open");

    if (lastFocusedElementBeforeBackupImportModal?.focus) {
        lastFocusedElementBeforeBackupImportModal.focus();
    }
    lastFocusedElementBeforeBackupImportModal = null;

    resolver(selection === "merge" || selection === "replace" ? selection : null);
}

function onBackupImportModalClick(event) {
    if (event.target === elements.backupImportModal) {
        closeBackupImportModal(null);
    }
}

function onBackupImportModalKeyDown(event) {
    if (elements.backupImportModal.classList.contains("hidden")) {
        return;
    }

    if (event.key === "Escape") {
        event.preventDefault();
        closeBackupImportModal(null);
        return;
    }

    if (event.key !== "Tab") {
        return;
    }

    const focusableElements = [
        elements.backupImportMergeButton,
        elements.backupImportReplaceButton,
        elements.backupImportCancelButton,
    ].filter((element) => element && !element.disabled);

    if (focusableElements.length === 0) {
        return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;

    if (event.shiftKey && activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
        return;
    }

    if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
    }
}

function formatImportIssuesSummary(issues) {
    if (!issues.length) {
        return "";
    }

    const preview = issues
        .slice(0, MAX_IMPORT_ISSUES_TO_DISPLAY)
        .map((issue) => `line ${issue.lineNumber}: ${issue.message}`)
        .join("; ");
    const remainingCount = issues.length - Math.min(issues.length, MAX_IMPORT_ISSUES_TO_DISPLAY);

    return `Skipped ${issues.length} malformed or unsupported line(s) (${preview}${remainingCount > 0 ? `; +${remainingCount} more` : ""}).`;
}

function logImportIssues(label, issues) {
    if (!issues.length) {
        return;
    }

    console.groupCollapsed(`[${label}] Skipped ${issues.length} line(s)`);
    issues.forEach((issue) => {
        console.warn(`Line ${issue.lineNumber}: ${issue.message} Raw: ${issue.line}`);
    });
    console.groupEnd();
}

function getLatestIsoDate(leftValue, rightValue) {
    const leftTimestamp = Date.parse(leftValue || "");
    const rightTimestamp = Date.parse(rightValue || "");

    if (!Number.isFinite(leftTimestamp)) {
        return Number.isFinite(rightTimestamp) ? rightValue || "" : "";
    }

    if (!Number.isFinite(rightTimestamp)) {
        return leftValue || "";
    }

    return rightTimestamp > leftTimestamp ? rightValue || "" : leftValue || "";
}

function toSafeNonNegativeInteger(value) {
    const parsed = Number.parseInt(String(value || "").trim(), 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function formatSessionCompletionLabel(entry) {
    return entry.answeredCount < entry.totalCards ? "Ended early" : "Completed";
}

function formatStudyModeLabel(mode) {
    const labels = {
        "de-en": "German → English",
        "en-de": "English → German",
        "image-de": "Image → German",
        random: "Random mix",
    };

    return labels[mode] || mode;
}

function createStudyCollectionOption({ id, label, count, checked, note = "" }) {
    const option = document.createElement("label");
    option.className = "multiselect-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = checked;
    checkbox.dataset.studyCollectionId = id;

    const text = document.createElement("div");
    text.className = "multiselect-option-text";

    const title = document.createElement("div");
    title.className = "multiselect-option-title";
    title.textContent = label;

    const meta = document.createElement("div");
    meta.className = "item-subtitle";
    meta.textContent = note ? `${count} card(s) · ${note}` : `${count} card(s)`;

    text.append(title, meta);
    option.append(checkbox, text);

    return option;
}

function sanitizeStudyCollectionSelection() {
    const validCollectionIds = new Set(state.collections.map((collection) => collection.id));
    const nextSelectedIds = [...selectedStudyCollectionIds].filter(
        (id) => id === STUDY_ALL_COLLECTION_ID || validCollectionIds.has(id),
    );

    if (nextSelectedIds.length === 0 || nextSelectedIds.includes(STUDY_ALL_COLLECTION_ID)) {
        selectedStudyCollectionIds = new Set([STUDY_ALL_COLLECTION_ID]);
        return;
    }

    selectedStudyCollectionIds = new Set(nextSelectedIds);
}

function getStudyCollectionSummaryText() {
    const cards = getStudyCardsForSelection();

    if (selectedStudyCollectionIds.has(STUDY_ALL_COLLECTION_ID)) {
        return `All flashcards (${cards.length} card${cards.length === 1 ? "" : "s"})`;
    }

    const selectedCollections = state.collections.filter((collection) =>
        selectedStudyCollectionIds.has(collection.id),
    );

    if (selectedCollections.length === 1) {
        return `${selectedCollections[0].name} (${cards.length} card${cards.length === 1 ? "" : "s"})`;
    }

    return `${selectedCollections.length} collections selected (${cards.length} cards)`;
}

function getStudyCardsForSelection() {
    sanitizeStudyCollectionSelection();

    if (selectedStudyCollectionIds.has(STUDY_ALL_COLLECTION_ID)) {
        return [...state.flashcards];
    }

    const cardIds = new Set();

    state.collections.forEach((collection) => {
        if (!selectedStudyCollectionIds.has(collection.id)) {
            return;
        }

        collection.cardIds.forEach((cardId) => cardIds.add(cardId));
    });

    return state.flashcards.filter((card) => cardIds.has(card.id));
}

function getStudySelectionEmptyMessage(needsImages) {
    if (selectedStudyCollectionIds.has(STUDY_ALL_COLLECTION_ID)) {
        return needsImages
            ? "You do not have any flashcards with images yet."
            : "You do not have any flashcards to study yet.";
    }

    const selectedCollections = state.collections.filter((collection) =>
        selectedStudyCollectionIds.has(collection.id),
    );

    if (selectedCollections.length === 1) {
        return needsImages
            ? `Collection “${selectedCollections[0].name}” has no flashcards with images.`
            : `Collection “${selectedCollections[0].name}” has no flashcards to study.`;
    }

    return needsImages
        ? "The selected collections have no flashcards with images."
        : "The selected collections have no flashcards to study.";
}

function parseStudyCardLimit(value) {
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

function onStudyGermanCharacterClick(event) {
    const button = event.target.closest("[data-character]");

    if (!button) {
        return;
    }

    insertTextAtCursor(elements.studyAnswer, button.dataset.character || "");
}

function insertTextAtCursor(input, text) {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const nextValue = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;

    input.value = nextValue;
    input.focus();

    const nextCaret = start + text.length;
    input.setSelectionRange(nextCaret, nextCaret);
}

function deleteFlashcards(cardIds) {
    const idsToDelete = new Set(cardIds);

    state.flashcards
        .filter((card) => idsToDelete.has(card.id))
        .forEach((card) => revokeFlashcardImageUrl(card.imageData));

    state.flashcards = state.flashcards.filter((card) => !idsToDelete.has(card.id));

    state.collections = state.collections.map((collection) => ({
        ...collection,
        cardIds: collection.cardIds.filter((id) => !idsToDelete.has(id)),
    }));

    Object.keys(state.cardStats || {}).forEach((cardId) => {
        if (idsToDelete.has(cardId)) {
            delete state.cardStats[cardId];
        }
    });

    idsToDelete.forEach((id) => selectedFlashcardIds.delete(id));

    if (editingFlashcardId && idsToDelete.has(editingFlashcardId)) {
        editingFlashcardId = null;
    }

    persist();
    renderAll();
}

function deleteCollection(collectionId) {
    state.collections = state.collections.filter((collection) => collection.id !== collectionId);

    if (selectedCollectionId === collectionId) {
        selectedCollectionId = getValidSelectedCollectionId(state.collections[0]?.id || null);
    }

    if (collectionEditorFilterCollectionId === collectionId) {
        collectionEditorFilterCollectionId = "";
        elements.collectionFilterCollection.value = "";
    }

    sanitizeStudyCollectionSelection();
    updateUiPrefs({
        selectedCollectionId: selectedCollectionId || "",
        selectedStudyCollectionIds: [...selectedStudyCollectionIds],
    });

    persist();
    setCollectionColorInputDefault();
    renderAll();
}

function toggleCardInCollection(collectionId, cardId, shouldInclude) {
    const collection = state.collections.find((item) => item.id === collectionId);
    if (!collection) {
        return;
    }

    if (shouldInclude) {
        if (!collection.cardIds.includes(cardId)) {
            collection.cardIds.push(cardId);
        }
    } else {
        collection.cardIds = collection.cardIds.filter((id) => id !== cardId);
    }

    persist();
    renderCollections();
    renderCollectionEditor();
    renderFlashcards();
}

function updateCollectionColor(collectionId, color) {
    const collection = state.collections.find((item) => item.id === collectionId);
    if (!collection) {
        return;
    }

    collection.color = color;
    persist();
    renderCollections();
    renderCollectionEditor();
    renderFlashcards();
}

function populateCollectionFilterOptions() {
    const currentValue = collectionEditorFilterCollectionId;
    elements.collectionFilterCollection.innerHTML = "";

    const anyOption = document.createElement("option");
    anyOption.value = "";
    anyOption.textContent = "Any collection";
    elements.collectionFilterCollection.appendChild(anyOption);

    state.collections.forEach((collection) => {
        const option = document.createElement("option");
        option.value = collection.id;
        option.textContent = collection.name;
        elements.collectionFilterCollection.appendChild(option);
    });

    const hasCurrentValue =
        currentValue === "" ||
        state.collections.some((collection) => collection.id === currentValue);

    collectionEditorFilterCollectionId = hasCurrentValue ? currentValue : "";
    elements.collectionFilterCollection.value = collectionEditorFilterCollectionId;
    elements.collectionMembershipFilter.value = collectionEditorMembershipFilter;
}

function getFilteredFlashcards() {
    return state.flashcards.filter((card) => matchesCardSearch(card, flashcardSearchTerm));
}

function getFilteredCollectionEditorCards(selectedCollection) {
    return state.flashcards.filter((card) => {
        if (!matchesCardSearch(card, collectionEditorSearchTerm)) {
            return false;
        }

        const memberships = getCardMemberships(card.id);
        const isInSelectedCollection = selectedCollection.cardIds.includes(card.id);

        if (collectionEditorMembershipFilter === "in-selected" && !isInSelectedCollection) {
            return false;
        }

        if (collectionEditorMembershipFilter === "not-in-selected" && isInSelectedCollection) {
            return false;
        }

        if (collectionEditorMembershipFilter === "has-collections" && memberships.length === 0) {
            return false;
        }

        if (collectionEditorMembershipFilter === "no-collections" && memberships.length > 0) {
            return false;
        }

        if (
            collectionEditorFilterCollectionId &&
            !memberships.some((membership) => membership.id === collectionEditorFilterCollectionId)
        ) {
            return false;
        }

        return true;
    });
}

function createCollectionPillsContainer(cardId) {
    const memberships = getCardMemberships(cardId);
    const container = document.createElement("div");
    container.className = "collection-pills";

    if (memberships.length === 0) {
        const pill = document.createElement("span");
        pill.className = "collection-pill empty";
        pill.textContent = "No collection";
        container.appendChild(pill);
        return container;
    }

    memberships.forEach((collection) => {
        const pill = document.createElement("span");
        pill.className = "collection-pill";
        pill.style.setProperty("--collection-color", getCollectionColor(collection));
        pill.innerHTML = `<span class="collection-pill-dot"></span>${escapeHtml(collection.name)}`;
        container.appendChild(pill);
    });

    return container;
}

function getCardMemberships(cardId) {
    return state.collections.filter((collection) => collection.cardIds.includes(cardId));
}

function createFlashcardEditPanel(card) {
    const panel = document.createElement("form");
    panel.className = "flashcard-edit-panel flashcard-edit-grid";

    const germanLabel = document.createElement("label");
    germanLabel.textContent = "German";
    const germanInput = document.createElement("input");
    germanInput.type = "text";
    germanInput.value = card.german;
    germanLabel.appendChild(germanInput);

    const englishLabel = document.createElement("label");
    englishLabel.textContent = "English meaning(s)";
    const englishInput = document.createElement("input");
    englishInput.type = "text";
    englishInput.value = (card.englishAnswers || []).join("; ");
    englishInput.placeholder = "dog; hound";
    englishLabel.appendChild(englishInput);

    const imageSection = document.createElement("div");
    imageSection.className = "flashcard-edit-image-section";

    const imageHelp = document.createElement("p");
    imageHelp.className = "muted flashcard-edit-help";
    imageHelp.textContent =
        "Upload a new image to replace the current one. Large photos are resized and compressed automatically.";
    imageSection.appendChild(imageHelp);

    if (card.imageData) {
        const preview = document.createElement("img");
        preview.className = "flashcard-edit-image-preview";
        preview.src = card.imageData;
        preview.alt = `${card.german} image preview`;
        imageSection.appendChild(preview);
    } else {
        const noImage = document.createElement("p");
        noImage.className = "muted flashcard-edit-image-note";
        noImage.textContent = "No image attached yet.";
        imageSection.appendChild(noImage);
    }

    const imageLabel = document.createElement("label");
    imageLabel.textContent = card.hasImage ? "Replace image" : "Add image";
    const imageInput = document.createElement("input");
    imageInput.type = "file";
    imageInput.accept = "image/*";
    imageLabel.appendChild(imageInput);
    imageSection.appendChild(imageLabel);

    const removeImageLabel = document.createElement("label");
    removeImageLabel.className = "flashcard-edit-remove-option";
    const removeImageCheckbox = document.createElement("input");
    removeImageCheckbox.type = "checkbox";
    removeImageCheckbox.disabled = !card.hasImage;
    const removeImageText = document.createElement("span");
    removeImageText.textContent = "Remove image";
    removeImageLabel.append(removeImageCheckbox, removeImageText);
    imageSection.appendChild(removeImageLabel);

    panel.append(germanLabel, englishLabel, imageSection);

    const help = document.createElement("p");
    help.className = "muted flashcard-edit-help";
    help.textContent = "Select which collections this flashcard belongs to.";
    panel.appendChild(help);

    const collectionsWrapper = document.createElement("div");
    collectionsWrapper.className = "flashcard-edit-collections";

    if (state.collections.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "Create a collection first to assign this flashcard.";
        collectionsWrapper.appendChild(empty);
    } else {
        state.collections.forEach((collection) => {
            const option = document.createElement("label");
            option.className = "flashcard-edit-collection-option";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.value = collection.id;
            checkbox.checked = collection.cardIds.includes(card.id);

            const text = document.createElement("span");
            text.innerHTML = `<span class="collection-pill-dot" style="--collection-color: ${escapeHtml(
                getCollectionColor(collection),
            )}; background: ${escapeHtml(getCollectionColor(collection))};"></span>${escapeHtml(collection.name)}`;

            option.append(checkbox, text);
            collectionsWrapper.appendChild(option);
        });
    }

    panel.appendChild(collectionsWrapper);

    const actions = document.createElement("div");
    actions.className = "flashcard-edit-actions";

    const saveButton = document.createElement("button");
    saveButton.type = "submit";
    saveButton.textContent = "Save changes";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "secondary";
    cancelButton.textContent = "Cancel";
    cancelButton.addEventListener("click", () => {
        editingFlashcardId = null;
        renderFlashcards();
    });

    actions.append(saveButton, cancelButton);
    panel.appendChild(actions);

    panel.addEventListener("submit", async (event) => {
        event.preventDefault();

        const german = germanInput.value.trim();
        const englishAnswers = parseEnglishAnswersInput(englishInput.value);
        const imageFile = imageInput.files[0];
        const shouldRemoveImage = removeImageCheckbox.checked;

        if (!german || englishAnswers.length === 0) {
            window.alert("Please enter a German word and at least one English meaning.");
            return;
        }

        const conflictingCard = findExistingFlashcardByGerman(german);
        if (conflictingCard && conflictingCard.id !== card.id) {
            window.alert(
                `A different flashcard already uses the German word "${conflictingCard.german}". Edit that card instead or delete it first.`,
            );
            return;
        }

        saveButton.disabled = true;
        cancelButton.disabled = true;

        try {
            let imageUpdate = null;

            if (imageFile) {
                imageUpdate = await applyUploadedImageToCard(card, imageFile);
            } else if (shouldRemoveImage && card.hasImage) {
                clearFlashcardImage(card);
                imageUpdate = { removed: true };
            }

            card.german = german;
            card.englishAnswers = englishAnswers;

            const selectedCollectionIds = Array.from(
                collectionsWrapper.querySelectorAll('input[type="checkbox"]:checked'),
                (input) => input.value,
            );
            setCardMemberships(card.id, selectedCollectionIds);

            const didPersist = await persist();

            editingFlashcardId = null;

            if (didPersist) {
                showAppStatusMessage(
                    buildFlashcardEditSaveMessage({
                        german: card.german,
                        imageUpdate,
                    }),
                    true,
                );
            }

            renderAll();
        } catch (error) {
            console.error("Failed to save flashcard changes.", error);
            showAppStatusMessage(error?.message || "Could not process that image upload.", false);
            saveButton.disabled = false;
            cancelButton.disabled = false;
        }
    });

    return panel;
}

function toggleFlashcardEdit(cardId) {
    editingFlashcardId = editingFlashcardId === cardId ? null : cardId;
    renderFlashcards();
}

function buildFlashcardSaveMessage({
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

function buildCollectionFlashcardSaveMessage({
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

function buildFlashcardEditSaveMessage({ german, imageUpdate = null }) {
    const messageParts = [`Saved changes to “${german}”.`];
    appendImageUpdateMessageParts(messageParts, imageUpdate);
    return messageParts.join(" ");
}

function appendImageUpdateMessageParts(messageParts, imageUpdate) {
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

function getStudyImageModeMessage({
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

function setCardMemberships(cardId, collectionIds) {
    const selectedIds = new Set(collectionIds);

    state.collections.forEach((collection) => {
        const shouldInclude = selectedIds.has(collection.id);
        const isIncluded = collection.cardIds.includes(cardId);

        if (shouldInclude && !isIncluded) {
            collection.cardIds.push(cardId);
        }

        if (!shouldInclude && isIncluded) {
            collection.cardIds = collection.cardIds.filter((id) => id !== cardId);
        }
    });
}

function ensureCardInCollection(collectionId, cardId) {
    const collection = state.collections.find((item) => item.id === collectionId);
    if (!collection) {
        return;
    }

    if (!collection.cardIds.includes(cardId)) {
        collection.cardIds.push(cardId);
    }
}

function applyUiPrefsToControls() {
    if (elements.studyMode) {
        elements.studyMode.value = uiPrefs.studyMode || "de-en";
    }

    if (elements.studyCardLimit) {
        elements.studyCardLimit.value = uiPrefs.studyCardLimit || "";
    }
}

function updateUiPrefs(partialPrefs) {
    uiPrefs = {
        ...uiPrefs,
        ...partialPrefs,
    };
    saveUiPrefs(uiPrefs);
}

function getValidSelectedCollectionId(candidateId) {
    if (candidateId && state.collections.some((collection) => collection.id === candidateId)) {
        return candidateId;
    }

    return state.collections[0]?.id || null;
}

async function setFlashcardImage(card, imageSource) {
    const nextImageUrl = await saveFlashcardImage(card.id, imageSource);

    revokeFlashcardImageUrl(card.imageData);

    card.imageData = nextImageUrl;
    card.hasImage = true;
}

async function applyUploadedImageToCard(card, imageFile) {
    const replacedExisting = Boolean(card.hasImage);
    const preparedImage = await prepareUploadedImageForStorage(imageFile);
    await setFlashcardImage(card, preparedImage.blob);

    return {
        originalSizeBytes: preparedImage.originalSizeBytes,
        finalSizeBytes: preparedImage.finalSizeBytes,
        wasCompressed: preparedImage.wasCompressed,
        wasResized: preparedImage.wasResized,
        replacedExisting,
    };
}

function clearFlashcardImage(card) {
    revokeFlashcardImageUrl(card.imageData);
    card.imageData = "";
    card.hasImage = false;
}

function revokeFlashcardImageUrl(imageUrl) {
    if (String(imageUrl || "").startsWith("blob:")) {
        URL.revokeObjectURL(imageUrl);
    }
}

async function prepareUploadedImageForStorage(file) {
    if (!(file instanceof Blob) || !String(file.type || "").startsWith("image/")) {
        throw new Error("Please choose a valid image file.");
    }

    if (file.size > MAX_IMAGE_UPLOAD_SOURCE_BYTES) {
        throw new Error(
            `That image is too large to process (${formatFileSize(file.size)}). Please choose one under ${formatFileSize(
                MAX_IMAGE_UPLOAD_SOURCE_BYTES,
            )}.`,
        );
    }

    const imageInfo = await readImageDimensions(file);
    const scale = Math.min(
        1,
        MAX_IMAGE_UPLOAD_DIMENSION / imageInfo.width,
        MAX_IMAGE_UPLOAD_DIMENSION / imageInfo.height,
    );
    const targetWidth = Math.max(1, Math.round(imageInfo.width * scale));
    const targetHeight = Math.max(1, Math.round(imageInfo.height * scale));
    const needsResize = targetWidth !== imageInfo.width || targetHeight !== imageInfo.height;

    if (!needsResize && file.size <= TARGET_IMAGE_UPLOAD_BYTES) {
        return {
            blob: file,
            originalSizeBytes: file.size,
            finalSizeBytes: file.size,
            wasCompressed: false,
            wasResized: false,
            replacedExisting: false,
        };
    }

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext("2d");
    if (!context) {
        throw new Error("Could not prepare that image for upload.");
    }

    context.drawImage(imageInfo.image, 0, 0, targetWidth, targetHeight);

    let bestBlob = null;

    for (const quality of IMAGE_UPLOAD_QUALITY_STEPS) {
        const candidate = await canvasToBlob(canvas, "image/webp", quality);

        if (!bestBlob || candidate.size < bestBlob.size) {
            bestBlob = candidate;
        }

        if (candidate.size <= TARGET_IMAGE_UPLOAD_BYTES) {
            bestBlob = candidate;
            break;
        }
    }

    if (!bestBlob) {
        throw new Error("Could not prepare that image for upload.");
    }

    if (!needsResize && file.size <= HARD_IMAGE_UPLOAD_BYTES && bestBlob.size >= file.size) {
        return {
            blob: file,
            originalSizeBytes: file.size,
            finalSizeBytes: file.size,
            wasCompressed: false,
            wasResized: false,
        };
    }

    if (bestBlob.size > HARD_IMAGE_UPLOAD_BYTES) {
        throw new Error(
            `That image is still too large after resizing (${formatFileSize(
                bestBlob.size,
            )}). Please choose a smaller image.`,
        );
    }

    return {
        blob: bestBlob,
        originalSizeBytes: file.size,
        finalSizeBytes: bestBlob.size,
        wasCompressed: bestBlob.size < file.size || bestBlob.type !== file.type,
        wasResized: needsResize,
    };
}

function readImageDimensions(file) {
    return new Promise((resolve, reject) => {
        const imageUrl = URL.createObjectURL(file);
        const image = new Image();

        image.addEventListener("load", () => {
            const width = image.naturalWidth || image.width;
            const height = image.naturalHeight || image.height;
            URL.revokeObjectURL(imageUrl);
            resolve({
                image,
                width,
                height,
            });
        });

        image.addEventListener("error", () => {
            URL.revokeObjectURL(imageUrl);
            reject(new Error("Could not read that image file."));
        });

        image.src = imageUrl;
    });
}

function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (blob instanceof Blob) {
                    resolve(blob);
                    return;
                }

                reject(new Error("Could not prepare that image for upload."));
            },
            type,
            quality,
        );
    });
}

function formatFileSize(bytes) {
    const value = Number(bytes) || 0;

    if (value < 1024) {
        return `${value} B`;
    }

    if (value < 1024 * 1024) {
        return `${(value / 1024).toFixed(1)} KB`;
    }

    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function cloneStateForPersistence(nextState) {
    return JSON.parse(JSON.stringify(nextState));
}

function showAppStatusMessage(message, isSuccess) {
    if (!elements.appStatusMessage) {
        return;
    }

    elements.appStatusMessage.textContent = message;
    elements.appStatusMessage.className = `status-message app-status-message ${isSuccess ? "success" : "error"}`;
    elements.appStatusMessage.classList.toggle("hidden", !message);
}

function clearAppStatusMessage() {
    if (!elements.appStatusMessage) {
        return;
    }

    elements.appStatusMessage.textContent = "";
    elements.appStatusMessage.className = "status-message app-status-message hidden";
}

function persist() {
    const snapshot = cloneStateForPersistence(state);

    persistQueue = persistQueue
        .catch(() => false)
        .then(async () => {
            try {
                await saveState(snapshot);
                clearAppStatusMessage();
                return true;
            } catch (error) {
                console.error("Failed to save app data.", error);
                showAppStatusMessage(
                    "Could not save your latest changes to IndexedDB. Keep this tab open and export a backup once storage is working again.",
                    false,
                );
                return false;
            }
        });

    return persistQueue;
}

function showStudySetupMessage(message) {
    elements.studySetupMessage.textContent = message;
}

function formatStudyScore(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function showImportExportMessage(message, isSuccess) {
    elements.importExportMessage.textContent = message;
    elements.importExportMessage.className = `status-message ${isSuccess ? "success" : "error"}`;
}

function downloadTextFile(content, filename) {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function normalizeWord(value) {
    return String(value || "")
        .trim()
        .toLocaleLowerCase();
}

function parseEnglishAnswersInput(value) {
    return [
        ...new Set(
            String(value || "")
                .split(";")
                .map((item) => item.trim())
                .filter(Boolean),
        ),
    ];
}

function mergeEnglishAnswers(existingAnswers, incomingAnswers) {
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

function findExistingFlashcardByGerman(german) {
    const normalizedGerman = normalizeWord(german);

    return state.flashcards.find((card) => normalizeWord(card.german) === normalizedGerman) || null;
}

function getOrCreateCollectionByName(name, color = getSuggestedCollectionColor()) {
    const normalizedName = normalizeWord(name);

    if (!normalizedName) {
        return { collection: null, created: false };
    }

    let collection =
        state.collections.find((item) => normalizeWord(item.name) === normalizedName) || null;

    if (collection) {
        return { collection, created: false };
    }

    collection = {
        id: crypto.randomUUID(),
        name: name.trim(),
        cardIds: [],
        color,
    };

    state.collections.push(collection);
    return { collection, created: true };
}

function matchesCardSearch(card, searchTerm) {
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

function pruneSelectedFlashcardIds() {
    const validIds = new Set(state.flashcards.map((card) => card.id));

    [...selectedFlashcardIds].forEach((id) => {
        if (!validIds.has(id)) {
            selectedFlashcardIds.delete(id);
        }
    });
}

function getCollectionColor(collection) {
    return collection?.color || "#64748b";
}

function getSuggestedCollectionColor() {
    return DEFAULT_COLLECTION_COLORS[state.collections.length % DEFAULT_COLLECTION_COLORS.length];
}

function setCollectionColorInputDefault() {
    elements.collectionColor.value = getSuggestedCollectionColor();
}
