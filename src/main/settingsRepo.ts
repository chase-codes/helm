import type Database from 'better-sqlite3'

export interface SettingsRepo {
  get<T>(key: string, fallback: T): T
  set(key: string, value: unknown): void
}

interface SettingsRow {
  value_json: string
}

export function createSettingsRepo(db: Database.Database): SettingsRepo {
  const selectValue = db.prepare('SELECT value_json FROM settings WHERE key = ?')
  const upsertValue = db.prepare(
    'INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json'
  )

  return {
    get<T>(key: string, fallback: T): T {
      const row = selectValue.get(key) as SettingsRow | undefined
      return row === undefined ? fallback : (JSON.parse(row.value_json) as T)
    },
    set(key, value) {
      upsertValue.run(key, JSON.stringify(value))
    }
  }
}
