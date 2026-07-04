// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { SlideCanvas } from './SlideCanvas';

test('quote kind renders quote text and source', () => {
  const { container } = render(
    <SlideCanvas slide={{ kind: 'quote', text: 'Grace is amazing.', source: 'John Newton' }} />
  );
  expect(container.textContent).toContain('Grace is amazing.');
  expect(container.textContent).toContain('John Newton');
});

test('title kind with points renders points', () => {
  const { container } = render(
    <SlideCanvas slide={{ kind: 'title', title: 'Sermon', subtitle: 'Sub', points: ['A', 'B'] }} />
  );
  expect(container.textContent).toContain('A');
  expect(container.textContent).toContain('B');
});

test('countdown renders message and countdown text', () => {
  const { container } = render(<SlideCanvas slide={{ kind: 'countdown', countdownText: '05:00' }} />);
  expect(container.textContent).toContain('05:00');
  expect(container.textContent).toContain('Service begins in');
});

test('stage variant shows chrome clock and next', () => {
  const { container } = render(
    <SlideCanvas slide={{ kind: 'lyrics', lines: ['L1'] }} variant="stage" clock="10:42" next="Chorus" />
  );
  expect(container.textContent).toContain('10:42');
  expect(container.textContent).toContain('NEXT');
  expect(container.textContent).toContain('Chorus');
});

test('main variant with label shows label', () => {
  const { container } = render(<SlideCanvas slide={{ kind: 'lyrics', label: 'Verse 1', lines: ['L1'] }} variant="main" />);
  expect(container.textContent).toContain('Verse 1');
});

test('livestream variant shows lower third and backplate, hides content', () => {
  const { container } = render(
    <SlideCanvas slide={{ kind: 'scripture', ref: 'John 3:16', columns: [{ version: 'KJV', text: 'text' }] }} variant="livestream" />
  );
  expect(container.textContent).toContain('John 3:16');
  expect(container.textContent).toContain('KJV');
  expect(container.textContent).not.toContain('text');
});

test('fill prop sets height 100% and drops aspectRatio', () => {
  const { container } = render(<SlideCanvas slide={{ kind: 'black' }} fill />);
  const root = container.firstChild as HTMLElement;
  expect(root.style.height).toBe('100%');
  expect(root.style.aspectRatio).toBe('');
});

test('default (no fill) keeps aspectRatio 16 / 9', () => {
  const { container } = render(<SlideCanvas slide={{ kind: 'black' }} />);
  const root = container.firstChild as HTMLElement;
  expect(root.style.aspectRatio).toBe('16 / 9');
});

test('renders an image slide as an <img> with the given src', () => {
  const { container } = render(
    <SlideCanvas slide={{ kind: 'image', src: 'helm-media://images/x.jpg' }} fill />
  );
  const img = container.querySelector('img');
  expect(img).not.toBeNull();
  expect(img?.getAttribute('src')).toBe('helm-media://images/x.jpg');
  expect(img?.style.objectFit).toBe('contain');
});
