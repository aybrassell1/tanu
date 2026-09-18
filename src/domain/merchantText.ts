/**
 * Turning a statement line into something comparable.
 *
 * Bank exports spell the same shop a dozen ways, so both the CSV importer and
 * the merchant habits it feeds reduce a description to a stable fingerprint
 * before comparing anything.
 */

/** Lowercase letters and digits only, for comparing two descriptions. */
export function normalizeDescription(raw: string): string {
  return (raw ?? '')
    .toLowerCase()
    // Apostrophes vanish rather than split, so "joe's" and "joes" agree.
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const NOISE_WORDS = new Set(['pos', 'debit', 'credit', 'card', 'purchase', 'authorized', 'on', 'recurring', 'ach', 'web', 'ppd', 'des', 'ref', 'id', 'xxxx', 'x', 'checkcard', 'sq', 'tst', 'py', 'pp', 'usa', 'us']);

/**
 * A stable merchant fingerprint: "SQ *TRADER JOE'S #482 SAN FRA 01/14" and
 * "TRADER JOES #117" both reduce to "trader joes".
 */
export function merchantKey(raw: string): string {
  const tokens: string[] = [];
  for (const token of normalizeDescription(raw).split(' ')) {
    if (!token || /^\d+$/.test(token) || NOISE_WORDS.has(token)) continue;
    // A stray single letter is the tail of the word before it ("joe s" → "joes").
    if (token.length === 1 && tokens.length) tokens[tokens.length - 1] += token;
    else tokens.push(token);
  }
  return tokens.slice(0, 4).join(' ');
}

/** True when two statement descriptions plausibly name the same purchase. */
export function similarDescription(a: string, b: string): boolean {
  const na = normalizeDescription(a);
  const nb = normalizeDescription(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ka = merchantKey(a);
  const kb = merchantKey(b);
  if (ka && ka === kb) return true;
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  return short.length >= 6 && long.includes(short);
}
