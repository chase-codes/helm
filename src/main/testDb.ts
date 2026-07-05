import { DatabaseSync } from 'node:sqlite';
import type Database from 'better-sqlite3';
import { SCHEMA } from './schema';

// Test-only database backed by Node's built-in `node:sqlite` (zero native binary).
//
// Why: better-sqlite3 is a native module compiled for ONE ABI. The app runs on
// Electron's ABI; a stock-Node test run needs a different ABI. Sharing one build
// forces a rebuild dance (and a stray `npm install` silently re-breaks it). node:sqlite
// is compiled into Node itself, so `npm test` never loads better-sqlite3 and the app's
// better-sqlite3 can stay permanently at the Electron ABI.
//
// node:sqlite matches better-sqlite3's prepare()/get()/all()/run()/exec() surface and
// bundles FTS5 (our schema needs it). It lacks two conveniences our repos use —
// .transaction() and .pragma() — which we shim below. The returned handle is cast to
// better-sqlite3's type so it drops into existing repo signatures unchanged; the shim
// implements every method those repos actually call.
type TxFn = (...args: unknown[]) => unknown;

export function openTestDb(): Database.Database {
  const db = new DatabaseSync(':memory:');
  const ext = db as unknown as {
    transaction: (fn: TxFn) => TxFn;
    pragma: (source: string) => void;
  };
  // better-sqlite3's db.transaction(fn) returns a function that runs fn inside a
  // transaction, committing on return and rolling back on throw. Non-nested only —
  // which is all our repos do.
  ext.transaction = (fn) => (...args) => {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
  // Only the production openDb() sets a pragma (WAL); tests never rely on one. No-op.
  ext.pragma = () => {};
  db.exec(SCHEMA);
  return db as unknown as Database.Database;
}
