<script>
  import BookCard from '../components/BookCard.svelte';
  import Progress from '../components/Progress.svelte';
  import SeriesCard from '../components/SeriesCard.svelte';
  import { getAuthor, seriesOf } from '../lib/data.js';
  import { readCount, isHidden, isFollowing, setFollowing } from '../lib/store.svelte.js';
  import { isOlAuthorKey } from '../lib/sources.js';

  let { slug } = $props();
  const author = $derived(getAuthor(slug));

  let editing = $state(false);
  let showHidden = $state(false);
</script>

{#await author}
  <p class="muted">
    {isOlAuthorKey(slug) ? 'Building this bibliography from Open Library and Wikidata…' : 'Loading…'}
  </p>
{:then author}
  {@const visible = author.books.filter((b) => !isHidden(b.id))}
  {@const hidden = author.books.filter((b) => isHidden(b.id))}
  {@const ids = visible.map((b) => b.id)}
  {@const series = seriesOf({ books: visible })}
  {@const following = author.live && isFollowing(author.olKey)}

  <section class="head">
    <div>
      <h1>{author.name}</h1>
      <p class="muted">{visible.length} books</p>
      <div class="buttons">
        {#if author.live}
          <button class="btn" class:primary={!following} aria-pressed={following}
                  onclick={() => setFollowing(author.olKey, author.name, !following)}>
            {following ? '✓ On your authors list' : '+ Add to your authors'}
          </button>
        {/if}
        <button class="btn" aria-pressed={editing} onclick={() => (editing = !editing)}>
          {editing ? 'Done editing' : 'Edit list'}
        </button>
      </div>
    </div>
    <div class="progress"><Progress read={readCount(ids)} total={ids.length} /></div>
  </section>

  {#if author.live && author.source?.name === 'Wikipedia'}
    <p class="notice">
      This list comes from Wikipedia's <a href={author.source.url} target="_blank" rel="noopener">{author.source.title}</a>.
      Use <strong>Edit list</strong> to hide anything that shouldn't count.
    </p>
  {:else if author.live}
    <p class="notice">
      Wikipedia doesn't have a bibliography for {author.name}, so this list was built automatically from Open Library and
      may include novellas, short stories or duplicates. Use <strong>Edit list</strong> to hide anything that shouldn't count.
    </p>
  {/if}
  {#if editing}
    <p class="notice">Click ✕ on a cover to hide it. Hidden books don't count towards your totals for this author.</p>
  {/if}

  {#if series.length}
    <section class="series">
      <h2>Series</h2>
      <div class="series-grid">
        {#each series as s (s.name)}
          <SeriesCard series={s} authorSlug={author.slug} />
        {/each}
      </div>
    </section>
  {/if}

  <section>
    <h2>All books</h2>
    <div class="grid" aria-label="Books by {author.name}">
      {#each visible as book (book.id)}
        <BookCard {book} authorSlug={author.slug} {editing} />
      {/each}
    </div>
  </section>

  {#if hidden.length}
    <section class="hidden-books">
      <button class="link" aria-expanded={showHidden} onclick={() => (showHidden = !showHidden)}>
        {showHidden ? 'Hide' : 'Show'} {hidden.length} hidden {hidden.length === 1 ? 'book' : 'books'}
      </button>
      {#if showHidden}
        <div class="grid">
          {#each hidden as book (book.id)}
            <BookCard {book} authorSlug={author.slug} editing />
          {/each}
        </div>
      {/if}
    </section>
  {/if}
{:catch}
  <p>Couldn't load that author. <a href="#/">Back to authors</a></p>
{/await}

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px 32px;
    margin-bottom: 20px;
  }

  h1 { font-size: 2rem; }

  .head p { margin: 4px 0 0; }

  .buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }

  .progress { flex: 0 1 340px; min-width: 220px; }

  .notice {
    margin: 0 0 16px;
    padding: 10px 14px;
    border-left: 3px solid var(--accent);
    background: var(--surface);
    border-radius: 0 var(--radius) var(--radius) 0;
    font-size: 0.9rem;
    color: var(--muted);
  }

  h2 {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    padding-bottom: 8px;
    margin: 28px 0 16px;
    border-bottom: 1px solid var(--border);
  }

  .series-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(260px, 100%), 1fr));
    gap: 12px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 24px 16px;
  }

  @media (max-width: 480px) {
    .grid { grid-template-columns: repeat(3, 1fr); gap: 16px 10px; }
    .series-grid { grid-template-columns: minmax(0, 1fr); }
  }

  .hidden-books { margin-top: 40px; }

  .hidden-books .grid { margin-top: 16px; }

  .link {
    background: none;
    border: none;
    padding: 0;
    color: var(--muted);
    text-decoration: underline;
  }
</style>
