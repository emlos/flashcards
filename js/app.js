import { loadState, saveState, replaceState } from "./storage.js";
import { parseBulkWords, exportBackupText, parseBackupText } from "./import-export.js";
import { createStudySession, getCurrentCard, buildPrompt, checkAnswer, advanceSession, isSessionFinished } from "./study.js";

let state = loadState();
let selectedCollectionId = null;
let studySession = null;

const elements = {
  tabButtons: Array.from(document.querySelectorAll(".tab-button")),
  tabPanels: Array.from(document.querySelectorAll(".tab-panel")),

  flashcardForm: document.getElementById("flashcard-form"),
  flashcardGerman: document.getElementById("flashcard-german"),
  flashcardEnglish: document.getElementById("flashcard-english"),
  flashcardImage: document.getElementById("flashcard-image"),
  flashcardsList: document.getElementById("flashcards-list"),
  flashcardsEmpty: document.getElementById("flashcards-empty"),
  flashcardCount: document.getElementById("flashcard-count"),

  collectionForm: document.getElementById("collection-form"),
  collectionName: document.getElementById("collection-name"),
  collectionsList: document.getElementById("collections-list"),
  collectionsEmpty: document.getElementById("collections-empty"),
  collectionCount: document.getElementById("collection-count"),
  selectedCollectionName: document.getElementById("selected-collection-name"),
  collectionEditor: document.getElementById("collection-editor"),
  collectionEditorEmpty: document.getElementById("collection-editor-empty"),
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
  studyFeedback: document.getElementById("study-feedback"),
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
renderAll();

function bindEvents() {
  elements.tabButtons.forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  elements.flashcardForm.addEventListener("submit", onFlashcardSubmit);
  elements.collectionForm.addEventListener("submit", onCollectionSubmit);
  elements.studySetupForm.addEventListener("submit", onStudySetupSubmit);
  elements.studyAnswerForm.addEventListener("submit", onStudyAnswerSubmit);
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
  const english = elements.flashcardEnglish.value.trim();
  const imageFile = elements.flashcardImage.files[0];

  if (!german || !english) {
    return;
  }

  const imageData = imageFile ? await fileToDataUrl(imageFile) : "";

  state.flashcards.push({
    id: crypto.randomUUID(),
    german,
    english,
    imageData,
  });

  persist();
  elements.flashcardForm.reset();
  renderAll();
}

function onCollectionSubmit(event) {
  event.preventDefault();

  const name = elements.collectionName.value.trim();
  if (!name) {
    return;
  }

  const collection = {
    id: crypto.randomUUID(),
    name,
    cardIds: [],
  };

  state.collections.push(collection);
  selectedCollectionId = collection.id;
  persist();
  elements.collectionForm.reset();
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
        : "This collection has no flashcards."
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

  const card = getCurrentCard(studySession);
  const prompt = buildPrompt(card, studySession.mode);
  const answer = elements.studyAnswer.value;
  const isCorrect = checkAnswer(answer, prompt.correctAnswer);

  studySession.answered = true;
  if (isCorrect) {
    studySession.score += 1;
  }

  elements.studyFeedback.textContent = isCorrect
    ? "Correct."
    : `Incorrect. Correct answer: ${prompt.correctAnswer}`;
  elements.studyFeedback.className = `study-feedback ${isCorrect ? "correct" : "incorrect"}`;
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
  elements.studyFeedback.className = "study-feedback";
  elements.studyAnswerForm.reset();
  elements.studyAnswer.disabled = false;
  elements.studyNextButton.classList.add("hidden");
  elements.studyImageWrapper.classList.add("hidden");
}

async function onBulkImport() {
  const file = elements.bulkImportFile.files[0];

  if (!file) {
    showImportExportMessage("Choose a bulk-import TXT file first.", false);
    return;
  }

  try {
    const text = await file.text();
    const newCards = parseBulkWords(text);
    state.flashcards.push(...newCards);
    persist();
    renderAll();
    showImportExportMessage(`Imported ${newCards.length} flashcards.`, true);
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
    resetStudyView();
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
  renderFlashcards();
  renderCollections();
  renderCollectionEditor();
  renderStudySetup();
}

function renderFlashcards() {
  elements.flashcardCount.textContent = `${state.flashcards.length} total`;
  elements.flashcardsEmpty.classList.toggle("hidden", state.flashcards.length > 0);
  elements.flashcardsList.innerHTML = "";

  state.flashcards.forEach((card) => {
    const row = document.createElement("div");
    row.className = "item-row";

    const main = document.createElement("div");
    main.className = "item-row-main";
    main.innerHTML = `
      <div class="item-title">${escapeHtml(card.german)} — ${escapeHtml(card.english)}</div>
      <div class="item-subtitle">ID: ${escapeHtml(card.id)}</div>
      <div class="item-tags">${card.imageData ? "Has image card" : "No image"}</div>
    `;

    const side = document.createElement("div");
    side.className = "item-row-side";

    if (card.imageData) {
      const img = document.createElement("img");
      img.className = "flashcard-thumbnail";
      img.src = card.imageData;
      img.alt = card.german;
      side.appendChild(img);
    }

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "secondary";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => deleteFlashcard(card.id));
    side.appendChild(deleteButton);

    row.append(main, side);
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
    main.innerHTML = `
      <div class="item-title">${escapeHtml(collection.name)}</div>
      <div class="item-subtitle">${collection.cardIds.length} card(s)</div>
    `;

    const side = document.createElement("div");
    side.className = "item-row-side";

    const selectButton = document.createElement("button");
    selectButton.type = "button";
    selectButton.className = collection.id === selectedCollectionId ? "" : "secondary";
    selectButton.textContent = collection.id === selectedCollectionId ? "Selected" : "Edit";
    selectButton.addEventListener("click", () => {
      selectedCollectionId = collection.id;
      renderCollectionEditor();
      renderCollections();
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "secondary";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => deleteCollection(collection.id));

    side.append(selectButton, deleteButton);
    row.append(main, side);
    elements.collectionsList.appendChild(row);
  });
}

function renderCollectionEditor() {
  const collection = state.collections.find((item) => item.id === selectedCollectionId);

  if (!collection) {
    elements.collectionEditor.classList.add("hidden");
    elements.collectionEditorEmpty.classList.remove("hidden");
    elements.selectedCollectionName.textContent = "Select a collection";
    return;
  }

  elements.collectionEditor.classList.remove("hidden");
  elements.collectionEditorEmpty.classList.add("hidden");
  elements.selectedCollectionName.textContent = collection.name;
  elements.collectionCardsEditor.innerHTML = "";

  state.flashcards.forEach((card) => {
    const wrapper = document.createElement("label");
    wrapper.className = "checkbox-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = collection.cardIds.includes(card.id);
    checkbox.addEventListener("change", () => toggleCardInCollection(collection.id, card.id, checkbox.checked));

    const text = document.createElement("div");
    text.innerHTML = `
      <div class="item-title">${escapeHtml(card.german)} — ${escapeHtml(card.english)}</div>
      <div class="item-subtitle">${card.imageData ? "Has image" : "No image"}</div>
    `;

    wrapper.append(checkbox, text);
    elements.collectionCardsEditor.appendChild(wrapper);
  });

  if (state.flashcards.length === 0) {
    elements.collectionCardsEditor.innerHTML = `<div class="empty-state">Create flashcards first.</div>`;
  }
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
  const card = getCurrentCard(studySession);
  const prompt = buildPrompt(card, studySession.mode);

  elements.studyProgress.textContent = `${studySession.currentIndex + 1} / ${studySession.cards.length}`;
  elements.studyPrompt.textContent = prompt.promptText;
  elements.studyAnswerForm.reset();
  elements.studyAnswer.disabled = false;
  elements.studyAnswer.focus();
  elements.studyFeedback.textContent = "";
  elements.studyFeedback.className = "study-feedback";
  elements.studyNextButton.classList.add("hidden");

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
  elements.studyResultText.textContent = `You scored ${score} out of ${total}.`;
}

function deleteFlashcard(cardId) {
  state.flashcards = state.flashcards.filter((card) => card.id !== cardId);

  state.collections = state.collections.map((collection) => ({
    ...collection,
    cardIds: collection.cardIds.filter((id) => id !== cardId),
  }));

  persist();
  renderAll();
}

function deleteCollection(collectionId) {
  state.collections = state.collections.filter((collection) => collection.id !== collectionId);

  if (selectedCollectionId === collectionId) {
    selectedCollectionId = state.collections[0]?.id || null;
  }

  persist();
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
}

function persist() {
  saveState(state);
}

function showStudySetupMessage(message) {
  elements.studySetupMessage.textContent = message;
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
