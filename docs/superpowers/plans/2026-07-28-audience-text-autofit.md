# Audience Text Auto-Fit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scripture and song lyrics on the audience screen grow to fill their box and shrink only as far as the content requires, closing BUG-007 (scripture renders at 40px on a 1080p projector, 55% the size of lyrics) and the Songs roadmap item "min/max audience-view font size based on verse length."

**Architecture:** A pure selection function picks the largest of a descending list of candidate sizes that fits, with the measurement injected. A React hook supplies the real measurement: it writes each candidate to a CSS custom property on the slide's container, reads layout, and stops at the first fit. `SlideCanvas` consumes the property for exactly two styles. Keeping sizes in `cqmin` (1% of the container's shorter side) means the operator's small preview panes stay faithful miniatures of the projector.

**Tech Stack:** TypeScript, React 19, Vitest + @testing-library/react (jsdom), Electron. No new dependencies.

## Global Constraints

- Sizes are expressed in `cqmin`, never px. `SlideCanvas`'s root sets `containerType: 'size'` (`SlideCanvas.tsx:41`), so `cqmin` resolves against the slide box on both the projector and the operator's preview panes.
- Candidates step by **0.25 cqmin**.
- Bands: **lyrics 8.0 → 3.5** (19 candidates), **scripture 6.5 → 3.0** (15 candidates). These are starting values; Task 4 tunes them against a real 1080p render.
- Existing pixel **floors** in the `clamp()` fallbacks stay. Existing pixel **ceilings** on the two changed styles are deleted — they are the BUG-007 defect.
- When measurement is unavailable (jsdom, zero-size container, no `ResizeObserver`), the rendered size falls back to today's `clamp()` value. Never render nothing.
- Scope is `lyrics` and `scripture` only. Quote, title, sermon, blank, image, video, and the livestream lower-third keep their current sizing.
- Two-column scripture renders both columns at one size.
- This project's vitest config does not set `globals: true`, so `@testing-library/react`'s auto-cleanup never registers. Renderer test files that render more than once must call `afterEach(cleanup)` — see `PreServiceMode.test.tsx:12`.
- Commit messages: concise conventional-commit subject. Do **not** add `Co-Authored-By` or `Claude-Session` trailers (`CLAUDE.md`).

## File Structure

| File | Responsibility |
| --- | --- |
| `src/shared/slides/fitText.ts` *(create)* | Pure selection: given candidates and a `fits` predicate, return the largest that fits. Also builds a descending candidate band. No DOM. |
| `src/shared/slides/fitText.test.ts` *(create)* | Unit tests for the above against a fake measurer. |
| `src/renderer/shared/useFitText.ts` *(create)* | The DOM half: writes candidates to a CSS custom property, measures, re-runs on resize. Owns the "measurement unavailable" fallback. |
| `src/renderer/shared/useFitText.test.tsx` *(create)* | jsdom tests for the fallback path and property wiring. |
| `src/renderer/shared/SlideCanvas.tsx` *(modify)* | Add refs, call the hook for lyrics/scripture, consume the property in two styles, delete two px ceilings. |
| `src/renderer/shared/SlideCanvas.test.tsx` *(modify)* | Assert the two styles reference the property and keep their clamp fallback. |
| `scratch/verify-autofit.mjs` *(create)* | Real-app driver: renders the four content cases at 1920×1080 and screenshots them. |

---

### Task 1: Pure fit selection

**Files:**
- Create: `src/shared/slides/fitText.ts`
- Test: `src/shared/slides/fitText.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `bandCandidates(max: number, min: number, step?: number): number[]` — descending, inclusive of `max`, never below `min`. `step` defaults to `0.25`.
  - `fitFontSize(candidates: number[], fits: (cqmin: number) => boolean): number` — largest candidate for which `fits` returns true; the last (smallest) candidate if none do. Throws on an empty array.

- [ ] **Step 1: Write the failing test**

Create `src/shared/slides/fitText.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { bandCandidates, fitFontSize } from './fitText';

