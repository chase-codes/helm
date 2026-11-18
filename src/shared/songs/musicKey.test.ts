import { describe, expect, it } from 'vitest'
import {
  MUSIC_KEYS,
  ccliFromCopyright,
  extractKeyFromTitle,
  isMusicKey,
  keyOfPitch,
  normalizeCcli,
  pitchOfKey,
  normalizeKey,
  type KeyRejectReason,
  type MusicKey,
  type NormalizeMode,
  type NormalizeResult,
  type TitleKeyFlag,
  type TitleKeyResult
} from './musicKey'

const K = (key: MusicKey, endKey?: MusicKey): NormalizeResult =>
  endKey ? { kind: 'key', key, endKey } : { kind: 'key', key }
const R = (reason: KeyRejectReason): NormalizeResult => ({ kind: 'reject', reason })
const EMPTY: NormalizeResult = { kind: 'empty' }

describe('MUSIC_KEYS', () => {
  it('has 24 distinct keys', () => {
    expect(new Set(MUSIC_KEYS).size).toBe(24)
  })

  it('isMusicKey accepts only canonical spellings', () => {
    expect(isMusicKey('Bb')).toBe(true)
    expect(isMusicKey('A#')).toBe(false)
    expect(isMusicKey('bb')).toBe(false)
    expect(isMusicKey('')).toBe(false)
  })

  it.each(MUSIC_KEYS)('pitchOfKey and keyOfPitch round-trip %s', (k) => {
    const { pc, minor } = pitchOfKey(k)
    expect(keyOfPitch(pc, minor)).toBe(k)
  })

  it('keyOfPitch wraps mod 12 and spells per appendix A', () => {
    expect(keyOfPitch(7 + 2, false)).toBe('A') // capo 2, G shapes
    expect(keyOfPitch(4 + 3, true)).toBe('Gm') // capo 3, Em shapes
    expect(keyOfPitch(-1, false)).toBe('B')
    expect(keyOfPitch(13, false)).toBe('Db')
    expect(keyOfPitch(3, true)).toBe('Ebm')
  })

  it.each(MUSIC_KEYS)('normalizeKey leaves canonical %s unchanged in both modes', (k) => {
    expect(normalizeKey(k)).toEqual(K(k))
    expect(normalizeKey(k, 'title')).toEqual(K(k))
  })
})

// Appendix B2, row for row.
describe('normalizeKey (B2)', () => {
  const rows: [number, string, NormalizeResult, NormalizeMode?][] = [
    [1, 'G', K('G')],
    [2, 'g', K('G')],
    [3, 'Eb', K('Eb')],
    [4, 'eb', K('Eb')],
    [5, 'bb', K('Bb')],
    [6, 'b', K('B')],
    [7, 'bm', K('Bm')],
    [8, 'bbm', K('Bbm')],
    [9, 'EB', K('Eb')],
    [10, 'B flat', K('Bb')],
    [11, 'b-flat', K('Bb')],
    [12, 'Bflat major', K('Bb')],
    [13, 'Bbmaj', K('Bb')],
    [14, 'G major', K('G')],
    [15, 'GM', K('G')],
    [16, 'E maj', K('E')],
    [17, 'Em', K('Em')],
    [18, 'E minor', K('Em')],
    [19, 'e min', K('Em')],
    [20, 'F# minor', K('F#m')],
    [21, 'f sharp min', K('F#m')],
    [22, 'A#', K('Bb')],
    [23, 'a#m', K('Bbm')],
    [24, 'C#', K('Db')],
    [25, 'Db', K('Db')],
    [26, 'C#m', K('C#m')],
    [27, 'Dbm', K('C#m')],
    [28, 'Gb', K('F#')],
    [29, 'Gb major', K('F#')],
    [30, 'F#/Gb', K('F#')],
    [31, 'Gb/F#', K('F#')],
    [32, 'D#m', K('Ebm')],
    [33, 'Abm', K('G#m')],
    [34, 'G#', K('Ab')],
    [35, 'E#', K('F')],
    [36, 'Cb', K('B')],
    [37, 'Fb', K('E')],
    [38, 'B#', K('C')],
    [39, 'Eb ', K('Eb')],
    [40, '  e♭ ', K('Eb')],
    [41, 'F♯m', K('F#m')],
    [42, 'C♯', K('Db')],
    [43, '(G)', K('G')],
    [44, 'Key of G', K('G')],
    [45, 'Key: D', K('D')],
    [46, 'capo 2 G', K('A')],
    [47, 'Capo 3, Em shapes', K('Gm')],
    [48, 'G shapes capo 2', K('A')],
    [49, 'capo 0 D', K('D')],
    [50, 'A (capo 2)', R('capo-ambiguous')],
    [51, 'capo 12 G', R('not-a-key')],
    [52, 'D - E', K('D', 'E')],
    [53, 'D to E', K('D', 'E')],
    [54, 'Ab→Bb', K('Ab', 'Bb')],
    [55, 'G - G', K('G')],
    [56, 'G/D', R('ambiguous-slash')],
    [57, 'G, A', R('two-keys')],
    [58, 'G or A', R('two-keys')],
    [59, '', EMPTY],
    [60, 'N/A', EMPTY],
    [61, 'H', R('not-a-key')],
    [62, 'G7', R('not-a-key')],
    [63, 'Am7', R('not-a-key')],
    [64, 'Gsus', R('not-a-key')],
    [65, 'C##', R('not-a-key')],
    [66, 'Do', R('not-a-key')],
    [67, '5', R('not-a-key')],
    [68, 'Live', R('not-a-key')],
    [69, 'g', R('not-a-key'), 'title']
  ]

  it.each(rows)('row %i: %j', (_n, input, expected, mode) => {
    expect(normalizeKey(input, mode)).toEqual(expected)
  })

  // Row 60's note: "also n/a, none, ?, -, TBD".
  it.each(['n/a', 'na', 'none', 'NONE', 'unknown', 'tbd', 'TBD', '?', '???', '-', '--', '   '])(
    'treats %j as empty',
    (input) => {
      expect(normalizeKey(input)).toEqual(EMPTY)
    }
  )
})

