// What a book looks like on the shelf: a spine colour taken from its cover,
// and a width and height that vary a little from book to book.

const COLOURS_KEY = 'letterbooks:cache:spine-colours';

// Stand-ins until a cover's colour is known, or when there's no cover.
const PALETTE = ['#7a2e2e', '#2f4f6f', '#3f5f3a', '#6b4f2a', '#4a3a63', '#7a5a1f', '#2e5e5e', '#5c2f45', '#3d4450', '#8a4b2a'];

function hash(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

// Stable per book, so the shelf doesn't reshuffle between visits. Width is
// for a 200px shelf: thicker for longer books (a 250-page book is slim, a
// 1,100-page one a doorstop), or varied a little when the length isn't known.
export function spineShape(id, pages = null) {
  const h = hash(id);
  const jitter = (h >>> 16) % 5 - 2;
  return {
    width: pages ? Math.min(72, Math.max(26, 18 + pages * 0.04)) + jitter : 30 + (h % 21), // px
    height: 0.86 + ((h >>> 8) % 15) / 100, // share of the shelf's height
  };
}

export const fallbackColour = (id) => PALETTE[hash(id) % PALETTE.length];

// Dark text on light spines, light text on dark ones.
export function inkFor(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r ** 2.2 + 0.7152 * g ** 2.2 + 0.0722 * b ** 2.2;
  return lum > 0.33 ? '#1b1a17' : '#f6f1e7';
}

let saved = null;
function colours() {
  if (!saved) {
    try {
      saved = JSON.parse(localStorage.getItem(COLOURS_KEY)) ?? {};
    } catch {
      saved = {};
    }
  }
  return saved;
}

let writeTimer;
function remember(url, colour) {
  colours()[url] = colour;
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    try {
      localStorage.setItem(COLOURS_KEY, JSON.stringify(saved));
    } catch {
      // Not remembered; it's worked out again next visit.
    }
  }, 500);
}

const toHex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

// The cover's dominant colour: the most common shade, favouring colourful
// pixels over the white and black of titles and borders, then darkened a
// touch so it reads as cloth or card rather than print.
function dominant(pixels) {
  const buckets = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const light = (max + min) / 510;
    if (light > 0.93 || light < 0.05) continue;
    const sat = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
    const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
    const bucket = buckets.get(key) ?? { weight: 0, r: 0, g: 0, b: 0, n: 0 };
    bucket.weight += 0.3 + sat;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.n++;
    buckets.set(key, bucket);
  }
  const best = [...buckets.values()].sort((a, b) => b.weight - a.weight)[0];
  if (!best) return null;
  return toHex([best.r, best.g, best.b].map((v) => (v / best.n) * 0.85));
}

// The spine colour for an image already loaded (an uploaded cover, say).
export function colourOfImage(img) {
  const canvas = document.createElement('canvas');
  canvas.width = 12;
  canvas.height = 18;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return dominant(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
}

// A colour already worked out for this cover, if any, without waiting.
export const knownColour = (url) => (url ? (colours()[url] ?? null) : null);

const pending = new Map();

// Resolves to a colour for the cover at `url` (a covers Worker URL, which
// allows canvas reads), or null if it can't be read.
export function spineColour(url) {
  if (!url) return Promise.resolve(null);
  if (url in colours()) return Promise.resolve(colours()[url]);
  if (!pending.has(url)) {
    pending.set(
      url,
      new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.decoding = 'async';
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = 12;
            canvas.height = 18;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const colour = dominant(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
            // Open Library's 1×1 "no cover" image has no usable pixels.
            if (img.naturalWidth > 1) remember(url, colour);
            resolve(colour);
          } catch {
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = url;
      }),
    );
  }
  return pending.get(url);
}
