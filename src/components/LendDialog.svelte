<script>
  // Modal form for lending an owned book to someone, or editing the current loan.
  import { untrack } from 'svelte';
  import { lend, lentTo, borrowers, today } from '../lib/store.svelte.js';

  let { book, onclose } = $props();

  let dialog;
  // The form starts from the loan as it was when the dialog opened.
  const current = untrack(() => lentTo(book.id));
  let to = $state(current?.to ?? '');
  let on = $state(current?.on ?? today());
  const names = borrowers();

  $effect(() => {
    dialog.showModal();
  });

  function submit(event) {
    event.preventDefault();
    if (!to.trim()) return;
    lend(book.id, to, on || today());
    dialog.close();
  }
</script>

<dialog bind:this={dialog} onclose={onclose} aria-labelledby="lend-title">
  <form onsubmit={submit}>
    <h2 id="lend-title">{current ? 'Edit loan' : 'Lend this book'}</h2>
    <p class="muted book">{book.title}</p>

    <label>
      Lent to
      <!-- svelte-ignore a11y_autofocus -->
      <input bind:value={to} list="borrowers" required autofocus placeholder="Name" autocomplete="off" />
      <datalist id="borrowers">
        {#each names as name}<option value={name}></option>{/each}
      </datalist>
    </label>

    <label>
      Lent on
      <input type="date" bind:value={on} max={today()} />
    </label>

    <div class="actions">
      <button type="button" class="btn" onclick={() => dialog.close()}>Cancel</button>
      <button type="submit" class="btn primary">{current ? 'Save' : 'Lend'}</button>
    </div>
  </form>
</dialog>

<style>
  dialog {
    width: min(420px, calc(100vw - 32px));
    padding: 24px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text);
  }

  dialog::backdrop { background: rgb(0 0 0 / 0.6); }

  h2 { font-size: 1.35rem; }

  .book { margin: 4px 0 20px; }

  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 16px;
    font-weight: 600;
    font-size: 0.9rem;
  }

  input {
    font: inherit;
    font-weight: 400;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 8px 10px;
  }

  .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px; }
</style>