describe('normalizeKey (B1 rules beyond the table)', () => {
  it.each<[string, NormalizeResult]>([
    ['＃', R('not-a-key')],
    ['F＃m', K('F#m')],
    ['[Bb]', K('Bb')],
    ['( G )', K('G')],
    ['key - E', K('E')],
    ['key E', K('E')],
    ['KEY OF a minor', K('Am')],
    ['G MAJ', K('G')],
    ['E MIN', K('Em')],
    ['E Minor', K('Em')],
    ['E-minor', K('Em')],
    ['B-flat-minor', K('Bbm')],
    ['F -sharp', K('F#')],
    ['eb m', K('Ebm')],
    ['Bbb', R('not-a-key')],
    ['C#b', R('not-a-key')],
    ['Gadd9', R('not-a-key')],
    ['Em I', R('not-a-key')],
    ['capo 3: Em', K('Gm')],
    ['capo 2, G shape', K('A')],
    ['capo 14 G', R('not-a-key')],
    ['Em shapes, capo 4', K('G#m')],
    ['A capo 2', R('capo-ambiguous')],
    ['A, capo 2', R('capo-ambiguous')],
    ['capo 2', R('not-a-key')],
    ['capo 2 G7', R('not-a-key')],
    ['Db/C#', K('Db')],
    ['F# / Gb', K('F#')],
    ['G/Gm', R('ambiguous-slash')],
    ['G/x', R('not-a-key')],
    ['Eb–F', K('Eb', 'F')],
    ['Eb—F', K('Eb', 'F')],
    ['C>D', K('C', 'D')],
    ['A#-Bb', K('Bb')],
    ['C - D - E', R('not-a-key')],
    ['G; A', R('two-keys')],
    ['G & A', R('two-keys')],
    ['G, A, B', R('two-keys')],
    ['G, A7', R('not-a-key')]
  ])('%j', (input, expected) => {
    expect(normalizeKey(input)).toEqual(expected)
  })

  describe('title mode', () => {
    it.each<[string, NormalizeResult]>([
      ['Eb', K('Eb')],
      ['eb', R('not-a-key')],
      ['Key of Bb', K('Bb')],
      ['Bb Major', K('Bb')],
      ['F#/Gb', K('F#')],
      ['D - E', K('D', 'E')],
      ['D - e', R('not-a-key')],
      ['Capo 2', R('not-a-key')],
      ['capo 2 G', R('not-a-key')],
      ['A (capo 2)', R('not-a-key')],
      ['G, A', R('two-keys')],
      ['g, a', R('not-a-key')],
      ['N/A', EMPTY]
    ])('%j', (input, expected) => {
      expect(normalizeKey(input, 'title')).toEqual(expected)
    })
  })
})

