function encodeField(value) {
    return encodeURIComponent(value ?? "");
}

function decodeField(value) {
    return decodeURIComponent(value ?? "");
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
                `Invalid line: "${line}". Expected format: German | English or German | English | Collection A, Collection B`,
            );
        }

        const [german, english, collectionsPart = ""] = parts;

        if (!german || !english) {
            throw new Error(`Invalid line: "${line}". Both German and English must be filled.`);
        }

        const collectionNames = collectionsPart
            .split(",")
            .map((name) => name.trim())
            .filter(Boolean);

        entries.push({
            card: {
                id: crypto.randomUUID(),
                german,
                english,
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
                encodeField(card.english),
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
                english: decodeField(parts[3]),
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
