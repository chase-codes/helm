import { useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
import { ThemeCtx } from './ThemeCtx';
import { ModalShell } from './ModalShell';
import type { MediaItem, PreCard, PreCardType } from '../../shared/types';
import { cleanListPoints } from '../../shared/preservice/listPoints';
import { preSlideFor } from '../../shared/preservice/cards';
import { IS_MAC } from '../../shared/hotkeys/match';
import { mediaSrc } from '../../shared/media/slides';
import { ListEmpty } from './ListEmpty';
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
  /** Cancel, Escape and a click beside the editor. Separate from `onClose` (which follows
   * a save or a delete) so the page can keep an unsaved draft alive behind its five-second
   * Undo instead of dropping it. Defaults to `onClose`. */
  onCancel?: () => void;
  /** Mounted but not shown: the page hides a cancelled draft rather than unmounting it,
   * which is what lets Undo bring it back exactly as it was. */
  hidden?: boolean;
  /** Tells the page whether there is anything to lose. */
  onDirtyChange?: (dirty: boolean) => void;
}

type EditableType = 'verse' | 'list' | 'message' | 'image';

const TYPE_TABS: { id: EditableType; label: string }[] = [
  { id: 'verse', label: 'Bible verse' },
  { id: 'list', label: 'List of items' },
  { id: 'message', label: 'Big message' },
  { id: 'image', label: 'Picture' }
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
  return t === 'list' || t === 'message' || t === 'image' ? t : 'verse';
}

