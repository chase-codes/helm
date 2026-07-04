import { useContext, useState, type CSSProperties, type JSX, type MouseEvent as ReactMouseEvent } from 'react';
import { ThemeCtx } from './ThemeCtx';
import type { PreCard, PreCardType } from '../../shared/types';

export interface PreCardEditorProps {
  card: PreCard | null;
  onClose: () => void;
}

// Sub-slice C (media) hasn't landed yet, so the 'image' card type has no creation path
// here — only the three types the design's type tabs offer natively. See task B6 brief.
type EditableType = 'verse' | 'list' | 'message';

const TYPE_TABS: { id: EditableType; label: string }[] = [
  { id: 'verse', label: 'Bible verse' },
  { id: 'list', label: 'List of items' },
  { id: 'message', label: 'Big message' }
];

function asEditableType(t: PreCardType | undefined): EditableType {
  return t === 'list' || t === 'message' ? t : 'verse';
}

export function PreCardEditor({ card, onClose }: PreCardEditorProps): JSX.Element {
  const T = useContext(ThemeCtx);
  const isNew = card === null;

  const [peType, setPeType] = useState<EditableType>(asEditableType(card?.type));
  const [peTitle, setPeTitle] = useState(card?.title ?? '');
  const [peRef, setPeRef] = useState(card?.ref ?? '');
  const [peText, setPeText] = useState(card?.text ?? '');
  const [peLines, setPeLines] = useState((card?.points ?? []).join('\n'));
  const [peHeadline, setPeHeadline] = useState(card?.headline ?? '');
  const [peSubtitle, setPeSubtitle] = useState(card?.subtitle ?? '');

  const stop = (e: ReactMouseEvent): void => e.stopPropagation();

  // Port of the prototype's savePreEdit field-mapping (Lectern.dc.html ~L856-866).
  const save = (): void => {
    const enabled = card?.enabled ?? true;
    if (peType === 'verse') {
      window.helm.preservice.saveCard({
        id: card?.id,
        type: 'verse',
        enabled,
        title: peTitle.trim() || peRef.trim() || 'Verse',
        ref: peRef.trim(),
        text: peText.trim()
      });
    } else if (peType === 'list') {
      window.helm.preservice.saveCard({
        id: card?.id,
        type: 'list',
        enabled,
        title: peTitle.trim() || 'List',
        points: peLines
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean)
      });
    } else {
      window.helm.preservice.saveCard({
        id: card?.id,
        type: 'message',
        enabled,
        title: peTitle.trim() || peHeadline.trim() || 'Message',
        headline: peHeadline.trim() || 'Welcome',
        subtitle: peSubtitle.trim()
      });
    }
    onClose();
  };

  const remove = (): void => {
    if (!card) return;
    window.helm.preservice.removeCard(card.id);
    onClose();
  };

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
    width: '100%',
    maxWidth: '520px',
    background: T.panel,
    borderRadius: '16px',
    padding: '22px 24px',
    boxShadow: '0 30px 80px rgba(0,0,0,.5)',
    maxHeight: '90vh',
    overflowY: 'auto'
  };
  const fieldLabelStyle: CSSProperties = { fontSize: '10px', letterSpacing: '0.1em', color: T.faint, fontWeight: 600, marginBottom: '6px' };
  const inputStyle: CSSProperties = {
    width: '100%',
    height: '38px',
    padding: '0 12px',
    background: T.inputBg,
    borderRadius: '9px',
    boxShadow: `inset 0 0 0 1px ${T.border}`,
    fontSize: '13.5px'
  };
  const areaStyle: CSSProperties = {
    width: '100%',
    minHeight: '110px',
    padding: '10px 12px',
    background: T.inputBg,
    borderRadius: '9px',
    boxShadow: `inset 0 0 0 1px ${T.border}`,
    fontSize: '13.5px',
    lineHeight: 1.55,
    resize: 'vertical'
  };
  const removeStyle: CSSProperties = {
    height: '34px',
    padding: '0 14px',
    borderRadius: '9px',
    color: T.live,
    background: `${T.live}1a`,
    fontSize: '12.5px',
    fontWeight: 600
  };
  const smallGhost: CSSProperties = {
    height: '46px',
    padding: '0 14px',
    borderRadius: '11px',
    background: 'transparent',
    boxShadow: `inset 0 0 0 1px ${T.border}`,
    fontSize: '13px',
    fontWeight: 600,
    color: T.dim,
    display: 'flex',
    alignItems: 'center'
  };
  const primaryBtn: CSSProperties = {
    height: '46px',
    padding: '0 22px',
    borderRadius: '11px',
    background: T.accent,
    color: T.accentInk,
    fontSize: '14.5px',
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '7px'
  };
  const tabStyle = (active: boolean): CSSProperties => ({
    flex: 1,
    height: '32px',
    borderRadius: '8px',
    fontSize: '12.5px',
    fontWeight: active ? 700 : 600,
    color: active ? T.accentInk : T.dim,
    background: active ? T.accent : T.panel2,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  });

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={stop}>
        <div style={{ fontWeight: 700, fontSize: '18px' }}>{isNew ? 'Add a card to the loop' : 'Edit card'}</div>
        {isNew && (
          <div style={{ display: 'flex', gap: '6px', marginTop: '14px' }}>
            {TYPE_TABS.map((t) => (
              <button key={t.id} style={tabStyle(t.id === peType)} onClick={() => setPeType(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
          <div>
            <div style={fieldLabelStyle}>CARD NAME</div>
            <input style={inputStyle} value={peTitle} onChange={(e) => setPeTitle(e.target.value)} placeholder="e.g. Prayer requests" />
          </div>
          {peType === 'verse' && (
            <>
              <div>
                <div style={fieldLabelStyle}>REFERENCE</div>
                <input style={inputStyle} value={peRef} onChange={(e) => setPeRef(e.target.value)} placeholder="Psalm 122:1" />
              </div>
              <div>
                <div style={fieldLabelStyle}>VERSE TEXT</div>
                <textarea
                  style={areaStyle}
                  value={peText}
                  onChange={(e) => setPeText(e.target.value)}
                  placeholder="I was glad when they said unto me…"
                />
              </div>
            </>
          )}
          {peType === 'list' && (
            <div>
              <div style={fieldLabelStyle}>ITEMS — ONE PER LINE</div>
              <textarea
                style={areaStyle}
                value={peLines}
                onChange={(e) => setPeLines(e.target.value)}
                placeholder="Fellowship dinner — next Sunday after service"
              />
            </div>
          )}
          {peType === 'message' && (
            <>
              <div>
                <div style={fieldLabelStyle}>BIG LINE</div>
                <input style={inputStyle} value={peHeadline} onChange={(e) => setPeHeadline(e.target.value)} placeholder="Welcome" />
              </div>
              <div>
                <div style={fieldLabelStyle}>SMALL LINE</div>
                <input
                  style={inputStyle}
                  value={peSubtitle}
                  onChange={(e) => setPeSubtitle(e.target.value)}
                  placeholder="We’re glad you’re here this morning"
                />
              </div>
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: '10px', marginTop: '20px', alignItems: 'center' }}>
          {!isNew && (
            <button style={removeStyle} onClick={remove}>
              Remove card
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button style={smallGhost} onClick={onClose}>
            Cancel
          </button>
          <button style={primaryBtn} onClick={save}>
            {isNew ? 'Add to loop' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
