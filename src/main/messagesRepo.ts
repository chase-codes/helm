import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { norm } from '../shared/search/fuzzy';
import { rankQuotes, rankTapes, type QuoteRow, type TapeRow } from '../shared/search/messageScore';
import { parseTapeNo } from '../shared/message/tapeNo';
import type { Message, MessageMeta, TimingMap } from '../shared/types';
import type { MessageImportResult } from '../shared/message/parseImport';

export interface SermonIndexEntry { id: string; tapeNo: string; title: string; date: string; durationS: number }

export interface MessagesRepo {
  installIndex(entries: SermonIndexEntry[]): void;
  installSermon(id: string, paragraphs: { label: string; text: string }[], timing: TimingMap): void;
  list(): MessageMeta[];
  get(id: string): Message | null;
  search(q: string, scope: string | null): { tapes: TapeRow[]; quotes: QuoteRow[] };
  addImported(r: MessageImportResult): MessageMeta[];
  setAudioPath(id: string, path: string): void;
  timings(id: string): TimingMap;
  count(): number;
}

interface MessageRow {
  id: string; tape_no: string; title: string; date: string; duration_s: number;
  audio_path: string | null; audio_url: string | null; source: string; installed_at: number;
}
interface ParagraphRow { message_id: string; ord: number; label: string; text: string }
interface TimingRow { ord: number; t_start: number; t_end: number }
interface QuoteCandidateRow { msgId: string; tapeNo: string; title: string; ord: number; label: string; text: string }

const toMeta = (r: MessageRow): MessageMeta => ({
  id: r.id, tapeNo: r.tape_no, title: r.title, date: r.date, durationS: r.duration_s, hasAudio: r.audio_path != null,
});
const toQuoteRow = (r: QuoteCandidateRow): QuoteRow => ({ ...r, snippet: '' });

