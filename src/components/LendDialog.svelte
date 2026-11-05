<script>
  // Modal form for lending an owned book to someone, or (mode 'borrow')
  // recording a book you've borrowed from someone; or editing either.
  import { untrack } from 'svelte';
  import { lend, lentTo, borrowers, borrow, borrowedFrom, lenders, today } from '../lib/store.svelte.js';

  let { book, authorSlug = null, mode = 'lend', onclose } = $props();
  const borrowing = untrack(() => mode === 'borrow');
  const words = borrowing
    ? { add: 'Borrowed a copy', edit: 'Edit borrowing', who: 'Borrowed from', when: 'Borrowed on', save: 'Add to shelf' }
    : { add: 'Lend this book', edit: 'Edit loan', who: 'Lent to', when: 'Lent on', save: 'Lend' };

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
  // The form starts from the loan as it was when the dialog opened.
  const current = untrack(() => (borrowing ? borrowedFrom(book.id) : lentTo(book.id)));
  let to = $state((borrowing ? current?.from : current?.to) ?? '');
  let on = $state(current?.on ?? today());
  const names = borrowing ? lenders() : borrowers();

  $effect(() => {
    dialog.showModal();
  });

  function submit(event) {
    event.preventDefault();
    if (!to.trim()) return;
    if (borrowing) borrow(book, authorSlug, to, on || today());
    else lend(book.id, to, on || today());
    close();
  }
</script>

<dialog bind:this={dialog} onclose={close} oncancel={close} aria-labelledby="lend-title">
  <form onsubmit={submit}>
    <h2 id="lend-title">{current ? words.edit : words.add}</h2>
    <p class="muted book">{book.title}</p>

    <label>
      {words.who}
      <!-- svelte-ignore a11y_autofocus -->
      <input bind:value={to} list="borrowers" required autofocus placeholder="Name" autocomplete="off" />
      <datalist id="borrowers">
        {#each names as name}<option value={name}></option>{/each}
      </datalist>
    </label>

    <label>
      {words.when}
      <input type="date" bind:value={on} max={today()} />
    </label>

    <div class="actions">
      <button type="button" class="btn" onclick={() => close()}>Cancel</button>
      <button type="submit" class="btn primary">{current ? 'Save' : words.save}</button>
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
