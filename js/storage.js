const STORAGE_KEY = "de_en_flashcards_app_v1";

function defaultState() {
  return {
    flashcards: [],
    collections: [],
  };
}

export function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return defaultState();
  }

  try {
    const parsed = JSON.parse(raw);

    return {
      flashcards: Array.isArray(parsed.flashcards) ? parsed.flashcards : [],
      collections: Array.isArray(parsed.collections) ? parsed.collections : [],
    };
  } catch (error) {
    console.error("Failed to parse saved state.", error);
    return defaultState();
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function replaceState(nextState) {
  const safeState = {
    flashcards: Array.isArray(nextState.flashcards) ? nextState.flashcards : [],
    collections: Array.isArray(nextState.collections) ? nextState.collections : [],
  };

  saveState(safeState);
  return safeState;
}
