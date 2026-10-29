<script>
  import Progress from '../components/Progress.svelte';
  import SuggestionRow from '../components/SuggestionRow.svelte';
  import { getYourAuthors, coverUrl } from '../lib/data.js';
  import {
    readCount, isRead, isHidden, shelfOf, followedAuthors, readAuthorRefs, readBooks, isDismissed, setDismissed,
  } from '../lib/store.svelte.js';
  import { upNext, fromYourAuthors, discover } from '../lib/suggestions.js';
  import { href } from '../lib/router.svelte.js';

  // Curated authors, authors you've added, and anyone you've read a book by.
  // Full author data is needed for per-author read counts (live ones come
  // from the browser cache).
  const authors = $derived(getYourAuthors([...followedAuthors().map((f) => f.olKey), ...readAuthorRefs()]));

  const store = { isRead, isHidden, shelfOf };
  const read = $derived(readBooks());

  // Genre-based suggestions need a few network lookups, so they load on their own.
  const discovered = $derived(
    read.length ? authors.then((list) => discover(read, new Set(list.map((a) => a.olKey)), store)) : null,
  );

  const toItems = (suggestions) =>
    suggestions.map((s) => ({ book: s.book, href: href('book', s.authorRef, s.book.id), reason: s.reason }));

  // "Not interested": hide a suggestion, with a few seconds to undo.
  const visible = (items, limit) => items.filter((i) => !isDismissed(`book:${i.book.id}`)).slice(0, limit);
  let undo = $state(null); // { key, label }
  let undoTimer;
  function dismiss(key, label) {
    setDismissed(key, true);
    undo = { key, label };
    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => (undo = null), 6000);
  }
  function restore() {
    setDismissed(undo.key, false);
    undo = null;
  }
  const dismissBook = (item) => dismiss(`book:${item.book.id}`, item.book.title);
</script>

