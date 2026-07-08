/**
 * The id to select after removing `removedId` from `items`: the following row if any,
 * else the preceding row, else '' (list became empty, or the id wasn't present).
 * Pure — mirrors the neighbor-selection contract described for useListSelection.
 */
export function pickNeighborId(items: { id: string }[], removedId: string): string {
  const idx = items.findIndex((i) => i.id === removedId);
  if (idx === -1) return '';
  const next = items[idx + 1] ?? items[idx - 1];
  return next?.id ?? '';
}
