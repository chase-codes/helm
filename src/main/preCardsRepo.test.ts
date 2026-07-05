import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from './db';
import { createPreCardsRepo } from './preCardsRepo';

function freshRepo(): ReturnType<typeof createPreCardsRepo> {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  return createPreCardsRepo(db);
}

describe('preCardsRepo', () => {
  it('seeds the default loop on first construction', () => {
    const repo = freshRepo();
    const cards = repo.list();
    expect(cards.map((c) => c.type)).toEqual(['message', 'verse', 'list', 'list', 'logo']);
    expect(cards.find((c) => c.type === 'logo')?.enabled).toBe(false);
    expect(cards.find((c) => c.type === 'verse')?.ref).toBe('Psalm 122:1');
  });
  it('does not re-seed when rows already exist', () => {
    const db = new Database(':memory:');
    db.exec(SCHEMA);
    createPreCardsRepo(db);
    const second = createPreCardsRepo(db);
    expect(second.list()).toHaveLength(5);
  });
  it('wipes and re-seeds a DB that still has a legacy countdown card', () => {
    const db = new Database(':memory:');
    db.exec(SCHEMA);
    const ins = db.prepare('INSERT INTO pre_cards (id, type, title, payload_json, enabled, position) VALUES (?,?,?,?,?,?)');
    ins.run('cd', 'countdown', 'Countdown', '{}', 1, 0);
    ins.run('m', 'message', 'Edited Welcome', '{}', 1, 1);
    const repo = createPreCardsRepo(db);
    const cards = repo.list();
    expect(cards.map((c) => c.type)).toEqual(['message', 'verse', 'list', 'list', 'logo']);
  });
  it('leaves a countdown-free populated DB untouched (migration does not re-fire)', () => {
    const db = new Database(':memory:');
    db.exec(SCHEMA);
    db.prepare('INSERT INTO pre_cards (id, type, title, payload_json, enabled, position) VALUES (?,?,?,?,?,?)')
      .run('only', 'message', 'Custom', '{}', 1, 0);
    const repo = createPreCardsRepo(db);
    expect(repo.list()).toHaveLength(1);
    expect(repo.list()[0].title).toBe('Custom');
  });
  it('save inserts a new card at the end', () => {
    const repo = freshRepo();
    const after = repo.save({ type: 'message', title: 'Notice', headline: 'Hi', subtitle: 'There', enabled: true });
    expect(after).toHaveLength(6);
    expect(after[after.length - 1]).toMatchObject({ type: 'message', headline: 'Hi', subtitle: 'There', enabled: true });
  });
  it('save updates an existing card by id', () => {
    const repo = freshRepo();
    const verse = repo.list().find((c) => c.type === 'verse')!;
    const after = repo.save({ ...verse, text: 'changed' });
    expect(after.find((c) => c.id === verse.id)?.text).toBe('changed');
    expect(after).toHaveLength(5);
  });
  it('setEnabled toggles the flag; remove deletes', () => {
    const repo = freshRepo();
    const logo = repo.list().find((c) => c.type === 'logo')!;
    expect(repo.setEnabled(logo.id, true).find((c) => c.id === logo.id)?.enabled).toBe(true);
    expect(repo.remove(logo.id).some((c) => c.id === logo.id)).toBe(false);
  });
});
