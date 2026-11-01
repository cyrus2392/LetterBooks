<script>
  // Modal for choosing a book's cover from its editions. The choice applies
  // everywhere the book appears; "Use automatic cover" goes back to the UK pick.
  import { untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import { faCheck, faXmark } from '@fortawesome/free-solid-svg-icons';
  import { coverUrl } from '../lib/data.js';
  import { fetchEditionCovers } from '../lib/sources.js';
  import { chosenCover, setChosenCover } from '../lib/store.svelte.js';

  let { book, onclose } = $props();

  let dialog;
  // Close and tell the page directly. Some browsers don't reliably fire the
  // dialog's "close" event, which would leave the page thinking it's open
  // (and unable to open it again). The events below still handle Escape.
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    dialog?.close();
    onclose();
  }
  let showAll = $state(false);
  const current = untrack(() => chosenCover(book.id));
  const covers = untrack(() => fetchEditionCovers(book.olWorkId));

  $effect(() => {
    dialog.showModal();
  });

  function choose(coverId) {
    setChosenCover(book.id, coverId);
    close();
  }

  const caption = (c) => [c.publisher, c.year, c.format].filter(Boolean).join(' · ');
</script>

<dialog bind:this={dialog} onclose={close} oncancel={close} aria-labelledby="cover-title">
  <header>
    <div>
      <h2 id="cover-title">Choose a cover</h2>
      <p class="muted">{book.title}</p>
    </div>
    <button class="close" aria-label="Close" onclick={() => close()}><Icon icon={faXmark} /></button>
  </header>

  {#await covers}
    <p class="muted">Loading editions…</p>
  {:then all}
    {@const uk = all.filter((c) => c.uk)}
    {@const shown = showAll || !uk.length ? all : uk}
    <div class="filter" role="group" aria-label="Editions to show">
      <button class="chip" aria-pressed={!showAll && uk.length > 0} disabled={!uk.length} onclick={() => (showAll = false)}>
        UK editions <span class="count">{uk.length}</span>
      </button>
      <button class="chip" aria-pressed={showAll || !uk.length} onclick={() => (showAll = true)}>
        All English editions <span class="count">{all.length}</span>
      </button>
    </div>

    {#if shown.length}
      <ul class="grid">
        {#each shown as c (c.coverId)}
          <li>
            <button class="option" class:selected={c.coverId === current} aria-pressed={c.coverId === current}
                    aria-label="Use the {caption(c) || 'unlabelled'} cover" onclick={() => choose(c.coverId)}>
              <img src={coverUrl(c.coverId, 'M')} alt="" loading="lazy" />
              {#if c.coverId === current}<span class="tick"><Icon icon={faCheck} /></span>{/if}
            </button>
            <span class="caption">{caption(c) || 'Unknown edition'}</span>
            {#if !c.standard}<span class="tag">Special edition</span>{/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted">No covers found among this book's editions.</p>
    {/if}
  {:catch}
    <p class="muted">Couldn't load this book's editions right now.</p>
  {/await}

  <footer>
    {#if current}
      <button class="btn" onclick={() => choose(null)}>Use automatic cover</button>
    {/if}
    <span class="spacer"></span>
    <button class="btn" onclick={() => close()}>Cancel</button>
  </footer>
</dialog>

<style>
  dialog {
    width: min(860px, calc(100vw - 32px));
    max-height: calc(100vh - 48px);
    padding: 0;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text);
  }

  dialog:not([open]) { display: none; }

  dialog::backdrop { background: rgb(0 0 0 / 0.6); }

  header, footer {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px 20px;
  }

  header { justify-content: space-between; border-bottom: 1px solid var(--border); }

  footer { border-top: 1px solid var(--border); }

  h2 { font-size: 1.25rem; }

  header p { margin: 2px 0 0; }

  .close {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: var(--surface-2);
    display: grid;
    place-items: center;
  }

  .filter { display: flex; flex-wrap: wrap; gap: 8px; padding: 14px 20px 0; }

  .chip {
    padding: 5px 12px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--surface);
    font-size: 0.875rem;
  }

  .chip[aria-pressed='true'] { border-color: var(--accent); color: var(--accent); font-weight: 600; }

  .chip:disabled { opacity: 0.5; cursor: default; }

  .count { margin-left: 4px; color: var(--muted); }

  .grid {
    list-style: none;
    margin: 0;
    padding: 16px 20px;
    overflow-y: auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    gap: 18px 14px;
  }

  dialog > p { padding: 16px 20px; margin: 0; }

  .option {
    position: relative;
    display: block;
    width: 100%;
    padding: 0;
    border: none;
    background: var(--surface-2);
    border-radius: 4px;
    aspect-ratio: 2 / 3;
    overflow: hidden;
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.25);
  }

  .option img { width: 100%; height: 100%; object-fit: cover; display: block; }

  .option:hover, .option:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }

  .option.selected { outline: 3px solid var(--accent); outline-offset: 2px; }

  .tick {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--accent);
    color: var(--accent-ink);
    font-size: 13px;
  }

  .caption {
    display: block;
    margin-top: 6px;
    font-size: 0.75rem;
    color: var(--muted);
    line-height: 1.3;
  }

  .tag {
    display: inline-block;
    margin-top: 3px;
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--owned);
  }

  .spacer { flex: 1; }
</style>
