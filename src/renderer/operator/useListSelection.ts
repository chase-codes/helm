import { useCallback, useState } from 'react';

export interface ListSelection {
  /** The id of the currently selected row, or null. */
  selectedId: string | null;
  select: (id: string) => void;
  clear: () => void;
  isSelected: (id: string) => boolean;
}

/**
 * Shared "one selected row" state for a list. The reusable pattern is: this hook for
 * selection + `ModeKeyHandler.onDelete` for the keyboard action + the context-menu
 * primitive for right-click — reused wherever a schedule/list appears.
 */
export function useListSelection(): ListSelection {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const select = useCallback((id: string): void => setSelectedId(id), []);
  const clear = useCallback((): void => setSelectedId(null), []);
  const isSelected = useCallback((id: string): boolean => id === selectedId, [selectedId]);
  return { selectedId, select, clear, isSelected };
}
