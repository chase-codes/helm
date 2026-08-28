/**
 * The operator overlay z-index ladder. Ordering invariant, bottom to top:
 * popover scrim < popover < page modal < stacked modal / header popover < context menu —
 * a menu opened from inside a stacked modal must still land on top of it.
 */
export const Z_POPOVER_SCRIM = 39;
export const Z_POPOVER = 40;
export const Z_MODAL = 50;
export const Z_STACKED_MODAL = 60;
export const Z_MENU = 61;
