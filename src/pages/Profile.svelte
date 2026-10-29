<script>
  import { totalRead, exportData, importData } from '../lib/store.svelte.js';

  let message = $state('');
  let fileInput = $state();

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

<h1>Your profile</h1>

<section class="stat">
  <div class="number">{totalRead()}</div>
  <div class="label">{totalRead() === 1 ? 'book' : 'books'} read</div>
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

  .stat {
    display: inline-block;
    padding: 24px 32px;
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

  .label { margin-top: 6px; color: var(--muted); font-weight: 600; }

  .backup { margin-top: 48px; max-width: 560px; }

  h2 { font-size: 1.15rem; }

  .actions { display: flex; gap: 10px; }
</style>
