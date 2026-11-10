// A little typo tolerance for search: "sandersen" finds Sanderson, "kigns"
// finds Kings. Words are compared after dropping accents, case and
// punctuation, allowing one slip in a word of 4+ letters and two in 8+
// (a slip is a missing, extra, wrong or swapped letter).

export const words = (s) =>
  (s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const allowed = (word) => (word.length >= 8 ? 2 : word.length >= 4 ? 1 : 0);

// Edit distance with swapped neighbours counting as one slip, giving up past `max`.
export function distance(a, b, max = Infinity) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      row.push(d);
      best = Math.min(best, d);
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = row;
  }
  return prev[b.length];
}

// Is this typed word close enough to that word in the text? The last word
// you type may be unfinished, so it also matches the start of a word.
function close(typed, word, last) {
  if (word === typed || (last && word.startsWith(typed))) return true;
  const max = allowed(typed);
  if (!max) return false;
  if (last && word.length > typed.length && distance(typed, word.slice(0, typed.length), max) <= max) return true;
  return distance(typed, word, max) <= max;
}

// Every word you typed is (nearly) in the text, in any order.
export function fuzzyMatch(query, text) {
  const typed = words(query);
  const have = words(text);
  if (!typed.length) return false;
  return typed.every((t, i) => have.some((w) => close(t, w, i === typed.length - 1)));
}
