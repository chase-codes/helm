# Song Online Search & URL Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** QuickAdd's disabled "Search online" tab becomes real — type a title to search LRCLIB or paste a lyrics-page URL, preview ranked results as slides, and land tidied, chorus-labeled lyrics in the editor for review before saving.

**Architecture:** All network fetching lives in the main process behind two new IPC calls (`songSources:search`, `songSources:fromUrl`); the renderer's CSP stays untouched. Pure formatting logic (`detectChorus`, `rankCandidates`) lives in `shared/songs/` beside `importTidy`/`splitToSlides` and runs in main so candidates cross the bridge display-ready. QuickAdd grows tab state, a results list with live slide preview, and an author field.

**Tech Stack:** Electron (main-process `fetch`), TypeScript, React 19 inline-style components, vitest + @testing-library/react. **No new npm dependencies.**

**Spec:** `docs/superpowers/specs/2026-08-06-song-online-search-design.md`

## Global Constraints

- No new npm dependencies — native `fetch`, regexes, and existing shared modules only.
- All network I/O in the main process; renderer code never fetches.
- `importTidy`'s six rules are reused **unchanged** — do not modify `importTidy.ts`.
- LRCLIB endpoint: `https://lrclib.net/api/search?q=<encoded query>`; fetch timeout **8000ms**; show at most **8** candidates.
- Saves go through the existing `songs.add` IPC with `source: 'web'` — no schema changes.
- Chorus detection labels **only** the most frequent repeated stanza `Chorus`; no bridge/pre-chorus inference.
- Error copy (exact strings): `No matches — paste lyrics or try a URL.` / `Couldn’t reach the lyrics service — try again.` / `Couldn’t read lyrics from that page — copy them and use Paste lyrics.`
- Commit style: conventional-commit subject, short and clear, **no Co-Authored-By / Claude-Session trailers** (house rules).
- Run tests with `npx vitest run <file>` (repo test script is `vitest run`).

---

### Task 1: `detectChorus` — pure chorus labeling

**Files:**
- Create: `src/shared/songs/detectChorus.ts`
- Test: `src/shared/songs/detectChorus.test.ts`

**Interfaces:**
- Consumes: nothing (pure, standalone).
- Produces: `detectChorus(text: string): string` — inserts a `Chorus` line above every occurrence of the most-repeated stanza; returns input unchanged when there are no repeats or the text already carries section labels.

- [ ] **Step 1: Write the failing tests**

```ts
// src/shared/songs/detectChorus.test.ts
import { describe, expect, it } from 'vitest';
import { detectChorus } from './detectChorus';

const V1 = 'I love You, Lord\nFor Your mercy never fails me';
const V2 = 'I love Your voice\nYou have led me through the fire';
const CH1 = 'All my life You have been faithful\nAll my life You have been so, so good';

describe('detectChorus', () => {
  it('labels every occurrence of the repeated stanza', () => {
    const input = [V1, CH1, V2, CH1].join('\n\n');
    expect(detectChorus(input)).toBe(
      [V1, `Chorus\n${CH1}`, V2, `Chorus\n${CH1}`].join('\n\n')
    );
  });

  it('matches repeats despite punctuation and case differences', () => {
    const a = 'Your goodness is running after me';
    const b = 'your goodness is running after me!';
    const input = [V1, a, V2, b].join('\n\n');
    const out = detectChorus(input);
    expect(out).toContain(`Chorus\n${a}`);
    expect(out).toContain(`Chorus\n${b}`);
  });

  it('returns text with no repeated stanza unchanged', () => {
    const input = [V1, V2].join('\n\n');
    expect(detectChorus(input)).toBe(input);
  });

  it('returns already-labeled text unchanged', () => {
    const input = [`Chorus\n${CH1}`, V1, CH1].join('\n\n');
    expect(detectChorus(input)).toBe(input);
  });

  it('skips label detection for labels anywhere in stanza first lines', () => {
    const input = [`Verse 1\n${V1}`, CH1, CH1].join('\n\n');
    expect(detectChorus(input)).toBe(input);
  });

  it('ties go to the first-seen repeated stanza', () => {
    const input = [V1, V1, V2, V2].join('\n\n');
    expect(detectChorus(input)).toBe(
      [`Chorus\n${V1}`, `Chorus\n${V1}`, V2, V2].join('\n\n')
    );
  });

  it('handles empty and single-stanza input', () => {
    expect(detectChorus('')).toBe('');
    expect(detectChorus(V1)).toBe(V1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/shared/songs/detectChorus.test.ts`
Expected: FAIL — cannot resolve `./detectChorus`.

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/songs/detectChorus.ts
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
```

Note the subtlety the tests pin: the unchanged paths return the *original* `text` (exact string), while the labeling path rejoins stanzas with `\n\n` — safe because `importTidy` has already normalized blank lines by the time this runs.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/songs/detectChorus.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/songs/detectChorus.ts src/shared/songs/detectChorus.test.ts
git commit -m "feat(songs): detectChorus labels the most-repeated stanza"
```

---

### Task 2: `rankCandidates` — pure ranking + dedup over LRCLIB rows

**Files:**
- Create: `src/shared/songs/rankCandidates.ts`
- Test: `src/shared/songs/rankCandidates.test.ts`

**Interfaces:**
- Consumes: nothing (pure, standalone).
- Produces:
  - `interface LrclibRow { trackName: string; artistName: string; albumName?: string; duration?: number; instrumental?: boolean; plainLyrics?: string | null }`
  - `rankCandidates(rows: LrclibRow[], query: string): LrclibRow[]` — drops instrumentals and lyric-less rows, scores the rest, dedupes identical lyric bodies keeping the best-scored, returns best-first. Caller slices to 8.

- [ ] **Step 1: Write the failing tests**

