import type Database from 'better-sqlite3'
import type { BookExtent, ChapterData, InstalledVersion, NormalizedBible, VerseSearchResult } from '../shared/types'
import { VERSE_FTS_COLUMNS } from './schema'
import { andGroupsMatch, FTS_CANDIDATE_LIMIT } from './ftsQuery'
import { matchDist, matchTol } from '../shared/search/fuzzy'
import { parseVerseQuery, rankVerses, type VerseHit } from '../shared/search/verseScore'

export interface BiblesRepo {
  installed(): InstalledVersion[]
  install(bible: NormalizedBible): void
  uninstall(id: string): void
  getChapter(book: string, chapter: number): ChapterData
  isInstalled(id: string): boolean
  bookExtent(book: string, versionId: string): BookExtent
  /** Backfill verse_fts for any version installed before the index existed. Called once at
   * startup from openDb — not lazily on first search, where a half-second stall would land
   * on the first keystroke mid-service. Idempotent. */
  ensureSearchIndex(): void
  /** Ranked verse-text search over one version. See the bible-quick-find spec: AND across
   * words, typo expansion via the vocabulary, bm25 as a tie-break, canonical order last. */
  search(q: string, versionId: string, limit?: number): VerseSearchResult
}

interface VerseRow {
  version_id: string
  verse: number
  text: string
}

export function createBiblesRepo(db: Database.Database): BiblesRepo {
  const insertVersion = db.prepare(
    'INSERT INTO bible_versions (id, abbr, name, language, installed_at) VALUES (?,?,?,?,?)'
  )
  const insertVerse = db.prepare(
    'INSERT INTO verses (version_id, book, chapter, verse, text) VALUES (?,?,?,?,?)'
  )
  const deleteVerses = db.prepare('DELETE FROM verses WHERE version_id = ?')
  const deleteVersion = db.prepare('DELETE FROM bible_versions WHERE id = ?')
  const insertFts = db.prepare(
    `INSERT INTO verse_fts (${VERSE_FTS_COLUMNS.join(', ')}) VALUES (?,?,?,?,?)`
  )
  const deleteFts = db.prepare('DELETE FROM verse_fts WHERE version_id = ?')
  const selectChapter = db.prepare(
    'SELECT version_id, verse, text FROM verses WHERE book = ? AND chapter = ?'
  )
  const selectExtent = db.prepare(
    'SELECT chapter, MAX(verse) AS mv FROM verses WHERE version_id = ? AND book = ? GROUP BY chapter ORDER BY chapter'
  )
  // bm25 orders the CUT only (best candidates survive the LIMIT); the scorer's ladder
  // decides the final order and ends in canonical order — see verseScore.ts.
  const selectHits = db.prepare(
    `SELECT book, chapter, verse, text FROM verse_fts
     WHERE verse_fts MATCH ? AND version_id = ? ORDER BY bm25(verse_fts) LIMIT ${FTS_CANDIDATE_LIMIT}`
  )
  const countHits = db.prepare('SELECT count(*) AS n FROM verse_fts WHERE verse_fts MATCH ? AND version_id = ?')
  const selectVocab = db.prepare('SELECT term FROM verse_vocab')

  // Vocabulary of every indexed term, loaded on first search and dropped when the index
  // changes (install / uninstall / backfill). Shared across versions — fts5vocab can't be
  // filtered by an UNINDEXED column — which only means a KJV spelling can expand a typo
  // while searching WEB; the MATCH itself is still version-filtered.
  let vocab: string[] | null = null
  const invalidateVocab = (): void => { vocab = null }
  const getVocab = (): string[] => (vocab ??= (selectVocab.all() as { term: string }[]).map((r) => r.term))

  // A typed word that no vocabulary term starts with is a likely typo: expand it to the
  // terms within edit tolerance. Words that DO have prefix matches are left alone — fuzzing
  // "los" into "son"/"for" would pollute a perfectly good prefix query.
  const expandToken = (tok: string): string[] => {
    const terms = getVocab()
    if (terms.some((t) => t.startsWith(tok))) return [tok]
    if (tok.length < 3) return [tok]
    const tol = matchTol(tok.length)
    const near = terms.filter((t) => matchDist(tok, t) <= tol)
    return [tok, ...near]
  }

  return {
    installed: () =>
      db.prepare('SELECT id, abbr, name, language FROM bible_versions').all() as InstalledVersion[],
    isInstalled: (id) => !!db.prepare('SELECT 1 FROM bible_versions WHERE id = ?').get(id),
    install(bible) {
      db.transaction(() => {
        insertVersion.run(bible.id, bible.abbr, bible.name, bible.language, Date.now())
        for (const book of bible.books) {
          for (const chapter of book.chapters) {
            for (const verse of chapter.verses) {
              insertVerse.run(bible.id, book.name, chapter.n, verse.n, verse.text)
              insertFts.run(bible.id, book.name, chapter.n, verse.n, verse.text)
            }
          }
        }
      })()
      invalidateVocab()
    },
    uninstall(id) {
      db.transaction(() => {
        deleteFts.run(id)
        deleteVerses.run(id)
        deleteVersion.run(id)
      })()
      invalidateVocab()
    },
    getChapter(book, chapter) {
      const rows = selectChapter.all(book, chapter) as VerseRow[]
      const verses: Record<number, Record<string, string>> = {}
      let verseCount = 0
      for (const r of rows) {
        ;(verses[r.verse] ??= {})[r.version_id] = r.text
        if (r.verse > verseCount) verseCount = r.verse
      }
      return { book, chapter, verseCount, verses }
    },
    bookExtent(book, versionId) {
      const rows = selectExtent.all(versionId, book) as { chapter: number; mv: number }[]
      return { chapters: rows.length, verseCounts: rows.map((r) => r.mv) }
    },
    ensureSearchIndex() {
      const versions = db.prepare('SELECT id FROM bible_versions').all() as { id: string }[]
      for (const { id } of versions) {
        const have = (db.prepare('SELECT count(*) AS n FROM verse_fts WHERE version_id = ?').get(id) as { n: number }).n
        if (have > 0) continue
        try {
          db.transaction(() => {
            const rows = db
              .prepare('SELECT book, chapter, verse, text FROM verses WHERE version_id = ?')
              .all(id) as { book: string; chapter: number; verse: number; text: string }[]
            for (const r of rows) insertFts.run(id, r.book, r.chapter, r.verse, r.text)
          })()
          invalidateVocab()
        } catch (err) {
          // Leave this version unsearchable rather than failing boot.
          console.error(`verse_fts backfill failed for ${id}`, err)
        }
      }
    },
    search(q, versionId, limit = 50) {
      const { tokens, phrase } = parseVerseQuery(q)
      if (!tokens.length) return { hits: [], total: 0, versionId }
      const groups = tokens.map(expandToken)
      const match = andGroupsMatch(groups)
      const rows = selectHits.all(match, versionId) as VerseHit[]
      const ranked = rankVerses(q, rows)
      const hits = ranked.slice(0, limit)
      const total = phrase && rows.length < FTS_CANDIDATE_LIMIT
        ? ranked.length // the scorer's phrase gate dropped candidates; exact when the cut wasn't hit
        : (countHits.get(match, versionId) as { n: number }).n
      return { hits, total, versionId }
    }
  }
}
