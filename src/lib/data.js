// Book data. Curated authors are static JSON under public/data (built by
// scripts/import-author.mjs); any other author is built live from
// Wikipedia + Open Library + Wikidata and cached in the browser for a week.

import { buildAuthor, isOlAuthorKey, fetchWork, fetchBookDetails } from './sources.js';

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

// Bumped when the lists change (v2: Wikipedia lists; v3: reader counts; v4: series from
// table columns and captions, main-article works sections; v5: no TV credits; v6: page counts) so older
// caches aren't used while the sources can be reached.
const LIVE_VERSION = 6;
const liveKey = (olKey, version = LIVE_VERSION) => `letterbooks:cache:author-v${version}:${olKey}`;

function readSaved(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

// The newest saved copy of an author's list, however old, for when the
// sources are down. Older versions' copies are rougher but better than nothing.
function lastSaved(olKey) {
  for (let v = LIVE_VERSION; v >= 2; v--) {
    const saved = readSaved(liveKey(olKey, v));
    if (saved?.author) return { ...saved.author, stale: { savedAt: saved.fetchedAt } };
  }
  return null;
}

// How long an author page waits for a rebuild before showing the saved copy.
const FALLBACK_AFTER = 6000;
const fresh = new Map(); // olKey -> author, saved within LIVE_TTL

// Builds an author's list from the sources and saves it. Shared, so the home
// page and an author page waiting on the same author only build it once.
function rebuild(olKey) {
  const key = `build:${olKey}`;
  return memo(key, async () => {
    const author = await buildAuthor(olKey);
    // A fallback caused by Wikipedia being unreachable shouldn't stick for a week.
    if (author.source.temporary) {
      setTimeout(() => cache.delete(key)); // try again next time
      return author;
    }
    fresh.set(olKey, author);
    try {
      localStorage.setItem(liveKey(olKey), JSON.stringify({ fetchedAt: Date.now(), author }));
    } catch {
      // Storage full or unavailable; it just won't be cached.
    }
    return author;
  });
}

// `quick` (the home page): any saved copy is used straight away and
// refreshed in the background. Otherwise a saved copy is only used when the
// sources are down or slow: Wikipedia or Open Library being unreachable can
// mean an error, a rough guess or a long wait, and a saved copy beats all three.
async function getLiveAuthor(olKey, { quick = false } = {}) {
  if (fresh.has(olKey)) return fresh.get(olKey);
  const saved = readSaved(liveKey(olKey));
  if (saved && Date.now() - saved.fetchedAt < LIVE_TTL) {
    fresh.set(olKey, saved.author);
    return saved.author;
  }
  const build = rebuild(olKey);
  const fallback = lastSaved(olKey);
  if (!fallback) return build;
  if (quick) {
    build.catch(() => {}); // refreshes the saved copy for next time
    return fallback;
  }
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), FALLBACK_AFTER));
  const author = await Promise.race([build.catch(() => null), timeout]);
  return author && !author.source.temporary ? author : fallback;
}

// Rebuilds these authors' lists now, however recently they were saved, to
// pick up new details such as page counts. Curated authors come with the
// site, so they're always current and skipped. A few at a time, to go easy
// on the sources. A rebuild that fails keeps the saved list.
export async function refreshAuthors(refs, onProgress) {
  const curated = await getAuthors();
  const live = [...new Set(refs)].filter((ref) => isOlAuthorKey(ref) && !curated.some((a) => a.olKey === ref));
  const queue = [...live];
  let done = 0;
  let failed = 0;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      for (let ref; (ref = queue.shift()); ) {
        cache.delete(`build:${ref}`);
        fresh.delete(ref);
        try {
          if ((await rebuild(ref)).source.temporary) failed++;
        } catch {
          failed++;
        }
        onProgress?.(++done, live.length);
      }
    }),
  );
  return { total: live.length, failed };
}

// `ref` is a curated author's slug or an Open Library author key (OL…A).
// An OL key that belongs to a curated author resolves to the curated data.
export async function getAuthor(ref, options) {
  if (isOlAuthorKey(ref)) {
    const curated = (await getAuthors()).find((a) => a.olKey === ref);
    return curated ? getAuthor(curated.slug) : getLiveAuthor(ref, options);
  }
  return getJson(`authors/${ref}.json`);
}