```ts
// src/shared/songs/rankCandidates.test.ts
import { describe, expect, it } from 'vitest';
import { rankCandidates, type LrclibRow } from './rankCandidates';

const STANZAS = 'I love You, Lord\nFor Your mercy never fails me\n\nAll my life You have been faithful\nAll my life You have been so, so good';
// Different words AND no stanza breaks — must not share a dedup key with STANZAS
// (the key collapses all whitespace, so merely removing blank lines is not enough).
const FLAT = 'Sing it one more time\n' + STANZAS.replace(/\n\n/g, '\n');

const row = (over: Partial<LrclibRow>): LrclibRow => ({
  trackName: 'Goodness of God', artistName: 'Bethel Music', albumName: 'Victory',
  duration: 296, instrumental: false, plainLyrics: STANZAS, ...over,
});

describe('rankCandidates', () => {
  it('drops instrumentals and rows without plain lyrics', () => {
    const rows = [row({ instrumental: true }), row({ plainLyrics: null }), row({ plainLyrics: '  ' }), row({})];
    expect(rankCandidates(rows, 'goodness of god')).toHaveLength(1);
  });

  it('demotes the livestream rip below the studio version', () => {
    const livestream = row({ trackName: 'Goodness of God (Live Stream)', duration: 2466, plainLyrics: FLAT });
    const studio = row({});
    const out = rankCandidates([livestream, studio], 'goodness of god');
    expect(out[0]).toBe(studio);
    expect(out[1]).toBe(livestream);
  });

  it('collapses identical lyric bodies (whitespace/case-insensitive) keeping the best-scored', () => {
    const a = row({});
    // Same lyric body (uppercased, extra whitespace) but a livestream duration — scores
    // lower than a, so the dedup must keep a even though b comes first in the input.
    const b = row({ albumName: 'Peace', duration: 2466, plainLyrics: STANZAS.toUpperCase().replace(/\n/g, ' \n') });
    const out = rankCandidates([b, a], 'goodness of god');
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(a);
  });

  it('ranks better title matches first', () => {
    const match = row({});
    const other = row({ trackName: 'Different Song Entirely', artistName: 'Someone Else', plainLyrics: 'Other words here\nMore other words\n\nOther chorus line\nAnother other line' });
    const out = rankCandidates([other, match], 'goodness of god bethel');
    expect(out[0]).toBe(match);
  });

  it('returns an empty array for no usable rows', () => {
    expect(rankCandidates([], 'anything')).toEqual([]);
  });
});
```

Note on the dedup test: `b`'s lyrics are the same body uppercased with extra whitespace — the dedup key lowercases and collapses whitespace, so `a` and `b` collide; `a` scores higher (blank-line structure intact) and survives.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/shared/songs/rankCandidates.test.ts`
Expected: FAIL — cannot resolve `./rankCandidates`.

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/songs/rankCandidates.ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/songs/rankCandidates.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/songs/rankCandidates.ts src/shared/songs/rankCandidates.test.ts
git commit -m "feat(songs): rank and dedupe LRCLIB rows for projection quality"
```

---

### Task 3: shared types + LRCLIB search client

**Files:**
- Modify: `src/shared/types.ts` (add web-candidate types near `NewSongInput` ~line 11; add two `CH` entries at the end of the `CH` object ~line 190; add `songSources` block to `HelmApi` after the `songImport` block ~line 328)
- Create: `src/main/songSources/lrclib.ts`
- Test: `src/main/songSources/lrclib.test.ts`

**Interfaces:**
- Consumes: `rankCandidates`/`LrclibRow` (Task 2), `detectChorus` (Task 1), `importTidy` (existing).
- Produces:
  - Types in `shared/types.ts`:
    ```ts
    export interface SongWebCandidate {
      title: string; author: string;
      text: string;              // tidied + chorus-labeled — display-ready
      album?: string; duration?: number;
    }
    export type SongWebSearchResult = { candidates: SongWebCandidate[] } | { error: 'network' };
    export type SongFromUrlResult =
      | { candidate: SongWebCandidate }
      | { error: 'network' | 'bad-url' | 'no-lyrics' };
    ```
  - `CH.songSourcesSearch = 'songSources:search'`, `CH.songSourcesFromUrl = 'songSources:fromUrl'`
  - `HelmApi.songSources: { search(query: string): Promise<SongWebSearchResult>; fromUrl(url: string): Promise<SongFromUrlResult> }`
  - `searchLrclib(query: string, fetchFn?: typeof fetch): Promise<SongWebCandidate[]>` — throws on network/HTTP/shape failure (orchestrator converts to typed error).
  - `FETCH_TIMEOUT_MS = 8000` (exported; Task 6 reuses it).

- [ ] **Step 1: Add the shared types**

In `src/shared/types.ts`, directly after the `NewSongInput` line, add:

```ts
export interface SongWebCandidate {
  title: string; author: string;
  text: string;              // tidied + chorus-labeled — display-ready
  album?: string; duration?: number;
}
export type SongWebSearchResult = { candidates: SongWebCandidate[] } | { error: 'network' };
export type SongFromUrlResult =
  | { candidate: SongWebCandidate }
  | { error: 'network' | 'bad-url' | 'no-lyrics' };
```

In the `CH` object, after the `songImportCommit` line, add:

```ts
  songSourcesSearch: 'songSources:search', songSourcesFromUrl: 'songSources:fromUrl',
```

In `HelmApi`, after the `songImport` block, add:

```ts
  songSources: {
    search(query: string): Promise<SongWebSearchResult>;
    fromUrl(url: string): Promise<SongFromUrlResult>;
  };
```

Adding `songSources` to `HelmApi` makes the `api` object in `preload/index.ts` incomplete, so add the preload block **in this same task** to keep typecheck green. In `src/preload/index.ts`, after the `songImport` block inside `api`, add:

```ts
  songSources: {
    search: (query) => ipcRenderer.invoke(CH.songSourcesSearch, query),
    fromUrl: (url) => ipcRenderer.invoke(CH.songSourcesFromUrl, url),
  },
```

(The main-side handlers arrive in Task 6; an unhandled invoke channel rejects at runtime, which is fine — nothing calls it until Task 8.)

- [ ] **Step 2: Write the failing client tests**

```ts
// src/main/songSources/lrclib.test.ts
import { describe, expect, it, vi } from 'vitest';
import { searchLrclib } from './lrclib';

const STANZAS = 'I love You, Lord\nFor Your mercy never fails me\n\nAll my life You have been faithful\nAll my life You have been faithful';

const apiRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  trackName: 'Goodness of God', artistName: 'Bethel Music', albumName: 'Victory',
  duration: 296, instrumental: false, plainLyrics: STANZAS, syncedLyrics: '', ...over,
});

const fakeFetch = (body: unknown, ok = true, status = 200): typeof fetch =>
  vi.fn().mockResolvedValue({ ok, status, json: () => Promise.resolve(body) }) as unknown as typeof fetch;

