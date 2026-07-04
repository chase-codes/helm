import { useContext, useRef, useState, type ChangeEvent, type CSSProperties, type JSX, type MouseEvent as ReactMouseEvent } from 'react';
import { ThemeCtx } from './ThemeCtx';
import type { MessageImportResult, MessageMeta } from '../../shared/types';

export interface MessageImportProps {
  open: boolean;
  onClose: () => void;
  onSaved: (list: MessageMeta[]) => void;
}

// PDF text extraction runs in the renderer via pdfjs-dist (see task-13-report.md for why:
// the operator-review step below is the safety net, and wiring pdf.js here keeps the
// main-process parser (`parseMessageText`) pure/kind-agnostic — it only ever sees text).
// Loaded lazily (dynamic import) so a TXT-only import never pays for parsing pdfjs-dist's
// module graph, and so a failure to resolve the worker URL only surfaces when a PDF is
// actually picked, never on TXT's guaranteed path.
async function extractPdfText(data: ArrayBuffer): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist');
  // electron-vite (Vite) turns this into a proper asset URL for the bundled worker file,
  // the same pattern Vite's own docs use for pdf.js — see MessageImport doc comment above.
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pageTexts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const items = content.items as { str?: string }[];
    pageTexts.push(items.map((it) => it.str ?? '').join(' '));
  }
  return pageTexts.join('\n\n');
}