export function createMessagesRepo(db: Database.Database): MessagesRepo {
  const upsertMessage = db.prepare(`
    INSERT INTO messages (id, tape_no, title, date, duration_s, source, installed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET tape_no=excluded.tape_no, title=excluded.title, date=excluded.date, duration_s=excluded.duration_s
  `);
  const deleteOldFts = db.prepare(`
    DELETE FROM paragraph_fts WHERE rowid IN (SELECT rowid FROM paragraphs WHERE message_id = ?)
  `);
  const deleteParagraphs = db.prepare('DELETE FROM paragraphs WHERE message_id = ?');
  const deleteTimings = db.prepare('DELETE FROM paragraph_timings WHERE message_id = ?');
  const insertParagraph = db.prepare('INSERT INTO paragraphs (message_id, ord, label, text) VALUES (?,?,?,?)');
  const insertFts = db.prepare(`
    INSERT INTO paragraph_fts (rowid, text)
    VALUES ((SELECT rowid FROM paragraphs WHERE message_id = ? AND ord = ?), ?)
  `);
  const insertTiming = db.prepare('INSERT INTO paragraph_timings (message_id, ord, t_start, t_end) VALUES (?,?,?,?)');
  const selectMessage = db.prepare('SELECT * FROM messages WHERE id = ?');
  const selectAllMessages = db.prepare('SELECT * FROM messages ORDER BY installed_at, title');
  const selectParagraphs = db.prepare('SELECT * FROM paragraphs WHERE message_id = ? ORDER BY ord');
  const selectTimings = db.prepare('SELECT ord, t_start, t_end FROM paragraph_timings WHERE message_id = ? ORDER BY ord');
  const updateAudioPath = db.prepare('UPDATE messages SET audio_path = ? WHERE id = ?');
  const countMessages = db.prepare('SELECT COUNT(*) AS n FROM messages');

  const listMeta = (): MessageMeta[] => (selectAllMessages.all() as MessageRow[]).map(toMeta);

  const installIndex = (entries: SermonIndexEntry[]): void => {
    const txn = db.transaction((rows: SermonIndexEntry[]) => {
      for (const e of rows) {
        upsertMessage.run(e.id, e.tapeNo, e.title, e.date, e.durationS, 'vgr', Date.now());
      }
    });
    txn(entries);
  };

  const installSermon = (id: string, paragraphs: { label: string; text: string }[], timing: TimingMap): void => {
    const txn = db.transaction(() => {
      deleteOldFts.run(id);
      deleteParagraphs.run(id);
      deleteTimings.run(id);
      paragraphs.forEach((p, ord) => {
        insertParagraph.run(id, ord, p.label, p.text);
        insertFts.run(id, ord, p.text);
      });
      for (const t of timing) {
        insertTiming.run(id, t.ord, t.tStart, t.tEnd);
      }
    });
    txn();
  };

  const get = (id: string): Message | null => {
    const m = selectMessage.get(id) as MessageRow | undefined;
    if (!m) return null;
    const paragraphs = (selectParagraphs.all(id) as ParagraphRow[]).map((p) => ({ ord: p.ord, label: p.label, text: p.text }));
    return {
      id: m.id, tapeNo: m.tape_no, title: m.title, date: m.date, durationS: m.duration_s,
      audioPath: m.audio_path, source: m.source, paragraphs,
    };
  };

  const timings = (id: string): TimingMap =>
    (selectTimings.all(id) as TimingRow[]).map((t) => ({ ord: t.ord, tStart: t.t_start, tEnd: t.t_end }));

  const allParagraphCandidates = (scope: string | null): QuoteRow[] => {
    const sql = `
      SELECT p.message_id AS msgId, p.ord AS ord, p.label AS label, p.text AS text,
             m.tape_no AS tapeNo, m.title AS title
      FROM paragraphs p JOIN messages m ON m.id = p.message_id
      ${scope ? 'WHERE p.message_id = ?' : ''}
    `;
    const rows = (scope ? db.prepare(sql).all(scope) : db.prepare(sql).all()) as QuoteCandidateRow[];
    return rows.map(toQuoteRow);
  };

  const search = (q: string, scope: string | null): { tapes: TapeRow[]; quotes: QuoteRow[] } => {
    const tapeRows: TapeRow[] = (selectAllMessages.all() as MessageRow[]).map((r) => ({
      id: r.id, tapeNo: r.tape_no, title: r.title, date: r.date,
    }));
    const tapes = rankTapes(q, tapeRows);

    const tokens = norm(q).split(' ').filter(Boolean);
    if (!tokens.length) return { tapes, quotes: [] };

    const match = tokens.map((t) => `"${t}"*`).join(' OR ');
    const rowids = (db.prepare('SELECT rowid FROM paragraph_fts WHERE paragraph_fts MATCH ?').all(match) as { rowid: number }[]).map((r) => r.rowid);

    let candidates: QuoteRow[];
    if (rowids.length >= 30) {
      const qs = rowids.map(() => '?').join(',');
      const rows = (db.prepare(`
        SELECT p.message_id AS msgId, p.ord AS ord, p.label AS label, p.text AS text,
               m.tape_no AS tapeNo, m.title AS title
        FROM paragraphs p JOIN messages m ON m.id = p.message_id
        WHERE p.rowid IN (${qs})
      `).all(...rowids) as QuoteCandidateRow[]).map(toQuoteRow);
      candidates = scope ? rows.filter((r) => r.msgId === scope) : rows;
    } else {
      candidates = allParagraphCandidates(scope); // sparse FTS hits → typo likely; scan, scorer handles fuzz
    }
    const quotes = rankQuotes(q, candidates);
    return { tapes, quotes };
  };

  const addImported = (r: MessageImportResult): MessageMeta[] => {
    const id = randomUUID();
    const tapeNo = parseTapeNo(r.tapeNo) ?? r.tapeNo;
    const txn = db.transaction(() => {
      upsertMessage.run(id, tapeNo, r.title, r.date, 0, 'local', Date.now());
      deleteOldFts.run(id);
      deleteParagraphs.run(id);
      deleteTimings.run(id);
      r.paragraphs.forEach((p, ord) => {
        insertParagraph.run(id, ord, p.label, p.text);
        insertFts.run(id, ord, p.text);
      });
    });
    txn();
    return listMeta();
  };

  return {
    installIndex,
    installSermon,
    list: listMeta,
    get,
    search,
    addImported,
    setAudioPath: (id, path) => { updateAudioPath.run(path, id); },
    timings,
    count: () => (countMessages.get() as { n: number }).n,
  };
}
