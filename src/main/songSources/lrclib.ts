// LRCLIB search client. Free JSON API, no auth (https://lrclib.net/docs). Injectable
// fetch in the style of bibleSource/messageSource so tests need no network. Throws on
// failure; the songSources orchestrator converts throws to the typed 'network' error.
import { importTidy } from '../../shared/songs/importTidy';
import { detectChorus } from '../../shared/songs/detectChorus';
import { rankCandidates, type LrclibRow } from '../../shared/songs/rankCandidates';
import type { SongWebCandidate } from '../../shared/types';

export const LRCLIB_SEARCH_URL = 'https://lrclib.net/api/search';
export const FETCH_TIMEOUT_MS = 8000;
const MAX_RESULTS = 8;

function toRows(raw: unknown): LrclibRow[] {
  if (!Array.isArray(raw)) throw new Error('lrclib: expected an array');
  const rows: LrclibRow[] = [];
  for (const r of raw) {
    const o = (r ?? {}) as Record<string, unknown>;
    if (typeof o.trackName !== 'string' || typeof o.artistName !== 'string') continue;
    rows.push({
      trackName: o.trackName,
      artistName: o.artistName,
      albumName: typeof o.albumName === 'string' ? o.albumName : undefined,
      duration: typeof o.duration === 'number' ? o.duration : undefined,
      instrumental: o.instrumental === true,
      plainLyrics: typeof o.plainLyrics === 'string' ? o.plainLyrics : null,
    });
  }
  return rows;
}

const toCandidate = (row: LrclibRow): SongWebCandidate => ({
  title: row.trackName,
  author: row.artistName,
  album: row.albumName,
  duration: row.duration,
  text: detectChorus(importTidy(row.plainLyrics ?? '')),
});

async function fetchRows(url: string, fetchFn: typeof fetch): Promise<LrclibRow[]> {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`lrclib: HTTP ${res.status}`);
  return toRows(await res.json());
}

// LRCLIB caps a search at 20 rows and is genre-blind, so a one-word title like "Jireh"
// returns 20 rows of an unrelated artist and the worship song never enters the pool.
// Fan out: the plain query, a worship-hinted query, and a title-only query. Rows are
// merged and ranked together; a single failed leg is tolerated as long as one succeeds.
const fanOut = (query: string): string[] => [
  `${LRCLIB_SEARCH_URL}?q=${encodeURIComponent(query)}`,
  `${LRCLIB_SEARCH_URL}?q=${encodeURIComponent(`${query} worship`)}`,
  `${LRCLIB_SEARCH_URL}?track_name=${encodeURIComponent(query)}`,
];

export async function searchLrclib(
  query: string,
  fetchFn: typeof fetch = fetch
): Promise<SongWebCandidate[]> {
  const legs = await Promise.allSettled(fanOut(query).map((u) => fetchRows(u, fetchFn)));
  const ok = legs.filter((l): l is PromiseFulfilledResult<LrclibRow[]> => l.status === 'fulfilled');
  if (ok.length === 0) throw (legs[0] as PromiseRejectedResult).reason;
  const rows = ok.flatMap((l) => l.value);
  return rankCandidates(rows, query).slice(0, MAX_RESULTS).map(toCandidate);
}
