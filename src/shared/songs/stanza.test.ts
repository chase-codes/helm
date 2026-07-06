import { expect, test } from 'vitest';
import { stanzaLabel } from './stanza';

test('stanzaLabel: singular for exactly one', () => {
  expect(stanzaLabel(1)).toBe('1 stanza');
});
test('stanzaLabel: plural for zero and many', () => {
  expect(stanzaLabel(0)).toBe('0 stanzas');
  expect(stanzaLabel(4)).toBe('4 stanzas');
});
