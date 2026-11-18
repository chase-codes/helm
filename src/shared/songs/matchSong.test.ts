import { describe, expect, it } from 'vitest'
import { authorSurnames, buildSongIndex, jaroWinkler, normalizeTitle, type MatchableSong, type MatchResult } from './matchSong'

let n = 0
const s = (title: string, author = '', ccli = ''): MatchableSong => ({ id: `s${++n}`, title, author, ccli })

describe('normalizeTitle (Appendix C)', () => {
  it.each([
    ['Goodness Of God (A)', 'goodness of god'], // the key suffix goes (step 1)
    ['Oceans - Key of D', 'oceans'],
    ['Café Bénédiction', 'cafe benediction'], // NFKD, marks dropped
    ['Jesus’ Blood', 'jesus blood'],
    ["Don't Stop", 'dont stop'],
    ['`Tis So Sweet', 'tis so sweet'],
    ['Mercy & Grace', 'mercy and grace'],
    ['10,000 Reasons (Bless the Lord)', '10000 reasons'],
    ['Oceans (Where Feet May Fail) [Live]', 'oceans'],
    ['Hallelujah, What a Saviour!', 'hallelujah what a saviour'],
    ['The Blessing', 'blessing'],
    ['A Mighty Fortress', 'mighty fortress'],
    ['An Army Arising', 'army arising'],
    ['Theology', 'theology'], // only a whole leading word
    ['  Way   Maker ', 'way maker']
  ])('%s → %s', (title, out) => {
    expect(normalizeTitle(title)).toBe(out)
  })
})

describe('authorSurnames', () => {
  it.each([
    ['Ed Cash, Jason Ingram', ['cash', 'ingram']],
    ['Jenn Johnson & Ed Cash', ['johnson', 'cash']],
    ['Matt Redman / Jonas Myrin; Chris Tomlin', ['redman', 'myrin', 'tomlin']],
    ['Brian Johnson and Jenn Johnson', ['johnson']],
    ['Chris Tomlin with Louie Giglio', ['tomlin', 'giglio']],
    ['Hillsong', ['hillsong']],
    ['Zoë Ångström', ['angstrom']],
    ['', []]
  ])('%s', (author, out) => {
    expect([...authorSurnames(author)].sort()).toEqual([...out].sort())
  })
})

describe('jaroWinkler', () => {
  it('is 1 for equal strings and 0 against empty', () => {
    expect(jaroWinkler('martha', 'martha')).toBe(1)
    expect(jaroWinkler('martha', '')).toBe(0)
  })
  it('matches the textbook values', () => {
    expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.961, 3)
    expect(jaroWinkler('dwayne', 'duane')).toBeCloseTo(0.84, 2)
    expect(jaroWinkler('dixon', 'dicksonx')).toBeCloseTo(0.813, 3)
  })
})

