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
import {
    DEFAULT_COLLECTION_COLORS,
    HARD_IMAGE_UPLOAD_BYTES,
    IMAGE_UPLOAD_QUALITY_STEPS,
    MAX_IMAGE_UPLOAD_DIMENSION,
    MAX_IMAGE_UPLOAD_SOURCE_BYTES,
    MAX_IMPORT_ISSUES_TO_DISPLAY,
    PAGINATION_PAGE_SIZES,
    SEARCH_INPUT_DEBOUNCE_MS,
    STUDY_ALL_COLLECTION_ID,
    TARGET_IMAGE_UPLOAD_BYTES,
} from "./constants.js";
import {
    buildCollectionFlashcardSaveMessage,
    buildFlashcardSaveMessage,
    downloadTextFile,
    escapeHtml,
    formatFileSize,
    getEffectiveStudyCardCount,
    getStudyImageModeMessage,
    mergeEnglishAnswers,
    normalizeWord,
    parseEnglishAnswersInput,
    parseStudyCardLimit,
} from "./shared-utils.js";
import { createFlashcardsUi } from "./flashcards-ui.js";
import { createStudyUi } from "./study-ui.js";

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
let persistQueue = Promise.resolve(false);
let flashcardRenderDebounceId = 0;
let collectionEditorRenderDebounceId = 0;
let pendingActionModalResolver = null;
let lastFocusedElementBeforeActionModal = null;
let pendingActionModalContext = null;
let flashcardDeleteSkipConfirmUntilVisibilityChange = false;
const paginationState = {
    flashcards: 1,
    collections: 1,
    collectionEditor: 1,
    studyHistory: 1,
    strugglingCards: 1,
    cardStats: 1,
};

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
    flashcardsPagination: document.getElementById("flashcards-pagination"),
    flashcardsEmpty: document.getElementById("flashcards-empty"),
    flashcardCount: document.getElementById("flashcard-count"),

    collectionForm: document.getElementById("collection-form"),
    collectionName: document.getElementById("collection-name"),
    collectionColor: document.getElementById("collection-color"),
    collectionsList: document.getElementById("collections-list"),
    collectionsPagination: document.getElementById("collections-pagination"),
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
    collectionEditorPagination: document.getElementById("collection-editor-pagination"),

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
    studyPromptAudioButton: document.getElementById("study-prompt-audio-button"),
    studyChoiceOptions: document.getElementById("study-choice-options"),
    studyImageWrapper: document.getElementById("study-image-wrapper"),
    studyImage: document.getElementById("study-image"),
    studyAnswerForm: document.getElementById("study-answer-form"),
    studyAnswer: document.getElementById("study-answer"),
    studyCheckButton: document.getElementById("study-check-button"),
    studyGermanCharacters: document.getElementById("study-german-characters"),
    studyFeedback: document.getElementById("study-feedback"),
    studyFeedbackNote: document.getElementById("study-feedback-note"),
    studyFeedbackAudioRow: document.getElementById("study-feedback-audio-row"),
    studyFeedbackAudioButton: document.getElementById("study-feedback-audio-button"),
    studyNextButton: document.getElementById("study-next-button"),
    studyEndButton: document.getElementById("study-end-button"),
    studyResultText: document.getElementById("study-result-text"),
    studyResetButton: document.getElementById("study-reset-button"),
    studyHistorySummary: document.getElementById("study-history-summary"),
    studyHistoryList: document.getElementById("study-history-list"),
    studyHistoryPagination: document.getElementById("study-history-pagination"),
    strugglingCardsSummary: document.getElementById("struggling-cards-summary"),
    strugglingCardsList: document.getElementById("struggling-cards-list"),
    strugglingCardsPagination: document.getElementById("struggling-cards-pagination"),
    cardStatsSummary: document.getElementById("card-stats-summary"),
    cardStatsList: document.getElementById("card-stats-list"),
    cardStatsPagination: document.getElementById("card-stats-pagination"),

    bulkImportFile: document.getElementById("bulk-import-file"),
    bulkImportButton: document.getElementById("bulk-import-button"),
    backupImportFile: document.getElementById("backup-import-file"),
    backupImportButton: document.getElementById("backup-import-button"),
    exportButton: document.getElementById("export-button"),
    deleteAllButton: document.getElementById("delete-all-button"),
    importExportMessage: document.getElementById("import-export-message"),
    backupImportModal: document.getElementById("backup-import-modal"),
    backupImportModalTitle: document.getElementById("backup-import-modal-title"),
    backupImportModalDescription: document.getElementById("backup-import-modal-description"),
    backupImportModalSummary: document.getElementById("backup-import-modal-summary"),
    backupImportModalWarnings: document.getElementById("backup-import-modal-warnings"),
    backupImportModalCheckboxRow: document.getElementById("backup-import-modal-checkbox-row"),
    backupImportModalCheckbox: document.getElementById("backup-import-modal-checkbox"),
    backupImportMergeButton: document.getElementById("backup-import-merge-button"),
    backupImportReplaceButton: document.getElementById("backup-import-replace-button"),
    backupImportCancelButton: document.getElementById("backup-import-cancel-button"),
    backupImportModalFootnote: document.getElementById("backup-import-modal-footnote"),
};

