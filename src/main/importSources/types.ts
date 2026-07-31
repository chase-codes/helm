import type { Located, LocateResult, ScanOutcome } from '../../shared/types';

// The seam that makes a second source (CSV, Excel, another projection program) a new module
// plus a registry entry rather than a second import feature. Everything downstream of scan
// operates on ScannedSong[] and never learns where the songs came from.
export interface ImportSource {
  id: string;
  label: string;
  locate(): Promise<LocateResult>;
  scan(located: Located): Promise<ScanOutcome>;
}

// The slice of a database handle the adapters need. Injected so tests can back it with
// node:sqlite while production uses better-sqlite3.
export interface SourceDb {
  all<T>(sql: string): T[];
  close(): void;
}
