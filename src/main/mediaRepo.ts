import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { MediaItem } from '../shared/types';

export type { MediaItem };

export interface MediaRepo {
  list(): MediaItem[];
  add(item: Omit<MediaItem, 'id' | 'createdAt'>): MediaItem;
  remove(id: string): MediaItem[];
  get(id: string): MediaItem | null;
}

interface Row {
  id: string;
  type: string;
  title: string;
  file_path: string | null;
  slides_json: string;
  created_at: number;
}

function toItem(r: Row): MediaItem {
  return {
    id: r.id,
    type: r.type as MediaItem['type'],
    title: r.title,
    filePath: r.file_path,
    slides: JSON.parse(r.slides_json) as string[],
    createdAt: r.created_at
  };
}

export function createMediaRepo(db: Database.Database, nowFn?: () => number): MediaRepo {
  const now = nowFn ?? (() => Date.now());

  // Order by created_at DESC (most recently added first), tie-broken by
  // rowid DESC so items added within the same millisecond still list in
  // reverse-insertion order deterministically.
  const selectAll = db.prepare('SELECT * FROM media_items ORDER BY created_at DESC, rowid DESC');
  const selectOne = db.prepare('SELECT * FROM media_items WHERE id = ?');
  const insert = db.prepare(
    'INSERT INTO media_items (id, type, title, file_path, slides_json, created_at) VALUES (?,?,?,?,?,?)'
  );
  const del = db.prepare('DELETE FROM media_items WHERE id = ?');

  const list = (): MediaItem[] => (selectAll.all() as Row[]).map(toItem);

  return {
    list,
    add(item) {
      const id = randomUUID();
      const createdAt = now();
      insert.run(id, item.type, item.title, item.filePath, JSON.stringify(item.slides), createdAt);
      return { id, ...item, createdAt };
    },
    remove(id) {
      del.run(id);
      return list();
    },
    get(id) {
      const row = selectOne.get(id) as Row | undefined;
      return row ? toItem(row) : null;
    }
  };
}
