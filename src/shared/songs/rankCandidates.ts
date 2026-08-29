// LRCLIB's raw result order is untrustworthy — a probe's top hit for "Goodness of God"
// was a 41-minute livestream rip with no stanza breaks, ahead of 14 clean studio takes.
// Score for what makes a good projection source: stanza structure, title/artist match,
// sane duration. Long is penalized, not excluded — 9-minute worship songs are real.
//
// LRCLIB is genre-blind, and common one-word worship titles ("Jireh", "Gratitude",
// "Promises") drown under pop songs and artists that share the word. A worship prior
// (known artists, worship-flavoured names, worship vocabulary in the lyrics) and an
// exact-title bonus put the church version first without hiding the others.

export interface LrclibRow {
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
}

const norm = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const tokens = (s: string): Set<string> => new Set(norm(s).split(' ').filter(Boolean));

// Artists a church is likely to be looking for. Matched as substrings of the normalized
// artist/album, so "Maverick City Music feat. Chandler Moore" still hits.
const WORSHIP_ARTISTS = [
  'elevation', 'maverick city', 'bethel', 'hillsong', 'passion', 'jesus culture',
  'chris tomlin', 'brandon lake', 'phil wickham', 'cody carnes', 'kari jobe',
  'matt redman', 'lauren daigle', 'sinach', 'cece winans', 'tasha cobbs',
  'kirk franklin', 'tye tribbett', 'israel houghton', 'travis greene',
  'william murphy', 'donnie mcclurkin', 'fred hammond', 'hezekiah walker',
  'jonathan mcreynolds', 'tamela mann', 'todd dulaney', 'vertical worship',
  'upperroom', 'housefires', 'red rocks', 'gateway', 'planetshakers',
  'one sonic society', 'shane and shane', 'sovereign grace', 'citipointe',
  'north point', 'life church', 'forrest frank', 'naomi raine', 'chandler moore',
  'dante bowe', 'leeland', 'mercyme', 'casting crowns', 'crowder', 'zach williams',
  'for king', 'tauren wells', 'anne wilson', 'katy nichole', 'jenn johnson',
  'brian johnson', 'steffany gretzinger', 'michael w smith', 'don moen',
];
const WORSHIP_NAME_WORDS = /\b(worship|gospel|church|praise|ministries|choir|chapel|christian)\b/;

// Vocabulary that reads as congregational lyrics. Counted as distinct hits, capped.
const WORSHIP_VOCAB = [
  'jesus', 'lord', 'god', 'holy', 'hallelujah', 'praise', 'worship', 'savior',
  'saviour', 'glory', 'grace', 'mercy', 'spirit', 'king', 'cross', 'amen',
  'faith', 'heaven', 'christ', 'almighty', 'jireh', 'yahweh', 'redeemer',
];

function worshipPrior(row: LrclibRow): number {
  const who = norm(`${row.artistName} ${row.albumName ?? ''}`);
  let s = 0;
  if (WORSHIP_ARTISTS.some((a) => who.includes(a))) s += 3;
  else if (WORSHIP_NAME_WORDS.test(who)) s += 2;
  const lyr = tokens(row.plainLyrics ?? '');
  let hits = 0;
  for (const w of WORSHIP_VOCAB) if (lyr.has(w)) hits++;
  s += Math.min(hits, 3) * 0.5;
  return s;
}

// Fraction of query tokens found in "title artist".
function similarity(query: string, row: LrclibRow): number {
  const q = tokens(query);
  if (q.size === 0) return 0;
  const r = tokens(`${row.trackName} ${row.artistName}`);
  let hit = 0;
  for (const t of q) if (r.has(t)) hit++;
  return hit / q.size;
}

// Query tokens found in the title alone — "Jireh" the song beats "Jireh Lim" the artist.
function titleCoverage(query: string, row: LrclibRow): number {
  const q = tokens(query);
  if (q.size === 0) return 0;
  const t = tokens(row.trackName);
  let hit = 0;
  for (const x of q) if (t.has(x)) hit++;
  return hit / q.size;
}

// Title with trailing "(Live)" / "[Radio Version]" style qualifiers stripped.
const coreTitle = (t: string): string => norm(t.replace(/[([].*?[)\]]/g, ''));

function score(query: string, row: LrclibRow): number {
  let s = similarity(query, row) * 2 + titleCoverage(query, row) * 2;
  if (coreTitle(row.trackName) === norm(query)) s += 2;   // the song itself
  if (/\bmedley\b|\s\/\s/i.test(row.trackName)) s -= 2;    // "A / B / C" mashups
  if (/\binstrumental\b/i.test(row.trackName)) s -= 3;   // flag is often unset
  if (/\n\s*\n/.test(row.plainLyrics ?? '')) s += 3; // stanza structure
  if (row.duration != null) {
    if (row.duration > 600) s -= 2;                  // livestream rips
    else if (row.duration >= 120) s += 1;            // sane song length
  }
  return s + worshipPrior(row);
}

const lyricsKey = (row: LrclibRow): string =>
  (row.plainLyrics ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

export function rankCandidates(rows: LrclibRow[], query: string): LrclibRow[] {
  const usable = rows.filter((r) => !r.instrumental && (r.plainLyrics ?? '').trim() !== '');
  const scored = usable.map((row, i) => ({ row, i, s: score(query, row) }));
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  const seen = new Set<string>();
  const out: LrclibRow[] = [];
  for (const { row } of scored) {
    const k = lyricsKey(row);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
  }
  return out;
}
