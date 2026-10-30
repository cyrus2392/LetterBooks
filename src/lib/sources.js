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
  const fields = 'key,title,first_publish_year,edition_count,cover_i,language,author_key,already_read_count';
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
    });
  }
  checkSeriesPositions(books);
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
  const fields = 'key,title,author_name,author_key,cover_i,first_publish_year,already_read_count,ratings_average';
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
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
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