// Your authors: every curated author plus the given refs (authors you've
// added, or read a book by), de-duplicated, loaded in full and sorted by
// name. Saved lists are used as they are, so the page doesn't wait on the
// sources. An author that fails to load, or takes too long with nothing
// saved, is left out rather than holding up the list.
export async function getYourAuthors(refs) {
  const curated = await getAuthors();
  const all = new Set(curated.map((a) => a.slug));
  for (const ref of refs) all.add(curated.find((a) => a.olKey === ref)?.slug ?? ref);
  const timeout = () => new Promise((_, reject) => setTimeout(() => reject(new Error('Too slow')), FALLBACK_AFTER));
  const results = await Promise.allSettled([...all].map((ref) => Promise.race([getAuthor(ref, { quick: true }), timeout()])));
  return results
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Display names for author refs (curated slug or Open Library key), for lists
// that only store the ref. Curated names come from the index; live authors
// from their cached bibliography, or Open Library, remembered for good.
const NAMES_KEY = 'letterbooks:cache:author-names';
export async function getAuthorNames(refs) {
  const curated = await getAuthors();
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(NAMES_KEY)) ?? {};
  } catch {
    // Start empty.
  }
  const names = new Map();
  await Promise.all(
    [...new Set(refs)].map(async (ref) => {
      const c = curated.find((a) => a.slug === ref || a.olKey === ref);
      if (c) return names.set(ref, c.name);
      if (saved[ref]) return names.set(ref, saved[ref]);
      try {
        const name = (await getAuthor(ref)).name;
        saved[ref] = name;
        names.set(ref, name);
      } catch {
        names.set(ref, 'Unknown author');
      }
    }),
  );
  try {
    localStorage.setItem(NAMES_KEY, JSON.stringify(saved));
  } catch {
    // Not cached.
  }
  return names;
}

// Page counts for books you've saved (which only store a few details), from
// their authors' lists. Books without a known length are left out. Nothing
// waits on this, so it takes fresh lists (older saved ones have no lengths).
export async function getPageCounts(books) {
  const refs = [...new Set(books.map((b) => b.authorSlug))];
  const authors = await Promise.allSettled(refs.map((ref) => getAuthor(ref)));
  const pages = new Map();
  for (const r of authors) {
    if (r.status !== 'fulfilled') continue;
    for (const b of r.value.books) if (b.pages) pages.set(b.id, b.pages);
  }
  return pages;
}

// "Stephen King" -> "king stephen", so authors sort by surname. Suffixes such
// as "Jr." are skipped when finding the surname.
export function surnameKey(name) {
  const parts = name.trim().split(/\s+/);
  let i = parts.length - 1;
  while (i > 0 && /^(jr\.?|sr\.?|ii|iii|iv)$/i.test(parts[i])) i--;
  return [parts[i], ...parts.slice(0, i), ...parts.slice(i + 1)].join(' ').toLowerCase();
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

// Covers come from the LetterBooks covers Worker on Cloudflare
// (workers/covers), which picks each book's UK edition cover once and serves
// images from Cloudflare's cache. It's free and needs no key.
const COVERS_API = 'https://letterbooks-covers.benjfdickinson.workers.dev';

// A specific cover (sizes: S, M, L).
export const coverUrl = (coverId, size = 'M') => (coverId ? `${COVERS_API}/cover/id/${coverId}?size=${size}` : null);

// A book's standard UK cover, chosen by the Worker; `fallbackId` (the work's
// default cover) is used when there's no UK one.
export const workCoverUrl = (workId, fallbackId, size = 'M') =>
  `${COVERS_API}/cover/work/${workId}?size=${size}${fallbackId ? `&fallback=${fallbackId}` : ''}`;

// The Worker URL for the cover a book shows: a cover you've chosen wins;
// curated books already have their UK cover picked (coverRegion set); for
// any other Open Library work the Worker picks the UK one.
export const bookCoverUrl = (book, chosen, size = 'M') =>
  chosen
    ? coverUrl(chosen, size)
    : book.olWorkId && !book.coverRegion
      ? workCoverUrl(book.olWorkId, book.coverId, size)
      : coverUrl(book.coverId, size);

// Straight from Open Library: for when the Worker can't be reached, and for
// browsing many editions in the cover picker without filling the Worker's cache.
export const directCoverUrl = (coverId, size = 'M') =>
  coverId ? `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg` : null;

export const TYPE_LABELS = { novel: 'Novel', collection: 'Collection', nonfiction: 'Non-fiction', children: "Children's book" };

// Release date, synopsis and genres for a book page, remembered for a month.
export function getBookDetails(book, authorName) {
  return memo(`details:${book.id}`, async () => {
    const storageKey = `letterbooks:cache:details:${book.id}`;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (saved && Date.now() - saved.at < COVER_TTL) return saved.details;
    } catch {
      // No usable cache.
    }
    const details = await fetchBookDetails({ olWorkId: book.olWorkId, title: book.title, authorName });
    try {
      localStorage.setItem(storageKey, JSON.stringify({ at: Date.now(), details }));
    } catch {
      // Not cached.
    }
    return details;
  });
}
