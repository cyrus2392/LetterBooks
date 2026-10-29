<script>
  import BookCard from '../components/BookCard.svelte';
  import Progress from '../components/Progress.svelte';
  import { getAuthor } from '../lib/data.js';
  import { readCount } from '../lib/store.svelte.js';

  let { slug } = $props();
  const author = $derived(getAuthor(slug));
</script>

{#await author}
  <p class="muted">Loading…</p>
{:then author}
  {@const ids = author.books.map((b) => b.id)}
  <section class="head">
    <div>
      <h1>{author.name}</h1>
      <p class="muted">{author.books.length} books</p>
    </div>
    <div class="progress"><Progress read={readCount(ids)} total={ids.length} /></div>
  </section>

  <section class="grid" aria-label="Books by {author.name}">
    {#each author.books as book (book.id)}
      <BookCard {book} authorSlug={slug} />
    {/each}
  </section>
{:catch}
  <p>Couldn't find that author. <a href="#/">Back to authors</a></p>
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

  h1 { font-size: 2rem; }

  .head p { margin: 4px 0 0; }

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
