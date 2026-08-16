import type { PreCard, Slide } from '../types';
import { CANVAS_AMBER, CANVAS_GOLD } from '../slideAccents';
import { cleanListPoints } from './listPoints';

export function preSlideFor(card: PreCard): Slide {
  switch (card.type) {
    case 'message':
      return { kind: 'title', accent: CANVAS_AMBER, title: card.headline || 'Welcome', subtitle: card.subtitle ?? '' };
    case 'verse':
      // Canvas gold, same as buildScriptureSlide — not the operator-UI scripture blue (#48).
      return { kind: 'scripture', accent: CANVAS_GOLD, ref: card.ref || '', label: card.ref || '', columns: [{ version: card.version || 'KJV', text: card.text || '' }] };
    case 'list':
      // cleanListPoints here as well as in the editor: cards saved before the editor
      // stripped markers have "- " baked into their stored text (#50).
      return { kind: 'title', accent: CANVAS_AMBER, title: card.title, points: cleanListPoints(card.points || []) };
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