const flashcardsUi = createFlashcardsUi({
    elements,
    getState: () => state,
    getSelectedCollectionId: () => selectedCollectionId,
    setSelectedCollectionId: (value) => {
        selectedCollectionId = value;
    },
    getFlashcardSearchTerm: () => flashcardSearchTerm,
    getCollectionEditorSearchTerm: () => collectionEditorSearchTerm,
    getCollectionEditorMembershipFilter: () => collectionEditorMembershipFilter,
    getCollectionEditorFilterCollectionId: () => collectionEditorFilterCollectionId,
    setCollectionEditorFilterCollectionId: (value) => {
        collectionEditorFilterCollectionId = value;
    },
    getEditingFlashcardId: () => editingFlashcardId,
    setEditingFlashcardId: (value) => {
        editingFlashcardId = value;
    },
    selectedFlashcardIds,
    getPaginationSlice,
    renderPaginationControls,
    requestFlashcardDeletion,
    deleteCollection,
    toggleCardInCollection,
    updateCollectionColor,
    resetPaginationPage,
    updateUiPrefs,
    getValidSelectedCollectionId,
    findExistingFlashcardByGerman,
    applyUploadedImageToCard,
    clearFlashcardImage,
    persist,
    showAppStatusMessage,
    setCardMemberships,
    renderAll,
});

const {
    renderFlashcards,
    renderCollections,
    renderCollectionEditor,
    getFilteredFlashcards,
    getFilteredCollectionEditorCards,
    populateCollectionFilterOptions,
    createCollectionPillsContainer,
    getCardMemberships,
    createFlashcardEditPanel,
    toggleFlashcardEdit,
} = flashcardsUi;

const studyUi = createStudyUi({
    elements,
    getState: () => state,
    getStudySession: () => studySession,
    setStudySession: (value) => {
        studySession = value;
    },
    getSelectedStudyCollectionIds: () => selectedStudyCollectionIds,
    setSelectedStudyCollectionIds: (value) => {
        selectedStudyCollectionIds = value;
    },
    getCurrentPrompt,
    getPaginationSlice,
    renderPaginationControls,
    persist,
    showAppStatusMessage,
    updateUiPrefs,
});

const {
    renderStudySetup,
    renderStudyInsights,
    renderStudyLiveInsights,
    renderStudyHistory,
    renderStrugglingCards,
    renderCardStats,
    renderStudyQuestion,
    renderStudyResponseControls,
    renderStudyChoiceOptions,
    showStudyResults,
    onStudyPronunciationButtonClick,
    bindSpeechSynthesisEvents,
    cancelSpeechPlayback,
    renderStudyPronunciationControls,
    onStudyCollectionOptionsChange,
    finalizeStudySession,
    recordCardStudyResult,
    getStudiedCardEntries,
    getStrugglingCardEntries,
    getCardStatsForCard,
    sanitizeStudyCollectionSelection,
    getStudyCollectionSummaryText,
    getStudyCardsForSelection,
    getStudyCollectionsForSelection,
    renderStudyModeAvailability,
    getStudySelectionEmptyMessage,
    onStudyGermanCharacterClick,
} = studyUi;

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
    cancelSpeechPlayback();
    flashcardDeleteSkipConfirmUntilVisibilityChange = false;

    if (!event.persisted) {
        releaseStateImageObjectUrls(state);
    }
}

