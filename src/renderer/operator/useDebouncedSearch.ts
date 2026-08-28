import { useEffect, useRef } from 'react';

/** Trailing keystroke debounce for the per-keystroke IPC searches (#15). Short enough to
 * read as instant at typing speed, long enough that a burst of keystrokes costs one query. */
export const SEARCH_DEBOUNCE_MS = 120;

/**
 * Run `search` for `query`, coalescing a burst of query changes into one call and
 * cancelling the reply of any superseded run.
 *
 * - `query === null` means "nothing to search" — no call is made, but the previous run's
 *   reply is still cancelled.
 * - A change of `query` alone fires after `delayMs` (trailing edge): a synchronous burst of
 *   keystrokes lands as exactly one search for the final value.
 * - A change of `scope` (the search field, tape scope, translation…) fires IMMEDIATELY —
 *   the ruling on #15 is that a deliberate switch should not wait behind the typing
 *   debounce. Cheap to honour: scope switches are clicks, not bursts.
 * - `stillWanted()` is the `live` flag every call site used to hand-roll: it reads false
 *   once a newer query/scope has taken over or the host unmounted, so a slow reply can never
 *   land under a query it does not answer.
 *
 * `search` is read through a ref, so callers may pass an inline closure without re-arming
 * the timer every render.
 */
export function useDebouncedSearch<S>(
  query: string | null,
  scope: S,
  search: (query: string, stillWanted: () => boolean) => void,
  delayMs: number = SEARCH_DEBOUNCE_MS
): void {
  const searchRef = useRef(search);
  useEffect(() => {
    searchRef.current = search;
  });

  const prevScopeRef = useRef(scope);
  useEffect(() => {
    const scopeChanged = !Object.is(prevScopeRef.current, scope);
    prevScopeRef.current = scope;
    if (query === null) return;
    let live = true;
    const fire = (): void => searchRef.current(query, () => live);
    const timer = scopeChanged ? null : window.setTimeout(fire, delayMs);
    if (scopeChanged) fire();
    return () => {
      live = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [query, scope, delayMs]);
}
