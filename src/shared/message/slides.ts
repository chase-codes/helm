import type { Message, Slide } from '../types';
import { MESSAGE_ACCENT } from '../slideAccents';

export { MESSAGE_ACCENT };

export function keyForMessageQuote(msgId: string, ord: number): string {
  return `msg:${msgId}:${ord}`;
}
export function keyForReading(msgId: string): string {
  return `read:${msgId}`;
}
export function buildQuoteSlide(msg: Message, ord: number): Slide {
  const p = msg.paragraphs[Math.max(0, Math.min(ord, msg.paragraphs.length - 1))];
  const ref = `Tape ${msg.tapeNo} · ¶${p.label}`;
  return { kind: 'quote', accent: MESSAGE_ACCENT, label: ref, text: p.text, source: `${msg.title} · ${ref}` };
}
export function buildReadingSlide(msg: Message, activeOrd: number): Slide {
  return {
    kind: 'reading', accent: MESSAGE_ACCENT, label: msg.title, title: msg.title,
    source: `Tape ${msg.tapeNo}`,
    paras: msg.paragraphs.map(({ label, text }) => ({ label, text })),
    activeOrd,
  };
}
