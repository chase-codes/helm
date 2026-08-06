// LRCLIB's raw result order is untrustworthy — a probe's top hit for "Goodness of God"
// was a 41-minute livestream rip with no stanza breaks, ahead of 14 clean studio takes.
// Score for what makes a good projection source: stanza structure, title/artist match,
// sane duration. Long is penalized, not excluded — 9-minute worship songs are real.

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

// Fraction of query tokens found in "title artist".
function similarity(query: string, row: LrclibRow): number {
  const q = tokens(query);
  if (q.size === 0) return 0;
  const r = tokens(`${row.trackName} ${row.artistName}`);
  let hit = 0;
  for (const t of q) if (r.has(t)) hit++;
  return hit / q.size;
}

function score(query: string, row: LrclibRow): number {
  let s = similarity(query, row) * 2;
  if (/\n\s*\n/.test(row.plainLyrics ?? '')) s += 3; // stanza structure
  if (row.duration != null) {
    if (row.duration > 600) s -= 2;                  // livestream rips
    else if (row.duration >= 120) s += 1;            // sane song length
  }
  return s;
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
