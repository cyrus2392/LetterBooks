<script>
  import { bookCoverUrl, directCoverUrl } from '../lib/data.js';
  import { lentTo, borrowedFrom, chosenCover } from '../lib/store.svelte.js';

  let { book, size = 'M' } = $props();

  // Books you've lent out get a "Lent out" band and a dimmed cover, wherever they appear.
  const loan = $derived(book.id ? lentTo(book.id) : null);
  // Borrowed books get a "Borrowed" band at the foot, but stay bright: they're on your shelf.
  const borrowed = $derived(book.id && !loan ? borrowedFrom(book.id) : null);

  // Covers come from the covers Worker. If it can't be reached, the same
  // cover (or the default one) comes straight from Open Library instead, and
  // failing that Hardcover's cover, if the book has one.
  const chosen = $derived(book.id ? chosenCover(book.id) : null);
  const sources = $derived(
    [...new Set([bookCoverUrl(book, chosen, size), directCoverUrl(chosen ?? book.coverId, size), !chosen && book.image])].filter(Boolean),
  );
  let failed = $state([]); // URLs that didn't load
  const src = $derived(sources.find((url) => !failed.includes(url)) ?? null);
</script>

<div class="frame" class:lent={loan}>
  {#if src}
    <img {src} alt="Cover of {book.title}" loading="lazy" onerror={() => (failed = [...failed, src])} />
  {:else}
    <div class="placeholder" aria-label="No cover for {book.title}">
      <span>{book.title}</span>
    </div>
  {/if}
  {#if loan}
    <div class="band" class:compact={size === 'S'} title="Lent to {loan.to}">
      <span class="tag">Lent out</span>
      {#if size !== 'S'}<span class="to">to {loan.to}</span>{/if}
    </div>
  {:else if borrowed}
    <div class="band borrowed" class:compact={size === 'S'} title="Borrowed from {borrowed.from}">
      <span class="tag">Borrowed</span>
      {#if size !== 'S'}<span class="to">from {borrowed.from}</span>{/if}
    </div>
  {/if}
</div>

<style>
  .frame { position: relative; }

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

  /* The book's away, so the cover recedes and the band says where. */
  .lent img, .lent .placeholder { filter: grayscale(0.7) brightness(0.65); }

  .band {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    translate: 0 -50%;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 6px 6px 7px;
    background: var(--owned);
    color: var(--owned-ink);
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.35);
    text-align: center;
    pointer-events: none;
  }

  .tag {
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .to {
    max-width: 100%;
    font-size: 0.78rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .band.borrowed {
    top: auto;
    bottom: 0;
    translate: none;
    border-radius: 0 0 4px 4px;
    background: var(--borrowed);
    color: var(--borrowed-ink);
  }

  .band.compact { padding: 2px 0; }

  .band.compact .tag { font-size: 0.5rem; letter-spacing: 0.04em; }
</style>
