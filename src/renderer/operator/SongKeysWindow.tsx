import {
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX
} from 'react';
import type { Theme } from '../../shared/theme';
import type { MusicKeyCounts, MusicKeyRow, MusicKeyTab, Song } from '../../shared/types';
import type { MusicKey, MusicKeySource } from '../../shared/songs/musicKey';
import { ThemeCtx } from './ThemeCtx';
import { ModalShell } from './ModalShell';
import { KeyPicker } from './KeyPicker';
import { ListEmpty } from './ListEmpty';
import { UndoToast } from './UndoToast';
import { PanelDivider } from './PanelDivider';
import { usePanelWidth } from './usePanelWidth';
import { useTimedUndo } from './useTimedUndo';
import { useDebouncedSearch } from './useDebouncedSearch';
import { useWindowedList } from '../shared/useWindowedList';
import { SearchIcon } from '../shared/icons';
import { MONO } from '../shared/fonts';
import { SOURCE_WORDS, progressLine } from './songKeysText';

// The Song keys window (song keys spec, Phase 1c): a library-shaped list on the left, the
// selected song and the key picker on the right, built for 15-minute sessions over a
// ~3,000-song library. Nothing here calls a screen verb (cue, take, goLive): it writes keys.
//
// Keyboard (grammar rule 9): `/` focuses the search, Mod+Backspace clears it, ↑/↓ move
// the selection from anywhere, and letters / b / # / m / Enter drive the picker whenever
// focus is not in the search field (the picker ignores keys typed into a field outside it).
// Escape steps back one layer: the picker's Capo… line, then its typed highlight, then out
// of the search field, then the window closes. It never reaches Take down: the picker stops
// its own presses, this window stops the search field's, and SongsMode closes the window on
// any press that gets past both. Enter in the search field leaves it, and SongsMode counts
// the window as a modal, so Enter never reaches Go live either.

const ROW_H = 50; // incl. the 2px gap: the windowed list is arithmetic on it
const ROW_GAP = 2;
const LIST_W_DEFAULT = 330;
const LIST_W_MIN = 250;
const LIST_W_MAX = 470;

const TABS: { id: MusicKeyTab; label: string }[] = [
  { id: 'none', label: 'No key' },
  { id: 'lately', label: 'Sung lately' },
  { id: 'all', label: 'All' }
];

interface PendingUndo {
  id: string;
  prevKey: string;
  prevSource: MusicKeySource | '';
  prevSkippedAt: number | null;
  message: string;
}

export interface SongKeysWindowProps {
  onClose: () => void;
  /** Every write, as main returned the song: the Songs page patches its rows and hero. */
  onKeySaved: (song: Song) => void;
}

interface KeyRowProps {
  r: MusicKeyRow;
  T: Theme;
  selected: boolean;
  onSelect: (id: string) => void;
}

/** Module scope, not inside the window: a component declared in a render body is a new
 * type every render, so React would remount every row (see SongSearchRail's Row). */
function KeyRow({ r, T, selected, onSelect }: KeyRowProps): JSX.Element {
  const style: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    height: `${ROW_H - ROW_GAP}px`,
    marginBottom: `${ROW_GAP}px`,
    padding: '0 10px',
    boxSizing: 'border-box',
    borderRadius: '10px',
    textAlign: 'left',
    cursor: 'pointer',
    userSelect: 'none',
    background: selected ? T.selBg : 'transparent',
    boxShadow: selected ? `inset 0 0 0 1px ${T.accent}66` : 'none'
  };
  const clip: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
  const legacy = r.keySource === 'legacy';
  return (
    <button style={style} onClick={() => onSelect(r.id)} aria-current={selected || undefined} data-key-row={r.id}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...clip, fontWeight: 600, fontSize: '13px', color: selected ? T.accent : T.text }}>{r.title}</div>
        <div style={{ ...clip, fontSize: '11px', color: T.faint, marginTop: '1px' }}>{r.author}</div>
      </div>
      {/* The key slot, as on the library rail (rule 5): fixed width, empty for no key. A legacy
          value is not a key, so it stays out of the slot and shows as "Was: …" on the right. */}
      <span
        data-key-slot
        style={{ ...clip, width: '34px', flexShrink: 0, fontFamily: MONO, fontSize: '11px', color: T.dim, textAlign: 'right' }}
      >
        {legacy ? '' : r.key}
      </span>
    </button>
  );
}

