<script>
  // Your bookshelf (books you own) and the books you've read, side by side.
  // Owning and reading are independent, so each tab can be narrowed by the other.
  import BookCard from '../components/BookCard.svelte';
  import Spine from '../components/Spine.svelte';
  import Icon from '../components/Icon.svelte';
  import { faBookOpen, faTableCells } from '@fortawesome/free-solid-svg-icons';
  import { library, shelfOrder, setShelfOrder } from '../lib/store.svelte.js';
  import { getAuthorNames, getPageCounts, getShelfInfo, surnameKey } from '../lib/data.js';
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
      return ['recent', 'title', 'author', 'custom'].includes(s) ? s : 'recent';
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

  // Shelf (spines, like a real bookshelf) or covers; remembered like the sort.
  const VIEW_KEY = 'letterbooks:library-view';
  let view = $state(savedView());
  function savedView() {
    try {
      return localStorage.getItem(VIEW_KEY) === 'covers' ? 'covers' : 'shelf';
    } catch {
      return 'shelf';
    }
  }
  $effect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // Not remembered; the shelf shows next time.
    }
  });

  // Shelf height follows the screen, so phones fit a useful number of spines per row.
  let narrow = $state(false);
  $effect(() => {
    const query = matchMedia('(max-width: 600px)');
    narrow = query.matches;
    const update = () => (narrow = query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  });
  const shelfHeight = $derived(narrow ? 150 : 200);

  const all = $derived(library());
  const ownedOnly = $derived(all.filter((b) => b.owned));
  // The bookshelf is everything physically on it: books you own and books you've borrowed.
  const owned = $derived(all.filter((b) => b.owned || b.borrowed));
  const borrowedCount = $derived(owned.filter((b) => b.borrowed).length);
  const read = $derived(all.filter((b) => b.read));

  // Author names, looked up from the refs the library stores. Kept in state
  // (not awaited in the template) so toggling a book doesn't flash "loading".
  let names = $state(new Map());
  $effect(() => {
    getAuthorNames(all.map((b) => b.authorSlug)).then((m) => (names = m));
  });
  const authorOf = (b) => names.get(b.authorSlug) ?? '';

  // Page counts size the spines; until they arrive, spines get a natural mix of widths.
  let pageCounts = $state(new Map());
  $effect(() => {
    getPageCounts(all).then((m) => (pageCounts = m));
  });

  // Current years and numbered series from the author lists, for sorting by author.
  let shelfInfo = $state(new Map());
  $effect(() => {
    getShelfInfo(all).then((m) => (shelfInfo = m));
  });
  const seriesOf = (b) => shelfInfo.get(b.id)?.series ?? null;

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
      ['borrowed', 'Borrowed'],
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
    borrowed: (b) => !!b.borrowed,
    owned: (b) => b.owned,
    notowned: (b) => !b.owned,
  };

  const shown = $derived.by(() => {
    const list = (tab === 'read' ? read : owned)
      .filter(TESTS[filter] ?? TESTS.all)
      .filter((b) => !authorNeedle || normalizeTitle(authorOf(b)).includes(authorNeedle));
    if (sort === 'title') return [...list].sort((a, b) => a.title.localeCompare(b.title));
    if (sort === 'author') return byAuthor(list);
    if (sort === 'custom') return byCustom(list);
    const date = (b) => (tab === 'read' ? b.readAt : b.ownedAt);
    return [...list].sort((a, b) => date(b).localeCompare(date(a)));
  });

  // Your own order, from dragging books around. Books it doesn't include yet
  // (added since, or never moved) follow in author order.
  const tabKey = $derived(tab === 'read' ? 'read' : 'owned');
  function byCustom(list) {
    const at = new Map(shelfOrder(tabKey).map((id, i) => [id, i]));
    const placed = list.filter((b) => at.has(b.id)).sort((a, b) => at.get(a.id) - at.get(b.id));
    return [...placed, ...byAuthor(list.filter((b) => !at.has(b.id)))];
  }

  // Put a book just before or after another, in the whole tab's order (so
  // books hidden by a filter keep their places).
  function moveBook(id, targetId, after) {
    if (id === targetId) return;
    const ids = byCustom(tab === 'read' ? read : owned).map((b) => b.id).filter((x) => x !== id);
    const i = ids.indexOf(targetId);
    if (i < 0) return;
    ids.splice(after ? i + 1 : i, 0, id);
    setShelfOrder(tabKey, ids);
  }

  // Dragging spines. A mouse drag starts once the pointer moves a little; on
  // a touch screen, press and hold a book first, so swiping still scrolls.
  const arranging = $derived(sort === 'custom' && view === 'shelf');
  let drag = $state(null); // { id, x, y, dx, dy, active }
  let drop = $state(null); // { id, after }
  let holdTimer = null;

  function grab(event, id) {
    if (!arranging || event.button !== 0) return;
    drag = { id, x: event.clientX, y: event.clientY, dx: 0, dy: 0, active: false, touch: event.pointerType !== 'mouse' };
    if (drag.touch) holdTimer = setTimeout(() => drag && (drag.active = true), 350);
    window.addEventListener('pointermove', follow);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('touchmove', holdStill, { passive: false });
  }

  function follow(event) {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.active) {
      if (Math.hypot(dx, dy) < 6) return;
      if (drag.touch) return cancel(); // moved before the hold: it's a scroll
      drag.active = true;
    }
    drag.dx = dx;
    drag.dy = dy;
    const slot = document.elementsFromPoint(event.clientX, event.clientY).find((el) => el.matches?.('.slot[data-id]') && el.dataset.id !== drag.id);
    if (!slot) return (drop = null);
    const box = slot.getBoundingClientRect();
    drop = { id: slot.dataset.id, after: event.clientX > box.left + box.width / 2 };
  }

  // While dragging on a touch screen, the page mustn't scroll.
  function holdStill(event) {
    if (drag?.active) event.preventDefault();
  }

  function release() {
    const moved = drag?.active;
    if (moved && drop) moveBook(drag.id, drop.id, drop.after);
    cancel();
    // The drag ends over a link; don't open the book.
    if (moved) window.addEventListener('click', (e) => (e.preventDefault(), e.stopPropagation()), { capture: true, once: true });
  }

  function cancel() {
    clearTimeout(holdTimer);
    drag = null;
    drop = null;
    window.removeEventListener('pointermove', follow);
    window.removeEventListener('pointerup', release);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('touchmove', holdStill);
  }

  // Keyboard: Alt + left/right arrow moves the focused book one place.
  function nudge(event, id) {
    if (!arranging || !event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const i = shown.findIndex((b) => b.id === id);
    const target = shown[i + (event.key === 'ArrowLeft' ? -1 : 1)];
    if (target) moveBook(id, target.id, event.key === 'ArrowRight');
    requestAnimationFrame(() => document.querySelector(`.slot[data-id="${CSS.escape(id)}"] a`)?.focus());
  }

  // Surname A–Z, then each author's books in publication order, except that
  // once a series starts, the rest of it that's on this list follows in
  // series order before the next book. So for Sanderson: The Final Empire,
  // then the rest of Mistborn, then The Way of Kings and the rest of
  // Stormlight, then Steelheart and the Reckoners.
  function byAuthor(list) {
    const year = (b) => shelfInfo.get(b.id)?.year ?? b.year ?? 9999;
    const inOrder = (a, b) => year(a) - year(b) || a.title.localeCompare(b.title);
    const groups = new Map();
    for (const b of list) {
      const ref = authorOf(b) || b.authorSlug;
      if (!groups.has(ref)) groups.set(ref, []);
      groups.get(ref).push(b);
    }
    return [...groups]
      .sort(([a], [b]) => surnameKey(a).localeCompare(surnameKey(b)))
      .flatMap(([, books]) => {
        const series = new Map();
        for (const b of books) {
          const s = seriesOf(b);
          if (!s) continue;
          if (!series.has(s.name)) series.set(s.name, []);
          series.get(s.name).push(b);
        }
        for (const members of series.values())
          members.sort((a, b) => seriesOf(a).position - seriesOf(b).position || inOrder(a, b));
        const placed = new Set();
        const out = [];
        for (const b of [...books].sort(inOrder)) {
          if (placed.has(b.id)) continue;
          const s = seriesOf(b);
          for (const x of s ? series.get(s.name) : [b]) {
            placed.add(x.id);
            out.push(x);
          }
        }
        return out;
      });
  }
</script>

<h1>Library</h1>

<p class="summary muted">
  You own <strong>{ownedOnly.length}</strong> {ownedOnly.length === 1 ? 'book' : 'books'}{#if borrowedCount}, have <strong>{borrowedCount}</strong> borrowed,{/if} and have read <strong>{read.length}</strong>.
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
  <div class="views" role="group" aria-label="View">
    <button class="view" aria-pressed={view === 'shelf'} title="Shelf" aria-label="Shelf view" onclick={() => (view = 'shelf')}>
      <Icon icon={faBookOpen} />
    </button>
    <button class="view" aria-pressed={view === 'covers'} title="Covers" aria-label="Covers view" onclick={() => (view = 'covers')}>
      <Icon icon={faTableCells} />
    </button>
  </div>
  <label class="sort">
    Sort
    <select bind:value={sort}>
      <option value="recent">{tab === 'read' ? 'Recently read' : 'Recently added'}</option>
      <option value="title">Title</option>
      <option value="author">Author</option>
      <option value="custom">My order</option>
    </select>
  </label>
</div>

{#if sort === 'custom' && shown.length}
  <p class="muted arrange">
    {#if view === 'shelf'}
      Drag books to arrange your shelf (on a phone, press and hold one first; with a keyboard, Alt and the arrow keys).
    {:else}
      Switch to the shelf view to arrange your books.
    {/if}
    {#if shelfOrder(tabKey).length}<button class="link" onclick={() => confirm('Put these books back in author order?') && setShelfOrder(tabKey, [])}>Reset to author order</button>{/if}
  </p>
{/if}

{#if shown.length && view === 'shelf'}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="shelves" class:arranging class:dragging={drag?.active} style:--shelf="{shelfHeight}px" ondragstart={(e) => arranging && e.preventDefault()} oncontextmenu={(e) => drag && e.preventDefault()}>
    {#each shown as book (book.id)}
      <!-- Own both editions? Both copies stand on the shelf. -->
      {#each book.format === 'both' ? ['paperback', 'hardback'] : [book.format] as edition}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="slot"
          data-id={book.id}
          class:lifted={drag?.active && drag.id === book.id}
          class:drop-before={drop?.id === book.id && !drop.after}
          class:drop-after={drop?.id === book.id && drop.after}
          style:translate={drag?.active && drag.id === book.id ? `${drag.dx}px ${drag.dy}px` : null}
          onpointerdown={(e) => grab(e, book.id)}
          onkeydown={(e) => nudge(e, book.id)}
        >
          <Spine {book} {edition} authorName={authorOf(book)} shelf={shelfHeight} pages={pageCounts.get(book.id)} />
        </div>
      {/each}
    {/each}
  </div>
{:else if shown.length}
  <div class="grid">
    {#each shown as book (book.id)}
      <BookCard {book} authorSlug={book.authorSlug} authorName={authorOf(book)} format={book.format} />
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

  .views { display: flex; gap: 4px; margin-left: auto; }

  .view {
    width: 32px;
    height: 30px;
    display: grid;
    place-items: center;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--muted);
  }

  .view[aria-pressed='true'] { border-color: var(--accent); color: var(--accent); }

  /* The bookcase: rows of spines standing on wooden shelves, between two uprights. */
  .shelves {
    --board: 14px;
    --row: calc(var(--shelf) + 18px + var(--board));
    --wood: #6b4a30;
    --wood-light: #8a6243;
    --wood-dark: #3e2a1b;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    column-gap: 3px;
    padding: 0 14px;
    border-left: 10px solid var(--wood-dark);
    border-right: 10px solid var(--wood-dark);
    border-radius: 4px;
    background:
      repeating-linear-gradient(
        to bottom,
        transparent 0 calc(var(--row) - var(--board)),
        var(--wood-light) calc(var(--row) - var(--board)) calc(var(--row) - var(--board) + 3px),
        var(--wood) calc(var(--row) - var(--board) + 3px) calc(var(--row) - 4px),
        var(--wood-dark) calc(var(--row) - 4px) var(--row)
      ),
      linear-gradient(to bottom, rgb(0 0 0 / 0.28), rgb(0 0 0 / 0.12)),
      var(--surface);
    /* Keep the shelves out of the way of covers swinging past the ends. */
    overflow: visible;
  }

  .slot {
    height: var(--row);
    padding-bottom: var(--board);
    display: flex;
    align-items: flex-end;
  }

  .arrange { display: flex; flex-wrap: wrap; gap: 4px 14px; align-items: baseline; margin: -6px 0 16px; font-size: 0.9rem; }

  .arranging .slot { position: relative; cursor: grab; touch-action: pan-y; -webkit-touch-callout: none; user-select: none; }

  .dragging, .dragging .slot { cursor: grabbing; }

  /* While dragging, books stay put instead of swinging round to show their covers. */
  .dragging :global(.box) { transform: none !important; transition: none !important; }

  .slot.lifted { z-index: 10; pointer-events: none; opacity: 0.85; filter: drop-shadow(0 10px 14px rgb(0 0 0 / 0.5)); }

  /* Where the book will go: a bright line between two spines. */
  .drop-before::before, .drop-after::after {
    content: '';
    position: absolute;
    top: 8px;
    bottom: var(--board);
    width: 4px;
    border-radius: 2px;
    background: var(--accent);
    box-shadow: 0 0 8px var(--accent);
  }

  .drop-before::before { left: -4px; }

  .drop-after::after { right: -4px; }

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
