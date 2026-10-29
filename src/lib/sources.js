// Live book data from Open Library (works, covers) and Wikidata (series,
// publication years, work types). Plain fetch with no Svelte, so it runs
// both in the browser (on-demand author pages) and in Node (scripts/).

const OL = 'https://openlibrary.org';
const WIKIDATA = 'https://query.wikidata.org/sparql';
const isNode = typeof window === 'undefined';
// Browsers don't allow setting User-Agent; Open Library asks scripts to.
const headers = isNode ? { 'User-Agent': 'LetterBooks/0.1 (https://github.com/cyrus2392/LetterBooks)' } : {};

async function getJson(url, init = {}) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { ...init, headers: { ...headers, ...init.headers } });
    if (res.ok) return res.json();
    if (attempt === 3 || res.status < 500) throw new Error(`${res.status} from ${new URL(url).host}`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
}

export const isOlAuthorKey = (ref) => /^OL\d+A$/.test(ref);

export const normalizeTitle = (s) =>
  s.toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/&/g, 'and')
    .replace(/^(the|a|an) /, '')
    .replace(/[^a-z0-9]/g, '');

export const slugify = (s) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Search

export async function searchAuthors(q, limit = 10) {
  const url = `${OL}/search/authors.json?q=${encodeURIComponent(q)}&limit=${limit}`;
  const { docs } = await getJson(url);
  return docs
    .filter((d) => d.work_count > 0)
    .map((d) => ({
      olKey: d.key,
      name: d.name,
      topWork: d.top_work ?? null,
      workCount: d.work_count,
      birthDate: d.birth_date ?? null,
    }));
}

export async function searchBooks(q, limit = 12) {
  const fields = 'key,title,author_name,author_key,cover_i,first_publish_year';
  const url = `${OL}/search.json?q=${encodeURIComponent(q)}&fields=${fields}&limit=${limit}`;
  const { docs } = await getJson(url);
  return docs
    .filter((d) => d.author_key?.length)
    .map((d) => ({
      id: d.key.replace('/works/', ''),
      title: d.title,
      year: d.first_publish_year ?? null,
      coverId: d.cover_i ?? null,
      authorName: d.author_name[0],
      authorKey: d.author_key[0],
    }));
}

// A single work, for books that aren't in their author's (filtered) list.
export async function fetchWork(workId) {
  const w = await getJson(`${OL}/works/${workId}.json`);
  return {
    id: workId,
    olWorkId: workId,
    title: w.title,
    year: null,
    coverId: w.covers?.find((c) => c > 0) ?? null,
  };
}

// Author bibliographies

// Titles that are bundles, splits or study aids rather than books.
const NOT_A_BOOK = new RegExp(
  [
    'box(ed)? set', 'omnibus', 'collection set', 'trilogy set', '\\d+ books', 'complete (novels|works)', 'selected works',
    '\\bbooks? \\d+ ?[-–&] ?\\d+', '\\bvol(ume)?s? \\d+ ?[-–&]', '\\[\\d\\/\\d\\]', '\\d\\/\\d\\b', '\\(.*\\/.*\\)',
    '\\bpart (one|two|three|four|\\d)\\b', '\\bnovels \\(', '\\bnovellas \\(',
    'summary of', 'study guide', 'sparknotes', 'cliffsnotes', 'coloring book', 'calendar',
  ].join('|'),
  'i',
);

// Wikidata work types that mean "not a standalone book".
const NOT_A_BOOK_TYPE = /short story|screenplay|teleplay|poem|essay|film|television|episode|article|letter|speech/i;

