const MULTIPLE_CHOICE_OPTION_COUNT = 5;

export function createStudySession(cards, mode, options = {}) {
    const shuffledCards = shuffle([...cards]);
    const cardLimit = toPositiveIntegerOrNull(options.cardLimit);
    const sessionCards = cardLimit && cardLimit < shuffledCards.length
        ? shuffledCards.slice(0, cardLimit)
        : shuffledCards;

    return {
        mode,
        cards: sessionCards,
        currentIndex: 0,
        score: 0,
        answered: false,
        currentPrompt: null,
        collectionMembershipByCardId: buildCollectionMembershipMap(options.collections || []),
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
        session.currentPrompt = card ? buildPrompt(card, session.mode, session) : null;
    }

    return session.currentPrompt;
}

export function buildPrompt(card, mode, session = null) {
    const multipleChoiceData = buildMultipleChoiceData(card, session);
    const promptMode = resolvePromptMode(card, mode, multipleChoiceData);

    if (promptMode === "de-en") {
        return {
            promptMode,
            promptText: card.german,
            correctAnswers: card.englishAnswers || [],
            imageData: "",
            expectsGermanAnswer: false,
            responseKind: "text",
            choiceOptions: [],
        };
    }

    if (promptMode === "mc-de-en") {
        if (!multipleChoiceData) {
            return buildPrompt(card, "de-en", session);
        }

        return {
            promptMode,
            promptText: card.german,
            correctAnswers: card.englishAnswers || [],
            imageData: "",
            expectsGermanAnswer: false,
            responseKind: "choice",
            choiceOptions: multipleChoiceData.choiceOptions,
            selectedChoice: "",
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
            responseKind: "text",
            choiceOptions: [],
        };
    }

    if (promptMode === "image-de") {
        return {
            promptMode,
            promptText: "Type the German word for this image.",
            correctAnswers: [card.german],
            imageData: card.imageData || "",
            expectsGermanAnswer: true,
            responseKind: "text",
            choiceOptions: [],
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
        allowLenientMatching: prompt.responseKind !== "choice",
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

function resolvePromptMode(card, mode, multipleChoiceData) {
    if (mode !== "random") {
        return mode;
    }

    const availableModes = ["de-en", "en-de"];

    if (card?.imageData) {
        availableModes.push("image-de");
    }

    if (multipleChoiceData) {
        availableModes.push("mc-de-en");
    }

    return availableModes[Math.floor(Math.random() * availableModes.length)];
}

function buildCollectionMembershipMap(collections) {
    const membershipByCardId = new Map();

    for (const collection of collections || []) {
        const collectionId = String(collection?.id || "").trim();

        if (!collectionId) {
            continue;
        }

        for (const cardId of collection?.cardIds || []) {
            if (!membershipByCardId.has(cardId)) {
                membershipByCardId.set(cardId, new Set());
            }

            membershipByCardId.get(cardId).add(collectionId);
        }
    }

    return membershipByCardId;
}

function buildMultipleChoiceData(card, session) {
    const correctAnswer = chooseMultipleChoiceCorrectAnswer(card);

    if (!correctAnswer || !session || !Array.isArray(session.cards) || session.cards.length < MULTIPLE_CHOICE_OPTION_COUNT) {
        return null;
    }

    const distractors = pickMultipleChoiceDistractors({
        currentCard: card,
        correctAnswer,
        sessionCards: session.cards,
        collectionMembershipByCardId: session.collectionMembershipByCardId,
    });

    if (distractors.length < MULTIPLE_CHOICE_OPTION_COUNT - 1) {
        return null;
    }

    return {
        choiceOptions: shuffle([
            {
                text: correctAnswer,
                isCorrect: true,
            },
            ...distractors.slice(0, MULTIPLE_CHOICE_OPTION_COUNT - 1).map((text) => ({
                text,
                isCorrect: false,
            })),
        ]),
    };
}

function chooseMultipleChoiceCorrectAnswer(card) {
    const englishAnswers = (card?.englishAnswers || []).filter(Boolean);

    if (englishAnswers.length === 0) {
        return "";
    }

    return englishAnswers[Math.floor(Math.random() * englishAnswers.length)] || englishAnswers[0] || "";
}

function pickMultipleChoiceDistractors({
    currentCard,
    correctAnswer,
    sessionCards,
    collectionMembershipByCardId,
}) {
    const correctNormalized = normalizeForComparison(correctAnswer);
    const currentCardCollectionIds = collectionMembershipByCardId?.get(currentCard?.id) || new Set();
    const rankedCandidates = [];

    for (const candidateCard of sessionCards || []) {
        if (!candidateCard || candidateCard.id === currentCard?.id) {
            continue;
        }

        const distractorAnswer = chooseBestDistractorAnswer(candidateCard, correctAnswer);
        const distractorNormalized = normalizeForComparison(distractorAnswer);

        if (!distractorNormalized || distractorNormalized === correctNormalized) {
            continue;
        }

        rankedCandidates.push({
            text: distractorAnswer,
            normalized: distractorNormalized,
            sameCollection: sharesCollection(
                currentCardCollectionIds,
                collectionMembershipByCardId?.get(candidateCard.id),
            ),
            similarityScore: scoreDistractorSimilarity(distractorAnswer, correctAnswer),
            tieBreaker: Math.random(),
        });
    }

    rankedCandidates.sort((left, right) => {
        if (left.sameCollection !== right.sameCollection) {
            return left.sameCollection ? -1 : 1;
        }

        if (left.similarityScore !== right.similarityScore) {
            return right.similarityScore - left.similarityScore;
        }

        return left.tieBreaker - right.tieBreaker;
    });

    const chosenTexts = [];
    const seenNormalizedValues = new Set([correctNormalized]);

    for (const candidate of rankedCandidates) {
        if (seenNormalizedValues.has(candidate.normalized)) {
            continue;
        }

        chosenTexts.push(candidate.text);
        seenNormalizedValues.add(candidate.normalized);

        if (chosenTexts.length >= MULTIPLE_CHOICE_OPTION_COUNT - 1) {
            break;
        }
    }

    return chosenTexts;
}

function chooseBestDistractorAnswer(card, correctAnswer) {
    const answers = (card?.englishAnswers || []).filter(Boolean);

    if (answers.length === 0) {
        return "";
    }

    let bestAnswer = answers[0];
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const answer of answers) {
        const score = scoreDistractorSimilarity(answer, correctAnswer);

        if (score > bestScore) {
            bestAnswer = answer;
            bestScore = score;
        }
    }

    return bestAnswer;
}

function sharesCollection(leftIds, rightIds) {
    if (!leftIds || !rightIds || leftIds.size === 0 || rightIds.size === 0) {
        return false;
    }

    for (const collectionId of leftIds) {
        if (rightIds.has(collectionId)) {
            return true;
        }
    }

    return false;
}

function scoreDistractorSimilarity(candidate, correctAnswer) {
    const candidateNormalized = normalizeForComparison(candidate).replace(/[^a-z0-9]/giu, "");
    const correctNormalized = normalizeForComparison(correctAnswer).replace(/[^a-z0-9]/giu, "");

    if (!candidateNormalized || !correctNormalized) {
        return 0;
    }

    const candidateTokens = tokenizeForSimilarity(candidate);
    const correctTokens = tokenizeForSimilarity(correctAnswer);
    const candidateBigrams = buildNgrams(candidateNormalized, 2);
    const correctBigrams = buildNgrams(correctNormalized, 2);
    const sharedChars = countSharedUniqueCharacters(candidateNormalized, correctNormalized);
    const sharedPrefixLength = countSharedPrefix(candidateNormalized, correctNormalized);
    const sharedSuffixLength = countSharedSuffix(candidateNormalized, correctNormalized);
    const lengthDelta = Math.abs(candidateNormalized.length - correctNormalized.length);

    return (
        overlapScore(candidateBigrams, correctBigrams) * 10
        + overlapScore(candidateTokens, correctTokens) * 8
        + sharedChars * 0.8
        + sharedPrefixLength * 1.2
        + sharedSuffixLength * 1
        - lengthDelta * 0.4
    );
}

function tokenizeForSimilarity(value) {
    return normalizeForComparison(value)
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean);
}

function buildNgrams(value, size) {
    const normalized = String(value || "");

    if (!normalized) {
        return [];
    }

    if (normalized.length <= size) {
        return [normalized];
    }

    const grams = [];

    for (let index = 0; index <= normalized.length - size; index += 1) {
        grams.push(normalized.slice(index, index + size));
    }

    return grams;
}

function overlapScore(leftItems, rightItems) {
    const leftSet = new Set(leftItems || []);
    const rightSet = new Set(rightItems || []);

    if (leftSet.size === 0 || rightSet.size === 0) {
        return 0;
    }

    let overlapCount = 0;

    for (const value of leftSet) {
        if (rightSet.has(value)) {
            overlapCount += 1;
        }
    }

    return overlapCount / Math.max(leftSet.size, rightSet.size);
}

function countSharedUniqueCharacters(leftValue, rightValue) {
    const leftChars = new Set(String(leftValue || ""));
    const rightChars = new Set(String(rightValue || ""));
    let count = 0;

    for (const character of leftChars) {
        if (rightChars.has(character)) {
            count += 1;
        }
    }

    return count;
}

function countSharedPrefix(leftValue, rightValue) {
    const limit = Math.min(leftValue.length, rightValue.length);
    let count = 0;

    while (count < limit && leftValue[count] === rightValue[count]) {
        count += 1;
    }

    return count;
}

function countSharedSuffix(leftValue, rightValue) {
    const limit = Math.min(leftValue.length, rightValue.length);
    let count = 0;

    while (
        count < limit
        && leftValue[leftValue.length - 1 - count] === rightValue[rightValue.length - 1 - count]
    ) {
        count += 1;
    }

    return count;
}

function evaluateAnswer({ input, correctAnswers, expectsGermanAnswer, allowLenientMatching = true }) {
    const rawInput = String(input || "");
    const normalizedInput = normalizeBasic(rawInput);

    let bestResult = buildWrongResult(correctAnswers);

    for (const answer of correctAnswers || []) {
        const candidate = evaluateAgainstSingleAnswer({
            input: rawInput,
            normalizedInput,
            correctAnswer: answer,
            expectsGermanAnswer,
            allowLenientMatching,
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
    allowLenientMatching,
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

    if (!allowLenientMatching) {
        return buildWrongResult([correctAnswer]);
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

function toPositiveIntegerOrNull(value) {
    const numericValue = Number.parseInt(String(value || "").trim(), 10);
    return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : null;
}

function shuffle(items) {
    for (let i = items.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }

    return items;
}
