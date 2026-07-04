// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReadingCanvas } from './ReadingCanvas';

describe('ReadingCanvas', () => {
  const slide = {
    kind: 'reading' as const, title: 'The Rapture', source: 'Tape 65-1204', accent: '#a88bc4',
    activeOrd: 1,
    paras: [
      { label: 'E-1', text: 'Let us pray.' },
      { label: '76', text: 'Now, the Rapture is made up of three things.' },
    ],
  };
  it('renders all paragraphs, the header, and marks the active paragraph', () => {
    render(<ReadingCanvas slide={slide} />);
    expect(screen.getByText('Let us pray.')).toBeTruthy();
    expect(screen.getByText(/Now, the Rapture/)).toBeTruthy();
    expect(screen.getByText('The Rapture')).toBeTruthy();
    expect(screen.getByText(/¶76/)).toBeTruthy();
    // active paragraph (ord 1) carries the active marker
    const active = document.querySelector('[data-active="true"]');
    expect(active?.textContent).toContain('Now, the Rapture');
  });
  it('does not crash on empty paras', () => {
    render(<ReadingCanvas slide={{ kind: 'reading' as const, title: 'X', source: 'Y', accent: '#a88bc4', activeOrd: 0, paras: [] }} />);
    expect(screen.getByText('X')).toBeTruthy();
  });
});