function onDocumentVisibilityChange() {
    if (!document.hidden) {
        return;
    }

    flashcardDeleteSkipConfirmUntilVisibilityChange = false;
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
    elements.studyChoiceOptions.addEventListener("click", onStudyChoiceOptionsClick);
    elements.studyGermanCharacters.addEventListener("click", onStudyGermanCharacterClick);
    elements.studyPromptAudioButton.addEventListener("click", onStudyPronunciationButtonClick);
    elements.studyFeedbackAudioButton.addEventListener("click", onStudyPronunciationButtonClick);
    elements.studyNextButton.addEventListener("click", onStudyNext);
    elements.studyEndButton.addEventListener("click", endStudySession);
    elements.backupImportMergeButton.addEventListener("click", () => closeActionModal("primary"));
    elements.backupImportReplaceButton.addEventListener("click", () =>
        closeActionModal("secondary"),
    );
    elements.backupImportCancelButton.addEventListener("click", () => closeActionModal(null));
    elements.backupImportModal.addEventListener("click", onActionModalClick);
    elements.backupImportModal.addEventListener("keydown", onActionModalKeyDown);
    elements.studyResetButton.addEventListener("click", resetStudyView);

    elements.bulkImportButton.addEventListener("click", onBulkImport);
    elements.backupImportButton.addEventListener("click", onBackupImport);
    elements.exportButton.addEventListener("click", onExport);
    elements.deleteAllButton.addEventListener("click", onDeleteAll);
    bindSpeechSynthesisEvents();
    document.addEventListener("visibilitychange", onDocumentVisibilityChange);
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

function resetPaginationPage(key) {
    paginationState[key] = 1;
}

function setPaginationPageForIndex(key, pageSize, index) {
    paginationState[key] = index >= 0 ? Math.floor(index / pageSize) + 1 : 1;
}

function getPaginationSlice(items, key, pageSize) {
    const totalItems = items.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const requestedPage = Number.isInteger(paginationState[key]) ? paginationState[key] : 1;
    const currentPage = Math.min(Math.max(requestedPage, 1), totalPages);
    const startIndex = totalItems === 0 ? 0 : (currentPage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, totalItems);

    paginationState[key] = currentPage;

    return {
        items: items.slice(startIndex, endIndex),
        currentPage,
        totalPages,
        totalItems,
        startIndex,
        endIndex,
    };
}

function renderPaginationControls(
    container,
    { key, pageSize, totalItems, currentPage, totalPages },
) {
    container.innerHTML = "";

    const shouldShowPagination = totalItems > pageSize;
    container.classList.toggle("hidden", !shouldShowPagination);

    if (!shouldShowPagination) {
        return;
    }

    const summary = document.createElement("span");
    summary.className = "pagination-summary muted";
    summary.textContent = `${totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1}-${Math.min(currentPage * pageSize, totalItems)} of ${totalItems}`;

    const controls = document.createElement("div");
    controls.className = "pagination-button-group";

    const previousButton = document.createElement("button");
    previousButton.type = "button";
    previousButton.className = "secondary pagination-button";
    previousButton.textContent = "Previous";
    previousButton.disabled = currentPage <= 1;
    previousButton.addEventListener("click", () => {
        paginationState[key] = Math.max(1, currentPage - 1);
        renderPaginationSection(key);
    });

    const pageIndicator = document.createElement("span");
    pageIndicator.className = "pagination-page-indicator muted";
    pageIndicator.textContent = `Page ${currentPage} of ${totalPages}`;

    const nextButton = document.createElement("button");
    nextButton.type = "button";
    nextButton.className = "secondary pagination-button";
    nextButton.textContent = "Next";
    nextButton.disabled = currentPage >= totalPages;
    nextButton.addEventListener("click", () => {
        paginationState[key] = Math.min(totalPages, currentPage + 1);
        renderPaginationSection(key);
    });

    controls.append(previousButton, pageIndicator, nextButton);
    container.append(summary, controls);
}

function getPaginatedFlashcards() {
    return getPaginationSlice(
        getFilteredFlashcards(),
        "flashcards",
        PAGINATION_PAGE_SIZES.flashcards,
    );
}

function renderPaginationSection(key) {
    switch (key) {
        case "flashcards":
            renderFlashcards();
            return;
        case "collections":
            renderCollections();
            return;
        case "collectionEditor":
            renderCollectionEditor();
            return;
        case "studyHistory":
            renderStudyHistory();
            return;
        case "strugglingCards":
            renderStrugglingCards();
            return;
        case "cardStats":
            renderCardStats();
            return;
        default:
            renderAll();
    }
}

function onStudyPreferencesChange() {
    updateUiPrefs({
        studyMode: elements.studyMode.value,
        studyCardLimit: elements.studyCardLimit.value.trim(),
    });
    renderStudyModeAvailability();
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
            paginationState.flashcards = Math.ceil(
                state.flashcards.length / PAGINATION_PAGE_SIZES.flashcards,
            );

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
    resetPaginationPage("flashcards");
    scheduleFlashcardRender();
}

function onSelectVisibleFlashcards() {
    getPaginatedFlashcards().items.forEach((card) => {
        selectedFlashcardIds.add(card.id);
    });
    renderFlashcards();
}

function onClearFlashcardSelection() {
    selectedFlashcardIds.clear();
    renderFlashcards();
}

async function onDeleteSelectedFlashcards() {
    const idsToDelete = state.flashcards
        .filter((card) => selectedFlashcardIds.has(card.id))
        .map((card) => card.id);

    if (idsToDelete.length === 0) {
        return;
    }

    await requestFlashcardDeletion(idsToDelete, { allowSkipPrompt: false });
}

async function onCollectionSubmit(event) {
    event.preventDefault();

    const name = elements.collectionName.value.trim();
    if (!name) {
        return;
    }

    const { collection } = getOrCreateCollectionByName(name, elements.collectionColor.value);
    selectedCollectionId = collection.id;
    resetPaginationPage("collectionEditor");
    setPaginationPageForIndex(
        "collections",
        PAGINATION_PAGE_SIZES.collections,
        state.collections.findIndex((item) => item.id === collection.id),
    );
    updateUiPrefs({ selectedCollectionId: selectedCollectionId || "" });

    await persist();
    elements.collectionForm.reset();
    setCollectionColorInputDefault();
    renderAll();
}

function onCollectionSearchInput(event) {
    collectionEditorSearchTerm = event.target.value;
    resetPaginationPage("collectionEditor");
    scheduleCollectionEditorRender();
}

function onCollectionFilterChange() {
    collectionEditorMembershipFilter = elements.collectionMembershipFilter.value;
    collectionEditorFilterCollectionId = elements.collectionFilterCollection.value;
    resetPaginationPage("collectionEditor");
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

    const studyableCardCount = getEffectiveStudyCardCount(cards, cardLimit);

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

    if (mode === "mc-de-en" && studyableCardCount < 5) {
        showStudySetupMessage(
            "Multiple choice needs at least 5 study cards after your current collection, image, and max-card filters.",
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
    studySession = createStudySession(cards, mode, {
        cardLimit,
        collections: getStudyCollectionsForSelection(),
    });
    studySession.collectionIds = [...selectedStudyCollectionIds];
    studySession.collectionLabel = getStudyCollectionSummaryText();
    studySession.startedAt = new Date().toISOString();
    studySession.answeredCount = 0;
    studySession.historyRecorded = false;

    elements.studyResultsBox.classList.add("hidden");
    elements.studySessionBox.classList.remove("hidden");
    renderStudyQuestion();
}

async function onStudyAnswerSubmit(event) {
    event.preventDefault();
    await handleStudyAnswerSubmission(elements.studyAnswer.value);
}

function onStudyChoiceOptionsClick(event) {
    const choiceButton = event.target.closest("button[data-choice-value]");

    if (!choiceButton) {
        return;
    }

    void handleStudyAnswerSubmission(choiceButton.dataset.choiceValue || "");
}

async function handleStudyAnswerSubmission(answerValue) {
    if (!studySession) {
        return;
    }

    if (studySession.answered) {
        onStudyNext();
        return;
    }

    const prompt = getCurrentPrompt(studySession);

    if (!prompt) {
        return;
    }

    if (prompt.responseKind === "choice") {
        prompt.selectedChoice = String(answerValue || "");
    }

    const currentCard = studySession.cards[studySession.currentIndex] || null;
    const result = submitStudyAnswer(studySession, answerValue);

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

    if (prompt.responseKind === "choice") {
        renderStudyChoiceOptions(prompt);
    }

    elements.studyNextButton.classList.remove("hidden");
    renderStudyPronunciationControls();
    elements.studyNextButton.focus();

    await persist();
    renderStudyLiveInsights();
}

function onStudyNext() {
    if (!studySession) {
        return;
    }

    cancelSpeechPlayback();
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
    cancelSpeechPlayback();
    studySession = null;
    elements.studySessionBox.classList.add("hidden");
    elements.studyResultsBox.classList.add("hidden");
    elements.studyFeedback.textContent = "";
    elements.studyFeedbackNote.textContent = "";
    elements.studyFeedback.className = "study-feedback";
    elements.studyAnswerForm.reset();
    elements.studyAnswer.disabled = false;
    elements.studyCheckButton.disabled = false;
    elements.studyAnswerForm.classList.remove("hidden");
    elements.studyAnswerForm.classList.remove("study-answer-form-complete");
    elements.studyNextButton.classList.add("hidden");
    elements.studyImageWrapper.classList.add("hidden");
    elements.studyChoiceOptions.innerHTML = "";
    elements.studyChoiceOptions.classList.add("hidden");
    elements.studyGermanCharacters.classList.add("hidden");
    elements.studyPromptAudioButton.classList.add("hidden");
    elements.studyPromptAudioButton.disabled = false;
    elements.studyPromptAudioButton.removeAttribute("data-german-word");
    elements.studyFeedbackAudioRow.classList.add("hidden");
    elements.studyFeedbackAudioButton.disabled = false;
    elements.studyFeedbackAudioButton.removeAttribute("data-german-word");
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
    const selection = await openDeleteAllModal();

    if (selection !== "confirm") {
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

        const existingStats = getCardStatsForCard(targetCardId);
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
    const totalCards = importedState.flashcards?.length || 0;
    const totalCollections = importedState.collections?.length || 0;
    const totalSessions = importedState.studyHistory?.length || 0;
    const totalCardStats = Object.keys(importedState.cardStats || {}).length;

    return openActionModal({
        title: "Import backup",
        description: "Choose how this backup should be applied.",
        summaryItems: [
            { label: "Flashcards", value: String(totalCards) },
            { label: "Collections", value: String(totalCollections) },
            { label: "Saved sessions", value: String(totalSessions) },
            { label: "Cards with stats", value: String(totalCardStats) },
        ],
        warningsText: issues.length > 0 ? formatImportIssuesSummary(issues) : "",
        primaryButtonLabel: "Merge into current data",
        primaryButtonValue: "merge",
        secondaryButtonLabel: "Replace current data",
        secondaryButtonValue: "replace",
        secondaryButtonIsDanger: true,
        footnote:
            "Merge keeps your current data and adds what it can. Replace overwrites everything in the app with the backup.",
    });
}

function openDeleteAllModal() {
    return openActionModal({
        title: "Delete all app data",
        description:
            "Delete all flashcards, collections, images, study progress, session history, and saved preferences?",
        summaryItems: [
            { label: "Flashcards", value: String(state.flashcards?.length || 0) },
            { label: "Collections", value: String(state.collections?.length || 0) },
            { label: "Saved sessions", value: String(state.studyHistory?.length || 0) },
            { label: "Cards with stats", value: String(Object.keys(state.cardStats || {}).length) },
        ],
        primaryButtonLabel: "Delete everything",
        primaryButtonValue: "confirm",
        primaryButtonIsDanger: true,
        footnote: "This resets the app completely and cannot be undone.",
    });
}

function buildModalSummaryGrid(items) {
    if (!items.length) {
        return "";
    }

    return `
      <div class="modal-summary-grid">
        ${items
            .map(
                ({ label, value }) => `
                  <div class="modal-summary-item">
                    <span class="modal-summary-label">${escapeHtml(label)}</span>
                    <div class="modal-summary-value">${escapeHtml(value)}</div>
                  </div>
                `,
            )
            .join("")}
      </div>
    `;
}

async function requestFlashcardDeletion(cardIds, { allowSkipPrompt }) {
    const normalizedCardIds = [...new Set(cardIds)].filter(Boolean);
    if (normalizedCardIds.length === 0) {
        return false;
    }

    const cardsToDelete = state.flashcards.filter((card) => normalizedCardIds.includes(card.id));
    if (cardsToDelete.length === 0) {
        return false;
    }

    if (allowSkipPrompt && flashcardDeleteSkipConfirmUntilVisibilityChange) {
        await deleteFlashcards(normalizedCardIds);
        return true;
    }

    const selection = await openFlashcardDeleteModal(cardsToDelete, { allowSkipPrompt });
    if (selection !== "confirm") {
        return false;
    }

    await deleteFlashcards(normalizedCardIds);
    return true;
}

function openFlashcardDeleteModal(cardsToDelete, { allowSkipPrompt }) {
    const isSingleFlashcardDelete = cardsToDelete.length === 1;
    const primaryCard = cardsToDelete[0] || null;

    return openActionModal({
        title: isSingleFlashcardDelete ? "Delete flashcard" : "Delete selected flashcards",
        description: isSingleFlashcardDelete
            ? `Delete "${primaryCard?.german || "this flashcard"}"?`
            : `Delete ${cardsToDelete.length} selected flashcard(s)?`,
        summaryItems: isSingleFlashcardDelete
            ? [{ label: "Flashcard", value: primaryCard?.german || "Unknown" }]
            : [{ label: "Flashcards", value: String(cardsToDelete.length) }],
        primaryButtonLabel: isSingleFlashcardDelete
            ? "Delete flashcard"
            : `Delete ${cardsToDelete.length} flashcard(s)`,
        primaryButtonValue: "confirm",
        primaryButtonIsDanger: true,
        showSkipCheckbox: allowSkipPrompt,
        footnote:
            "This removes the flashcard from all collections and deletes any saved stats for it.",
    });
}

function openActionModal({
    title,
    description,
    summaryItems = [],
    warningsText = "",
    primaryButtonLabel,
    primaryButtonValue,
    primaryButtonIsDanger = false,
    secondaryButtonLabel = "",
    secondaryButtonValue = null,
    secondaryButtonIsDanger = false,
    showSkipCheckbox = false,
    footnote = "",
}) {
    if (pendingActionModalResolver) {
        closeActionModal(null);
    }

    pendingActionModalContext = {
        primaryButtonValue,
        secondaryButtonValue,
        showSkipCheckbox,
    };

    elements.backupImportModalTitle.textContent = title;
    elements.backupImportModalDescription.textContent = description;
    elements.backupImportModalSummary.innerHTML = buildModalSummaryGrid(summaryItems);
    elements.backupImportModalWarnings.textContent = warningsText;
    elements.backupImportModalWarnings.classList.toggle("hidden", !warningsText);
    elements.backupImportModalCheckbox.checked = false;
    elements.backupImportModalCheckboxRow.classList.toggle("hidden", !showSkipCheckbox);
    elements.backupImportModalFootnote.textContent = footnote;
    elements.backupImportModalFootnote.classList.toggle("hidden", !footnote);

    elements.backupImportMergeButton.textContent = primaryButtonLabel;
    elements.backupImportMergeButton.classList.toggle("danger", primaryButtonIsDanger);
    elements.backupImportReplaceButton.textContent = secondaryButtonLabel || "";
    elements.backupImportReplaceButton.classList.toggle("danger", secondaryButtonIsDanger);
    elements.backupImportReplaceButton.classList.toggle("hidden", !secondaryButtonLabel);

    lastFocusedElementBeforeActionModal =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.classList.add("modal-open");
    elements.backupImportModal.classList.remove("hidden");

    return new Promise((resolve) => {
        pendingActionModalResolver = resolve;
        window.requestAnimationFrame(() => {
            elements.backupImportMergeButton.focus();
        });
    });
}

function closeActionModal(selection) {
    if (!pendingActionModalResolver) {
        return;
    }

    const resolver = pendingActionModalResolver;
    const modalContext = pendingActionModalContext;
    pendingActionModalResolver = null;
    pendingActionModalContext = null;

    let resolvedValue = null;
    if (selection === "primary") {
        resolvedValue = modalContext?.primaryButtonValue || null;
    } else if (selection === "secondary") {
        resolvedValue = modalContext?.secondaryButtonValue || null;
    }

    if (
        resolvedValue &&
        modalContext?.showSkipCheckbox &&
        elements.backupImportModalCheckbox.checked
    ) {
        flashcardDeleteSkipConfirmUntilVisibilityChange = true;
    }

    elements.backupImportModal.classList.add("hidden");
    elements.backupImportModalSummary.innerHTML = "";
    elements.backupImportModalWarnings.textContent = "";
    elements.backupImportModalWarnings.classList.add("hidden");
    elements.backupImportModalCheckbox.checked = false;
    elements.backupImportModalCheckboxRow.classList.add("hidden");
    elements.backupImportReplaceButton.classList.remove("hidden");
    elements.backupImportModalFootnote.textContent = "";
    elements.backupImportModalFootnote.classList.add("hidden");
    document.body.classList.remove("modal-open");

    if (lastFocusedElementBeforeActionModal?.focus) {
        lastFocusedElementBeforeActionModal.focus();
    }
    lastFocusedElementBeforeActionModal = null;

    resolver(resolvedValue);
}

function onActionModalClick(event) {
    if (event.target === elements.backupImportModal) {
        closeActionModal(null);
    }
}

function onActionModalKeyDown(event) {
    if (elements.backupImportModal.classList.contains("hidden")) {
        return;
    }

    if (event.key === "Escape") {
        event.preventDefault();
        closeActionModal(null);
        return;
    }

    if (event.key !== "Tab") {
        return;
    }

    const focusableElements = [
        elements.backupImportCancelButton,
        elements.backupImportModalCheckbox,
        elements.backupImportMergeButton,
        elements.backupImportReplaceButton,
    ].filter((element) => element && !element.disabled && element.offsetParent !== null);

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

async function deleteFlashcards(cardIds) {
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

    await persist();
    renderAll();
}

async function deleteCollection(collectionId) {
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

    await persist();
    setCollectionColorInputDefault();
    renderAll();
}

async function toggleCardInCollection(collectionId, cardId, shouldInclude) {
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

    await persist();
    renderCollections();
    renderCollectionEditor();
    renderFlashcards();
}

async function updateCollectionColor(collectionId, color) {
    const collection = state.collections.find((item) => item.id === collectionId);
    if (!collection) {
        return;
    }

    collection.color = color;
    await persist();
    renderCollections();
    renderCollectionEditor();
    renderFlashcards();
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

function showImportExportMessage(message, isSuccess) {
    elements.importExportMessage.textContent = message;
    elements.importExportMessage.className = `status-message ${isSuccess ? "success" : "error"}`;
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

function pruneSelectedFlashcardIds() {
    const validIds = new Set(state.flashcards.map((card) => card.id));

    [...selectedFlashcardIds].forEach((id) => {
        if (!validIds.has(id)) {
            selectedFlashcardIds.delete(id);
        }
    });
}

function getSuggestedCollectionColor() {
    return DEFAULT_COLLECTION_COLORS[state.collections.length % DEFAULT_COLLECTION_COLORS.length];
}

function setCollectionColorInputDefault() {
    elements.collectionColor.value = getSuggestedCollectionColor();
}
