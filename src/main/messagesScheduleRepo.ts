import type Database from 'better-sqlite3';
import { createServiceItemsStore } from './serviceItemsStore';

export interface QuoteScheduleItem { id: string; msgId: string; ord: number; label: string; tapeNo: string; title: string }

export interface MessagesScheduleRepo {
  list(): QuoteScheduleItem[];
  add(msgId: string, ord: number): QuoteScheduleItem[];
  remove(id: string): QuoteScheduleItem[];
  /** One transaction for a whole batch — a shift-click range delete is one round trip,
   * mirroring scheduleRepo.removeMany. */
  removeMany(ids: string[]): QuoteScheduleItem[];
}

interface RefJson { msgId: string; ord: number }
interface JoinRow { label: string; tape_no: string; title: string }

export function createMessagesScheduleRepo(db: Database.Database): MessagesScheduleRepo {
  const store = createServiceItemsStore(db, 'quote');

  const selectJoin = db.prepare(`
    SELECT p.label AS label, m.tape_no AS tape_no, m.title AS title
    FROM paragraphs p JOIN messages m ON m.id = p.message_id
    WHERE p.message_id = ? AND p.ord = ?
  `);

  const list = (): QuoteScheduleItem[] =>
    store.listRows().flatMap((row) => {
      const ref = JSON.parse(row.ref_json) as RefJson;
      const j = selectJoin.get(ref.msgId, ref.ord) as JoinRow | undefined;
      if (!j) return [];
      return [{ id: row.id, msgId: ref.msgId, ord: ref.ord, label: j.label, tapeNo: j.tape_no, title: j.title }];
    });

  return {
    list,
    add(msgId, ord) {
      // Dedupe against the *visible* list, not raw rows — preserves the
      // drop-missing behavior: a stored quote whose paragraph no longer exists
      // never blocks an add.
      const visible = new Set(list().map((x) => `${x.msgId}:${x.ord}`));
      store.addRow(JSON.stringify({ msgId, ord }), (existingRefJson) => {
        const ref = JSON.parse(existingRefJson) as RefJson;
        return ref.msgId === msgId && ref.ord === ord && visible.has(`${ref.msgId}:${ref.ord}`);
      });
      return list();
    },
    remove(id) {
      store.remove(id);
      return list();
    },
    removeMany(ids) {
      store.removeMany(ids);
      return list();
    },
  };
}
