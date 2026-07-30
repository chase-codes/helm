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
 * cursor only while a typed reference is resolving in the builder. A shift-tap there has no
 * sensible anchor (the cursor is in a different chapter), so it starts a fresh one on the
 * tapped verse rather than inventing a cross-chapter range.
 *
 * Deliberately takes neither the current builder nor a BookExtent: shift-tap always anchors
 * at the cursor, so a pending builder range is never consulted, and the tapped verse comes
 * from a rail card that only exists for verses the chapter has, so there is nothing to
 * clamp. */
export function railSelect(
  cursor: Cursor,
  preview: { book: string; ch: number },
  v: number,
  shift: boolean
): RailSelection {
  if (!shift) {
    return { cursor: { book: preview.book, ch: preview.ch, v }, builder: initialBuilder() }
  }
  const anchored = preview.book === cursor.book && preview.ch === cursor.ch
  const base: RefBuilderState = {
    ...initialBuilder(),
    stage: 'verse',
    book: preview.book,
    chapter: preview.ch,
    startVerse: anchored ? cursor.v : v
  }
  if (anchored) {
    return {
      cursor,
      builder: {
        ...base,
        startVerse: Math.min(cursor.v, v),
        endVerse: Math.max(cursor.v, v),
        stage: 'endVerse'
      }
    }
  }
  return { cursor, builder: base }
}

/** What `+ Add` and Enter would file: the typed reference when the entry holds one, else
 * the cursor's single verse. Never null — there is always a cursor, so the affordance is
 * always offered, which is what a mouse-only operator needs. */
export function addTarget(builder: RefBuilderState, cursor: Cursor): ParsedRef {
  return toParsedRef(builder) ?? { book: cursor.book, ch: cursor.ch, from: cursor.v, to: cursor.v }
}
