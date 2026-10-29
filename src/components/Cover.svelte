<script>
  import { coverUrl, ukCoverId } from '../lib/data.js';

  let { book, size = 'M' } = $props();
  let failed = $state(false);

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

<div class="frame" {@attach lookUpWhenVisible}>
  {#if coverId === undefined}
    <div class="placeholder" aria-label="Loading cover for {book.title}"></div>
  {:else if src && !failed}
    <img {src} alt="Cover of {book.title}" loading="lazy" onerror={() => (failed = true)} />
  {:else}
    <div class="placeholder" aria-label="No cover for {book.title}">
      <span>{book.title}</span>
    </div>
  {/if}
</div>

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
