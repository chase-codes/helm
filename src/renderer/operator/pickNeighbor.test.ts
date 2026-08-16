import { describe, it, expect } from 'vitest';
import { pickNeighborId } from './pickNeighbor';

const ids = (xs: string[]): { id: string }[] => xs.map((id) => ({ id }));

describe('pickNeighborId', () => {
  it('selects the next row when one follows', () => {
    expect(pickNeighborId(ids(['a', 'b', 'c']), ['b'])).toBe('c');
  });
  it('selects the previous row when removing the last', () => {
    expect(pickNeighborId(ids(['a', 'b', 'c']), ['c'])).toBe('b');
  });
  it('returns empty string when removing the only row', () => {
    expect(pickNeighborId(ids(['a']), ['a'])).toBe('');
  });
  it('returns empty string when the id is absent', () => {
    expect(pickNeighborId(ids(['a', 'b']), ['z'])).toBe('');
  });
  it('returns empty string for an empty batch', () => {
    expect(pickNeighborId(ids(['a', 'b']), [])).toBe('');
  });
  it('skips the whole removed run to the first survivor after it', () => {
    expect(pickNeighborId(ids(['a', 'b', 'c', 'd']), ['b', 'c'])).toBe('d');
  });
  it('falls back before the run when nothing survives after it', () => {
    expect(pickNeighborId(ids(['a', 'b', 'c']), ['b', 'c'])).toBe('a');
  });
  it('handles a non-contiguous batch, preferring a survivor inside the span', () => {
    expect(pickNeighborId(ids(['a', 'b', 'c', 'd']), ['b', 'd'])).toBe('c');
  });
  it('returns empty string when the batch takes everything', () => {
    expect(pickNeighborId(ids(['a', 'b']), ['a', 'b'])).toBe('');
  });
  it('ignores ids that are not in the list', () => {
    expect(pickNeighborId(ids(['a', 'b', 'c']), ['b', 'zz'])).toBe('c');
  });
});