export function SongKeysWindow({ onClose, onKeySaved }: SongKeysWindowProps): JSX.Element {
  const T = useContext(ThemeCtx);
  const [tab, setTab] = useState<MusicKeyTab>('none');
  const [q, setQ] = useState('');
  // null until the first list lands, so the empty states never flash on open.
  const [rows, setRows] = useState<MusicKeyRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [counts, setCounts] = useState<MusicKeyCounts | null>(null);
  const [detail, setDetail] = useState<{ id: string; lines: string[] } | null>(null);
  const undo = useTimedUndo<PendingUndo>(5000);
  const panel = usePanelWidth('helmSongKeysListW', { def: LIST_W_DEFAULT, min: LIST_W_MIN, max: LIST_W_MAX, anchor: 'left' });
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listElRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);
  // Every list request takes a number; only the latest may land, so a save's refresh and a
  // keystroke's search can never overwrite each other out of order.
  const reqRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadRows = useCallback(
    (query: string, stillWanted: () => boolean = () => true): void => {
      const req = ++reqRef.current;
      window.helm.songs
        .keyList({ tab, q: query })
        .then((r) => {
          if (mountedRef.current && req === reqRef.current && stillWanted()) setRows(r);
        })
        .catch(console.error);
    },
    [tab]
  );
  const loadCounts = useCallback((): void => {
    window.helm.songs
      .keyCounts()
      .then((c) => {
        if (mountedRef.current) setCounts(c);
      })
      .catch(console.error);
  }, []);

  // The list: debounced on typing, immediate on a tab switch (useDebouncedSearch's contract).
  useDebouncedSearch(q, tab, loadRows);
  useEffect(() => {
    loadCounts();
  }, [loadCounts]);
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const selected = rows ? (rows.find((r) => r.id === selectedId) ?? rows[0] ?? null) : null;
  const selectedIndex = selected && rows ? rows.indexOf(selected) : -1;

  // The full song for the selected row only, for its first two lyric lines.
  const selId = selected?.id ?? null;
  useEffect(() => {
    if (!selId) return;
    let live = true;
    window.helm.songs
      .get(selId)
      .then((s) => {
        if (live && s) setDetail({ id: selId, lines: s.sections.flatMap((x) => x.lines).slice(0, 2) });
      })
      .catch(console.error);
    return () => {
      live = false;
    };
  }, [selId]);

  const win = useWindowedList(rows?.length ?? 0, ROW_H);
  const setWinEl = win.setEl;
  const setListEl = useCallback(
    (el: HTMLDivElement | null): void => {
      listElRef.current = el;
      setWinEl(el);
    },
    [setWinEl]
  );
  const ensureVisible = (i: number): void => {
    const el = listElRef.current;
    if (!el) return;
    const top = i * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
  };
  const move = (d: number): void => {
    if (!rows?.length) return;
    const i = Math.max(0, Math.min(rows.length - 1, selectedIndex + d));
    setSelectedId(rows[i].id);
    ensureVisible(i);
  };

  const refresh = (): void => {
    loadRows(q);
    loadCounts();
  };
  // On No key a save or a Skip moves on: the song leaves the list (or drops to its end), so
  // the next one down takes its place, or the one above when it was the last.
  const advancePast = (id: string): void => {
    if (tab !== 'none' || !rows) return;
    const i = rows.findIndex((r) => r.id === id);
    setSelectedId((rows[i + 1] ?? rows[i - 1] ?? null)?.id ?? null);
  };

  const pick = (k: MusicKey | null): void => {
    const row = selected;
    if (!row) return;
    const prev = { key: row.key, source: row.keySource, skippedAt: row.skippedAt };
    advancePast(row.id);
    window.helm.songs.setMusicKey(row.id, k, 'typed').then((song) => {
      onKeySaved(song);
      // Replacing a different key is the one write that can lose something: offer it back.
      if (prev.key && prev.key !== (k ?? '')) {
        undo.arm({
          id: row.id,
          prevKey: prev.key,
          prevSource: prev.source,
          prevSkippedAt: prev.skippedAt,
          message: k ? `Key changed to ${k}` : 'Key cleared'
        });
      }
      if (mountedRef.current) refresh();
    }, console.error);
  };
  const skip = (): void => {
    const row = selected;
    if (!row) return;
    advancePast(row.id);
    window.helm.songs.skipMusicKey(row.id).then(() => {
      if (mountedRef.current) refresh();
    }, console.error);
  };
  const onUndo = (): void => {
    const p = undo.pending;
    if (!p) return;
    undo.cancel();
    window.helm.songs.restoreMusicKey(p.id, p.prevKey, p.prevSource, p.prevSkippedAt).then((song) => {
      onKeySaved(song);
      if (!mountedRef.current) return;
      setSelectedId(p.id);
      refresh();
    }, console.error);
  };

  // The keys this window owns. Capture phase on window, like the picker, so they are handled
  // before the page dispatcher could see them; the picker leaves exactly these to us.
  const hostKeys = useCallback((e: KeyboardEvent): boolean => {
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
    return e.key === '/' || ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && tag !== 'select');
  }, []);
  const onKey = useEffectEvent((e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName?.toLowerCase();
    const inSearch = !!target && target === searchRef.current;
    const own = (): void => {
      e.preventDefault();
      e.stopPropagation();
    };
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'Backspace' || e.key === 'Delete')) {
      own();
      setQ('');
      searchRef.current?.focus();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && tag !== 'select') {
      own();
      move(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (inSearch) {
      // Escape and Enter both leave the field, handing the keyboard to the picker.
      if (e.key === 'Escape' || e.key === 'Enter') {
        own();
        searchRef.current?.blur();
      }
      return;
    }
    if (e.key === '/' && tag !== 'input' && tag !== 'textarea') {
      own();
      searchRef.current?.focus();
    }
  });
  useLayoutEffect(() => {
    const listener = (e: KeyboardEvent): void => onKey(e);
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, []);

  // ---------------- styles ----------------
  const headerStyle: CSSProperties = { padding: '16px 20px 12px', borderBottom: `1px solid ${T.hairline}`, flexShrink: 0 };
  const progressStyle: CSSProperties = {
    height: '18px',
    marginTop: '4px',
    fontSize: '13px',
    color: T.dim,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  };
  const searchBoxStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    height: '36px',
    padding: '0 11px',
    background: T.inputBg,
    borderRadius: '9px',
    boxShadow: `inset 0 0 0 1px ${T.border}`
  };
  const tabWrapStyle: CSSProperties = { display: 'flex', gap: '3px', background: T.panel2, padding: '3px', borderRadius: '9px', marginTop: '8px' };
  const tabStyle = (on: boolean): CSSProperties => ({
    flex: 1,
    minWidth: 0,
    height: '26px',
    borderRadius: '7px',
    fontSize: '11.5px',
    fontWeight: on ? 700 : 600,
    color: on ? T.accentInk : T.faint,
    background: on ? T.accent : 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '5px',
    whiteSpace: 'nowrap'
  });
  const clip: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

  const lines = selected && detail?.id === selected.id ? detail.lines : selected?.firstLine ? [selected.firstLine] : [];
  const source =
    !selected || !selected.key || !selected.keySource
      ? null
      : selected.keySource === 'legacy'
        ? { text: `Was: ${selected.key}`, color: T.dim }
        : { text: SOURCE_WORDS[selected.keySource], color: T.faint };

  const query = q.trim();
  let empty: JSX.Element | null = null;
  if (rows && rows.length === 0) {
    if (counts?.total === 0) {
      empty = (
        <ListEmpty>
          No songs yet. Bring them in with <b>+ Import a song library</b>.
        </ListEmpty>
      );
    } else if (query) {
      empty = <div style={{ padding: '14px 8px', color: T.faint, fontSize: '12.5px', lineHeight: 1.5 }}>No match for “{query}”. Try another word.</div>;
    } else if (tab === 'none') {
      empty = (
        <ListEmpty>
          Every song has a key. Check the ones you sing on <b>Sung lately</b>.
        </ListEmpty>
      );
    } else if (tab === 'lately') {
      empty = <ListEmpty>Songs show up here for eight weeks after they go live.</ListEmpty>;
    }
  }

  return (
    <ModalShell onClose={onClose} width="900px" maxWidth="96vw" height="min(640px, 90vh)">
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ fontWeight: 700, fontSize: '18px', flex: 1 }}>Song keys</div>
          <button style={{ fontSize: '13px', color: T.faint, padding: '4px 6px' }} onClick={onClose} title="Close" aria-label="Close">
            ✕
          </button>
        </div>
        <div style={progressStyle} data-progress-line title={progressLine(counts)}>
          {progressLine(counts)}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ width: `${panel.width}px`, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '12px 12px 8px', flexShrink: 0 }}>
            <div data-field style={searchBoxStyle}>
              <span style={{ display: 'inline-flex', opacity: 0.5 }}>
                <SearchIcon size={15} />
              </span>
              <input
                ref={searchRef}
                style={{ flex: 1, minWidth: 0, fontSize: '13.5px' }}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Title or author…"
                aria-label="Search songs"
              />
              {!!q && (
                <button style={{ fontSize: '12px', color: T.dim, padding: '4px' }} onClick={() => setQ('')} aria-label="Clear search">
                  ✕
                </button>
              )}
            </div>
            <div style={tabWrapStyle} role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  style={tabStyle(tab === t.id)}
                  onClick={() => {
                    setTab(t.id);
                    setSelectedId(null);
                  }}
                >
                  <span style={clip}>{t.label}</span>
                  {t.id === 'none' && counts && (
                    <span data-tab-count style={{ fontFamily: MONO, fontSize: '10.5px', opacity: 0.8 }}>
                      {counts.noKey}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
          <div ref={setListEl} onScroll={win.onScroll} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 8px 8px' }}>
            {empty}
            {rows && rows.length > 0 && (
              <>
                <div style={{ height: `${win.topPad}px` }} />
                {rows.slice(win.start, win.end).map((r) => (
                  <KeyRow key={r.id} r={r} T={T} selected={r.id === selected?.id} onSelect={setSelectedId} />
                ))}
                <div style={{ height: `${win.bottomPad}px` }} />
              </>
            )}
          </div>
        </div>

        <PanelDivider active={panel.dragging} onMouseDown={panel.startDrag} background={T.hairline} hit={6} />

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: '18px 22px 0', background: T.appBg }}>
          {selected && (
            <>
              <div style={{ ...clip, fontWeight: 800, fontSize: '22px', letterSpacing: '-0.01em' }} data-key-song-title>
                {selected.title}
              </div>
              <div style={{ ...clip, height: '18px', marginTop: '2px', fontSize: '13px', color: T.dim }}>{selected.author}</div>
              {/* Two fixed lines, so the picker below never moves with the lyrics (rule 5). */}
              <div style={{ height: '42px', marginTop: '10px', fontSize: '13px', lineHeight: '21px', color: T.dim, fontStyle: 'italic' }} data-key-lyrics>
                {lines.map((l, i) => (
                  <div key={i} style={clip}>
                    {l}
                  </div>
                ))}
              </div>
              <div style={{ ...clip, height: '18px', margin: '8px 0 10px', fontSize: '12px', color: source?.color ?? T.faint }} data-key-source>
                {source?.text ?? ''}
              </div>
              {/* Keyed by song and key: a save on Sung lately or All stays on the song, and the
                  picker starts fresh from the key it now has. */}
              <KeyPicker
                key={`${selected.id}|${selected.key}`}
                value={selected.key}
                onPick={pick}
                onClose={onClose}
                onSkip={skip}
                hostKeys={hostKeys}
                autoFocus={false}
              />
            </>
          )}
          <div style={{ flex: 1 }} />
          <div style={{ height: '52px', flexShrink: 0, margin: '0 -12px' }} data-undo-slot>
            {undo.pending && <UndoToast label="" message={undo.pending.message} onUndo={onUndo} />}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
