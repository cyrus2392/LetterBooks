// Drafts a curation file for a new author from the same automatic
// bibliography the site builds live (Wikipedia, falling back to Open
// Library). Review the draft by hand, then run import-author to publish it.
//
// Usage: node scripts/add-author.mjs "Brandon Sanderson"
//        node scripts/add-author.mjs OL1394865A

import { writeFile, access } from 'node:fs/promises';
import './dom.mjs';
import { buildAuthor, searchAuthors, isOlAuthorKey, slugify } from '../src/lib/sources.js';

const arg = process.argv.slice(2).join(' ').trim();
if (!arg) {
  console.error('Usage: node scripts/add-author.mjs "<author name>" | <OL author key>');
  process.exit(1);
}

let olKey = arg;
if (!isOlAuthorKey(arg)) {
  const [top, ...rest] = await searchAuthors(arg, 5);
  if (!top) {
    console.error(`No author found for "${arg}".`);
    process.exit(1);
  }
  olKey = top.olKey;
  console.log(`Using ${top.name} (${top.olKey}, ${top.workCount} works${top.topWork ? `, best known for ${top.topWork}` : ''}).`);
  if (rest.length) console.log(`Not who you meant? Others: ${rest.map((a) => `${a.name} (${a.olKey})`).join(', ')}`);
}

const author = await buildAuthor(olKey);
const slug = slugify(author.name);
const path = `data/curation/${slug}.json`;
if (await access(path).then(() => true, () => false)) {
  console.error(`${path} already exists; edit it directly instead.`);
  process.exit(1);
}

const curation = {
  slug,
  name: author.name,
  olKey,
  books: author.books.map((b) => ({
    title: b.title,
    year: b.year,
    type: b.type ?? 'novel',
    ...(b.olWorkId && { olKey: b.olWorkId }),
    ...(b.series && { series: b.series }),
  })),
};
await writeFile(path, JSON.stringify(curation, null, 2) + '\n');

console.log(`Wrote ${path} with ${curation.books.length} books from ${author.source.name}${author.source.url ? ` (${author.source.url})` : ''}.`);
console.log('Review it: remove novellas, duplicates and bundles; fix years, types and series positions. Then run:');
console.log(`  npm run import-author -- ${slug}`);
