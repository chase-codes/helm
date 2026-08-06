// @vitest-environment jsdom
import { render, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { usePanelWidth, type PanelWidthOpts } from './usePanelWidth';

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const OPTS: PanelWidthOpts = { def: 270, min: 200, max: 420, anchor: 'left' };

function Harness({ opts = OPTS, storageKey = 'testW' }: { opts?: PanelWidthOpts; storageKey?: string }) {
  const p = usePanelWidth(storageKey, opts);
  return (
    <div>
      <div data-testid="width">{p.width}</div>
      <div data-testid="dragging">{String(p.dragging)}</div>
      <div data-testid="divider" onMouseDown={p.startDrag} />
    </div>
  );
}

describe('usePanelWidth', () => {
  it('starts at the default when nothing is persisted', () => {
    const r = render(<Harness />);
    expect(r.getByTestId('width').textContent).toBe('270');
  });

  it('loads a persisted width, clamped to bounds', () => {
    localStorage.setItem('testW', '9999');
    const r = render(<Harness />);
    expect(r.getByTestId('width').textContent).toBe('420');
  });

  it('falls back to the default on an unparsable persisted value', () => {
    localStorage.setItem('testW', 'garbage');
    const r = render(<Harness />);
    expect(r.getByTestId('width').textContent).toBe('270');
  });

  it('drags a left-anchored panel wider with +dx, clamped, and persists on mouseup', () => {
    const r = render(<Harness />);
    fireEvent.mouseDown(r.getByTestId('divider'), { clientX: 100 });
    expect(r.getByTestId('dragging').textContent).toBe('true');
    expect(document.body.style.cursor).toBe('col-resize');
    fireEvent.mouseMove(window, { clientX: 150 });                 // +50
    expect(r.getByTestId('width').textContent).toBe('320');
    fireEvent.mouseMove(window, { clientX: 1000 });                // way past max
    expect(r.getByTestId('width').textContent).toBe('420');
    fireEvent.mouseUp(window);
    expect(r.getByTestId('dragging').textContent).toBe('false');
    expect(document.body.style.cursor).toBe('');
    expect(localStorage.getItem('testW')).toBe('420');
  });

  it('drags a right-anchored panel wider with -dx', () => {
    const r = render(
      <Harness opts={{ def: 330, min: 240, max: 520, anchor: 'right' }} />
    );
    fireEvent.mouseDown(r.getByTestId('divider'), { clientX: 400 });
    fireEvent.mouseMove(window, { clientX: 350 });                 // divider left → wider
    expect(r.getByTestId('width').textContent).toBe('380');
    fireEvent.mouseUp(window);
    expect(localStorage.getItem('testW')).toBe('380');
  });

  it('an unmount mid-drag cleans up without persisting', () => {
    const r = render(<Harness />);
    fireEvent.mouseDown(r.getByTestId('divider'), { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 150 });
    r.unmount();
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
    expect(localStorage.getItem('testW')).toBeNull();
  });

  it('drags a left-anchored panel from a clamped out-of-range persisted value', () => {
    // Persist an out-of-range value (9999, which clamps to 420)
    localStorage.setItem('testW', '9999');
    const r = render(<Harness />);
    // Rendered width should be clamped
    expect(r.getByTestId('width').textContent).toBe('420');
    // Start drag at clientX 100, move to 90 (delta = -10, left-anchor so 420 - 10 = 410)
    fireEvent.mouseDown(r.getByTestId('divider'), { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 90 });
    // Width should respond immediately from clamped 420, not stay frozen
    expect(r.getByTestId('width').textContent).toBe('410');
    fireEvent.mouseUp(window);
  });

  it('a second mousedown mid-drag does not reset the anchor or stack handlers', () => {
    const r = render(<Harness />);
    // Start first drag at clientX 100
    fireEvent.mouseDown(r.getByTestId('divider'), { clientX: 100 });
    expect(r.getByTestId('dragging').textContent).toBe('true');
    // Fire a second mousedown at clientX 300 (should be ignored)
    fireEvent.mouseDown(r.getByTestId('divider'), { clientX: 300 });
    // Move to 150 (first drag's anchor is 100, so +50 delta → 270 + 50 = 320)
    fireEvent.mouseMove(window, { clientX: 150 });
    expect(r.getByTestId('width').textContent).toBe('320');
    fireEvent.mouseUp(window);
    expect(r.getByTestId('dragging').textContent).toBe('false');
    // Persisted value should match the first drag's calculation, not affected by the second mousedown
    expect(localStorage.getItem('testW')).toBe('320');
  });
});
