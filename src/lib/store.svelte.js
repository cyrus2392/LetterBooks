// The user's reading data. Everything that reads or writes it goes through
// this module, so it can later be backed by a server (e.g. Supabase) instead
// of localStorage without touching the pages.
//
// Shape (version 2):
//   books[bookId] = {
//     title, authorSlug, coverId, coverRegion   snapshot for lists like the profile
//     quickRead: true?, quickReadAt,     ticked as read without a log
//     shelf: 'reading' | 'tbr' | null, shelvedOn,
//     reads: [{ id, startedOn, finishedOn, rating, review, loggedAt }]
//   }
//   following[olAuthorKey] = { name, followedAt }   authors added from search
//   hidden[bookId] = true                           not counted on author pages
// Dates are local 'YYYY-MM-DD' strings; ratings are 0.5–5 in half steps.

const KEY = 'letterbooks:v1';
const VERSION = 2;

export const SHELVES = { reading: 'Currently reading', tbr: 'Want to read' };

// v1 only stored quick ticks: { status: 'read', markedReadAt, title, authorSlug }.
// following and hidden were added within version 2, so they may be missing.
function migrate(saved) {
  if (saved?.version === VERSION && saved.books) return { following: {}, hidden: {}, ...saved };
  if (saved?.version === 1 && saved.books) {
    const books = {};
    for (const [id, b] of Object.entries(saved.books)) {
      if (b.status !== 'read') continue;
      books[id] = { title: b.title, authorSlug: b.authorSlug, quickRead: true, quickReadAt: b.markedReadAt, reads: [] };
    }
    return { version: VERSION, books, following: {}, hidden: {} };
  }
  return null;
}

function load() {
  try {
    const saved = migrate(JSON.parse(localStorage.getItem(KEY)));
    if (saved) return saved;
  } catch {
    // Unavailable or corrupt storage: start empty.
  }
  return { version: VERSION, books: {}, following: {}, hidden: {} };
}

const data = $state(load());

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Private mode or full storage; the session still works in memory.
  }
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Get the entry for a book, creating it if needed, and refresh its snapshot.
function entry(book, authorSlug) {
  const e = (data.books[book.id] ??= { reads: [] });
  e.title = book.title;
  e.authorSlug = authorSlug;
  e.coverId = book.coverId ?? null;
  e.coverRegion = book.coverRegion ?? null;
  return e;
}

// Drop entries with nothing left in them so they don't count anywhere.
function prune(bookId) {
  const e = data.books[bookId];
  if (e && !e.quickRead && !e.shelf && e.reads.length === 0) delete data.books[bookId];
}

const hasRead = (e) => !!e && (e.quickRead || e.reads.length > 0);

// Read-only accessors

export const getEntry = (bookId) => data.books[bookId];
export const isRead = (bookId) => hasRead(data.books[bookId]);
export const shelfOf = (bookId) => data.books[bookId]?.shelf ?? null;
export const readCount = (bookIds) => bookIds.filter(isRead).length;
export const totalRead = () => Object.values(data.books).filter(hasRead).length;

// Reads sorted newest first; reads without a finish date go last.
export function readsOf(bookId) {
  const reads = data.books[bookId]?.reads ?? [];
  return [...reads].sort((a, b) => (b.finishedOn ?? '').localeCompare(a.finishedOn ?? '') || b.loggedAt.localeCompare(a.loggedAt));
}

export const latestRating = (bookId) => readsOf(bookId).find((r) => r.rating)?.rating ?? null;

export function shelf(name) {
  return Object.entries(data.books)
    .filter(([, e]) => e.shelf === name)
    .sort(([, a], [, b]) => (b.shelvedOn ?? '').localeCompare(a.shelvedOn ?? ''))
    .map(([id, e]) => ({ id, ...e }));
}

// Every logged read across all books, newest first.
export function diary() {
  return Object.entries(data.books)
    .flatMap(([id, e]) => e.reads.map((r) => ({ ...r, bookId: id, title: e.title, authorSlug: e.authorSlug, coverId: e.coverId, coverRegion: e.coverRegion })))
    .sort((a, b) => (b.finishedOn ?? '').localeCompare(a.finishedOn ?? '') || b.loggedAt.localeCompare(a.loggedAt));
}

// Writes

// Quick tick. Unmarking also removes logged reads, so callers should confirm
// first when readsOf(bookId) isn't empty.
export function setRead(book, authorSlug, read) {
  const e = entry(book, authorSlug);
  if (read) {
    e.quickRead = true;
    e.quickReadAt = new Date().toISOString();
    if (e.shelf) e.shelf = null; // finished it, so it's off the TBR / reading shelf
  } else {
    delete e.quickRead;
    delete e.quickReadAt;
    e.reads = [];
  }
  prune(book.id);
  save();
}

export function setShelf(book, authorSlug, name) {
  const e = entry(book, authorSlug);
  e.shelf = name;
  e.shelvedOn = name ? today() : undefined;
  prune(book.id);
  save();
}

export function addRead(book, authorSlug, read) {
  const e = entry(book, authorSlug);
  e.reads.push({ ...clean(read), id: crypto.randomUUID(), loggedAt: new Date().toISOString() });
  e.shelf = null;
  save();
}

export function updateRead(bookId, readId, changes) {
  const r = data.books[bookId]?.reads.find((x) => x.id === readId);
  if (!r) return;
  Object.assign(r, clean(changes));
  save();
}

export function deleteRead(bookId, readId) {
  const e = data.books[bookId];
  if (!e) return;
  e.reads = e.reads.filter((r) => r.id !== readId);
  prune(bookId);
  save();
}

// Followed authors (live ones added from search)

export const isFollowing = (olKey) => !!data.following[olKey];

export const followedAuthors = () =>
  Object.entries(data.following)
    .map(([olKey, a]) => ({ olKey, ...a }))
    .sort((a, b) => a.name.localeCompare(b.name));

export function setFollowing(olKey, name, follow) {
  if (follow) data.following[olKey] = { name, followedAt: new Date().toISOString() };
  else delete data.following[olKey];
  save();
}

// Hidden books: strays in an automatic bibliography (novellas, duplicates).

export const isHidden = (bookId) => !!data.hidden[bookId];

export function setHidden(bookId, hidden) {
  if (hidden) data.hidden[bookId] = true;
  else delete data.hidden[bookId];
  save();
}

const clean = ({ startedOn, finishedOn, rating, review }) => ({
  startedOn: startedOn || null,
  finishedOn: finishedOn || null,
  rating: rating || null,
  review: review?.trim() || null,
});

// Backup

export const exportData = () => JSON.stringify(data, null, 2);

export function importData(json) {
  const parsed = migrate(JSON.parse(json));
  if (!parsed) throw new Error("That file isn't a LetterBooks export.");
  data.books = parsed.books;
  data.following = parsed.following;
  data.hidden = parsed.hidden;
  save();
}
