// @vitest-environment jsdom
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState, type JSX } from 'react';
import { useDeferredRemove } from './useDeferredRemove';

afterEach(cleanup);

interface Log {
  commits: string[][];
  restores: string[][];
}

function Host({ log }: { log: Log }): JSX.Element {
  const [items, setItems] = useState(['a', 'b', 'c']);
  const d = useDeferredRemove<string>({
    commit: (batch) => log.commits.push(batch),
    restore: (batch) => {
      log.restores.push(batch);
      // Stands in for a list refetch: puts the source of truth back verbatim.
      setItems(['a', 'b', 'c']);
    }
  });
  const drop = (ids: string[]): void => {
    setItems((l) => l.filter((i) => !ids.includes(i)));
    d.remove(ids);
  };
  return (
    <div>
      <span data-testid="items">{items.join(',')}</span>
      <span data-testid="pending">{d.pending?.join(',') ?? 'none'}</span>
      <button onClick={() => drop(['b'])}>drop-b</button>
      <button onClick={() => drop(['a', 'c'])}>drop-ac</button>
      <button onClick={() => drop([])}>drop-none</button>
      <button onClick={() => d.undo()}>undo</button>
    </div>
  );
}

function setup(): Log {
  const log: Log = { commits: [], restores: [] };
  render(<Host log={log} />);
  return log;
}

describe('useDeferredRemove', () => {
  it('arms the undo without committing, then commits once the window closes', () => {
    vi.useFakeTimers();
    try {
      const log = setup();
      fireEvent.click(screen.getByText('drop-b'));
      expect(screen.getByTestId('items').textContent).toBe('a,c');
      expect(screen.getByTestId('pending').textContent).toBe('b');
      expect(log.commits).toEqual([]);

      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(log.commits).toEqual([['b']]);
      expect(screen.getByTestId('pending').textContent).toBe('none');
    } finally {
      vi.useRealTimers();
    }
  });

  it('undo cancels the commit and restores the list in its original order', () => {
    vi.useFakeTimers();
    try {
      const log = setup();
      fireEvent.click(screen.getByText('drop-b'));
      fireEvent.click(screen.getByText('undo'));

      expect(log.restores).toEqual([['b']]);
      expect(screen.getByTestId('items').textContent).toBe('a,b,c');
      expect(screen.getByTestId('pending').textContent).toBe('none');

      // The cancelled commit must never fire, however long we wait.
      act(() => {
        vi.advanceTimersByTime(60000);
      });
      expect(log.commits).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a second removal supersedes the first, committing it rather than dropping it', () => {
    vi.useFakeTimers();
    try {
      const log = setup();
      fireEvent.click(screen.getByText('drop-b'));
      fireEvent.click(screen.getByText('drop-ac'));

      expect(log.commits).toEqual([['b']]);
      expect(screen.getByTestId('pending').textContent).toBe('a,c');

      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(log.commits).toEqual([['b'], ['a', 'c']]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('undo after a supersede restores only the newer batch', () => {
    vi.useFakeTimers();
    try {
      const log = setup();
      fireEvent.click(screen.getByText('drop-b'));
      fireEvent.click(screen.getByText('drop-ac'));
      fireEvent.click(screen.getByText('undo'));

      expect(log.restores).toEqual([['a', 'c']]);
      act(() => {
        vi.advanceTimersByTime(60000);
      });
      expect(log.commits).toEqual([['b']]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes a whole batch in one call', () => {
    vi.useFakeTimers();
    try {
      const log = setup();
      fireEvent.click(screen.getByText('drop-ac'));
      expect(screen.getByTestId('items').textContent).toBe('b');
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(log.commits).toEqual([['a', 'c']]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an empty batch arms nothing', () => {
    const log = setup();
    fireEvent.click(screen.getByText('drop-none'));
    expect(screen.getByTestId('pending').textContent).toBe('none');
    expect(log.commits).toEqual([]);
  });

  it('undo with nothing pending is a no-op', () => {
    const log = setup();
    fireEvent.click(screen.getByText('undo'));
    expect(log.restores).toEqual([]);
    expect(log.commits).toEqual([]);
  });

  it('commits a still-pending removal on unmount', () => {
    vi.useFakeTimers();
    try {
      const log = setup();
      fireEvent.click(screen.getByText('drop-b'));
      expect(log.commits).toEqual([]);
      cleanup();
      expect(log.commits).toEqual([['b']]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not re-commit on unmount after the window already closed', () => {
    vi.useFakeTimers();
    try {
      const log = setup();
      fireEvent.click(screen.getByText('drop-b'));
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      cleanup();
      expect(log.commits).toEqual([['b']]);
    } finally {
      vi.useRealTimers();
    }
  });
});
