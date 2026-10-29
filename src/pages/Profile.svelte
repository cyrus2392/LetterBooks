<script>
  import Cover from '../components/Cover.svelte';
  import Stars from '../components/Stars.svelte';
  import { totalRead, shelf, diary, exportData, importData } from '../lib/store.svelte.js';
  import { formatDate } from '../lib/format.js';
  import { href } from '../lib/router.svelte.js';

  let message = $state('');
  let fileInput = $state();

  const reading = $derived(shelf('reading'));
  const tbr = $derived(shelf('tbr'));
  const recent = $derived(diary().slice(0, 10));

  function download() {
    const blob = new Blob([exportData()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `letterbooks-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function upload(event) {
    const input = event.currentTarget;
    const file = input.files[0];
    input.value = '';
    if (!file || !confirm('Replace your current reading data with this file?')) return;
    try {
      importData(await file.text());
      message = 'Imported.';
    } catch (e) {
      message = e instanceof SyntaxError ? "That file isn't valid JSON." : e.message;
    }
  }
</script>

{#snippet shelfRow(title, books, empty)}
  <section class="shelf">
    <h2>{title} <span class="count">{books.length}</span></h2>
    {#if books.length}
      <ul class="covers">
        {#each books as b (b.id)}
          <li>
            <a href={href('book', b.authorSlug, b.id)} title={b.title}>
              <Cover book={b} />
            </a>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted">{empty}</p>
    {/if}
  </section>
{/snippet}

<h1>Your profile</h1>

<section class="stats">
  <div class="stat">
    <div class="number">{totalRead()}</div>
    <div class="label">{totalRead() === 1 ? 'book' : 'books'} read</div>
  </div>
  <div class="stat">
    <div class="number small">{reading.length}</div>
    <div class="label">reading now</div>
  </div>
  <div class="stat">
    <div class="number small">{tbr.length}</div>
    <div class="label">want to read</div>
  </div>
</section>

{@render shelfRow('Currently reading', reading, 'Nothing on the go. Mark a book as “Currently reading” from its page.')}
{@render shelfRow('Want to read', tbr, 'Your want-to-read list is empty.')}

<section class="shelf">
  <h2>Recent reads</h2>
  {#if recent.length}
    <ol class="diary">
      {#each recent as r (r.id)}
        <li>
          <a class="thumb" href={href('book', r.authorSlug, r.bookId)}><Cover book={{ title: r.title, coverId: r.coverId }} size="S" /></a>
          <div class="entry">
            <a class="title" href={href('book', r.authorSlug, r.bookId)}>{r.title}</a>
            <div class="meta">
              <span class="muted">{r.finishedOn ? formatDate(r.finishedOn) : 'Date unknown'}</span>
              <Stars value={r.rating} size={14} />
            </div>
            {#if r.review}<p class="review">{r.review}</p>{/if}
          </div>
        </li>
      {/each}
    </ol>
  {:else}
    <p class="muted">Use “Log a read” on a book's page to record dates, a rating and a review.</p>
  {/if}
</section>

<section class="backup">
  <h2>Your data</h2>
  <p class="muted">
    Your reading history is saved in this browser only. Export a backup now and then, or to move it to another device.
  </p>
  <div class="actions">
    <button class="btn" onclick={download}>Export</button>
    <button class="btn" onclick={() => fileInput.click()}>Import…</button>
    <input bind:this={fileInput} type="file" accept="application/json,.json" class="sr-only" onchange={upload} tabindex="-1" />
  </div>
  {#if message}<p role="status">{message}</p>{/if}
</section>

<style>
  h1 { font-size: 2rem; margin-bottom: 24px; }

  .stats { display: flex; flex-wrap: wrap; gap: 12px; }

  .stat {
    padding: 20px 28px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .number {
    font-size: 3.5rem;
    font-weight: 800;
    line-height: 1;
    color: var(--accent);
  }

  .number.small { font-size: 2.25rem; color: var(--text); }

  .label { margin-top: 6px; color: var(--muted); font-weight: 600; }

  .shelf { margin-top: 40px; }

  h2 {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    padding-bottom: 8px;
    margin-bottom: 14px;
    border-bottom: 1px solid var(--border);
  }

  .count { margin-left: 6px; color: var(--text); }

  .covers {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
    gap: 12px;
  }

  .covers a { display: block; border-radius: 4px; box-shadow: 0 2px 8px rgb(0 0 0 / 0.25); }

  .diary { list-style: none; margin: 0; padding: 0; max-width: 680px; }

  .diary li {
    display: flex;
    gap: 14px;
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
  }

  .thumb { flex: 0 0 44px; }

  .entry { min-width: 0; }

  .title { font-weight: 700; text-decoration: none; }

  .title:hover { text-decoration: underline; }

  .meta { display: flex; align-items: center; gap: 10px; font-size: 0.875rem; }

  .review {
    margin: 6px 0 0;
    font-size: 0.9rem;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .backup { margin-top: 48px; max-width: 560px; }

  .actions { display: flex; gap: 10px; }
</style>
