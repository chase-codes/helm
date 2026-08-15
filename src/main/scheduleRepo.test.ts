import { beforeEach, expect, test } from 'vitest'
import type Database from 'better-sqlite3'
import { openTestDb } from './testDb'
import { createScheduleRepo, type ScheduleRepo } from './scheduleRepo'

let db: Database.Database
let repo: ScheduleRepo

beforeEach(() => {
  db = openTestDb()
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

test('remove deletes by id and returns the updated list', () => {
  repo.add({ book: 'Genesis', ch: 1, from: 1, to: 2 })
  const two = repo.add({ book: 'John', ch: 3, from: 16, to: 16 })
  const target = two.find((r) => r.book === 'John')!
  const after = repo.remove(target.id)
  expect(after).toHaveLength(1)
  expect(after[0].book).toBe('Genesis')
})

test('remove of an unknown id is a no-op returning the current list', () => {
  repo.add({ book: 'Genesis', ch: 1, from: 1, to: 2 })
  const after = repo.remove('does-not-exist')
  expect(after).toHaveLength(1)
})

test('removeMany deletes all given ids in one call and returns the updated list', () => {
  repo.add({ book: 'Genesis', ch: 1, from: 1, to: 2 })
  repo.add({ book: 'John', ch: 3, from: 16, to: 16 })
  const three = repo.add({ book: 'Psalm', ch: 23, from: 1, to: 6 })
  const doomed = three.filter((r) => r.book !== 'John').map((r) => r.id)
  const after = repo.removeMany(doomed)
  expect(after).toHaveLength(1)
  expect(after[0].book).toBe('John')
})

test('removeMany with every id clears the schedule', () => {
  repo.add({ book: 'Genesis', ch: 1, from: 1, to: 2 })
  const all = repo.add({ book: 'John', ch: 3, from: 16, to: 16 })
  expect(repo.removeMany(all.map((r) => r.id))).toHaveLength(0)
})

test('removeMany tolerates unknown ids and an empty list', () => {
  const one = repo.add({ book: 'Genesis', ch: 1, from: 1, to: 2 })
  expect(repo.removeMany(['does-not-exist'])).toHaveLength(1)
  expect(repo.removeMany([])).toHaveLength(1)
  expect(repo.removeMany([one[0].id, 'does-not-exist'])).toHaveLength(0)
})
