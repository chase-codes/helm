import { useContext, useLayoutEffect, useRef, useState, type CSSProperties, type JSX, type KeyboardEvent } from 'react';
import { ThemeCtx } from './ThemeCtx';
import { ModalShell } from './ModalShell';
import type { PreCard, PreCardType } from '../../shared/types';
import { cleanListPoints } from '../../shared/preservice/listPoints';
import { preSlideFor } from '../../shared/preservice/cards';
import { IS_MAC } from '../../shared/hotkeys/match';
import { SlideCanvas } from '../shared/SlideCanvas';
import { PreVersePicker } from './PreVersePicker';
import { usePreVerse } from './usePreVerse';

export interface PreCardEditorProps {
  card: PreCard | null;
  onClose: () => void;
  /** Removal is PreServiceMode's to perform, not this modal's: it owns the rail's undo
   * affordance, and a card removed from here must land in the same 5-second "Deleted …
   * Undo" bar as one removed by right-click or the Delete key (#86). */
  onRemove: (card: PreCard) => void;
}

// Sub-slice C (media) hasn't landed yet, so the 'image' card type has no creation path
// here — only the three types the design's type tabs offer natively. See task B6 brief.
type EditableType = 'verse' | 'list' | 'message';

const TYPE_TABS: { id: EditableType; label: string }[] = [
  { id: 'verse', label: 'Bible verse' },
  { id: 'list', label: 'List of items' },
  { id: 'message', label: 'Big message' }
];

/** The two lists nearly every loop carries. The add chip on the rail promises
 * "announcements, prayer…", so a new list offers them by name instead of leaving the
 * operator to work out that "List of items" is where a prayer list goes. */
const LIST_HEADINGS = ['Prayer requests', 'Announcements'];

/** Past this the fitter has shrunk a list far enough that the back row struggles. */
const LIST_COMFORTABLE = 7;
/** Roughly three verses: past this a verse card reads as a wall of text. */
const VERSE_COMFORTABLE = 420;

const SAVE_KEYS = IS_MAC ? '⌘↵' : 'Ctrl+Enter';

function asEditableType(t: PreCardType | undefined): EditableType {
  return t === 'list' || t === 'message' ? t : 'verse';
}

