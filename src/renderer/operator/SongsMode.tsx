import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent
} from 'react';
import type { ModeKeyHandlerRef } from './App';
import { ThemeCtx } from './ThemeCtx';
import { usePresentationState } from './useHelm';
import { bandCandidates } from '../../shared/slides/fitText';
import { useFitText, fitSizeValue } from '../shared/useFitText';
import { keyForSong, parseSongKey, sameFlow } from '../../shared/presentation/core';
import { stanzaLabel } from '../../shared/songs/stanza';
import { CANVAS_AMBER } from '../../shared/slideAccents';
import { secondaryLyricRows } from '../../shared/songs/secondaryLyric';
import { chorusJump, labelJump, verseJump } from '../../shared/songs/sectionJump';
import type { ResolvedHotkey } from '../../shared/hotkeys/match';
import type { SearchField, Slide, Song, SongSearchResult, UpdateSongInput } from '../../shared/types';
import { SongSearchRail, type SongRow } from './SongSearchRail';
import type { ContextMenuItem } from './ContextMenu';
import { pickNeighborId } from './pickNeighbor';
import { SectionRail } from './SectionRail';
import { QuickAdd } from './QuickAdd';
import { SongImport } from './SongImport';
import { useContextMenu } from './useContextMenu';
import { usePanelWidth } from './usePanelWidth';
import { useTakeGuard } from './useTakeGuard';
import { PanelDivider } from './PanelDivider';
import { GoLiveIcon, ScreenBlackIcon } from '../shared/icons';
import { primaryBtnStyle, transportGhostBtn, verbDividerStyle } from './transport';

export interface SongsModeProps {
  keyHandlerRef: ModeKeyHandlerRef;
  active: boolean;
}

// The hero doubles as the confidence monitor for rooms that mirror the operator screen
// up front, so it renders lyrics under the projector's contract: one authored line = one
// visual line (nowrap), auto-fitted as large as the box allows. Same band as LeaderView —
// hoisted for stable identity in useFitText's deps (see SlideCanvas's bands).
const HERO_BAND = bandCandidates(10.5, 3.5);
/** Hero lyric font-size formula, exported for the same reason as SLIDE_HERO_WIDTH:
 * jsdom's cssstyle drops declarations with container-query units, so the test pins the
 * formula here instead of through the DOM. */
export const HERO_LINE_FONT = `max(14px, ${fitSizeValue('7.4cqmin')})`;

const RAIL_COLLAPSED_KEY = 'helmSectionRailCollapsed';

const LIST_W_DEFAULT = 250;
const LIST_W_MIN = 200;
const LIST_W_MAX = 360;
const SECTION_W_DEFAULT = 380;
const SECTION_W_MIN = 260;
const SECTION_W_MAX = 620;
const SECONDARY_TITLE_MAX = 3;
const SECONDARY_LIMIT = 3;
// How long "Remove — sure?" stays armed before lapsing back. Same value Settings uses for
// uninstalling a bible, because it is the same gesture — see onSongContextMenu.
const REMOVE_CONFIRM_MS = 4000;
// The confirm re-labels in place, so the second half of a double-click lands on "Remove —
// sure?" at the very coordinates the first half armed it — arming and confirming in one
// gesture, which is exactly what the two-step exists to prevent. Clicks this soon after
// arming are the tail of that double-click, not a decision, so they are ignored.
const CONFIRM_ARM_GUARD_MS = 350;

// Shared by the cue effect, goLive, and jumpSection — all three build the identical
// lyrics-slide literal for a song section, so a change to the shape only has one place to go.
function slideFor(song: Song, section: { label: string; lines: string[] }): Slide {
  return {
    kind: 'lyrics',
    accent: CANVAS_AMBER,
    label: `${song.title} · ${section.label}`,
    lines: section.lines,
    sectionLabel: section.label,
    ...(song.key ? { songKey: song.key } : {})
  };
}

function toRow(song: Song, snippet: string, activeSongId: string | null, armedId: string | null = null): SongRow {
  return {
    id: song.id,
    title: song.title,
    author: `${song.author} · ${stanzaLabel(song.sections.length)}`,
    snippet,
    hasSnippet: !!snippet,
    isActive: song.id === activeSongId,
    isArmed: song.id === armedId
  };
}

