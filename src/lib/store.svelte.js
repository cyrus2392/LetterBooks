// The user's reading data. Everything that reads or writes it goes through
// this module, so it can later be backed by a server (e.g. Supabase) instead
// of localStorage without touching the pages.
//
// Shape (version 2):
//   books[bookId] = {
//     title, year, authorSlug, coverId, coverRegion, image   snapshot for lists like the profile
//     quickRead: true?, quickReadAt,     ticked as read without a log
//     owned: true?, ownedAt,             on your physical shelf; independent of reading
//     format: 'hardback' | 'both'?       the edition you own; paperback if not set
//     lent: { to, on }?                  currently lent out (owned books only)
//     loans: [{ to, lentOn, returnedOn }]   past loans, oldest first
//     borrowed: { from, on }?            borrowed from someone and on your shelf (books you don't own)
//     borrows: [{ from, borrowedOn, returnedOn }]   past borrowings, oldest first
//     shelf: 'reading' | 'tbr' | null, shelvedOn,
//     reads: [{ id, startedOn, finishedOn, rating, review, loggedAt }]
//   }
//   following[olAuthorKey] = { name, followedAt }   authors added from search
//   hidden[bookId] = true                           not counted on author pages
//   dismissed['book:<id>' | 'author:<key>'] = true  suggestions you're not interested in
//   covers[bookId] = coverId                        a cover you picked instead of the automatic one
//   shelfOrder = { owned: [bookId], read: [bookId] }   your own arrangement of each library tab
// Dates are local 'YYYY-MM-DD' strings; ratings are 0.5–5 in half steps.

const KEY = 'letterbooks:v1';
const VERSION = 2;

export const SHELVES = { reading: 'Currently reading', tbr: 'Want to read' };

// v1 only stored quick ticks: { status: 'read', markedReadAt, title, authorSlug }.
// following, hidden, dismissed and covers were added within version 2, so they may be missing.
function migrate(saved) {
  if (saved?.version === VERSION && saved.books) return { following: {}, hidden: {}, dismissed: {}, covers: {}, ...saved };
  if (saved?.version === 1 && saved.books) {
    const books = {};
    for (const [id, b] of Object.entries(saved.books)) {
      if (b.status !== 'read') continue;
      books[id] = { title: b.title, authorSlug: b.authorSlug, quickRead: true, quickReadAt: b.markedReadAt, reads: [] };
    }
    return { version: VERSION, books, following: {}, hidden: {}, dismissed: {}, covers: {} };
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
  return { version: VERSION, books: {}, following: {}, hidden: {}, dismissed: {}, covers: {} };
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
  e.image = book.image ?? null;
  return e;
}

// Drop entries with nothing left in them so they don't count anywhere.
function prune(bookId) {
  const e = data.books[bookId];
  if (e && !e.quickRead && !e.owned && !e.borrowed && !e.borrows?.length && !e.shelf && e.reads.length === 0) delete data.books[bookId];
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
    .filter(([, e]) => hasRead(e) || e.owned || e.borrowed)
    .map(([id, e]) => {
      const reads = readsOf(id);
      return {
        id,
        olWorkId: /^OL\d+W$/.test(id) ? id : null,
        title: e.title,
        year: e.year ?? null,
        coverId: e.coverId,
        coverRegion: e.coverRegion,
        image: e.image ?? null,
        authorSlug: e.authorSlug,
        read: hasRead(e),
        owned: !!e.owned,
        lent: e.lent ?? null,
        borrowed: e.borrowed ?? null,
        format: e.owned ? (e.format ?? 'paperback') : null,
        // Finish date of the latest logged read, else when it was ticked (full
        // timestamp, so books ticked the same day still sort).
        readAt: reads[0]?.finishedOn ?? e.quickReadAt ?? '',
        // When it came onto your shelf: bought (full timestamp, so books added
        // the same day still sort) or borrowed.
        ownedAt: e.ownedAt ?? e.borrowed?.on ?? '',
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
    .flatMap(([id, e]) => e.reads.map((r) => ({ ...r, bookId: id, title: e.title, authorSlug: e.authorSlug, coverId: e.coverId, coverRegion: e.coverRegion, image: e.image ?? null })))
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
    // Bought your own copy of a borrowed book: the borrowed one has gone back.
    if (e.borrowed) giveBack(book.id);
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

// Which edition you own: 'paperback' (the default), 'hardback', or 'both'
// when you have a copy of each.
export const FORMATS = { paperback: 'Paperback', hardback: 'Hardback', both: 'Both' };
export const formatOf = (bookId) => (data.books[bookId]?.owned ? (data.books[bookId].format ?? 'paperback') : null);

export function setFormat(bookId, format) {
  const e = data.books[bookId];
  if (!e?.owned || !(format in FORMATS)) return;
  if (format === 'paperback') delete e.format;
  else e.format = format;
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

// Borrowing (books you don't own, while they're on your shelf)

export const borrowedFrom = (bookId) => data.books[bookId]?.borrowed ?? null;

// Past borrowings, most recent first.
export const borrowsOf = (bookId) => [...(data.books[bookId]?.borrows ?? [])].reverse();

// Everyone you've borrowed from or lent to, most recent first, for suggesting names.
export function lenders() {
  const all = Object.values(data.books).flatMap((e) => [
    ...(e.borrowed ? [{ name: e.borrowed.from, on: e.borrowed.on }] : []),
    ...(e.borrows ?? []).map((b) => ({ name: b.from, on: b.borrowedOn })),
  ]);
  all.sort((a, b) => b.on.localeCompare(a.on));
  return [...new Set([...all.map((b) => b.name), ...borrowers()])];
}

// Borrow a book, or change who/when for the current borrowing.
export function borrow(book, authorSlug, from, on) {
  const e = entry(book, authorSlug);
  if (e.owned) return;
  e.borrowed = { from: from.trim(), on };
  save();
}

// You've given it back: move the borrowing into its history.
export function giveBack(bookId, returnedOn = today()) {
  const e = data.books[bookId];
  if (!e?.borrowed) return;
  e.borrows ??= []; // assign first, then push (see markReturned)
  e.borrows.push({ from: e.borrowed.from, borrowedOn: e.borrowed.on, returnedOn });
  delete e.borrowed;
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

// Covers you've chosen for books, overriding the automatic UK pick everywhere.

// Your own order for a library tab ('owned' or 'read'), from dragging books
// around the shelf. Books added since go after these.
export const shelfOrder = (tab) => data.shelfOrder?.[tab] ?? [];

export function setShelfOrder(tab, ids) {
  data.shelfOrder ??= {};
  if (ids.length) data.shelfOrder[tab] = ids;
  else delete data.shelfOrder[tab];
  save();
}

export const chosenCover = (bookId) => data.covers[bookId] ?? null;

export function setChosenCover(bookId, coverId) {
  if (coverId) data.covers[bookId] = coverId;
  else delete data.covers[bookId];
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
  data.covers = parsed.covers;
  save();
}
