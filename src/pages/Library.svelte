<script>
  // Your bookshelf (books you own) and the books you've read, side by side.
  // Owning and reading are independent, so each tab can be narrowed by the other.
  import BookCard from '../components/BookCard.svelte';
  import { library } from '../lib/store.svelte.js';
  import { getAuthorNames, surnameKey } from '../lib/data.js';
  import { href } from '../lib/router.svelte.js';

  let { tab = 'owned' } = $props();

  // Filter within a tab: on the bookshelf, read or unread; in read books, owned or not.
  let filter = $state('all');
  // The sort choice sticks across tabs and visits.
  const SORT_KEY = 'letterbooks:library-sort';
  let sort = $state(savedSort());
  function savedSort() {
    try {
      const s = localStorage.getItem(SORT_KEY);
      return ['recent', 'title', 'author'].includes(s) ? s : 'recent';
    } catch {
      return 'recent';
    }
  }
  $effect(() => {
    try {
      localStorage.setItem(SORT_KEY, sort);
    } catch {
      // Not remembered; the default applies next time.
    }
  });

  const all = $derived(library());
  const owned = $derived(all.filter((b) => b.owned));
  const read = $derived(all.filter((b) => b.read));

  // Author names, looked up from the refs the library stores. Kept in state
  // (not awaited in the template) so toggling a book doesn't flash "loading".
  let names = $state(new Map());
  $effect(() => {
    getAuthorNames(all.map((b) => b.authorSlug)).then((m) => (names = m));
  });
  const authorOf = (b) => names.get(b.authorSlug) ?? '';

  const FILTERS = {
    owned: [
      ['all', 'All'],
      ['unread', 'Not read yet'],
      ['read', 'Read'],
      ['lent', 'Lent out'],
    ],
    read: [
      ['all', 'All'],
      ['owned', 'Owned'],
      ['notowned', "Don't own"],
    ],
  };
  const TESTS = {
    all: () => true,
    unread: (b) => !b.read,
    read: (b) => b.read,
    lent: (b) => !!b.lent,
    owned: (b) => b.owned,
    notowned: (b) => !b.owned,
  };

  const shown = $derived.by(() => {
    const list = (tab === 'read' ? read : owned).filter(TESTS[filter] ?? TESTS.all);
    if (sort === 'title') return [...list].sort((a, b) => a.title.localeCompare(b.title));
    if (sort === 'author') {
      // Surname A–Z, then each author's books in publication order.
      return [...list].sort(
        (a, b) =>
          surnameKey(authorOf(a) || a.authorSlug).localeCompare(surnameKey(authorOf(b) || b.authorSlug)) ||
          (a.year ?? 9999) - (b.year ?? 9999) ||
          a.title.localeCompare(b.title),
      );
    }
    const date = (b) => (tab === 'read' ? b.readAt : b.ownedAt);
    return [...list].sort((a, b) => date(b).localeCompare(date(a)));
  });

  // For the author sort: consecutive runs of the same author, shown under a heading.
  const groups = $derived.by(() => {
    const out = [];
    for (const book of shown) {
      const last = out.at(-1);
      if (last?.ref === book.authorSlug) last.books.push(book);
      else out.push({ ref: book.authorSlug, books: [book] });
    }
    return out;
  });
</script>

<h1>Library</h1>

<p class="summary muted">
  You own <strong>{owned.length}</strong> {owned.length === 1 ? 'book' : 'books'} and have read <strong>{read.length}</strong>.
  {#if owned.length}<strong>{owned.filter((b) => !b.read).length}</strong> on your shelf {owned.filter((b) => !b.read).length === 1 ? "isn't" : "aren't"} read yet.{/if}
  {#if owned.some((b) => b.lent)}<strong>{owned.filter((b) => b.lent).length}</strong> {owned.filter((b) => b.lent).length === 1 ? 'is' : 'are'} lent out.{/if}
</p>

<nav class="tabs" aria-label="Library">
  <a href={href('library', 'owned')} class:active={tab !== 'read'} aria-current={tab !== 'read' ? 'page' : undefined}>
    Bookshelf <span class="count">{owned.length}</span>
  </a>
  <a href={href('library', 'read')} class:active={tab === 'read'} aria-current={tab === 'read' ? 'page' : undefined}>
    Read <span class="count">{read.length}</span>
  </a>
</nav>

<div class="controls">
  <div class="chips" role="group" aria-label="Filter">
    {#each FILTERS[tab === 'read' ? 'read' : 'owned'] as [value, label]}
      <button class="chip" aria-pressed={filter === value} onclick={() => (filter = value)}>{label}</button>
    {/each}
  </div>
  <label class="sort">
    Sort
    <select bind:value={sort}>
      <option value="recent">{tab === 'read' ? 'Recently read' : 'Recently added'}</option>
      <option value="title">Title</option>
      <option value="author">Author</option>
    </select>
  </label>
</div>

{#if shown.length && sort === 'author'}
  {#each groups as group (group.ref)}
    <section class="group">
      <h2>
        <a href={href('author', group.ref)}>{names.get(group.ref) ?? 'Loading…'}</a>
        <span class="count">{group.books.length}</span>
      </h2>
      <div class="grid">
        {#each group.books as book (book.id)}
          <BookCard {book} authorSlug={book.authorSlug} />
        {/each}
      </div>
    </section>
  {/each}
{:else if shown.length}
  <div class="grid">
    {#each shown as book (book.id)}
      <BookCard {book} authorSlug={book.authorSlug} authorName={authorOf(book)} />
    {/each}
  </div>
{:else if tab === 'read'}
  <p class="muted empty">{read.length ? 'Nothing matches that filter.' : 'Books you mark as read will appear here.'}</p>
{:else}
  <p class="muted empty">
    {owned.length
      ? 'Nothing matches that filter.'
      : 'Your bookshelf is empty. Use the book button on the top left of any cover, or "I own this" on a book page, to add books you own.'}
  </p>
{/if}

<style>
  h1 { font-size: 2rem; margin-bottom: 8px; }

  .summary { margin: 0 0 20px; }

  .summary strong { color: var(--text); }

  .tabs {
    display: flex;
    gap: 24px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 16px;
  }

  .tabs a {
    padding: 8px 0;
    margin-bottom: -1px;
    border-bottom: 2px solid transparent;
    text-decoration: none;
    font-weight: 700;
    color: var(--muted);
  }

  .tabs a.active { color: var(--text); border-bottom-color: var(--accent); }

  .count {
    margin-left: 4px;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--surface-2);
    font-size: 0.8rem;
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 24px;
  }

  .chips { display: flex; flex-wrap: wrap; gap: 8px; }

  .chip {
    padding: 5px 12px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--surface);
    font-size: 0.875rem;
  }

  .chip[aria-pressed='true'] { border-color: var(--accent); color: var(--accent); font-weight: 600; }

  .sort { display: flex; align-items: center; gap: 8px; font-size: 0.875rem; color: var(--muted); }

  select {
    font: inherit;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 4px 8px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 24px 16px;
  }

  @media (max-width: 480px) {
    .grid { grid-template-columns: repeat(3, 1fr); gap: 16px 10px; }
  }

  .empty { max-width: 520px; }

  .group + .group { margin-top: 36px; }

  .group h2 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 14px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
    font-size: 1.1rem;
  }

  .group h2 a { text-decoration: none; }

  .group h2 a:hover { text-decoration: underline; }
</style>
