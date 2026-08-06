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

export async function searchLrclib(
  query: string,
  fetchFn: typeof fetch = fetch
): Promise<SongWebCandidate[]> {
  const url = `${LRCLIB_SEARCH_URL}?q=${encodeURIComponent(query)}`;
  const res = await fetchFn(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`lrclib: HTTP ${res.status}`);
  const rows = toRows(await res.json());
  return rankCandidates(rows, query).slice(0, MAX_RESULTS).map(toCandidate);
}