{#await authors}
  <p class="muted">Loading…</p>
{:then authors}
  {@const next = upNext(authors, read, store)}
  {@const more = fromYourAuthors(authors, read, store, new Set(next.map((s) => s.book.id)))}

  {@const nextItems = visible(toItems(next), 12)}
  {@const moreItems = visible(toItems(more), 12)}
  {#if nextItems.length}
    <section>
      <h2>Up next in your series</h2>
      <SuggestionRow items={nextItems} ondismiss={dismissBook} />
    </section>
  {/if}

  <section>
    <h1>Your authors</h1>
    <ul class="list">
      {#each authors as author (author.slug)}
        {@const ids = author.books.filter((b) => !isHidden(b.id)).map((b) => b.id)}
        <li>
          <a class="card" href={href('author', author.slug)}>
            <div class="covers" aria-hidden="true">
              {#each author.books.filter((b) => b.coverId).slice(0, 3) as book (book.id)}
                <img src={coverUrl(book.coverId, 'S')} alt="" />
              {/each}
            </div>
            <div class="info">
              <h3>{author.name}</h3>
              <Progress read={readCount(ids)} total={ids.length} />
            </div>
          </a>
        </li>
      {/each}
    </ul>
    <p class="muted hint">Looking for someone else? Search for any author at the top of the page.</p>
  </section>

  {#if moreItems.length}
    <section>
      <h2>More from your authors</h2>
      <SuggestionRow items={moreItems} ondismiss={dismissBook} />
    </section>
  {/if}

  {#if !read.length}
    <section>
      <h2>Suggestions</h2>
      <p class="muted">Mark some books as read and suggestions for what to read next will appear here.</p>
    </section>
  {:else if discovered}
    {#await discovered}
      <section>
        <h2>Books you might like</h2>
        <p class="muted">Finding books in the genres you read…</p>
      </section>
    {:then found}
      {@const bookItems = visible(
        found.books
          .filter((b) => !isDismissed(`author:${b.authorKey}`))
          .map((b) => ({ book: b, href: href('book', b.authorKey, b.id), reason: `${b.authorName} · ${b.reason}` })),
        14,
      )}
      {@const authorItems = found.authors.filter((a) => !isDismissed(`author:${a.key}`)).slice(0, 6)}
      {#if bookItems.length}
        <section>
          <h2>Books you might like</h2>
          <p class="muted sub">Popular in {found.genres.join(', ').toLowerCase()}, by authors you haven't read yet.</p>
          <SuggestionRow items={bookItems} ondismiss={dismissBook} />
        </section>
      {/if}
      {#if authorItems.length}
        <section>
          <h2>Authors you might like</h2>
          <ul class="list">
            {#each authorItems as a (a.key)}
              <li class="suggested">
                <button class="dismiss" aria-label="Not interested in {a.name}" title="Not interested"
                        onclick={() => dismiss(`author:${a.key}`, a.name)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
                <a class="card" href={href('author', a.key)}>
                  <div class="covers" aria-hidden="true">
                    {#each a.books.filter((b) => b.coverId) as book (book.id)}
                      <img src={coverUrl(book.coverId, 'S')} alt="" />
                    {/each}
                  </div>
                  <div class="info">
                    <h3>{a.name}</h3>
                    <p class="muted reason">{a.reason}</p>
                  </div>
                </a>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    {:catch}
      <!-- Suggestions are optional; say nothing if Open Library is unreachable. -->
    {/await}
  {/if}
{:catch error}
  <p>{error.message}</p>
{/await}

{#if undo}
  <div class="toast" role="status">
    <span>Hid “{undo.label}” from suggestions.</span>
    <button class="link" onclick={restore}>Undo</button>
  </div>
{/if}

<style>
  section + section { margin-top: 40px; }

  h1 { font-size: 2rem; margin-bottom: 20px; }

  h2 {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    padding-bottom: 8px;
    margin-bottom: 16px;
    border-bottom: 1px solid var(--border);
  }

  .sub { margin: -8px 0 14px; font-size: 0.875rem; }

  .hint { margin-top: 24px; }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr));
    gap: 16px;
  }

  .card {
    display: flex;
    gap: 16px;
    align-items: center;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    text-decoration: none;
  }

  .card:hover { border-color: var(--accent); }

  .covers { display: flex; flex-shrink: 0; }

  .covers img {
    width: 44px;
    aspect-ratio: 2 / 3;
    object-fit: cover;
    border-radius: 3px;
    box-shadow: 0 1px 6px rgb(0 0 0 / 0.35);
  }

  .covers img + img { margin-left: -18px; }

  .info { flex: 1; min-width: 0; }

  h3 { font-size: 1.15rem; margin-bottom: 10px; }

  .reason { margin: -4px 0 0; font-size: 0.85rem; }

  .suggested { position: relative; }

  .suggested .card { padding-right: 44px; }

  .dismiss {
    position: absolute;
    top: 50%;
    right: 12px;
    translate: 0 -50%;
    z-index: 1;
    width: 26px;
    height: 26px;
    padding: 0;
    display: grid;
    place-items: center;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--muted);
  }

  .dismiss:hover { background: #c0392b; border-color: #c0392b; }

  .dismiss svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.5;
    stroke-linecap: round;
  }

  .dismiss:hover svg { stroke: white; }

  .toast {
    position: fixed;
    left: 50%;
    bottom: 20px;
    translate: -50% 0;
    z-index: 10;
    display: flex;
    gap: 16px;
    align-items: center;
    max-width: calc(100vw - 32px);
    padding: 10px 16px;
    border-radius: var(--radius);
    background: var(--text);
    color: var(--bg);
    box-shadow: 0 6px 24px rgb(0 0 0 / 0.35);
    font-size: 0.9rem;
  }

  .link {
    background: none;
    border: none;
    padding: 0;
    color: inherit;
    font-weight: 700;
    text-decoration: underline;
  }
</style>
