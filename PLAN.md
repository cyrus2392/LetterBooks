# LetterBooks plan

Letterboxd, but for books: log what you've read quickly and see your progress through each author's work.

## Decisions

- **Single user for now.** Reading data is stored in the browser (localStorage), with export/import on the profile page. All storage goes through `src/lib/store.svelte.js`, so swapping in Supabase for accounts later only touches that module.
- **Static site on GitHub Pages.** Built with Vite + Svelte. GitHub Actions builds and deploys on every push to `main`.
- **Book data from APIs, not scraping.** Bibliographies come from Wikipedia (its "<Author> bibliography" articles are human-maintained lists of real books). Open Library provides works (the "parent version" of a title) and covers; Wikidata provides series positions. Goodreads/Amazon scraping is against their terms and brittle.
- **UK covers.** Each book's cover comes from the newest UK edition on Open Library that has one (UK place, publisher or MARC country code), falling back to the work's default cover. Curated authors get theirs at import time; live authors look them up as covers scroll into view, cached for a month.
- **Curated bibliographies.** Open Library lists 600+ "works" for Stephen King (translations, short stories, anthologies, duplicates), against ~90 real books. Each author has a curation file (`data/curation/<author>.json`) listing the canonical books. The import script matches them to Open Library for keys and covers, so totals and percentages are meaningful.
- **Live authors for everyone else.** Any author found by search gets a page built in the browser from their Wikipedia bibliography (tables and lists under each heading; headings give type and series), matched to Open Library works, with Wikidata series positions. Authors without a usable Wikipedia bibliography fall back to Open Library's works, filtered automatically. Pages are cached for a week. The automatic list can include strays, so any book can be hidden from an author's totals. An author appears on the home page once you add them to "your authors" or mark any of their books as read. `npm run add-author` drafts a curation file from the same automatic list when an author deserves a hand-checked one.

## Data

- `data/curation/<author>.json`: hand-checked list of books (title, year, type, series, co-authors), with optional Open Library key/cover overrides.
- `scripts/import-author.mjs`: matches curated books to Open Library, picks UK covers, and writes `public/data/authors/<author>.json`.
- `public/data/authors.json`: index of curated authors.
- `src/lib/wikipedia.js`: finds and parses an author's Wikipedia bibliography.
- `src/lib/sources.js`: Open Library + Wikidata lookups (search, matching, UK covers) and automatic bibliographies, shared by the site and the scripts.
- `scripts/add-author.mjs`: drafts `data/curation/<author>.json` for review.
- Covers are loaded from `covers.openlibrary.org`.

## Pages

- **Home** (`#/`): your authors (curated, added, or read from) with progress, plus suggestions from what you've read (`src/lib/suggestions.js`):
  - *Up next in your series*: the next unread book after the furthest one you've read in each numbered series.
  - *More from your authors*: their most-read unread books (Open Library reader counts), starting unstarted series at book 1.
  - *Books / Authors you might like*: genres taken from your read books' Open Library subjects (each book counts towards its two most specific genres; genres are picked so every book is represented), then the most-read adult books since 1950 in those genres by authors you don't read yet, alternating between genres.
  - Ratings steer all of it: 4★+ books count double, 2★ or less not at all. Genre lookups are cached (subjects for a month, genre lists for a day).
  - Every suggestion has a "Not interested" ✕ (with a few seconds to undo); dismissing a suggested author hides their books too, and the next suggestion moves up. The profile page can show hidden suggestions again.
- **Author** (`#/author/stephen-king`, or `#/author/<Open Library key>` for live authors): series cards with progress, then a cover grid of every book (one entry per work, no editions), with "You've read X of Y (Z%)" and a progress bar. Each cover has a ✓ button to mark it read. "Edit list" hides strays; live authors can be added to your authors.
- **Series** (`#/series/<author>/<name>`): the series in reading order with progress.
- **Search** (`#/search/<query>`): your authors and curated books, plus authors and books on Open Library.
- **Book** (`#/book/<author>/<work-id>`): cover, details, read toggle, "Currently reading" and "Want to read" shelves, and logged reads (start/finish dates, half-star rating, review) with edit/delete.
- **Library** (`#/library/owned`, `#/library/read`): your bookshelf (books you own) and the books you've read, as two tabs. Owning and reading are independent, so each tab filters by the other (owned but not read yet; read but not owned). Covers have an owned toggle (top left) beside the read tick (top right); book pages have "I own this".
- **Profile** (`#/profile`): total books read, currently reading and want-to-read shelves, recent reads, and export/import of reading data.

## Phases

1. **Stephen King end to end**: curated bibliography, author page, quick ✓, read count and percentage, profile total. ✅
2. **Book page and full logging**: TBR, currently reading, read logs with dates, ratings, reviews. ✅
3. **More authors and series**: search (live Open Library lookups for untracked authors), adding authors, series pages and series progress. ✅
4. **Daily new releases**: scheduled GitHub Actions job checks tracked authors for new works, applies curation rules, commits updated data (which redeploys).
5. **Accounts** (only if wanted): Supabase for sign-in and a database, behind the same store interface.
