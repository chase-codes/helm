import type { PreCard, Slide } from '../types';

const AMBER = '#e0a341';

export function preSlideFor(card: PreCard, countdownText: string): Slide {
  switch (card.type) {
    case 'message':
      return { kind: 'title', accent: AMBER, title: card.headline || 'Welcome', subtitle: card.subtitle ?? '' };
    case 'verse':
      return { kind: 'scripture', accent: '#6f9cf0', ref: card.ref || '', label: card.ref || '', columns: [{ version: 'KJV', text: card.text || '' }] };
    case 'list':
      return { kind: 'title', accent: AMBER, title: card.title, points: card.points || [] };
    case 'logo':
      return { kind: 'logo', title: 'HELM' };
    case 'image':
      return { kind: 'image', src: card.src || '' };
    case 'countdown':
    default:
      return { kind: 'countdown', accent: AMBER, message: 'Service begins in', countdownText };
  }
}
