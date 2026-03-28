import { loadState, saveState, replaceState } from "./storage.js";
import { parseBulkWords, exportBackupText, parseBackupText } from "./import-export.js";
import {
    createStudySession,
    getCurrentPrompt,
    submitStudyAnswer,
    advanceSession,
    isSessionFinished,
    isGermanAnswerMode,
} from "./study-mode.js";

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

let state = loadState();
let selectedCollectionId = null;
let studySession = null;
let flashcardSearchTerm = "";
let collectionEditorSearchTerm = "";
let collectionEditorMembershipFilter = "all";
let collectionEditorFilterCollectionId = "";
let editingFlashcardId = null;
const selectedFlashcardIds = new Set();

const elements = {
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
    studyCollection: document.getElementById("study-collection"),
    studyMode: document.getElementById("study-mode"),
    studySetupMessage: document.getElementById("study-setup-message"),
    studySessionBox: document.getElementById("study-session"),
    studyResultsBox: document.getElementById("study-results"),
    studyProgress: document.getElementById("study-progress"),
    studyPrompt: document.getElementById("study-prompt"),
    studyImageWrapper: document.getElementById("study-image-wrapper"),
    studyImage: document.getElementById("study-image"),
    studyAnswerForm: document.getElementById("study-answer-form"),
    studyAnswer: document.getElementById("study-answer"),
    studyGermanCharacters: document.getElementById("study-german-characters"),
    studyFeedback: document.getElementById("study-feedback"),
    studyFeedbackNote: document.getElementById("study-feedback-note"),
    studyNextButton: document.getElementById("study-next-button"),
    studyEndButton: document.getElementById("study-end-button"),
    studyResultText: document.getElementById("study-result-text"),
    studyResetButton: document.getElementById("study-reset-button"),

    bulkImportFile: document.getElementById("bulk-import-file"),
    bulkImportButton: document.getElementById("bulk-import-button"),
    backupImportFile: document.getElementById("backup-import-file"),
    backupImportButton: document.getElementById("backup-import-button"),
    exportButton: document.getElementById("export-button"),
    importExportMessage: document.getElementById("import-export-message"),
};

bindEvents();
setCollectionColorInputDefault();
renderAll();

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
    elements.studyAnswerForm.addEventListener("submit", onStudyAnswerSubmit);
    elements.studyGermanCharacters.addEventListener("click", onStudyGermanCharacterClick);
    elements.studyNextButton.addEventListener("click", onStudyNext);
    elements.studyEndButton.addEventListener("click", endStudySession);
    elements.studyResetButton.addEventListener("click", resetStudyView);

    elements.bulkImportButton.addEventListener("click", onBulkImport);
    elements.backupImportButton.addEventListener("click", onBackupImport);
    elements.exportButton.addEventListener("click", onExport);
}

