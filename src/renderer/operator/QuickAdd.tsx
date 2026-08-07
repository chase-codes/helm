import { useContext, useMemo, useRef, useState, type CSSProperties, type JSX, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { ThemeCtx } from './ThemeCtx';
import { splitToSlides } from '../../shared/songs/splitToSlides';
import type { NewSongInput, Song, SongWebCandidate } from '../../shared/types';

export interface QuickAddProps {
  open: boolean;
  /** Prefill for the title field (e.g. the rail's search query). When non-blank,
   *  initial focus lands in the lyrics textarea instead of the title input. */
  initialTitle?: string;
  onClose: () => void;
  onSaved: (song: Song) => void;
}

const fmtDur = (d: number): string =>
  `${Math.floor(d / 60)}:${String(Math.floor(d % 60)).padStart(2, '0')}`;

const stanzaLabel = (t: string): string => {
  const n = t.split(/\n\s*\n/).filter((s) => s.trim()).length;
  return `${n} ${n === 1 ? 'stanza' : 'stanzas'}`;
};

type QaTab = 'search' | 'paste';

export function QuickAdd({ open, initialTitle, onClose, onSaved }: QuickAddProps): JSX.Element | null {
  const T = useContext(ThemeCtx);
  // The parent only mounts this component while `open` is true, so a fresh
  // mount (and therefore fresh field state) happens on every open.
  const prefilled = !!initialTitle?.trim();
  const [title, setTitle] = useState(initialTitle?.trim() ?? '');
  const [author, setAuthor] = useState('');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [tab, setTab] = useState<QaTab>('paste');
  const [query, setQuery] = useState(initialTitle?.trim() ?? '');
  const [results, setResults] = useState<SongWebCandidate[]>([]);
  const [highlighted, setHighlighted] = useState(0);
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'empty' | 'error' | 'url-error' | 'done'>('idle');
  const [fromWeb, setFromWeb] = useState(false);
  const searchSeq = useRef(0);

  // Escape is handled by App's global keydown delegate (Task 12), which asks the active
  // mode's ModeKeyHandler.onEscape() to close any open modal — SongsMode owns
  // `quickAddOpen`/`setQuickAddOpen(false)` for that. No local listener here: a second
  // one would double-handle the same keypress (harmless since onClose is idempotent, but
  // redundant), and this component doesn't otherwise need to know about keyboard input.

  const previewText = tab === 'search' ? (results[highlighted]?.text ?? '') : text;
  const slides = useMemo(() => splitToSlides(previewText), [previewText]);

  if (!open) return null;

  const canSave = !!text.trim() && !saving;

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
      setHighlighted((h) => Math.min(h + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    }
  };

  const save = (): void => {
    if (!canSave) return;
    setSaving(true);
    setSaveError(false);
    const input: NewSongInput = { title: title.trim() || 'Untitled Song', text };
    if (author.trim()) input.author = author.trim();
    if (fromWeb) input.source = 'web';
    window.helm.songs.add(input).then(
      (song) => {
        onClose();
        onSaved(song);
      },
      () => {
        // Keep the modal (and the user's text) intact; let them retry.
        setSaving(false);
        setSaveError(true);
      }
    );
  };

  const stop = (e: ReactMouseEvent): void => e.stopPropagation();

  const overlayStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 50,
    background: 'rgba(8,9,12,.6)',
    backdropFilter: 'blur(3px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '5vh 4vw'
  };
  const modalStyle: CSSProperties = {
    width: '860px',
    maxWidth: '96vw',
    maxHeight: '88vh',
    background: T.panel,
    borderRadius: '16px',
    boxShadow: '0 30px 80px rgba(0,0,0,.5)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    border: `1px solid ${T.border}`
  };
  const tabsWrapStyle: CSSProperties = { display: 'flex', gap: '4px', background: T.panel2, padding: '4px', borderRadius: '10px' };
  const qaTab = (active: boolean, disabled: boolean): CSSProperties => ({
    height: '32px',
    padding: '0 14px',
    borderRadius: '8px',
    fontSize: '12.5px',
    fontWeight: active ? 700 : 600,
    color: active ? T.accentInk : T.dim,
    background: active ? T.accent : 'transparent',
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer'
  });
  const titleStyle: CSSProperties = {
    height: '44px',
    padding: '0 14px',
    background: T.inputBg,
    borderRadius: '10px',
    boxShadow: `inset 0 0 0 1px ${T.border}`,
    fontSize: '15px',
    fontWeight: 600,
    color: T.text
  };
  const textStyle: CSSProperties = {
    flex: 1,
    minHeight: '300px',
    padding: '14px',
    background: T.inputBg,
    borderRadius: '10px',
    boxShadow: `inset 0 0 0 1px ${T.border}`,
    fontSize: '14px',
    lineHeight: 1.55,
    color: T.text,
    resize: 'none',
    fontFamily: "'Hanken Grotesk', system-ui"
  };
  const previewPanelStyle: CSSProperties = { width: '320px', flexShrink: 0, display: 'flex', flexDirection: 'column', background: T.appBg };
  const cardStyle: CSSProperties = { background: T.panel2, borderRadius: '10px', padding: '11px 13px', boxShadow: `inset 0 0 0 1px ${T.hairline}` };
  const cancelStyle: CSSProperties = {
    height: '40px',
    padding: '0 18px',
    borderRadius: '10px',
    background: T.panel2,
    boxShadow: `inset 0 0 0 1px ${T.border}`,
    fontSize: '14px',
    color: T.dim
  };
  const saveStyle: CSSProperties = {
    height: '40px',
    padding: '0 20px',
    borderRadius: '10px',
    background: T.accent,
    color: T.accentInk,
    fontWeight: 700,
    fontSize: '14px',
    opacity: canSave ? 1 : 0.5,
    cursor: canSave ? 'pointer' : 'not-allowed'
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={stop}>
        <div style={{ padding: '16px 22px 0', borderBottom: `1px solid ${T.hairline}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ fontWeight: 700, fontSize: '18px', flex: 1 }}>Add a song</div>
            <div style={tabsWrapStyle}>
              <button style={qaTab(tab === 'search', false)} onClick={openSearchTab}>
                Search online
              </button>
              <button
                style={qaTab(tab === 'paste', false)}
                onClick={() => { searchSeq.current++; setTab('paste'); }}
              >
                Paste lyrics
              </button>
            </div>
          </div>
          <div style={{ fontSize: '13px', color: T.dim, margin: '6px 0 14px', lineHeight: 1.4 }}>
            {tab === 'search'
              ? 'Search the web for lyrics, or paste a lyrics-page URL. You review before anything is saved.'
              : 'Leave a blank line between each verse or chorus. Helm splits and labels them automatically.'}
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          {tab === 'paste' ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px', padding: '18px 20px', borderRight: `1px solid ${T.hairline}` }}>
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
              <textarea
                style={textStyle}
                autoFocus={prefilled}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={'Paste lyrics here…\n\nVerse 1\nLine one\nLine two\n\nChorus\nThe chorus'}
              />
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
                        {` · ${stanzaLabel(c.text)}`}
                      </div>
                    </button>
                  ))}
              </div>
            </div>
          )}
          <div style={previewPanelStyle}>
            <div style={{ padding: '14px 18px 10px', fontSize: '12px', letterSpacing: '0.06em', color: T.faint, fontWeight: 600 }}>
              PREVIEW · {slides.length} slides
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {slides.map((s, i) => (
                <div key={i} style={cardStyle}>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: '10px', letterSpacing: '0.06em', color: T.accent, marginBottom: '6px' }}>
                    {s.label}
                  </div>
                  <div style={{ fontSize: '13px', color: T.dim, lineHeight: 1.5, whiteSpace: 'pre-line' }}>{s.lines.join('\n')}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: '10px',
            padding: '15px 22px',
            borderTop: `1px solid ${T.hairline}`
          }}
        >
          {saveError && <div style={{ fontSize: '13px', color: T.live }}>Couldn&rsquo;t save — try again</div>}
          <button style={cancelStyle} onClick={onClose}>
            Cancel
          </button>
          <button style={saveStyle} onClick={save} disabled={!canSave}>
            Add to library
          </button>
        </div>
      </div>
    </div>
  );
}
