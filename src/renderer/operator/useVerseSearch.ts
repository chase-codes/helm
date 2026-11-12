import { useMemo, useState } from 'react';
import { formatRef, type ParsedRef } from '../../shared/scripture/refs';
import { matchPassages, type Passage } from '../../shared/scripture/passages';
import type { VerseHit, VerseSearchResult } from '../../shared/types';
import { SEARCH_VERSE_ROWS, type PassageResultRow, type VerseResultRow } from './ScriptureSearchResults';
import { useDebouncedSearch } from './useDebouncedSearch';

export interface VerseSearch {
  /** True once a reply for THIS query in THIS translation has landed (see below). */
  settled: boolean;
  passageHits: Passage[];
  verseHits: VerseHit[];
  /** The full match count, deliberately not capped to the rows shown. */
  verseTotal: number;
  /** Rows in the combined list: passages first, then verses. */
  resultCount: number;
  /** The highlighted row, clamped to the list. */
  hi: number;
  setHighlighted: (i: number) => void;
  /** The reference row `i` stands for, or null past the end of the list. */
  resultRef: (i: number) => ParsedRef | null;
  /** The two row lists, shaped for ScriptureSearchResults. */
  rows: { passages: PassageResultRow[]; verses: VerseResultRow[] };
}

/**
 * The scripture entry's text search: stories and passages matched locally, verses through
 * main. One hook so every scripture entry searches the same way: the Scripture track
 * (SermonMode) and the pre-service card editor both call it, which is what keeps a word
 * typed in either place finding the same verses in the same order.
 *
 * `query` is null whenever the entry is not a text search (refBuilder `search` stage).
 */
export function useVerseSearch(query: string | null, primaryVersion: string | null): VerseSearch {
  // Results carry the query they were fetched for so a slow round-trip can't label stale
  // hits under a newer query.
  const [verseRes, setVerseRes] = useState<{ q: string; res: VerseSearchResult } | null>(null);
  // Highlight is keyed by the query it was set for, so a new query reads as 0 without a
  // reset effect (the repo's lint rejects set-state-in-effect) and a shrinking list is
  // clamped below on the same render.
  const [hiState, setHiState] = useState<{ q: string | null; i: number }>({ q: null, i: 0 });

  // Keystrokes are debounced (#15); a translation change re-searches at once.
  useDebouncedSearch(primaryVersion ? query : null, primaryVersion, (q, stillWanted) => {
    const versionId = primaryVersion as string;
    void window.helm.bibles
      .search(q, versionId)
      .then((res) => {
        if (stillWanted()) setVerseRes({ q, res });
      })
      .catch((err: unknown) => {
        console.error(err);
        if (stillWanted()) setVerseRes({ q, res: { hits: [], total: 0, versionId } });
      });
  });

  // `settled` = the reply on screen answers THIS query in THIS translation. Until it does,
  // the rail is still waiting: the empty state must not render (see ScriptureSearchResults),
  // because between a keystroke and the IPC reply there is nothing to be empty ABOUT.
  const settled =
    query !== null &&
    // Nothing to wait for: with no primary version the search effect never runs, so the
    // INSTALL_HINT empty state is the settled answer and should show at once.
    (!primaryVersion ||
      (verseRes !== null && verseRes.q === query && verseRes.res.versionId === primaryVersion));
  // What the rail SHOWS: the last reply for this translation, even when a newer query is
  // already in flight. Holding the previous query's hits for a frame reads as a list
  // catching up; blanking to "0 VERSES · No verses match" and refilling on every keystroke
  // reads as the search breaking (SongsMode holds its rows the same way). Still gated on
  // the translation: switching the primary version would otherwise sit the old
  // translation's hits under the new abbr in the header.
  const shown =
    query !== null && verseRes && verseRes.res.versionId === primaryVersion ? verseRes.res : null;
  // Memoised on the query: the host re-renders on every hover and cursor move while the
  // results are up, and the story table is several hundred entries to score.
  const passageHits: Passage[] = useMemo(() => (query !== null ? matchPassages(query) : []), [query]);
  // Capped to the rows the rail actually RENDERS. Main returns up to 50; the keyboard
  // index, `+ Add` and the visible list have to be one list, or ArrowDown walks past the
  // last row on screen and `+ Add` names a hit nobody can see. The header's `total` is the
  // full match count and is deliberately not capped.
  const verseHits: VerseHit[] = shown ? shown.hits.slice(0, SEARCH_VERSE_ROWS) : [];
  const verseTotal = shown ? shown.total : 0;
  const resultCount = passageHits.length + verseHits.length;
  const highlighted = hiState.q === query ? hiState.i : 0;
  const hi = resultCount ? Math.min(highlighted, resultCount - 1) : 0;
  const setHighlighted = (i: number): void => setHiState({ q: query, i });

  // The reference a picked result stands for (passages first, then verses).
  const resultRef = (i: number): ParsedRef | null => {
    if (i < passageHits.length) {
      const p = passageHits[i];
      return { book: p.book, ch: p.ch, from: p.from, to: p.to };
    }
    const v = verseHits[i - passageHits.length];
    return v ? { book: v.book, ch: v.chapter, from: v.verse, to: v.verse } : null;
  };

  const rows = {
    passages: passageHits.map((p) => ({
      // Title AND reference: one story lists once per account (the resurrection is
      // four rows), and two stories can open on the same verse.
      key: `p:${p.title}:${p.book}:${p.ch}:${p.from}`,
      title: p.title,
      meta: formatRef({ book: p.book, ch: p.ch, from: p.from, to: p.to })
    })),
    verses: verseHits.map((v) => ({
      key: `v:${v.book}:${v.chapter}:${v.verse}`,
      ref: formatRef({ book: v.book, ch: v.chapter, from: v.verse, to: v.verse }),
      text: v.text,
      near: v.near
    }))
  };

  return { settled, passageHits, verseHits, verseTotal, resultCount, hi, setHighlighted, resultRef, rows };
}
