import { expect, test } from 'vitest';
import { highlightTokens } from './highlight';

test('marks whole words that match a token exactly or by prefix/fuzzy, keeps punctuation', () => {
  expect(highlightTokens('Jesus wept.', ['jesus'])).toEqual([
    { text: 'Jesus', hit: true },
    { text: ' wept.', hit: false }
  ]);
  expect(highlightTokens('a man named Zaccheus, which', ['zacchaeus'])).toEqual([
    { text: 'a man named ', hit: false },
    { text: 'Zaccheus', hit: true },
    { text: ', which', hit: false }
  ]);
});

test('no tokens → one unmarked segment; "son" does not mark "person"', () => {
  expect(highlightTokens('a person', [])).toEqual([{ text: 'a person', hit: false }]);
  expect(highlightTokens('a person', ['son'])).toEqual([{ text: 'a person', hit: false }]);
});

test('a hyphenated compound name bolds as one word', () => {
  expect(highlightTokens('born in Beth–lehem today', ['bethlehem'])).toEqual([
    { text: 'born in ', hit: false },
    { text: 'Beth–lehem', hit: true },
    { text: ' today', hit: false }
  ]);
});
