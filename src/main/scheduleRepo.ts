import type Database from 'better-sqlite3'
import type { ScriptureReading } from '../shared/types'
import { createServiceItemsStore } from './serviceItemsStore'

export interface ScheduleRepo {
  list(): ScriptureReading[]
  add(r: Omit<ScriptureReading, 'id'>): ScriptureReading[]
  remove(id: string): ScriptureReading[]
  removeMany(ids: string[]): ScriptureReading[]
}

interface RefJson {
  book: string
  ch: number
  from: number
  to: number
}

export function createScheduleRepo(db: Database.Database): ScheduleRepo {
  const store = createServiceItemsStore(db, 'scripture')

  const list = (): ScriptureReading[] =>
    store.listRows().map((row) => {
      const ref = JSON.parse(row.ref_json) as RefJson
      return { id: row.id, book: ref.book, ch: ref.ch, from: ref.from, to: ref.to }
    })

  return {
    list,
    add(r) {
      store.addRow(JSON.stringify(r), (existingRefJson) => {
        const x = JSON.parse(existingRefJson) as RefJson
        return x.book === r.book && x.ch === r.ch && x.from === r.from && x.to === r.to
      })
      return list()
    },
    remove(id) {
      store.remove(id)
      return list()
    },
    removeMany(ids) {
      store.removeMany(ids)
      return list()
    }
  }
}
