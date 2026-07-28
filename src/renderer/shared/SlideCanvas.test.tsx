// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { SlideCanvas } from './SlideCanvas';

afterEach(cleanup);

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

test('lyric lines size from the fit property, falling back to a clamp', () => {
  render(<SlideCanvas slide={{ kind: 'lyrics', lines: ['Amazing grace!'] }} />);
  const line = screen.getByText('Amazing grace!') as HTMLElement;
  expect(line.style.fontSize).toContain('var(--helm-fit-size');
  expect(line.style.fontSize).toContain('clamp(');
});

test('scripture text sizes from the fit property, falling back to a clamp', () => {
  render(<SlideCanvas slide={{ kind: 'scripture', ref: 'John 3:16', columns: [{ version: 'KJV', text: 'For God so loved…' }] }} />);
  const verse = screen.getByText('For God so loved…') as HTMLElement;
  expect(verse.style.fontSize).toContain('var(--helm-fit-size');
  expect(verse.style.fontSize).toContain('clamp(');
});

test('both parallel versions render at one size', () => {
  render(
    <SlideCanvas
      slide={{
        kind: 'scripture',
        ref: 'John 3:16',
        columns: [
          { version: 'KJV', text: 'For God so loved the world' },
          { version: 'NKJV', text: 'For God so loved the world, that He gave' }
        ]
      }}
    />
  );
  const a = (screen.getByText('For God so loved the world') as HTMLElement).style.fontSize;
  const b = (screen.getByText('For God so loved the world, that He gave') as HTMLElement).style.fontSize;
  expect(a).toBe(b);
});

test('the px ceilings that caused BUG-007 are gone', () => {
  // The caps only bound above ~850px of container, so they throttled the projector and
  // nothing else. Their presence is the defect; assert they cannot come back.
  render(<SlideCanvas slide={{ kind: 'lyrics', lines: ['Amazing grace!'] }} />);
  expect((screen.getByText('Amazing grace!') as HTMLElement).style.fontSize).not.toContain('72px');
});

test('non-fitted slide kinds keep their own sizing', () => {
  render(<SlideCanvas slide={{ kind: 'quote', text: 'A quote', source: 'Someone' }} />);
  const quote = screen.getByText('A quote') as HTMLElement;
  expect(quote.style.fontSize).not.toContain('var(--helm-fit-size');
});
