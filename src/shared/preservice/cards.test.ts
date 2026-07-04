import { describe, it, expect } from 'vitest';
import { preSlideFor, nextEnabledIdx, fmtCountdown, remainingMs } from './cards';
import type { PreCard } from '../types';

const base = { id: 'x', title: 't', enabled: true };

describe('preSlideFor', () => {
  it('countdown → countdown slide with clock text', () => {
    expect(preSlideFor({ ...base, type: 'countdown' } as PreCard, '05:00'))
      .toEqual({ kind: 'countdown', accent: '#e0a341', message: 'Service begins in', countdownText: '05:00' });
  });
  it('message → title slide', () => {
    expect(preSlideFor({ ...base, type: 'message', headline: 'Welcome', subtitle: 'Glad you are here' } as PreCard, ''))
      .toEqual({ kind: 'title', accent: '#e0a341', title: 'Welcome', subtitle: 'Glad you are here' });
  });
  it('verse → scripture slide (KJV single column)', () => {
    expect(preSlideFor({ ...base, type: 'verse', ref: 'Psalm 122:1', text: 'I was glad…' } as PreCard, ''))
      .toEqual({ kind: 'scripture', accent: '#6f9cf0', ref: 'Psalm 122:1', label: 'Psalm 122:1', columns: [{ version: 'KJV', text: 'I was glad…' }] });
  });
  it('list → title slide with points', () => {
    expect(preSlideFor({ ...base, type: 'list', title: 'Announcements', points: ['a', 'b'] } as PreCard, ''))
      .toEqual({ kind: 'title', accent: '#e0a341', title: 'Announcements', points: ['a', 'b'] });
  });
  it('logo → logo slide', () => {
    expect(preSlideFor({ ...base, type: 'logo' } as PreCard, '')).toEqual({ kind: 'logo', title: 'HELM' });
  });
  it('image → image slide', () => {
    expect(preSlideFor({ ...base, type: 'image', src: 'helm-media://images/a.jpg' } as PreCard, ''))
      .toEqual({ kind: 'image', src: 'helm-media://images/a.jpg' });
  });
});

const cards = (flags: boolean[]) => flags.map((enabled, i) => ({ id: String(i), type: 'logo', title: 't', enabled }));

describe('nextEnabledIdx', () => {
  it('skips disabled and wraps forward', () => {
    expect(nextEnabledIdx(cards([true, false, true]) as any, 0, 1)).toBe(2);
    expect(nextEnabledIdx(cards([true, false, true]) as any, 2, 1)).toBe(0);
  });
  it('steps backward', () => {
    expect(nextEnabledIdx(cards([true, true, false]) as any, 1, -1)).toBe(0);
  });
  it('returns from when nothing enabled', () => {
    expect(nextEnabledIdx(cards([false, false]) as any, 1, 1)).toBe(1);
  });
});
describe('countdown', () => {
  it('formats mm:ss clamped at zero', () => {
    expect(fmtCountdown(300000)).toBe('5:00');
    expect(fmtCountdown(65000)).toBe('1:05');
    expect(fmtCountdown(-5000)).toBe('0:00');
  });
  it('remainingMs never negative', () => {
    expect(remainingMs(1000, 400)).toBe(600);
    expect(remainingMs(1000, 5000)).toBe(0);
  });
});
