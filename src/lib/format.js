const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

// 'YYYY-MM-DD' -> '3 Mar 2024' (parsed as a local date, not UTC).
export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return dateFormat.format(new Date(y, m - 1, d));
}

const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const longFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

// A release date to the precision it's known: '5 April 1974', 'September 1978' or '1965'.
// precision follows Wikidata: 11 = day, 10 = month, 9 = year.
export function formatRelease({ date, precision }) {
  const [y, m, d] = date.split('-').map(Number);
  if (precision >= 11) return longFormat.format(new Date(y, m - 1, d));
  if (precision === 10) return monthFormat.format(new Date(y, m - 1, 1));
  return String(y);
}