async function fetchOpenLibraryWorks(olKey) {
  const fields = 'key,title,first_publish_year,edition_count,cover_i,language,author_key';
  const { docs } = await getJson(`${OL}/search.json?author_key=${olKey}&fields=${fields}&limit=2000&sort=editions`);
  const thisYear = new Date().getFullYear();
  const byTitle = new Map();
  for (const d of docs) {
    if (!d.title || !d.first_publish_year) continue;
    // Anthologies list many authors.
    if (!d.author_key?.includes(olKey) || d.author_key.length > 3) continue;
    if (!d.language?.includes('eng')) continue;
    // Translations and one-off printings have few editions; new releases haven't had time to get more.
    if ((d.edition_count ?? 0) < (d.first_publish_year >= thisYear - 1 ? 1 : 3)) continue;
    if (NOT_A_BOOK.test(d.title)) continue;
    // Duplicate works for the same title: keep the most-published one.
    const key = normalizeTitle(d.title.replace(/[:.(].*$/, ''));
    const prev = byTitle.get(key);
    if (!prev || d.edition_count > prev.edition_count) byTitle.set(key, d);
  }
  return [...byTitle.values()];
}

// Series, publication year and type for an author's works, keyed by Open Library work id.
export async function fetchWikidataWorks(olKey) {
  const query = `
    SELECT ?work ?olw ?seriesLabel ?ord ?pub ?typeLabel WHERE {
      ?author wdt:P648 "${olKey}" .
      ?work wdt:P50 ?author ; wdt:P648 ?olw .
      OPTIONAL { ?work p:P179 ?st . ?st ps:P179 ?series . OPTIONAL { ?st pq:P1545 ?ord } }
      OPTIONAL { ?work wdt:P577 ?pub }
      OPTIONAL { ?work wdt:P31 ?type }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }`;
  const url = `${WIKIDATA}?format=json&query=${encodeURIComponent(query)}`;
  const { results } = await getJson(url, { headers: { Accept: 'application/sparql-results+json' } });

  const works = new Map();
  for (const row of results.bindings) {
    const id = row.olw.value;
    const w = works.get(id) ?? { series: new Map(), year: null, types: new Set() };
    works.set(id, w);
    if (row.seriesLabel) {
      const position = row.ord ? parseFloat(row.ord.value) : NaN;
      w.series.set(row.seriesLabel.value, Number.isFinite(position) ? position : null);
    }
    if (row.pub) {
      const year = parseInt(row.pub.value.slice(0, 4), 10);
      if (year && (!w.year || year < w.year)) w.year = year;
    }
    if (row.typeLabel) w.types.add(row.typeLabel.value);
  }
  return works;
}

function typeFrom(types) {
  const all = [...types].join(' ').toLowerCase();
  if (/collection|anthology/.test(all)) return 'collection';
  if (/novel|novella/.test(all)) return 'novel';
  if (/non-fiction|nonfiction|memoir|autobiograph|biograph/.test(all)) return 'nonfiction';
  return null;
}

// Build an author's bibliography automatically. Good, not perfect: it can
// include novellas or duplicate editions, which the user can hide.
export async function buildAuthor(olKey) {
  const [author, works, wikidata] = await Promise.all([
    getJson(`${OL}/authors/${olKey}.json`),
    fetchOpenLibraryWorks(olKey),
    fetchWikidataWorks(olKey).catch(() => new Map()), // series are a bonus; don't fail without them
  ]);

  const books = [];
  for (const d of works) {
    const id = d.key.replace('/works/', '');
    const wd = wikidata.get(id);
    if (wd?.types.size && [...wd.types].every((t) => NOT_A_BOOK_TYPE.test(t))) continue;
    const series = wd ? [...wd.series].map(([name, position]) => ({ name, position })) : [];
    books.push({
      id,
      olWorkId: id,
      title: d.title,
      year: wd?.year ?? d.first_publish_year,
      type: wd ? typeFrom(wd.types) : null,
      ...(series.length && { series }),
      coverId: d.cover_i ?? null,
    });
  }
  books.sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));

  return { slug: olKey, name: author.name, olKey, live: true, updatedAt: new Date().toISOString().slice(0, 10), books };
}