export function PreCardEditor({ card, onClose, onRemove }: PreCardEditorProps): JSX.Element {
  const T = useContext(ThemeCtx);
  const isNew = card === null;

  const [peType, setPeType] = useState<EditableType>(asEditableType(card?.type));
  // A name that only repeats the card's own content was never typed by the operator: it
  // was the automatic one. Opening it blank keeps it automatic, so changing the verse (or
  // the big line) renames the card instead of leaving the old reference on the rail.
  const [peTitle, setPeTitle] = useState(() => {
    if (!card) return '';
    if (card.type === 'verse' && card.title === card.ref) return '';
    if (card.type === 'message' && card.title === card.headline) return '';
    return card.title;
  });
  // A saved list opens on a fresh last line: the usual edit is one more request, and the
  // caret is already where it goes. cleanListPoints drops the line if nothing is typed.
  const [peLines, setPeLines] = useState(() => {
    const points = card?.points ?? [];
    return points.length ? `${points.join('\n')}\n` : '';
  });
  const [peHeadline, setPeHeadline] = useState(card?.headline ?? '');
  const [peSubtitle, setPeSubtitle] = useState(card?.subtitle ?? '');
  const [edited, setEdited] = useState(false);
  const verse = usePreVerse(card);
  const dirty = edited || verse.touched;

  const entryRef = useRef<HTMLInputElement | null>(null);
  const headingRef = useRef<HTMLInputElement | null>(null);
  const itemsRef = useRef<HTMLTextAreaElement | null>(null);
  const headlineRef = useRef<HTMLInputElement | null>(null);

  // The editor opens with the caret in the field the operator came for, and moves it
  // when they switch card type: no click needed before typing.
  useLayoutEffect(() => {
    if (peType === 'verse') entryRef.current?.focus();
    else if (peType === 'message') headlineRef.current?.focus();
    else if (isNew && peTitle.trim() === '') headingRef.current?.focus();
    else {
      const el = itemsRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      el.scrollTop = el.scrollHeight;
    }
    // Runs on open and on a type switch only: re-running as the heading is typed would
    // pull the caret out of it mid-word.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peType]);

  const points = cleanListPoints(peLines.split('\n'));
  const headline = peHeadline.trim() || 'Welcome';
  const autoTitle = peType === 'verse' ? verse.ref.trim() || 'Verse' : peType === 'list' ? 'List' : peHeadline.trim() || 'Message';

  // An empty card is not offered to the loop (rule 7): the button ghosts and says why.
  const blocked =
    peType === 'verse' && verse.text.trim() === ''
      ? 'Pick a verse first'
      : peType === 'list' && points.length === 0
        ? 'Add at least one item first'
        : null;

  // Port of the prototype's savePreEdit field-mapping (Lectern.dc.html ~L856-866).
  const save = (): void => {
    if (blocked) return;
    const enabled = card?.enabled ?? true;
    const title = peTitle.trim() || autoTitle;
    if (peType === 'verse') {
      window.helm.preservice.saveCard({
        id: card?.id,
        type: 'verse',
        enabled,
        title,
        ref: verse.ref.trim(),
        text: verse.text.trim(),
        version: verse.version
      });
    } else if (peType === 'list') {
      // cleanListPoints, not a bare trim: the slide renderer draws its own bullet, so a
      // typed "- " marker would render doubled (#50).
      window.helm.preservice.saveCard({ id: card?.id, type: 'list', enabled, title, points });
    } else {
      window.helm.preservice.saveCard({
        id: card?.id,
        type: 'message',
        enabled,
        title,
        headline,
        subtitle: peSubtitle.trim()
      });
    }
    onClose();
  };

  const remove = (): void => {
    if (!card) return;
    onRemove(card);
    onClose();
  };

  // The draft as a card, mirroring save()'s field mapping, so the preview is the REAL
  // renderer showing exactly what saving would project — including marker stripping (#50)
  // and auto-fit (#49) doing their work while the operator types, not after they save.
  // Notably NOT the saved card: the preview must track keystrokes.
  const draft: PreCard =
    peType === 'verse'
      ? { id: card?.id ?? '', type: 'verse', enabled: true, title: peTitle, ref: verse.ref.trim(), text: verse.text.trim(), version: verse.version }
      : peType === 'list'
        ? { id: card?.id ?? '', type: 'list', enabled: true, title: peTitle.trim() || 'List', points: peLines.split('\n') }
        : { id: card?.id ?? '', type: 'message', enabled: true, title: peTitle, headline, subtitle: peSubtitle.trim() };

  // Mod+Enter saves from any field. Plain Enter cannot: it is a new line in the items and
  // the verse text, and the reference entry's own commit.
  const onEditorKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    save();
  };

  const fieldLabelStyle: CSSProperties = { fontSize: '10px', letterSpacing: '0.1em', color: T.faint, fontWeight: 600, marginBottom: '6px', flexShrink: 0 };
  const noteStyle: CSSProperties = { fontSize: '11.5px', color: T.faint, marginTop: '6px', lineHeight: 1.45, flexShrink: 0 };
  const inputStyle: CSSProperties = {
    width: '100%',
    height: '38px',
    padding: '0 12px',
    background: T.inputBg,
    borderRadius: '9px',
    boxShadow: `inset 0 0 0 1px ${T.border}`,
    fontSize: '13.5px',
    flexShrink: 0
  };
  // Fills whatever the fixed frame leaves instead of a fixed 110px box: a prayer list of
  // eight lines used to scroll its own first lines out of sight.
  const areaStyle: CSSProperties = {
    width: '100%',
    flex: 1,
    minHeight: '72px',
    padding: '10px 12px',
    background: T.inputBg,
    borderRadius: '9px',
    boxShadow: `inset 0 0 0 1px ${T.border}`,
    fontSize: '13.5px',
    lineHeight: 1.55,
    resize: 'none'
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
    background: blocked ? T.panel2 : T.accent,
    color: blocked ? T.faint : T.accentInk,
    boxShadow: blocked ? `inset 0 0 0 1px ${T.border}` : 'none',
    fontSize: '14.5px',
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '7px',
    whiteSpace: 'nowrap'
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
  const suggestStyle: CSSProperties = {
    height: '26px',
    padding: '0 10px',
    borderRadius: '7px',
    fontSize: '11.5px',
    fontWeight: 600,
    color: T.accent,
    background: `${T.accent}1c`,
    whiteSpace: 'nowrap'
  };
  const columnStyle: CSSProperties = { flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' };

  const cardNameField = (placeholder: string): JSX.Element => (
    <div style={{ flexShrink: 0 }}>
      <div style={fieldLabelStyle}>CARD NAME (OPTIONAL)</div>
      <input
        style={inputStyle}
        value={peTitle}
        onChange={(e) => {
          setPeTitle(e.target.value);
          setEdited(true);
        }}
        placeholder={placeholder}
        title="Only shown in the loop list. Left blank, the card is named after what it shows."
      />
    </div>
  );

  const preview = (
    <div style={{ flexShrink: 0 }}>
      <div style={fieldLabelStyle}>PREVIEW</div>
      <div
        data-testid="pre-card-preview"
        style={{ width: '100%', aspectRatio: '16 / 9', borderRadius: '10px', overflow: 'hidden', boxShadow: `inset 0 0 0 1px ${T.border}` }}
      >
        {peType === 'verse' && blocked ? (
          // A verse card with no verse would render as a bare translation tag on a dark
          // slide. Say what fills it instead (rule 7).
          <div
            data-preview-empty
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 28px',
              textAlign: 'center',
              fontSize: '12.5px',
              lineHeight: 1.5,
              color: T.faint,
              background: T.panel2
            }}
          >
            The card shows here as soon as a verse is picked.
          </div>
        ) : (
          <SlideCanvas slide={preSlideFor(draft)} fill />
        )}
      </div>
    </div>
  );

  return (
    // A fixed frame (rule 5): the three card types differ in how much they hold, and the
    // editor used to change height and jump on screen as the operator switched between
    // them. Find or write on the left, the card as the room will see it on the right.
    // The backdrop stops dismissing once something has been typed: a stray click beside
    // the editor used to throw away a half-written prayer list.
    <ModalShell onClose={dirty ? undefined : onClose} width="100%" maxWidth="940px" height="680px" maxHeight="90vh">
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }} onKeyDown={onEditorKeyDown}>
        <div style={{ padding: '20px 24px 0', flexShrink: 0 }}>
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
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: '22px', padding: '16px 24px 18px' }}>
          {peType === 'verse' && (
            <>
              <div style={columnStyle}>
                <PreVersePicker theme={T} verse={verse} entryRef={entryRef} />
              </div>
              <div style={{ ...columnStyle, gap: '12px' }}>
                {preview}
                {cardNameField(autoTitle)}
                <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                  <div style={fieldLabelStyle}>VERSE TEXT</div>
                  <textarea
                    style={areaStyle}
                    value={verse.text}
                    onChange={(e) => verse.editText(e.target.value)}
                    placeholder="Pick a verse on the left, or type the words here"
                  />
                  {verse.text.length > VERSE_COMFORTABLE && (
                    <div style={noteStyle} data-verse-long>
                      A long passage for one card: the words shrink to fit. Shift-click a shorter range to keep it readable from the back.
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
          {peType === 'list' && (
            <>
              <div style={columnStyle}>
                <div style={fieldLabelStyle}>HEADING</div>
                <input
                  ref={headingRef}
                  style={inputStyle}
                  value={peTitle}
                  onChange={(e) => {
                    setPeTitle(e.target.value);
                    setEdited(true);
                  }}
                  onKeyDown={(e) => {
                    // Enter in the heading moves on to the items, where the writing is.
                    if (e.key !== 'Enter' || e.metaKey || e.ctrlKey) return;
                    e.preventDefault();
                    itemsRef.current?.focus();
                  }}
                  placeholder="Prayer requests"
                />
                {isNew && peTitle.trim() === '' && (
                  <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexShrink: 0 }}>
                    {LIST_HEADINGS.map((h) => (
                      <button
                        key={h}
                        style={suggestStyle}
                        onClick={() => {
                          setPeTitle(h);
                          setEdited(true);
                          itemsRef.current?.focus();
                        }}
                      >
                        {h}
                      </button>
                    ))}
                  </div>
                )}
                <div style={{ ...fieldLabelStyle, marginTop: '14px' }}>ITEMS</div>
                <textarea
                  ref={itemsRef}
                  style={areaStyle}
                  value={peLines}
                  onChange={(e) => {
                    setPeLines(e.target.value);
                    setEdited(true);
                  }}
                  placeholder={'The Hollis family\nSis. Ruth, recovering from surgery'}
                />
                <div style={noteStyle} data-list-note>
                  {points.length > LIST_COMFORTABLE
                    ? `${points.length} items: the words shrink to fit. Split the list across two cards to keep it readable from the back.`
                    : `One item per line. ${points.length} ${points.length === 1 ? 'item' : 'items'} so far.`}
                </div>
              </div>
              <div style={columnStyle}>{preview}</div>
            </>
          )}
          {peType === 'message' && (
            <>
              <div style={{ ...columnStyle, gap: '12px' }}>
                <div style={{ flexShrink: 0 }}>
                  <div style={fieldLabelStyle}>BIG LINE</div>
                  <input
                    ref={headlineRef}
                    style={inputStyle}
                    value={peHeadline}
                    onChange={(e) => {
                      setPeHeadline(e.target.value);
                      setEdited(true);
                    }}
                    placeholder="Welcome"
                  />
                </div>
                <div style={{ flexShrink: 0 }}>
                  <div style={fieldLabelStyle}>SMALL LINE</div>
                  <input
                    style={inputStyle}
                    value={peSubtitle}
                    onChange={(e) => {
                      setPeSubtitle(e.target.value);
                      setEdited(true);
                    }}
                    placeholder="We’re glad you’re here this morning"
                  />
                </div>
                {cardNameField(autoTitle)}
              </div>
              <div style={columnStyle}>{preview}</div>
            </>
          )}
        </div>
        <div
          style={{
            display: 'flex',
            gap: '10px',
            alignItems: 'center',
            padding: '14px 24px',
            flexShrink: 0,
            borderTop: `1px solid ${T.hairline}`
          }}
        >
          {!isNew && (
            <button style={removeStyle} onClick={remove}>
              Delete card
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button style={smallGhost} onClick={onClose}>
            Cancel
          </button>
          <button
            style={primaryBtn}
            onClick={save}
            disabled={blocked !== null}
            title={blocked ?? `${isNew ? 'Add to loop' : 'Save changes'} (${SAVE_KEYS})`}
            data-save
          >
            {isNew ? 'Add to loop' : 'Save changes'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
