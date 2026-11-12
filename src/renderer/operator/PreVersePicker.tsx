import { useEffect, useRef, type CSSProperties, type JSX, type RefObject } from 'react';
import type { Theme } from '../../shared/theme';
import { INSTALL_HINT } from '../../shared/scripture/labels';
import { MONO } from '../shared/fonts';
import { ListEmpty } from './ListEmpty';
import { ScriptureEntry } from './ScriptureEntry';
import { ScriptureSearchResults } from './ScriptureSearchResults';
import type { PreVerse } from './usePreVerse';

export interface PreVersePickerProps {
  theme: Theme;
  verse: PreVerse;
  entryRef: RefObject<HTMLInputElement | null>;
}

// The verse rail's own sentence shape and words (docs/ux-vocabulary.md): Click, Shift-click,
// "build a range". Nothing is cued or live in an editor, so the verb is the card's.
const VERSE_HINT = 'Click a verse to put it on the card. Shift-click to build a range.';

/**
 * The verse card's finder: the Scripture track's entry on top, and under it whatever the
 * entry has reached: search hits, a book's chapters, or a chapter open to read. Reading
 * the chapter is the point: an operator choosing a welcome verse wants to see the verses
 * either side of it before one goes on a card.
 */
export function PreVersePicker({ theme: T, verse, entryRef }: PreVersePickerProps): JSX.Element {
  const { view } = verse;
  const listRef = useRef<HTMLDivElement | null>(null);

  // Keep the picked verse in view: a hit committed from search opens its chapter at verse
  // 1, and the verse that was picked may be forty rows down.
  const openKey = view.kind === 'verses' ? `${view.book}|${view.ch}|${view.chapter ? 'in' : 'out'}` : null;
  const selectedFrom = view.kind === 'verses' ? view.selected?.from ?? null : null;
  useEffect(() => {
    if (selectedFrom === null) {
      if (listRef.current) listRef.current.scrollTop = 0;
      return;
    }
    listRef.current?.querySelector(`[data-pick-verse="${selectedFrom}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [openKey, selectedFrom]);

  const labelStyle: CSSProperties = { fontSize: '10px', letterSpacing: '0.1em', color: T.faint, fontWeight: 600 };
  const paneStyle: CSSProperties = { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', marginTop: '12px' };
  const scrollStyle: CSSProperties = { flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '3px' };
  const hintStyle: CSSProperties = { fontSize: '11.5px', color: T.faint, lineHeight: 1.45, margin: '5px 0 8px', flexShrink: 0 };
  const headRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, minHeight: '26px' };
  const stepStyle = (enabled: boolean): CSSProperties => ({
    height: '26px',
    padding: '0 9px',
    borderRadius: '7px',
    fontSize: '11.5px',
    fontWeight: 600,
    whiteSpace: 'nowrap',
    flexShrink: 0,
    color: enabled ? T.dim : T.faint,
    opacity: enabled ? 1 : 0.5,
    boxShadow: `inset 0 0 0 1px ${T.border}`
  });

  let pane: JSX.Element | null = null;
  if (view.kind === 'search') {
    pane = (
      // The results list carries the rail's own side padding; pull it back out so its rows
      // line up with the entry above.
      <div style={{ ...paneStyle, margin: '12px -10px 0' }} data-verse-view="search">
        <ScriptureSearchResults theme={T} search={view.search} accent={T.accent} />
      </div>
    );
  } else if (view.kind === 'empty') {
    pane = (
      <div style={paneStyle} data-verse-view="empty">
        <ListEmpty>
          {verse.bible === null ? (
            INSTALL_HINT
          ) : (
            <>
              Verses show here to read and pick. Type a reference like <b>John 3:16</b> above, or search a word or a story.
            </>
          )}
        </ListEmpty>
      </div>
    );
  } else if (view.kind === 'chapters') {
    const chapters = Array.from({ length: view.chapters }, (_, i) => i + 1);
    pane = (
      <div style={paneStyle} data-verse-view="chapters">
        <div style={headRowStyle}>
          <span style={{ ...labelStyle, textTransform: 'uppercase' }}>{view.book}</span>
        </div>
        <div style={hintStyle}>Click a chapter to read it, or keep typing.</div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(40px, 1fr))', gap: '6px' }}>
            {chapters.map((n) => (
              <button
                key={n}
                data-pick-chapter={n}
                onClick={() => verse.pickChapter(n)}
                style={{
                  height: '32px',
                  borderRadius: '8px',
                  fontFamily: MONO,
                  fontSize: '12px',
                  color: T.dim,
                  background: T.panel2,
                  boxShadow: `inset 0 0 0 1px ${T.hairline}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  } else if (view.kind === 'verses') {
    const verses = view.chapter ? Array.from({ length: view.chapter.verseCount }, (_, i) => i + 1) : [];
    const bibleId = verse.bible?.id;
    const canPrev = view.ch > 1;
    // An unknown extent (not fetched yet) must not ghost Next: only a known last chapter does.
    const canNext = view.chapters === 0 || view.ch < view.chapters;
    pane = (
      <div style={paneStyle} data-verse-view="verses">
        <div style={headRowStyle}>
          <span style={{ ...labelStyle, flex: 1, minWidth: 0, textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {`${view.book} ${view.ch}${verse.bible ? ` · ${verse.bible.abbr}` : ''}`}
          </span>
          <button style={stepStyle(canPrev)} disabled={!canPrev} title="Previous chapter" onClick={() => verse.pickChapter(view.ch - 1)}>
            ‹ Previous
          </button>
          <button style={stepStyle(canNext)} disabled={!canNext} title="Next chapter" onClick={() => verse.pickChapter(view.ch + 1)}>
            Next ›
          </button>
        </div>
        <div style={hintStyle}>{VERSE_HINT}</div>
        <div ref={listRef} style={scrollStyle}>
          {verse.bible === null && <ListEmpty>{INSTALL_HINT}</ListEmpty>}
          {verse.bible && view.chapter && view.chapter.verseCount === 0 && (
            <ListEmpty>{`${view.book} has no chapter ${view.ch} in ${verse.bible.abbr}.`}</ListEmpty>
          )}
          {bibleId !== undefined &&
            verses.map((v) => {
              const selected = view.selected !== null && v >= view.selected.from && v <= view.selected.to;
              return (
                <button
                  key={v}
                  data-pick-verse={v}
                  data-selected={selected || undefined}
                  onClick={(e) => verse.pickVerse(v, e.shiftKey)}
                  style={{
                    display: 'flex',
                    gap: '10px',
                    alignItems: 'baseline',
                    width: '100%',
                    textAlign: 'left',
                    padding: '7px 10px',
                    borderRadius: '9px',
                    userSelect: 'none',
                    flexShrink: 0,
                    background: selected ? `${T.accent}22` : 'transparent',
                    boxShadow: selected ? `inset 0 0 0 1.5px ${T.accent}` : 'none'
                  }}
                >
                  <span style={{ fontFamily: MONO, fontSize: '11px', width: '20px', flexShrink: 0, textAlign: 'right', color: selected ? T.accent : T.faint }}>
                    {v}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: '13px', lineHeight: 1.45, color: selected ? T.text : T.dim }}>
                    {view.chapter?.verses[v]?.[bibleId] ?? ''}
                  </span>
                </button>
              );
            })}
        </div>
      </div>
    );
  }

  return (
    // A pointer click on a button drops focus to BODY (blurOnPointerClick). Picking is part
    // of a keyboard flow, so any click in the finder hands focus back to the entry: the
    // next keystroke refines the reference, and the editor's save shortcut still has a
    // field to fire from.
    <div
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      onClick={() => entryRef.current?.focus()}
    >
      <div style={{ ...labelStyle, marginBottom: '6px', flexShrink: 0 }}>FIND A VERSE</div>
      <div style={{ flexShrink: 0 }}>
        <ScriptureEntry
          theme={T}
          accent={T.accent}
          value={verse.entry.value}
          ghost={verse.entry.ghost}
          onChange={verse.entry.onChange}
          onKeyDown={verse.entry.onKeyDown}
          inputRef={entryRef}
          placeholder="John 3:16, or search a word"
        />
      </div>
      {verse.problem && (
        <div data-verse-problem style={{ fontSize: '11.5px', color: T.dim, marginTop: '6px', flexShrink: 0 }}>
          {verse.problem}
        </div>
      )}
      {pane}
    </div>
  );
}
