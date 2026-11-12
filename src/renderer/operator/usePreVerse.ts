import { useEffect, useState, type KeyboardEvent } from 'react';
import type { BibleManifestEntry, BookExtent, ChapterData, PreCard } from '../../shared/types';
import { formatRef, parseRef, type ParsedRef } from '../../shared/scripture/refs';
import {
  applyKey,
  EMPTY_EXTENT,
  fromParsedRef,
  initialBuilder,
  isSearch,
  reclamp,
  refGhost,
  renderBuilder,
  searchQuery,
  toParsedRef,
  type RefBuilderState,
  type RefGhost
} from '../../shared/scripture/refBuilder';
import { railSelect, type Cursor } from '../../shared/scripture/selection';
import { parseVerseQuery } from '../../shared/search/verseScore';
import { passageText, pickCardBible } from '../../shared/scripture/preVerse';
import type { ScriptureSearchState } from './ScriptureSearchResults';
import { useVerseSearch } from './useVerseSearch';

/** What the picker's lower pane shows, in the order the entry reaches them. */
export type PreVerseView =
  | { kind: 'loading' }
  /** Nothing typed yet: the invitation. */
  | { kind: 'empty' }
  /** A word search: stories and verses, the same list the Scripture track shows. */
  | { kind: 'search'; search: ScriptureSearchState }
  /** A book with no chapter yet: its chapters, to click. */
  | { kind: 'chapters'; book: string; chapters: number }
  /** A chapter open to read and pick from. */
  | {
      kind: 'verses';
      book: string;
      ch: number;
      /** Null while the chapter is on its way. */
      chapter: ChapterData | null;
      failed: boolean;
      chapters: number;
      selected: { from: number; to: number } | null;
    };

export interface PreVerse {
  /** The card's verse fields, as save() files them. */
  ref: string;
  text: string;
  version: string | undefined;
  /** The operator typed in the verse text by hand: it stops being a translation's text. */
  editText: (text: string) => void;
  /** True once the operator has changed anything here. */
  touched: boolean;
  /** The installed Bible verses are filled from; null when none is. Undefined while loading. */
  bible: BibleManifestEntry | null | undefined;
  entry: {
    value: string;
    ghost: RefGhost | null;
    onChange: (v: string) => void;
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  };
  view: PreVerseView;
  /** Why the entry's reference could not be put on the card, or null. */
  problem: string | null;
  pickVerse: (v: number, shift: boolean) => void;
  pickChapter: (ch: number) => void;
}

const chapterKey = (book: string, ch: number): string => `${book}|${ch}`;

/**
 * The verse half of the pre-service card editor: the Scripture track's own entry (the
 * `refBuilder` state machine, its book ghost and `useVerseSearch`) pointed at a card
 * instead of the projector. Typing a reference, clicking a search hit, or clicking verses
 * in the open chapter all end the same way: the card's reference and text are filled from
 * the installed Bible, and the editor's preview shows them at once.
 *
 * Nothing here can reach the audience screen. On the Scripture track the cursor IS the
 * screen while live, which is why its arrows only move a highlight; here a click is free to
 * fill the card, because the card is a draft until it is saved.
 */
