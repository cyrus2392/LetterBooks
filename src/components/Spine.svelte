<script>
  // A book standing on a shelf, spine out. Hovering or focusing it swings the
  // book round on its edge to show the front cover.
  import Cover from './Cover.svelte';
  import Icon from './Icon.svelte';
  import { faCheck, faHandHoldingHand } from '@fortawesome/free-solid-svg-icons';
  import { href } from '../lib/router.svelte.js';
  import { bookCoverUrl } from '../lib/data.js';
  import { chosenCover } from '../lib/store.svelte.js';
  import { spineShape, spineColour, knownColour, fallbackColour, inkFor } from '../lib/spines.js';

  // `shelf` is the height of the shelf in px; books stand a little shorter.
  // `pages`, if known, sets how thick the spine is.
  // `edition` is 'paperback' or 'hardback' (books you only read or borrowed
  // have none and look like paperbacks).
  let { book, authorName = '', shelf = 200, pages = null, edition = null } = $props();

  const hardback = $derived(edition === 'hardback');
  const shape = $derived(spineShape(book.id, pages));
  // Hardbacks stand taller and their boards make them a little thicker.
  const height = $derived(Math.round(shelf * shape.height * (hardback ? 1 : 0.9)));
  // Thinner spines on shorter (phone) shelves, so a row still holds plenty.
  const width = $derived(Math.round(((shape.width + (hardback ? 6 : 0)) * shelf) / 200));
  const surname = $derived(authorName.split(/\s+/).filter((w) => !/^(jr|sr)\.?$/i.test(w)).at(-1) ?? '');

  // The cover and its colour load once the book is near the screen.
  let near = $state(false);
  function whenNear(node) {
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          near = true;
          io.disconnect();
        }
      },
      { rootMargin: '400px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }

  // A colour worked out on an earlier visit shows at once; otherwise it's
  // read from the cover once the book is near the screen.
  const coverUrl = $derived(bookCoverUrl(book, chosenCover(book.id), 'S'));
  let sampled = $state(null);
  $effect(() => {
    if (!near || knownColour(coverUrl)) return;
    let current = true;
    spineColour(coverUrl).then((c) => current && (sampled = c));
    return () => (current = false);
  });
  const fill = $derived(knownColour(coverUrl) ?? sampled ?? fallbackColour(book.id));

  // Near either end of the bookcase, slide the cover inwards so it stays
  // inside it (and never makes the page scroll sideways on a phone).
  let nudge = $state(0);
  function fit(event) {
    const node = event.currentTarget;
    const bounds = node.closest('.shelves')?.getBoundingClientRect();
    if (!bounds) return;
    const spine = node.getBoundingClientRect();
    const cover = (height * 2) / 3;
    const left = spine.left + spine.width / 2 - cover / 2;
    const min = bounds.left + 12; // inside the uprights
    const max = bounds.right - 12 - cover;
    nudge = Math.round(left < min ? min - left : left > max ? max - left : 0);
  }
</script>

<a
  class="book"
  class:lent={book.lent}
  class:borrowed={book.borrowed}
  class:hardback
  class:paperback={edition === 'paperback'}
  href={href('book', book.authorSlug, book.id)}
  aria-label="{book.title}{authorName ? ` by ${authorName}` : ''}{book.lent ? `, lent to ${book.lent.to}` : ''}{edition ? `, ${edition}` : ''}{book.borrowed ? `, borrowed from ${book.borrowed.from}` : ''}"
  style:--d="{width}px"
  style:--h="{height}px"
  style:--fill={fill}
  style:--ink={inkFor(fill)}
  style:--nudge="{nudge}px"
  onpointerenter={fit}
  onfocus={fit}
  {@attach whenNear}
>
  <div class="box">
    <div class="spine" aria-hidden="true">
      {#if book.read}<span class="mark" title="Read"><Icon icon={faCheck} /></span>{/if}
      <span class="title">{book.title}</span>
      {#if book.lent}
        <span class="tag">Lent</span>
      {:else if surname}
        <span class="author">{surname}</span>
      {/if}
      {#if book.borrowed}
        <span class="sticker" title="Borrowed from {book.borrowed.from}"><Icon icon={faHandHoldingHand} /></span>
      {/if}
    </div>
    <div class="front" aria-hidden="true">
      {#if near}<Cover {book} size="M" />{/if}
    </div>
  </div>
</a>

<style>
  .book {
    --w: calc(var(--h) * 2 / 3); /* the front cover's width */
    position: relative;
    flex: none;
    display: block;
    width: var(--d);
    height: var(--h);
    perspective: 900px;
    text-decoration: none;
    /* Sinks back under its neighbours as it swings home, so the next book
       you point at is always on top. */
    z-index: 0;
    transition: z-index 0.3s linear;
  }

  .book:hover, .book:focus-visible {
    z-index: 4;
    transition-duration: 0s;
    outline: none;
  }

  .box {
    position: absolute;
    inset: 0;
    transform-style: preserve-3d;
    transform-origin: right center;
    transition: transform 0.22s cubic-bezier(0.4, 0, 0.6, 1);
  }

  /* Swing round on the spine's front edge, then slide so the cover sits
     centred over where the spine was, lifted slightly off the shelf. */
  .book:hover .box, .book:focus-visible .box {
    transform: translateX(calc((var(--d) + var(--w)) / -2 + var(--nudge))) translateZ(24px) rotateY(-90deg);
    transition: transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .spine, .front {
    position: absolute;
    top: 0;
    height: 100%;
    backface-visibility: hidden;
  }

  .spine {
    left: 0;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 14px 0 12px;
    border-radius: 3px 3px 2px 2px;
    color: var(--ink);
    background-color: var(--fill);
    /* Rounded spine: shadowed edges, a soft highlight just left of centre. */
    background-image: linear-gradient(
      to right,
      rgb(0 0 0 / 0.38),
      rgb(255 255 255 / 0.1) 22%,
      rgb(255 255 255 / 0.04) 45%,
      rgb(0 0 0 / 0.08) 75%,
      rgb(0 0 0 / 0.4)
    );
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.15), 0 1px 2px rgb(0 0 0 / 0.4);
    transition: background-color 0.4s;
    overflow: hidden;
  }

  /* Bands near the head and foot, like a cloth binding. */
  .spine::before, .spine::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background: currentColor;
    opacity: 0.22;
  }

  .spine::before { top: 6px; }

  .spine::after { bottom: 6px; }

  .title, .author, .tag {
    writing-mode: vertical-rl;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .title {
    flex: 1 1 auto;
    min-height: 0;
    font-weight: 700;
    font-size: clamp(10px, calc(var(--d) * 0.32), 14px);
    line-height: 1;
    letter-spacing: 0.02em;
  }

  .author {
    flex: none;
    max-height: 38%;
    font-size: clamp(8px, calc(var(--d) * 0.22), 10px);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    opacity: 0.8;
  }

  .mark {
    flex: none;
    width: 16px;
    height: 16px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-ink);
    font-size: 9px;
  }

  /* A lent book isn't on the shelf: just the gap where it goes. */
  .lent .spine {
    background: none;
    box-shadow: none;
    border: 1.5px dashed var(--muted);
    color: var(--muted);
  }

  .lent .spine::before, .lent .spine::after { display: none; }

  /* Paperbacks: a flat, soft spine with a crease down each side where the
     cover folds, and no binding bands. */
  .paperback:not(.lent) .spine {
    border-radius: 1px;
    background-image:
      linear-gradient(to right, transparent 9%, rgb(0 0 0 / 0.22) 10%, transparent 12%, transparent 88%, rgb(0 0 0 / 0.22) 90%, transparent 91%),
      linear-gradient(to right, rgb(0 0 0 / 0.18), rgb(255 255 255 / 0.05) 30%, rgb(0 0 0 / 0.05) 70%, rgb(0 0 0 / 0.2));
  }

  .paperback:not(.lent) .spine::before, .paperback:not(.lent) .spine::after { display: none; }

  /* Hardbacks: boards that stand proud at the head and foot, a rounded,
     glossier spine and gilt bands. (A lent book is just its gap, whatever the edition.) */
  .hardback:not(.lent) .spine {
    border-radius: 5px 5px 3px 3px;
    border-top: 4px solid rgb(0 0 0 / 0.45);
    border-bottom: 4px solid rgb(0 0 0 / 0.45);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.25), 0 1px 3px rgb(0 0 0 / 0.5);
  }

  .hardback:not(.lent) .spine::before, .hardback:not(.lent) .spine::after {
    height: 3px;
    background: #d9b45a;
    opacity: 0.85;
  }

  /* A borrowed book is on the shelf as normal, with a library-style sticker
     at the foot of its spine. */
  .borrowed .spine { padding-bottom: 4px; box-shadow: inset 0 0 0 2px var(--borrowed), 0 1px 2px rgb(0 0 0 / 0.4); }

  .borrowed .spine::after { display: none; }

  .sticker {
    flex: none;
    width: calc(100% - 6px);
    max-width: 22px;
    aspect-ratio: 1;
    display: grid;
    place-items: center;
    border-radius: 3px;
    background: var(--borrowed);
    color: var(--borrowed-ink);
    font-size: 10px;
  }

  .tag {
    flex: none;
    font-size: 9px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--owned);
  }

  /* The front cover, folded back along the spine's edge, into the shelf. */
  .front {
    left: 100%;
    width: var(--w);
    transform-origin: left center;
    transform: rotateY(90deg);
    border-radius: 4px;
    box-shadow: 0 14px 30px rgb(0 0 0 / 0.55);
    /* Only the spines decide what's pointed at, so moving along the shelf
       turns each book in turn, and a click opens the book that's showing. */
    pointer-events: none;
  }

  .front :global(img), .front :global(.placeholder) { height: var(--h); }

  .book:focus-visible .front { outline: 3px solid var(--accent); outline-offset: 2px; }

  @media (prefers-reduced-motion: reduce) {
    .box, .book:hover .box, .book:focus-visible .box { transition: none; }
  }
</style>
