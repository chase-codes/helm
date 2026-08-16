import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

export interface QuoteScheduleItem { id: string; msgId: string; ord: number; label: string; tapeNo: string; title: string }

export interface MessagesScheduleRepo {
  list(): QuoteScheduleItem[];
  add(msgId: string, ord: number): QuoteScheduleItem[];
  remove(id: string): QuoteScheduleItem[];
  /** One transaction for a whole batch — a shift-click range delete is one round trip,
   * mirroring scheduleRepo.removeMany. */
  removeMany(ids: string[]): QuoteScheduleItem[];
}

const DEFAULT_SERVICE_ID = 'default';

interface ItemRow { id: string; ref_json: string }
interface RefJson { msgId: string; ord: number }
interface JoinRow { label: string; tape_no: string; title: string }

export function createMessagesScheduleRepo(db: Database.Database): MessagesScheduleRepo {
  db.prepare('INSERT OR IGNORE INTO services (id, title, date) VALUES (?,?,?)').run(
    DEFAULT_SERVICE_ID,
    'Sunday Service',
    ''
  );

  const selectItems = db.prepare(
    "SELECT id, ref_json FROM service_items WHERE service_id = ? AND kind = 'quote' ORDER BY position"
  );
  const insertItem = db.prepare(
    'INSERT INTO service_items (id, service_id, kind, ref_json, position) VALUES (?,?,?,?,?)'
  );
  const maxPosition = db.prepare(
    'SELECT MAX(position) AS m FROM service_items WHERE service_id = ?'
  );
  const deleteItem = db.prepare('DELETE FROM service_items WHERE id = ?');
  const deleteItems = db.transaction((ids: string[]) => {
    for (const id of ids) deleteItem.run(id);
  });
  const selectJoin = db.prepare(`
    SELECT p.label AS label, m.tape_no AS tape_no, m.title AS title
    FROM paragraphs p JOIN messages m ON m.id = p.message_id
    WHERE p.message_id = ? AND p.ord = ?
  `);

  const list = (): QuoteScheduleItem[] =>
    (selectItems.all(DEFAULT_SERVICE_ID) as ItemRow[]).flatMap((row) => {
      const ref = JSON.parse(row.ref_json) as RefJson;
      const j = selectJoin.get(ref.msgId, ref.ord) as JoinRow | undefined;
      if (!j) return [];
      return [{ id: row.id, msgId: ref.msgId, ord: ref.ord, label: j.label, tapeNo: j.tape_no, title: j.title }];
    });

  return {
    list,
    add(msgId, ord) {
      const existing = list();
      const dupe = existing.some((x) => x.msgId === msgId && x.ord === ord);
      if (!dupe) {
        const position = ((maxPosition.get(DEFAULT_SERVICE_ID) as { m: number | null }).m ?? 0) + 1;
        insertItem.run(randomUUID(), DEFAULT_SERVICE_ID, 'quote', JSON.stringify({ msgId, ord }), position);
      }
      return list();
    },
    remove(id) {
      deleteItem.run(id);
      return list();
    },
    removeMany(ids) {
      deleteItems(ids);
      return list();
    },
  };
}
