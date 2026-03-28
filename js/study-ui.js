import {
    GERMAN_SPEECH_LANGUAGE,
    PAGINATION_PAGE_SIZES,
    STUDY_ALL_COLLECTION_ID,
} from "./constants.js";
import {
    createEmptyStateRow,
    escapeHtml,
    formatAccuracy,
    formatRelativeDateLabel,
    formatSessionCompletionLabel,
    formatSessionTimestamp,
    formatStudyModeLabel,
    formatStudyScore,
    getEffectiveStudyCardCount,
    parseStudyCardLimit,
} from "./shared-utils.js";

function createStateProxy(getState) {
    return new Proxy(
        {},
        {
            get(_target, property) {
                return getState()?.[property];
            },
            set(_target, property, value) {
                getState()[property] = value;
                return true;
            },
        },
    );
}

export function createStudyUi(context) {
    const {
        elements,
        getState,
        getStudySession,
        setStudySession,
        getSelectedStudyCollectionIds,
        setSelectedStudyCollectionIds,
        getCurrentPrompt,
        getPaginationSlice,
        renderPaginationControls,
        persist,
        showAppStatusMessage,
        updateUiPrefs,
    } = context;

    const state = createStateProxy(getState);
    let hasBoundSpeechSynthesisEvents = false;

    function renderStudySetup() {
        sanitizeStudyCollectionSelection();
        elements.studyCollectionOptions.innerHTML = "";

        elements.studyCollectionOptions.appendChild(
            createStudyCollectionOption({
                id: STUDY_ALL_COLLECTION_ID,
                label: "All flashcards",
                count: state.flashcards.length,
                checked: getSelectedStudyCollectionIds().has(STUDY_ALL_COLLECTION_ID),
                note: "Includes every flashcard, even if it is not in a collection.",
            }),
        );

        state.collections.forEach((collection) => {
            elements.studyCollectionOptions.appendChild(
                createStudyCollectionOption({
                    id: collection.id,
                    label: collection.name,
                    count: collection.cardIds.length,
                    checked: getSelectedStudyCollectionIds().has(collection.id),
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
        renderStudyModeAvailability();
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
        const historyEntries = [...(state.studyHistory || [])].sort(
            (left, right) => Date.parse(right.finishedAt) - Date.parse(left.finishedAt),
        );
        const paginatedHistoryEntries = getPaginationSlice(
            historyEntries,
            "studyHistory",
            PAGINATION_PAGE_SIZES.studyHistory,
        );

        elements.studyHistorySummary.textContent = `${state.studyHistory.length} saved session${state.studyHistory.length === 1 ? "" : "s"}`;
        elements.studyHistoryList.innerHTML = "";

        if (historyEntries.length === 0) {
            elements.studyHistoryList.appendChild(
                createEmptyStateRow(
                    "No study sessions yet. Finish a session and it will show up here.",
                ),
            );
            elements.studyHistoryPagination.classList.add("hidden");
            return;
        }

        paginatedHistoryEntries.items.forEach((entry) => {
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

        renderPaginationControls(elements.studyHistoryPagination, {
            key: "studyHistory",
            pageSize: PAGINATION_PAGE_SIZES.studyHistory,
            totalItems: paginatedHistoryEntries.totalItems,
            currentPage: paginatedHistoryEntries.currentPage,
            totalPages: paginatedHistoryEntries.totalPages,
        });
    }

    function renderStrugglingCards() {
        const strugglingEntries = getStrugglingCardEntries();
        const paginatedStrugglingEntries = getPaginationSlice(
            strugglingEntries,
            "strugglingCards",
            PAGINATION_PAGE_SIZES.strugglingCards,
        );
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
            elements.strugglingCardsPagination.classList.add("hidden");
            return;
        }

        paginatedStrugglingEntries.items.forEach(({ card, stats }) => {
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

        renderPaginationControls(elements.strugglingCardsPagination, {
            key: "strugglingCards",
            pageSize: PAGINATION_PAGE_SIZES.strugglingCards,
            totalItems: paginatedStrugglingEntries.totalItems,
            currentPage: paginatedStrugglingEntries.currentPage,
            totalPages: paginatedStrugglingEntries.totalPages,
        });
    }

    function renderCardStats() {
        const studiedEntries = getStudiedCardEntries().sort((left, right) => {
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
        });
        const paginatedStudiedEntries = getPaginationSlice(
            studiedEntries,
            "cardStats",
            PAGINATION_PAGE_SIZES.cardStats,
        );

        elements.cardStatsSummary.textContent =
            studiedEntries.length > 0
                ? `Showing ${studiedEntries.length} studied card${studiedEntries.length === 1 ? "" : "s"}`
                : "No card stats yet";
        elements.cardStatsList.innerHTML = "";

        if (studiedEntries.length === 0) {
            elements.cardStatsList.appendChild(
                createEmptyStateRow(
                    "Per-card study stats will appear after you answer some cards.",
                ),
            );
            elements.cardStatsPagination.classList.add("hidden");
            return;
        }

        paginatedStudiedEntries.items.forEach(({ card, stats }) => {
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

        renderPaginationControls(elements.cardStatsPagination, {
            key: "cardStats",
            pageSize: PAGINATION_PAGE_SIZES.cardStats,
            totalItems: paginatedStudiedEntries.totalItems,
            currentPage: paginatedStudiedEntries.currentPage,
            totalPages: paginatedStudiedEntries.totalPages,
        });
    }

    function renderStudyQuestion() {
        const studySession = getStudySession();
        const prompt = getCurrentPrompt(studySession);

        cancelSpeechPlayback();
        elements.studyProgress.textContent = `${studySession.currentIndex + 1} / ${studySession.cards.length}`;
        elements.studyPrompt.textContent = prompt.promptText;
        elements.studyAnswerForm.reset();
        elements.studyAnswer.disabled = false;
        elements.studyCheckButton.disabled = false;
        elements.studyAnswerForm.classList.remove("study-answer-form-complete");
        elements.studyFeedback.textContent = "";
        elements.studyFeedbackNote.textContent = "";
        elements.studyFeedback.className = "study-feedback";
        elements.studyNextButton.classList.add("hidden");
        renderStudyResponseControls(prompt);
        renderStudyPronunciationControls();

        if (prompt.imageData) {
            elements.studyImage.src = prompt.imageData;
            elements.studyImageWrapper.classList.remove("hidden");
        } else {
            elements.studyImage.src = "";
            elements.studyImageWrapper.classList.add("hidden");
        }
    }

    function renderStudyResponseControls(prompt) {
        const isChoicePrompt = prompt?.responseKind === "choice";

        elements.studyAnswerForm.classList.toggle("hidden", isChoicePrompt);
        elements.studyChoiceOptions.classList.toggle("hidden", !isChoicePrompt);

        if (isChoicePrompt) {
            elements.studyGermanCharacters.classList.add("hidden");
            renderStudyChoiceOptions(prompt);

            const firstChoiceButton = elements.studyChoiceOptions.querySelector(
                "button[data-choice-value]",
            );
            if (firstChoiceButton) {
                firstChoiceButton.focus();
            }
            return;
        }

        elements.studyChoiceOptions.innerHTML = "";
        elements.studyGermanCharacters.classList.toggle("hidden", !prompt.expectsGermanAnswer);
        elements.studyAnswer.focus();
    }

    function renderStudyChoiceOptions(prompt) {
        const choiceOptions = Array.isArray(prompt?.choiceOptions) ? prompt.choiceOptions : [];
        const selectedChoice = String(prompt?.selectedChoice || "");
        const studySession = getStudySession();

        elements.studyChoiceOptions.innerHTML = "";

        choiceOptions.forEach((option, index) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "secondary study-choice-button";
            button.dataset.choiceValue = option.text;
            button.disabled = Boolean(studySession?.answered);

            if (studySession?.answered) {
                if (option.isCorrect) {
                    button.classList.add("is-correct");
                }

                if (selectedChoice === option.text) {
                    button.classList.add("is-selected");

                    if (!option.isCorrect) {
                        button.classList.add("is-selected-wrong");
                    }
                }
            }

            const optionIndex = document.createElement("span");
            optionIndex.className = "study-choice-index";
            optionIndex.textContent = String.fromCharCode(65 + index);

            const optionText = document.createElement("span");
            optionText.className = "study-choice-text";
            optionText.textContent = option.text;

            button.append(optionIndex, optionText);
            elements.studyChoiceOptions.appendChild(button);
        });
    }

    function showStudyResults() {
        cancelSpeechPlayback();
        finalizeStudySession();
        elements.studySessionBox.classList.add("hidden");
        elements.studyResultsBox.classList.remove("hidden");

        const studySession = getStudySession();
        const total = studySession?.cards.length || 0;
        const score = studySession?.score || 0;
        const answeredCount = studySession?.answeredCount || 0;
        const completionNote =
            answeredCount < total ? ` You answered ${answeredCount} of ${total} card(s).` : "";
        elements.studyResultText.textContent = `You scored ${formatStudyScore(score)} out of ${formatStudyScore(total)}.${completionNote}`;
    }

    function onStudyPronunciationButtonClick(event) {
        const germanWord = event.currentTarget?.dataset.germanWord || "";
        playGermanPronunciation(germanWord);
    }

    function bindSpeechSynthesisEvents() {
        if (hasBoundSpeechSynthesisEvents) {
            return;
        }

        const speechSynthesisApi = getSpeechSynthesisApi();

        if (!speechSynthesisApi || typeof speechSynthesisApi.addEventListener !== "function") {
            return;
        }

        speechSynthesisApi.addEventListener("voiceschanged", renderStudyPronunciationControls);
        hasBoundSpeechSynthesisEvents = true;
    }

    function getSpeechSynthesisApi() {
        if (
            typeof window === "undefined" ||
            typeof window.speechSynthesis === "undefined" ||
            typeof window.SpeechSynthesisUtterance !== "function"
        ) {
            return null;
        }

        return window.speechSynthesis;
    }

    function getPreferredGermanVoice() {
        const speechSynthesisApi = getSpeechSynthesisApi();

        if (!speechSynthesisApi || typeof speechSynthesisApi.getVoices !== "function") {
            return null;
        }

        const voices = speechSynthesisApi.getVoices();

        return (
            voices.find(
                (voice) =>
                    String(voice?.lang || "").toLowerCase() ===
                    GERMAN_SPEECH_LANGUAGE.toLowerCase(),
            ) ||
            voices.find((voice) =>
                String(voice?.lang || "")
                    .toLowerCase()
                    .startsWith("de"),
            ) ||
            null
        );
    }

    function playGermanPronunciation(germanWord) {
        const text = String(germanWord || "").trim();

        if (!text) {
            return;
        }

        const speechSynthesisApi = getSpeechSynthesisApi();

        if (!speechSynthesisApi) {
            showAppStatusMessage("Speech playback is not available in this browser.", false);
            return;
        }

        const utterance = new SpeechSynthesisUtterance(text);
        const germanVoice = getPreferredGermanVoice();
        utterance.lang = GERMAN_SPEECH_LANGUAGE;
        utterance.rate = 0.95;

        if (germanVoice) {
            utterance.voice = germanVoice;
        }

        utterance.onerror = () => {
            showAppStatusMessage(`Could not play pronunciation for “${text}”.`, false);
        };

        speechSynthesisApi.cancel();
        speechSynthesisApi.speak(utterance);
    }

    function cancelSpeechPlayback() {
        const speechSynthesisApi = getSpeechSynthesisApi();

        if (!speechSynthesisApi) {
            return;
        }

        speechSynthesisApi.cancel();
    }

    function setPronunciationButtonState(button, germanWord, visible) {
        if (!button) {
            return;
        }

        const text = String(germanWord || "").trim();
        const hasText = Boolean(text);
        const isSupported = Boolean(getSpeechSynthesisApi());

        button.dataset.germanWord = text;
        button.disabled = !hasText || !isSupported;
        button.title = hasText
            ? `Play German pronunciation for ${text}`
            : "Play German pronunciation";
        button.setAttribute(
            "aria-label",
            hasText ? `Play German pronunciation for ${text}` : "Play German pronunciation",
        );
        button.classList.toggle("hidden", !visible);
    }

    function renderStudyPronunciationControls() {
        const studySession = getStudySession();
        const currentCard = studySession?.cards?.[studySession.currentIndex] || null;
        const prompt = studySession ? getCurrentPrompt(studySession) : null;
        const promptGermanWord = ["de-en", "mc-de-en"].includes(prompt?.promptMode)
            ? currentCard?.german || prompt?.promptText || ""
            : "";
        const feedbackGermanWord = studySession?.answered ? currentCard?.german || "" : "";

        setPronunciationButtonState(
            elements.studyPromptAudioButton,
            promptGermanWord,
            Boolean(promptGermanWord),
        );
        setPronunciationButtonState(
            elements.studyFeedbackAudioButton,
            feedbackGermanWord,
            Boolean(feedbackGermanWord),
        );
        elements.studyFeedbackAudioRow.classList.toggle("hidden", !feedbackGermanWord);
    }

    function onStudyCollectionOptionsChange(event) {
        const checkbox = event.target.closest('input[type="checkbox"][data-study-collection-id]');

        if (!checkbox) {
            return;
        }

        const collectionId = checkbox.dataset.studyCollectionId || "";

        if (collectionId === STUDY_ALL_COLLECTION_ID) {
            const nextSelectedIds = new Set([STUDY_ALL_COLLECTION_ID]);
            setSelectedStudyCollectionIds(nextSelectedIds);
            updateUiPrefs({ selectedStudyCollectionIds: [...nextSelectedIds] });
            renderStudySetup();
            return;
        }

        const nextSelectedIds = new Set(getSelectedStudyCollectionIds());
        nextSelectedIds.delete(STUDY_ALL_COLLECTION_ID);

        if (checkbox.checked) {
            nextSelectedIds.add(collectionId);
        } else {
            nextSelectedIds.delete(collectionId);
        }

        if (nextSelectedIds.size === 0) {
            nextSelectedIds.add(STUDY_ALL_COLLECTION_ID);
        }

        setSelectedStudyCollectionIds(nextSelectedIds);
        updateUiPrefs({ selectedStudyCollectionIds: [...nextSelectedIds] });
        renderStudySetup();
    }

    function finalizeStudySession() {
        const studySession = getStudySession();

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
                    right.stats.timesSeen > 0
                        ? right.stats.timesCorrect / right.stats.timesSeen
                        : 0;

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
        const nextSelectedIds = [...getSelectedStudyCollectionIds()].filter(
            (id) => id === STUDY_ALL_COLLECTION_ID || validCollectionIds.has(id),
        );

        if (nextSelectedIds.length === 0 || nextSelectedIds.includes(STUDY_ALL_COLLECTION_ID)) {
            setSelectedStudyCollectionIds(new Set([STUDY_ALL_COLLECTION_ID]));
            return;
        }

        setSelectedStudyCollectionIds(new Set(nextSelectedIds));
    }

    function getStudyCollectionSummaryText() {
        const cards = getStudyCardsForSelection();
        const selectedStudyCollectionIds = getSelectedStudyCollectionIds();

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
        const selectedStudyCollectionIds = getSelectedStudyCollectionIds();

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

    function getStudyCollectionsForSelection() {
        sanitizeStudyCollectionSelection();
        const selectedStudyCollectionIds = getSelectedStudyCollectionIds();

        if (selectedStudyCollectionIds.has(STUDY_ALL_COLLECTION_ID)) {
            return [...state.collections];
        }

        return state.collections.filter((collection) =>
            selectedStudyCollectionIds.has(collection.id),
        );
    }

    function renderStudyModeAvailability() {
        const multipleChoiceOption = elements.studyMode?.querySelector('option[value="mc-de-en"]');

        if (!multipleChoiceOption) {
            return;
        }

        const cardLimit = parseStudyCardLimit(elements.studyCardLimit?.value);
        const selectedCards = getStudyCardsForSelection();
        const effectiveCardCount = Number.isNaN(cardLimit)
            ? selectedCards.length
            : getEffectiveStudyCardCount(selectedCards, cardLimit);
        const isMultipleChoiceAvailable = effectiveCardCount >= 5;

        multipleChoiceOption.disabled = !isMultipleChoiceAvailable;

        if (!isMultipleChoiceAvailable && elements.studyMode.value === "mc-de-en") {
            elements.studyMode.value = "de-en";
            updateUiPrefs({
                studyMode: "de-en",
                studyCardLimit: elements.studyCardLimit.value.trim(),
            });
        }
    }

    function getStudySelectionEmptyMessage(needsImages) {
        const selectedStudyCollectionIds = getSelectedStudyCollectionIds();

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

    return {
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
    };
}
