import { beforeEach, describe, expect, it } from 'vitest';
import { openTestDb } from '../../main/testDb';
import { createSongsRepo, type SongsRepo } from '../../main/songsRepo';
import { scannedImportKey, songImportKey } from './importKey';

let repo: SongsRepo;
beforeEach(() => {
  repo = createSongsRepo(openTestDb());
});

describe('importKey', () => {
  // The trap this exists to prevent: section labels are stripped by splitToSlides, so a raw
  // text key and a stored Song key would never agree and nothing would ever be a duplicate.
  it('gives a scanned song and the Song it becomes the same key', () => {
    const title = 'Amazing Grace';
    const text = 'Verse 1\nAmazing grace! how sweet the sound\n\nChorus\nPraise God';
    const song = repo.add({ title, author: 'John Newton', text });
    expect(scannedImportKey(title, text)).toBe(songImportKey(song));
  });

  it('ignores case and whitespace differences', () => {
    expect(scannedImportKey('Amazing  Grace', 'Praise   God')).toBe(
      scannedImportKey('amazing grace', 'praise god')
    );
  });

  it('distinguishes two arrangements sharing a title', () => {
    expect(scannedImportKey('Amazing Grace', 'Praise God')).not.toBe(
      scannedImportKey('Amazing Grace', 'A different second verse')
    );
  });

  it('distinguishes two songs sharing lyrics but not a title', () => {
    expect(scannedImportKey('One', 'Praise God')).not.toBe(scannedImportKey('Two', 'Praise God'));
  });

  it('ignores the author, which is not part of identity', () => {
    const text = 'Praise God';
    const a = repo.add({ title: 'Doxology', author: 'Ken', text });
    expect(songImportKey(a)).toBe(scannedImportKey('Doxology', text));
  });
});
