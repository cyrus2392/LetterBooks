<script>
  import { route, href } from './lib/router.svelte.js';
  import Home from './pages/Home.svelte';
  import Author from './pages/Author.svelte';
  import Book from './pages/Book.svelte';
  import Profile from './pages/Profile.svelte';
  import Series from './pages/Series.svelte';
  import Search from './pages/Search.svelte';
  import Library from './pages/Library.svelte';

  const page = $derived(route.parts[0] ?? '');

  let query = $state('');
  // Show the current search in the box, and clear it on other pages.
  $effect(() => {
    query = page === 'search' ? (route.parts[1] ?? '') : '';
  });

  function search(event) {
    event.preventDefault();
    const q = query.trim();
    if (q) location.hash = href('search', q);
  }
</script>

<header>
  <div class="container bar">
    <a class="logo" href={href()}>Letter<span>Books</span></a>
    <form class="search" role="search" onsubmit={search}>
      <input type="search" bind:value={query} placeholder="Search authors and books" aria-label="Search authors and books" />
    </form>
    <nav>
      <a href={href()} class:active={page === '' || page === 'author' || page === 'series'}>Authors</a>
      <a href={href('library')} class:active={page === 'library'}>Library</a>
      <a href={href('profile')} class:active={page === 'profile'}>Profile</a>
    </nav>
  </div>
</header>

<main class="container">
  {#if page === 'author' && route.parts[1]}
    {#key route.parts[1]}<Author slug={route.parts[1]} />{/key}
  {:else if page === 'book' && route.parts[2]}
    {#key route.parts[2]}<Book authorSlug={route.parts[1]} bookId={route.parts[2]} />{/key}
  {:else if page === 'series' && route.parts[2]}
    {#key route.parts.join('/')}<Series authorSlug={route.parts[1]} name={route.parts[2]} />{/key}
  {:else if page === 'search' && route.parts[1]}
    {#key route.parts[1]}<Search query={route.parts[1]} />{/key}
  {:else if page === 'library'}
    {#key route.parts[1]}<Library tab={route.parts[1] === 'read' ? 'read' : 'owned'} />{/key}
  {:else if page === 'profile'}
    <Profile />
  {:else}
    <Home />
  {/if}
</main>

<style>
  header {
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 20px;
    min-height: 56px;
  }

  .search { flex: 1; max-width: 360px; margin-left: auto; }

  .search input {
    width: 100%;
    font: inherit;
    font-size: 0.9rem;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 6px 14px;
  }

  .search input:focus { outline: 2px solid var(--accent); outline-offset: 0; border-color: transparent; }

  /* On narrow screens the search box gets its own row under the logo and nav. */
  @media (max-width: 600px) {
    .bar { flex-wrap: wrap; gap: 0 16px; padding-top: 10px; padding-bottom: 10px; }
    nav { margin-left: auto; }
    .search { order: 3; flex-basis: 100%; max-width: none; margin-top: 10px; }
  }

  .logo {
    font-weight: 800;
    font-size: 1.25rem;
    text-decoration: none;
    letter-spacing: -0.02em;
  }

  .logo span { color: var(--accent); }

  nav { display: flex; gap: 20px; }

  nav a {
    text-decoration: none;
    color: var(--muted);
    font-weight: 600;
  }

  nav a.active, nav a:hover { color: var(--text); }

  main { padding-top: 28px; padding-bottom: 64px; }
</style>
