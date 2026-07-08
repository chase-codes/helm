import { describe, it, expect } from 'vitest';
import { pickNeighborId } from './pickNeighbor';

const ids = (xs: string[]): { id: string }[] => xs.map((id) => ({ id }));

describe('pickNeighborId', () => {
  it('selects the next row when one follows', () => {
    expect(pickNeighborId(ids(['a', 'b', 'c']), 'b')).toBe('c');
  });
  it('selects the previous row when removing the last', () => {
    expect(pickNeighborId(ids(['a', 'b', 'c']), 'c')).toBe('b');
  });
  it('returns empty string when removing the only row', () => {
    expect(pickNeighborId(ids(['a']), 'a')).toBe('');
  });
  it('returns empty string when the id is absent', () => {
    expect(pickNeighborId(ids(['a', 'b']), 'z')).toBe('');
  });
});
