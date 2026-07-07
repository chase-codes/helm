import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import type { ScriptureReading } from '../shared/types'

export interface ScheduleRepo {
  list(): ScriptureReading[]
  add(r: Omit<ScriptureReading, 'id'>): ScriptureReading[]
  remove(id: string): ScriptureReading[]
}

const DEFAULT_SERVICE_ID = 'default'

interface ItemRow {
  id: string
  ref_json: string
}
interface RefJson {
  book: string
  ch: number
  from: number
  to: number
}

export function createScheduleRepo(db: Database.Database): ScheduleRepo {
  db.prepare('INSERT OR IGNORE INTO services (id, title, date) VALUES (?,?,?)').run(
    DEFAULT_SERVICE_ID,
    'Sunday Service',
    ''
  )

  const selectItems = db.prepare(
    "SELECT id, ref_json FROM service_items WHERE service_id = ? AND kind = 'scripture' ORDER BY position"
  )
  const insertItem = db.prepare(
    'INSERT INTO service_items (id, service_id, kind, ref_json, position) VALUES (?,?,?,?,?)'
  )
  const maxPosition = db.prepare(
    'SELECT MAX(position) AS m FROM service_items WHERE service_id = ?'
  )
  const deleteItem = db.prepare('DELETE FROM service_items WHERE id = ?')

  const list = (): ScriptureReading[] =>
    (selectItems.all(DEFAULT_SERVICE_ID) as ItemRow[]).map((row) => {
      const ref = JSON.parse(row.ref_json) as RefJson
      return { id: row.id, book: ref.book, ch: ref.ch, from: ref.from, to: ref.to }
    })

  return {
    list,
    add(r) {
      const existing = list()
      const dupe = existing.some(
        (x) => x.book === r.book && x.ch === r.ch && x.from === r.from && x.to === r.to
      )
      if (!dupe) {
        const position = ((maxPosition.get(DEFAULT_SERVICE_ID) as { m: number | null }).m ?? 0) + 1
        insertItem.run(randomUUID(), DEFAULT_SERVICE_ID, 'scripture', JSON.stringify(r), position)
      }
      return list()
    },
    remove(id) {
      deleteItem.run(id)
      return list()
    }
  }
}