// Appendix B3, row for row.
describe('extractKeyFromTitle (B3)', () => {
  const T = (
    title: string,
    key?: MusicKey,
    flag?: TitleKeyFlag,
    endKey?: MusicKey
  ): TitleKeyResult => ({
    title,
    ...(key && { key }),
    ...(endKey && { endKey }),
    ...(flag && { flag })
  })

  const rows: [number, string, TitleKeyResult][] = [
    [1, 'A Child Of The King (Eb)', T('A Child Of The King', 'Eb')],
    [2, 'A Child Of The King      (Eb)  ', T('A Child Of The King', 'Eb')],
    [3, 'Goodness Of God [A]', T('Goodness Of God', 'A', 'single-letter')],
    [4, 'Way Maker (Key of Bb)', T('Way Maker', 'Bb')],
    [5, 'Way Maker (Bb Major)', T('Way Maker', 'Bb')],
    [6, 'Oceans - Key of D', T('Oceans', 'D')],
    [7, 'Song(Bb)', T('Song', 'Bb')],
    [8, 'Song (E♭)', T('Song', 'Eb')],
    [9, 'Song (Em)', T('Song', 'Em')],
    [10, 'Song (E minor)', T('Song', 'Em')],
    [11, 'Song (G#)', T('Song', 'Ab')],
    [12, 'Song (F#/Gb)', T('Song', 'F#')],
    [13, 'Song (Live) (Eb)', T('Song (Live)', 'Eb')],
    [14, 'Song (D - E)', T('Song (D - E)', 'D', 'modulation', 'E')],
    [15, '(G)', T('(G)', 'G', 'single-letter')],
    [16, 'Song (F)', T('Song', 'F', 'single-letter')],
    [17, 'Psalm 23 (A)', T('Psalm 23', 'A', 'single-letter')],
    [18, 'Song (Live)', T('Song (Live)')],
    [19, 'Song (Acoustic)', T('Song (Acoustic)')],
    [20, 'Song (A Cappella)', T('Song (A Cappella)')],
    [21, 'Song (Am I Wrong)', T('Song (Am I Wrong)')],
    [22, 'Song (Capo 2)', T('Song (Capo 2)')],
    [23, 'Song (2)', T('Song (2)')],
    [24, 'Song (H)', T('Song (H)')],
    [25, 'Song (eb)', T('Song (eb)')],
    [26, 'Song (Eb) (Live)', T('Song (Eb) (Live)')],
    [27, 'Song (G, A)', T('Song (G, A)', undefined, 'two-keys')],
    [28, 'Song Bb', T('Song Bb')],
    [29, 'Song (Bb) ', T('Song', 'Bb')],
    [30, 'Song (Dm)', T('Song', 'Dm')]
  ]

  it.each(rows)('row %i: %j', (_n, input, expected) => {
    expect(extractKeyFromTitle(input)).toEqual(expected)
  })
})

describe('extractKeyFromTitle (B3 rules beyond the table)', () => {
  it.each<[string, TitleKeyResult]>([
    ['Song', { title: 'Song' }],
    ['  Song   Title  ', { title: 'Song Title' }],
    ['Song (N/A)', { title: 'Song (N/A)' }],
    ['Song (G/D)', { title: 'Song (G/D)' }],
    ['Song (A capo 2)', { title: 'Song (A capo 2)' }],
    ['Song (Key of G)', { title: 'Song', key: 'G' }],
    ['Song - Key of Bb major', { title: 'Song', key: 'Bb' }],
    ['Song, key: E', { title: 'Song', key: 'E' }],
    ['Song — Key of E minor', { title: 'Song', key: 'Em' }],
    ['Song key Ab', { title: 'Song', key: 'Ab' }],
    ['Key of D', { title: 'Key of D', key: 'D' }],
    ['The Key of Life', { title: 'The Key of Life' }],
    ['Monkey D', { title: 'Monkey D' }],
    ['Song [Eb)', { title: 'Song', key: 'Eb' }],
    ['Song (D to E)', { title: 'Song (D to E)', key: 'D', endKey: 'E', flag: 'modulation' }],
    ['Song (G - G)', { title: 'Song', key: 'G' }],
    ['Song (G or A)', { title: 'Song (G or A)', flag: 'two-keys' }],
    ['Song ( A )', { title: 'Song', key: 'A', flag: 'single-letter' }],
    ['Song (Am)', { title: 'Song', key: 'Am' }],
    ['Song (A really long subtitle)', { title: 'Song (A really long subtitle)' }]
  ])('%j', (input, expected) => {
    expect(extractKeyFromTitle(input)).toEqual(expected)
  })
})

// Appendix B4, row for row.
describe('normalizeCcli (B4)', () => {
  it.each([
    ['7115744', '7115744'],
    ['CCLI# 7115744', '7115744'],
    ['CCLI Song No. 7115744', '7115744'],
    ['7,115,744', '7115744'],
    [' 0022025', '22025'],
    ['N/A', ''],
    ['', ''],
    ['0', ''],
    ['7115744, 25', ''],
    ['123456789', '']
  ])('%j -> %j', (input, expected) => {
    expect(normalizeCcli(input)).toBe(expected)
  })

  it.each([
    ['ccli number: 7115744', '7115744'],
    ['Song #: 22025', '22025'],
    ['12345678', '12345678'],
    ['000', ''],
    ['711 5744', '7115744'],
    ['71,15744', ''],
    ['7,1157', ''],
    ['12a45', '']
  ])('beyond the table: %j -> %j', (input, expected) => {
    expect(normalizeCcli(input)).toBe(expected)
  })
})

describe('ccliFromCopyright (B4)', () => {
  it.each([
    ['© 2017 Bethel Music | CCLI Song # 7115744', '7115744'],
    ['© 2001 Thankyou Music. CCLI Song No 3350395', '3350395'],
    ['CCLI number: 7,115,744', '7115744'],
    ['CCLI #22025, all rights reserved', '22025'],
    ['© 2017 Bethel Music', ''],
    ['CCLI Song # 12', ''],
    ['', '']
  ])('%j -> %j', (input, expected) => {
    expect(ccliFromCopyright(input)).toBe(expected)
  })
})