// Appendix C's example pairs, one test per row.
describe('Appendix C examples', () => {
  const match = (songs: MatchableSong[], row: { title: string; author?: string; ccli?: string; firstLine?: string }): MatchResult<MatchableSong> =>
    buildSongIndex(songs).match(row)

  it('1. CCLI decides when the titles differ', () => {
    const wm = s('Waymaker', '', '7115744')
    expect(match([wm, s('Way Maker Live')], { title: 'Way Maker', ccli: '7115744' })).toEqual({ kind: 'one', song: wm, by: 'ccli' })
  })
  it('2. the key suffix is dropped', () => {
    const g = s('Goodness Of God (A)', 'Jenn Johnson, Ed Cash')
    expect(match([g], { title: 'Goodness of God', author: 'Ed Cash, Jason Ingram' })).toEqual({ kind: 'one', song: g, by: 'title' })
  })
  it('3. brackets and the digit comma are dropped', () => {
    const r = s('10000 Reasons', 'Matt Redman, Jonas Myrin')
    expect(match([r], { title: '10,000 Reasons (Bless the Lord)', author: 'Matt Redman' })).toMatchObject({ kind: 'one', song: r, by: 'title' })
  })
  it('4. a leading "the" is dropped', () => {
    const b = s('Blessing')
    expect(match([b], { title: 'The Blessing', author: 'Kari Jobe' })).toMatchObject({ kind: 'one', song: b, by: 'title' })
  })
  it('5. "(Live)" on the Helm side', () => {
    const r = s('Raise a Hallelujah (Live)')
    expect(match([r], { title: 'Raise A Hallelujah' })).toMatchObject({ kind: 'one', song: r })
  })
  it('6. a subtitle on the sheet side', () => {
    const o = s('Oceans')
    expect(match([o], { title: 'Oceans (Where Feet May Fail)' })).toMatchObject({ kind: 'one', song: o })
  })
  it('7. by title when Helm has no author', () => {
    const h = s('How Great Thou Art')
    expect(match([h], { title: 'How Great Thou Art', author: 'Stuart Hine' })).toMatchObject({ kind: 'one', song: h, by: 'title' })
  })
  it('8. one title match: authors are not consulted', () => {
    const b = s('Build My Life', 'Housefires')
    expect(match([b], { title: 'Build My Life', author: 'Pat Barrett' })).toMatchObject({ kind: 'one', song: b })
  })
  it('9. three left after the author filter: Pick one', () => {
    const a = s('Amazing Grace', 'John Newton')
    const b = s('Amazing Grace', 'Newton')
    const c = s('Amazing Grace (My Chains Are Gone)', 'Chris Tomlin, John Newton')
    const m = match([a, b, c], { title: 'Amazing Grace', author: 'John Newton' })
    expect(m.kind).toBe('pick')
    if (m.kind === 'pick') {
      expect(m.by).toBe('title')
      expect(new Set(m.candidates)).toEqual(new Set([a, b, c]))
    }
  })
  it('10. the author filter keeps neither: Pick one among both', () => {
    const a = s('Cornerstone', 'Edward Mote')
    const b = s('Cornerstone', 'Reuben Morgan')
    const m = match([a, b], { title: 'Cornerstone', author: 'Hillsong' })
    expect(m).toMatchObject({ kind: 'pick', by: 'title' })
    if (m.kind === 'pick') expect(new Set(m.candidates)).toEqual(new Set([a, b]))
  })
  it('10b. the author filter keeps one: Ready', () => {
    const a = s('Cornerstone', 'Edward Mote')
    const b = s('Cornerstone', 'Reuben Morgan, Eric Liljero')
    expect(match([a, b], { title: 'Cornerstone', author: 'Reuben Morgan' })).toEqual({ kind: 'one', song: b, by: 'title' })
  })
  it('beyond the appendix: a first line settles a title tie the authors could not', () => {
    const a = s('Amazing Grace')
    const b = s('Amazing Grace')
    a.firstLine = 'Amazing grace! How sweet the sound'
    b.firstLine = 'My chains are gone'
    expect(match([a, b], { title: 'Amazing Grace', firstLine: 'my chains are gone' })).toEqual({ kind: 'one', song: b, by: 'title' })
    expect(match([a, b], { title: 'Amazing Grace', firstLine: 'Something else' })).toMatchObject({ kind: 'pick' })
    expect(match([a, b], { title: 'Amazing Grace' })).toMatchObject({ kind: 'pick' })
  })
  it('11. copies per leader share a CCLI: Pick one', () => {
    const g = s('Song (G)', '', '123')
    const bb = s('Song (Bb)', '', '123')
    const m = match([g, bb], { title: 'Song (G)', ccli: '123' })
    expect(m).toMatchObject({ kind: 'pick', by: 'ccli' })
    if (m.kind === 'pick') expect(new Set(m.candidates)).toEqual(new Set([g, bb]))
  })
  it('12. a near title is fuzzy: Pick one', () => {
    const g = s('Graves to Gardens')
    expect(jaroWinkler('graves into gardens', 'graves to gardens')).toBeGreaterThanOrEqual(0.9)
    expect(match([g, s('Gardens')], { title: 'Graves Into Gardens' })).toEqual({ kind: 'pick', candidates: [g], by: 'fuzzy' })
  })
  it('13. containment passes where Jaro-Winkler does not', () => {
    const w = s('It Is Well')
    expect(jaroWinkler('it is well with my soul', 'it is well')).toBeLessThan(0.9)
    expect(match([w], { title: 'It Is Well With My Soul' })).toEqual({ kind: 'pick', candidates: [w], by: 'fuzzy' })
  })
  it('14. nothing near: Not found', () => {
    expect(match([s('Way Maker'), s('Oceans')], { title: 'Holy Forever' })).toEqual({ kind: 'none' })
  })
  it('15 and 16. the key is compared by the review, not here: the title still matches', () => {
    const g = s('Great Are You Lord')
    expect(match([g], { title: 'Great Are You Lord' })).toMatchObject({ kind: 'one', song: g, by: 'title' })
  })
})

describe('the fuzzy stage', () => {
  it('needs 60% of the shorter title in the longer for Jaro-Winkler to count', () => {
    // A near string that shares no whole token is not a candidate.
    expect(buildSongIndex([s('Waymaker')]).match({ title: 'Way Maker' })).toEqual({ kind: 'none' })
  })
  it('one shared word of three is not enough', () => {
    expect(buildSongIndex([s('Lord I Need You')]).match({ title: 'Lord Reign In Me' })).toEqual({ kind: 'none' })
  })
  it('containment needs two tokens: a one-word title inside a longer one is not a match on its own', () => {
    expect(buildSongIndex([s('Holy')]).match({ title: 'Holy Spirit You Are Welcome Here' })).toEqual({ kind: 'none' })
  })
  it('shows at most three, best first', () => {
    const songs = [s('Holy Holy Holy Lord'), s('Holy Holy Holy'), s('Holy Holy Holy God'), s('Holy Holy Holy Lord God'), s('Holy Holy')]
    const m = buildSongIndex(songs).match({ title: 'Holy Holy Holy' })
    // The exact title wins at stage 2.
    expect(m).toMatchObject({ kind: 'one', song: songs[1] })
    const f = buildSongIndex(songs.filter((x) => x !== songs[1])).match({ title: 'Holy Holy Holy' })
    expect(f.kind).toBe('pick')
    if (f.kind === 'pick') {
      expect(f.candidates).toHaveLength(3)
      const scores = f.candidates.map((c) => jaroWinkler('holy holy holy', normalizeTitle(c.title)))
      expect(scores).toEqual([...scores].sort((a, b) => b - a))
    }
  })
  it('a title that normalises to nothing matches nothing', () => {
    expect(buildSongIndex([s('(G)')]).match({ title: '!!!' })).toEqual({ kind: 'none' })
  })
  it('stays fast over a 3,000-song library and 3,000 rows', () => {
    const words = 'lord god holy grace love you me my king jesus spirit come light way name great praise heart'.split(' ')
    const rnd = (i: number, k: number): string => words[(i * 7 + k * 13) % words.length]
    const songs = Array.from({ length: 3000 }, (_, i) => s(`${rnd(i, 1)} ${rnd(i, 2)} ${rnd(i, 3)} ${i}`))
    const index = buildSongIndex(songs)
    const t0 = performance.now()
    for (let i = 0; i < 3000; i++) index.match({ title: `${rnd(i, 3)} ${rnd(i, 1)} song ${i + 5000}` })
    expect(performance.now() - t0).toBeLessThan(3000)
  })
})
