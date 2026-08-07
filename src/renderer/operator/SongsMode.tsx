import { useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type JSX, type KeyboardEvent } from 'react';
import type { ModeKeyHandlerRef, ThemeMode } from './App';
import { ThemeCtx } from './ThemeCtx';
import { usePresentationState } from './useHelm';
import { keyForSong, parseSongKey } from '../../shared/presentation/core';
import { stanzaLabel } from '../../shared/songs/stanza';
import { secondaryLyricRows } from '../../shared/songs/secondaryLyric';
import { chorusJump, labelJump, verseJump } from '../../shared/songs/sectionJump';
import type { ResolvedHotkey } from '../../shared/hotkeys/match';
import type { SearchField, Slide, Song, SongSearchResult } from '../../shared/types';
import { SongSearchRail, type SongRow } from './SongSearchRail';
import { SectionRail } from './SectionRail';
import { QuickAdd } from './QuickAdd';
import { SongImport } from './SongImport';
import { useContextMenu } from './useContextMenu';
import { usePanelWidth } from './usePanelWidth';
import { PanelDivider } from './PanelDivider';

export interface SongsModeProps {
  themeMode: ThemeMode;
  keyHandlerRef: ModeKeyHandlerRef;
  active: boolean;
}

const LIST_W_DEFAULT = 250;
const LIST_W_MIN = 200;
const LIST_W_MAX = 360;
const SECTION_W_DEFAULT = 380;
const SECTION_W_MIN = 260;
const SECTION_W_MAX = 620;
const SECONDARY_TITLE_MAX = 3;
const SECONDARY_LIMIT = 3;

