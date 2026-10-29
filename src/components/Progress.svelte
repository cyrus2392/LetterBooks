<script>
  let { read, total } = $props();
  const pct = $derived(total ? Math.round((read / total) * 100) : 0);
</script>

<div class="progress">
  <div class="numbers">
    <span><strong>{read}</strong> of {total} read</span>
    <strong class="pct">{pct}%</strong>
  </div>
  <div class="track" role="progressbar" aria-valuemin="0" aria-valuemax={total} aria-valuenow={read}
       aria-label="{read} of {total} books read">
    <div class="fill" style:width="{pct}%"></div>
  </div>
</div>

<style>
  .numbers {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 6px;
  }

  .pct { color: var(--accent); font-size: 1.25rem; }

  .track {
    height: 8px;
    border-radius: 4px;
    background: var(--surface-2);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    background: var(--accent);
    transition: width 0.25s;
  }
</style>
