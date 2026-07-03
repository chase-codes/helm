import { useContext, useEffect, useState, type CSSProperties, type JSX, type KeyboardEvent } from 'react';
import { ThemeCtx, type ThemeMode } from './App';
import { usePresentationState } from './useHelm';
import { keyForSong } from '../../shared/presentation/core';
import type { SearchField, Slide, Song, SongSearchResult } from '../../shared/types';
import { SongSearchRail, type SongRow } from './SongSearchRail';
import { SectionRail } from './SectionRail';
import { QuickAdd } from './QuickAdd';

export interface SongsModeProps {
  themeMode: ThemeMode;
}

const SEARCH_RAIL_W = 250;
const SECTION_RAIL_W = 380;

function toRow(song: Song, snippet: string, activeSongId: string | null): SongRow {
  const sectionCount = song.sections.length;
  return {
    id: song.id,
    title: song.title,
    author: `${song.author} · ${sectionCount}${sectionCount === 1 ? ' section' : ' sections'}`,
    snippet,
    hasSnippet: !!snippet,
    isActive: song.id === activeSongId
  };
}

export function SongsMode({ themeMode }: SongsModeProps): JSX.Element {
  const T = useContext(ThemeCtx);
  const dark = themeMode === 'dark';
  const { output, liveKey } = usePresentationState();

  const [q, setQ] = useState('');
  const [field, setField] = useState<SearchField>('all');
  const [results, setResults] = useState<SongSearchResult[]>([]);
  const [library, setLibrary] = useState<Song[]>([]);
  const [activeSongId, setActiveSongId] = useState<string | null>(null);
  const [section, setSection] = useState(0);
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  // Initial load: fetch the library and select the first song (seed order = Amazing Grace).
  useEffect(() => {
    let live = true;
    void window.helm.songs.list().then((songs) => {
      if (!live) return;
      setLibrary(songs);
      if (songs.length) {
        setActiveSongId(songs[0].id);
        setSection(0);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  // Re-query on every keystroke / field change. Empty query shows the library instead
  // (displayedRows only reads `results` when the query is non-empty, so no reset needed).
  useEffect(() => {
    if (!q.trim()) return;
    let live = true;
    void window.helm.songs.search(q, field).then((r) => {
      if (live) setResults(r);
    });
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

  const onQuickAddSaved = (song: Song): void => {
    setLibrary((prev) => [song, ...prev]);
    selectSong(song.id);
  };

  const hasQuery = !!q.trim();
  const displayedRows: SongRow[] = hasQuery
    ? results.slice(0, 9).map((r) => toRow(r.song, r.snippet, activeSongId))
    : library.map((s) => toRow(s, '', activeSongId));
  const noResults = hasQuery && results.length === 0;

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
  const gripStyle: CSSProperties = { width: '3px', height: '44px', borderRadius: '2px', background: T.border };

  return (
    <div style={rootStyle}>
      <SongSearchRail
        theme={T}
        dark={dark}
        width={SEARCH_RAIL_W}
        q={q}
        setQ={setQ}
        field={field}
        setField={setField}
        rows={displayedRows}
        noResults={noResults}
        emptyText={emptyText}
        onKeyDown={onInputKeyDown}
        onSelect={selectSong}
        onAddSong={() => setQuickAddOpen(true)}
      />

      <div style={{ ...dividerStyle(10), background: T.appBg }} title="Drag to resize">
        <div style={gripStyle} />
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

          <div style={dividerStyle(12)} title="Drag to resize — lyric text scales with the panel">
            <div style={gripStyle} />
          </div>

          <SectionRail
            theme={T}
            dark={dark}
            width={SECTION_RAIL_W}
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

      {quickAddOpen && <QuickAdd open={quickAddOpen} onClose={() => setQuickAddOpen(false)} onSaved={onQuickAddSaved} />}
    </div>
  );
}
