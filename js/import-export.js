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

export function parseBulkWords(text) {
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    const entries = [];

    for (const line of lines) {
        if (line.startsWith("#")) {
            continue;
        }

        const parts = line.split("|").map((part) => part.trim());

        if (parts.length !== 2 && parts.length !== 3) {
            throw new Error(
                `Invalid line: "${line}". Expected format: German | English or German | English1; English2 | Collection A, Collection B`,
            );
        }

        const [german, englishPart, collectionsPart = ""] = parts;
        const englishAnswers = parseEnglishAnswersField(englishPart);

        if (!german || englishAnswers.length === 0) {
            throw new Error(
                `Invalid line: "${line}". German and at least one English meaning are required.`,
            );
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
    }

    return entries;
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
            ].join("\t"),
        );
    }

    return lines.join("\n");
}

export function parseBackupText(text) {
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    const flashcards = [];
    const collections = [];
    const studyHistory = [];
    const cardStats = {};

    for (const line of lines) {
        const parts = line.split("\t");
        const type = parts[0];

        if (type === "CARD") {
            if (parts.length < 5) {
                throw new Error(`Invalid CARD line: "${line}"`);
            }

            flashcards.push({
                id: parts[1],
                german: decodeField(parts[2]),
                englishAnswers: parseBackupEnglishAnswers(decodeField(parts[3])),
                imageData: decodeField(parts[4]),
            });
        } else if (type === "COLLECTION") {
            if (parts.length < 4) {
                throw new Error(`Invalid COLLECTION line: "${line}"`);
            }

            collections.push({
                id: parts[1],
                name: decodeField(parts[2]),
                cardIds: parts[3] ? parseCollectionIdsField(parts[3]) : [],
                color: parts[4] ? decodeField(parts[4]) : "#64748b",
            });
        } else if (type === "CARDSTAT") {
            if (parts.length < 4) {
                throw new Error(`Invalid CARDSTAT line: "${line}"`);
            }

            cardStats[parts[1]] = {
                timesSeen: parsePositiveInteger(parts[2]),
                timesCorrect: parsePositiveInteger(parts[3]),
                lastSeenAt: parts[4] ? decodeField(parts[4]) : "",
                lastCorrectAt: parts[5] ? decodeField(parts[5]) : "",
            };
        } else if (type === "SESSION") {
            if (parts.length < 9) {
                throw new Error(`Invalid SESSION line: "${line}"`);
            }

            studyHistory.push({
                id: parts[1],
                finishedAt: decodeField(parts[2]),
                collectionLabel: decodeField(parts[3]),
                collectionIds: parseCollectionIdsField(parts[4]),
                mode: parts[5],
                score: parseNonNegativeNumber(parts[6]),
                answeredCount: parsePositiveInteger(parts[7]),
                totalCards: parsePositiveInteger(parts[8]),
            });
        } else {
            throw new Error(`Unknown line type: "${line}"`);
        }
    }

    const cardIds = new Set(flashcards.map((card) => card.id));
    for (const collection of collections) {
        collection.cardIds = collection.cardIds.filter((id) => cardIds.has(id));
    }

    for (const cardId of Object.keys(cardStats)) {
        if (!cardIds.has(cardId)) {
            delete cardStats[cardId];
        }
    }

    return { flashcards, collections, studyHistory, cardStats };
}
