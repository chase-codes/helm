import { expect, test } from 'vitest';
import { parseVerseQuery, rankVerses, scoreVerse, verseKey, type VerseHit } from './verseScore';

const v = (book: string, chapter: number, verse: number, text: string): VerseHit => ({ book, chapter, verse, text });

test('parseVerseQuery: tokens via norm; surrounding quotes mean phrase', () => {
  expect(parseVerseQuery('For God so loved')).toEqual({ tokens: ['for', 'god', 'so', 'loved'], phrase: false });
  expect(parseVerseQuery('"in the beginning"')).toEqual({ tokens: ['in', 'the', 'beginning'], phrase: true });
  expect(parseVerseQuery('"john')).toEqual({ tokens: ['john'], phrase: false });
  expect(parseVerseQuery('   ')).toEqual({ tokens: [], phrase: false });
});

test('scoreVerse gates on every token matching (prefix/fuzzy count)', () => {
  expect(scoreVerse(['zaccheus', 'rich'], false, 'a man named Zaccheus, and he was rich').score).toBeGreaterThan(0);
  expect(scoreVerse(['zacchaeus'], false, 'a man named Zaccheus').score).toBeGreaterThan(0); // lev 1
  expect(scoreVerse(['prodigal', 'son'], false, 'the younger son went into a far country').score).toBe(0);
});

test('phrase queries additionally require the run', () => {
  expect(scoreVerse(['in', 'the', 'beginning'], true, 'In the beginning God created').phrase).toBe(3);
  expect(scoreVerse(['in', 'the', 'beginning'], true, 'the beginning was in God').score).toBe(0);
});

test('rankVerses: phrase run beats scattered words, then canonical order', () => {
  const rows = [
    v('Proverbs', 8, 23, 'I was set up from everlasting, from the beginning, or ever the earth was. In'),
    v('John', 1, 1, 'In the beginning was the Word, and the Word was with God.'),
    v('Genesis', 1, 1, 'In the beginning God created the heaven and the earth.'),
  ];
  const out = rankVerses('in the beginning', rows).map(verseKey);
  // phrase run of 3 in Genesis and John; Proverbs has the words but only a run of 2 → last
  // Genesis and John tie on phrase/cov/dist (every token matches exactly in both) →
  // canonical order puts Genesis first
  expect(out).toEqual(['Genesis:1:1', 'John:1:1', 'Proverbs:8:23']);
});

test('rankVerses: exact match beats prefix match, before canonical order decides', () => {
  const rows = [
    v('Isaiah', 65, 17, 'For, behold, I create new heavens and a new earth: and the former shall not be remembered.'),
    v('Revelation', 21, 1, 'And I saw a new heaven and a new earth: for the first heaven and the first earth were passed away.'),
  ];
  // both carry the 6-word run — Isaiah only via "heavens" prefix-matching "heaven" (dist 1);
  // Revelation's own word is the exact "heaven" (dist 0) → lower total dist → first, despite
  // canonical order (and despite Isaiah coming first in the book order)
  expect(rankVerses('new heaven and a new earth', rows).map(verseKey)).toEqual(['Revelation:21:1', 'Isaiah:65:17']);
});

test('rankVerses is independent of input order; single names list canonically', () => {
  const rows = [
    v('Luke', 19, 5, 'Zaccheus, make haste, and come down; for to day I must abide at thy house.'),
    v('Luke', 19, 8, 'And Zaccheus stood, and said unto the Lord; Behold, Lord, the half of my goods I give to the poor.'),
    v('Luke', 19, 2, 'And, behold, there was a man named Zaccheus, which was the chief among the publicans, and he was rich.'),
  ];
  const a = rankVerses('zaccheus', rows).map(verseKey);
  const b = rankVerses('zaccheus', [...rows].reverse()).map(verseKey);
  expect(a).toEqual(b);
  expect(a).toEqual(['Luke:19:2', 'Luke:19:5', 'Luke:19:8']);
});

test('rankVerses respects limit and drops non-matches', () => {
  const rows = [v('John', 11, 35, 'Jesus wept.'), v('John', 3, 16, 'For God so loved the world')];
  const out = rankVerses('jesus', rows, 1);
  expect(out.map(verseKey)).toEqual(['John:11:35']);
});
