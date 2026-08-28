import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

export interface ServiceItemRow {
  id: string;
  ref_json: string;
}

/**
 * Kind-scoped access to the `service_items` table for the default service.
 * Owns the machinery every schedulable kind needs — default-service bootstrap,
 * prepared statements, MAX(position) appends and the transactional batch
 * delete — so a repo for a new kind is just a ref_json mapping layer on top
 * (see scheduleRepo for 'scripture', messagesScheduleRepo for 'quote').
 */
export interface ServiceItemsStore {
  /** Rows of this store's kind, in position order. */
  listRows(): ServiceItemRow[];
  /**
   * Appends a row at MAX(position)+1 unless `isDupe` returns true for some
   * existing row's ref_json — the caller decides what counts as a duplicate
   * in its own ref shape.
   */
  addRow(refJson: string, isDupe: (existingRefJson: string) => boolean): void;
  remove(id: string): void;
  /** One transaction for a whole batch — a shift-click range delete is one round trip. */
  removeMany(ids: string[]): void;
}

const DEFAULT_SERVICE_ID = 'default';

export function createServiceItemsStore(db: Database.Database, kind: string): ServiceItemsStore {
  db.prepare('INSERT OR IGNORE INTO services (id, title, date) VALUES (?,?,?)').run(
    DEFAULT_SERVICE_ID,
    'Sunday Service',
    ''
  );

  const selectItems = db.prepare(
    'SELECT id, ref_json FROM service_items WHERE service_id = ? AND kind = ? ORDER BY position'
  );
  const insertItem = db.prepare(
    'INSERT INTO service_items (id, service_id, kind, ref_json, position) VALUES (?,?,?,?,?)'
  );
  // Positions are service-wide, not per kind — matching both original repos —
  // so items of different kinds never collide on position.
  const maxPosition = db.prepare(
    'SELECT MAX(position) AS m FROM service_items WHERE service_id = ?'
  );
  const deleteItem = db.prepare('DELETE FROM service_items WHERE id = ?');
  const deleteItems = db.transaction((ids: string[]) => {
    for (const id of ids) deleteItem.run(id);
  });

  const listRows = (): ServiceItemRow[] => selectItems.all(DEFAULT_SERVICE_ID, kind) as ServiceItemRow[];

  return {
    listRows,
    addRow(refJson, isDupe) {
      const dupe = listRows().some((row) => isDupe(row.ref_json));
      if (!dupe) {
        const position = ((maxPosition.get(DEFAULT_SERVICE_ID) as { m: number | null }).m ?? 0) + 1;
        insertItem.run(randomUUID(), DEFAULT_SERVICE_ID, kind, refJson, position);
      }
    },
    remove(id) {
      deleteItem.run(id);
    },
    removeMany(ids) {
      deleteItems(ids);
    },
  };
}