describe('searchLrclib', () => {
  it('queries the LRCLIB search endpoint with the encoded query', async () => {
    const f = fakeFetch([]);
    await searchLrclib('goodness of god', f);
    expect(f).toHaveBeenCalledWith(
      'https://lrclib.net/api/search?q=goodness%20of%20god',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('maps rows to display-ready candidates (tidied + chorus-labeled)', async () => {
    const withChorus = 'Verse line one\nVerse line two\n\nRepeat me now\nRepeat me now\n\nSecond verse here\nMore words here\n\nRepeat me now\nRepeat me now';
    const f = fakeFetch([apiRow({ plainLyrics: withChorus })]);
    const out = await searchLrclib('goodness of god', f);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: 'Goodness of God', author: 'Bethel Music', album: 'Victory', duration: 296 });
    expect(out[0].text).toContain('Chorus\nRepeat me now');
  });

  it('applies ranking and caps results at 8', async () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      apiRow({ trackName: `Song ${i}`, plainLyrics: `${STANZAS}\nUnique line ${i}` })
    );
    const out = await searchLrclib('song', fakeFetch(rows));
    expect(out).toHaveLength(8);
  });

  it('skips malformed rows instead of crashing', async () => {
    const out = await searchLrclib('x', fakeFetch([null, { trackName: 42 }, apiRow()]));
    expect(out).toHaveLength(1);
  });

  it('throws on a non-OK response', async () => {
    await expect(searchLrclib('x', fakeFetch([], false, 500))).rejects.toThrow('lrclib: HTTP 500');
  });

  it('throws on a non-array body', async () => {
    await expect(searchLrclib('x', fakeFetch({ nope: true }))).rejects.toThrow('lrclib: expected an array');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/main/songSources/lrclib.test.ts`
Expected: FAIL — cannot resolve `./lrclib`.

- [ ] **Step 4: Write the implementation**

```ts
// src/main/songSources/lrclib.ts
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/main/songSources/lrclib.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/preload/index.ts src/main/songSources/lrclib.ts src/main/songSources/lrclib.test.ts
git commit -m "feat(songs): LRCLIB search client with web-candidate types"
```

---

### Task 4: Genius URL parser

**Files:**
- Create: `src/main/songSources/htmlText.ts` (shared HTML helpers — Task 5 reuses them)
- Create: `src/main/songSources/geniusUrl.ts`
- Test: `src/main/songSources/geniusUrl.test.ts`

**Interfaces:**
- Consumes: nothing beyond `htmlText.ts` (created here).
- Produces:
  - `decodeEntities(s: string): string` and `htmlToText(html: string): string` from `htmlText.ts`
  - `parseGeniusHtml(html: string): { title: string; author: string; text: string } | null` — `null` on any markup drift (caller falls back to the generic extractor). `[Section]` headers become Helm label lines; `[Verse 1: Someone]` → `Verse 1`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/songSources/geniusUrl.test.ts
import { describe, expect, it } from 'vitest';
import { parseGeniusHtml } from './geniusUrl';

const GENIUS_HTML = `<!DOCTYPE html><html><head>
<meta property="og:title" content="Bethel Music (Ft. Jenn Johnson) – Goodness of God"/>
<title>Bethel Music – Goodness of God Lyrics | Genius Lyrics</title>
</head><body>
<div data-lyrics-container="true" class="Lyrics__Container-sc-1ynbvzw-1">[Verse 1: Jenn Johnson]<br/>I love You, Lord<br/>Oh, Your mercy never fails me<br/><br/>[Chorus]<br/><a href="/123"><span>And all my life You have been faithful</span></a><br/>And all my life You have been so, so good</div>
<div data-lyrics-container="true">[Bridge]<br/>Your goodness is running after me &#x27;til the end</div>
</body></html>`;

describe('parseGeniusHtml', () => {
  it('extracts labeled lyrics from the lyrics containers', () => {
    const out = parseGeniusHtml(GENIUS_HTML);
    expect(out).not.toBeNull();
    expect(out!.text).toContain('Verse 1\nI love You, Lord');
    expect(out!.text).toContain('Chorus\nAnd all my life You have been faithful');
    expect(out!.text).toContain('Bridge\nYour goodness is running after me \'til the end');
  });

  it('starts a new stanza at each section header', () => {
    const out = parseGeniusHtml(GENIUS_HTML)!;
    expect(out.text).toMatch(/never fails me\n\s*\nChorus/);
  });

  it('reads title and author from og:title', () => {
    const out = parseGeniusHtml(GENIUS_HTML)!;
    expect(out.title).toBe('Goodness of God');
    expect(out.author).toBe('Bethel Music (Ft. Jenn Johnson)');
  });

  it('keeps unknown bracketed headers as plain lines', () => {
    const html = '<div data-lyrics-container="true">[Interlude]<br/>Sing it out</div>';
    const out = parseGeniusHtml(html)!;
    expect(out.text).toContain('[Interlude]');
  });

  it('returns null when no lyrics containers exist', () => {
    expect(parseGeniusHtml('<html><body><p>Nothing here</p></body></html>')).toBeNull();
  });

  it('returns null when containers hold no text', () => {
    expect(parseGeniusHtml('<div data-lyrics-container="true">   </div>')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/songSources/geniusUrl.test.ts`
Expected: FAIL — cannot resolve `./geniusUrl`.

- [ ] **Step 3: Write the helpers and parser**

```ts
// src/main/songSources/htmlText.ts
// Minimal HTML-to-text helpers shared by the URL parsers. Deliberately not a real HTML
// parser: lyrics pages are text-dense, and everything lands in the QuickAdd editor for
// human review before saving.

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#x27;': "'", '&#39;': "'", '&nbsp;': ' ',
};

export const decodeEntities = (s: string): string =>
  s.replace(/&(?:amp|lt|gt|quot|#x27|#39|nbsp);/g, (m) => ENTITIES[m] ?? m);

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<head[\s\S]*?<\/head>/i, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|ul|ol|nav|header|footer|section|article|table|tr)>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
  );
}
```

`nav`/`header`/`footer` matter: without them, page chrome like "Home Songs" merges into
the heading's block and can pass the stanza-shape test, leaking into the extraction. The
generic-extractor test in Task 5 pins this with its `<nav>` fixture.

```ts
// src/main/songSources/geniusUrl.ts
// Genius serves lyrics inside <div data-lyrics-container="true"> blocks with <br/> line
// breaks and [Section] header lines — the best-labeled import source we have. Markup
// drift must degrade to null (caller falls back to the generic extractor), never throw.
import { decodeEntities } from './htmlText';

const KNOWN_LABEL = /^(chorus|verse|bridge|refrain|intro|outro|tag|pre-?chorus)\b/i;

export function parseGeniusHtml(
  html: string
): { title: string; author: string; text: string } | null {
  const containers = [
    ...html.matchAll(/<div[^>]*data-lyrics-container="true"[^>]*>([\s\S]*?)<\/div>/g),
  ];
  if (containers.length === 0) return null;

  const lines = decodeEntities(
    containers.map((m) => m[1]).join('\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .split('\n')
    .map((l) => l.trim());

  const out: string[] = [];
  for (const line of lines) {
    const m = line.match(/^\[([^\]]+)\]$/);
    if (m) {
      // "[Verse 1: Jenn Johnson]" → "Verse 1"; unknown headers stay bracketed for the
      // editor to catch. Every header starts a new stanza.
      const inner = m[1].split(':')[0].trim();
      if (out.length > 0) out.push('');
      out.push(KNOWN_LABEL.test(inner) ? inner : line);
    } else {
      out.push(line);
    }
  }
  const text = out.join('\n');
  if (!text.replace(/\s/g, '')) return null;

  const og = html.match(/<meta property="og:title" content="([^"]*)"/);
  const ogTitle = og ? decodeEntities(og[1]) : '';
  // og:title is "Artist – Song" (en dash); fall back to the whole string as the title.
  const parts = ogTitle.split(/\s+–\s+/);
  const [author, title] = parts.length === 2 ? [parts[0], parts[1]] : ['', ogTitle];
  return { title: title || 'Untitled Song', author, text };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/songSources/geniusUrl.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/songSources/htmlText.ts src/main/songSources/geniusUrl.ts src/main/songSources/geniusUrl.test.ts
git commit -m "feat(songs): Genius page parser with section-header labels"
```

---

### Task 5: Generic URL extractor

**Files:**
- Create: `src/main/songSources/genericUrl.ts`
- Test: `src/main/songSources/genericUrl.test.ts`

**Interfaces:**
- Consumes: `htmlToText` (Task 4).
- Produces: `extractLyricsFromHtml(html: string): string | null` — the longest contiguous run of stanza-shaped blocks, or `null` when nothing plausible (< 6 lyric lines) is found.

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/songSources/genericUrl.test.ts
import { describe, expect, it } from 'vitest';
import { extractLyricsFromHtml } from './genericUrl';

const LYRIC_PAGE = `<html><head><title>Way Maker Lyrics - SomeLyricsSite</title>
<style>.x{color:red}</style><script>var t=1;</script></head><body>
<nav><a href="/">Home</a><a href="/songs">Songs</a></nav>
<h1>Way Maker</h1>
<div class="lyrics">
<p>You are here, moving in our midst<br/>I worship You, I worship You</p>
<p>You are here, working in this place<br/>I worship You, I worship You</p>
<p>Way Maker, Miracle Worker<br/>Promise Keeper, Light in the darkness<br/>My God, that is who You are</p>
</div>
<p>Copyright notice: this is a long single paragraph of legal boilerplate text that runs on well past ninety characters in one unbroken line and should never be mistaken for a stanza of song lyrics by the extractor heuristic under any circumstances whatsoever.</p>
</body></html>`;

describe('extractLyricsFromHtml', () => {
  it('extracts the stanza-shaped run and skips chrome and boilerplate', () => {
    const out = extractLyricsFromHtml(LYRIC_PAGE);
    expect(out).not.toBeNull();
    expect(out!).toContain('You are here, moving in our midst');
    expect(out!).toContain('Way Maker, Miracle Worker');
    expect(out!).not.toContain('Copyright notice');
    expect(out!).not.toContain('Home');
  });

  it('keeps stanza breaks between blocks', () => {
    const out = extractLyricsFromHtml(LYRIC_PAGE)!;
    expect(out.split(/\n\s*\n/).length).toBe(3);
  });

  it('returns null for a page with no lyric-shaped content', () => {
    const html = '<html><body><p>One short line</p></body></html>';
    expect(extractLyricsFromHtml(html)).toBeNull();
  });

  it('returns null when the only runs are too short', () => {
    const html = '<div><p>Line one<br/>Line two</p></div>';
    expect(extractLyricsFromHtml(html)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/songSources/genericUrl.test.ts`
Expected: FAIL — cannot resolve `./genericUrl`.

- [ ] **Step 3: Write the implementation**

```ts
// src/main/songSources/genericUrl.ts
// Best-effort lyrics extraction from an arbitrary page: strip the markup, then take the
// longest contiguous run of stanza-shaped blocks. Wrong-but-plausible output is fine —
// everything lands in the QuickAdd editor for review, and null degrades to a typed
// 'no-lyrics' error suggesting copy-paste.
import { htmlToText } from './htmlText';

const MIN_LYRIC_LINES = 6;

// Stanza-shaped: 2+ lines, none absurdly long, short on average. Legal boilerplate and
// nav chrome fail one of the three.
const lyricLike = (lines: string[]): boolean => {
  if (lines.length < 2) return false;
  if (lines.some((l) => l.length > 90)) return false;
  const avg = lines.reduce((n, l) => n + l.length, 0) / lines.length;
  return avg <= 50;
};

export function extractLyricsFromHtml(html: string): string | null {
  const stanzas = htmlToText(html)
    .split(/\n\s*\n/)
    .map((s) => s.split('\n').map((l) => l.trim()).filter(Boolean))
    .filter((s) => s.length > 0);

  const lineCount = (run: string[][]): number => run.reduce((n, s) => n + s.length, 0);
  let best: string[][] = [];
  let run: string[][] = [];
  for (const s of stanzas) {
    if (lyricLike(s)) {
      run.push(s);
      if (lineCount(run) > lineCount(best)) best = [...run];
    } else {
      run = [];
    }
  }
  if (lineCount(best) < MIN_LYRIC_LINES) return null;
  return best.map((s) => s.join('\n')).join('\n\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/songSources/genericUrl.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/songSources/genericUrl.ts src/main/songSources/genericUrl.test.ts
git commit -m "feat(songs): generic best-effort lyrics extractor for pasted URLs"
```

---

### Task 6: `songSources` orchestrator + IPC wiring

**Files:**
- Create: `src/main/songSources.ts`
- Test: `src/main/songSources.test.ts`
- Modify: `src/main/ipc.ts` (add `songSources` param + two handlers)
- Modify: `src/main/index.ts` (construct and pass `songSources`)

**Interfaces:**
- Consumes: `searchLrclib`, `FETCH_TIMEOUT_MS` (Task 3), `parseGeniusHtml` (Task 4), `extractLyricsFromHtml` (Task 5), `decodeEntities` (Task 4), `importTidy`, `detectChorus`, types from Task 3.
- Produces:
  ```ts
  export interface SongSources {
    search(query: string): Promise<SongWebSearchResult>;
    fromUrl(url: string): Promise<SongFromUrlResult>;
  }
  export function createSongSources(fetchFn?: typeof fetch): SongSources
  ```
  Registered on `CH.songSourcesSearch` / `CH.songSourcesFromUrl`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/songSources.test.ts
import { describe, expect, it, vi } from 'vitest';
import { createSongSources } from './songSources';

const textResponse = (body: string, ok = true): Response =>
  ({ ok, status: ok ? 200 : 500, text: () => Promise.resolve(body) }) as unknown as Response;
const jsonResponse = (body: unknown): Response =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as unknown as Response;

const GENIUS_HTML = `<html><head><meta property="og:title" content="Sinach – Way Maker"/></head><body>
<div data-lyrics-container="true">[Chorus]<br/>Way Maker, Miracle Worker<br/>Promise Keeper, Light in the darkness</div></body></html>`;

const GENERIC_HTML = `<html><head><title>Way Maker Lyrics - SomeSite</title></head><body>
<p>You are here, moving in our midst<br/>I worship You, I worship You</p>
<p>You are here, working in this place<br/>I worship You, I worship You</p>
<p>Way Maker, Miracle Worker<br/>Promise Keeper, Light in the darkness</p></body></html>`;

describe('songSources.search', () => {
  it('wraps LRCLIB candidates', async () => {
    const row = { trackName: 'Way Maker', artistName: 'Sinach', duration: 300, instrumental: false,
      plainLyrics: 'Line one here\nLine two here\n\nLine three here\nLine four here' };
    const s = createSongSources(vi.fn().mockResolvedValue(jsonResponse([row])) as unknown as typeof fetch);
    const out = await s.search('way maker');
    expect('candidates' in out && out.candidates[0].title).toBe('Way Maker');
  });

  it('converts any failure to the network error', async () => {
    const s = createSongSources(vi.fn().mockRejectedValue(new Error('boom')) as unknown as typeof fetch);
    expect(await s.search('way maker')).toEqual({ error: 'network' });
  });
});

describe('songSources.fromUrl', () => {
  it('rejects non-http(s) and garbage URLs without fetching', async () => {
    const f = vi.fn() as unknown as typeof fetch;
    const s = createSongSources(f);
    expect(await s.fromUrl('ftp://x.com/a')).toEqual({ error: 'bad-url' });
    expect(await s.fromUrl('not a url')).toEqual({ error: 'bad-url' });
    expect(f).not.toHaveBeenCalled();
  });

  it('routes genius.com pages through the Genius parser (labels intact)', async () => {
    const s = createSongSources(vi.fn().mockResolvedValue(textResponse(GENIUS_HTML)) as unknown as typeof fetch);
    const out = await s.fromUrl('https://genius.com/Sinach-way-maker-lyrics');
    expect('candidate' in out).toBe(true);
    if ('candidate' in out) {
      expect(out.candidate.title).toBe('Way Maker');
      expect(out.candidate.author).toBe('Sinach');
      expect(out.candidate.text).toContain('Chorus\nWay Maker, Miracle Worker');
    }
  });

  it('falls back to the generic extractor when Genius markup fails to parse', async () => {
    const s = createSongSources(vi.fn().mockResolvedValue(textResponse(GENERIC_HTML)) as unknown as typeof fetch);
    const out = await s.fromUrl('https://genius.com/whatever');
    expect('candidate' in out && out.candidate.text).toContain('You are here, moving in our midst');
  });

  it('uses the generic extractor with the page title for other hosts', async () => {
    const s = createSongSources(vi.fn().mockResolvedValue(textResponse(GENERIC_HTML)) as unknown as typeof fetch);
    const out = await s.fromUrl('https://somesite.com/way-maker');
    expect('candidate' in out).toBe(true);
    if ('candidate' in out) {
      expect(out.candidate.title).toBe('Way Maker Lyrics');
      expect(out.candidate.author).toBe('');
    }
  });

  it('returns no-lyrics when a page yields nothing lyric-shaped', async () => {
    const s = createSongSources(vi.fn().mockResolvedValue(textResponse('<html><body><p>hi</p></body></html>')) as unknown as typeof fetch);
    expect(await s.fromUrl('https://somesite.com/x')).toEqual({ error: 'no-lyrics' });
  });

  it('returns network on HTTP failure and on fetch rejection', async () => {
    const s1 = createSongSources(vi.fn().mockResolvedValue(textResponse('', false)) as unknown as typeof fetch);
    expect(await s1.fromUrl('https://x.com/a')).toEqual({ error: 'network' });
    const s2 = createSongSources(vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch);
    expect(await s2.fromUrl('https://x.com/a')).toEqual({ error: 'network' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/songSources.test.ts`
Expected: FAIL — cannot resolve `./songSources`.

- [ ] **Step 3: Write the orchestrator**

```ts
// src/main/songSources.ts
// Online single-song sources: LRCLIB search plus URL parsing (Genius, generic).
// Injectable fetch in the style of mediaImport's seams. Never throws across IPC —
// every failure becomes a typed result the renderer can show gently.
import { importTidy } from '../shared/songs/importTidy';
import { detectChorus } from '../shared/songs/detectChorus';
import { searchLrclib, FETCH_TIMEOUT_MS } from './songSources/lrclib';
import { parseGeniusHtml } from './songSources/geniusUrl';
import { extractLyricsFromHtml } from './songSources/genericUrl';
import { decodeEntities } from './songSources/htmlText';
import type { SongFromUrlResult, SongWebSearchResult } from '../shared/types';

export interface SongSources {
  search(query: string): Promise<SongWebSearchResult>;
  fromUrl(url: string): Promise<SongFromUrlResult>;
}

const pipeline = (text: string): string => detectChorus(importTidy(text));

// "Way Maker Lyrics - SomeSite" → "Way Maker Lyrics" (first chunk before a separator).
const pageTitle = (html: string): string => {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).trim().split(/\s+[|–—-]\s+/)[0].trim() : '';
};

export function createSongSources(fetchFn: typeof fetch = fetch): SongSources {
  return {
    async search(query) {
      try {
        return { candidates: await searchLrclib(query, fetchFn) };
      } catch {
        return { error: 'network' };
      }
    },

    async fromUrl(url) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return { error: 'bad-url' };
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { error: 'bad-url' };

      let html: string;
      try {
        const res = await fetchFn(url, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers: { 'User-Agent': 'Mozilla/5.0 (Helm song import)' },
        });
        if (!res.ok) return { error: 'network' };
        html = await res.text();
      } catch {
        return { error: 'network' };
      }

      if (/(^|\.)genius\.com$/.test(parsed.hostname)) {
        const g = parseGeniusHtml(html);
        // Markup drift degrades to the generic extractor rather than a dead end.
        if (g) return { candidate: { ...g, text: pipeline(g.text) } };
      }
      const text = extractLyricsFromHtml(html);
      if (!text) return { error: 'no-lyrics' };
      return {
        candidate: { title: pageTitle(html) || 'Untitled Song', author: '', text: pipeline(text) },
      };
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/songSources.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Register the IPC handlers**

In `src/main/ipc.ts`:
- Add import: `import type { SongSources } from './songSources';`
- Add a final parameter to `registerIpc`: `songSources: SongSources,` (after `songImport: SongImport,`)
- Next to the existing `CH.songImport*` handler registrations, add:

```ts
  ipcMain.handle(CH.songSourcesSearch, (_e, q: string) => songSources.search(q));
  ipcMain.handle(CH.songSourcesFromUrl, (_e, url: string) => songSources.fromUrl(url));
```

In `src/main/index.ts`:
- Add import: `import { createSongSources } from './songSources'` (beside the `createSongImport` import at line 27).
- After the `const songImport = createSongImport(...)` block (~line 200), add: `const songSources = createSongSources()`
- Add `songSources` as the final argument of the `registerIpc(...)` call (after `songImport`).

- [ ] **Step 6: Typecheck and full test suite**

Run: `npm run typecheck && npm test`
Expected: both clean — preload (from Task 3), ipc, and index now agree on the new API.

- [ ] **Step 7: Commit**

```bash
git add src/main/songSources.ts src/main/songSources.test.ts src/main/ipc.ts src/main/index.ts
git commit -m "feat(songs): songSources orchestrator with search/fromUrl IPC"
```

---

### Task 7: QuickAdd author field

**Files:**
- Modify: `src/renderer/operator/QuickAdd.tsx`
- Test: `src/renderer/operator/QuickAdd.test.tsx` (extend)

**Interfaces:**
- Consumes: existing `window.helm.songs.add` (accepts `author?: string` already — `NewSongInput`).
- Produces: an `author` state + input inside QuickAdd that Task 8's `pick()` sets via `setAuthor`. Saves pass `author` through to `songs.add`.

- [ ] **Step 1: Write the failing tests**

In `src/renderer/operator/QuickAdd.test.tsx`, extend the existing `@testing-library/react` import to `{ render, screen, cleanup, fireEvent, waitFor }`, then append:

```ts
describe('QuickAdd author field', () => {
  it('renders an optional author input, blank by default', () => {
    renderQuickAdd();
    const author = screen.getByPlaceholderText('Author (optional)') as HTMLInputElement;
    expect(author.value).toBe('');
  });

  it('passes the typed author to songs.add on save', async () => {
    const add = vi.fn().mockResolvedValue({
      id: 's1', title: 'Way Maker', author: 'Sinach', sections: [], source: 'web', createdAt: 1,
    });
    (window as unknown as { helm: unknown }).helm = { songs: { add } };
    renderQuickAdd('Way Maker');
    fireEvent.change(screen.getByPlaceholderText('Author (optional)'), { target: { value: 'Sinach' } });
    fireEvent.change(screen.getByPlaceholderText(/Paste lyrics here/), { target: { value: 'Some line\nAnother line' } });
    fireEvent.click(screen.getByText('Add to library'));
    await waitFor(() =>
      expect(add).toHaveBeenCalledWith({
        title: 'Way Maker', author: 'Sinach', text: 'Some line\nAnother line',
      })
    );
  });
});
```

No `source` in the assertion: hand-typed adds must stay `'local'` (the repo default applies when the field is absent). Only web picks set `source: 'web'`, and that flag arrives in Task 8 — this exact-match assertion keeps guarding that hand adds never send it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/operator/QuickAdd.test.tsx`
Expected: FAIL — no element with placeholder `Author (optional)`.

- [ ] **Step 3: Implement the author field**

In `src/renderer/operator/QuickAdd.tsx`:

1. Add state below the `title` state: `const [author, setAuthor] = useState('');`
2. Replace the single title `<input>` with a row of two inputs:

```tsx
<div style={{ display: 'flex', gap: '10px' }}>
  <input
    style={{ ...titleStyle, flex: 2, minWidth: 0 }}
    autoFocus={!prefilled}
    value={title}
    onChange={(e) => setTitle(e.target.value)}
    placeholder="Song title"
  />
  <input
    style={{ ...titleStyle, flex: 1, minWidth: 0, fontWeight: 500 }}
    value={author}
    onChange={(e) => setAuthor(e.target.value)}
    placeholder="Author (optional)"
  />
</div>
```

3. In `save()`, include the author (omit when blank so the existing call shape is preserved):

```ts
const input: NewSongInput = { title: title.trim() || 'Untitled Song', text };
if (author.trim()) input.author = author.trim();
window.helm.songs.add(input).then(
```

Add the type import: `import type { NewSongInput, Song } from '../../shared/types';`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/operator/QuickAdd.test.tsx`
Expected: PASS (existing initialTitle tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/operator/QuickAdd.tsx src/renderer/operator/QuickAdd.test.tsx
git commit -m "feat(songs): author field in QuickAdd"
```

---

### Task 8: QuickAdd "Search online" tab

**Files:**
- Modify: `src/renderer/operator/QuickAdd.tsx`
- Test: `src/renderer/operator/QuickAdd.test.tsx` (extend)

**Interfaces:**
- Consumes: `window.helm.songSources.search` / `.fromUrl` (Task 6 wiring, Task 3 types), `SongWebCandidate`, `splitToSlides`, `setTitle`/`setAuthor`/`setText` (Task 7 state).
- Produces: the finished feature. A `pick(c: SongWebCandidate)` fills title/author/text, marks the save as `source: 'web'`, and flips to the Paste tab.

- [ ] **Step 1: Write the failing tests**

Append to `src/renderer/operator/QuickAdd.test.tsx`:

```ts
const CANDIDATES = [
  {
    title: 'Way Maker', author: 'Sinach', album: 'Way Maker', duration: 300,
    text: 'You are here, moving in our midst\nI worship You\n\nChorus\nWay Maker, Miracle Worker\nPromise Keeper',
  },
  {
    title: 'Way Maker (Live)', author: 'Leeland', album: 'Better Word', duration: 322,
    text: 'Leeland first line here\nLeeland second line\n\nChorus\nLeeland chorus line\nLeeland chorus two',
  },
];

const stubSources = (over: Partial<Record<'search' | 'fromUrl', ReturnType<typeof vi.fn>>> = {}): {
  search: ReturnType<typeof vi.fn>; fromUrl: ReturnType<typeof vi.fn>; add: ReturnType<typeof vi.fn>;
} => {
  const search = over.search ?? vi.fn().mockResolvedValue({ candidates: CANDIDATES });
  const fromUrl = over.fromUrl ?? vi.fn().mockResolvedValue({ candidate: CANDIDATES[0] });
  const add = vi.fn().mockResolvedValue({ id: 's1', title: 'Way Maker', author: 'Sinach', sections: [], source: 'web', createdAt: 1 });
  (window as unknown as { helm: unknown }).helm = { songs: { add }, songSources: { search, fromUrl } };
  return { search, fromUrl, add };
};

describe('QuickAdd Search online tab', () => {
  it('runs the search eagerly when opening the tab with a prefilled title', async () => {
    const { search } = stubSources();
    renderQuickAdd('Way Maker');
    fireEvent.click(screen.getByText('Search online'));
    expect(search).toHaveBeenCalledWith('Way Maker');
    // Query by result titles — the author renders inside a concatenated metadata line
    // ("Sinach · Way Maker · 5:00 · 2 stanzas"), which exact-match getByText won't hit.
    expect(await screen.findByText('Way Maker (Live)')).toBeTruthy();
    expect(screen.getByText('Way Maker')).toBeTruthy();
  });

  it('does not search eagerly without a query', () => {
    const { search } = stubSources();
    renderQuickAdd();
    fireEvent.click(screen.getByText('Search online'));
    expect(search).not.toHaveBeenCalled();
  });

  it('previews the highlighted result as slides and moves highlight with arrow keys', async () => {
    stubSources();
    renderQuickAdd('Way Maker');
    fireEvent.click(screen.getByText('Search online'));
    await screen.findByText('Way Maker (Live)');
    // First result highlighted by default — its chorus is in the preview panel.
    expect(screen.getByText(/Way Maker, Miracle Worker/)).toBeTruthy();
    // Keyboard drives the highlight (deterministic in jsdom, unlike mouseEnter
    // delegation); ArrowDown moves to the second result and the preview follows.
    fireEvent.keyDown(screen.getByPlaceholderText(/Search by title/), { key: 'ArrowDown' });
    expect(await screen.findByText(/Leeland chorus line/)).toBeTruthy();
  });

  it('pick fills the editor, flips to Paste lyrics, and saves with source web', async () => {
    const { add } = stubSources();
    renderQuickAdd('Way Maker');
    fireEvent.click(screen.getByText('Search online'));
    // Click the first result's title row (Sinach's "Way Maker") — the click bubbles
    // from the title div to the result button.
    fireEvent.click(await screen.findByText('Way Maker'));
    const titleInput = screen.getByPlaceholderText('Song title') as HTMLInputElement;
    const authorInput = screen.getByPlaceholderText('Author (optional)') as HTMLInputElement;
    const lyrics = screen.getByPlaceholderText(/Paste lyrics here/) as HTMLTextAreaElement;
    expect(titleInput.value).toBe('Way Maker');
    expect(authorInput.value).toBe('Sinach');
    expect(lyrics.value).toContain('Chorus\nWay Maker, Miracle Worker');
    fireEvent.click(screen.getByText('Add to library'));
    await waitFor(() =>
      expect(add).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Way Maker', author: 'Sinach', source: 'web' })
      )
    );
  });

  it('routes URL input to fromUrl and fills the editor from the parse', async () => {
    const { search, fromUrl } = stubSources();
    renderQuickAdd();
    fireEvent.click(screen.getByText('Search online'));
    const box = screen.getByPlaceholderText(/Search by title/) as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'https://genius.com/Sinach-way-maker-lyrics' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(fromUrl).toHaveBeenCalledWith('https://genius.com/Sinach-way-maker-lyrics');
    expect(search).not.toHaveBeenCalled();
    await waitFor(() =>
      expect((screen.getByPlaceholderText('Song title') as HTMLInputElement).value).toBe('Way Maker')
    );
  });

  it('shows the empty-state copy when the search has no matches', async () => {
    stubSources({ search: vi.fn().mockResolvedValue({ candidates: [] }) });
    renderQuickAdd('zzz unfindable');
    fireEvent.click(screen.getByText('Search online'));
    expect(await screen.findByText('No matches — paste lyrics or try a URL.')).toBeTruthy();
  });

  it('shows the network error with a retry that re-runs the search', async () => {
    const search = vi.fn()
      .mockResolvedValueOnce({ error: 'network' })
      .mockResolvedValueOnce({ candidates: CANDIDATES });
    stubSources({ search });
    renderQuickAdd('Way Maker');
    fireEvent.click(screen.getByText('Search online'));
    expect(await screen.findByText('Couldn’t reach the lyrics service — try again.')).toBeTruthy();
    fireEvent.click(screen.getByText('Retry'));
    expect(await screen.findByText('Way Maker (Live)')).toBeTruthy();
  });

  it('shows the page-error copy when a URL yields no lyrics', async () => {
    stubSources({ fromUrl: vi.fn().mockResolvedValue({ error: 'no-lyrics' }) });
    renderQuickAdd();
    fireEvent.click(screen.getByText('Search online'));
    const box = screen.getByPlaceholderText(/Search by title/) as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'https://somesite.com/x' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(await screen.findByText('Couldn’t read lyrics from that page — copy them and use Paste lyrics.')).toBeTruthy();
  });
});
```

The error-copy assertions use curly apostrophes (`’`) — match the strings exactly as written in Global Constraints.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/operator/QuickAdd.test.tsx`
Expected: FAIL — the Search online button is disabled and no tab logic exists.

- [ ] **Step 3: Implement the tab**

All edits in `src/renderer/operator/QuickAdd.tsx`.

**Imports** — extend the react import and types:

```ts
import { useContext, useMemo, useRef, useState, type CSSProperties, type JSX, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import type { NewSongInput, Song, SongWebCandidate } from '../../shared/types';
```

**State** — after the existing state declarations:

```ts
type QaTab = 'search' | 'paste';
```

(place the type above the component), then inside:

```ts
const [tab, setTab] = useState<QaTab>('paste');
const [query, setQuery] = useState(initialTitle?.trim() ?? '');
const [results, setResults] = useState<SongWebCandidate[]>([]);
const [highlighted, setHighlighted] = useState(0);
const [searchState, setSearchState] = useState<'idle' | 'loading' | 'empty' | 'error' | 'url-error' | 'done'>('idle');
const [fromWeb, setFromWeb] = useState(false);
const searchSeq = useRef(0);
```

**Handlers** — before `save()`:

```ts
const isUrl = (s: string): boolean => /^https?:\/\//i.test(s.trim());

const pick = (c: SongWebCandidate): void => {
  setTitle(c.title);
  setAuthor(c.author);
  setText(c.text);
  setFromWeb(true);
  setTab('paste');
};

const runUrl = (url: string): void => {
  const mySeq = ++searchSeq.current;
  setSearchState('loading');
  window.helm.songSources.fromUrl(url.trim()).then(
    (r) => {
      if (searchSeq.current !== mySeq) return;
      if ('candidate' in r) { pick(r.candidate); setSearchState('done'); }
      else setSearchState(r.error === 'network' ? 'error' : 'url-error');
    },
    () => { if (searchSeq.current === mySeq) setSearchState('error'); }
  );
};

const runSearch = (q: string): void => {
  const trimmed = q.trim();
  if (!trimmed) return;
  if (isUrl(trimmed)) { runUrl(trimmed); return; }
  const mySeq = ++searchSeq.current;
  setSearchState('loading');
  window.helm.songSources.search(trimmed).then(
    (r) => {
      if (searchSeq.current !== mySeq) return;
      if ('error' in r) { setSearchState('error'); return; }
      setResults(r.candidates);
      setHighlighted(0);
      setSearchState(r.candidates.length === 0 ? 'empty' : 'done');
    },
    () => { if (searchSeq.current === mySeq) setSearchState('error'); }
  );
};

const openSearchTab = (): void => {
  setTab('search');
  // Eager: arriving from the rail chip with a title in play, results should be waiting.
  if (searchState === 'idle' && query.trim() && !isUrl(query)) runSearch(query);
};

const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
  if (e.key === 'Enter') {
    if (searchState === 'done' && results[highlighted] && !isUrl(query)) pick(results[highlighted]);
    else runSearch(query);
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    setHighlighted((h) => Math.min(h + 1, results.length - 1));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    setHighlighted((h) => Math.max(h - 1, 0));
  }
};
```

**Save** — extend Task 7's input construction so web-sourced songs are tagged:

```ts
const input: NewSongInput = { title: title.trim() || 'Untitled Song', text };
if (author.trim()) input.author = author.trim();
if (fromWeb) input.source = 'web';
```

**Preview source** — replace the `slides` memo:

```ts
const previewText = tab === 'search' ? (results[highlighted]?.text ?? '') : text;
const slides = useMemo(() => splitToSlides(previewText), [previewText]);
```

**Tab buttons** — replace the two `<button>`s in `tabsWrapStyle`:

```tsx
<button style={qaTab(tab === 'search', false)} onClick={openSearchTab}>
  Search online
</button>
<button style={qaTab(tab === 'paste', false)} onClick={() => setTab('paste')}>
  Paste lyrics
</button>
```

**Subtitle** — replace the static helper line under the header:

```tsx
<div style={{ fontSize: '13px', color: T.dim, margin: '6px 0 14px', lineHeight: 1.4 }}>
  {tab === 'search'
    ? 'Search the web for lyrics, or paste a lyrics-page URL. You review before anything is saved.'
    : 'Leave a blank line between each verse or chorus. Helm splits and labels them automatically.'}
</div>
```

**Left column** — wrap the existing title-row + textarea in `{tab === 'paste' && (…)}` and add the search column beside it (same flex container):

```tsx
{tab === 'paste' ? (
  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px', padding: '18px 20px', borderRight: `1px solid ${T.hairline}` }}>
    {/* existing title/author row and textarea, unchanged */}
  </div>
) : (
  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px', padding: '18px 20px', borderRight: `1px solid ${T.hairline}` }}>
    <input
      style={titleStyle}
      autoFocus
      value={query}
      onChange={(e) => { setQuery(e.target.value); setSearchState('idle'); }}
      onKeyDown={onSearchKey}
      placeholder="Search by title and artist, or paste a lyrics-page URL"
    />
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {searchState === 'loading' && <div style={{ fontSize: '13px', color: T.dim, padding: '8px 2px' }}>Searching…</div>}
      {searchState === 'empty' && (
        <div style={{ fontSize: '13px', color: T.dim, padding: '8px 2px' }}>No matches — paste lyrics or try a URL.</div>
      )}
      {searchState === 'url-error' && (
        <div style={{ fontSize: '13px', color: T.live, padding: '8px 2px' }}>
          Couldn&rsquo;t read lyrics from that page — copy them and use Paste lyrics.
        </div>
      )}
      {searchState === 'error' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 2px' }}>
          <div style={{ fontSize: '13px', color: T.live }}>Couldn&rsquo;t reach the lyrics service — try again.</div>
          <button
            style={{ height: '28px', padding: '0 12px', borderRadius: '8px', background: T.panel2, boxShadow: `inset 0 0 0 1px ${T.border}`, fontSize: '12.5px', color: T.dim }}
            onClick={() => runSearch(query)}
          >
            Retry
          </button>
        </div>
      )}
      {(searchState === 'done' || searchState === 'idle') &&
        results.map((c, i) => (
          <button
            key={`${c.title}-${c.author}-${i}`}
            style={{
              textAlign: 'left',
              padding: '10px 12px',
              borderRadius: '10px',
              background: i === highlighted ? `${T.accent}22` : T.panel2,
              boxShadow: `inset 0 0 0 1px ${i === highlighted ? T.accent : T.hairline}`,
              display: 'flex',
              flexDirection: 'column',
              gap: '3px',
            }}
            onMouseEnter={() => setHighlighted(i)}
            onClick={() => pick(c)}
          >
            <div style={{ fontSize: '14px', fontWeight: 600, color: T.text }}>{c.title}</div>
            <div style={{ fontSize: '12px', color: T.dim }}>
              {c.author}
              {c.album ? ` · ${c.album}` : ''}
              {c.duration != null ? ` · ${fmtDur(c.duration)}` : ''}
              {` · ${stanzaCount(c.text)} stanzas`}
            </div>
          </button>
        ))}
    </div>
  </div>
)}
```

**Helpers** — module-level, above the component:

```ts
const fmtDur = (d: number): string =>
  `${Math.floor(d / 60)}:${String(Math.floor(d % 60)).padStart(2, '0')}`;

const stanzaCount = (t: string): number =>
  t.split(/\n\s*\n/).filter((s) => s.trim()).length;
```

**Preview panel label** — when on the search tab with no results yet, the preview shows 0 slides; that is fine and needs no special casing.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/operator/QuickAdd.test.tsx`
Expected: PASS (all prior + 8 new).

- [ ] **Step 5: Full verification**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/operator/QuickAdd.tsx src/renderer/operator/QuickAdd.test.tsx
git commit -m "feat(songs): Search online tab — LRCLIB search, URL import, live preview"
```

---

### Task 9: Real-app smoke test

**Files:**
- None committed (manual verification; scratch driver optional).

**Interfaces:** n/a — verifies the whole feature against the live LRCLIB API in the running app.

- [ ] **Step 1: Launch the app**

Run: `npm run dev` (or use the project's `/run` skill flow if driving programmatically).

- [ ] **Step 2: Verify the search path**

Songs mode → type `goodness of god bethel` in the rail search → click the `+ Add …` chip → click **Search online**. Expect: results already loading; studio-length versions ranked above any livestream rip; arrowing/hovering results updates the slide preview; the preview shows a `Chorus`-labeled stanza.

- [ ] **Step 3: Verify the pick path**

Pick the top result. Expect: Paste lyrics tab active, title `Goodness of God`-ish, author `Bethel Music`-ish, lyrics with a `Chorus` label, sane stanzas in the preview. Save. Expect: song appears in the rail, searchable immediately, sections labeled (Verse 1, Chorus, …).

- [ ] **Step 4: Verify the URL path**

Reopen QuickAdd → Search online → paste a Genius song URL → Enter. Expect: editor filled with fully labeled sections (Verse 1 / Chorus / Bridge from Genius's own headers). Also paste a non-lyrics URL (e.g. `https://example.com`) and expect the page-error copy.

- [ ] **Step 5: Verify failure isolation**

Disconnect network → run a search → expect the network error copy with Retry, modal state intact, no crash, nothing touched in the library.

- [ ] **Step 6: Record outcome**

If any step fails, fix before closing the feature (systematic-debugging skill). When all pass, the feature is done — proceed to the finishing-a-development-branch skill.
