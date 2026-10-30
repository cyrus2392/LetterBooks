<script>
  import Cover from '../components/Cover.svelte';
  import Stars from '../components/Stars.svelte';
  import LogReadDialog from '../components/LogReadDialog.svelte';
  import LendDialog from '../components/LendDialog.svelte';
  import Icon from '../components/Icon.svelte';
  import { faCheck, faBook, faBookOpenReader, faBookmark, faHandHolding, faRotateLeft } from '@fortawesome/free-solid-svg-icons';
  import { getBook, getBookDetails, TYPE_LABELS } from '../lib/data.js';
  import { isRead, isOwned, shelfOf, setShelf, readsOf, latestRating, getEntry, lentTo, loansOf, markReturned } from '../lib/store.svelte.js';
  import { toggleRead, toggleOwned } from '../lib/actions.js';
  import { formatDate, formatRelease } from '../lib/format.js';
  import { href } from '../lib/router.svelte.js';

  let { authorSlug, bookId } = $props();

  const loaded = $derived(getBook(authorSlug, bookId));
  // Release date, synopsis and genres load separately, so the page doesn't wait for them.
  const details = $derived(loaded.then(({ author, book }) => getBookDetails(book, author.name)));
  let synopsisOpen = $state(false);

  // null when closed; { editing: read | null } when the log dialog is open.
  let logging = $state(null);
  let lending = $state(false);
</script>

