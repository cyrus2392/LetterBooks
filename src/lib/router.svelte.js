// Hash-based routing, since GitHub Pages has no server-side fallback for
// client routes. Routes look like #/author/stephen-king.

function parse() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return parts.map(decodeURIComponent);
}

export const route = $state({ parts: parse() });

window.addEventListener('hashchange', () => {
  route.parts = parse();
  window.scrollTo(0, 0);
});

export const href = (...parts) => '#/' + parts.map(encodeURIComponent).join('/');
