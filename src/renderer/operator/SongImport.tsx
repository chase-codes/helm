import { useContext, useEffect, useState, type CSSProperties, type JSX } from 'react';
import { ThemeCtx } from './ThemeCtx';
import { ModalShell } from './ModalShell';
import { ImportIcon } from '../shared/icons';
import type { ImportReviewRow, ImportSourceInfo, SongImportProgress, SongImportResult } from '../../shared/types';

export interface SongImportProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
  /** Told whenever a commit starts/stops being in flight, so the caller (SongsMode) can gate
   *  its own Escape handling — the wizard's step lives here, not there. See the `dismissible`
   *  guard below for the other half of the gate (the overlay/Cancel dismissal paths). */
  onImportingChange?: (inFlight: boolean) => void;
}

type Step =
  | { name: 'source' }
  | { name: 'scanning' }
  | { name: 'error'; message: string; expected?: string }
  | { name: 'review'; token: string; rows: ImportReviewRow[]; withLayouts?: number }
  | { name: 'importing'; done: number; total: number }
  | { name: 'done'; result: SongImportResult };

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function SongImport({ open, onClose, onImported, onImportingChange }: SongImportProps): JSX.Element | null {
  const T = useContext(ThemeCtx);
  const [sources, setSources] = useState<ImportSourceInfo[]>([]);
  const [step, setStep] = useState<Step>({ name: 'source' });

  // Reset to the source step whenever the modal transitions to open. This is React's
  // sanctioned "adjust state when a prop changes" pattern (setState during render,
  // guarded by comparing against a mirrored-in-state previous value) rather than an
  // effect — react-hooks/set-state-in-effect flags unconditional setState calls at the
  // top of a useEffect body (see MessageMode.tsx for the same pattern).
  const [openFor, setOpenFor] = useState(open);
  if (open !== openFor) {
    setOpenFor(open);
    if (open) setStep({ name: 'source' });
  }

  useEffect(() => {
    if (!open) return;
    let live = true;
    void window.helm.songImport
      .sources()
      .then((s) => {
        if (live) setSources(s);
      })
      .catch(console.error);
    return () => {
      live = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    return window.helm.songImport.onProgress((p: SongImportProgress) =>
      setStep((s) => (s.name === 'importing' ? { name: 'importing', ...p } : s))
    );
  }, [open]);

  // Surface "a commit is running" upward: SongsMode owns the Escape key path (it lives
  // outside this component, in the mode's keyHandlerRef) and has no other way to see this
  // wizard's internal step.
  useEffect(() => {
    onImportingChange?.(step.name === 'importing');
  }, [step.name, onImportingChange]);

  if (!open) return null;

  // While a commit is actually running, losing this screen loses the only record of which
  // songs failed to read — so neither the overlay nor the footer button may dismiss it until
  // the import settles (done, or an error).
  const dismissible = step.name !== 'importing';

  const chooseSource = (id: string): void => {
    setStep({ name: 'scanning' });
    void window.helm.songImport
      .scan(id)
      .then((result) => {
        if ('rows' in result) {
          setStep({
            name: 'review',
            token: result.token,
            rows: result.rows,
            ...(result.withLayouts === undefined ? {} : { withLayouts: result.withLayouts })
          });
          return;
        }
        if (result.error === 'canceled') {
          setStep({ name: 'source' }); // the operator backed out; not an error
          return;
        }
        setStep({
          name: 'error',
          message:
            result.error === 'no-source-files'
              ? "Couldn't find Songs.db and SongWords.db in that folder."
              : result.error === 'all-candidates-empty'
                ? 'Found an EasyWorship library there, but it holds no songs. EasyWorship keeps more than one library — try another profile or version folder.'
                : result.error === 'candidates-unreadable'
                  ? "Found an EasyWorship library there, but it couldn't be read. Close EasyWorship and try again."
                  : result.error === 'search-too-broad'
                    ? 'That folder was too broad to search. Pick the EasyWorship folder itself, or a profile folder inside it, rather than a whole drive or user folder.'
                    : 'That import source is not available.',
          expected: 'expected' in result ? result.expected : undefined
        });
      })
      .catch((err: unknown) => {
        console.error(err);
        setStep({ name: 'error', message: "Couldn't read that library." });
      });
  };

  const runImport = (token: string, total: number): void => {
    setStep({ name: 'importing', done: 0, total });
    void window.helm.songImport
      .commit(token)
      .then((result) => {
        setStep({ name: 'done', result });
        onImported();
      })
      .catch((err: unknown) => {
        console.error(err);
        setStep({ name: 'error', message: "Couldn't finish the import." });
      });
  };

  const headerStyle: CSSProperties = { padding: '16px 22px', borderBottom: `1px solid ${T.hairline}` };
  const bodyStyle: CSSProperties = { flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 22px' };
  const footerStyle: CSSProperties = {
    display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '10px',
    padding: '15px 22px', borderTop: `1px solid ${T.hairline}`
  };
  const sourceBtnStyle: CSSProperties = {
    display: 'block', width: '100%', textAlign: 'left', padding: '14px 16px', marginBottom: '8px',
    borderRadius: '10px', background: T.panel2, boxShadow: `inset 0 0 0 1px ${T.border}`,
    fontSize: '14px', fontWeight: 600, color: T.text
  };
  const rowStyle: CSSProperties = {
    display: 'flex', alignItems: 'baseline', gap: '10px', padding: '8px 12px',
    borderRadius: '8px', background: T.panel2, marginBottom: '5px'
  };
  const badgeStyle = (color: string): CSSProperties => ({
    fontFamily: "'JetBrains Mono',monospace", fontSize: '10px', letterSpacing: '0.06em',
    color, flexShrink: 0
  });
  const cancelStyle: CSSProperties = {
    height: '38px', padding: '0 18px', borderRadius: '10px', background: T.panel2,
    boxShadow: `inset 0 0 0 1px ${T.border}`, fontSize: '13.5px', color: T.dim
  };
  const primaryStyle: CSSProperties = {
    height: '38px', padding: '0 20px', borderRadius: '10px', background: T.accent,
    color: T.accentInk, fontWeight: 700, fontSize: '13.5px'
  };

  const newCount = step.name === 'review' ? step.rows.filter((r) => r.status === 'new').length : 0;

  return (
    <ModalShell
      onClose={dismissible ? onClose : undefined}
      width="760px"
      maxWidth="96vw"
      height="88vh"
      overlayPadding="4vh 4vw"
      zIndex={60}
    >
      <div style={headerStyle}>
        <div style={{ fontWeight: 700, fontSize: '18px' }}>Import songs</div>
        <div style={{ fontSize: '13px', color: T.dim, marginTop: '4px', lineHeight: 1.4 }}>
          Bring an existing song library into Helm. Nothing is saved until you confirm.
        </div>
      </div>

      <div style={bodyStyle}>
        {step.name === 'source' && (
          <>
            <div style={{ fontSize: '12px', color: T.faint, marginBottom: '10px' }}>
              WHICH PROGRAM ARE YOU COMING FROM?
            </div>
            {sources.map((s) => (
              <button key={s.id} style={sourceBtnStyle} onClick={() => chooseSource(s.id)}>
                {s.label}
              </button>
            ))}
          </>
        )}

        {step.name === 'scanning' && <div style={{ color: T.dim, fontSize: '13px' }}>Reading the library…</div>}

        {step.name === 'error' && (
          <div style={{ fontSize: '13.5px', color: T.live, lineHeight: 1.6 }}>
            <div>{step.message}</div>
            {step.expected && (
              <div style={{ color: T.dim, marginTop: '8px' }}>
                It is usually at <code>{step.expected}</code>
              </div>
            )}
          </div>
        )}

        {step.name === 'review' && (
          <>
            <div style={{ fontSize: '12px', color: T.faint, marginBottom: '10px' }}>
              FOUND {plural(step.rows.length, 'SONG', 'SONGS').toUpperCase()}
              {step.withLayouts !== undefined &&
                (step.withLayouts > 0
                  ? ` · ${step.withLayouts.toLocaleString()} WITH EASYWORSHIP LAYOUTS`
                  : ' · NONE WITH EASYWORSHIP LAYOUTS')}
            </div>
            {step.rows.map((r, i) => (
              <div key={`${r.title}-${i}`} style={rowStyle}>
                <span style={badgeStyle(r.status === 'new' ? T.accent : r.status === 'duplicate' ? T.faint : T.live)}>
                  {r.status === 'new' ? 'NEW' : r.status === 'duplicate' ? 'IN HELM' : 'UNREADABLE'}
                </span>
                {r.sourceStanzas !== undefined && <span style={badgeStyle(T.scripture)}>CHECK</span>}
                <span style={{ fontSize: '13.5px', color: T.text, flex: 1, minWidth: 0 }}>{r.title}</span>
                <span style={{ fontSize: '12px', color: T.dim }}>
                  {r.status === 'unreadable'
                    ? r.reason
                    : r.sourceStanzas !== undefined && r.parsedStanzas !== undefined
                      ? `${plural(r.parsedStanzas, 'slide', 'slides')} · EasyWorship counts ${r.sourceStanzas}`
                      : plural(r.stanzas, 'stanza', 'stanzas')}
                </span>
              </div>
            ))}
          </>
        )}

        {step.name === 'importing' && (
          <div style={{ color: T.dim, fontSize: '13px' }}>
            Importing… {step.done} of {step.total}
          </div>
        )}

        {step.name === 'done' && (
          <div style={{ fontSize: '14px', color: T.text, lineHeight: 1.7 }}>
            <div style={{ fontWeight: 700 }}>Imported {plural(step.result.imported, 'song', 'songs')}.</div>
            {step.result.skipped > 0 && (
              <div style={{ color: T.dim }}>{plural(step.result.skipped, 'song', 'songs')} already in Helm.</div>
            )}
            {step.result.unreadable.length > 0 && (
              <>
                <div style={{ color: T.dim }}>
                  {plural(step.result.unreadable.length, "song couldn't", "songs couldn't")} be read.
                </div>
                <div style={{ marginTop: '10px' }}>
                  {step.result.unreadable.map((u, i) => (
                    <div key={`${u.title}-${i}`} style={rowStyle}>
                      <span style={{ fontSize: '13.5px', color: T.text, flex: 1, minWidth: 0 }}>{u.title}</span>
                      <span style={{ fontSize: '12px', color: T.dim }}>{u.reason}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div style={footerStyle}>
        <button style={cancelStyle} onClick={dismissible ? onClose : undefined} disabled={!dismissible}>
          {step.name === 'done' ? 'Close' : 'Cancel'}
        </button>
        {step.name === 'review' && newCount > 0 && (
          <button
            style={{ ...primaryStyle, display: 'inline-flex', alignItems: 'center', gap: '7px' }}
            onClick={() => runImport(step.token, newCount)}
          >
            <ImportIcon size={14} /> Import {plural(newCount, 'song', 'songs')}
          </button>
        )}
      </div>
    </ModalShell>
  );
}
