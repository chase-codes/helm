import { describe, it, expect } from 'vitest';
import { preSlideFor, nextEnabledIdx } from './cards';
import type { PreCard } from '../types';

const base = { id: 'x', title: 't', enabled: true };

describe('preSlideFor', () => {
  it('message → title slide', () => {
    expect(preSlideFor({ ...base, type: 'message', headline: 'Welcome', subtitle: 'Glad you are here' } as PreCard))
      .toEqual({ kind: 'title', accent: '#e0a341', title: 'Welcome', subtitle: 'Glad you are here' });
  });
  it('verse → scripture slide (KJV single column)', () => {
    expect(preSlideFor({ ...base, type: 'verse', ref: 'Psalm 122:1', text: 'I was glad…' } as PreCard))
      .toEqual({ kind: 'scripture', accent: '#f0b24a', ref: 'Psalm 122:1', label: 'Psalm 122:1', columns: [{ version: 'KJV', text: 'I was glad…' }] });
  });
  it('verse card with a version uses it as the column label', () => {
    expect(preSlideFor({ ...base, type: 'verse', ref: 'John 3:16', text: 'For God…', version: 'WEB' } as PreCard))
      .toEqual({ kind: 'scripture', accent: '#f0b24a', ref: 'John 3:16', label: 'John 3:16', columns: [{ version: 'WEB', text: 'For God…' }] });
  });
  it('list → title slide with points', () => {
    expect(preSlideFor({ ...base, type: 'list', title: 'Announcements', points: ['a', 'b'] } as PreCard))
      .toEqual({ kind: 'title', accent: '#e0a341', title: 'Announcements', points: ['a', 'b'] });
  });
  it('logo → logo slide', () => {
    expect(preSlideFor({ ...base, type: 'logo' } as PreCard)).toEqual({ kind: 'logo', title: 'HELM' });
  });
  it('image → image slide', () => {
    expect(preSlideFor({ ...base, type: 'image', src: 'helm-media://images/a.jpg' } as PreCard))
      .toEqual({ kind: 'image', src: 'helm-media://images/a.jpg' });
  });
  it('unknown/default type → logo fallback slide', () => {
    expect(preSlideFor({ ...base, type: 'bogus' } as unknown as PreCard)).toEqual({ kind: 'logo', title: 'HELM' });
  });
});

const cards = (flags: boolean[]): PreCard[] =>
  flags.map((enabled, i) => ({ id: String(i), type: 'logo' as const, title: 't', enabled }));

describe('nextEnabledIdx', () => {
  it('skips disabled and wraps forward', () => {
    expect(nextEnabledIdx(cards([true, false, true]), 0, 1)).toBe(2);
    expect(nextEnabledIdx(cards([true, false, true]), 2, 1)).toBe(0);
  });
  it('steps backward', () => {
    expect(nextEnabledIdx(cards([true, true, false]), 1, -1)).toBe(0);
  });
  it('returns from when nothing enabled', () => {
    expect(nextEnabledIdx(cards([false, false]), 1, 1)).toBe(1);
  });
});
