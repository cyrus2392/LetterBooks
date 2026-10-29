// Matches a curated bibliography (data/curation/<slug>.json) to Open Library
// works and writes public/data/authors/<slug>.json plus the authors index.
//
// Usage: node scripts/import-author.mjs stephen-king

import { readFile, writeFile, readdir } from 'node:fs/promises';

const slug = process.argv[2];
if (!slug) {
  console.error('Usage: node scripts/import-author.mjs <author-slug>');
  process.exit(1);
}

const curation = JSON.parse(await readFile(`data/curation/${slug}.json`, 'utf8'));
const UA = 'LetterBooks/0.1 (https://github.com/cyrus2392/LetterBooks)';

const normalize = (s) =>
  s.toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/&/g, 'and')
    .replace(/^(the|a|an) /, '')
    .replace(/[^a-z0-9]/g, '');

async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) return res.json();
    if (attempt === 3) throw new Error(`${res.status} for ${url}`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
}

// One request for all of the author's works, then match locally.
const fields = 'key,title,first_publish_year,edition_count,cover_i,author_key';
const { docs } = await getJson(
  `https://openlibrary.org/search.json?author_key=${curation.olKey}&fields=${fields}&limit=2000`,
);

const books = [];
const unmatched = [];
for (const book of curation.books) {
  const target = normalize(book.title);
  const candidates = book.olKey
    ? docs.filter((d) => d.key === `/works/${book.olKey}`)
    : docs.filter((d) => normalize(d.title) === target);
  // The most-published matching work is the canonical one; the rest are duplicates.
  const match = candidates.sort((a, b) => (b.edition_count ?? 0) - (a.edition_count ?? 0))[0];
  if (!match) unmatched.push(book.title);

  const workId = match ? match.key.replace('/works/', '') : null;
  const id = workId ?? `${slug}-${normalize(book.title)}`;
  books.push({
    id,
    olWorkId: workId,
    title: book.title,
    year: book.year,
    type: book.type,
    ...(book.series && { series: book.series }),
    ...(book.coAuthors && { coAuthors: book.coAuthors }),
    ...(book.pseudonym && { pseudonym: book.pseudonym }),
    coverId: book.coverId ?? match?.cover_i ?? null,
  });
}

const out = {
  slug,
  name: curation.name,
  olKey: curation.olKey,
  updatedAt: new Date().toISOString().slice(0, 10),
  books,
};
await writeFile(`public/data/authors/${slug}.json`, JSON.stringify(out, null, 2) + '\n');

// Rebuild the index from every author file.
const index = [];
for (const file of (await readdir('public/data/authors')).sort()) {
  const a = JSON.parse(await readFile(`public/data/authors/${file}`, 'utf8'));
  const cover = a.books.find((b) => b.coverId)?.coverId ?? null;
  index.push({ slug: a.slug, name: a.name, bookCount: a.books.length, coverId: cover });
}
await writeFile('public/data/authors.json', JSON.stringify(index, null, 2) + '\n');

const noCover = books.filter((b) => !b.coverId).map((b) => b.title);
console.log(`${curation.name}: ${books.length} books, ${books.length - unmatched.length} matched to Open Library`);
if (unmatched.length) console.log(`Unmatched (add olKey in curation): ${unmatched.join(', ')}`);
if (noCover.length) console.log(`No cover (add coverId in curation): ${noCover.join(', ')}`);
