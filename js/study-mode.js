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
    return session?.cards?.[session.currentIndex] || null;
}

export function getCurrentPrompt(session) {
    if (!session) {
        return null;
    }

    if (!session.currentPrompt) {
        const card = getCurrentCard(session);
        session.currentPrompt = card ? buildPrompt(card, session.mode) : null;
    }

    return session.currentPrompt;
}

export function buildPrompt(card, mode) {
    const promptMode = resolvePromptMode(card, mode);

    if (promptMode === "de-en") {
        return {
            promptMode,
            promptText: card.german,
            correctAnswers: card.englishAnswers || [],
            imageData: "",
            expectsGermanAnswer: false,
        };
    }

    if (promptMode === "en-de") {
        const englishAnswers = card.englishAnswers || [];
        const promptText = englishAnswers[Math.floor(Math.random() * englishAnswers.length)] || "";

        return {
            promptMode,
            promptText,
            correctAnswers: [card.german],
            imageData: "",
            expectsGermanAnswer: true,
        };
    }

    if (promptMode === "image-de") {
        return {
            promptMode,
            promptText: "Type the German word for this image.",
            correctAnswers: [card.german],
            imageData: card.imageData || "",
            expectsGermanAnswer: true,
        };
    }

    throw new Error(`Unknown study mode: ${promptMode}`);
}

export function submitStudyAnswer(session, input) {
    if (!session || session.answered) {
        return null;
    }

    const prompt = getCurrentPrompt(session);

    if (!prompt) {
        return null;
    }

    const result = evaluateAnswer({
        input,
        correctAnswers: prompt.correctAnswers,
        expectsGermanAnswer: prompt.expectsGermanAnswer,
    });

    session.answered = true;
    session.score += result.pointsAwarded;

    return result;
}

export function advanceSession(session) {
    session.currentIndex += 1;
    session.answered = false;
    session.currentPrompt = null;
}

export function isSessionFinished(session) {
    return session.currentIndex >= session.cards.length;
}

export function isGermanAnswerMode(mode) {
    return mode === "en-de" || mode === "image-de";
}

function resolvePromptMode(card, mode) {
    if (mode !== "random") {
        return mode;
    }

    const availableModes = ["de-en", "en-de"];

    if (card?.imageData) {
        availableModes.push("image-de");
    }

    return availableModes[Math.floor(Math.random() * availableModes.length)];
}

function evaluateAnswer({ input, correctAnswers, expectsGermanAnswer }) {
    const rawInput = String(input || "");
    const normalizedInput = normalizeBasic(rawInput);

    let bestResult = buildWrongResult(correctAnswers);

    for (const answer of correctAnswers || []) {
        const candidate = evaluateAgainstSingleAnswer({
            input: rawInput,
            normalizedInput,
            correctAnswer: answer,
            expectsGermanAnswer,
        });

        if (isBetterMatch(candidate, bestResult)) {
            bestResult = candidate;
        }

        if (bestResult.pointsAwarded === 1) {
            break;
        }
    }

    return bestResult;
}

function evaluateAgainstSingleAnswer({
    input,
    normalizedInput,
    correctAnswer,
    expectsGermanAnswer,
}) {
    const normalizedAnswer = normalizeBasic(correctAnswer);

    if (!normalizedInput) {
        return buildWrongResult([correctAnswer]);
    }

    if (normalizedInput === normalizedAnswer) {
        return {
            outcome: "correct",
            feedbackClass: "correct",
            pointsAwarded: 1,
            message: "Correct. +1 point.",
            note: "",
            matchedAnswer: correctAnswer,
        };
    }

    const canonicalInput = normalizeForComparison(input);
    const canonicalAnswer = normalizeForComparison(correctAnswer);

    if (canonicalInput === canonicalAnswer) {
        return {
            outcome: "correct",
            feedbackClass: "correct",
            pointsAwarded: 1,
            message: "Correct. +1 point.",
            note: expectsGermanAnswer
                ? `Accepted keyboard-friendly spelling for “${correctAnswer}”.`
                : "",
            matchedAnswer: correctAnswer,
        };
    }

    if (expectsGermanAnswer) {
        const articleMatch = matchMissingGermanArticle(canonicalInput, correctAnswer);

        if (articleMatch) {
            return {
                outcome: "partial",
                feedbackClass: "partial",
                pointsAwarded: 0.5,
                message: "Almost right. +0.5 points.",
                note: `You got the noun right but missed the article. Correct answer: ${correctAnswer}.`,
                matchedAnswer: correctAnswer,
            };
        }
    }

    const closeMatch = matchCloseSpelling(
        canonicalInput,
        canonicalAnswer,
        correctAnswer,
        expectsGermanAnswer,
    );

    if (closeMatch) {
        return closeMatch;
    }

    return buildWrongResult([correctAnswer]);
}

