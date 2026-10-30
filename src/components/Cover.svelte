<script>
  import { coverUrl, ukCoverId } from '../lib/data.js';
  import { lentTo } from '../lib/store.svelte.js';

  let { book, size = 'M' } = $props();
  let failed = $state(false);

  // Books you've lent out get a "Lent out" band and a dimmed cover, wherever they appear.
  const loan = $derived(book.id ? lentTo(book.id) : null);

  // Curated books come with a UK cover already chosen (coverRegion set). Any
  // other Open Library work looks one up when it scrolls near the viewport.
  const needsLookup = $derived(!!book.olWorkId && !book.coverRegion);
  let ukCover = $state(); // undefined while looking up; null when there's no UK cover
  const coverId = $derived(needsLookup ? (ukCover === undefined ? undefined : (ukCover ?? book.coverId)) : book.coverId);
  const src = $derived(coverId ? coverUrl(coverId, size) : null);

  function lookUpWhenVisible(node) {
    if (!needsLookup) return;
    const workId = book.olWorkId;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        ukCoverId(workId).then(
          (id) => (ukCover = id),
          () => (ukCover = null),
        );
      },
      { rootMargin: '400px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }
</script>

<div class="frame" class:lent={loan} {@attach lookUpWhenVisible}>
  {#if coverId === undefined}
    <div class="placeholder" aria-label="Loading cover for {book.title}"></div>
  {:else if src && !failed}
    <img {src} alt="Cover of {book.title}" loading="lazy" onerror={() => (failed = true)} />
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

  .band.compact { padding: 2px 0; }

  .band.compact .tag { font-size: 0.5rem; letter-spacing: 0.04em; }
</style>
