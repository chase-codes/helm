import { beforeEach, expect, test } from 'vitest'
import Database from 'better-sqlite3'
import { openDb } from './db'
import { createScheduleRepo, type ScheduleRepo } from './scheduleRepo'

let db: Database.Database
let repo: ScheduleRepo

beforeEach(() => {
  db = openDb(':memory:')
  repo = createScheduleRepo(db)
})

test('default service is auto-created once on construction', () => {
  const row = db.prepare('SELECT * FROM services WHERE id = ?').get('default') as
    { id: string; title: string } | undefined
  expect(row?.title).toBe('Sunday Service')
  const count = (db.prepare('SELECT COUNT(*) AS n FROM services').get() as { n: number }).n
  expect(count).toBe(1)
})

test('constructing a second repo on the same db does not duplicate the default service', () => {
  createScheduleRepo(db)
  createScheduleRepo(db)
  const count = (db.prepare('SELECT COUNT(*) AS n FROM services').get() as { n: number }).n
  expect(count).toBe(1)
})

test('add appends with stable position ordering', () => {
  repo.add({ book: 'Genesis', ch: 1, from: 1, to: 2 })
  repo.add({ book: 'John', ch: 3, from: 16, to: 16 })
  const list = repo.add({ book: 'Psalm', ch: 23, from: 1, to: 6 })
  expect(list).toHaveLength(3)
  expect(list.map((r) => r.book)).toEqual(['Genesis', 'John', 'Psalm'])
})

test('exact-duplicate add is a no-op', () => {
  repo.add({ book: 'Genesis', ch: 1, from: 1, to: 2 })
  const list = repo.add({ book: 'Genesis', ch: 1, from: 1, to: 2 })
  expect(list).toHaveLength(1)
})

test('list round-trips after reopening a repo on the same db handle', () => {
  repo.add({ book: 'Genesis', ch: 1, from: 1, to: 2 })
  const repo2 = createScheduleRepo(db)
  const list = repo2.list()
  expect(list).toHaveLength(1)
  expect(list[0]).toMatchObject({ book: 'Genesis', ch: 1, from: 1, to: 2 })
})
