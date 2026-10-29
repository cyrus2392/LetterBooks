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
      const res = await fetch(url, { headers });
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
  return { title: data.parse.title, html: data.parse.text };
}

// Section headings that never hold standalone books by this author.
const SKIP_SECTION = new RegExp(
  [
    // "Short story collections" are books; the stories themselves aren't.
    'short (stories|story|fiction|works)(?! collections?)', '^(other )?stories$', 'screenplay', 'teleplay', 'television',
    '\\bfilms?\\b', 'graphic novel', 'stage', 'broadcast', 'radio', '\\bplays\\b',
    'comic', 'poetry', 'poems', 'essays', 'articles', 'introduction', 'foreword', 'adaptation', 'audio', '\\bgames?\\b',
    'unpublished', 'unfinished', 'uncollected', 'see also', 'references', '^notes', 'external links', 'further reading',
    '^sources', 'works about', 'awards', 'reception', 'as editor', 'edited', 'contribution', 'chapbook', 'limited edition',
    'omnibus', 'box(ed)? set', 'rock bottom', '^others?$', 'other media', 'music', '^plays?$', 'scripts', 'early life',
    'career', 'personal life', 'biography', 'legacy', 'death', 'influences', 'style', 'themes', 'honours', 'honors',
  ].join('|'),
  'i',
);

// Headings that group books without naming a series.
// Matched by keyword, so "Short fiction collections" or "Other novels" count;
// "series" only on its own, since "Legion series" is a real series name.
const GENERIC = /\b(novels?|novellas?|collections?|fiction|non-?fiction|books?|works|writings?|miscellany|standalones?|stand-alone|bibliography|children's|young adult|middle grade|era|others?)\b|^(novel )?series$/i;

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
      return { name: headings[i].replace(/\s+series$/i, ''), ordered: i === headings.length - 1 };
    }
  }
  return null;
}

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
  const col = (re) => names.findIndex((n) => re.test(n));
  const titleCol = col(/title|book|novel/);
  const yearCol = col(/year|published|date|release/);
  const numCol = col(/^(#|no\.?|number|vol(ume)?\.?)$/);

  const books = [];
  for (const { row, cells } of rows) {
    if (!row.length || (header && row === header.row)) continue;
    // Group header rows inside a table, e.g. "First Era".
    if (cells.length === 1 && cells[0].tagName === 'TH') continue;
    const titleCell = row[titleCol] ?? cells.find((c) => c.getAttribute('scope') === 'row') ?? cells.find((c) => c.querySelector('i'));
    if (!titleCell) continue;
    const italic = titleCell.querySelector('i');
    // Short stories are quoted, not italicised; skip anything without an italic title
    // unless it sits in a dedicated title column.
    const title = clean((italic ?? (titleCol >= 0 ? titleCell : null))?.textContent ?? '');
    if (!title) continue;
    const yearText = (yearCol >= 0 ? row[yearCol]?.textContent : null) ?? row.map((c) => c?.textContent ?? '').join(' ');
    const position = numCol >= 0 ? parseFloat(row[numCol]?.textContent) : NaN;
    books.push({ title, year: Number(yearIn(yearText ?? '')) || null, position: Number.isFinite(position) ? position : null });
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

export function parseBibliography(html) {
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html');
  const root = doc.querySelector('.mw-parser-output') ?? doc.querySelector('#root');
  for (const el of root.querySelectorAll('sup, style, .mw-editsection, .navbox, .reflist, .infobox')) el.remove();

  const headings = []; // [{ level, text }]
  const books = [];
  const seen = new Set();

  const add = (found) => {
    const texts = headings.map((h) => h.text);
    if (texts.some((t) => SKIP_SECTION.test(t))) return;
    const series = seriesFor(texts);
    found.forEach((b, i) => {
      // Quoted titles are short stories and novelettes, not books; special
      // editions are versions of a book that's already listed.
      if (/^["“”]/.test(b.title) || EDITION.test(b.title) || !/[a-z]{2}/i.test(b.title)) return;
      const key = b.title.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      const position = series?.ordered ? (b.position ?? i + 1) : null;
      books.push({
        title: b.title,
        year: b.year,
        type: typeFor(texts),
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
      continue;
    }
    if (!headings.length) continue; // lead section
    const tables = el.matches('table.wikitable') ? [el] : [...el.querySelectorAll('table.wikitable')];
    for (const t of tables) add(booksFromTable(t));
    const lists = el.matches('ul, ol') ? [el] : el.matches('div.div-col, div.columns') ? [...el.querySelectorAll('ul, ol')] : [];
    for (const l of lists) add(booksFromList(l));
  }
  return books;
}

// The author's bibliography from Wikipedia, or null if there isn't a usable one.
export async function wikipediaBibliography(olKey) {
  const article = await articleFor(olKey);
  if (!article) return null;
  const page = (await parsePage(`${article} bibliography`)) ?? (await parsePage(article));
  if (!page) return null;
  const books = parseBibliography(page.html);
  return { books, sourceTitle: page.title, sourceUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}` };
}
