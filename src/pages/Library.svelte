<script>
  // Your bookshelf (books you own) and the books you've read, side by side.
  // Owning and reading are independent, so each tab can be narrowed by the other.
  import BookCard from '../components/BookCard.svelte';
  import { library } from '../lib/store.svelte.js';
  import { getAuthorNames, surnameKey } from '../lib/data.js';
  import { normalizeTitle } from '../lib/sources.js';
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

  // Filter by author name (ignoring case and punctuation), with the authors
  // in the current tab suggested as you type.
  let authorQuery = $state('');
  const authorNeedle = $derived(normalizeTitle(authorQuery.trim()));
  const tabAuthors = $derived(
    [...new Set((tab === 'read' ? read : owned).map(authorOf).filter(Boolean))].sort((a, b) => surnameKey(a).localeCompare(surnameKey(b))),
  );

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
    const list = (tab === 'read' ? read : owned)
      .filter(TESTS[filter] ?? TESTS.all)
      .filter((b) => !authorNeedle || normalizeTitle(authorOf(b)).includes(authorNeedle));
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
  <input
    type="search"
    class="author-filter"
    bind:value={authorQuery}
    list="library-authors"
    placeholder="Filter by author"
    aria-label="Filter by author"
    onkeydown={(e) => e.key === 'Escape' && (authorQuery = '')}
  />
  <datalist id="library-authors">
    {#each tabAuthors as name}<option value={name}></option>{/each}
  </datalist>
  <label class="sort">
    Sort
    <select bind:value={sort}>
      <option value="recent">{tab === 'read' ? 'Recently read' : 'Recently added'}</option>
      <option value="title">Title</option>
      <option value="author">Author</option>
    </select>
  </label>
</div>

{#if shown.length}
  <div class="grid">
    {#each shown as book (book.id)}
      <BookCard {book} authorSlug={book.authorSlug} authorName={authorOf(book)} />
    {/each}
  </div>
{:else if authorNeedle}
  <p class="muted empty">
    No books by an author matching “{authorQuery.trim()}”.
    <button class="link" onclick={() => (authorQuery = '')}>Clear filter</button>
  </p>
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

  .author-filter {
    flex: 1 1 200px;
    max-width: 280px;
    font: inherit;
    font-size: 0.875rem;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 5px 14px;
  }

  .author-filter:focus { outline: 2px solid var(--accent); outline-offset: 0; border-color: transparent; }

  .link {
    background: none;
    border: none;
    padding: 0;
    color: var(--text);
    text-decoration: underline;
  }
</style>
