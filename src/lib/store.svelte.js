// The user's reading data. Everything that reads or writes it goes through
// this module, so it can later be backed by a server (e.g. Supabase) instead
// of localStorage without touching the pages.

const KEY = 'letterbooks:v1';

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved?.version === 1 && saved.books) return saved;
  } catch {
    // Unavailable or corrupt storage: start empty.
  }
  return { version: 1, books: {} };
}

const data = $state(load());

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Private mode or full storage; the session still works in memory.
  }
}

export const isRead = (bookId) => data.books[bookId]?.status === 'read';

export function setRead(book, authorSlug, read) {
  if (read) {
    data.books[book.id] = {
      status: 'read',
      markedReadAt: new Date().toISOString(),
      title: book.title,
      authorSlug,
    };
  } else {
    delete data.books[book.id];
  }
  save();
}

export const readCount = (bookIds) => bookIds.filter(isRead).length;

export const totalRead = () => Object.values(data.books).filter((b) => b.status === 'read').length;

export const exportData = () => JSON.stringify(data, null, 2);

export function importData(json) {
  const parsed = JSON.parse(json);
  if (parsed?.version !== 1 || typeof parsed.books !== 'object') {
    throw new Error("That file isn't a LetterBooks export.");
  }
  data.books = parsed.books;
  save();
}
