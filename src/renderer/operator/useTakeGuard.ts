import { useCallback, useEffect, useRef } from 'react';
import type { OutputMode } from '../../shared/types';

/**
 * Latest-take-wins guard for the double-click takes that must resolve an async fetch
 * before they can reach the screen (#58).
 *
 * `takeLive` starts projecting and never stops, so nothing in the app ever undoes a take
 * that lands late. Double-click a schedule row whose chapter isn't cached, press Escape
 * before the IPC resolves, and the late take re-lights the projector on the very reading
 * the operator just took down — with no effect re-run to correct it. Racing two
 * double-clicks has the same shape: the SLOWER fetch wins and the screen sticks on
 * whatever was asked for first.
 *
 * Call `beginTake()` at the top of every activate handler — including the branch that
 * takes synchronously, which is what makes the second of two racing double-clicks cancel
 * the first — and call the predicate it returns immediately before touching the screen.
 *
 * A pending take is cancelled by a later take request, by the mode unmounting, or by the
 * operator taking the screen DOWN while the fetch is in flight. Note that last one is a
 * TRANSITION (live → not live), not a level: taking from black is the ordinary case and
 * must still land.
 *
 * The transition rule would also cancel on live → logo, but no operator control reaches
 * that state any more (#97 removed the logo toggle), so in practice only take-down cancels.
 */
export function useTakeGuard(output: OutputMode): () => () => boolean {
  const seq = useRef(0);
  const prevOutput = useRef(output);
  useEffect(() => {
    const was = prevOutput.current;
    prevOutput.current = output;
    if (was === 'live' && output !== 'live') seq.current += 1;
  }, [output]);
  useEffect(
    () => () => {
      seq.current += 1;
    },
    []
  );
  return useCallback((): (() => boolean) => {
    const mine = seq.current + 1;
    seq.current = mine;
    return () => mine === seq.current;
  }, []);
}
