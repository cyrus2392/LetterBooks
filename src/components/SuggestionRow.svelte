<script>
  // A horizontally scrolling row of suggested books: [{ book, href, reason }].
  // With `ondismiss`, each cover gets a "not interested" button.
  import Cover from './Cover.svelte';

  let { items, ondismiss } = $props();
</script>

<ul class="row">
  {#each items as item (item.book.id)}
    <li>
      <div class="cover">
        <a href={item.href} tabindex="-1" aria-hidden="true"><Cover book={item.book} /></a>
        {#if ondismiss}
          <button class="dismiss" aria-label="Not interested in {item.book.title}" title="Not interested"
                  onclick={() => ondismiss(item)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        {/if}
      </div>
      <a class="title" href={item.href}>{item.book.title}</a>
      <span class="reason">{item.reason}</span>
    </li>
  {/each}
</ul>

<style>
  .row {
    list-style: none;
    margin: 0;
    padding: 0 0 8px;
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 120px;
    gap: 16px;
    overflow-x: auto;
    scroll-snap-type: x proximity;
    scrollbar-width: thin;
  }

  li { scroll-snap-align: start; min-width: 0; }

  a { display: block; text-decoration: none; }

  .cover {
    position: relative;
    border-radius: 4px;
    box-shadow: 0 2px 10px rgb(0 0 0 / 0.25);
    transition: transform 0.15s;
  }

  .cover:hover { transform: translateY(-2px); }

  .dismiss {
    position: absolute;
    top: 5px;
    right: 5px;
    width: 26px;
    height: 26px;
    padding: 0;
    display: grid;
    place-items: center;
    border-radius: 50%;
    border: 1.5px solid rgb(255 255 255 / 0.85);
    background: rgb(0 0 0 / 0.6);
    opacity: 0;
    transition: opacity 0.15s, background 0.15s;
  }

  .cover:hover .dismiss, .dismiss:focus-visible { opacity: 1; }

  /* Touch screens have no hover, so always show it there. */
  @media (hover: none) { .dismiss { opacity: 1; } }

  .dismiss:hover { background: #c0392b; }

  .dismiss svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: white;
    stroke-width: 3;
    stroke-linecap: round;
  }

  .title {
    display: block;
    margin-top: 8px;
    font-size: 0.85rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title:hover { text-decoration: underline; }

  .reason {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: 0.75rem;
    color: var(--muted);
  }

  @media (max-width: 480px) {
    .row { grid-auto-columns: 100px; gap: 12px; }
  }
</style>
