// Live book data: bibliographies from Wikipedia, works and covers from Open
// Library, series positions and years from Wikidata, and page counts, series,
// ratings and covers from Hardcover to fill gaps. Plain fetch with no
// Svelte, so it runs both in the browser (on-demand author pages) and in
// Node (scripts/, which install a DOMParser for the Wikipedia parsing).

import { wikipediaBibliography } from './wikipedia.js';

const OL = 'https://openlibrary.org';
const WIKIDATA = 'https://query.wikidata.org/sparql';
// The LetterBooks Worker (workers/covers), which looks things up on Hardcover.
const WORKER = 'https://letterbooks-covers.benjfdickinson.workers.dev';
const isNode = typeof window === 'undefined';
// Browsers don't allow setting User-Agent; Open Library asks scripts to.
const headers = isNode ? { 'User-Agent': 'LetterBooks/0.1 (https://github.com/cyrus2392/LetterBooks)' } : {};

async function getJson(url, init = {}) {
  for (let attempt = 1; ; attempt++) {
    // A source that hangs rather than refusing shouldn't hold a page up for minutes.
    const res = await fetch(url, { signal: AbortSignal.timeout(15000), ...init, headers: { ...headers, ...init.headers } });
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

// Search. Open Library first; when it can't be reached, Hardcover's search
// (better at finding things) together with Wikidata's, which records Open
// Library's ids for authors and books, so results lead to the same author
// and book pages. Both return { source, authors | books }.

const WD_API = 'https://www.wikidata.org/w/api.php';

async function wikidataEntities(ids) {
  if (!ids.length) return [];
  const params = new URLSearchParams({ action: 'wbgetentities', ids: ids.join('|'), props: 'labels|descriptions|claims', languages: 'en', format: 'json', origin: '*' });
  const { entities } = await getJson(`${WD_API}?${params}`);
  return ids.map((id) => entities[id]).filter((e) => e && !e.missing);
}

// Wikidata items matching `q` that have the given statements, e.g. "P648" (an Open Library id).
async function wikidataSearch(q, statements, limit) {
  const srsearch = [q, ...statements.map((st) => `haswbstatement:${st}`)].join(' ');
  const params = new URLSearchParams({ action: 'query', list: 'search', srsearch, srlimit: String(limit), format: 'json', origin: '*' });
  const { query } = await getJson(`${WD_API}?${params}`);
  return wikidataEntities(query.search.map((r) => r.title));
}

const claims = (e, property) => (e.claims?.[property] ?? []).map((c) => c.mainsnak?.datavalue?.value).filter((v) => v != null);
const labelOf = (e) => e?.labels?.en?.value ?? null;
const yearOf = (e, property) => Number(claims(e, property)[0]?.time?.match(/^[+-](\d{4})/)?.[1]) || null;

// Hardcover's search results (via the Worker), or null if it can't be reached.
async function hardcoverSearch(type, q) {
  if (isNode) return null;
  try {
    const res = await fetch(`${WORKER}/hardcover/search?type=${type}&q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(8000) });
    return res.ok ? (await res.json()).results : null;
  } catch {
    return null;
  }
}

// Same person, allowing for initials written differently ("J.R.R." / "J. R. R.").
const nameWords = (s) => s.normalize('NFKD').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean);
function sameName(a, b) {
  const [x, y] = [nameWords(a ?? ''), nameWords(b ?? '')];
  return x.length > 0 && y.length > 0 && x.at(-1) === y.at(-1) && x[0][0] === y[0][0];
}

const wikidataAuthor = (e) => ({
  olKey: claims(e, 'P648').find(isOlAuthorKey),
  name: labelOf(e),
  description: e.descriptions?.en?.value ?? null, // "British novelist"
  birthDate: yearOf(e, 'P569')?.toString() ?? null,
});

// The Wikidata author (with an Open Library id) for a name, if there is one.
// Only a name to go on, so it has to be someone described as a writer (not
// the ragtime composer who shares a crime novelist's name).
const WRITER = /writer|novelist|author|poet|journalist|playwright|essayist|historian|biographer|screenwriter|illustrator|comedian|presenter|broadcaster/i;
const wikidataAuthorNamed = (name) =>
  wikidataSearch(name, ['P648', 'P31=Q5'], 5)
    .then((people) => people.map(wikidataAuthor).find((a) => a.olKey && sameName(a.name, name) && WRITER.test(a.description ?? '')) ?? null)
    .catch(() => null);

export async function searchAuthors(q, limit = 10) {
  try {
    const { docs } = await getJson(`${OL}/search/authors.json?q=${encodeURIComponent(q)}&limit=${limit}`);
    const authors = docs
      .filter((d) => d.work_count > 0)
      .map((d) => ({
        olKey: d.key,
        name: d.name,
        topWork: d.top_work ?? null,
        workCount: d.work_count,
        birthDate: d.birth_date ?? null,
      }));
    return { source: 'Open Library', authors };
  } catch (error) {
    const [hc, people] = await Promise.all([hardcoverSearch('author', q), wikidataSearch(q, ['P648', 'P31=Q5'], limit).catch(() => null)]);
    if (!hc && !people) throw error;
    const fromWikidata = (people ?? []).map(wikidataAuthor).filter((a) => a.olKey && a.name);
    // Hardcover's order, each matched to Wikidata for its Open Library id;
    // then anyone else Wikidata found.
    const fromHardcover = await Promise.all(
      // Hardcover also lists stray names with a book or two (misspellings, anthologies).
      (hc ?? []).filter((h) => h.books >= 3).slice(0, 6).map(async (h) => {
        const match = fromWikidata.find((a) => sameName(a.name, h.name)) ?? (await wikidataAuthorNamed(h.name));
        return match && { ...match, workCount: h.books || null };
      }),
    );
    const authors = [];
    for (const a of [...fromHardcover, ...fromWikidata]) if (a && !authors.some((b) => b.olKey === a.olKey)) authors.push(a);
    return { source: hc ? 'Hardcover and Wikidata' : 'Wikidata', authors };
  }
}

export async function searchBooks(q, limit = 12) {
  try {
    const fields = 'key,title,author_name,author_key,cover_i,first_publish_year';
    const { docs } = await getJson(`${OL}/search.json?q=${encodeURIComponent(q)}&fields=${fields}&limit=${limit}`);
    const books = docs
      .filter((d) => d.author_key?.length)
      .map((d) => ({
        id: d.key.replace('/works/', ''),
        title: d.title,
        year: d.first_publish_year ?? null,
        olWorkId: d.key.replace('/works/', ''),
        coverId: d.cover_i ?? null,
        authorName: d.author_name[0],
        authorKey: d.author_key[0],
      }));
    return { source: 'Open Library', books };
  } catch (error) {
    const [hc, fromWikidata] = await Promise.all([hardcoverSearch('book', q), wikidataBooks(q, limit).catch(() => null)]);
    if (!hc && !fromWikidata) throw error;
    // Hardcover's order. A book Wikidata also found keeps its Open Library id;
    // otherwise its author is matched on Wikidata, and the book gets the id
    // its author's page gives books without one (the page finds it by title).
    const fromHardcover = await Promise.all(
      (hc ?? []).filter((h) => !NOT_A_BOOK.test(h.title) && !h.title.includes(' / ')).slice(0, limit).map(async (h) => {
        const known = fromWikidata?.find((b) => normalizeTitle(b.title) === normalizeTitle(h.title) && sameName(b.authorName, h.authors[0]));
        if (known) return { ...known, year: known.year ?? h.year, image: h.image };
        if (!h.authors[0]) return null;
        const author = fromWikidata?.find((b) => sameName(b.authorName, h.authors[0])) ?? (await wikidataAuthorNamed(h.authors[0]));
        const authorKey = author?.authorKey ?? author?.olKey;
        if (!authorKey) return null;
        const id = `${authorKey}-${normalizeTitle(h.title)}`;
        return { id, olWorkId: null, title: h.title, year: h.year, coverId: null, image: h.image, authorName: h.authors[0], authorKey };
      }),
    );
    const books = [];
    for (const b of [...fromHardcover, ...(fromWikidata ?? [])]) if (b && !books.some((x) => x.id === b.id)) books.push(b);
    return { source: hc ? 'Hardcover and Wikidata' : 'Wikidata', books };
  }
}

// Written works on Wikidata with an Open Library id, with their authors' Open Library ids.
async function wikidataBooks(q, limit) {
  const works = await wikidataSearch(q, ['P648', 'P50'], limit);
  const authorIds = [...new Set(works.map((e) => claims(e, 'P50')[0]?.id).filter(Boolean))];
  const authors = new Map((await wikidataEntities(authorIds).catch(() => [])).map((e) => [e.id, e]));
  return works
    .map((e) => {
      const author = authors.get(claims(e, 'P50')[0]?.id);
      const id = claims(e, 'P648').find((k) => /^OL\d+W$/.test(k));
      const authorKey = author && claims(author, 'P648').find(isOlAuthorKey);
      return id && authorKey && labelOf(e)
        ? { id, olWorkId: id, title: labelOf(e), year: yearOf(e, 'P577'), coverId: null, authorName: labelOf(author), authorKey }
        : null;
    })
    .filter(Boolean);
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

// Every Open Library work by an author (unfiltered).
async function fetchOpenLibraryDocs(olKey) {
  const fields = 'key,title,first_publish_year,edition_count,cover_i,language,author_key,already_read_count,number_of_pages_median';
  const { docs } = await getJson(`${OL}/search.json?author_key=${olKey}&fields=${fields}&limit=2000&sort=editions`);
  return docs.filter((d) => d.title);
}

// Fallback when Wikipedia has no usable bibliography: guess the real books
// from Open Library's works.

// Titles that are bundles, splits or study aids rather than books.
export const NOT_A_BOOK = new RegExp(
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

function guessBooksFromOpenLibrary(olKey, docs, wikidata) {
  const thisYear = new Date().getFullYear();
  const byTitle = new Map();
  for (const d of docs) {
    if (!d.first_publish_year) continue;
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

  const books = [];
  for (const d of byTitle.values()) {
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
      readers: d.already_read_count ?? 0,
      // Typical length across its editions.
      ...(d.number_of_pages_median && { pages: d.number_of_pages_median }),
    });
  }
  return books;
}

// Title, series, publication year and type for an author's works, keyed by Open Library work id.
export async function fetchWikidataWorks(olKey) {
  const query = `
    SELECT ?work ?workLabel ?olw ?seriesLabel ?ord ?pub ?typeLabel WHERE {
      ?author wdt:P648 "${olKey}" .
      ?work wdt:P50 ?author ; wdt:P648 ?olw .
      OPTIONAL { ?work p:P179 ?st . ?st ps:P179 ?series . OPTIONAL { ?st pq:P1545 ?ord } }
      OPTIONAL { ?work wdt:P577 ?pub }
      OPTIONAL { ?work wdt:P31 ?type }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
    }`;
  const url = `${WIKIDATA}?format=json&query=${encodeURIComponent(query)}`;
  const { results } = await getJson(url, { headers: { Accept: 'application/sparql-results+json' } });

  const works = new Map();
  for (const row of results.bindings) {
    const id = row.olw.value;
    const w = works.get(id) ?? { series: new Map(), year: null, types: new Set(), title: row.workLabel?.value ?? null };
    works.set(id, w);
    if (row.seriesLabel) {
      const position = row.ord ? parseFloat(row.ord.value) : NaN;
      // e.g. "canon of Hercule Poirot" -> "Hercule Poirot"
      const name = row.seriesLabel.value.replace(/^canon of /i, '');
      w.series.set(name, Number.isFinite(position) ? position : null);
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

// Title variants to match on: "The Dark Tower II: The Drawing of the Three"
// should find Open Library's "The Drawing of the Three", and vice versa.
function titleKeys(title) {
  const [before, ...rest] = title.split(/:\s+/);
  return [...new Set([title, before, rest.join(': ')].filter(Boolean).map(normalizeTitle))];
}

// Open Library work for a book title: the most-published work with a
// matching title. `weight` picks between same-titled entries in other lists.
export function matchWork(title, docs, weight = (d) => d.edition_count ?? 0) {
  const index = new Map();
  for (const d of docs) {
    for (const key of titleKeys(d.title)) {
      const prev = index.get(key);
      if (!prev || weight(d) > weight(prev)) index.set(key, d);
    }
  }
  for (const key of titleKeys(title)) {
    if (index.has(key)) return index.get(key);
  }
  // One title ends with the other: "Alcatraz Versus the Dark Talent" vs
  // "The Dark Talent", "Lies of the Beholder" vs "Legion--Lies of the Beholder".
  const target = normalizeTitle(title);
  let best = null;
  for (const [key, d] of index) {
    const shorter = key.length < target.length ? key : target;
    const longer = shorter === key ? target : key;
    if (shorter.length >= 8 && longer.endsWith(shorter) && (!best || weight(d) > weight(best))) best = d;
  }
  return best;
}

const sameSeries = (a, b) => {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  return x.includes(y) || y.includes(x);
};

// Wikipedia's series come from its section headings, so positions are just
// the order listed. Wikidata has real positions (e.g. Wheel of Time #12), so
// use them where the series match; add Wikidata's series where Wikipedia has none.
function mergeSeries(fromWikipedia = [], wd) {
  const fromWikidata = wd ? [...wd.series].map(([name, position]) => ({ name, position })) : [];
  if (!fromWikipedia.length) return fromWikidata;
  return fromWikipedia.map((s) => {
    const numbered = fromWikidata.filter((w) => w.position != null);
    // An exact name match beats a loose one ("Dune" is part of several Wikidata series names).
    const match =
      numbered.find((w) => normalizeTitle(w.name) === normalizeTitle(s.name)) ?? numbered.find((w) => sameSeries(w.name, s.name));
    return match ? { name: s.name, position: match.position, listed: s.position } : s;
  });
}

// If Wikidata's positions give two books in a series the same number, they
// aren't trustworthy for that series: go back to Wikipedia's listed order.
function checkSeriesPositions(books) {
  const positions = new Map();
  for (const b of books) {
    for (const s of b.series ?? []) {
      if (!positions.has(s.name)) positions.set(s.name, []);
      positions.get(s.name).push(s.position);
    }
  }
  for (const b of books) {
    for (const s of b.series ?? []) {
      const all = positions.get(s.name).filter((p) => p != null);
      if (new Set(all).size < all.length && 'listed' in s) s.position = s.listed;
      delete s.listed;
    }
  }
}

function booksFromWikipedia(olKey, wikiBooks, docs, wikidata) {
  const thisYear = new Date().getFullYear();
  const books = [];
  const seen = new Set();
  for (const b of wikiBooks) {
    const doc = matchWork(b.title, docs);
    const workId = doc?.key.replace('/works/', '') ?? null;
    if (workId && seen.has(workId)) continue; // two Wikipedia titles for one work
    if (workId) seen.add(workId);
    const wd = workId ? wikidata.get(workId) : null;
    const year = b.year ?? wd?.year ?? doc?.first_publish_year ?? null;
    // Leave out announced books until they're out.
    if (!year || year > thisYear) continue;
    const series = mergeSeries(b.series, wd);
    books.push({
      id: workId ?? `${olKey}-${normalizeTitle(b.title)}`,
      olWorkId: workId,
      title: b.title,
      year,
      type: b.type,
      ...(series.length && { series }),
      coverId: doc?.cover_i ?? null,
      readers: doc?.already_read_count ?? 0,
      ...(doc?.number_of_pages_median && { pages: doc.number_of_pages_median }),
    });
  }
  checkSeriesPositions(books);
  return books;
}

// When Open Library can't be reached, a best guess at the real books from
// Hardcover's list instead: books people have actually shelved, one per title.
function guessBooksFromHardcover(olKey, hcBooks, wdDocs) {
  const thisYear = new Date().getFullYear();
  const byTitle = new Map();
  for (const b of hcBooks) {
    if (!b.year || b.year > thisYear || b.compilation || b.readers < 5 || NOT_A_BOOK.test(b.title)) continue;
    const key = normalizeTitle(b.title.replace(/[:.(].*$/, ''));
    if (!byTitle.has(key) || b.readers > byTitle.get(key).readers) byTitle.set(key, b);
  }
  const seen = new Set();
  const books = [];
  for (const b of byTitle.values()) {
    const workId = matchWork(b.title, wdDocs)?.key.replace('/works/', '') ?? null;
    const id = workId ?? `${olKey}-${normalizeTitle(b.title)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    books.push({ id, olWorkId: workId, title: b.title, year: b.year, coverId: null, readers: 0 });
  }
  return books;
}

// Fills what a book is missing from its Hardcover entry: length, series,
// a cover (only used when Open Library has none), plus Hardcover's rating.
function addHardcover(books, hcBooks) {
  for (const book of books) {
    const hc = matchWork(book.title, hcBooks, (b) => b.readers);
    if (!hc) continue;
    if (!book.pages && hc.pages) book.pages = hc.pages;
    if (!book.series?.length && hc.series.length) book.series = hc.series;
    if (!book.coverId && hc.image) book.image = hc.image;
    book.hardcover = { slug: hc.slug, rating: hc.rating, ratings: hc.ratings };
  }
}

// An author's books on Hardcover, via the Worker; null if Hardcover can't be
// reached or has no token set (lookups don't work from Node scripts either).
async function fetchHardcover(name) {
  if (isNode) return null;
  try {
    const res = await fetch(`${WORKER}/hardcover/author?name=${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(10000) });
    return res.ok ? (await res.json()).books : null;
  } catch {
    return null;
  }
}

// An author's name from Wikidata, for when Open Library can't be reached.
async function wikidataAuthorName(olKey) {
  const query = `SELECT ?name WHERE { ?author wdt:P648 "${olKey}" ; rdfs:label ?name . FILTER(LANG(?name) = "en") } LIMIT 1`;
  const { results } = await getJson(`${WIKIDATA}?format=json&query=${encodeURIComponent(query)}`, {
    headers: { Accept: 'application/sparql-results+json' },
  });
  return results.bindings[0]?.name.value ?? null;
}

// Build an author's bibliography automatically: Wikipedia's bibliography
// when it has one, otherwise a best guess from Open Library. Either way,
// books are matched to Open Library works for ids and covers, and gaps are
// filled from Hardcover. If Open Library can't be reached, Hardcover stands
// in for it, and the list is marked temporary so it's rebuilt later with
// Open Library's ids (which your reading log refers to).
export async function buildAuthor(olKey) {
  const author = getJson(`${OL}/authors/${olKey}.json`).catch(() => null);
  const name = author.then((a) => a?.name ?? wikidataAuthorName(olKey).catch(() => null));
  const [authorName, docs, wikidata, wiki, hcBooks] = await Promise.all([
    name,
    fetchOpenLibraryDocs(olKey).catch(() => null),
    fetchWikidataWorks(olKey).catch(() => new Map()), // series are a bonus; don't fail without them
    wikipediaBibliography(olKey).catch((error) => ({ error })),
    name.then((n) => (n ? fetchHardcover(n) : null)),
  ]);
  const olDown = !(await author) || !docs;
  // A main article with only a handful of italicised titles isn't a bibliography.
  const useWikipedia = wiki && !wiki.error && wiki.books.length >= 8;
  if (!authorName || (olDown && !useWikipedia && !hcBooks?.length)) throw new Error("Open Library can't be reached");
  // Without Open Library's list of works, Wikidata's (which have Open Library
  // ids and titles) give most books their usual id and cover.
  const wdDocs = [...wikidata]
    .filter(([, w]) => w.title)
    .map(([id, w]) => ({ key: `/works/${id}`, title: w.title, first_publish_year: w.year, edition_count: 0 }));
  const books = useWikipedia
    ? booksFromWikipedia(olKey, wiki.books, docs ?? wdDocs, wikidata)
    : olDown
      ? guessBooksFromHardcover(olKey, hcBooks, wdDocs)
      : guessBooksFromOpenLibrary(olKey, docs, wikidata);
  if (hcBooks) addHardcover(books, hcBooks);
  books.sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));

  return {
    slug: olKey,
    name: authorName,
    olKey,
    live: true,
    // `temporary` marks a fallback caused by Wikipedia or Open Library being
    // unreachable, which shouldn't be cached.
    source: {
      ...(useWikipedia
        ? { name: 'Wikipedia', title: wiki.sourceTitle, url: wiki.sourceUrl, mainArticle: wiki.mainArticle }
        : { name: olDown ? 'Hardcover' : 'Open Library' }),
      ...((olDown || (!useWikipedia && wiki?.error)) && { temporary: true }),
      ...(olDown && { openLibraryDown: true }),
    },
    updatedAt: new Date().toISOString().slice(0, 10),
    books,
  };
}

// Covers

// Signs that an Open Library edition was published in the UK.
const UK_COUNTRY = new Set(['enk', 'stk', 'wlk', 'nik', 'xxk', 'uik']); // MARC country codes
const UK_PLACE = /london|edinburgh|glasgow|sevenoaks|harmondsworth|united kingdom|england|great britain|\bu\.?k\.?\b/i;
const UK_PUBLISHER = new RegExp(
  [
    'hodder', 'new english library', 'gollancz', 'orion', 'transworld', 'corgi', 'bantam press', 'doubleday uk', 'headline',
    'pan macmillan', '^pan\\b', 'macmillan uk', 'bloomsbury', 'faber', 'jonathan cape', 'penguin (uk|books ltd)',
    'harpercollins uk', 'little,? brown (uk|book group)', 'sphere', 'simon (&|and) schuster uk', 'hutchinson', 'chatto',
    'fourth estate', 'picador', '^arrow', '^century', 'black swan', 'random house uk', 'quercus', 'titan books',
  ].join('|'),
  'i',
);
const US_SIGNS = (e) => /u$/.test(e.publish_country?.trim() ?? '') || e.publish_places?.some((p) => /new york|u\.?s\.?a/i.test(p));

const isUkEdition = (e) =>
  !US_SIGNS(e) &&
  (UK_COUNTRY.has(e.publish_country?.trim()) || e.publish_places?.some((p) => UK_PLACE.test(p)) || e.publishers?.some((p) => UK_PUBLISHER.test(p)));

const editionYear = (e) => Number(e.publish_date?.match(/\b(1[89]\d\d|20\d\d)\b/)?.[1] ?? 0);

// Editions that aren't the standard book: special and anniversary editions,
// film tie-ins, seasonal covers, expanded texts, large print, audio and
// e-books. Checked against title, subtitle, edition name, format and publisher.
const NOT_STANDARD = new RegExp(
  [
    'anniversary', 'special', 'collector', 'collectible', 'deluxe', 'illustrated', 'limited', 'signed', 'exclusive',
    'tie-?in', 'movie', '\\bfilm\\b', 'now a (major|netflix|hbo)', 'halloween', 'christmas', 'commemorative', 'keepsake',
    'gift', 'leather', 'slipcase', 'complete (and|&) uncut', 'uncut', 'edition with', 'large (print|type)', 'audio',
    'cassette', '\\bcd\\b', 'mp3', 'e-?book', 'electronic', 'kindle', 'box(ed)? set', 'omnibus', 'graphic', 'book club',
    'braille', 'abridged', 'annotated', 'study guide',
  ].join('|'),
  'i',
);

// "<word> edition" is a special edition (Slytherin, Signature, MinaLima,
// Ancient Greek…) unless the word is an ordinary one like these.
const ORDINARY_EDITION = /^(first|1st|second|2nd|third|3rd|\d+(st|nd|rd|th)|new|revised|uk|british|paperback|hardback|hardcover|trade|reprint|standard|export|international|\d{4})$/i;
const namesSpecialEdition = (text) => [...text.matchAll(/([\w'’-]+)\s+edition\b/gi)].some(([, word]) => !ORDINARY_EDITION.test(word));

// Translations into other languages sometimes carry no language code.
const OTHER_LANGUAGE = /\((irish|welsh|scots|gaelic|scottish gaelic|latin|cornish)\)|ancient greek|[\u0370-\u03ff\u0400-\u04ff]/i;

const isStandard = (e) => {
  const text = [e.title, e.subtitle, e.edition_name, e.physical_format, ...(e.publishers ?? []), ...(e.series ?? [])].filter(Boolean).join(' | ');
  return !NOT_STANDARD.test(text) && !OTHER_LANGUAGE.test(text) && !namesSpecialEdition([e.title, e.subtitle, e.edition_name].filter(Boolean).join(' | '));
};

// English, or no language recorded (common for UK editions); never another language.
const isEnglish = (e) => !e.languages?.length || e.languages.some((l) => l.key === '/languages/eng');

const isPaperback = (e) => /paperback|mass market/i.test(e.physical_format ?? '');

// Cover from the newest standard, English-language UK edition of a work,
// preferring paperbacks; null if there's none with a cover (callers then use
// the work's default cover).
export async function fetchUkCover(workId) {
  const { entries } = await getJson(`${OL}/works/${workId}/editions.json?limit=300`);
  const uk = entries
    .filter((e) => e.covers?.some((c) => c > 0) && isUkEdition(e) && isEnglish(e) && isStandard(e))
    .sort((a, b) => isPaperback(b) - isPaperback(a) || editionYear(b) - editionYear(a));
  return uk[0]?.covers.find((c) => c > 0) ?? null;
}

// Every cover among a work's English-language editions, for choosing one by
// hand: one entry per cover, standard UK editions first, then other UK, then
// the rest, newest first within each.
export async function fetchEditionCovers(workId) {
  const { entries } = await getJson(`${OL}/works/${workId}/editions.json?limit=300`);
  const seen = new Set();
  const covers = [];
  for (const e of entries.filter(isEnglish)) {
    const coverId = e.covers?.find((c) => c > 0);
    if (!coverId || seen.has(coverId)) continue;
    seen.add(coverId);
    covers.push({
      coverId,
      publisher: e.publishers?.[0] ?? null,
      year: editionYear(e) || null,
      format: e.physical_format ?? null,
      edition: e.edition_name ?? null,
      uk: isUkEdition(e),
      standard: isStandard(e),
    });
  }
  const rank = (c) => (c.uk ? (c.standard ? 0 : 1) : 2);
  return covers.sort((a, b) => rank(a) - rank(b) || (b.year ?? 0) - (a.year ?? 0));
}

// Genres, for suggestions

// Open Library subjects are free-form ("horror tales", "Fiction, fantasy,
// epic", "nyt:..."). These map them onto a small set of genres, each with the
// subject used to look up popular books in it. Broad genres count for less,
// so a reader of epic fantasy gets epic fantasy rather than "fantasy".
export const GENRES = [
  { label: 'Epic fantasy', match: /epic fantasy|high fantasy|fantasy, epic/i, query: 'epic fantasy', weight: 1 },
  { label: 'Urban fantasy', match: /urban fantasy|fantasy, urban/i, query: 'urban fantasy', weight: 1 },
  { label: 'Dark fantasy', match: /dark fantasy|grimdark/i, query: 'dark fantasy', weight: 1 },
  { label: 'Space opera', match: /space opera|space warfare|interstellar/i, query: 'space opera', weight: 1 },
  { label: 'Cyberpunk', match: /cyberpunk/i, query: 'cyberpunk', weight: 1 },
  { label: 'Dystopian fiction', match: /dystopi/i, query: 'dystopias', weight: 1 },
  { label: 'Post-apocalyptic fiction', match: /post-?apocalyptic|end of the world/i, query: 'post-apocalyptic fiction', weight: 1 },
  { label: 'Time travel', match: /time travel/i, query: 'time travel', weight: 1 },
  { label: 'Horror', match: /horror/i, query: 'horror fiction', weight: 1 },
  { label: 'Ghost stories', match: /ghost stor|haunted house/i, query: 'ghost stories', weight: 1 },
  { label: 'Vampires', match: /vampire/i, query: 'vampires', weight: 1 },
  { label: 'Psychological thrillers', match: /psychological (thriller|suspense)/i, query: 'psychological thrillers', weight: 1 },
  // Open Library tags a lot as "thrillers"/"suspense", so these count for little.
  { label: 'Thrillers', match: /\bthrillers?\b|suspense/i, query: 'thrillers', weight: 0.3 },
  { label: 'Detective fiction', match: /detective|private investigators/i, query: 'detective and mystery stories', weight: 1 },
  { label: 'Police procedurals', match: /police procedural/i, query: 'police procedural', weight: 1 },
  { label: 'Crime fiction', match: /\bcrime\b/i, query: 'crime fiction', weight: 0.8 },
  { label: 'Spy fiction', match: /\bspy\b|espionage|secret service/i, query: 'spy stories', weight: 1 },
  { label: 'Historical fiction', match: /historical fiction|fiction, historical/i, query: 'historical fiction', weight: 1 },
  { label: 'Romance', match: /\bromance\b|love stories/i, query: 'romance fiction', weight: 0.8 },
  { label: 'Magical realism', match: /magic(al)? realism/i, query: 'magic realism (literature)', weight: 1 },
  { label: 'Gothic fiction', match: /gothic/i, query: 'gothic fiction', weight: 1 },
  { label: 'Coming of age', match: /coming of age|bildungsroman/i, query: 'coming of age', weight: 0.8 },
  { label: 'Humorous fiction', match: /humorous|humor|humour|comic fantasy/i, query: 'humorous fiction', weight: 0.8 },
  { label: 'War fiction', match: /war stories|war fiction/i, query: 'war stories', weight: 1 },
  { label: 'Science fiction', match: /science[- ]fiction|sci-fi/i, query: 'science fiction', weight: 0.5 },
  { label: 'Fantasy', match: /\bfantasy\b/i, query: 'fantasy fiction', weight: 0.5 },
  { label: 'Mystery', match: /\bmystery\b/i, query: 'mystery fiction', weight: 0.5 },
];

// The genres a work belongs to, from its Open Library subjects.
export async function fetchGenres(workId) {
  const w = await getJson(`${OL}/works/${workId}.json`);
  // "genre:high fantasy" is a genre; "nyt:...", "series:..." and the like aren't.
  const subjects = (w.subjects ?? [])
    .filter((s) => typeof s === 'string')
    .map((s) => s.replace(/^genre:/i, ''))
    .filter((s) => !s.includes(':'));
  return GENRES.filter((g) => subjects.some((s) => g.match.test(s))).map((g) => g.label);
}

// The most-read adult books in a genre since 1950, with reader counts and
// ratings. Older classics and children's/YA books otherwise crowd out
// everything else (Open Library tags Harry Potter as science fiction).
export async function popularInGenre(query, limit = 60) {
  const fields = 'key,title,author_name,author_key,cover_i,first_publish_year,already_read_count,ratings_average,number_of_pages_median';
  const q = `subject:"${query}" language:eng first_publish_year:[1950 TO *] -subject:"juvenile fiction" -subject:"young adult fiction"`;
  const { docs } = await getJson(`${OL}/search.json?q=${encodeURIComponent(q)}&sort=readinglog&fields=${fields}&limit=${limit}`);
  return docs
    .filter((d) => d.author_key?.length && d.title && !NOT_A_BOOK.test(d.title))
    // Skip titles in other scripts; the site is English-language for now.
    .filter((d) => !/[^\u0000-ɏ -⁯]/.test(d.title))
    .map((d) => ({
      id: d.key.replace('/works/', ''),
      olWorkId: d.key.replace('/works/', ''),
      title: d.title,
      year: d.first_publish_year ?? null,
      coverId: d.cover_i ?? null,
      readers: d.already_read_count ?? 0,
      // Typical length across its editions.
      ...(d.number_of_pages_median && { pages: d.number_of_pages_median }),
      rating: d.ratings_average ?? null,
      authorKey: d.author_key[0],
      authorName: d.author_name?.[0] ?? 'Unknown',
    }));
}

// Book details: release date, synopsis and genres

const WP = 'https://en.wikipedia.org';

// Wikidata labels that are genres a reader would recognise (this also keeps
// out trope labels, some of which are offensive).
const GENRE_WORDS = /fiction|novel|fantasy|horror|thriller|mystery|romance|science|dystopi|apocalyp|crime|detective|gothic|historical|humou?r|satire|adventure|war |western|literary|young adult|children|memoir|biograph|essay|poetry|suspense|supernatural|epic|comedy|tragedy|bildungsroman|coming-of-age/i;

// Wikidata facts about a book: its English Wikipedia article, first
// publication date (most precise, then earliest) and genres.
async function wikidataBook(where) {
  const query = `
    SELECT ?item ?article ?date ?precision ?genreLabel WHERE {
      ${where}
      OPTIONAL { ?item p:P577/psv:P577 [ wikibase:timeValue ?date ; wikibase:timePrecision ?precision ] }
      OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
      OPTIONAL { ?item wdt:P136 ?genre }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
    }`;
  const { results } = await getJson(`${WIKIDATA}?format=json&query=${encodeURIComponent(query)}`, {
    headers: { Accept: 'application/sparql-results+json' },
  });
  const rows = results.bindings;
  if (!rows.length) return null;
  const dates = rows
    .filter((r) => r.date)
    .map((r) => ({ date: r.date.value.slice(0, 10), precision: Number(r.precision.value) }))
    .filter((d) => d.precision >= 9) // year or better
    .sort((a, b) => b.precision - a.precision || a.date.localeCompare(b.date));
  const genres = [...new Set(rows.map((r) => r.genreLabel?.value).filter((g) => g && GENRE_WORDS.test(g) && g !== 'fiction'))];
  const article = rows.find((r) => r.article)?.article.value ?? null;
  return { released: dates[0] ?? null, genres, article };
}

// The Wikipedia article for a book: the usual article titles first
// ("Dune (novel)", "Rage (King novel)"), then a search. An article only
// counts if it's about a book by this author, not a film or TV adaptation.
async function findWikipediaArticle(title, authorName) {
  const surname = authorName.split(' ').at(-1);
  const isTheBook = (s) =>
    s &&
    s.extract.toLowerCase().includes(surname.toLowerCase()) &&
    /\b(novels?|novellas?|book|collection|memoir|anthology|non-?fiction|picture book)\b/i.test(s.extract) &&
    !/\b(film|television|tv series|miniseries|video game|musical|opera)\b/i.test(s.extract.split('. ')[0]);

  const candidates = [`${title} (novel)`, `${title} (${surname} novel)`, `${title} (novella)`, `${title} (book)`, `${title} (collection)`, title];
  const direct = await Promise.all(candidates.map(wikipediaSummary));
  const found = direct.find(isTheBook);
  if (found) return found;

  const url = `${WP}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(`${title} ${authorName}`)}&srlimit=3&format=json&origin=*`;
  const { query } = await getJson(url);
  for (const hit of query.search) {
    if (!normalizeTitle(hit.title).startsWith(normalizeTitle(title.split(':')[0]))) continue;
    const summary = await wikipediaSummary(hit.title);
    if (isTheBook(summary)) return summary;
  }
  return null;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

// "published on October 6, 2026" / "released 5 April 1974" in Wikipedia's
// summary, for books Wikidata doesn't have a date for yet.
function dateFromText(text) {
  const m =
    text.match(/(?:published|released)(?: [a-z]+)?(?: on| in)? ([A-Z][a-z]+) (\d{1,2}), (\d{4})/) ??
    text.match(/(?:published|released)(?: [a-z]+)?(?: on| in)? (\d{1,2}) ([A-Z][a-z]+) (\d{4})/);
  if (!m) return null;
  const [month, day] = /^\d/.test(m[1]) ? [m[2], m[1]] : [m[1], m[2]];
  const mi = MONTHS.indexOf(month.toLowerCase());
  if (mi < 0) return null;
  return { date: `${m[3]}-${String(mi + 1).padStart(2, '0')}-${day.padStart(2, '0')}`, precision: 11 };
}

async function wikipediaSummary(title) {
  try {
    const s = await getJson(`${WP}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
    if (s.type === 'disambiguation' || !s.extract) return null;
    return { title: s.title, extract: s.extract, url: s.content_urls?.desktop?.page, qid: s.wikibase_item ?? null };
  } catch {
    return null;
  }
}

// Open Library descriptions are free text, often with Markdown links,
// "Contains:" lists or source notes appended. Keep the prose.
function cleanDescription(text) {
  if (!text) return null;
  const prose = text
    .replace(/\r/g, '')
    .split(/\n-{3,}|\n\s*(Contains|See also|Also contained in|Source|\(\[source\])/i)[0]
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](url) -> text
    .replace(/\[\d+\]:\s*\S+/g, '') // [1]: url
    .replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, '$1') // *emphasis*
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return prose.length >= 60 ? prose : null;
}

// Release date, synopsis and genres for a book, from Wikidata (linked by
// Open Library work id, or via the book's Wikipedia article), Open Library's
// description and Wikipedia's summary. Every part is optional.
export async function fetchBookDetails({ olWorkId, title, authorName }) {
  const [wd, work] = await Promise.all([
    olWorkId ? wikidataBook(`?item wdt:P648 "${olWorkId}" .`).catch(() => null) : null,
    olWorkId ? getJson(`${OL}/works/${olWorkId}.json`).catch(() => null) : null,
  ]);

  let facts = wd;
  let wiki = facts?.article ? await wikipediaSummary(decodeURIComponent(facts.article.split('/wiki/')[1])) : null;
  if (!wiki) wiki = await findWikipediaArticle(title, authorName).catch(() => null);
  if (!facts && wiki?.qid) facts = await wikidataBook(`VALUES ?item { wd:${wiki.qid} }`).catch(() => null);

  const blurb = cleanDescription(typeof work?.description === 'string' ? work.description : work?.description?.value);
  const synopsis = blurb
    ? { text: blurb, source: 'Open Library', url: `https://openlibrary.org/works/${olWorkId}` }
    : wiki
      ? { text: wiki.extract, source: 'Wikipedia', url: wiki.url }
      : null;

  return {
    released: facts?.released ?? (wiki ? dateFromText(wiki.extract) : null),
    genres: facts?.genres ?? [],
    synopsis,
    wikipediaUrl: wiki?.url ?? null,
  };
}
