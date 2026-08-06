import { useRef, useState, useEffect, type MouseEvent as ReactMouseEvent } from 'react';

export interface PanelWidthOpts {
  def: number;
  min: number;
  max: number;
  /** Which edge the panel is anchored to. A 'right'-anchored panel grows as the
   *  divider moves LEFT (drag delta is inverted, `startW - dx`). */
  anchor: 'left' | 'right';
}
export interface PanelWidthControl {
  width: number;
  dragging: boolean;
  startDrag: (e: ReactMouseEvent) => void;
}

/** Loads a persisted panel width; falls back to `def` when missing/invalid (parses to NaN). */
function loadWidth(key: string, def: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return def;
    const v = parseFloat(raw);
    return Number.isFinite(v) ? v : def;
  } catch {
    return def;
  }
}

/**
 * Drag-to-resize width state for one side panel, persisted to localStorage on release.
 * Extracted from SongsMode's startColDrag: mousemove/mouseup on window, body cursor +
 * userSelect suppressed while dragging, persisted only on a real mouseup — an
 * unmount-aborted drag skips persisting (the width state it was mutating is being torn
 * down anyway).
 */
export function usePanelWidth(storageKey: string, opts: PanelWidthOpts): PanelWidthControl {
  const { def, min, max, anchor } = opts;
  const clamp = (v: number): number => Math.max(min, Math.min(max, v));
  const [width, setWidth] = useState(() => loadWidth(storageKey, def));
  const [dragging, setDragging] = useState(false);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  // Abort an in-flight drag if this hook unmounts mid-drag.
  useEffect(() => () => dragCleanupRef.current?.(), []);

  const startDrag = (e: ReactMouseEvent): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    let latest = startW;
    const onMove = (ev: MouseEvent): void => {
      const dx = ev.clientX - startX;
      latest = clamp(anchor === 'left' ? startW + dx : startW - dx);
      setWidth(latest);
    };
    const cleanup = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      dragCleanupRef.current = null;
    };
    const onUp = (): void => {
      cleanup();
      setDragging(false);
      try {
        localStorage.setItem(storageKey, String(latest));
      } catch {
        // localStorage unavailable (e.g. private mode) — width just won't persist.
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    dragCleanupRef.current = cleanup;
    setDragging(true);
  };

  // Defensive clamp at render time (mirrors SongsMode), in case a persisted value is
  // outside the current bounds (e.g. edited by hand in devtools).
  return { width: clamp(width), dragging, startDrag };
}
