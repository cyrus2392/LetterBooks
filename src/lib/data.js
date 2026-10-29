// Book data. Curated authors are static JSON under public/data (built by
// scripts/import-author.mjs); any other author is built live from Open
// Library + Wikidata and cached in the browser for a week.

import { buildAuthor, isOlAuthorKey, fetchWork } from './sources.js';

const base = import.meta.env.BASE_URL;
const cache = new Map();
const LIVE_TTL = 7 * 24 * 60 * 60 * 1000;

function memo(key, load) {
  if (!cache.has(key)) {
    const p = load();
    cache.set(key, p);
    p.catch(() => cache.delete(key)); // allow a retry after a failure
  }
  return cache.get(key);
}

function getJson(path) {
  return memo(path, () =>
    fetch(`${base}data/${path}`).then((res) => {
      if (!res.ok) throw new Error(`Couldn't load ${path} (${res.status})`);
      return res.json();
    }),
  );
}

// Curated authors: [{ slug, name, olKey, bookCount, coverId }]
export const getAuthors = () => getJson('authors.json');

function getLiveAuthor(olKey) {
  return memo(`live:${olKey}`, async () => {
    const storageKey = `letterbooks:cache:author:${olKey}`;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (saved && Date.now() - saved.fetchedAt < LIVE_TTL) return saved.author;
    } catch {
      // No usable cache; fetch below.
    }
    const author = await buildAuthor(olKey);
    try {
      localStorage.setItem(storageKey, JSON.stringify({ fetchedAt: Date.now(), author }));
    } catch {
      // Storage full or unavailable; it just won't be cached.
    }
    return author;
  });
}

// `ref` is a curated author's slug or an Open Library author key (OL…A).
// An OL key that belongs to a curated author resolves to the curated data.
export async function getAuthor(ref) {
  if (isOlAuthorKey(ref)) {
    const curated = (await getAuthors()).find((a) => a.olKey === ref);
    return curated ? getAuthor(curated.slug) : getLiveAuthor(ref);
  }
  return getJson(`authors/${ref}.json`);
}

// A book by its author ref and work id. Falls back to Open Library for works
// that aren't in the author's list (e.g. filtered out, or found by search).
export async function getBook(authorRef, bookId) {
  const author = await getAuthor(authorRef);
  const book = author.books.find((b) => b.id === bookId) ?? (author.live ? await memo(`work:${bookId}`, () => fetchWork(bookId)) : null);
  if (!book) throw new Error('Book not found');
  return { author, book };
}

// Series an author's books belong to, each with its books in reading order.
// Books without a position go last, by year.
export function seriesOf(author) {
  const byName = new Map();
  for (const book of author.books) {
    for (const s of book.series ?? []) {
      if (!byName.has(s.name)) byName.set(s.name, []);
      byName.get(s.name).push({ book, position: s.position });
    }
  }
  return [...byName]
    .map(([name, entries]) => ({
      name,
      books: entries
        .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || a.book.year - b.book.year)
        .map((e) => ({ ...e.book, position: e.position })),
    }))
    .sort((a, b) => a.books[0].year - b.books[0].year);
}

export const coverUrl = (coverId, size = 'M') =>
  coverId ? `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg` : null;

export const TYPE_LABELS = { novel: 'Novel', collection: 'Collection', nonfiction: 'Non-fiction' };
