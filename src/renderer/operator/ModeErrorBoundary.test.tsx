// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModeErrorBoundary } from './ModeErrorBoundary';
import { ThemeCtx } from './ThemeCtx';
import { themeFor } from '../../shared/theme';
import type { JSX } from 'react';

afterEach(cleanup);

const MODE_BOUNDARY_LOG = '[helm] operator mode crashed:';

let armed = true;
function Boom(): JSX.Element {
  if (armed) throw new Error('boom');
  return <div>healthy again</div>;
}

const renderBoundary = (): ReturnType<typeof render> =>
  render(
    <ThemeCtx.Provider value={themeFor('classic', 'dark')}>
      <ModeErrorBoundary label="Songs">
        <Boom />
      </ModeErrorBoundary>
    </ThemeCtx.Provider>
  );

describe('ModeErrorBoundary (#30)', () => {
  it('catches a mode crash and shows a fallback naming the page', () => {
    armed = true;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = renderBoundary();
    expect(r.getByText(/Songs page crashed/)).toBeTruthy();
    expect(spy.mock.calls.filter(([m]) => m === MODE_BOUNDARY_LOG).length).toBe(1);
    spy.mockRestore();
  });

  it('reload button remounts the subtree', () => {
    armed = true;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = renderBoundary();
    expect(r.getByText(/Songs page crashed/)).toBeTruthy();
    armed = false;
    fireEvent.click(r.getByRole('button', { name: /reload this page/i }));
    expect(r.getByText('healthy again')).toBeTruthy();
    expect(r.queryByText(/crashed/)).toBeNull();
    spy.mockRestore();
  });

  it('renders children untouched while healthy', () => {
    armed = false;
    const r = renderBoundary();
    expect(r.getByText('healthy again')).toBeTruthy();
  });
});
