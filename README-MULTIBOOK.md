# Multi-book iPad English Reader — Phase 3 sample

This branch converts the original NCE2 iPad/PWA reader into a **book-config-driven** reader while keeping the lightweight HTML + CSS + Vanilla JS + PWA architecture.

## Current status

- Original `gh-pages` branch is untouched.
- Development branch: `multi-book-grade5a`.
- Home page has two books: **NCE2** and **Shanghai Grade 5A (2026)**.
- NCE2 continues to use the existing `NCE2/*.mp3`, `NCE2/*.lrc`, `notes/lesson-XX.html`, and `data/words.json` through a compatibility adapter.
- Grade 5A Phase 3 sample contains Unit 1 structure. Talking time and Story time use explicit `start/end` timing JSON plus generated LRC.
- The Grade 5A source package contained publisher MP3 files but no publisher timestamp/LRC/XML/coordinate file. Therefore current Unit 1 timing is explicitly marked `generated-reviewed`, not publisher timing.
- Source materials do not provide an official Chinese translation for the main Unit 1 text. Chinese lines are left empty rather than invented.
- The publisher has a Unit 1 “Words to use” audio track, but per-word timestamps are not present, so Grade 5A dictation does **not** fall back to TTS for those words.

## Data layout

```text
data/books.json
books/nce2/book.json
books/shanghai-g5a-2026/book.json
books/shanghai-g5a-2026/lessons.json
books/shanghai-g5a-2026/words.json
books/shanghai-g5a-2026/lrc/
books/shanghai-g5a-2026/timing/
books/shanghai-g5a-2026/notes/
scripts/build-book-data.mjs
scripts/validate-book-data.mjs
```

## Add a lesson

Add a stable lesson object to `lessons.json`; for point reading set `kind: "lesson"`, `pointReading: true`, and provide `audio`, `transcript`, and `timing`. Add its ID to the matching Unit `sections` array and run build/validation.

## Add a Unit

Add the Unit to `book.json` with a unique `id`, increasing `order`, title/page information, and section IDs; then add corresponding records to `lessons.json`.

## Replace MP3

Copy the publisher MP3 to the exact `lesson.audio.primary` path. Preserve filename case. Preview fallbacks are not considered the final original-audio deliverable.

## Modify timestamps and text

Edit `timing/<lesson>.json`; each segment has `start`, `end`, `en`, `cn`. Textbook wording remains the source of truth. Then run:

```bash
node scripts/build-book-data.mjs shanghai-g5a-2026
```

## Add words

Edit `words.json`. Preserve publisher phonetic/part-of-speech/meaning data where present. Missing publisher fields stay null or are explicitly marked supplemental.

## Validate

```bash
node scripts/validate-book-data.mjs shanghai-g5a-2026
```

The report is written to `books/shanghai-g5a-2026/validation-report.txt`. A complete book must have **0 ERROR**.

## Offline and publishing

`sw.js` preserves the full-file media cache + HTTP Range slicing strategy for iPad Safari/PWA seeking. Phase 3 stays on the development branch to avoid breaking the original NCE2 site. After sample acceptance and original Grade 5A audio copy, merge/publish from a dedicated deployment target.
