// Requests every curated author's covers from the covers Worker once, so the
// first visit is as fast as later ones. Run after import-author.
//
// Usage: node scripts/warm-covers.mjs [author-slug ...]   (default: all curated authors)

import { readFile, readdir } from 'node:fs/promises';

const API = 'https://letterbooks-covers.benjfdickinson.workers.dev';
const SIZES = ['S', 'M', 'L']; // home-page thumbnails, grids, book page

const slugs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : (await readdir('public/data/authors')).map((f) => f.replace(/\.json$/, ''));

const urls = [];
for (const slug of slugs) {
  const { books } = JSON.parse(await readFile(`public/data/authors/${slug}.json`, 'utf8'));
  for (const b of books) if (b.coverId) for (const size of SIZES) urls.push(`${API}/cover/id/${b.coverId}?size=${size}`);
}

let fresh = 0;
let failed = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (let url; (url = urls.shift()); ) {
      const res = await fetch(url).catch(() => null);
      if (!res?.ok) failed++;
      else if (!/from=cache/.test(res.headers.get('x-letterbooks-cover') ?? '')) fresh++;
      await res?.arrayBuffer().catch(() => {});
    }
  }),
);
console.log(`Warmed ${slugs.join(', ')}: ${fresh} fetched into the cache, ${failed} failed.`);
