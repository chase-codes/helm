import { useCallback, useMemo, useState } from 'react';

export interface ListSelection {
  /** Selected row ids, in list order, pruned of ids no longer in the list. */
  selectedIds: string[];
  /** The single selected id when exactly one row is selected, else null. */
  selectedId: string | null;
  /** Plain click: selection becomes [id], and id becomes the range anchor. */
  select: (id: string) => void;
  /** Shift-click: the contiguous run between the anchor and id. The anchor stays
   * put (conventional pivot — a second shift-click re-ranges, never grows; the
   * behavior #22 pins as expected). With no live anchor, acts like select. */
  selectTo: (id: string) => void;
  clear: () => void;
  isSelected: (id: string) => boolean;
}

/**
 * Shared selection state for a list, now multi-capable. The reusable pattern is: this
 * hook for selection + `ModeKeyHandler.onDelete` for the keyboard action + the
 * context-menu primitive for right-click — reused wherever a schedule/list appears.
 *
 * `orderedIds` is the list's current order; `selectedIds` is derived against it, so
 * rows deleted elsewhere fall out of the selection with no effect bookkeeping.
 */
export function useListSelection(orderedIds: string[]): ListSelection {
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  const selectedIds = useMemo(() => {
    const set = new Set(picked);
    return orderedIds.filter((id) => set.has(id));
  }, [orderedIds, picked]);

  const select = useCallback((id: string): void => {
    setPicked([id]);
    setAnchorId(id);
  }, []);

  const selectTo = useCallback(
    (id: string): void => {
      const anchor = anchorId !== null && orderedIds.includes(anchorId) ? anchorId : null;
      if (anchor === null || !orderedIds.includes(id)) {
        setPicked([id]);
        setAnchorId(id);
        return;
      }
      const i = orderedIds.indexOf(anchor);
      const j = orderedIds.indexOf(id);
      const [lo, hi] = i <= j ? [i, j] : [j, i];
      setPicked(orderedIds.slice(lo, hi + 1));
    },
    [anchorId, orderedIds]
  );

  const clear = useCallback((): void => {
    setPicked([]);
    setAnchorId(null);
  }, []);

  const isSelected = useCallback((id: string): boolean => selectedIds.includes(id), [selectedIds]);

  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  return { selectedIds, selectedId, select, selectTo, clear, isSelected };
}
