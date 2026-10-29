<script>
  import Progress from '../components/Progress.svelte';
  import { getAuthors, getAuthor, coverUrl } from '../lib/data.js';
  import { readCount } from '../lib/store.svelte.js';
  import { href } from '../lib/router.svelte.js';

  // Full author files are needed for per-author read counts.
  const authors = getAuthors().then((list) => Promise.all(list.map((a) => getAuthor(a.slug))));
</script>

<h1>Authors</h1>

{#await authors}
  <p class="muted">Loading…</p>
{:then authors}
  <ul class="list">
    {#each authors as author (author.slug)}
      {@const ids = author.books.map((b) => b.id)}
      <li>
        <a class="card" href={href('author', author.slug)}>
          <div class="covers" aria-hidden="true">
            {#each author.books.filter((b) => b.coverId).slice(0, 3) as book (book.id)}
              <img src={coverUrl(book.coverId, 'S')} alt="" />
            {/each}
          </div>
          <div class="info">
            <h2>{author.name}</h2>
            <Progress read={readCount(ids)} total={ids.length} />
          </div>
        </a>
      </li>
    {/each}
  </ul>
{:catch error}
  <p>{error.message}</p>
{/await}

<style>
  h1 { font-size: 2rem; margin-bottom: 20px; }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 16px;
  }

  @media (max-width: 400px) {
    .list { grid-template-columns: 1fr; }
  }

  .card {
    display: flex;
    gap: 16px;
    align-items: center;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    text-decoration: none;
  }

  .card:hover { border-color: var(--accent); }

  .covers { display: flex; flex-shrink: 0; }

  .covers img {
    width: 44px;
    aspect-ratio: 2 / 3;
    object-fit: cover;
    border-radius: 3px;
    box-shadow: 0 1px 6px rgb(0 0 0 / 0.35);
  }

  .covers img + img { margin-left: -18px; }

  .info { flex: 1; min-width: 0; }

  h2 { font-size: 1.15rem; margin-bottom: 10px; }
</style>
