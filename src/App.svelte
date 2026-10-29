<script>
  import { route, href } from './lib/router.svelte.js';
  import Home from './pages/Home.svelte';
  import Author from './pages/Author.svelte';
  import Book from './pages/Book.svelte';
  import Profile from './pages/Profile.svelte';

  const page = $derived(route.parts[0] ?? '');
</script>

<header>
  <div class="container bar">
    <a class="logo" href={href()}>Letter<span>Books</span></a>
    <nav>
      <a href={href()} class:active={page === '' || page === 'author'}>Authors</a>
      <a href={href('profile')} class:active={page === 'profile'}>Profile</a>
    </nav>
  </div>
</header>

<main class="container">
  {#if page === 'author' && route.parts[1]}
    {#key route.parts[1]}<Author slug={route.parts[1]} />{/key}
  {:else if page === 'book' && route.parts[2]}
    {#key route.parts[2]}<Book authorSlug={route.parts[1]} bookId={route.parts[2]} />{/key}
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
    justify-content: space-between;
    height: 56px;
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