{#await loaded}
  <p class="muted">Loading…</p>
{:then { author, book }}
  {@const read = isRead(book.id)}
  {@const owned = isOwned(book.id)}
  {@const current = shelfOf(book.id)}
  {@const reads = readsOf(book.id)}
  {@const rating = latestRating(book.id)}
  <article class="book">
    <div class="cover"><Cover {book} size="L" /></div>
    <div class="details">
      <h1>{book.title}</h1>
      <p class="byline">
        by <a href={href('author', author.slug)}>{author.name}</a>{#each book.coAuthors ?? [] as co}{' '}and {co}{/each}
        {#if book.pseudonym}<span class="muted">(as {book.pseudonym})</span>{/if}
      </p>
      <dl>
        <dt>Published</dt>
        <dd>
          {#await details}
            {book.year ?? ''}
          {:then d}
            {d.released ? formatRelease(d.released) : (book.year ?? 'Unknown')}
          {:catch}
            {book.year ?? 'Unknown'}
          {/await}
        </dd>
        {#if book.type}<dt>Type</dt><dd>{TYPE_LABELS[book.type] ?? book.type}</dd>{/if}
        {#await details then d}
          {#if d.genres.length}
            <dt>Genres</dt>
            <dd class="genres">{d.genres.slice(0, 4).map((g) => g[0].toUpperCase() + g.slice(1)).join(', ')}</dd>
          {/if}
        {/await}
        {#if book.series?.length}
          <dt>Series</dt>
          <dd>
            {#each book.series as s, i}
              {#if i}<br />{/if}
              <a href={href('series', author.slug, s.name)}>{s.name}</a>{#if s.position != null}{' '}#{s.position}{/if}
            {/each}
          </dd>
        {/if}
      </dl>

      <div class="actions" role="group" aria-label="Your reading">
        <button class="btn" class:on={read} aria-pressed={read} onclick={() => toggleRead(book, author.slug)}>
          <Icon icon={faCheck} />
          {read ? 'Read' : 'Mark as read'}
        </button>
        <button class="btn" class:owned aria-pressed={owned} onclick={() => toggleOwned(book, author.slug)}>
          <Icon icon={faBook} />
          {owned ? 'On your bookshelf' : 'I own this'}
        </button>
        <button class="btn" class:on={current === 'reading'} aria-pressed={current === 'reading'}
                onclick={() => setShelf(book, author.slug, current === 'reading' ? null : 'reading')}>
          <Icon icon={faBookOpenReader} />
          {current === 'reading' ? 'Reading' : 'Currently reading'}
        </button>
        <button class="btn" class:on={current === 'tbr'} aria-pressed={current === 'tbr'}
                onclick={() => setShelf(book, author.slug, current === 'tbr' ? null : 'tbr')}>
          <Icon icon={faBookmark} />
          Want to read
        </button>
        <button class="btn primary" onclick={() => (logging = { editing: null })}>
          {reads.length ? 'Log a re-read' : 'Log a read'}
        </button>
      </div>

      {#if owned}
        {@const loan = lentTo(book.id)}
        <p class="status lending">
          {#if loan}
            <Icon icon={faHandHolding} /> Lent to <strong>{loan.to}</strong> since {formatDate(loan.on)}
            <button class="btn small" onclick={() => markReturned(book.id)}><Icon icon={faRotateLeft} /> Mark as returned</button>
            <button class="link" onclick={() => (lending = true)}>Edit</button>
          {:else}
            <button class="btn small" onclick={() => (lending = true)}><Icon icon={faHandHolding} /> Lend this book</button>
          {/if}
        </p>
      {/if}
      {#if current === 'reading'}
        <p class="status"><Icon icon={faBookOpenReader} /> Reading since {formatDate(getEntry(book.id).shelvedOn)}</p>
      {:else if current === 'tbr'}
        <p class="status"><Icon icon={faBookmark} /> On your want-to-read list since {formatDate(getEntry(book.id).shelvedOn)}</p>
      {/if}
      {#if rating}
        <p class="status">Your rating <Stars value={rating} size={18} /></p>
      {/if}

      <section class="synopsis">
        <h2>Synopsis</h2>
        {#await details}
          <p class="muted">Loading…</p>
        {:then d}
          {#if d.synopsis}
            <div class="text" class:clamped={d.synopsis.text.length > 450 && !synopsisOpen}>
              {#each d.synopsis.text.split(/\n\s*\n/) as para}<p>{para}</p>{/each}
            </div>
            <p class="credit muted">
              {#if d.synopsis.text.length > 450}
                <button class="link more" onclick={() => (synopsisOpen = !synopsisOpen)}>{synopsisOpen ? 'Show less' : 'Read more'}</button>
              {/if}
              From <a href={d.synopsis.url} target="_blank" rel="noopener">{d.synopsis.source}</a>
              {#if d.wikipediaUrl && d.synopsis.source !== 'Wikipedia'}
                · <a href={d.wikipediaUrl} target="_blank" rel="noopener">Wikipedia article</a>
              {/if}
            </p>
          {:else}
            <p class="muted">No synopsis available yet.</p>
          {/if}
        {:catch}
          <p class="muted">Couldn't load the synopsis right now.</p>
        {/await}
      </section>

      {#if reads.length}
        <section class="reads">
          <h2>Your reads</h2>
          <ol>
            {#each reads as r (r.id)}
              <li>
                <div class="read-head">
                  <span class="when">
                    {#if r.finishedOn}
                      Finished {formatDate(r.finishedOn)}
                    {:else}
                      Read
                    {/if}
                    {#if r.startedOn}<span class="muted"> · started {formatDate(r.startedOn)}</span>{/if}
                  </span>
                  <Stars value={r.rating} size={16} />
                  <button class="link" onclick={() => (logging = { editing: r })}>Edit</button>
                </div>
                {#if r.review}<p class="review">{r.review}</p>{/if}
              </li>
            {/each}
          </ol>
        </section>
      {/if}

      {#if loansOf(book.id).length}
        <section class="reads">
          <h2>Lending history</h2>
          <ol>
            {#each loansOf(book.id) as l, i (i)}
              <li class="loan">
                <strong>{l.to}</strong>
                <span class="muted">{formatDate(l.lentOn)} – {formatDate(l.returnedOn)}</span>
              </li>
            {/each}
          </ol>
        </section>
      {/if}

      {#if book.olWorkId}
        <p class="source muted">
          <a href="https://openlibrary.org/works/{book.olWorkId}" target="_blank" rel="noopener">View on Open Library</a>
        </p>
      {/if}
    </div>
  </article>

  {#if lending}
    <LendDialog {book} onclose={() => (lending = false)} />
  {/if}

  {#if logging}
    <LogReadDialog {book} authorSlug={author.slug} editing={logging.editing} onclose={() => (logging = null)} />
  {/if}
{:catch}
  <p>Couldn't find that book. <a href={href('author', authorSlug)}>Back to the author</a></p>
{/await}

<style>
  .book {
    display: grid;
    grid-template-columns: minmax(160px, 260px) 1fr;
    gap: 32px;
    align-items: start;
  }

  @media (max-width: 600px) {
    .book { grid-template-columns: 1fr; }
    .cover { max-width: 220px; }
  }

  .cover { box-shadow: 0 4px 20px rgb(0 0 0 / 0.3); border-radius: 4px; }

  h1 { font-size: 2.25rem; }

  .byline { margin: 8px 0 20px; font-size: 1.1rem; }

  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 20px;
    margin: 0 0 24px;
  }

  dt { color: var(--muted); }

  dd { margin: 0; }

  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }

  .btn.on {
    border-color: var(--accent);
    color: var(--accent);
  }

  .btn.owned {
    border-color: var(--owned);
    color: var(--owned);
  }

  .status { margin: 6px 0; display: flex; align-items: center; gap: 8px; }

  .lending { flex-wrap: wrap; margin-bottom: 12px; }

  .btn.small { padding: 4px 10px; font-size: 0.85rem; }

  .loan { display: flex; flex-wrap: wrap; gap: 4px 12px; padding: 10px 0; }

  .reads { margin-top: 32px; max-width: 640px; }

  h2 {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
  }

  ol { list-style: none; margin: 0; padding: 0; }

  li { padding: 14px 0; border-bottom: 1px solid var(--border); }

  .read-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; }

  .when { font-weight: 600; }

  .review { margin: 8px 0 0; white-space: pre-line; }

  .link {
    margin-left: auto;
    background: none;
    border: none;
    padding: 0;
    color: var(--muted);
    text-decoration: underline;
    font-size: 0.85rem;
  }

  .source { margin-top: 24px; font-size: 0.875rem; }

  .synopsis { margin-top: 28px; max-width: 680px; }

  /* Long synopses show about six lines until "Read more". */
  .synopsis .text.clamped {
    max-height: 9.5em;
    overflow: hidden;
    mask-image: linear-gradient(to bottom, black 65%, transparent);
  }

  .synopsis .text p { margin: 0 0 0.8em; line-height: 1.6; }

  .credit { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin: 6px 0 0; font-size: 0.8rem; }

  .credit .more { margin: 0 10px 0 0; color: var(--text); font-weight: 600; font-size: 0.85rem; }

  .genres { text-transform: none; }
</style>
