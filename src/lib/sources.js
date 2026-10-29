// Live book data: bibliographies from Wikipedia, works and covers from Open
// Library, series positions and years from Wikidata. Plain fetch with no
// Svelte, so it runs both in the browser (on-demand author pages) and in
// Node (scripts/, which install a DOMParser for the Wikipedia parsing).

import { wikipediaBibliography } from './wikipedia.js';

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

// Every Open Library work by an author (unfiltered).
async function fetchOpenLibraryDocs(olKey) {
  const fields = 'key,title,first_publish_year,edition_count,cover_i,language,author_key';
  const { docs } = await getJson(`${OL}/search.json?author_key=${olKey}&fields=${fields}&limit=2000&sort=editions`);
  return docs.filter((d) => d.title);
}

// Fallback when Wikipedia has no usable bibliography: guess the real books
// from Open Library's works.

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
    });
  }
  return books;
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

// Open Library work for a book title: the most-published work with a matching title.
export function matchWork(title, docs) {
  const index = new Map();
  for (const d of docs) {
    for (const key of titleKeys(d.title)) {
      const prev = index.get(key);
      if (!prev || (d.edition_count ?? 0) > (prev.edition_count ?? 0)) index.set(key, d);
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
    if (shorter.length >= 8 && longer.endsWith(shorter) && (!best || (d.edition_count ?? 0) > (best.edition_count ?? 0))) best = d;
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
    const match = fromWikidata.find((w) => sameSeries(w.name, s.name) && w.position != null);
    return match ? { name: s.name, position: match.position } : s;
  });
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
    });
  }
  return books;
}

// Build an author's bibliography automatically: Wikipedia's bibliography
// when it has one, otherwise a best guess from Open Library. Either way,
// books are matched to Open Library works for ids and covers.
export async function buildAuthor(olKey) {
  const [author, docs, wikidata, wiki] = await Promise.all([
    getJson(`${OL}/authors/${olKey}.json`),
    fetchOpenLibraryDocs(olKey),
    fetchWikidataWorks(olKey).catch(() => new Map()), // series are a bonus; don't fail without them
    wikipediaBibliography(olKey).catch((error) => ({ error })),
  ]);

  // A main article with only a handful of italicised titles isn't a bibliography.
  const useWikipedia = wiki && !wiki.error && wiki.books.length >= 8;
  const books = useWikipedia ? booksFromWikipedia(olKey, wiki.books, docs, wikidata) : guessBooksFromOpenLibrary(olKey, docs, wikidata);
  books.sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));

  return {
    slug: olKey,
    name: author.name,
    olKey,
    live: true,
    // `temporary` marks a fallback caused by Wikipedia being unreachable, which shouldn't be cached.
    source: useWikipedia
      ? { name: 'Wikipedia', title: wiki.sourceTitle, url: wiki.sourceUrl }
      : { name: 'Open Library', ...(wiki?.error && { temporary: true }) },
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

// Cover from the newest UK edition of a work that has one, or null if no UK
// edition has a cover (callers then use the work's default cover).
export async function fetchUkCover(workId) {
  const { entries } = await getJson(`${OL}/works/${workId}/editions.json?limit=300`);
  const uk = entries
    .filter((e) => e.covers?.some((c) => c > 0) && isUkEdition(e))
    .filter((e) => !e.languages || e.languages.some((l) => l.key === '/languages/eng'))
    .sort((a, b) => editionYear(b) - editionYear(a));
  return uk[0]?.covers.find((c) => c > 0) ?? null;
}
