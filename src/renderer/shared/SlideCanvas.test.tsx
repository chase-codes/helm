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

test('lyric lines size from the fit property, floored, falling back to an uncapped cqmin', () => {
  render(<SlideCanvas slide={{ kind: 'lyrics', lines: ['Amazing grace!'] }} />);
  const line = screen.getByText('Amazing grace!') as HTMLElement;
  expect(line.style.fontSize).toBe('max(11px, var(--helm-fit-size, 7.4cqmin))');
});

test('scripture text sizes from the fit property, floored, falling back to an uncapped cqmin', () => {
  render(<SlideCanvas slide={{ kind: 'scripture', ref: 'John 3:16', columns: [{ version: 'KJV', text: 'For God so loved…' }] }} />);
  const verse = screen.getByText('For God so loved…') as HTMLElement;
  expect(verse.style.fontSize).toBe('max(10px, var(--helm-fit-size, 4.7cqmin))');
});

test('scripture ref scales with the fitted size (0.62x the verse), floored at 8px, with no px ceiling', () => {
  render(<SlideCanvas slide={{ kind: 'scripture', ref: 'John 3:16', columns: [{ version: 'KJV', text: 'For God so loved…' }] }} />);
  const ref = screen.getByText('John 3:16') as HTMLElement;
  expect(ref.style.fontSize).toBe('max(8px, calc(var(--helm-fit-size, 4.7cqmin) * 0.62))');
  expect(ref.style.fontSize).not.toContain('clamp');
});

test('scripture version label scales with the fitted size (0.47x the verse), floored at 7px, with no px ceiling', () => {
  render(<SlideCanvas slide={{ kind: 'scripture', ref: 'John 3:16', columns: [{ version: 'KJV', text: 'For God so loved…' }] }} />);
  const version = screen.getByText('KJV') as HTMLElement;
  expect(version.style.fontSize).toBe('max(7px, calc(var(--helm-fit-size, 4.7cqmin) * 0.47))');
  expect(version.style.fontSize).not.toContain('clamp');
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

test('lyric auto-fit does not re-measure when a re-render changes only an unrelated prop', () => {
  // Guards the module-scope band hoist in SlideCanvas.tsx: the fit bands must keep a
  // stable array identity across renders, or useFitText's deps array looks "changed"
  // every render and the layout effect (tear down/recreate ResizeObserver, synchronous
  // re-measure) fires on every tick of e.g. the stage clock. If the bands were recreated
  // inside the component body instead, this test fails.
  let clientHeightReads = 0;
  const { container, rerender } = render(
    <SlideCanvas slide={{ kind: 'lyrics', lines: ['Amazing grace!'] }} variant="stage" clock="12:00" />
  );
  const root = container.firstElementChild as HTMLElement;
  Object.defineProperty(root, 'clientHeight', {
    configurable: true,
    get: () => {
      clientHeightReads++;
      return 0;
    }
  });
  const readsAfterMount = clientHeightReads; // stub attached post-mount: 0

  rerender(<SlideCanvas slide={{ kind: 'lyrics', lines: ['Amazing grace!'] }} variant="stage" clock="12:01" />);
  expect(clientHeightReads).toBe(readsAfterMount);
});

test('audience variant shows the section label and key on lyrics slides', () => {
  const r = render(
    <SlideCanvas variant="audience" slide={{ kind: 'lyrics', lines: ['x'], label: 'Song · Verse 1', sectionLabel: 'Verse 1', songKey: 'G' }} />
  );
  expect(r.getByTestId('audience-label').textContent).toBe('Verse 1 · Key G');
});
test('audience label omits the key when unset and hides entirely with no fields', () => {
  const withLabel = render(
    <SlideCanvas variant="audience" slide={{ kind: 'lyrics', lines: ['x'], sectionLabel: 'Chorus' }} />
  );
  expect(withLabel.getByTestId('audience-label').textContent).toBe('Chorus');
  cleanup();
  const bare = render(<SlideCanvas variant="audience" slide={{ kind: 'lyrics', lines: ['x'] }} />);
  expect(bare.queryByTestId('audience-label')).toBeNull();
});

test('lyric lines are nowrap so the fitter, not the box, controls line breaks', () => {
  const r = render(<SlideCanvas variant="audience" slide={{ kind: 'lyrics', lines: ['Blessed assurance, Jesus is mine!'] }} />);
  const line = r.getByText('Blessed assurance, Jesus is mine!');
  expect(line.style.whiteSpace).toBe('nowrap');
  // No width cap: a capped box + nowrap overflows to the RIGHT only (LTR), so long lines
  // render off-center while the fitter can't see the overflow. The container's own padding
  // provides the side margin; the line box must be free to match its text width.
  expect(line.style.maxWidth).toBe('');
});
