// Book data. Curated authors are static JSON under public/data (built by
// scripts/import-author.mjs); any other author is built live from
// Wikipedia + Open Library + Wikidata and cached in the browser for a week.

import { buildAuthor, isOlAuthorKey, fetchWork, fetchUkCover } from './sources.js';

const base = import.meta.env.BASE_URL;
const cache = new Map();
const DAY = 24 * 60 * 60 * 1000;
const LIVE_TTL = 7 * DAY;
const COVER_TTL = 30 * DAY;

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
    // Bumped when the shape changes (v2: Wikipedia lists; v3: reader counts) so older caches are ignored.
    const storageKey = `letterbooks:cache:author-v3:${olKey}`;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (saved && Date.now() - saved.fetchedAt < LIVE_TTL) return saved.author;
    } catch {
      // No usable cache; fetch below.
    }
    const author = await buildAuthor(olKey);
    // A fallback caused by Wikipedia being unreachable shouldn't stick for a week.
    if (!author.source.temporary) {
      try {
        localStorage.setItem(storageKey, JSON.stringify({ fetchedAt: Date.now(), author }));
      } catch {
        // Storage full or unavailable; it just won't be cached.
      }
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

// Your authors: every curated author plus the given refs (authors you've
// added, or read a book by), de-duplicated, loaded in full and sorted by
// name. An author that fails to load is left out rather than breaking the list.
export async function getYourAuthors(refs) {
  const curated = await getAuthors();
  const all = new Set(curated.map((a) => a.slug));
  for (const ref of refs) all.add(curated.find((a) => a.olKey === ref)?.slug ?? ref);
  const results = await Promise.allSettled([...all].map(getAuthor));
  return results
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value)
    .sort((a, b) => a.name.localeCompare(b.name));
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

export const TYPE_LABELS = { novel: 'Novel', collection: 'Collection', nonfiction: 'Non-fiction', children: "Children's book" };

// UK covers. Curated books have theirs picked at import time (coverRegion is
// set); for live authors each cover is looked up on first display, a few at
// a time, and remembered for a month. Resolves to a cover id, or null to use
// the book's default cover.

const COVERS_KEY = 'letterbooks:cache:uk-covers';
let ukCovers;
function savedUkCovers() {
  if (!ukCovers) {
    try {
      ukCovers = JSON.parse(localStorage.getItem(COVERS_KEY)) ?? {};
    } catch {
      ukCovers = {};
    }
  }
  return ukCovers;
}

const queue = [];
let active = 0;
function limited(task) {
  return new Promise((resolve, reject) => {
    queue.push(() => task().then(resolve, reject));
    pump();
  });
}
function pump() {
  while (active < 4 && queue.length) {
    active++;
    queue.shift()().finally(() => {
      active--;
      pump();
    });
  }
}

export function ukCoverId(workId) {
  const saved = savedUkCovers()[workId];
  if (saved && Date.now() - saved.at < COVER_TTL) return Promise.resolve(saved.id);
  return memo(`uk:${workId}`, () =>
    limited(() => fetchUkCover(workId)).then((id) => {
      savedUkCovers()[workId] = { id, at: Date.now() };
      try {
        localStorage.setItem(COVERS_KEY, JSON.stringify(ukCovers));
      } catch {
        // Not cached; it'll be looked up again next time.
      }
      return id;
    }),
  );
}
