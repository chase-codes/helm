import { test, expect } from 'vitest';
import { makeFiller, type CorpusSong } from './corpus';

const words = (s: CorpusSong): number => s.text.split(/\s+/).filter(Boolean).length;

test('filler songs are realistically sized (~150-350 words like real pasted songs)', () => {
  const filler = makeFiller(200);
  const avg = filler.map(words).reduce((a, b) => a + b, 0) / filler.length;
  expect(avg).toBeGreaterThan(150);
  expect(avg).toBeLessThan(350);
});

test('generation terminates past the ~5.8k title-combination space', () => {
  // The old skip-on-duplicate loop spun forever here (LEAD×MID×TAIL = 5760 titles).
  const filler = makeFiller(6000);
  expect(filler).toHaveLength(6000);
  expect(new Set(filler.map((s) => s.title)).size).toBe(6000);
}, 30000);