function switchTab(tabName) {
    elements.tabButtons.forEach((button) => {
        button.classList.toggle("active", button.dataset.tab === tabName);
    });

    elements.tabPanels.forEach((panel) => {
        panel.classList.toggle("active", panel.id === `tab-${tabName}`);
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

    const imageData = imageFile ? await fileToDataUrl(imageFile) : "";
    const existingCard = findExistingFlashcardByGerman(german);

    if (existingCard) {
        const { merged, added } = mergeEnglishAnswers(existingCard.englishAnswers, englishAnswers);

        existingCard.englishAnswers = merged;

        if (imageData && !existingCard.imageData) {
            existingCard.imageData = imageData;
        }

        console.info(
            `[Manual add] Reused existing card "${existingCard.german}". Added meanings: ${
                added.length > 0 ? added.join(", ") : "none"
            }.`,
        );
    } else {
        state.flashcards.push({
            id: crypto.randomUUID(),
            german,
            englishAnswers,
            imageData,
        });
    }

    persist();
    elements.flashcardForm.reset();
    renderAll();
}

function onFlashcardSearchInput(event) {
    flashcardSearchTerm = event.target.value;
    renderFlashcards();
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

function onCollectionSubmit(event) {
    event.preventDefault();

    const name = elements.collectionName.value.trim();
    if (!name) {
        return;
    }

    const { collection } = getOrCreateCollectionByName(name, elements.collectionColor.value);
    selectedCollectionId = collection.id;

    persist();
    elements.collectionForm.reset();
    setCollectionColorInputDefault();
    renderAll();
}

function onCollectionSearchInput(event) {
    collectionEditorSearchTerm = event.target.value;
    renderCollectionEditor();
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

    const imageData = imageFile ? await fileToDataUrl(imageFile) : "";
    let card = findExistingFlashcardByGerman(german);

    if (card) {
        const { merged, added } = mergeEnglishAnswers(card.englishAnswers, englishAnswers);
        card.englishAnswers = merged;

        if (imageData && !card.imageData) {
            card.imageData = imageData;
        }

        if (added.length > 0 || !collection.cardIds.includes(card.id)) {
            console.info(
                `[Collection add] Reused existing card "${card.german}" in "${collection.name}". Added meanings: ${
                    added.length > 0 ? added.join(", ") : "none"
                }.`
            );
        }
    } else {
        card = {
            id: crypto.randomUUID(),
            german,
            englishAnswers,
            imageData,
        };
        state.flashcards.push(card);
    }

    ensureCardInCollection(collection.id, card.id);

    persist();
    elements.collectionFlashcardForm.reset();
    renderAll();
}

function onStudySetupSubmit(event) {
    event.preventDefault();

    const collectionId = elements.studyCollection.value;
    const mode = elements.studyMode.value;
    const collection = state.collections.find((item) => item.id === collectionId);

    if (!collection) {
        showStudySetupMessage("Choose a collection first.");
        return;
    }

    let cards = state.flashcards.filter((card) => collection.cardIds.includes(card.id));

    if (mode === "image-de") {
        cards = cards.filter((card) => card.imageData);
    }

    if (cards.length === 0) {
        showStudySetupMessage(
            mode === "image-de"
                ? "This collection has no flashcards with images."
                : "This collection has no flashcards.",
        );
        return;
    }

    showStudySetupMessage("");
    studySession = createStudySession(cards, mode);
    elements.studyResultsBox.classList.add("hidden");
    elements.studySessionBox.classList.remove("hidden");
    renderStudyQuestion();
}

function onStudyAnswerSubmit(event) {
    event.preventDefault();

    if (!studySession || studySession.answered) {
        return;
    }

    const result = submitStudyAnswer(studySession, elements.studyAnswer.value);

    if (!result) {
        return;
    }

    elements.studyFeedback.textContent = result.message;
    elements.studyFeedbackNote.textContent = result.note;
    elements.studyFeedback.className = `study-feedback ${result.feedbackClass}`;
    elements.studyNextButton.classList.remove("hidden");
    elements.studyAnswer.disabled = true;
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
        const importedEntries = parseBulkWords(text);

        let createdCardsCount = 0;
        let reusedCardsCount = 0;
        let createdCollectionsCount = 0;

        const duplicateLogs = [];

        for (const entry of importedEntries) {
            let card = findExistingFlashcardByGerman(entry.card.german);
            const isDuplicate = Boolean(card);
            let addedMeanings = [];

            if (!card) {
                card = entry.card;
                state.flashcards.push(card);
                createdCardsCount += 1;
            } else {
                reusedCardsCount += 1;

                const mergeResult = mergeEnglishAnswers(
                    card.englishAnswers,
                    entry.card.englishAnswers,
                );

                card.englishAnswers = mergeResult.merged;
                addedMeanings = mergeResult.added;
            }

            const addedToCollections = [];

            for (const collectionName of entry.collectionNames) {
                const { collection, created } = getOrCreateCollectionByName(collectionName);

                if (!collection) {
                    continue;
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
                });
            }
        }

        if (duplicateLogs.length > 0) {
            console.groupCollapsed(
                `[Bulk import] Reused ${duplicateLogs.length} duplicate word(s)`,
            );

            duplicateLogs.forEach((item) => {
                console.info(
                    `Duplicate word reused: "${item.german}" (card id: ${item.reusedId}). ` +
                        `Added meanings: ${item.addedMeanings.length > 0 ? item.addedMeanings.join(", ") : "none"}. ` +
                        `Added to collections: ${item.addedToCollections.length > 0 ? item.addedToCollections.join(", ") : "none"}.`,
                );
            });

            console.groupEnd();
        }

        persist();
        renderAll();

        showImportExportMessage(
            `Imported complete. Created ${createdCardsCount} new flashcard(s), reused ${reusedCardsCount} duplicate(s), created ${createdCollectionsCount} new collection(s).`,
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
        state = replaceState(parseBackupText(text));
        selectedCollectionId = state.collections[0]?.id || null;
        selectedFlashcardIds.clear();
        resetStudyView();
        setCollectionColorInputDefault();
        renderAll();
        showImportExportMessage("Full backup imported successfully.", true);
        elements.backupImportFile.value = "";
    } catch (error) {
        showImportExportMessage(error.message || "Backup import failed.", false);
    }
}

function onExport() {
    const content = exportBackupText(state);
    downloadTextFile(content, "flashcards-backup.txt");
    showImportExportMessage("Export created.", true);
}

function renderAll() {
    pruneSelectedFlashcardIds();
    renderFlashcards();
    renderCollections();
    renderCollectionEditor();
    renderStudySetup();
}

function renderFlashcards() {
    const filteredCards = getFilteredFlashcards();
    const selectedCount = state.flashcards.filter((card) => selectedFlashcardIds.has(card.id)).length;

    elements.flashcardCount.textContent = `${filteredCards.length} shown / ${state.flashcards.length} total`;
    elements.flashcardSelectionSummary.textContent = `${selectedCount} selected`;
    elements.flashcardsEmpty.classList.toggle("hidden", filteredCards.length > 0);
    elements.flashcardsEmpty.textContent =
        state.flashcards.length === 0
            ? "No flashcards yet."
            : "No flashcards match your search.";
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
      <div class="item-subtitle">ID: ${escapeHtml(card.id)}</div>
      <div class="item-tags">${card.imageData ? "Has image card" : "No image"}</div>
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

    if (!selectedCollectionId && state.collections.length > 0) {
        selectedCollectionId = state.collections[0].id;
    }

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
      <div class="item-subtitle">${card.imageData ? "Has image" : "No image"}</div>
    `;
        text.appendChild(createCollectionPillsContainer(card.id));

        wrapper.append(checkbox, text);
        elements.collectionCardsEditor.appendChild(wrapper);
    });
}

function renderStudySetup() {
    elements.studyCollection.innerHTML = "";

    if (state.collections.length === 0) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "No collections available";
        elements.studyCollection.appendChild(option);
        return;
    }

    state.collections.forEach((collection) => {
        const option = document.createElement("option");
        option.value = collection.id;
        option.textContent = collection.name;
        elements.studyCollection.appendChild(option);
    });
}

function renderStudyQuestion() {
    const prompt = getCurrentPrompt(studySession);

    elements.studyProgress.textContent = `${studySession.currentIndex + 1} / ${studySession.cards.length}`;
    elements.studyPrompt.textContent = prompt.promptText;
    elements.studyAnswerForm.reset();
    elements.studyAnswer.disabled = false;
    elements.studyAnswer.focus();
    elements.studyFeedback.textContent = "";
    elements.studyFeedbackNote.textContent = "";
    elements.studyFeedback.className = "study-feedback";
    elements.studyNextButton.classList.add("hidden");
    elements.studyGermanCharacters.classList.toggle("hidden", !isGermanAnswerMode(studySession.mode));

    if (prompt.imageData) {
        elements.studyImage.src = prompt.imageData;
        elements.studyImageWrapper.classList.remove("hidden");
    } else {
        elements.studyImage.src = "";
        elements.studyImageWrapper.classList.add("hidden");
    }
}

function showStudyResults() {
    elements.studySessionBox.classList.add("hidden");
    elements.studyResultsBox.classList.remove("hidden");

    const total = studySession?.cards.length || 0;
    const score = studySession?.score || 0;
    elements.studyResultText.textContent = `You scored ${formatStudyScore(score)} out of ${formatStudyScore(total)}.`;
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
    state.flashcards = state.flashcards.filter((card) => !idsToDelete.has(card.id));

    state.collections = state.collections.map((collection) => ({
        ...collection,
        cardIds: collection.cardIds.filter((id) => !idsToDelete.has(id)),
    }));

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
        selectedCollectionId = state.collections[0]?.id || null;
    }

    if (collectionEditorFilterCollectionId === collectionId) {
        collectionEditorFilterCollectionId = "";
        elements.collectionFilterCollection.value = "";
    }

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
        currentValue === "" || state.collections.some((collection) => collection.id === currentValue);

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

    panel.append(germanLabel, englishLabel);

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

    panel.addEventListener("submit", (event) => {
        event.preventDefault();

        const german = germanInput.value.trim();
        const englishAnswers = parseEnglishAnswersInput(englishInput.value);

        if (!german || englishAnswers.length === 0) {
            window.alert("Please enter a German word and at least one English meaning.");
            return;
        }

        const conflictingCard = findExistingFlashcardByGerman(german);
        if (conflictingCard && conflictingCard.id !== card.id) {
            window.alert(
                `A different flashcard already uses the German word "${conflictingCard.german}". Edit that card instead or delete it first.`
            );
            return;
        }

        card.german = german;
        card.englishAnswers = englishAnswers;

        const selectedCollectionIds = Array.from(
            collectionsWrapper.querySelectorAll('input[type="checkbox"]:checked'),
            (input) => input.value,
        );
        setCardMemberships(card.id, selectedCollectionIds);

        editingFlashcardId = null;
        persist();
        renderAll();
    });

    return panel;
}

function toggleFlashcardEdit(cardId) {
    editingFlashcardId = editingFlashcardId === cardId ? null : cardId;
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

function persist() {
    saveState(state);
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

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Could not read image file."));
        reader.readAsDataURL(file);
    });
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
        (card.englishAnswers || []).some((answer) => normalizeWord(answer).includes(normalizedSearch))
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
