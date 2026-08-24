// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { SlideCanvas, SCRIPTURE_BAND, TITLE_BAND, LIST_BAND } from './SlideCanvas';

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

test('scripture ref is a fixed container-relative size, independent of the fitted verse', () => {
  // Paging verses re-runs the fit, so a ref tied to the fitted size rescales every
  // advance (#48). cqmin rather than px keeps the operator preview and the projector
  // proportional (BUG-007); the fit var must not appear or the jitter returns.
  render(<SlideCanvas slide={{ kind: 'scripture', ref: 'John 3:16', columns: [{ version: 'KJV', text: 'For God so loved…' }] }} />);
  const ref = screen.getByText('John 3:16') as HTMLElement;
  expect(ref.style.fontSize).toBe('calc(max(8px,4cqmin))');
  expect(ref.style.fontSize).not.toContain('--helm-fit-size');
  expect(ref.style.fontSize).not.toContain('clamp');
});

test('scripture version label scales with the fitted size (0.47x the verse), floored at 7px, with no px ceiling', () => {
  render(<SlideCanvas slide={{ kind: 'scripture', ref: 'John 3:16', columns: [{ version: 'KJV', text: 'For God so loved…' }] }} />);
  const version = screen.getByText('KJV') as HTMLElement;
  expect(version.style.fontSize).toBe('max(7px, calc(var(--helm-fit-size, 4.7cqmin) * 0.47))');
  expect(version.style.fontSize).not.toContain('clamp');
});

test('the scripture fit band reaches low enough for two stacked long verses', () => {
  // Stacked versions need roughly double the height side-by-side did, and fitFontSize
  // degrades to the smallest candidate when nothing fits — with the old 3cqmin floor,
  // two long verses (Esther 8:9 in two translations) clipped in any narrower-than-16:9
  // output window. The floor must sit at 1.5cqmin so the walk can keep shrinking.
  expect(SCRIPTURE_BAND[SCRIPTURE_BAND.length - 1]).toBe(1.5);
});

test('two versions stack vertically, each full-width and centered', () => {
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
  const block = (screen.getByText('KJV') as HTMLElement).parentElement as HTMLElement;
  const stack = block.parentElement as HTMLElement;
  expect(stack.style.flexDirection).toBe('column');
  expect(block.style.maxWidth).toBe('94%');
  expect(block.style.textAlign).toBe('center');
  const other = (screen.getByText('NKJV') as HTMLElement).parentElement as HTMLElement;
  expect(other.style.maxWidth).toBe('94%');
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

test('title slides size from the fit property with no px ceiling (#49)', () => {
  render(<SlideCanvas slide={{ kind: 'title', title: 'Announcements', subtitle: 'This week' }} />);
  const title = screen.getByText('Announcements') as HTMLElement;
  expect(title.style.fontSize).toBe('max(14px, var(--helm-fit-size, 9.2cqmin))');
  expect(title.style.fontSize).not.toContain('clamp');
});

test('list points ARE the fitted base — full size, no ratio, no px ceiling (#49)', () => {
  // The 28px cap made an announcement bullet's MAXIMUM smaller than a lyric line's
  // most-cramped fitted size (BUG-007 class); the 0.37× title ratio that replaced it kept
  // the items at ~37px on 1080p while the label towered over them. The items are what the
  // congregation reads, so they take the fitted size directly.
  render(<SlideCanvas slide={{ kind: 'title', title: 'Announcements', points: ['Potluck sign-up'] }} />);
  const point = screen.getByText('Potluck sign-up') as HTMLElement;
  expect(point.style.fontSize).toBe('max(9px, var(--helm-fit-size, 6.4cqmin))');
  expect(point.style.fontSize).not.toContain('clamp');
});

test('a list slide demotes its title to scripture-ref chrome: fixed size, mono, accent', () => {
  // One grammar across the pre-service deck: small label up top, big content underneath.
  // Fixed like the scripture ref — it is chrome, so it must hold still while the fitter
  // works, and a constant-size child keeps the fit walk monotonic.
  render(<SlideCanvas slide={{ kind: 'title', title: 'Announcements', points: ['Potluck sign-up'] }} />);
  const title = screen.getByText('Announcements') as HTMLElement;
  expect(title.style.fontSize).toBe('calc(max(8px,2.9cqmin))');
  expect(title.style.fontSize).not.toContain('--helm-fit-size');
  expect(title.style.textTransform).toBe('uppercase');
  expect(title.style.fontFamily).toContain('JetBrains Mono');
});

test('a wrapped list item hangs under its first line, dot pinned beside it', () => {
  // alignItems center floated the dot between the lines of a two-line item. flex-start
  // pins it to the first line; the text (its own flex item) wraps within its own box,
  // which is what gives the hanging indent.
  render(<SlideCanvas slide={{ kind: 'title', title: 'Announcements', points: ['Potluck sign-up'] }} />);
  const point = screen.getByText('Potluck sign-up') as HTMLElement;
  expect(point.style.alignItems).toBe('flex-start');
});

test('the list fit band starts at the item design size and reaches low enough for a long list', () => {
  // 6.4cqmin is the three-item design size (≈69px on 1080p — nearly double the 0.37×
  // arrangement it replaces); the walk must be able to degrade to 2.15 (a whole number
  // of 0.25 steps below 6.4) because the output has no scrolling.
  expect(LIST_BAND[0]).toBe(6.4);
  expect(LIST_BAND[LIST_BAND.length - 1]).toBe(2.15);
});

test('title subtitle scales with the fitted size (0.39x the title), floored, with no px ceiling', () => {
  render(<SlideCanvas slide={{ kind: 'title', title: 'Welcome', subtitle: 'Glad you are here' }} />);
  const sub = screen.getByText('Glad you are here') as HTMLElement;
  expect(sub.style.fontSize).toBe('max(9px, calc(var(--helm-fit-size, 9.2cqmin) * 0.39))');
  expect(sub.style.fontSize).not.toContain('clamp');
});

test('the title fit band reaches low enough for a long list', () => {
  // fitFontSize degrades to the smallest candidate when nothing fits, and the output has
  // no scrolling — a 9-item announcement list must be able to keep shrinking until it
  // fits rather than clipping. The band's ceiling stays at the 9.2cqmin design size:
  // fitting shrinks crowded slides, it never balloons a short one past the design.
  expect(TITLE_BAND[0]).toBe(9.2);
  expect(TITLE_BAND[TITLE_BAND.length - 1]).toBe(2.2);
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
