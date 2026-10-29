<script>
  // Star rating, 0.5–5 in half steps. Read-only unless `onchange` is passed.
  // Interactive: click the left or right half of a star; arrow keys step by
  // half a star; clicking the current rating again clears it.
  let { value = null, onchange, size = 20, label = 'Rating' } = $props();

  let hover = $state(null);
  const shown = $derived(hover ?? value ?? 0);
  const interactive = $derived(!!onchange);

  function valueAt(event, star) {
    const { left, width } = event.currentTarget.getBoundingClientRect();
    return event.clientX - left < width / 2 ? star - 0.5 : star;
  }

  function set(v) {
    onchange(v === value ? null : v);
  }

  function onkeydown(event) {
    const step = { ArrowRight: 0.5, ArrowUp: 0.5, ArrowLeft: -0.5, ArrowDown: -0.5 }[event.key];
    if (step) {
      event.preventDefault();
      const next = Math.min(5, Math.max(0, (value ?? 0) + step));
      onchange(next || null);
    } else if (event.key === 'Backspace' || event.key === 'Delete' || event.key === '0') {
      onchange(null);
    }
  }

  const text = (v) => (v ? `${v} out of 5 stars` : 'No rating');
</script>

{#snippet star(fill)}
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
    <path class="empty" d="M12 2.5l2.9 6.2 6.8.8-5 4.6 1.3 6.7L12 17.5l-6 3.3 1.3-6.7-5-4.6 6.8-.8z" />
    {#if fill > 0}
      <path class="full" class:half={fill < 1}
            d="M12 2.5l2.9 6.2 6.8.8-5 4.6 1.3 6.7L12 17.5l-6 3.3 1.3-6.7-5-4.6 6.8-.8z" />
    {/if}
  </svg>
{/snippet}

{#if interactive}
  <div
    class="stars interactive"
    role="slider"
    tabindex="0"
    aria-label={label}
    aria-valuemin="0"
    aria-valuemax="5"
    aria-valuenow={value ?? 0}
    aria-valuetext={text(value)}
    {onkeydown}
    onpointerleave={() => (hover = null)}
  >
    {#each [1, 2, 3, 4, 5] as n}
      <span
        class="hit"
        role="presentation"
        onpointermove={(e) => (hover = valueAt(e, n))}
        onclick={(e) => set(valueAt(e, n))}
      >{@render star(Math.min(1, Math.max(0, shown - (n - 1))))}</span>
    {/each}
  </div>
{:else if value}
  <span class="stars" role="img" aria-label={text(value)}>
    {#each [1, 2, 3, 4, 5] as n}
      {#if value - (n - 1) > 0}{@render star(Math.min(1, value - (n - 1)))}{/if}
    {/each}
  </span>
{/if}

<style>
  .stars {
    display: inline-flex;
    align-items: center;
    gap: 1px;
    vertical-align: middle;
  }

  .interactive {
    border-radius: 4px;
    cursor: pointer;
    touch-action: none;
  }

  .interactive:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }

  .hit { display: inline-flex; }

  .empty { fill: var(--surface-2); }

  /* Read-only stars only show the filled part, Letterboxd style. */
  .stars:not(.interactive) .empty { display: none; }

  .full { fill: var(--accent); }

  .half { clip-path: inset(0 50% 0 0); }
</style>
