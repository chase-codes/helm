import { useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type JSX, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import type { ModeKeyHandlerRef, ThemeMode } from './App';
import { ThemeCtx } from './ThemeCtx';
import { usePresentationState } from './useHelm';
import { keyForSong } from '../../shared/presentation/core';
import { stanzaLabel } from '../../shared/songs/stanza';
import { secondaryLyricRows } from '../../shared/songs/secondaryLyric';
import type { SearchField, Slide, Song, SongSearchResult } from '../../shared/types';
import { SongSearchRail, type SongRow } from './SongSearchRail';
import { SectionRail } from './SectionRail';
import { QuickAdd } from './QuickAdd';
import { SongImport } from './SongImport';
import { useContextMenu } from './useContextMenu';

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

type DragTarget = 'list' | 'sections' | null;

/** Loads a persisted panel width; falls back to `fallback` when missing/invalid (parses to NaN). */
function loadWidth(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const v = parseFloat(raw);
    return Number.isFinite(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function toRow(song: Song, snippet: string, activeSongId: string | null): SongRow {
  return {
    id: song.id,
    title: song.title,
    author: `${song.author} · ${stanzaLabel(song.sections.length)}`,
    snippet,
    hasSnippet: !!snippet,
    isActive: song.id === activeSongId
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
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [listW, setListW] = useState(() => loadWidth('helmSongListW', LIST_W_DEFAULT));
  const [sectionW, setSectionW] = useState(() => loadWidth('helmSectionPanelW', SECTION_W_DEFAULT));
  const [dragging, setDragging] = useState<DragTarget>(null);

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

  // Cue on every song/section change.
  useEffect(() => {
    if (!activeSong || !currentSectionObj) return;
    const key = keyForSong(activeSong.id, clampedSection);
    const slide: Slide = {
      kind: 'lyrics',
      accent: '#e0a341',
      label: `${activeSong.title} · ${currentSectionObj.label}`,
      lines: currentSectionObj.lines
    };
    window.helm.presentation.cue(key, slide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSong?.id, clampedSection]);

  const selectSong = (id: string): void => {
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
    ? results.slice(0, 9).map((r) => toRow(r.song, r.snippet, activeSongId))
    : library.map((s) => toRow(s, '', activeSongId));
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
    const slide: Slide = {
      kind: 'lyrics',
      accent: '#e0a341',
      label: `${activeSong.title} · ${currentSectionObj.label}`,
      lines: currentSectionObj.lines
    };
    window.helm.presentation.goLive(curKey, slide);
  };

  const toggleLogo = (): void => {
    window.helm.presentation.setOutput(output === 'logo' ? 'live' : 'logo');
  };

  const step = (dir: number): void => {
    if (!activeSong) return;
    const n = activeSong.sections.length;
    setSection((s) => Math.max(0, Math.min(n - 1, s + dir)));
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
          setImportOpen(false);
          return true;
        }
        return false;
      },
      onArrow: step,
      onGoLive: goLive,
      isModalOpen: () => quickAddOpen || importOpen
    };
    return () => {
      keyHandlerRef.current = null;
    };
  });

  // Holds the active drag's teardown (remove window listeners, reset body cursor/
  // userSelect). Set by startColDrag, cleared when the drag ends; the unmount effect
  // below invokes it if SongsMode unmounts mid-drag so no dangling listeners or a stuck
  // col-resize cursor survive the component.
  const dragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
    };
  }, []);

  // Drag-resize for the two column dividers (list <-> hero, hero <-> sections). Mirrors
  // the prototype's startColDrag: mousemove/mouseup on window, body cursor + userSelect
  // suppressed while dragging, persisted to localStorage on release. Note the section
  // panel's drag direction is inverted (startW - dx) since it's anchored to the right edge.
  const startColDrag = (which: Exclude<DragTarget, null>, e: ReactMouseEvent): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = which === 'list' ? listW : sectionW;
    let latest = startW;
    const onMove = (ev: MouseEvent): void => {
      const dx = ev.clientX - startX;
      if (which === 'list') {
        latest = Math.max(LIST_W_MIN, Math.min(LIST_W_MAX, startW + dx));
        setListW(latest);
      } else {
        latest = Math.max(SECTION_W_MIN, Math.min(SECTION_W_MAX, startW - dx));
        setSectionW(latest);
      }
    };
    const cleanup = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      dragCleanupRef.current = null;
    };
    const onUp = (): void => {
      cleanup();
      setDragging(null);
      // Persist only on a real mouseup — an unmount-aborted drag skips this (the width
      // state it was mutating is being torn down anyway).
      try {
        localStorage.setItem(which === 'list' ? 'helmSongListW' : 'helmSectionPanelW', String(latest));
      } catch {
        // localStorage unavailable (e.g. private mode) — width just won't persist.
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    dragCleanupRef.current = cleanup;
    setDragging(which);
  };

  const outColor = output === 'black' ? T.dim : output === 'logo' ? T.accent : T.live;
  const projText = output === 'black' ? 'NOTHING ON SCREEN' : output === 'logo' ? 'LOGO ON SCREEN' : 'LIVE ON SCREEN';

  const emptyText = `No match for “${q}”. Try another word, or paste it as a new song below.`;

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
    background: cuedIsLive ? T.live : '#2f9e5b',
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
  const dividerStyle = (w: number): CSSProperties => ({
    width: `${w}px`,
    flexShrink: 0,
    cursor: 'col-resize',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '6px'
  });
  // Defensive clamp at render time (mirrors the prototype), in case a persisted value
  // is outside the current bounds (e.g. edited by hand in devtools).
  const listWClamped = Math.max(LIST_W_MIN, Math.min(LIST_W_MAX, listW));
  const sectionWClamped = Math.max(SECTION_W_MIN, Math.min(SECTION_W_MAX, sectionW));

  const gripStyle = (which: Exclude<DragTarget, null>): CSSProperties => ({
    width: '3px',
    height: '44px',
    borderRadius: '2px',
    background: dragging === which ? T.accent : T.border
  });

  return (
    <div style={rootStyle}>
      <SongSearchRail
        theme={T}
        dark={dark}
        width={listWClamped}
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
        onAddSong={() => setQuickAddOpen(true)}
        onImportSongs={() => setImportOpen(true)}
        onRowContextMenu={(id, e) =>
          contextMenu.open(e, [{ label: 'Edit', onSelect: () => onEditSong(id) }])
        }
      />

      <div style={{ ...dividerStyle(10), background: T.appBg }} title="Drag to resize" onMouseDown={(e) => startColDrag('list', e)}>
        <div style={gripStyle('list')} />
      </div>

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

          <div
            style={dividerStyle(12)}
            title="Drag to resize — lyric text scales with the panel"
            onMouseDown={(e) => startColDrag('sections', e)}
          >
            <div style={gripStyle('sections')} />
          </div>

          <SectionRail
            theme={T}
            dark={dark}
            width={sectionWClamped}
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
          <button style={goLiveStyle} onClick={goLive}>
            {cuedIsLive ? '■ Take down' : '● Go live'}
          </button>
          <button style={logoBtnStyle} onClick={toggleLogo}>
            {output === 'logo' ? 'Logo on screen' : 'Logo'}
          </button>
        </div>
      </div>

      {contextMenu.menu}
      {quickAddOpen && <QuickAdd open={quickAddOpen} onClose={() => setQuickAddOpen(false)} onSaved={onQuickAddSaved} />}
      {importOpen && (
        <SongImport
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onImported={() => void refreshLibrary(false)}
        />
      )}
    </div>
  );
}
