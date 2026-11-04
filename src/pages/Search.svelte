<script>
  import Cover from '../components/Cover.svelte';
  import Icon from '../components/Icon.svelte';
  import { faCheck } from '@fortawesome/free-solid-svg-icons';
  import { getYourAuthors } from '../lib/data.js';
  import { searchAuthors, searchBooks, normalizeTitle } from '../lib/sources.js';
  import { followedAuthors, readAuthorRefs, isRead } from '../lib/store.svelte.js';
  import { href } from '../lib/router.svelte.js';

  let { query } = $props();

  const needle = $derived(normalizeTitle(query));
  const matches = (text) => normalizeTitle(text).includes(needle);

  // Instant results from your authors (curated, added, or read).
  const local = $derived(
    getYourAuthors([...followedAuthors().map((f) => f.olKey), ...readAuthorRefs()]).then((authors) => ({
      authors: authors.filter((a) => matches(a.name)).map((a) => ({ ref: a.slug, name: a.name })),
      books: authors.flatMap((a) => a.books.filter((b) => matches(b.title)).map((b) => ({ ...b, authorRef: a.slug, authorName: a.name }))),
      knownKeys: new Set(authors.map((a) => a.olKey)),
    })),
  );

  const remoteAuthors = $derived(searchAuthors(query));
  const remoteBooks = $derived(searchBooks(query));
</script>

<h1>Results for “{query}”</h1>

{#snippet bookList(books)}
  <ul class="books">
    {#each books as b (b.id)}
      <li>
        <a href={href('book', b.authorRef, b.id)}>
          <div class="thumb"><Cover book={b} size="S" /></div>
          <div>
            <div class="title">{b.title} {#if isRead(b.id)}<span class="read" title="Read"><Icon icon={faCheck} label="Read" /></span>{/if}</div>
            <div class="muted">{b.authorName}{#if b.year} · {b.year}{/if}</div>
          </div>
        </a>
      </li>
    {/each}
  </ul>
{/snippet}

{#await local then local}
  {#if local.authors.length || local.books.length}
    <section>
      <h2>Your authors</h2>
      {#if local.authors.length}
        <ul class="authors">
          {#each local.authors as a (a.ref)}
            <li><a href={href('author', a.ref)}><strong>{a.name}</strong></a></li>
          {/each}
        </ul>
      {/if}
      {#if local.books.length}{@render bookList(local.books.slice(0, 12))}{/if}
    </section>
  {/if}

  <section>
    {#await remoteAuthors}
      <h2>More authors</h2>
      <p class="muted">Searching…</p>
    {:then { source, authors }}
      {@const fresh = authors.filter((a) => !local.knownKeys.has(a.olKey))}
      <h2>Authors on {source}</h2>
      {#if source !== 'Open Library'}
        <p class="muted note">Open Library can't be reached right now, so these results come from {source}.</p>
      {/if}
      {#if fresh.length}
        <ul class="authors">
          {#each fresh as a (a.olKey)}
            <li>
              <a href={href('author', a.olKey)}>
                <strong>{a.name}</strong>
                <span class="muted">
                  {[a.birthDate && `b. ${a.birthDate}`, a.description, a.workCount && `${a.workCount} works`].filter(Boolean).join(' · ')}{#if a.topWork} · best known for <em>{a.topWork}</em>{/if}
                </span>
              </a>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="muted">No other authors found.</p>
      {/if}
    {:catch}
      <h2>More authors</h2>
      <p class="muted">Couldn't reach Open Library or Wikidata. Try again in a moment.</p>
    {/await}
  </section>

  <section>
    {#await remoteBooks}
      <h2>More books</h2>
      <p class="muted">Searching…</p>
    {:then { source, books }}
      {@const localIds = new Set(local.books.map((b) => b.id))}
      {@const fresh = books.filter((b) => !localIds.has(b.id)).map((b) => ({ ...b, authorRef: b.authorKey }))}
      <h2>Books on {source}</h2>
      {#if fresh.length}
        {@render bookList(fresh)}
      {:else}
        <p class="muted">No other books found.</p>
      {/if}
    {:catch}
      <h2>More books</h2>
      <p class="muted">Couldn't reach Open Library or Wikidata. Try again in a moment.</p>
    {/await}
  </section>
{/await}

<style>
  h1 { font-size: 1.75rem; margin-bottom: 8px; }

  h2 {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    padding-bottom: 8px;
    margin: 28px 0 12px;
    border-bottom: 1px solid var(--border);
  }

  ul { list-style: none; margin: 0; padding: 0; }

  .authors li a {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 12px;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
    text-decoration: none;
  }

  .authors li a:hover strong { text-decoration: underline; }

  .authors .muted { font-size: 0.875rem; }

  .books {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 4px 20px;
    margin-top: 8px;
  }

  .books a {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 8px 0;
    text-decoration: none;
  }

  .books a:hover .title { text-decoration: underline; }

  .thumb { flex: 0 0 40px; }

  .title { font-weight: 600; }

  .read { color: var(--accent); }

  .note { margin: -4px 0 8px; font-size: 0.85rem; }

  .books .muted { font-size: 0.85rem; }
</style>
