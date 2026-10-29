# LetterBooks plan

Letterboxd, but for books: log what you've read quickly and see your progress through each author's work.

## Decisions

- **Single user for now.** Reading data is stored in the browser (localStorage), with export/import on the profile page. All storage goes through `src/lib/store.svelte.js`, so swapping in Supabase for accounts later only touches that module.
- **Static site on GitHub Pages.** Built with Vite + Svelte. GitHub Actions builds and deploys on every push to `main`.
- **Book data from APIs, not scraping.** Open Library provides works (the "parent version" of a title), metadata and covers. Goodreads/Amazon scraping is against their terms and brittle.
- **Curated bibliographies.** Open Library lists 600+ "works" for Stephen King (translations, short stories, anthologies, duplicates), against ~90 real books. Each author has a curation file (`data/curation/<author>.json`) listing the canonical books. The import script matches them to Open Library for keys and covers, so totals and percentages are meaningful.

## Data

- `data/curation/<author>.json`: hand-checked list of books (title, year, type, series, co-authors), with optional Open Library key/cover overrides.
- `scripts/import-author.mjs`: matches curated books to Open Library and writes `public/data/authors/<author>.json`.
- `public/data/authors.json`: index of tracked authors.
- Covers are loaded from `covers.openlibrary.org`.

## Pages

- **Author** (`#/author/stephen-king`): cover grid of every book (one entry per work, no editions), with "You've read X of Y (Z%)" and a progress bar. Each cover has a ✓ button to mark it read; read covers show a badge.
- **Book** (`#/book/<author>/<work-id>`): cover, details, read toggle, "Currently reading" and "Want to read" shelves, and logged reads (start/finish dates, half-star rating, review) with edit/delete.
- **Profile** (`#/profile`): total books read, currently reading and want-to-read shelves, recent reads, and export/import of reading data.

## Phases

1. **Stephen King end to end**: curated bibliography, author page, quick ✓, read count and percentage, profile total. ✅
2. **Book page and full logging**: TBR, currently reading, read logs with dates, ratings, reviews. ✅
3. **More authors and series**: search (live Open Library lookups for untracked authors), adding authors, series pages and series progress.
4. **Daily new releases**: scheduled GitHub Actions job checks tracked authors for new works, applies curation rules, commits updated data (which redeploys).
5. **Accounts** (only if wanted): Supabase for sign-in and a database, behind the same store interface.
