import { beforeEach, describe, expect, it } from 'vitest';
import { openTestDb } from './testDb';
import { createMessagesRepo, type MessagesRepo } from './messagesRepo';

function repo(): MessagesRepo {
  const db = openTestDb();
  return createMessagesRepo(db);
}

describe('messagesRepo', () => {
  let r: MessagesRepo;
  beforeEach(() => {
    r = repo();
  });

  it('installs an index then a sermon and reads it back', () => {
    r.installIndex([{ id: 'rapture', tapeNo: '65-1204', title: 'The Rapture', date: 'December 4, 1965', durationS: 9430 }]);
    r.installSermon('rapture', [
      { label: 'E-1', text: 'Let us pray.' },
      { label: '76', text: 'Now, the Rapture is made up of three things.' },
    ], [{ ord: 0, tStart: 0, tEnd: 5 }, { ord: 1, tStart: 5, tEnd: 12 }]);
    const msg = r.get('rapture');
    expect(msg?.paragraphs).toHaveLength(2);
    expect(msg?.paragraphs[1]).toEqual({ ord: 1, label: '76', text: 'Now, the Rapture is made up of three things.' });
    expect(r.timings('rapture')).toHaveLength(2);
    expect(r.list()[0]).toMatchObject({ id: 'rapture', tapeNo: '65-1204', hasAudio: false });
  });

  it('searches tapes and quotes (FTS + fuzzy)', () => {
    r.installIndex([{ id: 'rapture', tapeNo: '65-1204', title: 'The Rapture', date: '', durationS: 1 }]);
    r.installSermon('rapture', [{ label: '76', text: 'Now, the Rapture is made up of three things.' }], []);
    const res = r.search('rapture', null);
    expect(res.tapes[0].id).toBe('rapture');
    expect(res.quotes[0].label).toBe('76');
  });

  it('scopes quote search to one tape', () => {
    r.installIndex([
      { id: 'a', tapeNo: '65-1204', title: 'The Rapture', date: '', durationS: 1 },
      { id: 'b', tapeNo: '47-0412', title: 'Faith', date: '', durationS: 1 },
    ]);
    r.installSermon('a', [{ label: '1', text: 'grace abounds' }], []);
    r.installSermon('b', [{ label: '1', text: 'grace and faith' }], []);
    expect(r.search('grace', 'a').quotes.every((q) => q.msgId === 'a')).toBe(true);
  });

  it('scoped search still finds a typo in the scoped tape even when the corpus has many exact hits elsewhere', () => {
    // 35 paragraphs across other messages contain the exact word "believe" -> >=30 global FTS hits.
    r.installIndex(Array.from({ length: 35 }, (_, i) => ({
      id: `x${i}`, tapeNo: `60-000${i % 10}`, title: `Other ${i}`, date: '', durationS: 1,
    })));
    for (let i = 0; i < 35; i++) {
      r.installSermon(`x${i}`, [{ label: '1', text: 'you must believe the word' }], []);
    }
    // Target tape T has ONLY a misspelling of "believe" (no exact FTS hit).
    r.installIndex([{ id: 'T', tapeNo: '65-1204', title: 'The Rapture', date: '', durationS: 1 }]);
    r.installSermon('T', [{ label: '76', text: 'you must beleive, for beleive is the victory' }], []);

    const res = r.search('believe', 'T');
    expect(res.quotes.length).toBeGreaterThanOrEqual(1);
    expect(res.quotes.every((q) => q.msgId === 'T')).toBe(true);
  });

  it('sets an audio path', () => {
    r.installIndex([{ id: 'rapture', tapeNo: '65-1204', title: 'The Rapture', date: '', durationS: 1 }]);
    r.setAudioPath('rapture', '/library/65-1204.mp3');
    expect(r.list()[0].hasAudio).toBe(true);
  });

  it('re-running installSermon replaces paragraphs and fts rows cleanly', () => {
    r.installIndex([{ id: 'rapture', tapeNo: '65-1204', title: 'The Rapture', date: '', durationS: 1 }]);
    r.installSermon('rapture', [{ label: '1', text: 'first version text' }], []);
    r.installSermon('rapture', [
      { label: '1', text: 'second version alpha' },
      { label: '2', text: 'second version beta' },
    ], []);
    const msg = r.get('rapture');
    expect(msg?.paragraphs).toHaveLength(2);
    expect(r.search('first', null).quotes).toHaveLength(0);
    expect(r.search('second', null).quotes.length).toBeGreaterThan(0);
  });

  it('addImported creates a new local message and returns the updated list', () => {
    const list = r.addImported({
      tapeNo: '65-1204E',
      title: 'The Rapture',
      date: 'December 4, 1965',
      paragraphs: [{ label: '1', text: 'imported paragraph text' }],
    });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ tapeNo: '65-1204E', title: 'The Rapture' });
    const msg = r.get(list[0].id);
    expect(msg?.paragraphs).toHaveLength(1);
    expect(msg?.source).toBe('local');
  });

  it('count reflects installed messages', () => {
    expect(r.count()).toBe(0);
    r.installIndex([{ id: 'a', tapeNo: '65-1204', title: 'The Rapture', date: '', durationS: 1 }]);
    expect(r.count()).toBe(1);
  });
});
