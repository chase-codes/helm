// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JSX } from 'react';
import { DangerGhostButton } from './DangerGhostButton';
import { ThemeCtx } from './ThemeCtx';
import { themeFor } from '../../shared/theme';

afterEach(cleanup);

const T = themeFor('classic', 'dark');

// jsdom normalises every colour it parses to `rgb()`, so compare against that rather than
// against the theme's hex literal.
function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

function renderBtn(onClick = vi.fn()): { btn: HTMLElement; onClick: typeof onClick } {
  render(
    <ThemeCtx.Provider value={T}>
      <DangerGhostButton label="Clear all" onClick={onClick} />
    </ThemeCtx.Provider>
  );
  return { btn: screen.getByText('Clear all'), onClick };
}

describe('DangerGhostButton', () => {
  it('fires once per click, with no confirmation step', () => {
    const { btn, onClick } = renderBtn();
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is a real button footprint, not a text link', () => {
    const { btn } = renderBtn();
    // The old affordance was a bare 10px span of text; this must stay pressable-sized.
    expect(btn.style.height).toBe('26px');
    expect(btn.style.padding).toBe('0px 10px');
  });

  it('takes the live tint on hover and drops it again on leave', () => {
    const { btn } = renderBtn();
    expect(btn.style.color).not.toBe(rgb(T.live));

    fireEvent.mouseEnter(btn);
    expect(btn.style.color).toBe(rgb(T.live));
    expect(btn.style.boxShadow).toContain(T.live); // boxShadow is passed through verbatim

    fireEvent.mouseLeave(btn);
    expect(btn.style.color).toBe(rgb(T.dim));
  });

  it('shows the same warning colour for keyboard focus as for hover', () => {
    const { btn } = renderBtn();
    fireEvent.focus(btn);
    expect(btn.style.color).toBe(rgb(T.live));
    fireEvent.blur(btn);
    expect(btn.style.color).toBe(rgb(T.dim));
  });
});
