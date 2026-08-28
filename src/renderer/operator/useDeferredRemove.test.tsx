// @vitest-environment jsdom
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState, type JSX } from 'react';
import { filterPending, useDeferredRemove, type DeferredRemove } from './useDeferredRemove';

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

  // The moment that matters is not when `commit` is entered — it is when that commit's IPC
  // REPLY lands, which is after `remove` has armed the next batch. A reply carries the whole
  // list, so a consumer applying it verbatim would resurrect the batch now in the window.
  it("pendingNow names the newer batch by the time a superseded commit's reply lands", async () => {
    const seen: string[][] = []
    let resolveFirst: () => void = () => {}
    function Probe(): JSX.Element {
      const d = useDeferredRemove<string>({
        commit: (batch) => {
          // Models the IPC round trip each real consumer makes.
          const reply =
            batch[0] === 'a' ? new Promise<void>((r) => (resolveFirst = r)) : Promise.resolve()
          void reply.then(() => seen.push(d.pendingNow()))
        },
        restore: () => {}
      })
      return (
        <div>
          <button onClick={() => d.remove(['a'])}>rm-a</button>
          <button onClick={() => d.remove(['b'])}>rm-b</button>
        </div>
      )
    }
    render(<Probe />)
    fireEvent.click(screen.getByText('rm-a'))
    fireEvent.click(screen.getByText('rm-b')) // commits 'a', arms 'b'

    await act(async () => {
      resolveFirst()
    })
    expect(seen[0]).toEqual(['b'])
  })

  it('pendingNow is empty before any removal and after the window closes', () => {
    vi.useFakeTimers()
    try {
      const readings: string[][] = []
      function Probe(): JSX.Element {
        const d = useDeferredRemove<string>({ commit: () => {}, restore: () => {} })
        return (
          <div>
            <button onClick={() => readings.push(d.pendingNow())}>read</button>
            <button onClick={() => d.remove(['a'])}>rm</button>
          </div>
        )
      }
      render(<Probe />)
      fireEvent.click(screen.getByText('read'))
      fireEvent.click(screen.getByText('rm'))
      fireEvent.click(screen.getByText('read'))
      act(() => {
        vi.advanceTimersByTime(5000)
      })
      fireEvent.click(screen.getByText('read'))
      expect(readings).toEqual([[], ['a'], []])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('filterPending', () => {
  const undoStub = (pending: Array<{ id: string }>): DeferredRemove<{ id: string }> => ({
    pending: null,
    remove: () => {},
    undo: () => {},
    pendingNow: () => pending
  })

  it('drops rows still inside their undo window', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(filterPending(undoStub([{ id: 'b' }]), rows)).toEqual([{ id: 'a' }, { id: 'c' }])
  })

  it('returns the rows array untouched when nothing is pending', () => {
    const rows = [{ id: 'a' }, { id: 'b' }]
    expect(filterPending(undoStub([]), rows)).toBe(rows)
  })
})
