import { PAGINATION_PAGE_SIZES } from "./constants.js";
import {
    buildFlashcardEditSaveMessage,
    escapeHtml,
    getCollectionColor,
    matchesCardSearch,
    parseEnglishAnswersInput,
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

export function createFlashcardsUi(context) {
    const {
        elements,
        getState,
        getSelectedCollectionId,
        setSelectedCollectionId,
        getFlashcardSearchTerm,
        getCollectionEditorSearchTerm,
        getCollectionEditorMembershipFilter,
        getCollectionEditorFilterCollectionId,
        setCollectionEditorFilterCollectionId,
        getEditingFlashcardId,
        setEditingFlashcardId,
        selectedFlashcardIds,
        getPaginationSlice,
        renderPaginationControls,
        requestFlashcardDeletion,
        deleteCollection,
        toggleCardInCollection,
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
    } = context;

    const state = createStateProxy(getState);

    function renderFlashcards() {
        const filteredCards = getFilteredFlashcards();
        const paginatedCards = getPaginationSlice(
            filteredCards,
            "flashcards",
            PAGINATION_PAGE_SIZES.flashcards,
        );
        const selectedCount = state.flashcards.filter((card) =>
            selectedFlashcardIds.has(card.id),
        ).length;
        const editingFlashcardId = getEditingFlashcardId();

        elements.flashcardCount.textContent = `${filteredCards.length} shown / ${state.flashcards.length} total`;
        elements.flashcardSelectionSummary.textContent = `${selectedCount} selected`;
        elements.flashcardsEmpty.classList.toggle("hidden", filteredCards.length > 0);
        elements.flashcardsEmpty.textContent =
            state.flashcards.length === 0
                ? "No flashcards yet."
                : "No flashcards match your search.";
        elements.flashcardsList.innerHTML = "";

        elements.flashcardSelectVisible.disabled = paginatedCards.items.length === 0;
        elements.flashcardClearSelection.disabled = selectedCount === 0;
        elements.flashcardDeleteSelected.disabled = selectedCount === 0;

        paginatedCards.items.forEach((card) => {
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
            deleteButton.addEventListener("click", () => {
                void requestFlashcardDeletion([card.id], { allowSkipPrompt: true });
            });
            side.appendChild(deleteButton);

            row.append(left, main, side);
            elements.flashcardsList.appendChild(row);
        });

        renderPaginationControls(elements.flashcardsPagination, {
            key: "flashcards",
            pageSize: PAGINATION_PAGE_SIZES.flashcards,
            totalItems: paginatedCards.totalItems,
            currentPage: paginatedCards.currentPage,
            totalPages: paginatedCards.totalPages,
        });
    }

    function renderCollections() {
        const paginatedCollections = getPaginationSlice(
            state.collections,
            "collections",
            PAGINATION_PAGE_SIZES.collections,
        );

        elements.collectionCount.textContent = `${state.collections.length} total`;
        elements.collectionsEmpty.classList.toggle("hidden", state.collections.length > 0);
        elements.collectionsList.innerHTML = "";

        const validSelectedCollectionId = getValidSelectedCollectionId(getSelectedCollectionId());
        setSelectedCollectionId(validSelectedCollectionId);

        paginatedCollections.items.forEach((collection) => {
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
                void context.updateCollectionColor(collection.id, colorInput.value);
            });

            const selectButton = document.createElement("button");
            selectButton.type = "button";
            selectButton.className = collection.id === getSelectedCollectionId() ? "" : "secondary";
            selectButton.textContent =
                collection.id === getSelectedCollectionId() ? "Selected" : "Edit";
            selectButton.addEventListener("click", () => {
                setSelectedCollectionId(collection.id);
                resetPaginationPage("collectionEditor");
                updateUiPrefs({ selectedCollectionId: collection.id || "" });
                renderCollections();
                renderCollectionEditor();
            });

            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "secondary";
            deleteButton.textContent = "Delete";
            deleteButton.addEventListener("click", () => {
                void deleteCollection(collection.id);
            });

            side.append(colorInput, selectButton, deleteButton);
            row.append(main, side);
            elements.collectionsList.appendChild(row);
        });

        renderPaginationControls(elements.collectionsPagination, {
            key: "collections",
            pageSize: PAGINATION_PAGE_SIZES.collections,
            totalItems: paginatedCollections.totalItems,
            currentPage: paginatedCollections.currentPage,
            totalPages: paginatedCollections.totalPages,
        });
    }

    function renderCollectionEditor() {
        const collection = state.collections.find((item) => item.id === getSelectedCollectionId());

        populateCollectionFilterOptions();

        if (!collection) {
            elements.collectionEditor.classList.add("hidden");
            elements.collectionEditorEmpty.classList.remove("hidden");
            elements.selectedCollectionName.textContent = "Select a collection";
            elements.collectionFlashcardForm.reset();
            elements.collectionCardsEditor.innerHTML = "";
            elements.collectionEditorSummary.textContent = "";
            elements.collectionEditorPagination.classList.add("hidden");
            return;
        }

        elements.collectionEditor.classList.remove("hidden");
        elements.collectionEditorEmpty.classList.add("hidden");
        elements.selectedCollectionName.textContent = collection.name;
        elements.collectionCardsEditor.innerHTML = "";

        const filteredCards = getFilteredCollectionEditorCards(collection);
        const paginatedCards = getPaginationSlice(
            filteredCards,
            "collectionEditor",
            PAGINATION_PAGE_SIZES.collectionEditor,
        );
        elements.collectionEditorSummary.textContent = `${filteredCards.length} shown / ${state.flashcards.length} total`;

        if (state.flashcards.length === 0) {
            elements.collectionCardsEditor.innerHTML = `<div class="empty-state">Create flashcards first.</div>`;
            elements.collectionEditorPagination.classList.add("hidden");
            return;
        }

        if (filteredCards.length === 0) {
            elements.collectionCardsEditor.innerHTML = `<div class="empty-state">No flashcards match the current filters.</div>`;
            elements.collectionEditorPagination.classList.add("hidden");
            return;
        }

        paginatedCards.items.forEach((card) => {
            const wrapper = document.createElement("label");
            wrapper.className = "checkbox-item";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = collection.cardIds.includes(card.id);
            checkbox.addEventListener("change", () => {
                void toggleCardInCollection(collection.id, card.id, checkbox.checked);
            });

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

        renderPaginationControls(elements.collectionEditorPagination, {
            key: "collectionEditor",
            pageSize: PAGINATION_PAGE_SIZES.collectionEditor,
            totalItems: paginatedCards.totalItems,
            currentPage: paginatedCards.currentPage,
            totalPages: paginatedCards.totalPages,
        });
    }

    function populateCollectionFilterOptions() {
        const currentValue = getCollectionEditorFilterCollectionId();
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

        setCollectionEditorFilterCollectionId(hasCurrentValue ? currentValue : "");
        elements.collectionFilterCollection.value = getCollectionEditorFilterCollectionId();
        elements.collectionMembershipFilter.value = getCollectionEditorMembershipFilter();
    }

    function getFilteredFlashcards() {
        return state.flashcards.filter((card) => matchesCardSearch(card, getFlashcardSearchTerm()));
    }

    function getFilteredCollectionEditorCards(selectedCollection) {
        return state.flashcards.filter((card) => {
            if (!matchesCardSearch(card, getCollectionEditorSearchTerm())) {
                return false;
            }

            const memberships = getCardMemberships(card.id);
            const isInSelectedCollection = selectedCollection.cardIds.includes(card.id);
            const membershipFilter = getCollectionEditorMembershipFilter();
            const filterCollectionId = getCollectionEditorFilterCollectionId();

            if (membershipFilter === "in-selected" && !isInSelectedCollection) {
                return false;
            }

            if (membershipFilter === "not-in-selected" && isInSelectedCollection) {
                return false;
            }

            if (membershipFilter === "has-collections" && memberships.length === 0) {
                return false;
            }

            if (membershipFilter === "no-collections" && memberships.length > 0) {
                return false;
            }

            if (
                filterCollectionId &&
                !memberships.some((membership) => membership.id === filterCollectionId)
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
            setEditingFlashcardId(null);
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

                setEditingFlashcardId(null);

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
                showAppStatusMessage(
                    error?.message || "Could not process that image upload.",
                    false,
                );
                saveButton.disabled = false;
                cancelButton.disabled = false;
            }
        });

        return panel;
    }

    function toggleFlashcardEdit(cardId) {
        setEditingFlashcardId(getEditingFlashcardId() === cardId ? null : cardId);
        renderFlashcards();
    }

    return {
        renderFlashcards,
        renderCollections,
        renderCollectionEditor,
        populateCollectionFilterOptions,
        getFilteredFlashcards,
        getFilteredCollectionEditorCards,
        createCollectionPillsContainer,
        getCardMemberships,
        createFlashcardEditPanel,
        toggleFlashcardEdit,
    };
}
