import type { TimingMap } from '../types';

export function activeOrdAt(map: TimingMap, t: number): number {
  if (!map.length) return 0;
  if (t < map[0].tStart) return map[0].ord;
  let cur = map[0].ord;
  for (const span of map) {
    if (t >= span.tStart) cur = span.ord;
    if (t >= span.tStart && t < span.tEnd) return span.ord;
  }
  return cur; // past the last span, or in a gap → hold the latest started ord
}
