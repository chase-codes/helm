import { useContext, useEffect, useRef, useState, type CSSProperties, type JSX, type MouseEvent as ReactMouseEvent } from 'react';
import { ThemeCtx } from './ThemeCtx';
import { MessageImport } from './MessageImport';
import type { BibleInstallProgress, BibleManifestEntry, MessageInstallProgress, MessageMeta } from '../../shared/types';

export interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  // Uninstall has no IPC progress broadcast to piggyback on the way install's
  // downloading/installing/done phases do — App bumps a revision counter it passes to
  // SermonMode so any mounted instance refetches the manifest, without this component
  // reaching into SermonMode directly.
  onBiblesChanged: () => void;
}

const SECTIONS = [
  { id: 'bibles', label: 'Bibles', enabled: true },
  { id: 'displays', label: 'Displays', enabled: false },
  { id: 'songs', label: 'Songs', enabled: false },
  { id: 'message', label: 'Message', enabled: true },
  { id: 'backup', label: 'Backup', enabled: false }
] as const;
type SettingsSection = (typeof SECTIONS)[number]['id'];

const REMOVE_CONFIRM_MS = 4000;

export function SettingsModal({ open, onClose, onBiblesChanged }: SettingsModalProps): JSX.Element | null {
  const T = useContext(ThemeCtx);
  // The parent only mounts this component while `open` is true (matching QuickAdd's
  // pattern), so this is belt-and-suspenders — but keep it since the prop is part of
  // the documented contract.
  const [section, setSection] = useState<SettingsSection>('bibles');
  const [manifest, setManifest] = useState<BibleManifestEntry[]>([]);
  // Per-id transient install state, driven entirely by bibles.onProgress broadcasts —
  // never set optimistically on click, so what's on screen always matches what main
  // actually reported. Cleared for an id once its `done` broadcast has been folded into
  // a fresh manifest fetch; kept on `error` so the message + Retry stay visible.
  const [progress, setProgress] = useState<Record<string, BibleInstallProgress>>({});
  // Two-step remove confirm: first click arms this id for `REMOVE_CONFIRM_MS`, second
  // click (while armed) actually uninstalls. Any other interaction just lets the timer
  // lapse back to the plain Remove button.
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors the mount-effect's local `live` guard below, but exposed via ref so
  // handleRemoveClick's uninstall promise (fired from a click, outside the effect) can
  // check it the same way.
  const liveRef = useRef(true);

  // Message section: unlike bibles (many installable translations, one row each),
  // installCorpus() targets a single corpus — so its progress is one value, not a
  // per-id map. Corpus install talks to the real (deferred-scraper) source and may not
  // succeed until slice 4a; the UI surfaces its error calmly rather than assuming success.
  const [messageCount, setMessageCount] = useState<number | null>(null);
  const [messageProgress, setMessageProgress] = useState<MessageInstallProgress | null>(null);
  const [messageImportOpen, setMessageImportOpen] = useState(false);

  const clearConfirmTimer = (): void => {
    if (confirmTimerRef.current !== null) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
  };

  // Initial manifest fetch and the live progress subscription. Runs once per mount —
  // since the parent conditionally mounts this component on `open`, that's once per
  // open, matching QuickAdd's fresh-state-per-open contract.
  useEffect(() => {
    let live = true;
    void window.helm.bibles
      .manifest()
      .then((m) => {
        if (live) setManifest(m);
      })
      .catch(console.error);
    const offProgress = window.helm.bibles.onProgress((p) => {
      if (!live) return;
      setProgress((prev) => ({ ...prev, [p.id]: p }));
      if (p.phase === 'done') {
        void window.helm.bibles
          .manifest()
          .then((m) => {
            if (!live) return;
            setManifest(m);
            setProgress((prev) => {
              const next = { ...prev };
              delete next[p.id];
              return next;
            });
          })
          .catch(console.error);
      }
    });
    void window.helm.message
      .list()
      .then((list) => {
        if (live) setMessageCount(list.length);
      })
      .catch(console.error);
    const offMessageProgress = window.helm.message.onInstallProgress((p) => {
      if (!live) return;
      setMessageProgress(p);
      if (p.phase === 'done') {
        void window.helm.message
          .list()
          .then((list) => {
            if (live) setMessageCount(list.length);
          })
          .catch(console.error);
      }
    });
    return () => {
      live = false;
      liveRef.current = false;
      offProgress();
      offMessageProgress();
      clearConfirmTimer();
    };
  }, []);

  if (!open) return null;

  const install = (id: string): void => {
    window.helm.bibles.install(id);
  };

  const handleRemoveClick = (id: string): void => {
    if (confirmId === id) {
      clearConfirmTimer();
      setConfirmId(null);
      window.helm.bibles
        .uninstall(id)
        .then((m) => {
          if (liveRef.current) setManifest(m);
          // Uninstall (unlike install) has no IPC progress broadcast to piggyback on —
          // tell App to bump biblesRevision so any mounted SermonMode refetches and
          // drops the id from its compare selection. Fired regardless of this modal's
          // mount state: App/SermonMode outlive it, so the notification should still land
          // even if the modal was closed mid-uninstall.
          onBiblesChanged();
        })
        .catch(console.error);
      return;
    }
    clearConfirmTimer();
    setConfirmId(id);
    confirmTimerRef.current = setTimeout(() => {
      setConfirmId(null);
      confirmTimerRef.current = null;
    }, REMOVE_CONFIRM_MS);
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
    width: '640px',
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
  const bodyStyle: CSSProperties = { flex: 1, minHeight: 0, display: 'flex' };
  const navStyle: CSSProperties = {
    width: '158px',
    flexShrink: 0,
    padding: '14px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    borderRight: `1px solid ${T.hairline}`,
    background: T.panel2
  };
  const navItemStyle = (active: boolean, enabled: boolean): CSSProperties => ({
    height: '34px',
    padding: '0 12px',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: active ? 700 : 600,
    color: !enabled ? T.faint : active ? T.text : T.dim,
    background: active ? T.panel3 : 'transparent',
    opacity: enabled ? 1 : 0.55,
    cursor: enabled ? 'pointer' : 'not-allowed',
    display: 'flex',
    alignItems: 'center'
  });
  const contentStyle: CSSProperties = { flex: 1, minWidth: 0, overflowY: 'auto', padding: '18px 22px' };
  const sectionTitleStyle: CSSProperties = { fontSize: '15px', fontWeight: 700, marginBottom: '4px' };
  const sectionHintStyle: CSSProperties = { fontSize: '12.5px', color: T.dim, lineHeight: 1.4, marginBottom: '16px' };
  const rowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 4px',
    borderBottom: `1px solid ${T.hairline}`
  };
  const abbrChipStyle: CSSProperties = {
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: '11px',
    fontWeight: 600,
    width: '42px',
    flexShrink: 0,
    color: T.dim
  };
  const nameStyle: CSSProperties = { flex: 1, fontSize: '13.5px', fontWeight: 500, color: T.text };
  const bundledTagStyle: CSSProperties = {
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: '9.5px',
    letterSpacing: '0.08em',
    fontWeight: 700,
    color: T.dim,
    background: T.panel3,
    padding: '4px 8px',
    borderRadius: '6px'
  };
  const installedTagStyle: CSSProperties = { fontSize: '12.5px', color: T.dim, whiteSpace: 'nowrap' };
  const pulseDotStyle: CSSProperties = {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    background: T.accent,
    animation: 'lecPulse 1.2s ease-in-out infinite'
  };
  const progressLabelStyle: CSSProperties = { fontSize: '12.5px', color: T.dim };
  const errorLabelStyle: CSSProperties = { fontSize: '12.5px', color: T.live, maxWidth: '220px' };
  const ghostBtnStyle = (armed: boolean): CSSProperties => ({
    height: '30px',
    padding: '0 12px',
    borderRadius: '8px',
    background: T.panel2,
    boxShadow: `inset 0 0 0 1px ${armed ? T.live + '66' : T.border}`,
    fontSize: '12.5px',
    fontWeight: 600,
    color: armed ? T.live : T.dim,
    whiteSpace: 'nowrap'
  });
  const retryBtnStyle: CSSProperties = {
    height: '30px',
    padding: '0 12px',
    borderRadius: '8px',
    background: 'transparent',
    boxShadow: `inset 0 0 0 1px ${T.live}55`,
    fontSize: '12.5px',
    fontWeight: 600,
    color: T.live,
    whiteSpace: 'nowrap'
  };
  const installBtnStyle: CSSProperties = {
    height: '30px',
    padding: '0 14px',
    borderRadius: '8px',
    background: T.accent,
    color: T.accentInk,
    fontWeight: 700,
    fontSize: '12.5px',
    whiteSpace: 'nowrap'
  };
  // Corpus install is deferred to slice 4a (the live scraper is an unverified stub) — the
  // button stays visible for discoverability but disabled/dimmed so it can't be clicked.
  const installBtnDisabledStyle: CSSProperties = {
    ...installBtnStyle,
    background: T.panel3,
    color: T.faint,
    opacity: 0.6,
    cursor: 'not-allowed'
  };
  const footerStyle: CSSProperties = {
    display: 'flex',
    justifyContent: 'flex-end',
    padding: '14px 22px',
    borderTop: `1px solid ${T.hairline}`
  };
  const doneBtnStyle: CSSProperties = {
    height: '38px',
    padding: '0 18px',
    borderRadius: '10px',
    background: T.panel2,
    boxShadow: `inset 0 0 0 1px ${T.border}`,
    fontSize: '13.5px',
    fontWeight: 600,
    color: T.dim
  };

  const installMessageCorpus = (): void => {
    window.helm.message.installCorpus();
  };

  const renderMessageInstallStatus = (): JSX.Element => {
    if (messageProgress && (messageProgress.phase === 'downloading' || messageProgress.phase === 'installing')) {
      const label =
        messageProgress.phase === 'downloading'
          ? 'Downloading…'
          : messageProgress.total
            ? `Installing ${messageProgress.count ?? 0}/${messageProgress.total}…`
            : 'Installing…';
      return (
        <>
          <span style={pulseDotStyle} />
          <span style={progressLabelStyle}>{label}</span>
        </>
      );
    }
    if (messageProgress && messageProgress.phase === 'error') {
      return (
        <>
          <span style={errorLabelStyle}>{messageProgress.error ?? 'Install failed'}</span>
          <button style={retryBtnStyle} onClick={installMessageCorpus}>
            Retry
          </button>
        </>
      );
    }
    return (
      <button style={installBtnDisabledStyle} disabled title="Coming in a later update">
        Install corpus (coming soon)
      </button>
    );
  };

  const renderStatus = (entry: BibleManifestEntry): JSX.Element => {
    if (entry.bundled) {
      return <span style={bundledTagStyle}>BUNDLED</span>;
    }
    const p = progress[entry.id];
    if (p && (p.phase === 'downloading' || p.phase === 'installing')) {
      return (
        <>
          <span style={pulseDotStyle} />
          <span style={progressLabelStyle}>{p.phase === 'downloading' ? 'Downloading…' : 'Installing…'}</span>
        </>
      );
    }
    if (p && p.phase === 'error') {
      return (
        <>
          <span style={errorLabelStyle}>{p.error ?? 'Install failed'}</span>
          <button style={retryBtnStyle} onClick={() => install(entry.id)}>
            Retry
          </button>
        </>
      );
    }
    if (entry.installed) {
      return (
        <>
          <span style={installedTagStyle}>Installed ✓</span>
          <button style={ghostBtnStyle(confirmId === entry.id)} onClick={() => handleRemoveClick(entry.id)}>
            {confirmId === entry.id ? 'Remove — sure?' : 'Remove'}
          </button>
        </>
      );
    }
    return (
      <button style={installBtnStyle} onClick={() => install(entry.id)}>
        Install
      </button>
    );
  };

  return (
    <>
      <div style={overlayStyle} onClick={onClose}>
        <div style={modalStyle} onClick={stop}>
          <div style={{ padding: '16px 22px', borderBottom: `1px solid ${T.hairline}`, fontWeight: 700, fontSize: '18px' }}>
            Settings
          </div>
          <div style={bodyStyle}>
            <div style={navStyle}>
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  style={navItemStyle(section === s.id, s.enabled)}
                  disabled={!s.enabled}
                  title={s.enabled ? undefined : 'Coming with later slices'}
                  onClick={() => s.enabled && setSection(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div style={contentStyle}>
              {section === 'bibles' && (
                <>
                  <div style={sectionTitleStyle}>Bibles</div>
                  <div style={sectionHintStyle}>
                    Installed translations appear in the sermon-mode compare picker. KJV ships with Helm and can&rsquo;t be removed.
                  </div>
                  <div>
                    {manifest.map((entry) => (
                      <div key={entry.id} style={rowStyle}>
                        <span style={abbrChipStyle}>{entry.abbr}</span>
                        <span style={nameStyle}>{entry.name}</span>
                        {renderStatus(entry)}
                      </div>
                    ))}
                  </div>
                </>
              )}
              {section === 'message' && (
                <>
                  <div style={sectionTitleStyle}>Message</div>
                  <div style={sectionHintStyle}>
                    Import a transcript file by hand and review it before it&rsquo;s added to the library. Installing the full
                    sermon-tape corpus is coming in a later update.
                  </div>
                  <div style={rowStyle}>
                    <span style={nameStyle}>
                      {messageCount === null ? 'Loading…' : `${messageCount} tape${messageCount === 1 ? '' : 's'} in library`}
                    </span>
                    {renderMessageInstallStatus()}
                  </div>
                  <div style={sectionHintStyle}>
                    Downloading from Voice of God Recordings is coming in a later update — use Import for now.
                  </div>
                  <div>
                    <button style={ghostBtnStyle(false)} onClick={() => setMessageImportOpen(true)}>
                      Import file…
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
          <div style={footerStyle}>
            <button style={doneBtnStyle} onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
      {messageImportOpen && (
        <MessageImport
          open={messageImportOpen}
          onClose={() => setMessageImportOpen(false)}
          onSaved={(list: MessageMeta[]) => setMessageCount(list.length)}
        />
      )}
    </>
  );
}
