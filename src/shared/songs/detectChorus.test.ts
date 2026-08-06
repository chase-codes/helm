import { describe, expect, it } from 'vitest';
import { detectChorus } from './detectChorus';

const V1 = 'I love You, Lord\nFor Your mercy never fails me';
const V2 = 'I love Your voice\nYou have led me through the fire';
const CH1 = 'All my life You have been faithful\nAll my life You have been so, so good';

describe('detectChorus', () => {
  it('labels every occurrence of the repeated stanza', () => {
    const input = [V1, CH1, V2, CH1].join('\n\n');
    expect(detectChorus(input)).toBe(
      [V1, `Chorus\n${CH1}`, V2, `Chorus\n${CH1}`].join('\n\n')
    );
  });

  it('matches repeats despite punctuation and case differences', () => {
    const a = 'Your goodness is running after me';
    const b = 'your goodness is running after me!';
    const input = [V1, a, V2, b].join('\n\n');
    const out = detectChorus(input);
    expect(out).toContain(`Chorus\n${a}`);
    expect(out).toContain(`Chorus\n${b}`);
  });

  it('returns text with no repeated stanza unchanged', () => {
    const input = [V1, V2].join('\n\n');
    expect(detectChorus(input)).toBe(input);
  });

  it('returns already-labeled text unchanged', () => {
    const input = [`Chorus\n${CH1}`, V1, CH1].join('\n\n');
    expect(detectChorus(input)).toBe(input);
  });

  it('skips label detection for labels anywhere in stanza first lines', () => {
    const input = [`Verse 1\n${V1}`, CH1, CH1].join('\n\n');
    expect(detectChorus(input)).toBe(input);
  });

  it('ties go to the first-seen repeated stanza', () => {
    const input = [V1, V1, V2, V2].join('\n\n');
    expect(detectChorus(input)).toBe(
      [`Chorus\n${V1}`, `Chorus\n${V1}`, V2, V2].join('\n\n')
    );
  });

  it('handles empty and single-stanza input', () => {
    expect(detectChorus('')).toBe('');
    expect(detectChorus(V1)).toBe(V1);
  });
});
