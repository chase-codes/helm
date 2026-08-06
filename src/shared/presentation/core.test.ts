import { expect, test } from 'vitest';
import { applyCue, goLive, initialPresentation, keyForSong, outputPayload, sameFlow, sameKind, setOutput, showLive } from './core';
import type { PresentationState, Slide } from '../types';

const slide = (label: string): Slide => ({ kind: 'lyrics', label, lines: ['x'] });

test('initial state is black with no snapshot', () => {
  expect(initialPresentation()).toEqual({ output: 'black', liveKey: null, liveSnap: null });
});
test('goLive snapshots the cued slide', () => {
  const st = goLive(initialPresentation(), keyForSong('a', 0), slide('V1'));
  expect(st.output).toBe('live'); expect(st.liveKey).toBe('song:a:0'); expect(st.liveSnap?.label).toBe('V1');
});
test('goLive on the already-live key takes it down (black)', () => {
  let st = goLive(initialPresentation(), 'song:a:0', slide('V1'));
  st = goLive(st, 'song:a:0', slide('V1'));
  expect(st.output).toBe('black');
});
test('sameFlow: same song different section is same flow; different song is not', () => {
  expect(sameFlow('song:a:0', 'song:a:2')).toBe(true);
  expect(sameFlow('song:a:0', 'song:b:0')).toBe(false);
  expect(sameFlow(null, 'song:a:0')).toBe(false);
});
test('applyCue while live in same flow hot-updates the screen', () => {
  let st = goLive(initialPresentation(), 'song:a:0', slide('V1'));
  st = applyCue(st, 'song:a:1', slide('V2'));
  expect(st.liveKey).toBe('song:a:1'); expect(st.liveSnap?.label).toBe('V2'); expect(st.output).toBe('live');
});
test('applyCue while live in different flow leaves the screen alone', () => {
  let st = goLive(initialPresentation(), 'song:a:0', slide('V1'));
  st = applyCue(st, 'song:b:0', slide('OTHER'));
  expect(st.liveKey).toBe('song:a:0'); expect(st.liveSnap?.label).toBe('V1');
});
test('applyCue while black never touches the screen', () => {
  const st = applyCue(initialPresentation(), 'song:a:0', slide('V1'));
  expect(st.liveSnap).toBeNull();
});
test('outputPayload derives the audience slide by default', () => {
  expect(outputPayload(initialPresentation()).slide.kind).toBe('black');
  expect(outputPayload(initialPresentation()).variant).toBe('audience');
  expect(outputPayload(setOutput(initialPresentation(), 'logo')).slide).toEqual({ kind: 'logo', title: 'HELM' });
  const live = goLive(initialPresentation(), 'song:a:0', slide('V1'));
  expect(outputPayload(live).slide.label).toBe('V1');
});
test('outputPayload passes through the requested variant', () => {
  expect(outputPayload(initialPresentation(), 'stage').variant).toBe('stage');
  expect(outputPayload(initialPresentation(), 'livestream').variant).toBe('livestream');
  // variant does not change slide derivation
  expect(outputPayload(setOutput(initialPresentation(), 'logo'), 'stage').slide).toEqual({ kind: 'logo', title: 'HELM' });
});
test('outputPayload carries the view and defaults it to slides', () => {
  const st = { output: 'live', liveKey: 'song:a:0', liveSnap: slide('V1') } as PresentationState;
  expect(outputPayload(st).view).toBe('slides');
  expect(outputPayload(st, 'stage', 'leader').view).toBe('leader');
  expect(outputPayload(st, 'stage', 'leader').variant).toBe('stage');
});
test('showLive while live hot-updates the screen, even across flows', () => {
  let st = goLive(initialPresentation(), 'scr:Genesis:1:1', slide('Gen 1:1'));
  st = showLive(st, 'scr:Romans:8:1', slide('Rom 8:1'));
  expect(st.output).toBe('live');
  expect(st.liveKey).toBe('scr:Romans:8:1');
  expect(st.liveSnap?.label).toBe('Rom 8:1');
});
test('showLive while black leaves the screen down', () => {
  const st = showLive(initialPresentation(), 'scr:Genesis:1:1', slide('Gen 1:1'));
  expect(st.output).toBe('black');
  expect(st.liveKey).toBeNull();
  expect(st.liveSnap).toBeNull();
});
test('showLive while on the logo leaves the logo up', () => {
  const st = showLive(setOutput(initialPresentation(), 'logo'), 'scr:Genesis:1:1', slide('Gen 1:1'));
  expect(st.output).toBe('logo');
  expect(st.liveSnap).toBeNull();
});
test('showLive on the already-live key does NOT take the screen down', () => {
  let st = goLive(initialPresentation(), 'scr:Genesis:1:1', slide('Gen 1:1'));
  st = showLive(st, 'scr:Genesis:1:1', slide('Gen 1:1'));
  expect(st.output).toBe('live');
  expect(st.liveKey).toBe('scr:Genesis:1:1');
});
test('applyCue still refuses a cross-flow cue (Songs depends on this)', () => {
  let st = goLive(initialPresentation(), 'song:a:0', slide('V1'));
  st = applyCue(st, 'song:b:0', slide('OTHER'));
  expect(st.liveKey).toBe('song:a:0');
});
test('sameKind: same leading segment matches regardless of the rest', () => {
  expect(sameKind('scr:Genesis:1:1', 'scr:Romans:8:28')).toBe(true);
  expect(sameKind('song:a:0', 'song:b:4')).toBe(true);
  expect(sameKind('song:a:0', 'scr:Genesis:1:1')).toBe(false);
  expect(sameKind(null, 'scr:Genesis:1:1')).toBe(false);
  expect(sameKind('scr:Genesis:1:1', null)).toBe(false);
});
test('showLive refuses a cross-KIND update (a song on screen is not scripture to seize)', () => {
  let st = goLive(initialPresentation(), 'song:a:0', slide('V1'));
  st = showLive(st, 'scr:Genesis:1:1', slide('Gen 1:1'));
  expect(st.liveKey).toBe('song:a:0');
  expect(st.liveSnap?.label).toBe('V1');
  expect(st.output).toBe('live');
});
test('showLive still follows the cursor across books within scripture', () => {
  let st = goLive(initialPresentation(), 'scr:Genesis:1:1', slide('Gen 1:1'));
  st = showLive(st, 'scr:Romans:8:28', slide('Rom 8:28'));
  expect(st.liveKey).toBe('scr:Romans:8:28');
  expect(st.liveSnap?.label).toBe('Rom 8:28');
});
test('showLive fills a live-but-empty output (logo toggle can leave liveKey null)', () => {
  const st = showLive({ output: 'live', liveKey: null, liveSnap: null }, 'scr:Genesis:1:1', slide('Gen 1:1'));
  expect(st.output).toBe('live');
  expect(st.liveKey).toBe('scr:Genesis:1:1');
  expect(st.liveSnap?.label).toBe('Gen 1:1');
});
