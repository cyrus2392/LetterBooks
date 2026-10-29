// Suggestions for the home page, from the books you've read:
//   upNext        the next book in each series you've started
//   fromYourAuthors   popular books by authors you've read, starting series at book 1
//   discover      popular books and authors in the genres you read, by authors you don't
//
// Each returns more than the page shows; the page filters out dismissed
// suggestions and trims, so dismissing one brings in the next.
//
// Ratings steer everything: books you rated 4+ count double, 2 or less not at all.

import { seriesOf } from './data.js';
import { fetchGenres, popularInGenre, GENRES } from './sources.js';

const DAY = 24 * 60 * 60 * 1000;

// How much a read book should influence suggestions.
const weightOf = (rating) => (rating == null ? 1 : rating >= 4 ? 2 : rating <= 2 ? 0 : 1);

// Wraps an async lookup in a localStorage cache.
async function cached(key, ttl, load) {
  const storageKey = `letterbooks:cache:${key}`;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && Date.now() - saved.at < ttl) return saved.value;
  } catch {
    // No usable cache.
  }
  const value = await load();
  try {
    localStorage.setItem(storageKey, JSON.stringify({ at: Date.now(), value }));
  } catch {
    // Not cached.
  }
  return value;
}

// authors: your authors, fully loaded. read: readBooks() from the store.
// isRead / isHidden / shelfOf: store lookups.
export function upNext(authors, read, { isRead, isHidden, shelfOf }) {
  const out = [];
  for (const author of authors) {
    const visible = author.books.filter((b) => !isHidden(b.id));
    for (const series of seriesOf({ books: visible })) {
      // Only series with a reading order; "Cosmere"-style groupings have none.
      if (series.books.every((b) => b.position == null)) continue;
      const lastRead = series.books.findLastIndex((b) => isRead(b.id));
      if (lastRead < 0) continue;
      const next = series.books.slice(lastRead + 1).find((b) => !isRead(b.id) && shelfOf(b.id) !== 'reading');
      if (!next) continue;
      // `read` is newest first, so a lower index means you read from this series more recently.
      const recency = Math.min(...series.books.map((b) => read.findIndex((r) => r.id === b.id)).filter((i) => i >= 0));
      out.push({
        book: next,
        authorRef: author.slug,
        reason: `${series.name}${next.position != null ? ` #${next.position}` : ''}`,
        recency,
      });
    }
  }
  return out.sort((a, b) => a.recency - b.recency).slice(0, 24);
}