export function PreCardEditor({ card, onClose, onRemove, onCancel, hidden = false, onDirtyChange }: PreCardEditorProps): JSX.Element | null {
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
  // A new range can go up as one card or as a card per verse.
  const [split, setSplit] = useState(false);
  const [peSrc, setPeSrc] = useState(card?.src ?? '');
  // The media library's pictures; null until the Picture tab has asked for them.
  const [pictures, setPictures] = useState<MediaItem[] | null>(null);
  const verse = usePreVerse(card);
  const dirty = edited || verse.touched;
  const cancel = onCancel ?? onClose;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const onlyPictures = (items: MediaItem[]): MediaItem[] => items.filter((m) => m.type === 'image' && m.filePath);
  useEffect(() => {
    if (peType !== 'image') return;
    let live = true;
    void window.helm.media
      .list()
      .then((items) => {
        if (live) setPictures(onlyPictures(items));
      })
      .catch((err: unknown) => {
        console.error(err);
        if (live) setPictures([]);
      });
    return () => {
      live = false;
    };
  }, [peType]);

  // Same picker and the same library as the Slides track's "+ Import": a picture brought
  // in here is in the media library afterwards, and the newest one is picked.
  const importPictures = (): void => {
    const known = new Set((pictures ?? []).map((m) => m.id));
    void window.helm.media
      .importImages()
      .then((res) => {
        if (res.canceled) return;
        const next = onlyPictures(res.items);
        setPictures(next);
        const added = next.find((m) => !known.has(m.id));
        if (added?.filePath) {
          setPeSrc(mediaSrc(added.filePath));
          setEdited(true);
        }
      })
      .catch(console.error);
  };
  const picked = (pictures ?? []).find((m) => m.filePath && mediaSrc(m.filePath) === peSrc);

  const entryRef = useRef<HTMLInputElement | null>(null);
  const headingRef = useRef<HTMLInputElement | null>(null);
  const itemsRef = useRef<HTMLTextAreaElement | null>(null);
  const headlineRef = useRef<HTMLInputElement | null>(null);

  // The editor opens with the caret in the field the operator came for, and moves it
  // when they switch card type: no click needed before typing.
  useLayoutEffect(() => {
    if (hidden) return;
    if (peType === 'verse') entryRef.current?.focus();
    else if (peType === 'message') headlineRef.current?.focus();
    // A picture has no field to type in.
    else if (peType === 'image') return;
    else if (isNew && peTitle.trim() === '') headingRef.current?.focus();
    else {
      const el = itemsRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      el.scrollTop = el.scrollHeight;
    }
    // Runs on open, on a type switch and when an undone draft comes back: re-running as
    // the heading is typed would pull the caret out of it mid-word.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peType, hidden]);

  const points = cleanListPoints(peLines.split('\n'));
  const headline = peHeadline.trim() || 'Welcome';
  const autoTitle =
    peType === 'verse'
      ? verse.ref.trim() || 'Verse'
      : peType === 'list'
        ? 'List'
        : peType === 'image'
          ? picked?.title || 'Picture'
          : peHeadline.trim() || 'Message';
  const splitting = isNew && split && verse.parts.length > 1;

  // An empty card is not offered to the loop (rule 7): the button ghosts and says why.
  const blocked =
    peType === 'verse' && verse.text.trim() === ''
      ? 'Pick a verse first'
      : peType === 'list' && points.length === 0
        ? 'Add at least one item first'
        : peType === 'image' && peSrc === ''
          ? 'Pick a picture first'
          : null;

  // Port of the prototype's savePreEdit field-mapping (Lectern.dc.html ~L856-866).
  const save = (): void => {
    if (blocked) return;
    const enabled = card?.enabled ?? true;
    const title = peTitle.trim() || autoTitle;
    if (peType === 'verse' && splitting) {
      // A card per verse, each named for its own reference, in reading order.
      for (const part of verse.parts) {
        window.helm.preservice.saveCard({
          type: 'verse',
          enabled,
          title: part.ref,
          ref: part.ref,
          text: part.text,
          version: verse.version
        });
      }
    } else if (peType === 'image') {
      window.helm.preservice.saveCard({ id: card?.id, type: 'image', enabled, title, src: peSrc });
    } else if (peType === 'verse') {
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
    peType === 'image'
      ? { id: card?.id ?? '', type: 'image', enabled: true, title: peTitle, src: peSrc }
      : peType === 'verse' && splitting
        ? { id: '', type: 'verse', enabled: true, title: '', ref: verse.parts[0].ref, text: verse.parts[0].text, version: verse.version }
        : peType === 'verse'
      ? { id: card?.id ?? '', type: 'verse', enabled: true, title: peTitle, ref: verse.ref.trim(), text: verse.text.trim(), version: verse.version }
      : peType === 'list'
        ? { id: card?.id ?? '', type: 'list', enabled: true, title: peTitle.trim() || 'List', points: peLines.split('\n') }
        : { id: card?.id ?? '', type: 'message', enabled: true, title: peTitle, headline, subtitle: peSubtitle.trim() };

  // Mod+Enter saves. Plain Enter cannot: it is a new line in the items and the verse
  // text, and the reference entry's own commit. Heard on the document rather than on the
  // editor's frame, because a pointer click on any of its buttons drops focus to BODY
  // (blurOnPointerClick) and the shortcut has to work from there too. Re-attached each
  // render so it always runs the current draft's save.
  useEffect(() => {
    if (hidden) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      save();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

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
  const segStyle = (on: boolean): CSSProperties => ({
    flex: 1,
    height: '28px',
    borderRadius: '7px',
    fontSize: '12px',
    fontWeight: on ? 700 : 600,
    color: on ? T.accentInk : T.dim,
    background: on ? T.accent : T.panel2,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    whiteSpace: 'nowrap'
  });
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
        {peType === 'image' && blocked ? (
          <div
            data-preview-empty
            style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 28px', textAlign: 'center', fontSize: '12.5px', lineHeight: 1.5, color: T.faint, background: T.panel2 }}
          >
            The card shows here as soon as a picture is picked.
          </div>
        ) : peType === 'verse' && blocked ? (
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

  if (hidden) return null;

  return (
    // A fixed frame (rule 5): the three card types differ in how much they hold, and the
    // editor used to change height and jump on screen as the operator switched between
    // them. Find or write on the left, the card as the room will see it on the right.
    // A click beside the editor cancels like the Cancel button; the page keeps a draft
    // with something in it behind a five-second Undo, so a stray click costs nothing.
    <ModalShell onClose={cancel} width="100%" maxWidth="940px" height="680px" maxHeight="90vh">
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
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
                {isNew && verse.parts.length > 1 && (
                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }} data-split>
                    <button style={segStyle(!split)} onClick={() => setSplit(false)}>
                      One card
                    </button>
                    <button style={segStyle(split)} onClick={() => setSplit(true)}>
                      A card per verse
                    </button>
                  </div>
                )}
                {splitting && (
                  <div style={noteStyle} data-split-note>
                    {`Adds ${verse.parts.length} cards, ${verse.parts[0].ref} to ${verse.parts[verse.parts.length - 1].ref}, each named for its verse. The preview shows the first.`}
                  </div>
                )}
                {!splitting && cardNameField(autoTitle)}
                <div style={{ flex: 1, minHeight: 0, display: splitting ? 'none' : 'flex', flexDirection: 'column' }}>
                  <div style={fieldLabelStyle}>VERSE TEXT</div>
                  <textarea
                    style={areaStyle}
                    value={verse.text}
                    onChange={(e) => verse.editText(e.target.value)}
                    placeholder="Pick a verse on the left, or type the words here"
                  />
                  {verse.text.length > VERSE_COMFORTABLE && (
                    <div style={noteStyle} data-verse-long>
                      A long passage for one card: the words shrink to fit. Shift-click a shorter range, or give each verse its own card, to keep it readable from the back.
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
          {peType === 'image' && (
            <>
              <div style={columnStyle}>
                <div style={fieldLabelStyle}>PICTURE</div>
                <button
                  style={{ ...suggestStyle, width: '100%', height: '34px', borderRadius: '9px', fontSize: '12.5px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                  onClick={importPictures}
                >
                  + Import
                </button>
                <div style={{ ...noteStyle, marginBottom: '8px' }}>Pictures come from the media library the Slides track uses.</div>
                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                  {pictures !== null && pictures.length === 0 && (
                    <ListEmpty>
                      No pictures in the media library yet. Bring some in with <b>+ Import</b>.
                    </ListEmpty>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '8px' }}>
                    {(pictures ?? []).map((m) => {
                      const src = mediaSrc(m.filePath as string);
                      const on = src === peSrc;
                      return (
                        <button
                          key={m.id}
                          data-picture={m.id}
                          data-selected={on || undefined}
                          title={m.title}
                          onClick={() => {
                            setPeSrc(src);
                            setEdited(true);
                          }}
                          style={{ display: 'block', padding: '4px', borderRadius: '9px', background: on ? `${T.accent}22` : T.panel2, boxShadow: on ? `inset 0 0 0 1.5px ${T.accent}` : `inset 0 0 0 1px ${T.hairline}` }}
                        >
                          <img src={src} alt="" draggable={false} style={{ display: 'block', width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: '6px' }} />
                          <div style={{ fontSize: '11px', color: on ? T.text : T.dim, marginTop: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {m.title}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div style={{ ...columnStyle, gap: '12px' }}>
                {preview}
                {cardNameField(autoTitle)}
              </div>
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
          <button style={smallGhost} onClick={cancel}>
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
