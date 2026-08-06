// Labels the chorus in unlabeled lyrics. LRCLIB (and generic web pages) deliver stanza
// breaks but no section headers; the most-repeated stanza is chorus material. Modest by
// design: no bridge/pre-chorus guessing — a wrong label costs more than a missing one,
// and the QuickAdd editor review catches the rest.

const LABEL_LINE = /^(chorus|verse|bridge|refrain|intro|outro|tag|pre-?chorus)\b/i;

const stanzaKey = (stanza: string): string =>
  stanza.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

export function detectChorus(text: string): string {
  const stanzas = (text || '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  if (stanzas.length < 2) return text;
  // Already-labeled text (e.g. a Genius import) is left untouched.
  if (stanzas.some((s) => LABEL_LINE.test(s.split('\n')[0]))) return text;
  const counts = new Map<string, number>();
  for (const s of stanzas) {
    const k = stanzaKey(s);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  // Most frequent repeated stanza wins; tie → first seen (Map preserves insertion order).
  let chorusKey = '';
  let best = 1;
  for (const [k, n] of counts) {
    if (n > best) { chorusKey = k; best = n; }
  }
  if (!chorusKey) return text;
  return stanzas
    .map((s) => (stanzaKey(s) === chorusKey ? `Chorus\n${s}` : s))
    .join('\n\n');
}