export function fromYourAuthors(authors, read, { isRead, isHidden, shelfOf }, exclude = new Set()) {
  const out = [];
  for (const author of authors) {
    const yours = read.filter((r) => r.authorSlug === author.slug || author.books.some((b) => b.id === r.id));
    const weight = yours.reduce((sum, r) => sum + weightOf(r.rating), 0);
    if (!weight) continue;
    const startedSeries = new Set(
      seriesOf({ books: author.books }).filter((s) => s.books.some((b) => isRead(b.id))).map((s) => s.name),
    );
    const candidates = author.books
      .filter((b) => !isRead(b.id) && !isHidden(b.id) && !shelfOf(b.id) && !exclude.has(b.id))
      // Don't suggest book 4 of a series you haven't started; book 1 is fine.
      .filter((b) => !b.series?.length || b.series.some((s) => startedSeries.has(s.name) || s.position == null || s.position <= 1))
      .sort((a, b) => (b.readers ?? 0) - (a.readers ?? 0))
      .slice(0, 3);
    for (const book of candidates) {
      out.push({ book, authorRef: author.slug, reason: `More from ${author.name}`, score: weight * Math.log1p(book.readers ?? 0) });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 30);
}

// The genres behind your reading, weighted by rating: [{ label, query, score, because }].
// Each book counts towards its two most specific genres, and genres are
// picked so every book is represented (so two King novels don't drown out
// one Sanderson), up to four.
async function yourGenres(read) {
  const sample = read.filter((r) => /^OL\d+W$/.test(r.id) && weightOf(r.rating) > 0).slice(0, 15);
  const perBook = await Promise.all(
    sample.map(async (r) => {
      const labels = await cached(`genres:${r.id}`, 30 * DAY, () => fetchGenres(r.id)).catch(() => []);
      const genres = labels.map((l) => GENRES.find((g) => g.label === l)).filter(Boolean);
      return { r, genres: genres.sort((a, b) => b.weight - a.weight).slice(0, 2) };
    }),
  );

  const tallies = new Map();
  for (const { r, genres } of perBook) {
    for (const g of genres) {
      const t = tallies.get(g.label) ?? { ...g, score: 0, because: [] };
      t.score += g.weight * weightOf(r.rating);
      t.because.push(r);
      tallies.set(g.label, t);
    }
  }

  const picked = [];
  const covered = new Set();
  const uncovered = (t) => t.because.filter((r) => !covered.has(r.id));
  const adds = (t) => uncovered(t).length;
  // How much a genre adds from books not yet represented.
  const gain = (t) => uncovered(t).reduce((sum, r) => sum + t.weight * weightOf(r.rating), 0);
  while (picked.length < 4) {
    const rest = [...tallies.values()].filter((t) => !picked.includes(t));
    if (!rest.length) break;
    // Genres that represent a new book first; then the more specific genre
    // ("Epic fantasy" over "Fantasy"); then the bigger gain; then list order.
    rest.sort(
      (a, b) =>
        (adds(b) > 0) - (adds(a) > 0) ||
        b.weight - a.weight ||
        gain(b) - gain(a) ||
        GENRES.findIndex((g) => g.label === a.label) - GENRES.findIndex((g) => g.label === b.label),
    );
    // Beyond two genres, only add one that brings in a book not yet represented.
    if (picked.length >= 2 && !adds(rest[0])) break;
    picked.push(rest[0]);
    rest[0].because.forEach((r) => covered.add(r.id));
  }
  return picked;
}

// Take items from each list in turn, so no one genre fills the row.
function interleave(lists) {
  const out = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (i < l.length) out.push(l[i]);
  }
  return out;
}

// Books and authors you might like: popular books in your genres by authors
// you don't already read.
export async function discover(read, yourAuthorKeys, { isRead }) {
  const genres = await yourGenres(read);
  const lists = await Promise.all(
    genres.map((g) => cached(`genre:${g.query}`, DAY, () => popularInGenre(g.query)).catch(() => [])),
  );

  // Per genre: candidate books, best first, at most two per author.
  const perGenre = genres.map((g, i) => {
    const because = [...g.because].sort((a, b) => (b.rating ?? 3) - (a.rating ?? 3))[0];
    const perAuthor = new Map();
    return lists[i]
      .filter((b) => !yourAuthorKeys.has(b.authorKey) && !isRead(b.id))
      .sort((a, b) => b.readers * ((b.rating ?? 3.5) / 4) - a.readers * ((a.rating ?? 3.5) / 4))
      .filter((b) => {
        const n = perAuthor.get(b.authorKey) ?? 0;
        perAuthor.set(b.authorKey, n + 1);
        return n < 2;
      })
      .map((b) => ({ ...b, genre: g.label, reason: `${g.label}, like ${because.title}` }));
  });

  // One book per author in the books row; the authors row shows more of each.
  const seenBookAuthors = new Set();
  const books = interleave(perGenre)
    .filter((b) => !seenBookAuthors.has(b.authorKey) && seenBookAuthors.add(b.authorKey))
    .slice(0, 30);

  // Authors: the top few from each genre in turn, with their best books.
  const seenAuthors = new Set();
  const authors = interleave(perGenre)
    .filter((b) => !seenAuthors.has(b.authorKey) && seenAuthors.add(b.authorKey))
    .slice(0, 14)
    .map((b) => ({
      key: b.authorKey,
      name: b.authorName,
      books: perGenre.flat().filter((x) => x.authorKey === b.authorKey).filter((x, i, all) => all.findIndex((y) => y.id === x.id) === i).slice(0, 3),
      reason: b.reason,
    }));

  return { genres: genres.map((g) => g.label), books, authors };
}