// Shared by the cue effect, goLive, and jumpSection — all three build the identical
// lyrics-slide literal for a song section, so a change to the shape only has one place to go.
function slideFor(song: Song, section: { label: string; lines: string[] }): Slide {
  return {
    kind: 'lyrics',
    accent: '#e0a341',
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

export function SongsMode({ themeMode, keyHandlerRef, active }: SongsModeProps): JSX.Element {
  const T = useContext(ThemeCtx);
  const dark = themeMode === 'dark';
  const { output, liveKey } = usePresentationState();
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
  const listPanel = usePanelWidth('helmSongListW', { def: LIST_W_DEFAULT, min: LIST_W_MIN, max: LIST_W_MAX, anchor: 'left' });
  const sectionPanel = usePanelWidth('helmSectionPanelW', { def: SECTION_W_DEFAULT, min: SECTION_W_MIN, max: SECTION_W_MAX, anchor: 'right' });

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

  // Stub for the Songs quick-edit follow-up. The context menu is the deliverable here;
  // this just proves the wiring by surfacing the intent and selecting the row. Replace
  // with the real in-preview quick-edit when that feature lands.
  const onEditSong = (id: string): void => {
    selectSong(id);
    console.info('[songs] quick-edit requested for', id);
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
      setQ('');
    }
  };

  const curKey = activeSong ? keyForSong(activeSong.id, clampedSection) : null;
  const cuedIsLive = output === 'live' && liveKey === curKey;

  const goLive = (): void => {
    if (!activeSong || !currentSectionObj || !curKey) return;
    window.helm.presentation.goLive(curKey, slideFor(activeSong, currentSectionObj));
  };

  const commitSwitch = (): void => {
    if (!armed || !armed.sections.length) {
      setArmedNextId(null);
      return;
    }
    if (liveParsed?.songId === armed.id) {
      // Divergence-window hole: the armed song can already BE the live song if it was
      // re-armed after a prior commitSwitch's goLive() send but before that broadcast's
      // liveKey landed (selection already moved, reconciliation not yet caught up — see
      // pendingSwitchRef above). goLive on an already-live key means "take down" in main,
      // so just disarm here instead of re-sending it; the reconciliation effect has
      // already (or is about to) put the selection on this song.
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

  const toggleLogo = (): void => {
    window.helm.presentation.setOutput(output === 'logo' ? 'live' : 'logo');
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
  // sees current state. While inactive, skip touching the ref entirely rather than
  // nulling it: App keeps both Songs and Sermon mounted (keep-alive contract), so a mode
  // switch re-runs both modes' effects in the same commit — if the inactive mode's body
  // wrote null unconditionally, it could run *after* the newly-active mode's effect in
  // tree order and clobber the handler it just registered. Deactivation is instead
  // handled by this effect's own cleanup (below), which only fires when this mode was
  // the one that last set the ref.
  useEffect(() => {
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
        // Progressive back-out (spec §3): after modals, undo the most recent intent
        // first (an armed switch), then leave a text field, and only then touch the
        // screen. Order matters: a typing operator must never black the screen with a
        // stray Escape, and disarming before blur means "undo my arm" always wins.
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
      isModalOpen: () => quickAddOpen || importOpen,
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
    overflowY: 'auto',
    borderRadius: '14px',
    background: T.panel,
    boxShadow: cuedIsLive ? `inset 0 0 0 2px ${T.accent}66` : `inset 0 0 0 1px ${T.hairline}`
  };
  const bigVerseLabelStyle: CSSProperties = {
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: '12px',
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: cuedIsLive ? T.accent : T.faint,
    fontWeight: 500
  };
  const bigLineStyle: CSSProperties = {
    fontWeight: 700,
    fontSize: 'clamp(20.0px, 2.90vw, 34.0px)',
    lineHeight: 1.3,
    letterSpacing: '-0.012em',
    color: T.text
  };
  const ghostBtn: CSSProperties = {
    height: '46px',
    padding: '0 16px',
    borderRadius: '11px',
    background: T.panel2,
    boxShadow: `inset 0 0 0 1px ${T.hairline}`,
    fontSize: '14px',
    fontWeight: 600,
    color: T.dim,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '7px'
  };
  const goLiveStyle: CSSProperties = {
    height: '46px',
    padding: '0 20px',
    borderRadius: '11px',
    background: !armed && cuedIsLive ? T.live : '#2f9e5b',
    color: '#fff',
    fontSize: '14.5px',
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '7px',
    whiteSpace: 'nowrap'
  };
  const logoBtnStyle: CSSProperties = {
    height: '46px',
    padding: '0 14px',
    borderRadius: '11px',
    background: 'transparent',
    boxShadow: `inset 0 0 0 1px ${output === 'logo' ? T.accent + '66' : T.border}`,
    fontSize: '13px',
    fontWeight: 600,
    color: output === 'logo' ? T.accent : T.dim,
    display: 'flex',
    alignItems: 'center'
  };
  return (
    <div style={rootStyle}>
      <SongSearchRail
        theme={T}
        dark={dark}
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
        onAddSong={() => {
          setQuickAddTitle(q.trim());
          setQuickAddOpen(true);
        }}
        onImportSongs={() => setImportOpen(true)}
        onRowContextMenu={(id, e) =>
          contextMenu.open(e, [{ label: 'Edit', onSelect: () => onEditSong(id) }])
        }
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
            <div style={{ margin: 'auto', width: '100%', maxWidth: '760px', textAlign: 'center', padding: '22px 32px' }}>
              <div style={bigVerseLabelStyle}>{currentSectionObj?.label ? `NOW SINGING · ${currentSectionObj.label}` : ''}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '20px' }}>
                {(currentSectionObj?.lines ?? []).map((ln, i) => (
                  <div key={i} style={bigLineStyle}>
                    {ln}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <PanelDivider
            active={sectionPanel.dragging}
            onMouseDown={sectionPanel.startDrag}
            hit={12}
            title="Drag to resize — lyric text scales with the panel"
          />

          <SectionRail
            theme={T}
            dark={dark}
            width={sectionPanel.width}
            sections={activeSong?.sections ?? []}
            cuedIndex={clampedSection}
            isSectionLive={(i) => (activeSong ? output === 'live' && liveKey === keyForSong(activeSong.id, i) : false)}
            onSelect={setSection}
          />
        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '14px', flexShrink: 0 }}>
          <button style={ghostBtn} onClick={() => step(-1)}>
            ‹ Prev
          </button>
          <button style={ghostBtn} onClick={() => step(1)}>
            Cue next ›
          </button>
          <div style={{ flex: 1 }} />
          {armed && (
            <button style={{ ...goLiveStyle, background: T.live }} onClick={takeDown}>
              ■ Take down
            </button>
          )}
          <button style={goLiveStyle} onClick={armed ? commitSwitch : goLive}>
            {armed ? `⇄ Switch to ${armed.title}` : cuedIsLive ? '■ Take down' : '● Go live'}
          </button>
          <button style={logoBtnStyle} onClick={toggleLogo}>
            {output === 'logo' ? 'Logo on screen' : 'Logo'}
          </button>
        </div>
      </div>

      {contextMenu.menu}
      {quickAddOpen && (
        <QuickAdd open={quickAddOpen} initialTitle={quickAddTitle} onClose={() => setQuickAddOpen(false)} onSaved={onQuickAddSaved} />
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
