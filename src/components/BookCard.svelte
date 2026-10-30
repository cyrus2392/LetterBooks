<script>
  import Cover from './Cover.svelte';
  import { href } from '../lib/router.svelte.js';
  import { isRead, isOwned, shelfOf, isHidden, setHidden } from '../lib/store.svelte.js';
  import { toggleRead, toggleOwned } from '../lib/actions.js';

  // Two toggles on the cover: owned (top left) and read (top right).
  // `editing` swaps them for a hide/restore button; `label` is shown above
  // the title (e.g. a series position).
  let { book, authorSlug, editing = false, label = null } = $props();
  const read = $derived(isRead(book.id));
  const owned = $derived(isOwned(book.id));
  const current = $derived(shelfOf(book.id));
  const hidden = $derived(isHidden(book.id));
</script>

<article class:read class:owned class:hidden>
  <div class="cover">
    <a href={href('book', authorSlug, book.id)} aria-label="{book.title} ({book.year})">
      <Cover {book} />
    </a>
    {#if current === 'reading'}
      <span class="shelf">Reading</span>
    {:else if current === 'tbr'}
      <span class="shelf">Want to read</span>
    {/if}
    {#if editing}
      <button
        class="tick hide"
        aria-label={hidden ? `Restore ${book.title}` : `Hide ${book.title}`}
        title={hidden ? 'Restore to the list' : "Hide: not a real book, or a duplicate"}
        onclick={() => setHidden(book.id, !hidden)}
      >
        {#if hidden}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        {:else}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        {/if}
      </button>
    {:else}
      <button
        class="own"
        aria-pressed={owned}
        aria-label={owned ? `Remove ${book.title} from your bookshelf` : `Add ${book.title} to your bookshelf`}
        title={owned ? 'On your bookshelf (click to remove)' : 'I own this'}
        onclick={() => toggleOwned(book, authorSlug)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5v15M9.5 4.5v15M14 6l4 13.5M3.5 19.5h17" /></svg>
      </button>
      <button
        class="tick"
        aria-pressed={read}
        aria-label={read ? `Unmark ${book.title} as read` : `Mark ${book.title} as read`}
        title={read ? 'Read (click to undo)' : 'Mark as read'}
        onclick={() => toggleRead(book, authorSlug)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      </button>
    {/if}
  </div>
  {#if label}<div class="label">{label}</div>{/if}
  <a class="title" href={href('book', authorSlug, book.id)}>{book.title}</a>
  <div class="year muted">{book.year}</div>
</article>

<style>
  article { min-width: 0; }

  .cover {
    position: relative;
    border-radius: 4px;
    box-shadow: 0 2px 10px rgb(0 0 0 / 0.25);
    transition: transform 0.15s;
  }

  .cover:hover { transform: translateY(-2px); }

  .cover > a { display: block; border-radius: 4px; }

  .read .cover > a {
    outline: 3px solid var(--accent);
    outline-offset: -3px;
  }

  .shelf {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 3px 6px;
    border-radius: 0 0 4px 4px;
    background: rgb(0 0 0 / 0.72);
    color: white;
    font-size: 0.7rem;
    font-weight: 700;
    text-align: center;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    pointer-events: none;
  }

  .tick, .own {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 32px;
    height: 32px;
    padding: 0;
    display: grid;
    place-items: center;
    border-radius: 50%;
    border: 2px solid rgb(255 255 255 / 0.85);
    background: rgb(0 0 0 / 0.55);
    opacity: 0;
    transition: opacity 0.15s, background 0.15s, transform 0.1s;
  }

  .own { right: auto; left: 6px; }

  .cover:hover :is(.tick, .own), .tick:focus-visible, .own:focus-visible, .read .tick, .owned .own { opacity: 1; }

  /* Touch screens have no hover, so always show the buttons there. */
  @media (hover: none) { .tick, .own { opacity: 1; } }

  .tick:active, .own:active { transform: scale(0.9); }

  .tick svg, .own svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: white;
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .read .tick {
    background: var(--accent);
    border-color: var(--accent);
  }

  .read .tick svg { stroke: var(--accent-ink); }

  .owned .own {
    background: var(--owned);
    border-color: var(--owned);
  }

  .owned .own svg { stroke: var(--owned-ink); }

  .title {
    display: block;
    margin-top: 8px;
    font-size: 0.875rem;
    font-weight: 600;
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title:hover { text-decoration: underline; }

  .year { font-size: 0.8rem; }

  /* Edit mode: the hide/restore button is always visible. */
  .tick.hide, .read .tick.hide {
    opacity: 1;
    background: rgb(0 0 0 / 0.7);
    border-color: rgb(255 255 255 / 0.85);
  }

  .tick.hide svg, .read .tick.hide svg { stroke: white; }

  .tick.hide:hover { background: #c0392b; }

  .hidden .cover > a { opacity: 0.45; }

  .label {
    margin-top: 8px;
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--accent);
  }

  .label + .title { margin-top: 0; }
</style>
