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

Any author can be found with the site's search and gets an automatic page. To give one a hand-checked list instead:

1. Run `npm run add-author -- "Author Name"` to draft `data/curation/<author-slug>.json`, then review it: remove novellas, duplicates and bundles, and fix years, types and series. (Or create or edit `data/curation/<author-slug>.json` by hand; see `stephen-king.json`.)
2. Run `npm run import-author -- <author-slug>`.
3. Fix anything it reports as unmatched or missing a cover by adding `olKey` or `coverId` to that book in the curation file, then run it again.