export function usePreVerse(card: PreCard | null): PreVerse {
  const initial = card?.type === 'verse' && card.ref ? parseRef(card.ref) : null;
  const [builder, setBuilder] = useState<RefBuilderState>(() => (initial ? fromParsedRef(initial) : initialBuilder()));
  const [ref, setRef] = useState(card?.ref ?? '');
  const [text, setText] = useState(card?.text ?? '');
  const [version, setVersion] = useState<string | undefined>(card?.version);
  const [touched, setTouched] = useState(false);
  // The reference the card's text was last filled for. A saved card opens with its own
  // reference already "applied", so opening the editor never overwrites stored text (it
  // may be hand-edited, or from a Bible since uninstalled). A deliberate pick clears this,
  // which is how clicking a verse again restores its text after a hand edit.
  const [applied, setApplied] = useState<string | null>(initial ? formatRef(initial) : null);
  const [bible, setBible] = useState<BibleManifestEntry | null | undefined>(undefined);
  const [extents, setExtents] = useState<Record<string, BookExtent>>({});
  const [loaded, setLoaded] = useState<{ key: string; data: ChapterData | null } | null>(null);
  const [anchor, setAnchor] = useState<Cursor | null>(null);
  // A search hit the operator clicked to look at. It fills the card without ending the
  // search, so the next hit is one click away. Keyed by its query: typing drops it.
  const [peek, setPeek] = useState<{ q: string; ref: ParsedRef } | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([
      window.helm.bibles.manifest(),
      window.helm.settings.get<string[]>('scriptureVersions', ['kjv'])
    ])
      .then(([manifest, versions]) => {
        if (live) setBible(pickCardBible(manifest, versions));
      })
      .catch((err: unknown) => {
        console.error(err);
        if (live) setBible(null);
      });
    return () => {
      live = false;
    };
  }, []);

  const query = isSearch(builder) ? searchQuery(builder) : null;
  const search = useVerseSearch(query, bible?.id ?? null);
  const peekRef = query !== null && peek?.q === query ? peek.ref : null;

  // What the card should hold: the hit being looked at, else the typed reference once it
  // names a verse. "John 3" alone opens the chapter to pick from and fills nothing.
  const target: ParsedRef | null = peekRef ?? (builder.startVerse !== null ? toParsedRef(builder) : null);
  const openBook = peekRef?.book ?? builder.book;
  const openCh = peekRef?.ch ?? builder.chapter;
  const openKey = openBook !== null && openCh !== null ? chapterKey(openBook, openCh) : null;

  // Same deferred clamp as the Scripture track: digits typed before the book's extent
  // arrives pass through, and `reclamp` applies the bounds when it lands (#17).
  const extentBook = builder.book;
  const extentKnown = extentBook !== null && extents[extentBook] !== undefined;
  useEffect(() => {
    if (extentBook === null || extentKnown) return;
    let live = true;
    void window.helm.bibles
      .bookExtent(extentBook)
      .then((ext) => {
        if (!live) return;
        setExtents((prev) => ({ ...prev, [extentBook]: ext }));
        setBuilder((prev) => (prev.book === extentBook ? reclamp(prev, ext) : prev));
      })
      .catch(console.error);
    return () => {
      live = false;
    };
  }, [extentBook, extentKnown]);

  useEffect(() => {
    if (openBook === null || openCh === null) return;
    let live = true;
    const key = chapterKey(openBook, openCh);
    void window.helm.bibles
      .getChapter(openBook, openCh)
      .then((data) => {
        if (live) setLoaded({ key, data });
      })
      .catch((err: unknown) => {
        console.error(err);
        if (live) setLoaded({ key, data: null });
      });
    return () => {
      live = false;
    };
  }, [openBook, openCh]);

  const chapter = loaded !== null && loaded.key === openKey ? loaded.data : null;
  const failed = loaded !== null && loaded.key === openKey && loaded.data === null;

  // Fill the card the moment the reference, its chapter and the Bible are all in hand.
  // Adjusted during render rather than in an effect: the fill depends on an async chapter
  // arriving as much as on a keystroke, and this is the one place both meet.
  const found = target && chapter && bible ? passageText(chapter, target.from, target.to, bible.id) : null;
  const targetRef = target ? formatRef(target) : null;
  // With no Bible installed there is nothing to look up, but the reference still lands on
  // the card so the text can be typed by hand.
  const ready = targetRef !== null && chapter !== null && bible !== undefined && (found !== null || bible === null);
  if (ready && targetRef !== applied) {
    setApplied(targetRef);
    setRef(targetRef);
    setTouched(true);
    if (found !== null && bible) {
      setText(found);
      setVersion(bible.abbr);
    }
  }

  let problem: string | null = null;
  if (failed) problem = 'Couldn’t reach the Bible. Try again.';
  else if (target && chapter && bible && found === null) {
    problem =
      chapter.verseCount === 0
        ? `${target.book} has no chapter ${target.ch} in ${bible.abbr}`
        : `${target.book} ${target.ch} has no verse ${target.from} in ${bible.abbr}`;
  }

  /** Enter or a double-click on a hit: the entry becomes that reference and its chapter
   * opens around it, exactly as Enter does on the Scripture track. */
  const commitResult = (i: number): void => {
    const p = search.resultRef(i);
    if (!p) return;
    setBuilder(reclamp(fromParsedRef(p), extents[p.book] ?? EMPTY_EXTENT));
    setApplied(null);
  };

  /** A click on a hit: look at it on the card, and keep the results up. */
  const peekResult = (i: number): void => {
    const p = search.resultRef(i);
    if (!p || query === null) return;
    search.setHighlighted(i);
    setPeek({ q: query, ref: p });
    setApplied(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    // Mod and Alt chords belong to the editor (Mod+Enter saves) and the browser (paste,
    // select-all), never to the reference builder.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (query !== null) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (search.resultCount) {
          const next = Math.max(0, Math.min(search.resultCount - 1, search.hi + (e.key === 'ArrowDown' ? 1 : -1)));
          search.setHighlighted(next);
          document.querySelector(`[data-search-row="${next}"]`)?.scrollIntoView?.({ block: 'nearest' });
        }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (search.resultCount) commitResult(search.hi);
        return;
      }
    }
    if (e.key === 'Enter') {
      // Enter on a finished reference re-reads it from the Bible, which is what restores
      // the text after a hand edit. On a half-typed one there is nothing to commit.
      e.preventDefault();
      if (target) setApplied(null);
      return;
    }
    if (e.key === 'Escape') {
      // Each Escape backs out one layer (rule 9): the first clears what was typed and is
      // consumed here, so the page ladder closes the editor only on the next.
      if (renderBuilder(builder) !== '') {
        e.preventDefault();
        e.stopPropagation();
        setBuilder(initialBuilder());
      }
      return;
    }
    const r = applyKey(builder, e.key, e.shiftKey, builder.book ? extents[builder.book] ?? EMPTY_EXTENT : EMPTY_EXTENT);
    if (r.preventDefault) e.preventDefault();
    if (r.state !== builder) setBuilder(r.state);
  };

  // Paste: a whole reference loads structurally, clamped once its book's extent is known.
  const onChange = (v: string): void => {
    if (v.trim() === '') {
      setBuilder(initialBuilder());
      return;
    }
    const p = parseRef(v);
    if (p) setBuilder(reclamp(fromParsedRef(p), extents[p.book] ?? EMPTY_EXTENT));
  };

  const pickVerse = (v: number, shift: boolean): void => {
    if (builder.book === null || builder.chapter === null) return;
    const here = { book: builder.book, ch: builder.chapter };
    setApplied(null);
    if (shift && builder.startVerse !== null) {
      // The Scripture rail's own range rule, so the anchor stays put and a second
      // shift-click re-ranges instead of growing (rule 6, #22).
      const next = railSelect(builder, { ...here, v: builder.startVerse }, here, v, true, anchor);
      const b = next.builder;
      setBuilder(b.startVerse === b.endVerse ? { ...b, stage: 'verse', endVerse: null } : b);
      setAnchor(next.anchor);
      return;
    }
    setBuilder({ ...initialBuilder(), stage: 'verse', book: here.book, chapter: here.ch, startVerse: v });
    setAnchor(null);
  };

  const pickChapter = (ch: number): void => {
    if (builder.book === null) return;
    setBuilder({ ...initialBuilder(), stage: 'chapter', book: builder.book, chapter: ch });
    setAnchor(null);
  };

  let view: PreVerseView;
  if (bible === undefined) view = { kind: 'loading' };
  else if (query !== null) {
    view = {
      kind: 'search',
      search: {
        query,
        tokens: parseVerseQuery(query).tokens,
        abbr: bible?.abbr ?? '',
        total: search.verseTotal,
        passages: search.rows.passages,
        verses: search.rows.verses,
        highlighted: search.hi,
        onHover: (i) => {
          if (i !== null) search.setHighlighted(i);
        },
        onPick: peekResult,
        onActivate: commitResult,
        noVersion: bible === null,
        settled: search.settled
      }
    };
  } else if (builder.book === null) view = { kind: 'empty' };
  else if (builder.chapter === null) {
    view = { kind: 'chapters', book: builder.book, chapters: extents[builder.book]?.chapters ?? 0 };
  } else {
    view = {
      kind: 'verses',
      book: builder.book,
      ch: builder.chapter,
      chapter,
      failed,
      chapters: extents[builder.book]?.chapters ?? 0,
      selected: target ? { from: target.from, to: target.to } : null
    };
  }

  return {
    ref,
    text,
    version,
    editText: (t) => {
      setText(t);
      setVersion(undefined);
      setTouched(true);
    },
    touched,
    bible,
    entry: { value: renderBuilder(builder), ghost: refGhost(builder), onChange, onKeyDown },
    view,
    problem,
    pickVerse,
    pickChapter
  };
}
