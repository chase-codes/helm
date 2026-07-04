import type Database from 'better-sqlite3'
import type { BookExtent, ChapterData, InstalledVersion, NormalizedBible } from '../shared/types'

export interface BiblesRepo {
  installed(): InstalledVersion[]
  install(bible: NormalizedBible): void
  uninstall(id: string): void
  getChapter(book: string, chapter: number): ChapterData
  isInstalled(id: string): boolean
  bookExtent(book: string, versionId: string): BookExtent
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
  const selectChapter = db.prepare(
    'SELECT version_id, verse, text FROM verses WHERE book = ? AND chapter = ?'
  )
  const selectExtent = db.prepare(
    'SELECT chapter, MAX(verse) AS mv FROM verses WHERE version_id = ? AND book = ? GROUP BY chapter ORDER BY chapter'
  )

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
            }
          }
        }
      })()
    },
    uninstall(id) {
      db.transaction(() => {
        deleteVerses.run(id)
        deleteVersion.run(id)
      })()
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
    }
  }
}
