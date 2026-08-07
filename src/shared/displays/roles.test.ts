import { expect, test, describe, it } from 'vitest';
import {
  DEFAULT_ROLE,
  OUTPUT_ROLES,
  ROLE_VARIANT,
  fingerprintDisplay,
  planAttachments,
  resolveView,
  DEFAULT_VIEW,
  clampLeaderSplit,
  resolveLeaderSplit,
  type DisplaySnapshot,
} from './roles';
import type { OutputRole } from '../types';

const snap = (over: Partial<DisplaySnapshot> = {}): DisplaySnapshot => ({
  id: 1,
  label: 'DELL U2720Q',
  size: { width: 3840, height: 2160 },
  scaleFactor: 2,
  rotation: 0,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  internal: false,
  ...over,
});

test('ROLE_VARIANT maps each role to its SlideCanvas variant', () => {
  expect(ROLE_VARIANT).toEqual({ audience: 'audience', stage: 'stage', livestream: 'livestream' });
  expect(OUTPUT_ROLES).toEqual(['audience', 'stage', 'livestream']);
  expect(DEFAULT_ROLE).toBe('audience');
});

test('fingerprint uses a meaningful label', () => {
  expect(fingerprintDisplay(snap({ label: 'DELL U2720Q' }))).toBe('label:DELL U2720Q');
});

test('fingerprint falls back to geometry for empty or generic labels', () => {
  expect(fingerprintDisplay(snap({ label: '' }))).toBe('geo:3840x2160@2r0');
  expect(fingerprintDisplay(snap({ label: 'Built-in Retina Display' }))).toBe('geo:3840x2160@2r0');
  expect(fingerprintDisplay(snap({ label: 'Unknown' }))).toBe('geo:3840x2160@2r0');
});

test('scale and rotation change the geometry fingerprint', () => {
  expect(fingerprintDisplay(snap({ label: '', scaleFactor: 1 }))).toBe('geo:3840x2160@1r0');
  expect(fingerprintDisplay(snap({ label: '', rotation: 90 }))).toBe('geo:3840x2160@2r90');
});

test('planAttachments excludes the operator display', () => {
  const displays = [snap({ id: 1, label: 'OP' }), snap({ id: 2, label: 'EXT' })];
  const plan = planAttachments(displays, 1, {});
  expect(plan.map((a) => a.displayId)).toEqual([2]);
});

test('planAttachments resolves a known fingerprint to its saved role', () => {
  const saved: Record<string, OutputRole> = { 'label:EXT': 'stage' };
  const plan = planAttachments([snap({ id: 2, label: 'EXT' })], 1, saved);
  expect(plan[0]).toEqual({
    displayId: 2,
    fingerprint: 'label:EXT',
    role: 'stage',
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  });
});

test('planAttachments defaults an unknown display to audience', () => {
  const plan = planAttachments([snap({ id: 2, label: 'EXT' })], 1, {});
  expect(plan[0].role).toBe('audience');
});

test('planAttachments handles a mix of known and unknown displays', () => {
  const displays = [snap({ id: 2, label: 'A' }), snap({ id: 3, label: 'B' })];
  const plan = planAttachments(displays, 1, { 'label:A': 'livestream' });
  expect(plan.map((a) => a.role)).toEqual(['livestream', 'audience']);
});

test('planAttachments returns [] for an empty display list', () => {
  expect(planAttachments([], 1, {})).toEqual([]);
});

describe('resolveView', () => {
  it('returns the saved view for a known fingerprint', () => {
    expect(resolveView({ 'label:BenQ GW2480': 'leader' }, 'label:BenQ GW2480')).toBe('leader');
  });
  it('defaults an unknown fingerprint to slides', () => {
    expect(resolveView({}, 'label:BenQ GW2480')).toBe(DEFAULT_VIEW);
    expect(DEFAULT_VIEW).toBe('slides');
  });
});

test('clampLeaderSplit clamps, rounds, and defaults non-numbers', () => {
  expect(clampLeaderSplit(320)).toBe(320)
  expect(clampLeaderSplit(10)).toBe(220)
  expect(clampLeaderSplit(9000)).toBe(560)
  expect(clampLeaderSplit(300.6)).toBe(301)
  expect(clampLeaderSplit(undefined)).toBe(320)
  expect(clampLeaderSplit('x')).toBe(320)
})
test('resolveLeaderSplit reads the saved value for a fingerprint, defaulting when absent', () => {
  expect(resolveLeaderSplit({ fp1: 400 }, 'fp1')).toBe(400)
  expect(resolveLeaderSplit({}, 'fp1')).toBe(320)
})
