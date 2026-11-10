// Hardcover (hardcover.app) lookups for the site. They're made here because
// Hardcover's API token has to stay secret and its API can't be used from a
// browser: the token is a Worker secret (HARDCOVER_TOKEN), added in the
// Cloudflare dashboard, never in the site or the repo. Tokens expire each
// 1 January; until a new one is added, lookups fail and the site carries on
// without Hardcover.
//
//   GET /hardcover/author?name=<author name>
//       The author's books on Hardcover: title, year, pages, series, rating,
//       cover. Remembered for a day, so most visits don't reach Hardcover
//       (which allows 60 requests a minute).
//   GET /hardcover/book?slug=<Hardcover book slug>
//       One book's description, release date and genres. Remembered for a day.
//   GET /hardcover/search?type=author|book&q=<text>
//       Hardcover's search: authors (name, book count) or books (title,
//       authors, year, cover), most-read first. Remembered for a day.

const API = 'https://api.hardcover.app/v1/graphql';
const UA = 'LetterBooks/0.1 (https://github.com/cyrus2392/LetterBooks)';
const DAY = 24 * 60 * 60;
// Only the site (and a local dev server) may use the token.
const ALLOWED_ORIGIN = /^(https:\/\/cyrus2392\.github\.io|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

// Hardcover allows queries three levels deep at most: books > book_series > series.
const AUTHOR_BY_NAME = `query ($name: String!) {
  authors(where: {name: {_eq: $name}}, order_by: {books_count: desc_nulls_last}, limit: 3) { id name slug }
}`;
const AUTHOR_SEARCH = `query ($q: String!) {
  search(query: $q, query_type: "Author", per_page: 5) { results }
}`;
// Books the author is credited on, leaving out Hardcover's duplicate entries.
const BOOKS = `query ($id: Int!) {
  books(
    where: {contributions: {author_id: {_eq: $id}}, canonical_id: {_is_null: true}}
    order_by: {users_count: desc_nulls_last}
    limit: 500
  ) {
    title slug pages release_year rating ratings_count users_count compilation
    image { url }
    contributions { author_id contribution }
    book_series { position series { name } }
  }
}`;
// Credits that aren't writing the book.
const NOT_AUTHOR = /editor|illustrat|translat|narrat|introduc|foreword|afterword|contributor|cover|read by/i;

export function hardcoverAuthor(request, url, env, ctx) {
  const name = url.searchParams.get('name')?.trim();
  return answer(request, env, ctx, name, `v3/author/${name?.toLowerCase()}`, () => lookUp(name, env), (r) => r.books.length);
}

export function hardcoverBook(request, url, env, ctx) {
  const slug = url.searchParams.get('slug')?.trim();
  if (slug && !/^[a-z0-9-]+$/.test(slug)) return json(400, { error: 'Not a book slug' }, request.headers.get('origin') ?? '');
  return answer(request, env, ctx, slug, `v1/book/${slug}`, () => book(slug, env), (r) => Boolean(r.book));
}

export function hardcoverSearch(request, url, env, ctx) {
  const q = url.searchParams.get('q')?.trim();
  const type = url.searchParams.get('type') === 'author' ? 'Author' : 'Book';
  return answer(request, env, ctx, q, `v1/search/${type}/${q?.toLowerCase()}`, () => search(q, type, env), (r) => r.results.length);
}

// Checks the request, then answers from the cache or Hardcover.
async function answer(request, env, ctx, input, cachePath, look, found) {
  const origin = request.headers.get('origin') ?? '';
  if (!ALLOWED_ORIGIN.test(origin)) return json(403, { error: 'Not allowed' }, origin);
  if (!input || input.length > 120) return json(400, { error: 'Missing search text or name' }, origin);
  if (!env.HARDCOVER_TOKEN) return json(503, { error: 'No Hardcover token set' }, origin);

  const cacheKey = new Request(`https://letterbooks-hardcover.cache/${encodeURIComponent(cachePath)}`);
  const cached = await caches.default.match(cacheKey).catch(() => undefined);
  if (cached) return json(200, await cached.json(), origin, 'cache');

  let result;
  try {
    result = await look();
  } catch (error) {
    // Not remembered, so the next request tries again.
    return json(error.status ?? 502, { error: error.message }, origin);
  }
  // An empty answer may be a passing problem, so it's only kept for an hour.
  const keep = found(result) ? DAY : DAY / 24;
  const forCache = new Response(JSON.stringify(result), { headers: { 'cache-control': `public, max-age=${keep}` } });
  ctx.waitUntil(caches.default.put(cacheKey, forCache).catch(() => {}));
  return json(200, result, origin, 'hardcover');
}

const SEARCH = `query ($q: String!, $type: String!) {
  search(query: $q, query_type: $type, per_page: 10) { results }
}`;

async function search(q, type, env) {
  const { search } = await graphql(SEARCH, { q, type }, env);
  const docs = (search?.results?.hits ?? []).map((h) => h.document).filter(Boolean);
  return {
    results:
      type === 'Author'
        ? docs.filter((d) => d.name).map((d) => ({ name: d.name, books: d.books_count ?? null }))
        : docs
            .filter((d) => d.title)
            .map((d) => ({
              title: d.title,
              slug: d.slug,
              authors: d.author_names ?? [],
              year: d.release_year ?? null,
              image: d.image?.url ?? null,
            })),
  };
}

const BOOK = `query ($slug: String!) {
  books(where: {slug: {_eq: $slug}}, limit: 1) { title description release_date cached_tags }
}`;

// Genre tags people have given the book, most-used first.
function genres(tags) {
  const list = (tags?.Genre ?? []).filter((t) => t?.tag).sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  return list.map((t) => t.tag);
}

async function book(slug, env) {
  const b = (await graphql(BOOK, { slug }, env)).books[0];
  if (!b) return { book: null };
  return {
    book: {
      title: b.title,
      description: b.description?.trim() || null,
      released: b.release_date ?? null,
      genres: genres(b.cached_tags),
    },
  };
}

// Hardcover has duplicate records for some authors, with no books on them
// ("J. K. Rowling" twice), so each candidate is tried until one has books.
async function lookUp(name, env) {
  const candidates = (await graphql(AUTHOR_BY_NAME, { name }, env)).authors;
  // Names are written differently ("J.R.R." / "J. R. R."), so search too, but
  // only accept an author with the same surname and first initial.
  const searched = async () => {
    const { search } = await graphql(AUTHOR_SEARCH, { q: name }, env);
    return (search?.results?.hits ?? [])
      .map((h) => h.document)
      .filter((d) => d?.name && sameName(d.name, name) && !candidates.some((c) => c.id === Number(d.id)))
      .map((d) => ({ id: Number(d.id), name: d.name, slug: d.slug }));
  };
  for (const list of [candidates, searched]) {
    for (const author of typeof list === 'function' ? await list() : list) {
      const books = await booksBy(author, env);
      if (books.length) return { author: { name: author.name, slug: author.slug }, books };
    }
  }
  return { author: null, books: [] };
}

async function booksBy(author, env) {
  const { books } = await graphql(BOOKS, { id: author.id }, env);
  const wrote = (b) => (b.contributions ?? []).some((c) => c.author_id === author.id && !NOT_AUTHOR.test(c.contribution ?? ''));
  return books
      .filter((b) => b.title && wrote(b))
      .map((b) => ({
        title: b.title,
        slug: b.slug,
        year: b.release_year ?? null,
        pages: b.pages || null,
        rating: b.rating ? Math.round(b.rating * 100) / 100 : null,
        ratings: b.ratings_count ?? 0,
        readers: b.users_count ?? 0,
        compilation: Boolean(b.compilation),
        image: b.image?.url ?? null,
        series: (b.book_series ?? [])
          .filter((s) => s.series?.name)
          .map((s) => ({ name: s.series.name, position: Number.isFinite(s.position) ? s.position : null })),
      }));
}

const plain = (s) => s.normalize('NFKD').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean);
function sameName(a, b) {
  const [x, y] = [plain(a), plain(b)];
  return x.length > 0 && y.length > 0 && x.at(-1) === y.at(-1) && x[0][0] === y[0][0];
}

async function graphql(query, variables, env) {
  // Hardcover shows the token with "Bearer " in front; accept it either way.
  const token = env.HARDCOVER_TOKEN.replace(/^bearer\s+/i, '').trim();
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'user-agent': UA },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const message =
      res.status === 401 ? 'Hardcover token expired or not valid' : res.status === 429 ? 'Hardcover rate limit reached' : `Hardcover returned ${res.status}`;
    throw Object.assign(new Error(message), { status: res.status === 401 || res.status === 429 ? 503 : 502 });
  }
  const body = await res.json();
  if (body.errors?.length) throw Object.assign(new Error(`Hardcover: ${body.errors[0].message}`), { status: 502 });
  return body.data;
}

function json(status, body, origin, from = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': status === 200 ? 'public, max-age=3600' : 'no-store',
      ...(ALLOWED_ORIGIN.test(origin) && { 'access-control-allow-origin': origin }),
      vary: 'Origin',
      ...(from && { 'x-letterbooks-from': from }),
    },
  });
}
