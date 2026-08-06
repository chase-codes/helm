// @vitest-environment jsdom
import { render, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePanelWidth, type PanelWidthOpts } from './usePanelWidth';

afterEach(cleanup);

// Mock localStorage for jsdom environment
const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length;
    }
  };
})();

vi.stubGlobal('localStorage', mockLocalStorage);

beforeEach(() => mockLocalStorage.clear());

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
});
