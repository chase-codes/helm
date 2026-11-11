/** The one sentence every operator rail uses to explain its gestures
 * (docs/ux-vocabulary.md). Only the noun changes. `follows: false` is for a list whose
 * single click never moves the screen (the Scripture schedule, decision 3); `range` adds
 * the Shift-click clause where the rail selects ranges. */
export interface RailHintOpts {
  follows?: boolean;
  range?: 'select a range' | 'build a range';
}

export function railHint(noun: string, { follows = true, range }: RailHintOpts = {}): string {
  const cue = follows
    ? `Click a ${noun} to cue it; while it's live the screen follows.`
    : `Click a ${noun} to cue it.`;
  const parts = [cue, 'Double-click to go live.'];
  if (range) parts.push(`Shift-click to ${range}.`);
  return parts.join(' ');
}
