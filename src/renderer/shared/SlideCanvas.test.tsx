// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { SlideCanvas } from './SlideCanvas';

test('renders lyric lines', () => {
  render(<SlideCanvas slide={{ kind: 'lyrics', lines: ['Amazing grace!', 'How sweet'] }} />);
  expect(screen.getByText('Amazing grace!')).toBeTruthy();
});
test('logo shows HELM', () => {
  render(<SlideCanvas slide={{ kind: 'logo' }} />);
  expect(screen.getByText('HELM')).toBeTruthy();
});
test('black renders no visible text', () => {
  const { container } = render(<SlideCanvas slide={{ kind: 'black' }} />);
  expect(container.textContent).toBe('');
});
test('scripture renders ref and columns', () => {
  render(<SlideCanvas slide={{ kind: 'scripture', ref: 'John 3:16', columns: [{ version: 'KJV', text: 'For God so loved…' }] }} />);
  expect(screen.getByText('John 3:16')).toBeTruthy();
  expect(screen.getByText('KJV')).toBeTruthy();
});
