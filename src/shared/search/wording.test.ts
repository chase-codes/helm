import { expect, test } from 'vitest'
import { modernWord, wordingVariants } from './wording'

test('modernWord folds the closed list of older forms', () => {
  expect(['thy', 'thine', 'thee', 'thou', 'ye', 'hath', 'unto', 'saith', 'shew'].map(modernWord)).toEqual(
    ['your', 'your', 'you', 'you', 'you', 'has', 'to', 'says', 'show'])
  expect(modernWord('your')).toBe('your')
})

test('modernWord: -eth verbs to -es, listed -our words to -or, everything else untouched', () => {
  expect(modernWord('loveth')).toBe('loves')
  expect(modernWord('doeth')).toBe('does')
  expect(modernWord('neighbours')).toBe('neighbors')
  expect(modernWord('honourable')).toBe('honorable')
  // not verbs, not on the list
  for (const w of ['nazareth', 'teeth', 'twentieth', 'seth', 'mourning', 'court', 'hour', 'love'])
    expect(modernWord(w), w).toBe(w)
})

test('wordingVariants: the other spellings to look for in the index', () => {
  expect(wordingVariants('your')).toEqual(expect.arrayContaining(['thy', 'thine']))
  expect(wordingVariants('thy')).toEqual(expect.arrayContaining(['your']))
  expect(wordingVariants('loves')).toContain('loveth')
  expect(wordingVariants('strengthens')).toContain('strengtheneth')
  expect(wordingVariants('comes')).toContain('cometh')
  expect(wordingVariants('neighbor')).toContain('neighbour')
  expect(wordingVariants('believeth')).toContain('believes')
  expect(wordingVariants('bethlehem')).toEqual([])
})
