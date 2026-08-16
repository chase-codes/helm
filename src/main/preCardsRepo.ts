import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { PreCard, PreCardType } from '../shared/types';

interface Row { id: string; type: string; title: string; payload_json: string; enabled: number; position: number }
const PAYLOAD_KEYS = ['headline', 'subtitle', 'ref', 'text', 'version', 'points', 'src'] as const;

const SEED: Omit<PreCard, 'id'>[] = [
  { type: 'message', title: 'Welcome', headline: 'Welcome', subtitle: 'We\'re glad you\'re here this morning', enabled: true },
  { type: 'verse', title: 'Psalm 122:1', ref: 'Psalm 122:1', text: 'I was glad when they said unto me, Let us go into the house of the LORD.', enabled: true },
  { type: 'list', title: 'Announcements', points: ['Fellowship dinner — next Sunday after service', 'Youth night — Wednesday 7:00 PM', 'Fall campout sign-up sheet in the foyer'], enabled: true },
  { type: 'list', title: 'Prayer Requests', points: ['The Hollis family', 'Sis. Ruth — recovering from surgery', 'Traveling ministers this week'], enabled: true },
  { type: 'logo', title: 'Logo', enabled: false }
];

function toCard(r: Row): PreCard {
  const payload = JSON.parse(r.payload_json) as Record<string, unknown>;
  return { id: r.id, type: r.type as PreCardType, title: r.title, enabled: r.enabled === 1, ...payload };
}
function payloadOf(card: Partial<PreCard>): string {
  const out: Record<string, unknown> = {};
  for (const k of PAYLOAD_KEYS) if (card[k] !== undefined) out[k] = card[k];
  return JSON.stringify(out);
}

export interface PreCardsRepo {
  list(): PreCard[];
  save(card: Omit<PreCard, 'id'> & { id?: string }): PreCard[];
  remove(id: string): PreCard[];
  /**
   * Put a removed card back at `index`, keeping its original id and payload — the undo
   * half of the remove/undo grammar (#86). Distinct from `save`, which always appends:
   * an undo that dropped the card at the end of the loop would silently reorder the
   * rotation the operator was only trying to restore.
   */
  restore(card: PreCard, index: number): PreCard[];
  setEnabled(id: string, enabled: boolean): PreCard[];
}

export function createPreCardsRepo(db: Database.Database): PreCardsRepo {
  const selectAll = db.prepare('SELECT * FROM pre_cards ORDER BY position');
  const count = db.prepare('SELECT COUNT(*) AS n FROM pre_cards');
  const insert = db.prepare('INSERT INTO pre_cards (id, type, title, payload_json, enabled, position) VALUES (?,?,?,?,?,?)');
  const update = db.prepare('UPDATE pre_cards SET type=?, title=?, payload_json=?, enabled=? WHERE id=?');
  const del = db.prepare('DELETE FROM pre_cards WHERE id=?');
  const setEn = db.prepare('UPDATE pre_cards SET enabled=? WHERE id=?');
  const setPos = db.prepare('UPDATE pre_cards SET position=? WHERE id=?');
  const maxPos = db.prepare('SELECT MAX(position) AS m FROM pre_cards');

  const list = (): PreCard[] => (selectAll.all() as Row[]).map(toCard);

  const seed = (): void => {
    const seedTx = db.transaction(() => {
      SEED.forEach((c, i) => insert.run(randomUUID(), c.type, c.title, payloadOf(c), c.enabled ? 1 : 0, i));
    });
    seedTx();
  };

  // One-time migration: older installs auto-seeded a now-removed 'countdown' card.
  // Wipe the whole loop so the count==0 guard below re-seeds the countdown-free
  // defaults. Self-limiting — after re-seed no countdown row remains, so it never
  // fires again. Must run BEFORE the count==0 guard, or a populated countdown-bearing
  // DB would slip through untouched. Acceptable wipe: pre-cards are still auto-seeded
  // defaults at this stage, so any operator edits are discarded.
  const hasCountdown = db.prepare("SELECT COUNT(*) AS n FROM pre_cards WHERE type = 'countdown'");
  if ((hasCountdown.get() as { n: number }).n > 0) {
    db.prepare('DELETE FROM pre_cards').run();
  }

  if ((count.get() as { n: number }).n === 0) {
    seed();
  }

  return {
    list,
    save(card) {
      if (card.id) {
        update.run(card.type, card.title, payloadOf(card), card.enabled ? 1 : 0, card.id);
      } else {
        const pos = ((maxPos.get() as { m: number | null }).m ?? -1) + 1;
        insert.run(randomUUID(), card.type, card.title, payloadOf(card), card.enabled ? 1 : 0, pos);
      }
      return list();
    },
    remove(id) { del.run(id); return list(); },
    // Splice-and-renumber rather than "insert at position N": `position` values are only
    // ever read through ORDER BY, and a removal leaves a gap, so there is no free integer
    // that reliably lands the card between two neighbours. Rewriting every row's position
    // to its array index is cheap (a loop is five rows long) and leaves the column dense,
    // which keeps `save`'s MAX(position)+1 append honest afterwards.
    restore(card, index) {
      const ids = list().map((c) => c.id);
      const at = Math.max(0, Math.min(index, ids.length));
      const restoreTx = db.transaction(() => {
        insert.run(card.id, card.type, card.title, payloadOf(card), card.enabled ? 1 : 0, ids.length);
        ids.splice(at, 0, card.id);
        ids.forEach((id, i) => setPos.run(i, id));
      });
      restoreTx();
      return list();
    },
    setEnabled(id, enabled) { setEn.run(enabled ? 1 : 0, id); return list(); }
  };
}
