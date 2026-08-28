// @vitest-environment jsdom
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState, type JSX } from 'react';
import { SEARCH_DEBOUNCE_MS, useDebouncedSearch } from './useDebouncedSearch';

afterEach(cleanup);

interface Call {
  query: string;
  scope: string;
  stillWanted: () => boolean;
}

function Host({ calls }: { calls: Call[] }): JSX.Element {
  const [q, setQ] = useState('');
  const [scope, setScope] = useState('all');
  useDebouncedSearch(q.trim() ? q : null, scope, (query, stillWanted) => {
    calls.push({ query, scope, stillWanted });
  });
  return (
    <div>
      <input placeholder="q" value={q} onChange={(e) => setQ(e.target.value)} />
      <button onClick={() => setScope('title')}>title</button>
    </div>
  );
}

const type = (value: string): void => {
  fireEvent.change(screen.getByPlaceholderText('q'), { target: { value } });
};

describe('useDebouncedSearch', () => {
  it('coalesces a burst of query changes into one trailing call for the final value', () => {
    vi.useFakeTimers();
    try {
      const calls: Call[] = [];
      render(<Host calls={calls} />);
      type('a');
      type('am');
      type('ama');
      expect(calls).toEqual([]);
      act(() => {
        vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
      });
      expect(calls).toEqual([]);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(calls.map((c) => c.query)).toEqual(['ama']);
      expect(calls[0].stillWanted()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a scope change fires immediately, without waiting out the debounce', () => {
    vi.useFakeTimers();
    try {
      const calls: Call[] = [];
      render(<Host calls={calls} />);
      type('ama');
      act(() => {
        vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      });
      expect(calls).toHaveLength(1);
      fireEvent.click(screen.getByText('title'));
      expect(calls).toHaveLength(2);
      expect(calls[1]).toMatchObject({ query: 'ama', scope: 'title' });
      // Nothing left armed: the immediate run is the run.
      act(() => {
        vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2);
      });
      expect(calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a superseded run reads stillWanted() as false once a newer query or scope takes over', () => {
    vi.useFakeTimers();
    try {
      const calls: Call[] = [];
      render(<Host calls={calls} />);
      type('ama');
      act(() => {
        vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      });
      type('amaz');
      expect(calls[0].stillWanted()).toBe(false);
      act(() => {
        vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      });
      expect(calls[1].stillWanted()).toBe(true);
      fireEvent.click(screen.getByText('title'));
      expect(calls[1].stillWanted()).toBe(false);
      expect(calls[2].stillWanted()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a null query makes no call and cancels the pending one', () => {
    vi.useFakeTimers();
    try {
      const calls: Call[] = [];
      render(<Host calls={calls} />);
      type('ama');
      type('');
      act(() => {
        vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2);
      });
      expect(calls).toEqual([]);
      // A scope change with nothing to search is also silent.
      fireEvent.click(screen.getByText('title'));
      expect(calls).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('unmounting cancels the pending run and the in-flight one', () => {
    vi.useFakeTimers();
    try {
      const calls: Call[] = [];
      const { unmount } = render(<Host calls={calls} />);
      type('ama');
      act(() => {
        vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      });
      type('amaz');
      unmount();
      act(() => {
        vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2);
      });
      expect(calls).toHaveLength(1);
      expect(calls[0].stillWanted()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
