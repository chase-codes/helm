import { useCallback, useEffect, useRef } from 'react';
import { useTimedUndo, type TimedUndo } from './useTimedUndo';

export interface DeferredRemove<T> {
  /** The batch awaiting undo, or null. Drive an UndoToast off this. */
  pending: T[] | null;
  /** Optimistically drop `items` from the list, arm the undo, and schedule the real
   * commit. A no-op on an empty batch, so callers can pass a selection unguarded. */
  remove: (items: T[]) => void;
  /** Take the undo: cancels the pending commit and asks `restore` to re-read the list. */
  undo: () => void;
}

export interface DeferredRemoveOptions<T> {
  /** The irreversible delete. Called at most once per batch — on natural expiry, when a
   * newer removal supersedes this one, or on unmount. Never called if the undo is taken. */
  commit: (items: T[]) => void;
  /** Re-read the list from its source of truth. Runs on undo only. */
  restore: (items: T[]) => void;
  durationMs?: number;
}

/**
 * Immediate-remove-with-undo where the undo restores the list EXACTLY as it was —
 * position included. The one grammar every in-service list speaks (#86).
 *
 * The trick is that the removal is only optimistic: the caller drops the rows from its own
 * state right away, but the real `commit` is deferred until the undo window closes. Undo
 * therefore never has to reconstruct anything — it cancels the commit and re-reads the
 * source of truth, which still holds the original order. That is why this beats the
 * "delete now, re-add on undo" shape it replaces: a re-add appends, so undoing a delete
 * silently moved the row to the end of the schedule.
 *
 * Generalised from the media library's single-item version, which is where the pattern was
 * proven. `useTimedUndo` has one pending slot and cannot tell a user cancel from a timer
 * expiry, so the batch awaiting real deletion is tracked in a ref and committed exactly
 * once — dropping any of those paths would leave rows the operator saw removed still in
 * the database until the next refresh.
 */
export function useDeferredRemove<T>({
  commit,
  restore,
  durationMs
}: DeferredRemoveOptions<T>): DeferredRemove<T> {
  const undo: TimedUndo<T[]> = useTimedUndo<T[]>(durationMs);

  // Latest callbacks, read by the commit paths below. Without this the expiry/unmount
  // effects would need `commit` in their dep arrays, and a caller passing an inline arrow
  // (every caller) would re-run them on every render — re-committing, or worse, tearing
  // down the pending commit before its timer ever fired.
  const commitRef = useRef(commit);
  const restoreRef = useRef(restore);
  useEffect(() => {
    commitRef.current = commit;
    restoreRef.current = restore;
  });

  const armedRef = useRef<T[] | null>(null);
  const commitPending = useCallback((): void => {
    const batch = armedRef.current;
    armedRef.current = null;
    if (batch?.length) commitRef.current(batch);
  }, []);

  const remove = useCallback(
    (items: T[]): void => {
      if (!items.length) return;
      // A still-pending prior removal is superseded — commit it now, don't drop it.
      commitPending();
      armedRef.current = items;
      undo.arm(items);
    },
    [commitPending, undo]
  );

  const takeUndo = useCallback((): void => {
    const batch = undo.pending;
    if (!batch) return;
    // Disarm BEFORE cancel() flips `undo.pending` to null, so the expiry effect below sees
    // nothing to commit — an undo and a timer expiry look identical from `pending`.
    armedRef.current = null;
    undo.cancel();
    restoreRef.current(batch);
  }, [undo]);

  // Commit on natural expiry: `pending` clears while a commit is still armed. (Undo clears
  // `armedRef` first, so this runs as a no-op in that case.)
  useEffect(() => {
    if (undo.pending) return;
    commitPending();
  }, [undo.pending, commitPending]);

  // Backstop for a surface that unmounts inside the undo window — the row is gone from the
  // operator's view either way, so it must not survive in the database.
  useEffect(() => () => commitPending(), [commitPending]);

  return { pending: undo.pending, remove, undo: takeUndo };
}
