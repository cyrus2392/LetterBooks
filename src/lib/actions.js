// UI-level helpers shared by the author grid and the book page.
import { isRead, readsOf, setRead, isOwned, setOwned, lentTo } from './store.svelte.js';

// Quick tick toggle. Unticking a book with logged reads deletes them, so ask first.
export function toggleRead(book, authorSlug) {
  if (!isRead(book.id)) return setRead(book, authorSlug, true);
  const logged = readsOf(book.id).length;
  if (logged && !confirm(`Unmark ${book.title} as read? This also deletes ${logged === 1 ? 'your logged read' : `your ${logged} logged reads`}.`)) return;
  setRead(book, authorSlug, false);
}

// Owned toggle. A lent-out book stops being on loan once you don't own it, so ask first.
export function toggleOwned(book, authorSlug) {
  if (!isOwned(book.id)) return setOwned(book, authorSlug, true);
  const loan = lentTo(book.id);
  if (loan && !confirm(`Remove ${book.title} from your bookshelf? It's currently lent to ${loan.to}.`)) return;
  setOwned(book, authorSlug, false);
}
