import type { PreCard, Slide } from '../types';

const AMBER = '#e0a341';

export function preSlideFor(card: PreCard): Slide {
  switch (card.type) {
    case 'message':
      return { kind: 'title', accent: AMBER, title: card.headline || 'Welcome', subtitle: card.subtitle ?? '' };
    case 'verse':
      return { kind: 'scripture', accent: '#6f9cf0', ref: card.ref || '', label: card.ref || '', columns: [{ version: 'KJV', text: card.text || '' }] };
    case 'list':
      return { kind: 'title', accent: AMBER, title: card.title, points: card.points || [] };
    case 'image':
      return { kind: 'image', src: card.src || '' };
    case 'logo':
    default:
      return { kind: 'logo', title: 'HELM' };
  }
}

export function nextEnabledIdx(cards: PreCard[], from: number, dir: 1 | -1): number {
  const n = cards.length;
  if (n === 0) return from;
  let i = from;
  for (let k = 0; k < n; k++) {
    i = (i + dir + n) % n;
    if (cards[i].enabled) return i;
  }
  return from;
}