export function SongsMode({ keyHandlerRef, active }: SongsModeProps): JSX.Element {
  const T = useContext(ThemeCtx);
  const { output, liveKey } = usePresentationState();
  // Staleness guard for the double-click take that resolves a song first (#58).
  const beginTake = useTakeGuard(output);
  const contextMenu = useContextMenu();

  const [q, setQ] = useState('');
  const [field, setField] = useState<SearchField>('all');
  const [results, setResults] = useState<SongSearchResult[]>([]);
  const [lyricHint, setLyricHint] = useState<SongSearchResult[]>([]);
  const [library, setLibrary] = useState<Song[]>([]);
  const [activeSongId, setActiveSongId] = useState<string | null>(null);
  const [section, setSection] = useState(0);
  const [armedNextId, setArmedNextId] = useState<string | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddTitle, setQuickAddTitle] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importInFlight, setImportInFlight] = useState(false);
  const [editingSection, setEditingSection] = useState<number | null>(null);
  const [editError, setEditError] = useState(false);
  const listPanel = usePanelWidth('helmSongListW', { def: LIST_W_DEFAULT, min: LIST_W_MIN, max: LIST_W_MAX, anchor: 'left' });
  const sectionPanel = usePanelWidth('helmSectionPanelW', { def: SECTION_W_DEFAULT, min: SECTION_W_MIN, max: SECTION_W_MAX, anchor: 'right' });
  // Collapsing the rail hands its width to the hero — and since the fitted lyric size is
  // width-bound for nearly every section, that width converts directly into font size.
  // Meant for rooms that mirror the operator screen as the confidence monitor.
  const [railCollapsed, setRailCollapsed] = useState(() => {
    try {
      return localStorage.getItem(RAIL_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const setRailCollapsedPersisted = (v: boolean): void => {
    setRailCollapsed(v);
    try {
      localStorage.setItem(RAIL_COLLAPSED_KEY, v ? '1' : '0');
    } catch {
      // localStorage unavailable — the choice just won't persist.
    }
  };

  // Cancellation guard for refreshLibrary's setState calls: reused by both the initial-load
  // effect below and SongImport's onImported callback, so it can't live as a per-call `let
  // live = true` the way the search effects do — it has to survive across calls for the life
  // of the component instead, guarding against a response landing after unmount.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshLibrary = useCallback((selectFirst: boolean): Promise<void> => {
    return window.helm.songs
      .list()
      .then((songs) => {
        if (!mountedRef.current) return;
        setLibrary(songs);
        if (selectFirst && songs.length) {
          setActiveSongId(songs[0].id);
          setSection(0);
        }
      })
      .catch(console.error);
  }, []);

  // Initial load: fetch the library and select the first song (seed order = Amazing Grace).
  useEffect(() => {
    void refreshLibrary(true);
  }, [refreshLibrary]);

  // Runs after an import commits: refreshLibrary alone only updates `library`, but
  // displayedRows reads `results` instead whenever a query is typed, and `results` is
  // otherwise only repopulated by the [q, field] effect below on the next keystroke. Without
  // re-running the active search here too, a query typed before the import finishes keeps
  // showing the pre-import result set — none of the just-imported songs are findable until
  // the operator types again.
  const onImportCompleted = useCallback((): void => {
    void refreshLibrary(false);
    const query = q.trim();
    if (!query) return;
    void window.helm.songs
      .search(query, field)
      .then((r) => {
        if (mountedRef.current) setResults(r);
      })
      .catch(console.error);
  }, [refreshLibrary, q, field]);

  // Re-query on every keystroke / field change. Empty query shows the library instead
  // (displayedRows only reads `results` when the query is non-empty, so no reset needed).
  useEffect(() => {
    if (!q.trim()) return;
    let live = true;
    void window.helm.songs.search(q, field).then((r) => {
      if (live) setResults(r);
    }).catch(console.error);
    return () => {
      live = false;
    };
  }, [q, field]);

  // In Title mode only, run a parallel lyric-scored pass so a thin title search can show a
  // subordinate "Also in lyrics" hint (see secondaryLyricRows). Outside Title mode the result
  // is never consumed (secondaryResults below is gated on field === 'title'), so there's no
  // need to clear it here — which also keeps this a plain fetch effect with no synchronous
  // setState in its body.
  useEffect(() => {
    if (field !== 'title' || !q.trim()) return;
    let live = true;
    void window.helm.songs
      .search(q, 'lyric')
      .then((r) => {
        if (live) setLyricHint(r);
      })
      .catch(console.error);
    return () => {
      live = false;
    };
  }, [q, field]);

  const activeSong = library.find((s) => s.id === activeSongId) ?? null;
  const clampedSection = activeSong ? Math.max(0, Math.min(section, activeSong.sections.length - 1)) : 0;
  const currentSectionObj = activeSong ? activeSong.sections[clampedSection] : undefined;

  // Tracks clampedSection for onSongSaved's re-cue (see saveSection below): a save's
  // window.helm.songs.update round-trip can outlast the operator moving the cue, so the
  // resolve handler must read where they are NOW rather than the section captured at
  // the keypress render. Refs may only be written outside of render (react-hooks/refs),
  // so this syncs via effect rather than during the render body.
  const sectionRef = useRef(clampedSection);
  useEffect(() => {
    sectionRef.current = clampedSection;
  }, [clampedSection]);

  // Live lock (spec §1): while a song is live, the center is bound to it and list clicks
  // arm instead of selecting. parseSongKey is null for scripture/media keys, so a
  // cross-kind live screen leaves the Songs list in its normal select-to-cue behavior.
  const liveParsed = parseSongKey(liveKey);
  const locked = output === 'live' && liveParsed !== null;
  const armed = locked && armedNextId ? (library.find((s) => s.id === armedNextId) ?? null) : null;

  // Cue on every song/section change.
  useEffect(() => {
    if (!activeSong || !currentSectionObj) return;
    const key = keyForSong(activeSong.id, clampedSection);
    const slide = slideFor(activeSong, currentSectionObj);
    window.helm.presentation.cue(key, slide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSong?.id, clampedSection]);

  // Set when a switch commits, cleared once the broadcast confirms the new live key — the
  // reconciling effect below must not snap the selection back to the OLD live song in the
  // gap between our goLive() send and the state broadcast returning.
  const pendingSwitchRef = useRef<string | null>(null);

  // Center lock reconciliation (spec §1): while locked, the selection must equal the live
  // song. Divergence is either the commit transient (latched above — skip until the
  // broadcast catches up) or an external live change; reselect the live song for the
  // latter. A live song missing from the library (deleted while live) falls back to
  // unlocked behavior untouched.
  //
  // Unlike the two blocks below, this one stays a real effect: it has to read/write
  // `pendingSwitchRef`, and refs may only be touched outside of render (react-hooks/refs)
  // — an effect body is exactly that. The reconciling setState calls are then deferred
  // into a timeout rather than called inline in the effect body, since a same-tick
  // setState there is exactly the render-cascade shape react-hooks/set-state-in-effect
  // flags (see SermonMode.tsx's scripture-lookup effect for the same deferral).
  useEffect(() => {
    if (!locked || !liveParsed) {
      pendingSwitchRef.current = null;
      return;
    }
    if (pendingSwitchRef.current) {
      if (liveParsed.songId === pendingSwitchRef.current) pendingSwitchRef.current = null;
      return;
    }
    if (activeSongId === liveParsed.songId) return;
    if (!library.some((s) => s.id === liveParsed.songId)) return;
    const songId = liveParsed.songId;
    const sectionIdx = liveParsed.section;
    const t = setTimeout(() => {
      setActiveSongId(songId);
      setSection(sectionIdx);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, liveParsed?.songId, liveParsed?.section, activeSongId, library]);

  // Cross-kind takeover (scripture/media grabs the screen while a song was live): the song
  // flow the arm was staged for is over — plain disarm, selection untouched (spec §1).
  // Same render-time-adjustment shape as above (guarded, idempotent).
  if (!locked && output === 'live' && armedNextId !== null) {
    setArmedNextId(null);
  }

  // Take-down converts the arm to the selection (spec §1): arm mid-song, take down at the
  // song's end, and the next song is staged in the hero — and, via the cue effect, on the
  // leader (which follows the cue while output is down). `prevOutput` mirrors the previous
  // render's output (same render-time-adjustment shape as above) so every take-down path
  // (button, Escape, logo toggle) converts identically, exactly once per live→non-live
  // transition.
  const [prevOutput, setPrevOutput] = useState(output);
  if (output !== prevOutput) {
    const wasLive = prevOutput === 'live';
    setPrevOutput(output);
    if (wasLive && output !== 'live' && armedNextId) {
      const armedSongNow = library.find((s) => s.id === armedNextId) ?? null;
      setArmedNextId(null);
      if (armedSongNow) {
        setActiveSongId(armedSongNow.id);
        setSection(0);
      }
    }
  }

  // A quick-edit in flight belongs to ONE song; if the selection moves (arrow keys,
  // live-lock reconciliation, switch commit), the editor must not survive onto the
  // next song's section at the same index. Same render-time-adjustment shape as
  // `prevOutput` above.
  const [editingSongId, setEditingSongId] = useState(activeSongId);
  if (editingSongId !== activeSongId) {
    setEditingSongId(activeSongId);
    if (editingSection !== null) setEditingSection(null);
    if (editError) setEditError(false);
  }

  const selectSong = (id: string): void => {
    if (locked && liveParsed) {
      if (id === liveParsed.songId) {
        // Clicking the live song's row: back to base — disarm and make sure the center
        // really is on the live song (it always should be; belt and suspenders).
        setArmedNextId(null);
        if (activeSongId !== id) {
          setActiveSongId(id);
          setSection(liveParsed.section);
        }
        return;
      }
      // Toggle off on the armed row, arm on any other row. Arming is silent: no selection
      // change, no cue, no screen traffic — Enter or the Switch button commits.
      setArmedNextId((cur) => (cur === id ? null : id));
      return;
    }
    setActiveSongId(id);
    setSection(0);
  };

  // Double-click a search result (#58). `selectSong` ARMS when another song is live —
  // the operator's usual "queue this next" gesture. A double-click says take it now, so
  // it bypasses arming entirely and commits section 0. Resolves out of `library` (the
  // full Song list loaded at mount); the `songs.get` fallback covers a result whose song
  // is somehow not in it, so a double-click is never silently dropped.
  const activateSong = (id: string): void => {
    // Claim the take BEFORE branching, cached path included: that is what cancels an
    // earlier double-click still waiting on its own `songs.get` (see useTakeGuard). The
    // guard subsumes the mountedRef check this used to make — unmount cancels too.
    const wanted = beginTake();
    const known = library.find((s) => s.id === id);
    if (known) {
      takeSectionLive(known, 0);
      return;
    }
    void window.helm.songs
      .get(id)
      .then((s) => {
        if (s && wanted()) takeSectionLive(s, 0);
      })
      .catch(console.error);
  };

  // One post-save path for both editors (spec §4): refresh the library row, keep an
  // active search honest, and re-cue so the leader — and, via applyCue's same-flow
  // swap, a live projector — shows the corrected text. cue, never goLive: goLive on
  // the already-live key means take-down.
  const onSongSaved = (song: Song): void => {
    setLibrary((prev) => prev.map((s) => (s.id === song.id ? song : s)));
    const query = q.trim();
    if (query) {
      void window.helm.songs.search(query, field).then((r) => {
        if (mountedRef.current) setResults(r);
      }).catch(console.error);
      if (field === 'title') {
        void window.helm.songs.search(query, 'lyric').then((r) => {
          if (mountedRef.current) setLyricHint(r);
        }).catch(console.error);
      }
    }
    if (song.id === activeSongId && song.sections.length) {
      // Read the live ref, not the closed-over clampedSection: the save this callback
      // resolves for may have been in flight while the operator moved the cue.
      const idx = Math.max(0, Math.min(sectionRef.current, song.sections.length - 1));
      window.helm.presentation.cue(keyForSong(song.id, idx), slideFor(song, song.sections[idx]));
    }
  };

  const onSectionContextMenu = (i: number, e: ReactMouseEvent): void => {
    // Clear the song-remove confirm timer here too, not just in onSongContextMenu:
    // `contextMenu.update` rewrites WHICHEVER menu is open, so a timer left running from a
    // song row would, four seconds later, silently turn this section menu into the song
    // menu — its Edit would open the song editor and a destructive item would appear
    // unprompted over a control the operator never right-clicked.
    clearConfirmTimer();
    contextMenu.open(e, [
      { label: 'Edit', onSelect: () => { setEditError(false); setEditingSection(i); } }
    ]);
  };

  // Guards against a second Enter firing a duplicate update while the first
  // songs:update round-trip is still in flight.
  const savingSectionRef = useRef(false);

  const saveSection = (i: number, rawLines: string[]): void => {
    if (savingSectionRef.current) return;
    const song = activeSong;
    const prev = song?.sections[i];
    if (!song || !prev) {
      setEditingSection(null);
      return;
    }
    const lines = rawLines.map((l) => l.trim()).filter(Boolean);
    // Blank or unchanged drafts cancel — no half-saved state, no empty sections.
    if (!lines.length || lines.join('\n') === prev.lines.join('\n')) {
      setEditingSection(null);
      return;
    }
    const sections = song.sections.map((s, j) => (j === i ? { ...s, lines } : s));
    const input: UpdateSongInput = { title: song.title, sections };
    if (song.author) input.author = song.author;
    if (song.key) input.key = song.key;
    savingSectionRef.current = true;
    window.helm.songs.update(song.id, input).then(
      (saved) => {
        savingSectionRef.current = false;
        setEditingSection(null);
        setEditError(false);
        onSongSaved(saved);
      },
      () => {
        savingSectionRef.current = false;
        setEditError(true);
      }
    );
  };

  const [editModalSongId, setEditModalSongId] = useState<string | null>(null);
  const editTarget = editModalSongId ? (library.find((s) => s.id === editModalSongId) ?? null) : null;

  const onEditSong = (id: string): void => setEditModalSongId(id);

  // The song library is the one list in the app that CONFIRMS rather than undoing (#90).
  // The rule from #86 is "in-service surfaces never confirm, they undo" — but a schedule is
  // this Sunday's plan and the library is every Sunday's, so removing from it is a
  // Settings-shaped act of library management that happens to live on an in-service page.
  // It therefore borrows Settings' two-step "Remove — sure?", and deliberately does NOT
  // answer the Delete key or offer multi-select: no single keystroke may take a song out
  // of the library.
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // False until the arm-guard elapses. A timer rather than comparing clock readings:
  // reading the clock from a function the compiler cannot prove is event-only counts as an
  // impure call during render.
  const confirmArmedRef = useRef(false);
  const armGuardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearConfirmTimer = (): void => {
    if (confirmTimerRef.current !== null) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
    if (armGuardTimerRef.current !== null) {
      clearTimeout(armGuardTimerRef.current);
      armGuardTimerRef.current = null;
    }
    confirmArmedRef.current = false;
  };
  useEffect(() => clearConfirmTimer, []);

  const removeSong = (id: string): void => {
    clearConfirmTimer();
    window.helm.songs
      .remove(id)
      .then((songs) => {
        if (!mountedRef.current) return;
        setLibrary(songs);
        // An active query holds its own copy of the row; drop it there too, or the song
        // stays clickable until the next keystroke re-runs the search.
        setResults((r) => r.filter((x) => x.song.id !== id));
        setLyricHint((r) => r.filter((x) => x.song.id !== id));
        if (armedNextId === id) setArmedNextId(null);
        if (activeSongId === id) {
          // `library` here is the pre-removal list, which is what pickNeighborId needs to
          // work out which row took its place.
          const next = pickNeighborId(library, [id]);
          setActiveSongId(next || null);
          setSection(0);
        }
      })
      .catch(console.error);
  };

  // Rebuilt rather than toggled through state: the menu captures its items when it opens,
  // so re-labelling means handing it a fresh array via `update`.
  const songMenuItems = (id: string, armed: boolean): ContextMenuItem[] => {
    // Refuse to remove the song the congregation is currently reading. `sameFlow` would
    // keep its lyrics on the projector with no library row behind them, and the center
    // stays live-locked against a song that no longer exists — a state nothing else in
    // this mode can produce. Taking the screen down first costs one click and clears both.
    const isLiveSong = output === 'live' && liveParsed?.songId === id;
    const removeItem: ContextMenuItem = isLiveSong
      ? { label: 'On screen — take it down first', disabled: true, onSelect: () => {} }
      : {
          label: armed ? 'Remove — sure?' : 'Remove from library',
          danger: true,
          // Always keepOpen, closing by hand only once the removal actually commits. The
          // arming click obviously has to leave the menu up — the confirmation belongs
          // under the cursor already there. But so does a click the arm-guard swallows:
          // closing on one would leave a double-clicking operator with a shut menu,
          // nothing deleted, and no sign of why. A swallowed click leaves "Remove —
          // sure?" there to be pressed deliberately.
          keepOpen: true,
          onSelect: () => {
            if (!armed) {
              armRemove(id);
              return;
            }
            if (!confirmArmedRef.current) return;
            contextMenu.close();
            removeSong(id);
          }
        };
    return [{ label: 'Edit', onSelect: () => onEditSong(id) }, removeItem];
  };

  const armRemove = (id: string): void => {
    clearConfirmTimer();
    contextMenu.update(songMenuItems(id, true));
    armGuardTimerRef.current = setTimeout(() => {
      armGuardTimerRef.current = null;
      confirmArmedRef.current = true;
    }, CONFIRM_ARM_GUARD_MS);
    confirmTimerRef.current = setTimeout(() => {
      confirmTimerRef.current = null;
      contextMenu.update(songMenuItems(id, false));
    }, REMOVE_CONFIRM_MS);
  };

  // Opening any menu disarms a confirm left armed on another row, so a lapsing timer can
  // never re-label the menu the operator is looking at now.
  const onSongContextMenu = (id: string, e: ReactMouseEvent): void => {
    clearConfirmTimer();
    contextMenu.open(e, songMenuItems(id, false));
  };

  const onQuickAddSaved = (song: Song): void => {
    setLibrary((prev) => [...prev, song]);
    selectSong(song.id);
  };

  const hasQuery = !!q.trim();
  const displayedRows: SongRow[] = hasQuery
    ? results.slice(0, 9).map((r) => toRow(r.song, r.snippet, activeSongId, armed?.id ?? null))
    : library.map((s) => toRow(s, '', activeSongId, armed?.id ?? null));
  const noResults = hasQuery && results.length === 0;
  const secondaryResults =
    field === 'title' && hasQuery ? secondaryLyricRows(results, lyricHint, SECONDARY_TITLE_MAX, SECONDARY_LIMIT) : [];
  const secondaryRows: SongRow[] = secondaryResults.map((r) => toRow(r.song, r.snippet, activeSongId));

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (displayedRows.length) selectSong(displayedRows[0].id);
    } else if (e.key === 'Escape') {
      // One key, one action: a non-empty query consumes the press (clear only); the next
      // press falls through to the global escape chain (disarm → blur → take down).
      if (q) {
        e.stopPropagation();
        setQ('');
      }
    }
  };

  const curKey = activeSong ? keyForSong(activeSong.id, clampedSection) : null;
  // `sameFlow`, not key equality: within the live song the cue effect hot-updates the
  // screen (main's `applyCue` follows same-flow keys), so a section change leaves the verb
  // nothing to do — not one broadcast round-trip later. Key equality here made the button
  // flash green for the gap between the cue send and the liveKey broadcast returning.
  const cuedIsLive = output === 'live' && sameFlow(liveKey, curKey);

  // Auto-fit the hero lyric to its box (LeaderView's mechanism). Width changes — window
  // resize, panel drags, rail collapse — re-measure via useFitText's ResizeObserver, so
  // the deps only need to cover content identity: which section, and its lines
  // (currentSectionObj is a fresh object after a save).
  const heroFitRef = useRef<HTMLDivElement | null>(null);
  const heroContentRef = useRef<HTMLDivElement | null>(null);
  useFitText(heroFitRef, heroContentRef, currentSectionObj ? HERO_BAND : null, [
    activeSong?.id,
    clampedSection,
    currentSectionObj
  ]);

  // The primary verb only ever means "put this on screen" (#85). When the cued section is
  // already the one up there it has nothing left to do, so it stops here rather than
  // reaching main's `goLive` — which reads a repeat of the live key as a take-down. The
  // button ghosts in the same state, and Enter, its keyboard twin, lands here and stops.
  const goLive = (): void => {
    if (!activeSong || !currentSectionObj || !curKey || cuedIsLive) return;
    window.helm.presentation.goLive(curKey, slideFor(activeSong, currentSectionObj));
  };

  const commitSwitch = (): void => {
    if (!armed || !armed.sections.length) {
      setArmedNextId(null);
      return;
    }
    if (liveParsed?.songId === armed.id || pendingSwitchRef.current === armed.id) {
      // Divergence-window hole: the armed song can already BE the live song if it was
      // re-armed after a prior commitSwitch's goLive() send but before that broadcast's
      // liveKey landed (selection already moved, reconciliation not yet caught up — see
      // pendingSwitchRef above). goLive on an already-live key means "take down" in main,
      // so just disarm here instead of re-sending it; the reconciliation effect has
      // already (or is about to) put the selection on this song. The pendingSwitchRef arm
      // covers the same divergence window one round trip earlier: a re-arm + re-commit
      // before the broadcast even lands, when liveParsed is still stale.
      setArmedNextId(null);
      if (activeSongId !== armed.id) {
        setActiveSongId(armed.id);
        setSection(0);
      }
      return;
    }
    pendingSwitchRef.current = armed.id;
    window.helm.presentation.goLive(keyForSong(armed.id, 0), slideFor(armed, armed.sections[0]));
    setActiveSongId(armed.id);
    setSection(0);
    setArmedNextId(null);
  };

  const takeDown = (): void => {
    window.helm.presentation.setOutput('black');
  };

  const step = (dir: number): void => {
    if (!activeSong) return;
    const n = activeSong.sections.length;
    setSection((s) => Math.max(0, Math.min(n - 1, s + dir)));
  };

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Section-jump hotkeys (chorus/bridge/tag/verse-N). The jump always moves the
  // selection; the projector follows ONLY when this song is already live — then the
  // target section goes live in the same keypress. On logo/black, or when a different
  // song is live, it's a quiet cue (the cue effect above fires off the section change).
  const jumpSection = (idx: number | null): void => {
    if (idx === null || !activeSong) return;
    const target = activeSong.sections[idx];
    if (!target) return;
    setSection(idx);
    const liveSong = liveParsed;
    const key = keyForSong(activeSong.id, idx);
    // liveKey !== key: goLive on the already-live key means "take down" in main — a
    // no-op jump must not black the screen.
    if (output === 'live' && liveSong?.songId === activeSong.id && liveKey !== key) {
      window.helm.presentation.goLive(key, slideFor(activeSong, target));
    }
  };

  // Double-click a section card (#58). Unlike `jumpSection` — which only follows a
  // projector already showing THIS song — a double-click is a deliberate takeover and
  // starts projecting from black or from another flow. `take` is idempotent, so
  // double-clicking the section already on screen is a no-op, not a take-down.
  //
  // Latches `pendingSwitchRef` before the send for exactly the reason `commitSwitch` does:
  // this moves the selection to `song` in the same commit that asks main for the screen,
  // but `liveParsed` still names the OLD song until the broadcast lands. Without the latch
  // the reconciliation effect above sees that divergence, reads it as an external live
  // change, and its 0ms timer — which always beats the round trip — snaps the selection
  // back to the previous song, re-cueing it onto the leader while the new song is what's
  // actually live.
  const takeSectionLive = (song: Song, idx: number): void => {
    const target = song.sections[idx];
    if (!target) return;
    pendingSwitchRef.current = song.id;
    setActiveSongId(song.id);
    setSection(idx);
    setArmedNextId(null);
    window.helm.presentation.take(keyForSong(song.id, idx), slideFor(song, target));
  };

  const activateSection = (i: number): void => {
    if (activeSong) takeSectionLive(activeSong, i);
  };

  const onAction = (a: ResolvedHotkey): void => {
    if (a.id === 'focus.search') {
      searchInputRef.current?.focus();
      return;
    }
    if (a.id === 'field.clear') {
      setQ('');
      return;
    }
    if (!activeSong) return;
    if (a.id === 'song.chorus') jumpSection(chorusJump(activeSong.sections, clampedSection));
    else if (a.id === 'song.bridge') jumpSection(labelJump(activeSong.sections, 'bridge'));
    else if (a.id === 'song.tag') jumpSection(labelJump(activeSong.sections, 'tag'));
    else if (a.id === 'song.verse' && a.digit) jumpSection(verseJump(activeSong.sections, a.digit));
  };

  // Register this mode's keyboard delegate on every render so the closure below always
  // sees current state. LAYOUT effect, not a passive one: this ref is an imperative
  // handle that App's document keydown listener reads at dispatch time, so it must be in
  // sync with the commit that is on screen. A passive effect flushes in a later task, and
  // a keypress landing in that window would be answered by the previous render's closure
  // — Escape closing a modal that is already gone, Enter going live on a stale section.
  // (React attaches useImperativeHandle with layout timing for the same reason.)
  //
  // While inactive, skip touching the ref entirely rather than nulling it: App keeps both
  // Songs and Sermon mounted (keep-alive contract), so a mode
  // switch re-runs both modes' effects in the same commit — if the inactive mode's body
  // wrote null unconditionally, it could run *after* the newly-active mode's effect in
  // tree order and clobber the handler it just registered. Deactivation is instead
  // handled by this effect's own cleanup (below), which only fires when this mode was
  // the one that last set the ref.
  useLayoutEffect(() => {
    if (!active) return;
    keyHandlerRef.current = {
      onEscape: () => {
        // QuickAdd takes precedence if somehow both are open — mirrors the fact that
        // only one of these modals can be triggered at a time from the UI today.
        if (quickAddOpen) {
          setQuickAddOpen(false);
          return true;
        }
        if (importOpen) {
          // Swallow Escape rather than falling through while a commit is running — losing
          // the wizard mid-import loses the only record of which songs failed to read (see
          // SongImport's own `dismissible` guard for the overlay/Cancel half of this gate).
          if (importInFlight) return true;
          setImportOpen(false);
          return true;
        }
        if (editModalSongId) {
          setEditModalSongId(null);
          return true;
        }
        // Progressive back-out (spec §3): after modals, undo the most recent intent
        // first — a section quick-edit in flight, then an armed switch — then leave a
        // text field, and only then touch the screen. Order matters: a typing operator
        // must never black the screen with a stray Escape, and cancelling the edit (or
        // disarming) before blur means "undo my in-progress action" always wins.
        if (editingSection !== null) {
          setEditingSection(null);
          setEditError(false);
          return true;
        }
        if (armedNextId) {
          setArmedNextId(null);
          return true;
        }
        const el = document.activeElement as HTMLElement | null;
        const tag = el?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea') {
          el?.blur();
          return true;
        }
        if (output === 'live') {
          window.helm.presentation.setOutput('black');
          return true;
        }
        return false;
      },
      onArrow: step,
      onGoLive: armed ? commitSwitch : goLive,
      isModalOpen: () => quickAddOpen || importOpen || editModalSongId !== null,
      onAction
    };
    return () => {
      keyHandlerRef.current = null;
    };
  });

  const outColor = output === 'black' ? T.dim : output === 'logo' ? T.accent : T.live;
  const projText = output === 'black' ? 'NOTHING ON SCREEN' : output === 'logo' ? 'LOGO ON SCREEN' : 'LIVE ON SCREEN';

  const emptyText = `No match for “${q}”. Try another word, or add it as a new song above.`;

  // ---------------- styles ----------------
  const rootStyle: CSSProperties = { flex: 1, minHeight: 0, display: 'flex', gap: '1px', background: T.hairline };
  const projBarStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    height: '30px',
    padding: '0 13px',
    borderRadius: '9px',
    background: `${outColor}1c`,
    boxShadow: `inset 0 0 0 1px ${outColor}55`,
    color: outColor
  };
  const projDotStyle: CSSProperties = {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: outColor,
    animation: output === 'live' ? 'lecPulse 1.6s ease-in-out infinite' : 'none'
  };
  const bigVerseWrapStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    // hidden, not auto: the fit below guarantees the section fits, and a scrollbar
    // appearing mid-measure would change the box being measured.
    overflow: 'hidden',
    borderRadius: '14px',
    background: T.panel,
    boxShadow: cuedIsLive ? `inset 0 0 0 2px ${T.accent}66` : `inset 0 0 0 1px ${T.hairline}`
  };
  const bigVerseLabelStyle: CSSProperties = {
    flexShrink: 0,
    padding: '18px 24px 0',
    textAlign: 'center',
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: '12px',
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: cuedIsLive ? T.accent : T.dim,
    fontWeight: 500
  };
  // The fit-measurement box (same shape as LeaderView's heroMiddle): containerType for
  // cqmin — useFitText reads/writes FIT_SIZE_VAR in cqmin, which must resolve against
  // this element — and overflow:hidden so "fits" means "visible". Margin, not padding:
  // useFitText compares scrollHeight against clientHeight, and clientHeight includes
  // padding, so padded space would count as room to grow into while not being visible-safe.
  const heroFitStyle: CSSProperties = {
    flex: 1,
    minHeight: 0,
    margin: '12px 24px 20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    containerType: 'size',
    overflow: 'hidden'
  };
  const bigLineStyle: CSSProperties = {
    fontWeight: 700,
    fontSize: HERO_LINE_FONT,
    lineHeight: 1.22,
    letterSpacing: '-0.012em',
    // The projector's contract: one authored line = one visual line. The fit shrinks the
    // text instead of wrapping it, so the leader up front never sees line breaks the
    // congregation doesn't.
    whiteSpace: 'nowrap',
    color: T.text
  };
  // The rail (divider + panel, or the collapsed stub) lives in a width-animated wrapper:
  // collapsing glides the width shut rather than snapping it, and the hero — whose
  // auto-fit re-measures through its ResizeObserver every frame of the transition —
  // scales its lyric smoothly into the freed space. The transition is disabled while the
  // divider is being dragged, where it would lag the cursor.
  const railWrapStyle: CSSProperties = {
    width: railCollapsed ? '30px' : `${sectionPanel.width + 12}px`,
    flexShrink: 0,
    display: 'flex',
    justifyContent: 'flex-end',
    overflow: 'hidden',
    transition: sectionPanel.dragging ? 'none' : 'width 240ms ease'
  };
  // Collapsed-rail stub: a slim strip where the rail was, whose whole surface re-opens
  // it. The hero absorbs the freed width, and — being width-bound — its lyric grows.
  const railStubStyle: CSSProperties = {
    width: '30px',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '10px',
    padding: '14px 0',
    border: 'none',
    borderRadius: '11px',
    background: T.panel2,
    boxShadow: `inset 0 0 0 1px ${T.hairline}`,
    color: T.faint,
    cursor: 'pointer'
  };
  const railStubLabelStyle: CSSProperties = {
    writingMode: 'vertical-rl',
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: '10px',
    letterSpacing: '0.14em',
    fontWeight: 600
  };
  const ghostBtn = transportGhostBtn(T);
  // A switch is always something to put on screen, so an arm re-arms the primary slot even
  // when the cued section is the live one.
  const canGoLive = !!armed || (!!activeSong && !!currentSectionObj && !cuedIsLive);
  const canTakeDown = output === 'live';
  const goLiveStyle = primaryBtnStyle(T, canGoLive ? 'go' : 'ghost');
  const takeDownStyle = primaryBtnStyle(T, canTakeDown ? 'down' : 'ghost');
  return (
    <div style={rootStyle}>
      <SongSearchRail
        theme={T}
        width={listPanel.width}
        q={q}
        setQ={setQ}
        field={field}
        setField={setField}
        rows={displayedRows}
        secondaryRows={secondaryRows}
        noResults={noResults}
        emptyText={emptyText}
        onKeyDown={onInputKeyDown}
        onSelect={selectSong}
        onActivate={activateSong}
        onAddSong={() => {
          setQuickAddTitle(q.trim());
          setQuickAddOpen(true);
        }}
        onImportSongs={() => setImportOpen(true)}
        libraryEmpty={library.length === 0}
        locked={locked}
        onRowContextMenu={onSongContextMenu}
        inputRef={searchInputRef}
      />

      <PanelDivider active={listPanel.dragging} onMouseDown={listPanel.startDrag} background={T.appBg} />

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: '16px 10px 16px 12px', background: T.appBg }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '14px', flexShrink: 0 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: '25px', letterSpacing: '-0.015em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {activeSong?.title ?? ''}
            </div>
            <div style={{ fontSize: '13px', color: T.dim, marginTop: '2px' }}>{activeSong?.author ?? ''}</div>
          </div>
          <div style={projBarStyle}>
            <span style={projDotStyle} />
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: '11.5px', letterSpacing: '0.06em' }}>{projText}</span>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: '2px' }}>
          <div style={bigVerseWrapStyle}>
            <div style={bigVerseLabelStyle}>{currentSectionObj?.label ? `NOW SINGING · ${currentSectionObj.label}` : ''}</div>
            <div ref={heroFitRef} style={heroFitStyle} data-testid="song-hero">
              <div
                ref={heroContentRef}
                style={{ display: 'flex', flexDirection: 'column', gap: '0.8em', width: '100%', textAlign: 'center' }}
              >
                {(currentSectionObj?.lines ?? []).map((ln, i) => (
                  <div key={i} style={bigLineStyle}>
                    {ln}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={railWrapStyle} data-testid="rail-wrap">
            {railCollapsed ? (
              <button
                style={railStubStyle}
                title="Show sections"
                onClick={() => setRailCollapsedPersisted(false)}
              >
                <span aria-hidden>«</span>
                <span style={railStubLabelStyle}>SECTIONS</span>
              </button>
            ) : (
              <>
                <PanelDivider
                  active={sectionPanel.dragging}
                  onMouseDown={sectionPanel.startDrag}
                  hit={12}
                  title="Drag to resize — lyric text scales with the panel"
                />

                <SectionRail
                  theme={T}
                  width={sectionPanel.width}
                  sections={activeSong?.sections ?? []}
                  cuedIndex={clampedSection}
                  isSectionLive={(i) => (activeSong ? output === 'live' && liveKey === keyForSong(activeSong.id, i) : false)}
                  onSelect={setSection}
                  onActivate={activateSection}
                  editingIndex={editingSection}
                  editError={editError}
                  onSectionContextMenu={onSectionContextMenu}
                  onEditSave={saveSection}
                  onEditCancel={() => { setEditingSection(null); setEditError(false); }}
                  onCollapse={() => setRailCollapsedPersisted(true)}
                />
              </>
            )}
          </div>
        </div>

        {/* Fixed slots (#85). Take down is always here — the panic control cannot move, or
            arrive only once something is armed — and the primary slot never takes on its
            meaning. The armed song's title rides in the tooltip rather than the label,
            because a label that names a song makes the bar's width a function of the song
            library; the rail's gold NEXT badge already says which song is queued. */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '14px', flexShrink: 0 }} data-transport-bar>
          <button style={ghostBtn} onClick={() => step(-1)}>
            ‹ Prev
          </button>
          <button style={ghostBtn} onClick={() => step(1)}>
            Cue next ›
          </button>
          <div style={{ flex: 1 }} />
          <button
            style={takeDownStyle}
            onClick={takeDown}
            disabled={!canTakeDown}
            title={canTakeDown ? 'Clear the audience screen' : 'Nothing on screen'}
          >
            <ScreenBlackIcon size={14} /> Take down
          </button>
          <div style={verbDividerStyle(T)} />
          <button
            style={goLiveStyle}
            onClick={armed ? commitSwitch : goLive}
            disabled={!canGoLive}
            title={armed ? `Switch to ${armed.title}` : cuedIsLive ? 'Already on screen' : undefined}
          >
            {armed ? '⇄ Switch' : (
              <>
                <GoLiveIcon size={14} /> Go live
              </>
            )}
          </button>
        </div>
      </div>

      {contextMenu.menu}
      {quickAddOpen && (
        <QuickAdd open={quickAddOpen} initialTitle={quickAddTitle} onClose={() => setQuickAddOpen(false)} onSaved={onQuickAddSaved} />
      )}
      {editTarget && (
        <QuickAdd
          open
          editSong={editTarget}
          onClose={() => setEditModalSongId(null)}
          onSaved={(song) => {
            setEditModalSongId(null);
            onSongSaved(song);
          }}
        />
      )}
      {importOpen && (
        <SongImport
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onImported={onImportCompleted}
          onImportingChange={setImportInFlight}
        />
      )}
    </div>
  );
}
