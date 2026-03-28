# German-English Flashcards

A simple pure client-side flashcard app built with HTML, CSS, and vanilla JavaScript.

## Features

- German → English study mode
- English → German study mode
- Image → German study mode
- Create flashcards with optional images
- Create collections and assign cards to them
- Bulk-import words from TXT files
- Export all flashcards and collections to a TXT backup
- Save everything to localStorage

## Project structure

```text
german-english-flashcards/
├── index.html
├── styles.css
├── README.md
└── js/
    ├── app.js
    ├── import-export.js
    ├── storage.js
    └── study.js
```

## How to run

Just open `index.html` in your browser.

You can also serve the folder with any static file server, but no backend is required.

## TXT formats

### 1. Bulk word import

One flashcard per line.

Supported formats:
```text
der Hund | dog; hound | Animals
die Katze | cat | Animals
das Buch | book | Basics, School
```
The English field supports one or more meanings separated by semicolons.
The third field is optional. If present, it is a comma-separated list of collection names. Missing collections are created automatically during import.
Blank lines are ignored. Lines starting with `#` are treated as comments.

### 2. Full backup export/import

The app exports a TXT file using tab-separated lines:

```text
CARD	card-id	encodedGerman	encodedEnglish	encodedImageData
COLLECTION	collection-id	encodedName	cardId1,cardId2
```

Text fields are URL-encoded so tabs and special characters remain safe.

## Notes

- Images are stored as Data URLs in localStorage.
- Very large numbers of images can fill localStorage quickly.
- Bulk-import creates flashcards only. You still assign them to collections in the UI.
