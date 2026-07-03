import { expect, test } from 'vitest';
import { applyCue, goLive, initialPresentation, keyForSong, outputPayload, sameFlow, setOutput } from './core';
import type { Slide } from '../types';

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
test('outputPayload derives the audience slide', () => {
  expect(outputPayload(initialPresentation()).slide.kind).toBe('black');
  expect(outputPayload(setOutput(initialPresentation(), 'logo')).slide).toEqual({ kind: 'logo', title: 'HELM' });
  const live = goLive(initialPresentation(), 'song:a:0', slide('V1'));
  expect(outputPayload(live).slide.label).toBe('V1');
});
