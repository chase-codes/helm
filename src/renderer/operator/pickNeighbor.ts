/**
 * The id to select after removing `removedIds` from `items`: the first surviving row at or
 * after the removal, else the last surviving row before it, else '' (the list became empty,
 * or none of the ids were present).
 *
 * Batch-shaped because every list delete is now a batch — a shift-click range removes a run
 * of rows, and the selection has to land somewhere sensible whichever run it was. Pure, so
 * the rule is testable without mounting a rail.
 */
export function pickNeighborId(items: { id: string }[], removedIds: string[]): string {
  const removed = new Set(removedIds);
  const firstIdx = items.findIndex((i) => removed.has(i.id));
  if (firstIdx === -1) return '';
  const after = items.slice(firstIdx).find((i) => !removed.has(i.id));
  if (after) return after.id;
  // Nothing survives after the removal — fall back to the nearest row before it.
  const before = items.slice(0, firstIdx).filter((i) => !removed.has(i.id));
  return before[before.length - 1]?.id ?? '';
}
