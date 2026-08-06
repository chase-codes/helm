import { beforeEach, expect, test } from 'vitest'
import type Database from 'better-sqlite3'
import { openTestDb } from './testDb'
import { createSettingsRepo, type SettingsRepo } from './settingsRepo'
import { resolveView } from '../shared/displays/roles'
import type { OutputViewMode } from '../shared/types'

let db: Database.Database
let repo: SettingsRepo

beforeEach(() => {
  db = openTestDb()
  repo = createSettingsRepo(db)
})

test('get returns fallback when key missing', () => {
  expect(repo.get('missingKey', 'fallback')).toBe('fallback')
  expect(repo.get('missingObj', { a: 1 })).toEqual({ a: 1 })
})

test('set then get round-trips a primitive value', () => {
  repo.set('volume', 42)
  expect(repo.get('volume', 0)).toBe(42)
})

test('set then get round-trips an object value', () => {
  const value = { theme: 'dark', versions: ['kjv', 'esv'] }
  repo.set('prefs', value)
  expect(repo.get('prefs', {})).toEqual(value)
})

test('set overwrites an existing key', () => {
  repo.set('scriptureVersions', ['kjv'])
  repo.set('scriptureVersions', ['kjv', 'esv'])
  expect(repo.get<string[]>('scriptureVersions', [])).toEqual(['kjv', 'esv'])
})

test('JSON round-trip preserves types: a number stays a number, not a string', () => {
  repo.set('count', 7)
  const result = repo.get('count', 0)
  expect(result).toBe(7)
  expect(typeof result).toBe('number')
})

test('set then get round-trips displays:views, and resolveView reads the fetched record', () => {
  const views: Record<string, OutputViewMode> = {
    'label:BenQ': 'leader',
    'geo:1024x600@1r0': 'mirror'
  }
  repo.set('displays:views', views)
  const fetched = repo.get<Record<string, OutputViewMode>>('displays:views', {})
  expect(fetched).toEqual(views)
  expect(resolveView(fetched, 'label:BenQ')).toBe('leader')
  expect(resolveView(fetched, 'geo:1024x600@1r0')).toBe('mirror')
  expect(resolveView(fetched, 'label:Unknown')).toBe('slides')
})
