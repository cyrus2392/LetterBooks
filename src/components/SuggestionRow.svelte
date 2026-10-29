<script>
  // A horizontally scrolling row of suggested books: [{ book, href, reason }].
  import Cover from './Cover.svelte';

  let { items } = $props();
</script>

<ul class="row">
  {#each items as item (item.book.id)}
    <li>
      <a href={item.href}>
        <Cover book={item.book} />
        <span class="title">{item.book.title}</span>
      </a>
      <span class="reason">{item.reason}</span>
    </li>
  {/each}
</ul>

<style>
  .row {
    list-style: none;
    margin: 0;
    padding: 0 0 8px;
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 120px;
    gap: 16px;
    overflow-x: auto;
    scroll-snap-type: x proximity;
    scrollbar-width: thin;
  }

  li { scroll-snap-align: start; min-width: 0; }

  a { display: block; text-decoration: none; }

  a :global(.frame) {
    border-radius: 4px;
    box-shadow: 0 2px 10px rgb(0 0 0 / 0.25);
    transition: transform 0.15s;
  }

  a:hover :global(.frame) { transform: translateY(-2px); }

  .title {
    display: block;
    margin-top: 8px;
    font-size: 0.85rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  a:hover .title { text-decoration: underline; }

  .reason {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: 0.75rem;
    color: var(--muted);
  }

  @media (max-width: 480px) {
    .row { grid-auto-columns: 100px; gap: 12px; }
  }
</style>
