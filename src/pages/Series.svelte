<script>
  import BookCard from '../components/BookCard.svelte';
  import Progress from '../components/Progress.svelte';
  import { getAuthor, seriesOf } from '../lib/data.js';
  import { readCount, isHidden } from '../lib/store.svelte.js';
  import { href } from '../lib/router.svelte.js';

  let { authorSlug, name } = $props();
  const author = $derived(getAuthor(authorSlug));
</script>

{#await author}
  <p class="muted">Loading…</p>
{:then author}
  {@const series = seriesOf({ books: author.books.filter((b) => !isHidden(b.id)) }).find((s) => s.name === name)}
  {#if series}
    {@const ids = series.books.map((b) => b.id)}
    <section class="head">
      <div>
        <p class="eyebrow">Series</p>
        <h1>{series.name}</h1>
        <p class="muted">by <a href={href('author', author.slug)}>{author.name}</a> · {series.books.length} books</p>
      </div>
      <div class="progress"><Progress read={readCount(ids)} total={ids.length} /></div>
    </section>

    <div class="grid">
      {#each series.books as book (book.id)}
        <BookCard {book} authorSlug={author.slug} label={book.position != null ? `Book ${book.position}` : null} />
      {/each}
    </div>
  {:else}
    <p>Couldn't find that series. <a href={href('author', author.slug)}>Back to {author.name}</a></p>
  {/if}
{:catch}
  <p>Couldn't load that author. <a href="#/">Back to authors</a></p>
{/await}

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px 32px;
    margin-bottom: 28px;
  }

  .eyebrow {
    margin: 0 0 4px;
    font-size: 0.8rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent);
  }

  h1 { font-size: 2rem; }

  .head .muted { margin: 4px 0 0; }

  .progress { flex: 0 1 340px; min-width: 220px; }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 24px 16px;
  }

  @media (max-width: 480px) {
    .grid { grid-template-columns: repeat(3, 1fr); gap: 16px 10px; }
  }
</style>
