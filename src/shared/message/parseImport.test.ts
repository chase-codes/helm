import { describe, expect, it } from 'vitest';
import { parseMessageText } from './parseImport';

const RAW = [
  'The Rapture',
  '65-1204',
  'December 4, 1965',
  '',
  'E-1 Let us pray. Our heavenly Father, we approach Thee.',
  'E-2 And now, Lord, as we open Thy Word.',
  '',
  '76 Now, the Rapture is made up of three things.',
  '77 There will be three things happen: a shout, a voice, and a trumpet.',
].join('\n');

describe('parseMessageText', () => {
  it('extracts tape number, title, date', () => {
    const r = parseMessageText(RAW);
    expect(r.tapeNo).toBe('65-1204');
    expect(r.title).toBe('The Rapture');
    expect(r.date).toBe('December 4, 1965');
  });
  it('splits numbered paragraphs, preserving letter-prefixed labels', () => {
    const r = parseMessageText(RAW);
    expect(r.paragraphs).toHaveLength(4);
    expect(r.paragraphs[0]).toEqual({ label: 'E-1', text: 'Let us pray. Our heavenly Father, we approach Thee.' });
    expect(r.paragraphs[2]).toEqual({ label: '76', text: 'Now, the Rapture is made up of three things.' });
  });
  it('joins wrapped continuation lines into the current paragraph', () => {
    const r = parseMessageText('T\n65-1204\nJan 1, 1965\n\n1 First line\ncontinues here.\n2 Second.');
    expect(r.paragraphs[0]).toEqual({ label: '1', text: 'First line continues here.' });
  });
  it('confines header parsing to the preamble — title-like-paragraph and body tape refs do not corrupt output', () => {
    const raw = [
      '1953 The Anointed Ones At The End Time',
      '65-1204',
      'December 4, 1965',
      '',
      '1 As I said on tape 47-0412, faith is the substance.',
      '2 Second paragraph.',
    ].join('\n');
    const r = parseMessageText(raw);
    expect(r.title).toBe('1953 The Anointed Ones At The End Time');
    expect(r.tapeNo).toBe('65-1204');
    expect(r.date).toBe('December 4, 1965');
    expect(r.paragraphs).toHaveLength(2);
    expect(r.paragraphs[0].label).toBe('1');
  });
});
