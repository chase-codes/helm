import { useCallback, useEffect, useState } from 'react';

export interface TimedUndo<T> {
  /** The item pending undo, or null. */
  pending: T | null;
  /** Arm the undo affordance for `item`, (re)starting the dismissal timer. */
  arm: (item: T) => void;
  /** Clear it now (e.g. the user took the undo, or it's no longer relevant). */
  cancel: () => void;
}

/**
 * "Just did X — Undo" state with a self-clearing timer. State-driven: an effect owns the
 * timeout, so re-arming restarts it and unmount clears it automatically (no manual ref
 * bookkeeping). Reusable by any list track that wants immediate-remove-with-undo.
 */
export function useTimedUndo<T>(durationMs = 5000): TimedUndo<T> {
  const [pending, setPending] = useState<T | null>(null);
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(null), durationMs);
    return () => clearTimeout(t);
  }, [pending, durationMs]);
  const arm = useCallback((item: T): void => setPending(item), []);
  const cancel = useCallback((): void => setPending(null), []);
  return { pending, arm, cancel };
}