describe('bandCandidates', () => {
  it('descends from max to min inclusive', () => {
    expect(bandCandidates(4, 3, 0.25)).toEqual([4, 3.75, 3.5, 3.25, 3]);
  });
  it('never emits a value below min when the step does not divide evenly', () => {
    const c = bandCandidates(4, 3.1, 0.5);
    expect(c[0]).toBe(4);
    expect(Math.min(...c)).toBeGreaterThanOrEqual(3.1);
  });
  it('avoids floating-point drift', () => {
    // 8.0 -> 3.5 by 0.25 is the real lyrics band; repeated subtraction yields 7.249999…
    const c = bandCandidates(8, 3.5, 0.25);
    expect(c).toHaveLength(19);
    expect(c).toContain(7.25);
    expect(c[c.length - 1]).toBe(3.5);
  });
  it('returns a single value when max equals min', () => {
    expect(bandCandidates(5, 5, 0.25)).toEqual([5]);
  });
});

describe('fitFontSize', () => {
  const band = [4, 3.75, 3.5, 3.25, 3];

  it('returns the largest candidate that fits', () => {
    expect(fitFontSize(band, (c) => c <= 3.5)).toBe(3.5);
  });
  it('returns the largest when everything fits', () => {
    expect(fitFontSize(band, () => true)).toBe(4);
  });
  it('returns the smallest when nothing fits', () => {
    expect(fitFontSize(band, () => false)).toBe(3);
  });
  it('handles a single candidate', () => {
    expect(fitFontSize([5], () => false)).toBe(5);
  });
  it('only ever returns a supplied candidate', () => {
    const out = fitFontSize(band, (c) => c < 3.6);
    expect(band).toContain(out);
  });
  it('stops asking once it finds a fit', () => {
    const asked: number[] = [];
    fitFontSize(band, (c) => { asked.push(c); return c <= 3.75; });
    expect(asked).toEqual([4, 3.75]); // never measured the smaller sizes
  });
  it('throws on an empty candidate list', () => {
    expect(() => fitFontSize([], () => true)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/slides/fitText.test.ts`
Expected: FAIL — `Failed to resolve import "./fitText"`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/slides/fitText.ts`:

```ts
/**
 * Font-size selection for slide text that must fit its box, kept free of the DOM so the
 * rule is unit-testable and the measurement can be faked. Sizes are `cqmin` values —
 * 1% of the slide container's shorter side — so one result is correct for both the
 * projector and the operator's small preview panes.
 */

/** Descending candidate sizes from `max` down to `min`, inclusive, stepping by `step`. */
export function bandCandidates(max: number, min: number, step = 0.25): number[] {
  const steps = Math.floor((max - min) / step);
  const out: number[] = [];
  // Multiply rather than subtract repeatedly: 8 - 0.25*3 is exact, but 8-0.25-0.25-0.25
  // accumulates binary drift and yields sizes like 7.249999999999999.
  for (let i = 0; i <= steps; i++) out.push(Number((max - i * step).toFixed(4)));
  return out;
}

/**
 * The largest candidate for which `fits` is true, or the smallest candidate if none fit —
 * something must go on the screen, so an impossible constraint degrades to the smallest
 * size rather than to nothing. Walks descending and stops at the first fit, so `fits` (a
 * layout read) runs as few times as possible.
 */
export function fitFontSize(candidates: number[], fits: (cqmin: number) => boolean): number {
  if (candidates.length === 0) throw new Error('fitFontSize: candidates must not be empty');
  for (const c of candidates) if (fits(c)) return c;
  return candidates[candidates.length - 1];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/slides/fitText.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/slides/fitText.ts src/shared/slides/fitText.test.ts
git commit -m "feat(slides): pure font-size fit selection"
```

---

### Task 2: The measuring hook

**Files:**
- Create: `src/renderer/shared/useFitText.ts`
- Test: `src/renderer/shared/useFitText.test.tsx`

**Interfaces:**
- Consumes: `bandCandidates`, `fitFontSize` from `../../shared/slides/fitText`.
- Produces:
  - `FIT_SIZE_VAR = '--helm-fit-size'` — the CSS custom property name.
  - `fitSizeValue(fallback: string): string` — the `font-size` value a style should use: `var(--helm-fit-size, <fallback>)`.
  - `useFitText(rootRef: RefObject<HTMLElement | null>, contentRef: RefObject<HTMLElement | null>, candidates: number[] | null, deps: unknown[]): void`

**Why a CSS custom property rather than React state:** measurement needs to try up to 19 sizes. Routing each through `setState` would mean 19 renders per slide change. Writing the property directly on the container mutates one value and lets the browser re-layout, so the loop costs layout reads only, and React never re-renders for measurement.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/shared/useFitText.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRef, type JSX } from 'react';
import { FIT_SIZE_VAR, fitSizeValue, useFitText } from './useFitText';

afterEach(cleanup);

function Probe({ candidates }: { candidates: number[] | null }): JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useFitText(root, content, candidates, [candidates]);
  return (
    <div ref={root} data-testid="root">
      <div ref={content}>text</div>
    </div>
  );
}

describe('fitSizeValue', () => {
  it('falls back to the supplied clamp when the property is unset', () => {
    expect(fitSizeValue('clamp(10px,4.7cqmin,40px)')).toBe('var(--helm-fit-size, clamp(10px,4.7cqmin,40px))');
  });
});

describe('useFitText', () => {
  it('leaves the property unset when the container has no size', () => {
    // The real fallback case, and the one jsdom reproduces for free: every layout box
    // reads 0, so the hook must decline to measure rather than "fit" the largest
    // candidate on the evidence of 0 <= 0.
    const { getByTestId } = render(<Probe candidates={[8, 7, 6]} />);
    expect(getByTestId('root').style.getPropertyValue(FIT_SIZE_VAR)).toBe('');
  });

  it('leaves the property unset when candidates is null', () => {
    const { getByTestId } = render(<Probe candidates={null} />);
    expect(getByTestId('root').style.getPropertyValue(FIT_SIZE_VAR)).toBe('');
  });

  it('does not throw when ResizeObserver is unavailable', () => {
    const saved = globalThis.ResizeObserver;
    // @ts-expect-error — deleting a global for the duration of this test
    delete globalThis.ResizeObserver;
    expect(() => render(<Probe candidates={[8, 7, 6]} />)).not.toThrow();
    globalThis.ResizeObserver = saved;
  });

  it('observes the container so a projector resize re-fits, and disconnects on unmount', () => {
    const disconnect = vi.fn();
    const observe = vi.fn();
    const saved = globalThis.ResizeObserver;
    globalThis.ResizeObserver = vi.fn(() => ({ observe, disconnect, unobserve: vi.fn() })) as unknown as typeof ResizeObserver;
    const { unmount } = render(<Probe candidates={[8, 7, 6]} />);
    expect(observe).toHaveBeenCalledTimes(1);
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
    globalThis.ResizeObserver = saved;
  });
});
```

Note the four tests above cover the fallback and lifecycle paths — the parts that matter and that jsdom can express. The actual "largest that fits" rule is covered by Task 1's unit tests; jsdom has no layout engine, so re-testing it here would only assert the stub.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/shared/useFitText.test.tsx`
Expected: FAIL — `Failed to resolve import "./useFitText"`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/shared/useFitText.ts`:

```ts
import { useLayoutEffect, type RefObject } from 'react';
import { fitFontSize } from '../../shared/slides/fitText';

/**
 * Custom property carrying the fitted size. Set on the slide container; read by the text
 * styles inside it. `cqmin` in the value resolves against that container, which is what
 * keeps the operator's small preview an accurate miniature of the projector.
 */
export const FIT_SIZE_VAR = '--helm-fit-size';

/** The `font-size` a fitted style should use: the fitted value, or `fallback` before/without measurement. */
export function fitSizeValue(fallback: string): string {
  return `var(${FIT_SIZE_VAR}, ${fallback})`;
}

/**
 * Sizes `contentRef`'s text to fit inside `rootRef` by trying `candidates` largest-first.
 *
 * Pass `candidates: null` for slide kinds that are not auto-fitted — the property is left
 * unset and their styles keep their own `clamp()`.
 *
 * Runs in a layout effect so the fitted size is applied before the browser paints; the
 * operator never sees a frame at the wrong size.
 */
export function useFitText(
  rootRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  candidates: number[] | null,
  deps: unknown[]
): void {
  useLayoutEffect(() => {
    const root = rootRef.current;
    const content = contentRef.current;
    if (!root || !content || candidates === null || candidates.length === 0) return;

    const measure = (): void => {
      // No layout yet (hidden panel, zero-size container, jsdom): leave the property unset
      // so the style's own clamp() renders. Measuring here would compare 0 <= 0 and
      // "fit" the largest candidate on no evidence.
      if (root.clientHeight === 0 || root.clientWidth === 0) {
        root.style.removeProperty(FIT_SIZE_VAR);
        return;
      }
      const size = fitFontSize(candidates, (cqmin) => {
        root.style.setProperty(FIT_SIZE_VAR, `${cqmin}cqmin`);
        // `content` is a child of the overflow-hidden root, so its own scroll size is its
        // natural content height — compare that against the box it has to live in.
        return content.scrollHeight <= root.clientHeight && content.scrollWidth <= root.clientWidth;
      });
      root.style.setProperty(FIT_SIZE_VAR, `${size}cqmin`);
    };

    measure();

    // Re-fit when the slide box changes: plugging in a projector, a DPI change, or the
    // operator resizing the window all change what fits.
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(root);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/shared/useFitText.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no output from either project (clean).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/shared/useFitText.ts src/renderer/shared/useFitText.test.tsx
git commit -m "feat(slides): useFitText measures and applies the fitted size"
```

---

### Task 3: Wire it into SlideCanvas

**Files:**
- Modify: `src/renderer/shared/SlideCanvas.tsx` (imports; `lineStyle` at `:62`; `verseTextStyle` at `:113`; the root `<div>` at `:334`; the lyrics block at `:337`; the scripture block at `:347`)
- Modify: `src/renderer/shared/SlideCanvas.test.tsx`

**Interfaces:**
- Consumes: `bandCandidates` from `../../shared/slides/fitText`; `fitSizeValue`, `useFitText` from `./useFitText`.
- Produces: no new exports. `SlideCanvasProps` is unchanged.

- [ ] **Step 1: Write the failing test**

Append to `src/renderer/shared/SlideCanvas.test.tsx`:

```tsx
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
```

Add `cleanup` to the file's imports and register it, since this file now renders many times:

```tsx
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';

afterEach(cleanup);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/shared/SlideCanvas.test.tsx`
Expected: FAIL — the new tests report a `fontSize` of `clamp(11px, 7.4cqmin, 72px)` with no `var(--helm-fit-size`.

- [ ] **Step 3: Add the imports and refs**

In `src/renderer/shared/SlideCanvas.tsx`, change the React import on line 1 and add the two new imports:

```tsx
import { useRef, type CSSProperties, type JSX } from 'react';
import type { Slide, OutputVariant } from '../../shared/types';
import { bandCandidates } from '../../shared/slides/fitText';
import { fitSizeValue, useFitText } from './useFitText';
```

Immediately after `const accent = s.accent || '#f0b24a';` (line 25), add:

```tsx
  // Auto-fit bands, in cqmin. Scripture sits slightly under lyrics: it is serif body text
  // and usually longer. Both lost the px ceilings that made scripture render at 55% of
  // lyrics on a 1080p projector (BUG-007).
  const LYRICS_BAND = bandCandidates(8, 3.5);
  const SCRIPTURE_BAND = bandCandidates(6.5, 3);

  const rootRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<HTMLDivElement>(null);
```

- [ ] **Step 4: Point the two styles at the fit property**

Replace the `fontSize` line in `lineStyle` (currently `SlideCanvas.tsx:64`):

```tsx
    fontSize: fitSizeValue('clamp(11px, 7.4cqmin, 7.4cqmin)'),
```

Replace the `fontSize` line in `verseTextStyle` (currently `SlideCanvas.tsx:115`):

```tsx
    fontSize: fitSizeValue('clamp(10px, 4.7cqmin, 4.7cqmin)'),
```

The fallback keeps the px floor and drops the px ceiling by repeating the `cqmin` term as the upper bound — so if measurement never runs, the text scales with the container instead of being capped.

- [ ] **Step 5: Call the hook**

After the two refs are declared and before `return (`, add the hook call. Place it after `const lines`/`const columns` are computed (near `SlideCanvas.tsx:330`) so the deps can reference them:

```tsx
  // Only lyrics and scripture auto-fit; every other kind passes null and keeps its clamp.
  const fitBand = isLyrics ? LYRICS_BAND : isScripture ? SCRIPTURE_BAND : null;
  useFitText(rootRef, fitRef, fitBand, [
    kind,
    fitBand,
    lines.join('\n'),
    columns.map((c) => c.text).join('\n'),
    variant
  ]);
```

- [ ] **Step 6: Attach the refs in the markup**

On the root `<div style={rootStyle}>` (line 334):

```tsx
    <div ref={rootRef} style={rootStyle}>
```

On the lyrics wrapper (line 338):

```tsx
        <div ref={fitRef} style={contentStyle}>
```

On the scripture wrapper (line 348):

```tsx
        <div ref={fitRef} style={scriptureWrap}>
```

Only one of the two branches renders at a time, so a single `fitRef` is never contested.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/renderer/shared/SlideCanvas.test.tsx`
Expected: PASS, all tests including the five new ones.

- [ ] **Step 8: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all test files pass; typecheck silent.

- [ ] **Step 9: Lint the changed files**

Run: `npx eslint --no-cache src/renderer/shared/SlideCanvas.tsx src/renderer/shared/useFitText.ts src/shared/slides/fitText.ts`
Expected: `0 errors`. Prettier warnings are pre-existing across this repo and are not gating.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/shared/SlideCanvas.tsx src/renderer/shared/SlideCanvas.test.tsx
git commit -m "fix(slides): auto-fit scripture and lyrics; drop the px ceilings (BUG-007)"
```

---

### Task 4: Verify at projector size and tune the bands

The defect only exists at projector scale — the px ceilings did nothing below ~850px of container. Unit tests cannot close BUG-007; this task does.

**Files:**
- Create: `scratch/verify-autofit.mjs`
- Modify: `src/renderer/shared/SlideCanvas.tsx` (band values only, if tuning says so)
- Modify: `docs/superpowers/bugs.md`, `docs/superpowers/roadmap.md`

**Interfaces:**
- Consumes: the built app in `out/` (`npm run build`), `playwright-core` (already a transitive dep — `scratch/verify-bug008.mjs` uses it).
- Produces: four screenshots and a pass/fail line per case.

- [ ] **Step 1: Write the driver**

Create `scratch/verify-autofit.mjs`. Scripts under `scratch/` must live in the repo root's module scope for `playwright-core` to resolve.

```js
// BUG-007 verification: audience text must fill the projector, not sit at a px cap.
// Renders the four content cases in a real 1920x1080 output window and reports the
// resolved font size for each.
import { _electron as electron } from 'playwright-core';
import * as path from 'node:path';

const APP_DIR = '/Users/lem/repos/helm';
const SHOT_DIR = process.env.SCREENSHOT_DIR || '.';
const electronBin = path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SHORT_VERSE = 'Jesus wept.';
const LONG_VERSE =
  'And it came to pass, when the LORD would take up Elijah into heaven by a whirlwind, that Elijah went with Elisha from Gilgal. And Elijah said unto Elisha, Tarry here, I pray thee; for the LORD hath sent me to Bethel.';
const SHORT_STANZA = ['Amazing grace!'];
const LONG_STANZA = [
  'Amazing grace! how sweet the sound',
  'That saved a wretch like me!',
  'I once was lost, but now am found,',
  'Was blind, but now I see.',
  "'Twas grace that taught my heart to fear,",
  'And grace my fears relieved;'
];

const app = await electron.launch({ executablePath: electronBin, args: [APP_DIR], cwd: APP_DIR, timeout: 30_000 });
await sleep(6_000);
const op = app.windows().find((w) => w.url().includes('operator')) ?? (await app.firstWindow());

// A real 1920x1080 output window, which is what the projector gets.
await op.evaluate(() => window.helm.displays.openTest());
await sleep(2_000);
const out = app.windows().find((w) => w.url().includes('output'));
if (!out) { console.log('FAIL  no output window opened'); await app.close(); process.exit(1); }
await out.setViewportSize({ width: 1920, height: 1080 });
await sleep(500);

const cases = [
  ['short-verse', { kind: 'scripture', ref: 'John 11:35', columns: [{ version: 'KJV', text: SHORT_VERSE }] }, SHORT_VERSE],
  ['long-verse', { kind: 'scripture', ref: '2 Kings 2:1-2', columns: [{ version: 'KJV', text: LONG_VERSE }] }, LONG_VERSE],
  ['short-stanza', { kind: 'lyrics', label: 'Amazing Grace', lines: SHORT_STANZA }, SHORT_STANZA[0]],
  ['long-stanza', { kind: 'lyrics', label: 'Amazing Grace', lines: LONG_STANZA }, LONG_STANZA[0]],
  ['two-column', { kind: 'scripture', ref: 'John 3:16', columns: [
    { version: 'KJV', text: 'For God so loved the world, that he gave his only begotten Son.' },
    { version: 'NKJV', text: 'For God so loved the world that He gave His only begotten Son, that whoever believes in Him should not perish.' }
  ] }, 'For God so loved the world, that he gave his only begotten Son.']
];

let failures = 0;
for (const [name, slide, probeText] of cases) {
  await op.evaluate((sl) => window.helm.presentation.goLive('verify:' + Math.random(), sl), slide);
  await sleep(700);
  const info = await out.evaluate((t) => {
    const el = [...document.querySelectorAll('div')].find((d) => d.textContent === t);
    if (!el) return null;
    const root = document.querySelector('[style*="container-type"], [style*="containerType"]') || document.body;
    return { px: parseFloat(getComputedStyle(el).fontSize), clipped: el.scrollHeight > root.clientHeight };
  }, probeText);
  await out.screenshot({ path: path.join(SHOT_DIR, `autofit-${name}.png`) });
  if (!info) { console.log(`FAIL  ${name} — probe text not found`); failures++; continue; }
  // 40px was the capped scripture size that prompted BUG-007; anything at or below that
  // on a 1080p screen means the fit is not doing its job.
  const ok = info.px > 40 && !info.clipped;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${info.px.toFixed(1)}px${info.clipped ? ' CLIPPED' : ''}`);
}

await app.close();
console.log(`\n${cases.length - failures}/${cases.length} cases passed`);
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Build and run it**

```bash
npm run build
SCREENSHOT_DIR=/tmp/autofit node scratch/verify-autofit.mjs
```

Expected: every case reports a size well above 40px and no `CLIPPED`. A short verse should land at or near the band ceiling; a long verse well below it.

- [ ] **Step 3: Look at the screenshots**

Open all five PNGs in `/tmp/autofit`. Judge, in this order:
1. Nothing is clipped or overflowing the 16:9 frame.
2. Scripture and lyrics read as being in the same size family — the BUG-007 complaint was that scripture looked small *next to* lyrics.
3. The short-verse case is large but not comical.
4. In `two-column`, both versions are the same size.

- [ ] **Step 4: Tune the bands if the screenshots call for it**

If step 3 looks wrong, adjust only the two `bandCandidates` calls in `SlideCanvas.tsx`, re-run steps 2–3, and repeat. Typical corrections: lower the lyrics ceiling if long stanzas fall to the floor; raise the scripture ceiling if a short verse still looks small beside a lyric slide. Record the final numbers in the commit message.

- [ ] **Step 5: Run the full suite once more**

Run: `npm test && npm run typecheck`
Expected: all pass. Task 3's tests assert the *shape* of the value, not the band numbers, so tuning does not break them.

- [ ] **Step 6: Close out the docs**

In `docs/superpowers/bugs.md`, move the BUG-007 entry from `## Open` to `## Fixed`, following the format the other fixed entries use: `**Status:** Fixed (<commit>)`, a **Root cause (measured)** paragraph stating the px ceilings bound only above ~850px of container and so throttled the projector alone, a **Fix** paragraph naming `fitText.ts` / `useFitText.ts` and the final bands, and a **Proof** paragraph citing the unit tests and the `scratch/verify-autofit.mjs` run with the measured px sizes.

In `docs/superpowers/roadmap.md`, strike the Songs entry **"Min/max audience-view font size based on verse length"** the way the other shipped items are struck — `~~**…**~~ ✅ **Shipped** (`<commit>`) — …` — noting that length now determines the fit and the band supplies the min and max.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/shared/SlideCanvas.tsx docs/superpowers/bugs.md docs/superpowers/roadmap.md
git commit -m "docs(bugs): mark BUG-007 fixed; audience text auto-fits"
```

`scratch/` is untracked in this repo and stays that way — the driver is a local verification artifact, like `scratch/verify-bug008.mjs`.

---

## Done when

- `npm test` passes with the new unit, hook, and canvas tests.
- `npm run typecheck` is clean and `npx eslint` reports 0 errors on the changed files.
- `scratch/verify-autofit.mjs` reports 5/5 with every size above 40px and nothing clipped.
- The five screenshots show scripture and lyrics in the same size family, nothing overflowing, and parallel versions matching.
- BUG-007 is in `## Fixed` with its commit; the Songs roadmap font item is struck as shipped.
