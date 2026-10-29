<script>
  import Progress from './Progress.svelte';
  import { coverUrl } from '../lib/data.js';
  import { readCount } from '../lib/store.svelte.js';
  import { href } from '../lib/router.svelte.js';

  let { series, authorSlug } = $props();
  const ids = $derived(series.books.map((b) => b.id));
</script>

<a class="card" href={href('series', authorSlug, series.name)}>
  <div class="covers" aria-hidden="true">
    {#each series.books.filter((b) => b.coverId).slice(0, 4) as book (book.id)}
      <img src={coverUrl(book.coverId, 'S')} alt="" loading="lazy" />
    {/each}
  </div>
  <div class="info">
    <h3>{series.name}</h3>
    <Progress read={readCount(ids)} total={ids.length} />
  </div>
</a>

<style>
  .card {
    min-width: 0;
    display: flex;
    gap: 14px;
    align-items: center;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    text-decoration: none;
    font-size: 0.875rem;
  }

  .card:hover { border-color: var(--accent); }

  .covers { display: flex; flex-shrink: 0; }

  .covers img {
    width: 34px;
    aspect-ratio: 2 / 3;
    object-fit: cover;
    border-radius: 2px;
    box-shadow: 0 1px 5px rgb(0 0 0 / 0.35);
  }

  .covers img + img { margin-left: -16px; }

  .info { flex: 1; min-width: 0; }

  h3 {
    font-size: 1rem;
    margin-bottom: 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
