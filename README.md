# LetterBooks

Letterboxd, but for books. Live at https://cyrus2392.github.io/LetterBooks/

See [PLAN.md](PLAN.md) for the roadmap.

## Development

```bash
npm install
npm run dev
```

Every push to `main` builds and deploys to GitHub Pages via `.github/workflows/pages.yml`.

## Adding or updating an author

1. Create or edit `data/curation/<author-slug>.json` (see `stephen-king.json`).
2. Run `npm run import-author -- <author-slug>`.
3. Fix anything it reports as unmatched or missing a cover by adding `olKey` or `coverId` to that book in the curation file, then run it again.
