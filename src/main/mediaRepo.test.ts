import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from './db';
import { createMediaRepo } from './mediaRepo';

function freshRepo(nowFn?: () => number) {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  return createMediaRepo(db, nowFn);
}

describe('mediaRepo', () => {
  it('adds an image: filePath set, slides empty, createdAt stamped', () => {
    const repo = freshRepo(() => 1000);
    const item = repo.add({ type: 'image', title: 'Backdrop', filePath: 'images/backdrop.jpg', slides: [] });
    expect(item).toMatchObject({ type: 'image', title: 'Backdrop', filePath: 'images/backdrop.jpg', slides: [], createdAt: 1000 });
    expect(item.id).toBeTruthy();
    expect(repo.list()).toHaveLength(1);
  });

  it('adds a deck: slides round-trip through JSON, filePath null', () => {
    const repo = freshRepo(() => 2000);
    const slides = ['decks/foo/slide1.png', 'decks/foo/slide2.png', 'decks/foo/slide3.png'];
    const item = repo.add({ type: 'deck', title: 'Sermon Deck', filePath: null, slides });
    expect(item).toMatchObject({ type: 'deck', title: 'Sermon Deck', filePath: null, slides });

    // round-trip through the DB (not just the in-memory return value) must
    // yield a real array, not a stringified copy
    const reloaded = repo.get(item.id);
    expect(Array.isArray(reloaded?.slides)).toBe(true);
    expect(reloaded?.slides).toEqual(slides);
  });

  it('adds a video: filePath set, type video, slides empty', () => {
    const repo = freshRepo(() => 3000);
    const item = repo.add({ type: 'video', title: 'Baptism Clip', filePath: 'video/baptism.mp4', slides: [] });
    expect(item).toMatchObject({ type: 'video', title: 'Baptism Clip', filePath: 'video/baptism.mp4', slides: [] });
  });

  it('list() orders by createdAt descending (most recently added first)', () => {
    let t = 100;
    const repo = freshRepo(() => t);
    t = 100;
    repo.add({ type: 'image', title: 'First', filePath: 'a.jpg', slides: [] });
    t = 200;
    repo.add({ type: 'image', title: 'Second', filePath: 'b.jpg', slides: [] });
    t = 300;
    repo.add({ type: 'image', title: 'Third', filePath: 'c.jpg', slides: [] });
    const items = repo.list();
    expect(items.map((i) => i.title)).toEqual(['Third', 'Second', 'First']);
  });

  it('get(id) returns the matching item or null', () => {
    const repo = freshRepo();
    const item = repo.add({ type: 'image', title: 'Backdrop', filePath: 'images/backdrop.jpg', slides: [] });
    expect(repo.get(item.id)).toMatchObject({ id: item.id, title: 'Backdrop' });
    expect(repo.get('nonexistent-id')).toBeNull();
  });

  it('remove(id) deletes the item and returns the fresh list', () => {
    const repo = freshRepo();
    const a = repo.add({ type: 'image', title: 'A', filePath: 'a.jpg', slides: [] });
    repo.add({ type: 'image', title: 'B', filePath: 'b.jpg', slides: [] });
    expect(repo.list()).toHaveLength(2);
    const remaining = repo.remove(a.id);
    expect(remaining).toHaveLength(1);
    expect(remaining.some((i) => i.id === a.id)).toBe(false);
    expect(repo.get(a.id)).toBeNull();
  });
});
