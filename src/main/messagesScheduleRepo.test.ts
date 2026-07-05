import { beforeEach, expect, test } from 'vitest';
import type Database from 'better-sqlite3';
import { openTestDb } from './testDb';
import { createMessagesRepo } from './messagesRepo';
import { createMessagesScheduleRepo, type MessagesScheduleRepo } from './messagesScheduleRepo';

let db: Database.Database;
let repo: MessagesScheduleRepo;

beforeEach(() => {
  db = openTestDb();
  const messages = createMessagesRepo(db);
  messages.installIndex([{ id: 'rapture', tapeNo: '65-1204', title: 'The Rapture', date: '', durationS: 1 }]);
  messages.installSermon('rapture', [
    { label: 'E-1', text: 'Let us pray.' },
    { label: '76', text: 'Now, the Rapture is made up of three things.' },
  ], []);
  repo = createMessagesScheduleRepo(db);
});

test('add appends a quote with stable position ordering', () => {
  repo.add('rapture', 0);
  const list = repo.add('rapture', 1);
  expect(list).toHaveLength(2);
  expect(list.map((r) => r.label)).toEqual(['E-1', '76']);
  expect(list[0]).toMatchObject({ msgId: 'rapture', ord: 0, tapeNo: '65-1204', title: 'The Rapture' });
});

test('exact-duplicate add is a no-op', () => {
  repo.add('rapture', 0);
  const list = repo.add('rapture', 0);
  expect(list).toHaveLength(1);
});

test('list round-trips after reopening a repo on the same db handle', () => {
  repo.add('rapture', 0);
  const repo2 = createMessagesScheduleRepo(db);
  const list = repo2.list();
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ msgId: 'rapture', ord: 0 });
});
