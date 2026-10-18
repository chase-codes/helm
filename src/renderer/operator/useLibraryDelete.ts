import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import type { ContextMenuItem } from './ContextMenu';
import type { UseContextMenu } from './useContextMenu';

/** How long the armed label stays before lapsing back. Same value Settings uses for
 * uninstalling a Bible, because it is the same gesture. */
export const LIBRARY_CONFIRM_MS = 4000;
/** The confirm re-labels in place, so the second half of a double-click lands on the armed
 * label at the very coordinates the first half armed it. Clicks this soon after arming are
 * the tail of that double-click, not a decision, so they are ignored. */
export const CONFIRM_ARM_GUARD_MS = 350;

export const LIBRARY_DELETE = 'Delete from library';
export const LIBRARY_DELETE_ARMED = 'Really delete?';
export const LIBRARY_DELETE_LIVE = 'On screen — take it down first';

export interface LibraryRow {
  /** Items listed above the delete, e.g. Edit. */
  before?: ContextMenuItem[];
  /** The row is on the audience screen: the delete is refused, with the reason. Taking the
   * screen down first costs one click and leaves nothing projected without a row behind it. */
  isLive: boolean;
  /** The irreversible delete. Runs once, on the confirming click. */
  onDelete: () => void;
}

export interface LibraryDelete {
  /** Open `menu` for one row with a disarmed two-step delete. */
  open: (e: ReactMouseEvent, row: LibraryRow) => void;
  /** Drop any armed confirm. Call before opening a DIFFERENT menu on the same `menu`:
   * `update` rewrites whichever menu is open, so a timer left running would turn it into
   * this one four seconds later. */
  disarm: () => void;
}

/**
 * The library half of grammar rule 4: a library (every Sunday's store) confirms instead of
 * undoing, because deleting from it is library management that happens to live on an
 * in-service page. Two clicks in the same menu, no dialog, no undo, no Delete key, no
 * multi-select: no single keystroke and no range may empty a library (#90, decision 2).
 */
export function useLibraryDelete(menu: UseContextMenu): LibraryDelete {
  const lapseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const guardRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // False until the arm guard elapses. A timer rather than comparing clock readings: reading
  // the clock from a function the compiler cannot prove is event-only counts as an impure
  // call during render.
  const confirmableRef = useRef(false);

  const disarm = useCallback((): void => {
    if (lapseRef.current !== null) {
      clearTimeout(lapseRef.current);
      lapseRef.current = null;
    }
    if (guardRef.current !== null) {
      clearTimeout(guardRef.current);
      guardRef.current = null;
    }
    confirmableRef.current = false;
  }, []);
  useEffect(() => disarm, [disarm]);

  // Rebuilt rather than toggled through state: the menu captures its items when it opens,
  // so re-labelling means handing it a fresh array via `update`.
  const build = (row: LibraryRow, armed: boolean): ContextMenuItem[] => {
    const del: ContextMenuItem = row.isLive
      ? { label: LIBRARY_DELETE_LIVE, disabled: true, onSelect: () => {} }
      : {
          label: armed ? LIBRARY_DELETE_ARMED : LIBRARY_DELETE,
          danger: true,
          // Always keepOpen, closing by hand only once the delete commits. A click the arm
          // guard swallows must leave the armed label there to be pressed deliberately.
          keepOpen: true,
          onSelect: () => {
            if (!armed) {
              arm(row);
              return;
            }
            if (!confirmableRef.current) return;
            disarm();
            menu.close();
            row.onDelete();
          }
        };
    return [...(row.before ?? []), del];
  };

  const arm = (row: LibraryRow): void => {
    disarm();
    menu.update(build(row, true));
    guardRef.current = setTimeout(() => {
      guardRef.current = null;
      confirmableRef.current = true;
    }, CONFIRM_ARM_GUARD_MS);
    lapseRef.current = setTimeout(() => {
      lapseRef.current = null;
      menu.update(build(row, false));
    }, LIBRARY_CONFIRM_MS);
  };

  const open = (e: ReactMouseEvent, row: LibraryRow): void => {
    // Opening any menu disarms a confirm left armed on another row.
    disarm();
    menu.open(e, build(row, false));
  };

  return { open, disarm };
}
