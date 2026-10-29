<script>
  import Cover from './Cover.svelte';
  import { href } from '../lib/router.svelte.js';
  import { isRead, setRead } from '../lib/store.svelte.js';

  let { book, authorSlug } = $props();
  const read = $derived(isRead(book.id));
</script>

<article class:read>
  <div class="cover">
    <a href={href('book', authorSlug, book.id)} aria-label="{book.title} ({book.year})">
      <Cover {book} />
    </a>
    <button
      class="tick"
      aria-pressed={read}
      aria-label={read ? `Unmark ${book.title} as read` : `Mark ${book.title} as read`}
      title={read ? 'Read (click to undo)' : 'Mark as read'}
      onclick={() => setRead(book, authorSlug, !read)}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
    </button>
  </div>
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

  .tick {
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

  .cover:hover .tick, .tick:focus-visible, .read .tick { opacity: 1; }

  /* Touch screens have no hover, so always show the button there. */
  @media (hover: none) { .tick { opacity: 1; } }

  .tick:active { transform: scale(0.9); }

  .tick svg {
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
</style>
