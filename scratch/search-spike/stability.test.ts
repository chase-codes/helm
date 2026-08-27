// Keystroke replay over every labeled query: measures (a) top-1 churn — how often
// the row Enter would cue changes under the operator's fingers — and (b)
// monotonicity violations — the target held rank 1, then a CORRECT added
// character demoted it. Both are asserted against RATCHET so accuracy work can
// only improve them. Run with the harness config:
//   npx vitest run -c scratch/search-spike/vitest.config.ts --disableConsoleIntercept
import { test, expect } from 'vitest';
import { openTestDb } from '../../src/main/testDb';
import { createSongsRepo, type SongsRepo } from '../../src/main/songsRepo';
import { buildCorpus } from './corpus';
import { QUERIES } from './queries';
import { RATCHET } from './ratchet';

interface Replay { churn: number; mono: number; steps: number; regressions: Map<string, number> }

function replay(repo: SongsRepo, keyToId: Map<string, string>): Replay {
  let churn = 0; let mono = 0; let steps = 0;
  const regressions = new Map<string, number>();
  for (const q of QUERIES) {
    const targetId = keyToId.get(q.target)!;
    let prevTop: string | null = null;
    let prevWasRank1 = false;
    let reg = 0;
    for (let i = 1; i <= q.q.length; i++) {
      const prefix = q.q.slice(0, i);
      if (!prefix.trim()) continue;
      steps++;
      const res = repo.search(prefix, q.field);
      const top = res[0]?.song.id ?? null;
      if (prevTop !== null && top !== prevTop) churn++;
      prevTop = top;
      const isRank1 = top !== null && top === targetId;
      if (prevWasRank1 && !isRank1) { mono++; reg++; }
      prevWasRank1 = isRank1;
    }
    regressions.set(q.q, reg);
  }
  return { churn, mono, steps, regressions };
}

test('keystroke replay — churn, monotonicity and the reported bug stay ratcheted', () => {
  const repo = createSongsRepo(openTestDb());
  const keyToId = new Map<string, string>();
  for (const s of buildCorpus(300)) {
    keyToId.set(s.key, repo.add({ title: s.title, author: s.author, text: s.text, source: 'seed' }).id);
  }
  const r = replay(repo, keyToId);
  console.log(`replay: ${r.steps} keystrokes | top-1 churn ${r.churn} | monotonicity violations ${r.mono}`);
  console.log(`"give me your hand" hit→miss regressions: ${r.regressions.get('give me your hand')}`);
  expect(r.churn).toBeLessThanOrEqual(RATCHET.churnMax);
  expect(r.mono).toBeLessThanOrEqual(RATCHET.monotonicityMax);
  expect(r.regressions.get('give me your hand')).toBeLessThanOrEqual(RATCHET.giveMeYourHandRegressionsMax);
}, 300000);
