// Book data published as static JSON under public/data by scripts/import-author.mjs.

const base = import.meta.env.BASE_URL;
const cache = new Map();

function getJson(path) {
  if (!cache.has(path)) {
    cache.set(
      path,
      fetch(`${base}data/${path}`).then((res) => {
        if (!res.ok) throw new Error(`Couldn't load ${path} (${res.status})`);
        return res.json();
      }),
    );
  }
  return cache.get(path);
}

export const getAuthors = () => getJson('authors.json');
export const getAuthor = (slug) => getJson(`authors/${slug}.json`);

export const coverUrl = (coverId, size = 'M') =>
  coverId ? `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg` : null;

export const TYPE_LABELS = { novel: 'Novel', collection: 'Collection', nonfiction: 'Non-fiction' };