function matchMissingGermanArticle(canonicalInput, correctAnswer) {
    const articleInfo = splitGermanArticle(correctAnswer);

    if (!articleInfo.article) {
        return false;
    }

    return canonicalInput === normalizeForComparison(articleInfo.remainder);
}

function matchCloseSpelling(canonicalInput, canonicalAnswer, correctAnswer, expectsGermanAnswer) {
    if (!isSingleEditAway(canonicalInput, canonicalAnswer)) {
        return null;
    }

    const shouldShowGermanKeyboardHint =
        expectsGermanAnswer && /[äöüß]/iu.test(String(correctAnswer || ""));

    return {
        outcome: "partial",
        feedbackClass: "partial",
        pointsAwarded: 0.5,
        message: "Almost right. +0.5 points.",
        note: shouldShowGermanKeyboardHint
            ? `Spelling note: expected ${correctAnswer}. You can use ä, ö, ü, ß on screen, or type ae, oe, ue, ss.`
            : `Spelling note: expected ${correctAnswer}.`,
        matchedAnswer: correctAnswer,
    };
}

function buildWrongResult(correctAnswers) {
    return {
        outcome: "incorrect",
        feedbackClass: "incorrect",
        pointsAwarded: 0,
        message: "Incorrect.",
        note: `Correct answer: ${(correctAnswers || []).join(" / ")}`,
        matchedAnswer: null,
    };
}

function isBetterMatch(candidate, currentBest) {
    if (candidate.pointsAwarded !== currentBest.pointsAwarded) {
        return candidate.pointsAwarded > currentBest.pointsAwarded;
    }

    const rank = {
        correct: 3,
        partial: 2,
        incorrect: 1,
    };

    return (rank[candidate.outcome] || 0) > (rank[currentBest.outcome] || 0);
}

function normalizeBasic(value) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleLowerCase();
}

function normalizeForComparison(value) {
    return normalizeBasic(value)
        .replaceAll("ä", "ae")
        .replaceAll("ö", "oe")
        .replaceAll("ü", "ue")
        .replaceAll("ß", "ss");
}

function splitGermanArticle(value) {
    const normalized = normalizeBasic(value);
    const match = normalized.match(
        /^(der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines|kein|keine|keinen|keinem|keiner|keines)\s+(.+)$/u,
    );

    if (!match) {
        return { article: "", remainder: normalized };
    }

    return {
        article: match[1],
        remainder: match[2],
    };
}

function isSingleEditAway(source, target) {
    if (source === target) {
        return false;
    }

    const lengthDelta = Math.abs(source.length - target.length);
    if (lengthDelta > 1) {
        return false;
    }

    if (source.length === target.length) {
        const mismatchIndexes = [];

        for (let index = 0; index < source.length; index += 1) {
            if (source[index] !== target[index]) {
                mismatchIndexes.push(index);
                if (mismatchIndexes.length > 2) {
                    return false;
                }
            }
        }

        if (mismatchIndexes.length === 1) {
            return true;
        }

        if (mismatchIndexes.length === 2) {
            const [firstIndex, secondIndex] = mismatchIndexes;

            return secondIndex === firstIndex + 1
                && source[firstIndex] === target[secondIndex]
                && source[secondIndex] === target[firstIndex];
        }

        return false;
    }

    const shorter = source.length < target.length ? source : target;
    const longer = source.length < target.length ? target : source;

    let shorterIndex = 0;
    let longerIndex = 0;
    let skipped = false;

    while (shorterIndex < shorter.length && longerIndex < longer.length) {
        if (shorter[shorterIndex] === longer[longerIndex]) {
            shorterIndex += 1;
            longerIndex += 1;
            continue;
        }

        if (skipped) {
            return false;
        }

        skipped = true;
        longerIndex += 1;
    }

    return true;
}

function shuffle(items) {
    for (let i = items.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }

    return items;
}