export function MessageImport({ open, onClose, onSaved }: MessageImportProps): JSX.Element | null {
  const T = useContext(ThemeCtx);
  // Fresh per open, matching QuickAdd's mount-while-open contract.
  const [result, setResult] = useState<MessageImportResult | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!open) return null;

  const handlePick = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    // Let picking the same filename twice in a row re-trigger onChange.
    e.target.value = '';
    if (!file) return;
    setError(null);
    setResult(null);
    setFileName(file.name);
    setBusy(true);
    const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
    const run = isPdf
      ? file.arrayBuffer().then(extractPdfText).then((text) => window.helm.message.importParse('pdf', text))
      : file.text().then((text) => window.helm.message.importParse('txt', text));
    run
      .then((r) => setResult(r))
      .catch((err: unknown) => {
        setError(isPdf ? "Couldn't extract text from that PDF — try a .txt export instead." : "Couldn't parse that file.");
        console.error(err);
      })
      .finally(() => setBusy(false));
  };

  const save = (): void => {
    if (!result || result.paragraphs.length === 0 || saving) return;
    setSaving(true);
    setError(null);
    window.helm.message
      .importSave(result)
      .then((list) => {
        onClose();
        onSaved(list);
      })
      .catch((err: unknown) => {
        setSaving(false);
        setError("Couldn't save — try again");
        console.error(err);
      });
  };

  const stop = (e: ReactMouseEvent): void => e.stopPropagation();

  const overlayStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 60,
    background: 'rgba(8,9,12,.6)',
    backdropFilter: 'blur(3px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '5vh 4vw'
  };
  const modalStyle: CSSProperties = {
    width: '720px',
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
  const headerRowStyle: CSSProperties = { padding: '16px 22px', borderBottom: `1px solid ${T.hairline}` };
  const pickRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: '12px', padding: '16px 22px', borderBottom: `1px solid ${T.hairline}` };
  const pickBtnStyle: CSSProperties = {
    height: '36px',
    padding: '0 16px',
    borderRadius: '9px',
    background: T.panel2,
    boxShadow: `inset 0 0 0 1px ${T.border}`,
    fontSize: '13px',
    fontWeight: 600,
    color: T.text
  };
  const fileNameStyle: CSSProperties = { fontSize: '13px', color: T.dim, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
  const fieldsRowStyle: CSSProperties = { display: 'flex', gap: '10px', padding: '16px 22px 10px' };
  const fieldWrapStyle = (grow: number): CSSProperties => ({ flex: grow, display: 'flex', flexDirection: 'column', gap: '4px' });
  const fieldLabelStyle: CSSProperties = { fontSize: '10.5px', letterSpacing: '0.06em', fontWeight: 700, color: T.faint };
  const fieldInputStyle: CSSProperties = {
    height: '36px',
    padding: '0 12px',
    background: T.inputBg,
    borderRadius: '8px',
    boxShadow: `inset 0 0 0 1px ${T.border}`,
    fontSize: '13.5px',
    color: T.text
  };
  const previewHintStyle: CSSProperties = { fontSize: '12px', color: T.dim, padding: '0 22px 10px' };
  const previewListStyle: CSSProperties = { flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 22px 16px', display: 'flex', flexDirection: 'column', gap: '8px' };
  const paraCardStyle: CSSProperties = { background: T.panel2, borderRadius: '10px', padding: '10px 13px', boxShadow: `inset 0 0 0 1px ${T.hairline}` };
  const paraLabelStyle: CSSProperties = { fontFamily: "'JetBrains Mono',monospace", fontSize: '10px', letterSpacing: '0.06em', color: T.accent, marginBottom: '5px' };
  const paraTextStyle: CSSProperties = { fontSize: '13px', color: T.dim, lineHeight: 1.5 };
  const emptyStateStyle: CSSProperties = { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.faint, fontSize: '13px' };
  const footerStyle: CSSProperties = {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: '10px',
    padding: '15px 22px',
    borderTop: `1px solid ${T.hairline}`
  };
  const cancelStyle: CSSProperties = {
    height: '38px',
    padding: '0 18px',
    borderRadius: '10px',
    background: T.panel2,
    boxShadow: `inset 0 0 0 1px ${T.border}`,
    fontSize: '13.5px',
    color: T.dim
  };
  const saveBtnStyle = (enabled: boolean): CSSProperties => ({
    height: '38px',
    padding: '0 20px',
    borderRadius: '10px',
    background: T.accent,
    color: T.accentInk,
    fontWeight: 700,
    fontSize: '13.5px',
    opacity: enabled ? 1 : 0.5,
    cursor: enabled ? 'pointer' : 'not-allowed'
  });
  const errorStyle: CSSProperties = { fontSize: '13px', color: T.live };
  const noParasStyle: CSSProperties = { fontSize: '12px', color: T.dim, padding: '0 22px 10px' };

  const canSave = !!result && result.paragraphs.length > 0 && !saving;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={stop}>
        <div style={headerRowStyle}>
          <div style={{ fontWeight: 700, fontSize: '18px' }}>Import a message</div>
          <div style={{ fontSize: '13px', color: T.dim, marginTop: '4px', lineHeight: 1.4 }}>
            Review the parsed header and paragraphs before saving — this is your chance to fix anything the parser got wrong.
          </div>
        </div>

        <div style={pickRowStyle}>
          <button style={pickBtnStyle} onClick={() => fileInputRef.current?.click()} disabled={busy}>
            Choose file…
          </button>
          <span style={fileNameStyle}>{busy ? 'Parsing…' : fileName || 'No file chosen (.txt or .pdf)'}</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.pdf,text/plain,application/pdf"
            style={{ display: 'none' }}
            onChange={handlePick}
            disabled={busy}
          />
        </div>

        {error && <div style={{ padding: '10px 22px 0', ...errorStyle }}>{error}</div>}

        {result ? (
          <>
            <div style={fieldsRowStyle}>
              <div style={fieldWrapStyle(2)}>
                <span style={fieldLabelStyle}>TITLE</span>
                <input
                  style={fieldInputStyle}
                  value={result.title}
                  onChange={(e) => setResult({ ...result, title: e.target.value })}
                />
              </div>
              <div style={fieldWrapStyle(1)}>
                <span style={fieldLabelStyle}>TAPE NO</span>
                <input
                  style={fieldInputStyle}
                  value={result.tapeNo}
                  onChange={(e) => setResult({ ...result, tapeNo: e.target.value })}
                />
              </div>
              <div style={fieldWrapStyle(1)}>
                <span style={fieldLabelStyle}>DATE</span>
                <input
                  style={fieldInputStyle}
                  value={result.date}
                  onChange={(e) => setResult({ ...result, date: e.target.value })}
                />
              </div>
            </div>
            <div style={previewHintStyle}>PREVIEW · {result.paragraphs.length} paragraphs</div>
            {result.paragraphs.length === 0 ? (
              <div style={noParasStyle}>No numbered paragraphs found — check the file, or edit the header if this is correct.</div>
            ) : (
              <div style={previewListStyle}>
                {result.paragraphs.map((p, i) => (
                  <div key={i} style={paraCardStyle}>
                    <div style={paraLabelStyle}>¶{p.label}</div>
                    <div style={paraTextStyle}>{p.text}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div style={emptyStateStyle}>{busy ? 'Parsing…' : 'Choose a .txt or .pdf transcript to preview it here.'}</div>
        )}

        <div style={footerStyle}>
          <button style={cancelStyle} onClick={onClose}>
            Cancel
          </button>
          <button style={saveBtnStyle(canSave)} onClick={save} disabled={!canSave}>
            {saving ? 'Saving…' : 'Save to library'}
          </button>
        </div>
      </div>
    </div>
  );
}
