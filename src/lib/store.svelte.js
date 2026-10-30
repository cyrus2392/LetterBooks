// The user's reading data. Everything that reads or writes it goes through
// this module, so it can later be backed by a server (e.g. Supabase) instead
// of localStorage without touching the pages.
//
// Shape (version 2):
//   books[bookId] = {
//     title, year, authorSlug, coverId, coverRegion   snapshot for lists like the profile
//     quickRead: true?, quickReadAt,     ticked as read without a log
//     owned: true?, ownedAt,             on your physical shelf; independent of reading
//     lent: { to, on }?                  currently lent out (owned books only)
//     loans: [{ to, lentOn, returnedOn }]   past loans, oldest first
//     shelf: 'reading' | 'tbr' | null, shelvedOn,
//     reads: [{ id, startedOn, finishedOn, rating, review, loggedAt }]
//   }
//   following[olAuthorKey] = { name, followedAt }   authors added from search
//   hidden[bookId] = true                           not counted on author pages
//   dismissed['book:<id>' | 'author:<key>'] = true  suggestions you're not interested in
// Dates are local 'YYYY-MM-DD' strings; ratings are 0.5–5 in half steps.

const KEY = 'letterbooks:v1';
const VERSION = 2;

export const SHELVES = { reading: 'Currently reading', tbr: 'Want to read' };

// v1 only stored quick ticks: { status: 'read', markedReadAt, title, authorSlug }.
// following, hidden and dismissed were added within version 2, so they may be missing.
function migrate(saved) {
  if (saved?.version === VERSION && saved.books) return { following: {}, hidden: {}, dismissed: {}, ...saved };
  if (saved?.version === 1 && saved.books) {
    const books = {};
    for (const [id, b] of Object.entries(saved.books)) {
      if (b.status !== 'read') continue;
      books[id] = { title: b.title, authorSlug: b.authorSlug, quickRead: true, quickReadAt: b.markedReadAt, reads: [] };
    }
    return { version: VERSION, books, following: {}, hidden: {}, dismissed: {} };
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
  return { version: VERSION, books: {}, following: {}, hidden: {}, dismissed: {} };
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
  data.books[book.id] ??= { reads: [] };
  const e = data.books[book.id]; // read back the reactive copy, not the literal above
  e.title = book.title;
  e.year = book.year ?? e.year ?? null;
  e.authorSlug = authorSlug;
  e.coverId = book.coverId ?? null;
  e.coverRegion = book.coverRegion ?? null;
  return e;
}

// Drop entries with nothing left in them so they don't count anywhere.
function prune(bookId) {
  const e = data.books[bookId];
  if (e && !e.quickRead && !e.owned && !e.shelf && e.reads.length === 0) delete data.books[bookId];
}

const hasRead = (e) => !!e && (e.quickRead || e.reads.length > 0);

// Read-only accessors

export const getEntry = (bookId) => data.books[bookId];
export const isRead = (bookId) => hasRead(data.books[bookId]);
export const shelfOf = (bookId) => data.books[bookId]?.shelf ?? null;
export const readCount = (bookIds) => bookIds.filter(isRead).length;
export const totalRead = () => Object.values(data.books).filter(hasRead).length;
export const isOwned = (bookId) => !!data.books[bookId]?.owned;
export const ownedCount = (bookIds) => bookIds.filter(isOwned).length;
export const totalOwned = () => Object.values(data.books).filter((e) => e.owned).length;

// Every book you've read or own, as book-like objects for covers and links,
// with when you last read it and when you got it.
export function library() {
  return Object.entries(data.books)
    .filter(([, e]) => hasRead(e) || e.owned)
    .map(([id, e]) => {
      const reads = readsOf(id);
      return {
        id,
        olWorkId: /^OL\d+W$/.test(id) ? id : null,
        title: e.title,
        year: e.year ?? null,
        coverId: e.coverId,
        coverRegion: e.coverRegion,
        authorSlug: e.authorSlug,
        read: hasRead(e),
        owned: !!e.owned,
        lent: e.lent ?? null,
        readOn: reads[0]?.finishedOn ?? e.quickReadAt?.slice(0, 10) ?? '',
        ownedAt: e.ownedAt ?? '', // full timestamp, so books added the same day still sort
      };
    });
}

// Every book you've read, most recent first, with your latest rating.
export function readBooks() {
  return Object.entries(data.books)
    .filter(([, e]) => hasRead(e))
    .map(([id, e]) => {
      const reads = readsOf(id);
      return {
        id,
        title: e.title,
        authorSlug: e.authorSlug,
        rating: reads.find((r) => r.rating)?.rating ?? null,
        readOn: reads[0]?.finishedOn ?? e.quickReadAt?.slice(0, 10) ?? '',
      };
    })
    .sort((a, b) => b.readOn.localeCompare(a.readOn));
}

// Authors you've read at least one book by, as refs (curated slug or Open Library key).
export const readAuthorRefs = () => [
  ...new Set(Object.values(data.books).filter(hasRead).map((e) => e.authorSlug).filter(Boolean)),
];

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

// Owning a book is separate from reading it: unmarking one never touches the other.
export function setOwned(book, authorSlug, owned) {
  const e = entry(book, authorSlug);
  if (owned) {
    e.owned = true;
    e.ownedAt = new Date().toISOString();
  } else {
    // A book you don't own can't be out on loan; callers confirm first.
    delete e.owned;
    delete e.ownedAt;
    delete e.lent;
  }
  prune(book.id);
  save();
}

// Lending (owned books only)

export const lentTo = (bookId) => data.books[bookId]?.lent ?? null;

// Past loans, most recent first.
export const loansOf = (bookId) => [...(data.books[bookId]?.loans ?? [])].reverse();

// Everyone you've lent to, most recent first, for suggesting names.
export function borrowers() {
  const all = Object.values(data.books).flatMap((e) => [
    ...(e.lent ? [{ to: e.lent.to, on: e.lent.on }] : []),
    ...(e.loans ?? []).map((l) => ({ to: l.to, on: l.lentOn })),
  ]);
  all.sort((a, b) => b.on.localeCompare(a.on));
  return [...new Set(all.map((l) => l.to))];
}

export const totalLent = () => Object.values(data.books).filter((e) => e.owned && e.lent).length;

// Lend a book, or change who/when for the current loan.
export function lend(bookId, to, on) {
  const e = data.books[bookId];
  if (!e?.owned) return;
  e.lent = { to: to.trim(), on };
  save();
}

// The book's back: move the current loan into its history.
export function markReturned(bookId, returnedOn = today()) {
  const e = data.books[bookId];
  if (!e?.lent) return;
  // Assign first, then push: `(e.loans ??= []).push()` would push onto the
  // plain array rather than the reactive copy stored on `e`.
  e.loans ??= [];
  e.loans.push({ to: e.lent.to, lentOn: e.lent.on, returnedOn });
  delete e.lent;
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

// Dismissed suggestions ("not interested"), keyed 'book:<id>' or 'author:<key>'.

export const isDismissed = (key) => !!data.dismissed[key];
export const dismissedCount = () => Object.keys(data.dismissed).length;

export function setDismissed(key, dismissed) {
  if (dismissed) data.dismissed[key] = true;
  else delete data.dismissed[key];
  save();
}

export function clearDismissed() {
  data.dismissed = {};
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
  data.dismissed = parsed.dismissed;
  save();
}
