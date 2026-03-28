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

    for (const card of state.flashcards) {
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

    for (const collection of state.collections) {
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

    return lines.join("\n");
}

export function parseBackupText(text) {
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    const flashcards = [];
    const collections = [];

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
                cardIds: parts[3] ? parts[3].split(",").filter(Boolean) : [],
                color: parts[4] ? decodeField(parts[4]) : "#64748b",
            });
        } else {
            throw new Error(`Unknown line type: "${line}"`);
        }
    }

    const cardIds = new Set(flashcards.map((card) => card.id));
    for (const collection of collections) {
        collection.cardIds = collection.cardIds.filter((id) => cardIds.has(id));
    }

    return { flashcards, collections };
}
