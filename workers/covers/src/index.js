// LetterBooks covers Worker.
//
//   GET /cover/work/<OL work id>?size=S|M|L&fallback=<cover id>
//       The book's standard UK edition cover (chosen with the site's own
//       rules, remembered in KV for a month), else `fallback`. Working out
//       the UK cover takes seconds, so the first time a book is asked for,
//       `fallback` is served at once and the choice is made in the background.
//   GET /cover/id/<cover id>?size=S|M|L
//       A specific Open Library cover.
//
// Images are kept in Cloudflare's cache, with KV as a longer-lived backup,
// and fetched from Open Library only when neither has them. Everything stays
// within the free plan; when a free limit is hit (e.g. KV's 1,000 writes a
// day) the Worker just skips storing and still serves the image.

import { fetchUkCover } from '../../../src/lib/sources.js';

const SIZES = new Set(['S', 'M', 'L']);
const DAY = 24 * 60 * 60;
const CHOICE_TTL = 30 * DAY; // how long a book's chosen cover is remembered
const IMAGE_TTL = 180 * DAY; // how long KV keeps an image
const UA = { 'User-Agent': 'LetterBooks/0.1 (https://github.com/cyrus2392/LetterBooks)' };

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return text(405, 'Method not allowed');
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/cover\/(work|id)\/([A-Za-z0-9]+)$/);
    if (!match) return text(404, 'Not found');
    const [, kind, ref] = match;
    const size = SIZES.has(url.searchParams.get('size')) ? url.searchParams.get('size') : 'M';

    if (kind === 'id') {
      if (!/^\d+$/.test(ref)) return text(404, 'Not found');
      // A cover id never changes, so browsers can keep it forever.
      return image(ref, size, env, ctx, 'public, max-age=31536000, immutable');
    }

    if (!/^OL\d+W$/.test(ref)) return text(404, 'Not found');
    const fallback = /^\d+$/.test(url.searchParams.get('fallback') ?? '') ? url.searchParams.get('fallback') : null;
    const known = await env.COVERS.get(`uk:${ref}`);
    if (known === null && fallback) {
      // Not chosen yet: show the default cover now and choose in the background;
      // the browser checks back in five minutes.
      // Fetch the chosen cover into the cache too, so the next view is quick.
      ctx.waitUntil(chooseCover(ref, env).then((id) => id && image(id, size, env, ctx, 'public, max-age=86400')));
      return image(fallback, size, env, ctx, 'public, max-age=300');
    }
    const coverId = (known !== null ? (known === 'none' ? null : known) : await chooseCover(ref, env)) ?? fallback;
    if (!coverId) return text(404, 'No cover', 'public, max-age=86400');
    // The choice can be revisited, so browsers check back daily.
    return image(coverId, size, env, ctx, 'public, max-age=86400');
  },
};

// Work out a book's standard UK cover id and remember it (or that there's
// none). Failures aren't remembered, so the next request tries again.
async function chooseCover(workId, env) {
  let id;
  try {
    id = await fetchUkCover(workId);
  } catch {
    return null;
  }
  await env.COVERS.put(`uk:${workId}`, id ? String(id) : 'none', { expirationTtl: CHOICE_TTL }).catch(() => {});
  return id ? String(id) : null;
}

async function image(coverId, size, env, ctx, cacheControl) {
  const cacheKey = new Request(`https://letterbooks-covers.cache/${coverId}-${size}.jpg`);
  const kvKey = `img:${coverId}-${size}`;
  let body;
  let type = 'image/jpeg';
  let source = 'cache';

  const cached = await caches.default.match(cacheKey).catch(() => undefined);
  if (cached) {
    body = await cached.arrayBuffer();
    type = cached.headers.get('content-type') ?? type;
  } else {
    const stored = await env.COVERS.getWithMetadata(kvKey, 'arrayBuffer').catch(() => null);
    if (stored?.value) {
      body = stored.value;
      type = stored.metadata?.type ?? type;
      source = 'kv';
    } else {
      const upstream = await fetch(`https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg`, { headers: UA, redirect: 'follow' });
      if (!upstream.ok) return text(502, 'Cover unavailable');
      body = await upstream.arrayBuffer();
      type = upstream.headers.get('content-type') ?? type;
      source = 'openlibrary';
      ctx.waitUntil(env.COVERS.put(kvKey, body, { expirationTtl: IMAGE_TTL, metadata: { type } }).catch(() => {}));
    }
    const forCache = new Response(body, { headers: { 'content-type': type, 'cache-control': 'public, max-age=31536000, immutable' } });
    ctx.waitUntil(caches.default.put(cacheKey, forCache).catch(() => {}));
  }

  return new Response(body, {
    headers: {
      'content-type': type,
      'cache-control': cacheControl,
      'access-control-allow-origin': '*',
      'timing-allow-origin': '*', // lets the site see full load timings
      'x-letterbooks-cover': `${coverId}; from=${source}`,
    },
  });
}

const text = (status, message, cacheControl = 'no-store') =>
  new Response(message, { status, headers: { 'content-type': 'text/plain', 'cache-control': cacheControl } });
