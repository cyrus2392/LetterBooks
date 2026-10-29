<script>
  import { coverUrl } from '../lib/data.js';

  let { book, size = 'M' } = $props();
  let failed = $state(false);
  const src = $derived(coverUrl(book.coverId, size));
</script>

{#if src && !failed}
  <img {src} alt="Cover of {book.title}" loading="lazy" onerror={() => (failed = true)} />
{:else}
  <div class="placeholder" aria-label="No cover for {book.title}">
    <span>{book.title}</span>
  </div>
{/if}

<style>
  img, .placeholder {
    display: block;
    width: 100%;
    aspect-ratio: 2 / 3;
    border-radius: 4px;
    object-fit: cover;
    background: var(--surface-2);
  }

  .placeholder {
    display: grid;
    place-items: center;
    padding: 12px;
    text-align: center;
    font-weight: 700;
    color: var(--muted);
    border: 1px solid var(--border);
  }
</style>
