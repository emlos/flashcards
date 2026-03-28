export function createStudySession(cards, mode) {
    return {
        mode,
        cards: shuffle([...cards]),
        currentIndex: 0,
        score: 0,
        answered: false,
        currentPrompt: null,
    };
}

export function getCurrentCard(session) {
    return session.cards[session.currentIndex] || null;
}

export function buildPrompt(card, mode) {
    if (mode === "de-en") {
        return {
            promptText: card.german,
            correctAnswers: card.englishAnswers || [],
            imageData: "",
        };
    }

    if (mode === "en-de") {
        const englishAnswers = card.englishAnswers || [];
        const promptText = englishAnswers[Math.floor(Math.random() * englishAnswers.length)] || "";

        return {
            promptText,
            correctAnswers: [card.german],
            imageData: "",
        };
    }

    if (mode === "image-de") {
        return {
            promptText: "Type the German word for this image.",
            correctAnswers: [card.german],
            imageData: card.imageData || "",
        };
    }

    throw new Error(`Unknown study mode: ${mode}`);
}

export function checkAnswer(input, correctAnswers) {
    return (correctAnswers || []).some((answer) => normalize(input) === normalize(answer));
}

export function advanceSession(session) {
    session.currentIndex += 1;
    session.answered = false;
    session.currentPrompt = null;
}

export function isSessionFinished(session) {
    return session.currentIndex >= session.cards.length;
}

function normalize(value) {
    return String(value || "")
        .trim()
        .toLocaleLowerCase();
}

function shuffle(items) {
    for (let i = items.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }

    return items;
}
