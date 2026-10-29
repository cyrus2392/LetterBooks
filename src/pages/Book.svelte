<script>
  import Cover from '../components/Cover.svelte';
  import { getAuthor, TYPE_LABELS } from '../lib/data.js';
  import { isRead, setRead } from '../lib/store.svelte.js';
  import { href } from '../lib/router.svelte.js';

  let { authorSlug, bookId } = $props();

  const loaded = $derived(getAuthor(authorSlug).then((author) => {
    const book = author.books.find((b) => b.id === bookId);
    if (!book) throw new Error('Book not found');
    return { author, book };
  }));
</script>

{#await loaded}
  <p class="muted">Loading…</p>
{:then { author, book }}
  {@const read = isRead(book.id)}
  <article class="book">
    <div class="cover"><Cover {book} size="L" /></div>
    <div class="details">
      <h1>{book.title}</h1>
      <p class="byline">
        by <a href={href('author', author.slug)}>{author.name}</a>{#each book.coAuthors ?? [] as co}{' '}and {co}{/each}
        {#if book.pseudonym}<span class="muted">(as {book.pseudonym})</span>{/if}
      </p>
      <dl>
        <dt>Published</dt><dd>{book.year}</dd>
        <dt>Type</dt><dd>{TYPE_LABELS[book.type] ?? book.type}</dd>
        {#if book.series}
          <dt>Series</dt><dd>{book.series.name} #{book.series.position}</dd>
        {/if}
      </dl>
      <button class="btn" class:primary={read} aria-pressed={read} onclick={() => setRead(book, author.slug, !read)}>
        {read ? '✓ Read' : 'Mark as read'}
      </button>
      {#if book.olWorkId}
        <p class="source muted">
          <a href="https://openlibrary.org/works/{book.olWorkId}" target="_blank" rel="noopener">View on Open Library</a>
        </p>
      {/if}
    </div>
  </article>
{:catch}
  <p>Couldn't find that book. <a href={href('author', authorSlug)}>Back to the author</a></p>
{/await}

<style>
  .book {
    display: grid;
    grid-template-columns: minmax(160px, 260px) 1fr;
    gap: 32px;
    align-items: start;
  }

  @media (max-width: 600px) {
    .book { grid-template-columns: 1fr; }
    .cover { max-width: 220px; }
  }

  .cover { box-shadow: 0 4px 20px rgb(0 0 0 / 0.3); border-radius: 4px; }

  h1 { font-size: 2.25rem; }

  .byline { margin: 8px 0 20px; font-size: 1.1rem; }

  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 20px;
    margin: 0 0 24px;
  }

  dt { color: var(--muted); }

  dd { margin: 0; }

  .source { margin-top: 24px; font-size: 0.875rem; }
</style>
