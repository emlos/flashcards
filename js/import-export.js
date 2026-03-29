function encodeField(value) {
    return encodeURIComponent(value ?? "");
}

function decodeField(value) {
    return decodeURIComponent(value ?? "");
}

function parseEnglishAnswersField(value) {
    return [
        ...new Set(
            String(value || "")
                .split(";")
                .map((item) => item.trim())
                .filter(Boolean),
        ),
    ];
}

function parseBackupEnglishAnswers(value) {
    const decoded = String(value || "").trim();

    if (!decoded) {
        return [];
    }

    try {
        const parsed = JSON.parse(decoded);

        if (Array.isArray(parsed)) {
            return [...new Set(parsed.map((item) => String(item || "").trim()).filter(Boolean))];
        }

        if (typeof parsed === "string") {
            return parseEnglishAnswersField(parsed);
        }
    } catch (error) {
        return parseEnglishAnswersField(decoded);
    }

    return [];
}

function parseCollectionIdsField(value) {
    return String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function parsePositiveInteger(value) {
    const parsed = Number.parseInt(String(value || "").trim(), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function parseNonNegativeNumber(value) {
    const parsed = Number(String(value || "").trim());
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function parseNonNegativeInteger(value) {
    const parsed = Number.parseInt(String(value || "").trim(), 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function parseImageAttributionField(value) {
    const decoded = String(value || "").trim();

    if (!decoded) {
        return null;
    }

    try {
        const parsed = JSON.parse(decoded);
        return parsed && typeof parsed === "object" ? parsed : null;
    } catch (error) {
        return null;
    }
}

function sanitizeStudyMode(value) {
    return ["de-en", "en-de", "image-de", "mc-de-en", "random"].includes(value)
        ? value
        : "de-en";
}

function sanitizeStudySessionType(value) {
    return value === "srs" ? "srs" : "free";
}

export function parseBulkWords(text) {
    const entries = [];
    const issues = [];

    text.split(/\r?\n/).forEach((rawLine, index) => {
        const line = rawLine.trim();

        if (!line || line.startsWith("#")) {
            return;
        }

        const parts = line.split("|").map((part) => part.trim());

        if (parts.length !== 2 && parts.length !== 3) {
            issues.push({
                lineNumber: index + 1,
                line,
                message:
                    "Expected format: German | English or German | English1; English2 | Collection A, Collection B.",
            });
            return;
        }

        const [german, englishPart, collectionsPart = ""] = parts;
        const englishAnswers = parseEnglishAnswersField(englishPart);

        if (!german || englishAnswers.length === 0) {
            issues.push({
                lineNumber: index + 1,
                line,
                message: "German and at least one English meaning are required.",
            });
            return;
        }

        const collectionNames = collectionsPart
            .split(",")
            .map((name) => name.trim())
            .filter(Boolean);

        entries.push({
            card: {
                id: crypto.randomUUID(),
                german,
                englishAnswers,
                imageData: "",
            },
            collectionNames: [...new Set(collectionNames)],
        });
    });

    return { entries, issues };
}

export function exportBackupText(state) {
    const lines = [];

    for (const card of state.flashcards || []) {
        lines.push(
            [
                "CARD",
                card.id,
                encodeField(card.german),
                encodeField(JSON.stringify(card.englishAnswers || [])),
                encodeField(card.imageData || ""),
                encodeField(JSON.stringify(card.imageAttribution || null)),
            ].join("\t"),
        );
    }

    for (const collection of state.collections || []) {
        lines.push(
            [
                "COLLECTION",
                collection.id,
                encodeField(collection.name),
                Array.isArray(collection.cardIds) ? collection.cardIds.join(",") : "",
                encodeField(collection.color || "#64748b"),
            ].join("\t"),
        );
    }

    for (const [cardId, stats] of Object.entries(state.cardStats || {})) {
        lines.push(
            [
                "CARDSTAT",
                cardId,
                String(stats?.timesSeen || 0),
                String(stats?.timesCorrect || 0),
                encodeField(stats?.lastSeenAt || ""),
                encodeField(stats?.lastCorrectAt || ""),
                String(stats?.srsInterval || 0),
                String(stats?.srsEaseFactor || 2.5),
                encodeField(stats?.srsDueDate || ""),
            ].join("\t"),
        );
    }

    for (const session of state.studyHistory || []) {
        lines.push(
            [
                "SESSION",
                session.id,
                encodeField(session.finishedAt || ""),
                encodeField(session.collectionLabel || "All flashcards"),
                Array.isArray(session.collectionIds) ? session.collectionIds.join(",") : "",
                session.mode || "de-en",
                String(session.score || 0),
                String(session.answeredCount || 0),
                String(session.totalCards || 0),
                sanitizeStudySessionType(session.sessionType),
            ].join("\t"),
        );
    }

    return lines.join("\n");
}

export function parseBackupText(text) {
    const lines = text.split(/\r?\n/);
    const flashcards = [];
    const collections = [];
    const studyHistory = [];
    const cardStats = {};
    const issues = [];

    lines.forEach((rawLine, index) => {
        const line = rawLine.trim();

        if (!line || line.startsWith("#")) {
            return;
        }

        const parts = line.split("	");
        const type = parts[0];
        const issueBase = {
            lineNumber: index + 1,
            line,
        };

        if (type === "CARD") {
            if (parts.length < 5) {
                issues.push({
                    ...issueBase,
                    message: "Skipped malformed CARD line.",
                });
                return;
            }

            flashcards.push({
                id: parts[1],
                german: decodeField(parts[2]),
                englishAnswers: parseBackupEnglishAnswers(decodeField(parts[3])),
                imageData: decodeField(parts[4]),
                imageAttribution: parts[5]
                    ? parseImageAttributionField(decodeField(parts[5]))
                    : null,
            });
            return;
        }

        if (type === "COLLECTION") {
            if (parts.length < 4) {
                issues.push({
                    ...issueBase,
                    message: "Skipped malformed COLLECTION line.",
                });
                return;
            }

            collections.push({
                id: parts[1],
                name: decodeField(parts[2]),
                cardIds: parts[3] ? parseCollectionIdsField(parts[3]) : [],
                color: parts[4] ? decodeField(parts[4]) : "#64748b",
            });
            return;
        }

        if (type === "CARDSTAT") {
            if (parts.length < 4) {
                issues.push({
                    ...issueBase,
                    message: "Skipped malformed CARDSTAT line.",
                });
                return;
            }

            cardStats[parts[1]] = {
                timesSeen: parsePositiveInteger(parts[2]),
                timesCorrect: parsePositiveInteger(parts[3]),
                lastSeenAt: parts[4] ? decodeField(parts[4]) : "",
                lastCorrectAt: parts[5] ? decodeField(parts[5]) : "",
                srsInterval: parseNonNegativeInteger(parts[6]),
                srsEaseFactor: parts[7] ? parseNonNegativeNumber(parts[7]) : 2.5,
                srsDueDate: parts[8] ? decodeField(parts[8]) : "",
            };
            return;
        }

        if (type === "SESSION") {
            if (parts.length < 9) {
                issues.push({
                    ...issueBase,
                    message: "Skipped malformed SESSION line.",
                });
                return;
            }

            studyHistory.push({
                id: parts[1],
                finishedAt: decodeField(parts[2]),
                collectionLabel: decodeField(parts[3]),
                collectionIds: parseCollectionIdsField(parts[4]),
                mode: sanitizeStudyMode(parts[5]),
                score: parseNonNegativeNumber(parts[6]),
                answeredCount: parsePositiveInteger(parts[7]),
                totalCards: parsePositiveInteger(parts[8]),
                sessionType: sanitizeStudySessionType(parts[9]),
            });
            return;
        }

        issues.push({
            ...issueBase,
            message: `Skipped unrecognized line type "${type}".`,
        });
    });

    const cardIds = new Set(flashcards.map((card) => card.id));
    for (const collection of collections) {
        collection.cardIds = collection.cardIds.filter((id) => cardIds.has(id));
    }

    for (const cardId of Object.keys(cardStats)) {
        if (!cardIds.has(cardId)) {
            delete cardStats[cardId];
        }
    }

    return {
        state: { flashcards, collections, studyHistory, cardStats },
        issues,
    };
}
