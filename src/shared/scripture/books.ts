import { norm } from '../search/fuzzy'

// name, then aliases beyond the normalized name itself
const T = (name: string, ...aliases: string[]): { name: string; aliases: string[] } => ({
  name,
  aliases: [norm(name), ...aliases]
})
export const BOOKS = [
  T('Genesis', 'gen', 'ge', 'gn'),
  T('Exodus', 'exod', 'exo', 'ex'),
  T('Leviticus', 'lev', 'lv'),
  T('Numbers', 'num', 'nu', 'nm', 'nb'),
  T('Deuteronomy', 'deut', 'deu', 'dt'),
  T('Joshua', 'josh', 'jos', 'jsh'),
  T('Judges', 'judg', 'jdg', 'jg'),
  T('Ruth', 'rth', 'ru'),
  T('1 Samuel', '1samuel', '1 sam', '1sam', '1sa', '1 sa', 'i samuel'),
  T('2 Samuel', '2samuel', '2 sam', '2sam', '2sa', '2 sa', 'ii samuel'),
  T('1 Kings', '1kings', '1 kgs', '1kgs', '1ki', '1 ki', 'i kings'),
  T('2 Kings', '2kings', '2 kgs', '2kgs', '2ki', '2 ki', 'ii kings'),
  T('1 Chronicles', '1chronicles', '1 chron', '1chron', '1 chr', '1chr', '1ch'),
  T('2 Chronicles', '2chronicles', '2 chron', '2chron', '2 chr', '2chr', '2ch'),
  T('Ezra', 'ezr'),
  T('Nehemiah', 'neh', 'ne'),
  T('Esther', 'esth', 'est', 'es'),
  T('Job', 'jb'),
  T('Psalm', 'psalms', 'psa', 'pss', 'ps', 'psm'),
  T('Proverbs', 'prov', 'pro', 'pr', 'prv'),
  T('Ecclesiastes', 'eccles', 'eccl', 'ecc', 'ec', 'qoheleth'),
  T('Song of Solomon', 'song of songs', 'song', 'sos', 'so', 'canticles', 'cant'),
  T('Isaiah', 'isa', 'is'),
  T('Jeremiah', 'jer', 'je', 'jr'),
  T('Lamentations', 'lam', 'la'),
  T('Ezekiel', 'ezek', 'eze', 'ezk'),
  T('Daniel', 'dan', 'da', 'dn'),
  T('Hosea', 'hos', 'ho'),
  T('Joel', 'jl'),
  T('Amos', 'am'),
  T('Obadiah', 'obad', 'ob'),
  T('Jonah', 'jnh', 'jon'),
  T('Micah', 'mic', 'mc'),
  T('Nahum', 'nah', 'na'),
  T('Habakkuk', 'hab', 'hb'),
  T('Zephaniah', 'zeph', 'zep', 'zp'),
  T('Haggai', 'hag', 'hg'),
  T('Zechariah', 'zech', 'zec', 'zc'),
  T('Malachi', 'mal', 'ml'),
  T('Matthew', 'matt', 'mat', 'mt'),
  T('Mark', 'mrk', 'mk', 'mr'),
  T('Luke', 'luk', 'lk'),
  T('John', 'jhn', 'jn'),
  T('Acts', 'act', 'ac'),
  T('Romans', 'rom', 'ro', 'rm'),
  T('1 Corinthians', '1corinthians', '1 cor', '1cor', '1co', '1 co', 'i corinthians'),
  T('2 Corinthians', '2corinthians', '2 cor', '2cor', '2co', '2 co', 'ii corinthians'),
  T('Galatians', 'gal', 'ga'),
  T('Ephesians', 'eph', 'ephes'),
  T('Philippians', 'phil', 'php', 'pp'),
  T('Colossians', 'col', 'co'),
  T('1 Thessalonians', '1thessalonians', '1 thess', '1thess', '1th', '1 th'),
  T('2 Thessalonians', '2thessalonians', '2 thess', '2thess', '2th', '2 th'),
  T('1 Timothy', '1timothy', '1 tim', '1tim', '1ti', '1 ti'),
  T('2 Timothy', '2timothy', '2 tim', '2tim', '2ti', '2 ti'),
  T('Titus', 'tit', 'ti'),
  T('Philemon', 'philem', 'phm', 'pm'),
  T('Hebrews', 'heb'),
  T('James', 'jas', 'jm'),
  T('1 Peter', '1peter', '1 pet', '1pet', '1pe', '1 pe', '1pt'),
  T('2 Peter', '2peter', '2 pet', '2pet', '2pe', '2 pe', '2pt'),
  T('1 John', '1john', '1 jn', '1jn', '1jo', '1 jo'),
  T('2 John', '2john', '2 jn', '2jn', '2jo', '2 jo'),
  T('3 John', '3john', '3 jn', '3jn', '3jo', '3 jo'),
  T('Jude', 'jud', 'jd'),
  T('Revelation', 'revelations', 'rev', 're', 'apocalypse')
] as const

const BOOK_INDEX = new Map(BOOKS.map((b, i) => [b.name, i]))
/** Canonical book order (position in BOOKS) — the final deterministic tie-break in the
 * verse and passage rankers. Unknown names sort last. */
export const canonicalBookIndex = (name: string): number =>
  BOOK_INDEX.get(name) ?? Number.MAX_SAFE_INTEGER

/** Tie-break order for AMBIGUOUS typed prefixes — earlier wins. Everything unlisted keeps
 * canonical order relative to itself, and sorts after everything listed. Only ever consulted
 * when a prefix matches more than one book, so it cannot touch exact aliases.
 * A judgement call, expected to be tuned: it is deliberately static and in one list, so
 * retuning is a one-line change. Not learned from usage — that would make the same keystrokes
 * resolve differently week to week and cold-start empty on a fresh install. */
export const RANKED_BOOKS: readonly string[] = [
  'John',
  'Matthew',
  'Mark',
  'Luke',
  'Acts',
  'Romans',
  'Psalm',
  'Proverbs',
  'Genesis',
  'Exodus',
  'Isaiah',
  'Hebrews',
  'James',
  'Ephesians',
  'Philippians',
  'Galatians',
  'Colossians',
  'Revelation'
]
