import { describe, it, expect } from 'vitest';
import { preSlideFor } from './cards';
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
