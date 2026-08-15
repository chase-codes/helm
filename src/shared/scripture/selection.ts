import type { ParsedRef } from './refs'
import { initialBuilder, toParsedRef, type RefBuilderState } from './refBuilder'

/** Where the operator is: the verse the hero shows, the arrows step, and — when output is
 * live — the projector displays. One cursor, moved identically by a rail tap, an arrow key,
 * and a schedule-row click. */
export interface Cursor {
  book: string
  ch: number
  v: number
}

export interface RailSelection {
  cursor: Cursor
  builder: RefBuilderState
}

/** What a click on a verse card means.
 *
 * Plain tap moves the cursor to the tapped verse and clears the builder — the operator
 * reached for the rail, so any pending range (or half-typed ref) is stale. Shift-tap leaves
 * the cursor alone and writes a range into the builder instead, anchored at the cursor, so
 * tap-then-shift-tap reads as "from here to there".
 *
 * `preview` is the book/chapter the rail is currently showing, which diverges from the
 * cursor only while a typed reference is resolving in the builder.
 *
 * The anchor for a shift-tap, in order: a start verse the operator has already TYPED into
 * the builder for the very book and chapter on the rail (`Genesis 1:5` then shift-tap 9 is
 * `Genesis 1:5-9`) — that number is what `selectedRange` highlights on the rail, so
 * anchoring anywhere else would contradict what the operator can see; failing that, the
 * cursor, when the rail is previewing the cursor's own chapter; failing that, the tapped
 * verse itself, since a cross-chapter range is never what was meant.
 *
 * Takes the builder but deliberately no BookExtent: the tapped verse comes from a rail card
 * that only exists for verses the chapter has, so there is nothing to clamp. */
export function railSelect(
  builder: RefBuilderState,
  cursor: Cursor,
  preview: { book: string; ch: number },
  v: number,
  shift: boolean
): RailSelection {
  if (!shift) {
    return { cursor: { book: preview.book, ch: preview.ch, v }, builder: initialBuilder() }
  }
  // A typed start verse only anchors when it names the previewed book AND chapter —
  // otherwise it belongs to some other reference and would invent a cross-chapter range.
  //
  // When the builder already holds a COMPLETE range for this chapter, the anchor is the
  // endpoint the tap is not on. That makes a repeated shift-tap on either endpoint rebuild
  // the identical range instead of collapsing it onto the tapped verse — the idempotence a
  // shift-DOUBLE-click depends on (#58), since both of its clicks run this. A plain
  // `startVerse` anchor was idempotent only for a range built FORWARD (tap above the
  // cursor); tapping below the cursor lands the tapped verse in `startVerse`, so the second
  // click re-anchored on it and silently ate the operator's pending range.
  const mine = builder.book === preview.book && builder.chapter === preview.ch
  const typed = !mine
    ? null
    : builder.endVerse !== null && builder.startVerse === v
      ? builder.endVerse
      : builder.startVerse
  const anchor =
    typed ?? (preview.book === cursor.book && preview.ch === cursor.ch ? cursor.v : null)
  const base: RefBuilderState = {
    ...initialBuilder(),
    stage: 'verse',
    book: preview.book,
    chapter: preview.ch,
    startVerse: anchor ?? v
  }
  if (anchor === null) return { cursor, builder: base }
  return {
    cursor,
    builder: {
      ...base,
      startVerse: Math.min(anchor, v),
      endVerse: Math.max(anchor, v),
      stage: 'endVerse'
    }
  }
}

/** What `+ Add` and Enter would file: the typed reference when the entry holds one, else
 * the cursor's single verse. Never null — there is always a cursor, so the affordance is
 * always offered, which is what a mouse-only operator needs. */
export function addTarget(builder: RefBuilderState, cursor: Cursor): ParsedRef {
  return toParsedRef(builder) ?? { book: cursor.book, ch: cursor.ch, from: cursor.v, to: cursor.v }
}
