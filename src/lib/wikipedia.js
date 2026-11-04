// Author bibliographies from English Wikipedia. Finds the author's
// "<Name> bibliography" article (or their main article), then reads book
// titles, years, types and series from its tables and lists.
//
// Parsing needs a global DOMParser: browsers have one; Node scripts install
// linkedom's (see scripts/). No Svelte here, so it runs in both.

const WP_API = 'https://en.wikipedia.org/w/api.php';
const WD_API = 'https://www.wikidata.org/w/api.php';
const isNode = typeof window === 'undefined';
const headers = isNode ? { 'User-Agent': 'LetterBooks/0.1 (https://github.com/cyrus2392/LetterBooks)' } : {};

async function api(base, params) {
  const url = `${base}?${new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params })}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
      if (res.ok) return await res.json();
      if (res.status < 500 && res.status !== 429) throw Object.assign(new Error(`${res.status} from ${new URL(base).host}`), { final: true });
      throw new Error(`${res.status} from ${new URL(base).host}`);
    } catch (e) {
      if (e.final || attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
}

// English Wikipedia article title for an Open Library author, via Wikidata.
async function articleFor(olKey) {
  const search = await api(WD_API, { action: 'query', list: 'search', srsearch: `haswbstatement:P648=${olKey}`, srlimit: '1' });
  const item = search.query.search[0]?.title;
  if (!item) return null;
  const entity = await api(WD_API, { action: 'wbgetentities', ids: item, props: 'sitelinks', sitefilter: 'enwiki' });
  return entity.entities[item]?.sitelinks?.enwiki?.title ?? null;
}

async function parsePage(page) {
  const data = await api(WP_API, { action: 'parse', page, prop: 'text', redirects: '1' });
  if (data.error) return null;
  // "X bibliography" often redirects to a section of X's main article.
  const fragment = data.parse.redirects?.[0]?.tofragment?.replace(/_/g, ' ') ?? null;
  return { title: data.parse.title, html: data.parse.text, fragment };
}

// Section headings that never hold standalone books by this author.
const SKIP_SECTION = new RegExp(
  [
    // "Short story collections" are books; the stories themselves aren't.
    'short (stories|story|fiction|works)(?! collections?)', '^(other )?stories$', 'screenplay', 'teleplay', 'television',
    '\\bfilms?\\b', 'graphic novel', 'stage', 'broadcast', 'radio', '\\bplays\\b',
    'comic', 'poetry', 'poems', 'essays', 'articles', 'introduction', 'foreword', 'adaptation', 'audio', '\\bgames?\\b',
    'unpublished', 'unfinished', 'uncollected', 'see also', 'references', '^notes', 'external links', 'further reading',
    'cited', 'citations', 'filmography', 'interview',
    '^sources', 'works about', 'awards', 'reception', 'as editor', 'edited', 'contribution', 'chapbook', 'limited edition',
    'omnibus', 'box(ed)? set', 'rock bottom', '^others?$', 'other media', 'music', '^plays?$', 'scripts', 'early life',
    'career', 'personal life', 'biography', 'legacy', 'death', 'influences', 'style', 'themes', 'honours', 'honors',
    // TV and other on-screen work, e.g. "Production credits", "Presenting roles".
    'credits', 'presenting', 'presenter', 'appearances', '\\broles?\\b', 'hosting', 'podcasts?', 'performances?',
    'acting', 'video', 'discography', 'tv\\b',
  ].join('|'),
  'i',
);

// Headings that group books without naming a series.
// Matched by keyword, so "Short fiction collections" or "Other novels" count;
// "series" only on its own, since "Legion series" is a real series name.
const GENERIC = /\b(novels?|novellas?|collections?|fiction|non-?fiction|books?|works|writings?|miscellany|standalones?|stand-alones?|bibliography|children's|young adult|middle grade|era|others?)\b|^(novel )?series$/i;

// Only generic headings say what kind of book it is; a series called
// "... Collection" doesn't make its books collections.
function typeFor(headings) {
  for (const h of [...headings].reverse().filter((x) => GENERIC.test(x))) {
    if (/collection/i.test(h)) return 'collection';
    if (/non-?fiction/i.test(h)) return 'nonfiction';
    if (/novel|fiction|children|young adult|standalone|stand-alone/i.test(h)) return 'novel';
  }
  return 'novel';
}

// The deepest heading that names something is the series. If a generic
// heading sits below it (e.g. Cosmere > Standalones), the books belong to
// that world but have no reading order within it.
function seriesFor(headings) {
  for (let i = headings.length - 1; i >= 0; i--) {
    if (!GENERIC.test(headings[i])) {
      return { name: seriesName(headings[i]), ordered: i === headings.length - 1 };
    }
  }
  return null;
}

// "His Dark Materials trilogy" and "His Dark Materials" are one series;
// "The Pandora Sequence (also known as …)" is "The Pandora Sequence".
const seriesName = (text) =>
  clean(text.replace(/\(.*?\)/g, '').replace(/[:\s]+$/, '').replace(/\s+(series|trilogy|saga|novels|books)$/i, ''));

// Notes beside a title that mean it isn't a book of the author's own.
const NOT_A_BOOK_NOTE = /short story|screenplay|story concept|\bplay\b|contributor|foreword|introduction/i;

// On an author's main article, only these sections list their works.
const WORKS_HEADINGS = [
  'written works', 'works', 'bibliography', 'selected works', 'selected bibliography', 'partial bibliography',
  'publications', 'books', 'novels', 'writings', 'literary works', 'list of works',
];

// Columns that only a table of TV, film or stage work has.
const SCREEN_COLUMN = /^(role|roles|channel|network|broadcaster|station|director|episodes?|character|platform|venue|studio)$/;

// "1st in the Thursday Murder Club series" in a notes column.
const NOTES_SERIES = /\b(\d+)(?:st|nd|rd|th) (?:book |novel )?in the (.+?) (?:series|trilogy|saga)\b/i;

const EDITION = /complete and uncut|uncut edition|(revised|expanded|anniversary|illustrated|special|collector's) edition/i;

const yearIn = (text) => text.match(/\b(1[89]\d\d|20\d\d)\b/)?.[1];
const clean = (s) => s.replace(/\s+/g, ' ').replace(/\s*\((novel|novella|book)\)$/i, '').trim();

// Expand a table into rows of cells, copying rowspanned cells down.
function tableRows(table) {
  const rows = [];
  const carry = []; // column -> { cell, left }
  for (const tr of table.querySelectorAll('tr')) {
    const row = [];
    const cells = [...tr.children].filter((c) => c.tagName === 'TD' || c.tagName === 'TH');
    let col = 0;
    for (const cell of cells) {
      while (carry[col]?.left > 0) {
        row[col] = carry[col].cell;
        carry[col].left--;
        col++;
      }
      const span = parseInt(cell.getAttribute('colspan') || '1', 10);
      const down = parseInt(cell.getAttribute('rowspan') || '1', 10);
      for (let i = 0; i < span; i++) {
        row[col] = cell;
        if (down > 1) carry[col] = { cell, left: down - 1 };
        col++;
      }
    }
    while (carry[col]?.left > 0) {
      row[col] = carry[col].cell;
      carry[col].left--;
      col++;
    }
    rows.push({ tr, row, cells });
  }
  return rows;
}

function booksFromTable(table) {
  const rows = tableRows(table);
  const header = rows.find((r) => r.cells.length > 1 && r.cells.every((c) => c.tagName === 'TH' && c.getAttribute('scope') !== 'row'));
  const names = header ? header.row.map((c) => c.textContent.trim().toLowerCase()) : [];
  // A TV credits table can sit under a heading that sounds like books.
  if (names.some((n) => SCREEN_COLUMN.test(n))) return [];
  const col = (re) => names.findIndex((n) => re.test(n));
  const titleCol = col(/title|book|novel/);
  const yearCol = col(/year|published|date|release/);
  const numCol = col(/^(#|no\.?|number|vol(ume)?\.?)$|order/);
  // Some tables give series and kind of work as columns instead of headings,
  // e.g. "Harry Potter series" / "Young adult fiction".
  const seriesCol = col(/series/);
  const typeCol = col(/type|target|category|genre|format/);
  const notesCol = col(/^notes?$/);

  const books = [];
  let group = '';
  for (const { row, cells } of rows) {
    if (!row.length || (header && row === header.row)) continue;
    // Group header rows inside a table, e.g. "First Era"; ones like "Short
    // stories" leave out the rows under them.
    if (cells.length === 1 && cells[0].tagName === 'TH') {
      group = cells[0].textContent.trim();
      continue;
    }
    if (SKIP_SECTION.test(group)) continue;
    const titleCell = row[titleCol] ?? cells.find((c) => c.getAttribute('scope') === 'row') ?? cells.find((c) => c.querySelector('i'));
    if (!titleCell) continue;
    const italic = titleCell.querySelector('i');
    // Short stories are quoted, not italicised; skip anything without an italic title
    // unless it sits in a dedicated title column.
    const title = clean((italic ?? (titleCol >= 0 ? titleCell : null))?.textContent ?? '');
    if (!title) continue;
    const cellText = titleCell.textContent.trim();
    // "(short story published in …)", "(contributor)" and the like.
    if (NOT_A_BOOK_NOTE.test(cellText.replace(italic?.textContent ?? '', ''))) continue;
    const typeText = typeCol >= 0 && row[typeCol] !== titleCell ? (row[typeCol]?.textContent.trim() ?? '') : '';
    const seriesText = seriesCol >= 0 && row[seriesCol] !== titleCell ? (row[seriesCol]?.textContent.trim() ?? '') : '';
    // Rows grouped as "Articles" or "original screenplays".
    if (SKIP_SECTION.test(typeText) || SKIP_SECTION.test(seriesText)) continue;
    const notes = notesCol >= 0 && row[notesCol] !== titleCell ? row[notesCol]?.textContent.match(NOTES_SERIES) : null;
    const series = /\bseries\b/i.test(seriesText)
      ? seriesName(seriesText.replace(/\bseries\b.*$/i, ''))
      : notes ? seriesName(notes[2]) : null;
    const yearText = (yearCol >= 0 ? row[yearCol]?.textContent : null) ?? row.map((c) => c?.textContent ?? '').join(' ');
    // A position column, or a numbered title ("1. Harry Potter and…").
    const numbered = cellText.match(/^(\d+(?:\.\d+)?)[.)]\s/);
    const position = numCol >= 0 ? parseFloat(row[numCol]?.textContent) : numbered ? parseFloat(numbered[1]) : notes ? Number(notes[1]) : NaN;
    books.push({
      title,
      year: Number(yearIn(yearText ?? '')) || null,
      position: Number.isFinite(position) ? position : null,
      ...(series && { series }),
      ...(typeText && { typeText }),
    });
  }
  return books;
}

function booksFromList(list) {
  const books = [];
  for (const li of list.querySelectorAll(':scope > li')) {
    const italic = li.querySelector('i');
    if (!italic) continue;
    // The title should lead the item ("Title (1999)"), not be a passing mention.
    const before = li.textContent.slice(0, li.textContent.indexOf(italic.textContent));
    if (before.replace(/[\d.#:–—\-\s]/g, '').length > 2) continue;
    const title = clean(italic.textContent);
    if (!title) continue;
    books.push({ title, year: Number(yearIn(li.textContent)) || null, position: null });
  }
  return books;
}

// `scope`, if given, limits parsing to sections whose heading matches it (and
// their subsections), for bibliographies that are part of a main article.
export function parseBibliography(html, scope = null) {
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html');
  const root = doc.querySelector('.mw-parser-output') ?? doc.querySelector('#root');
  for (const el of root.querySelectorAll('sup, style, .mw-editsection, .navbox, .reflist, .infobox')) el.remove();

  const headings = []; // [{ level, text }]
  const books = [];
  const seen = new Set();

  // A short line such as "Jack Reacher series:" just before a table or list
  // names the series for it, like a heading would.
  let caption = null;
  const add = (found) => {
    const texts = [...headings.map((h) => h.text), ...(caption ? [caption] : [])];
    if (scope && !headings.some((h) => scope.test(h.text))) return;
    // A works section can sit inside one we'd skip, e.g. Career > Novels;
    // only it and its subsections decide.
    const from = scope ? headings.findIndex((h) => scope.test(h.text)) : 0;
    if (texts.slice(from).some((t) => SKIP_SECTION.test(t))) return;
    const headingSeries = seriesFor(texts.slice(from).filter((t) => !scope?.test(t)));
    found.forEach((b, i) => {
      // Quoted titles are short stories and novelettes, not books; special
      // editions are versions of a book that's already listed.
      if (/^["“”]/.test(b.title) || EDITION.test(b.title) || !/[a-z]{2}/i.test(b.title)) return;
      const key = b.title.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      // A series column beats the headings; a type column adds to them.
      const series = b.series ? { name: b.series, ordered: true } : headingSeries;
      const position = series?.ordered ? (b.position ?? (b.series ? null : i + 1)) : null;
      books.push({
        title: b.title,
        year: b.year,
        type: typeFor(b.typeText ? [...texts, b.typeText] : texts),
        ...(series && { series: [{ name: series.name, position }] }),
      });
    });
  };

  for (const el of root.children) {
    const h = el.matches('div.mw-heading') ? el.querySelector('h2, h3, h4, h5, h6') : el.matches('h2, h3, h4, h5, h6') ? el : null;
    if (h) {
      const level = Number(h.tagName[1]);
      while (headings.length && headings.at(-1).level >= level) headings.pop();
      headings.push({ level, text: h.textContent.trim() });
      caption = null;
      continue;
    }
    if (!headings.length) continue; // lead section
    if (el.matches('p')) {
      const text = el.textContent.trim();
      caption = text.length < 80 && /(series|trilogy|saga|sequence|cycle)\s*:?$/i.test(text) ? text : null;
      continue;
    }
    const tables = el.matches('table.wikitable') ? [el] : [...el.querySelectorAll('table.wikitable')];
    for (const t of tables) add(booksFromTable(t));
    const lists = el.matches('ul, ol') ? [el] : el.matches('div.div-col, div.columns') ? [...el.querySelectorAll('ul, ol')] : [];
    for (const l of lists) add(booksFromList(l));
    if (tables.length || lists.length) caption = null;
  }
  return books;
}

// The author's bibliography from Wikipedia, or null if there isn't a usable one.
export async function wikipediaBibliography(olKey) {
  const article = await articleFor(olKey);
  if (!article) return null;
  const bibliography = await parsePage(`${article} bibliography`);
  // A dedicated "X bibliography" article is read whole; otherwise (no such
  // article, or it redirects into the main one) only the main article's works
  // sections are, so reference lists and prose mentions stay out.
  const dedicated = bibliography && bibliography.title !== article;
  const page = dedicated ? bibliography : (bibliography ?? (await parsePage(article)));
  if (!page) return null;
  const headings = [...WORKS_HEADINGS, ...(bibliography?.fragment ? [bibliography.fragment.toLowerCase()] : [])];
  const scope = dedicated ? null : new RegExp(`^(${headings.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`, 'i');
  const books = parseBibliography(page.html, scope);
  return {
    books,
    sourceTitle: page.title,
    sourceUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
    mainArticle: !dedicated, // read from the works section of the author's own article
  };
}
