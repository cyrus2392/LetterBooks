<script>
  // Modal form for logging a new read of a book, or editing an existing one.
  import Stars from './Stars.svelte';
  import { addRead, updateRead, deleteRead, getEntry, today } from '../lib/store.svelte.js';

  let { book, authorSlug, editing = null, onclose } = $props();

  let dialog;
  let form = $state(initial());
  let error = $state('');

  function initial() {
    if (editing) return { ...editing };
    // Prefill the start date from when it went on the "currently reading" shelf.
    const e = getEntry(book.id);
    return {
      startedOn: e?.shelf === 'reading' ? e.shelvedOn : '',
      finishedOn: today(),
      rating: null,
      review: '',
    };
  }

  $effect(() => {
    dialog.showModal();
  });

  function submit(event) {
    event.preventDefault();
    if (form.startedOn && form.finishedOn && form.finishedOn < form.startedOn) {
      error = "The finish date can't be before the start date.";
      return;
    }
    if (editing) updateRead(book.id, editing.id, form);
    else addRead(book, authorSlug, form);
    dialog.close();
  }

  function remove() {
    if (!confirm('Delete this read?')) return;
    deleteRead(book.id, editing.id);
    dialog.close();
  }
</script>

<dialog bind:this={dialog} onclose={onclose} aria-labelledby="log-title">
  <form onsubmit={submit}>
    <h2 id="log-title">{editing ? 'Edit read' : 'Log a read'}</h2>
    <p class="muted book">{book.title}</p>

    <div class="dates">
      <label>
        Started
        <input type="date" bind:value={form.startedOn} max={form.finishedOn || undefined} />
      </label>
      <label>
        Finished
        <input type="date" bind:value={form.finishedOn} min={form.startedOn || undefined} />
      </label>
    </div>
    <p class="hint muted">Leave either date blank if you don't remember.</p>

    <div class="field">
      <span class="label" id="rating-label">Rating</span>
      <div class="rating">
        <Stars value={form.rating} size={30} label="Rating" onchange={(v) => (form.rating = v)} />
        {#if form.rating}
          <button type="button" class="link" onclick={() => (form.rating = null)}>Clear</button>
        {/if}
      </div>
    </div>

    <label class="field">
      Review
      <textarea rows="5" bind:value={form.review} placeholder="What did you think?"></textarea>
    </label>

    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <div class="actions">
      {#if editing}
        <button type="button" class="btn danger" onclick={remove}>Delete</button>
      {/if}
      <span class="spacer"></span>
      <button type="button" class="btn" onclick={() => dialog.close()}>Cancel</button>
      <button type="submit" class="btn primary">Save</button>
    </div>
  </form>
</dialog>

<style>
  dialog {
    width: min(480px, calc(100vw - 32px));
    padding: 24px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text);
  }

  dialog::backdrop { background: rgb(0 0 0 / 0.6); }

  h2 { font-size: 1.35rem; }

  .book { margin: 4px 0 20px; }

  .dates {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  label, .label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-weight: 600;
    font-size: 0.9rem;
  }

  input, textarea {
    font: inherit;
    font-weight: 400;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 8px 10px;
    width: 100%;
  }

  textarea { resize: vertical; }

  .hint { font-size: 0.8rem; margin: 6px 0 18px; }

  .field { margin-bottom: 18px; display: flex; flex-direction: column; gap: 6px; }

  .rating { display: flex; align-items: center; gap: 12px; }

  .link {
    background: none;
    border: none;
    padding: 0;
    color: var(--muted);
    text-decoration: underline;
    font-size: 0.85rem;
  }

  .error { color: #ff6b6b; margin: 0 0 12px; }

  .actions { display: flex; gap: 10px; align-items: center; }

  .spacer { flex: 1; }

  .danger { color: #ff6b6b; }
</style>
