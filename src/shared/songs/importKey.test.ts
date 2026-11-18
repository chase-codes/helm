import { beforeEach, describe, expect, it } from 'vitest';
import { openTestDb } from '../../main/testDb';
import { createSongsRepo, type SongsRepo } from '../../main/songsRepo';
import { scannedImportKey, songImportKeys } from './importKey';

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
    expect(songImportKeys(song)).toContain(scannedImportKey(title, text));
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
    expect(songImportKeys(a)).toContain(scannedImportKey('Doxology', text));
  });

  // Song keys spec, Phase 1d: the key is part of identity, and the title is the clean title.
  describe('keys in titles', () => {
    const text = 'Verse 1\nO that will be glory for me';

    it('still matches an "X (Eb)" stored before keys moved out of titles to "X (Eb)" re-scanned', () => {
      const stored = repo.add({ title: 'A Child Of The King (Eb)', text });
      expect(songImportKeys(stored)).toContain(scannedImportKey('A Child Of The King      (Eb)', text));
    });

    it('matches the "X" + key Eb the sweep made of it to "X (Eb)" re-scanned', () => {
      const added = repo.add({ title: 'A Child Of The King (Eb)', text });
      const [swept] = repo.setMusicKeys([{ id: added.id, key: 'Eb', source: 'title', title: 'A Child Of The King' }]);
      expect(songImportKeys(swept)).toContain(scannedImportKey('A Child Of The King (Eb)', text));
    });

    it('keeps "X (G)" and "X (Bb)" with identical lyrics as two songs', () => {
      expect(scannedImportKey('Holy Spirit (G)', text)).not.toBe(scannedImportKey('Holy Spirit (Bb)', text));
      const g = repo.add({ title: 'Holy Spirit (G)', text });
      expect(songImportKeys(g)).not.toContain(scannedImportKey('Holy Spirit (Bb)', text));
    });

    it('does not let a key a person set make the same untitled song look new', () => {
      const added = repo.add({ title: 'Cornerstone', text });
      const keyed = repo.setMusicKey(added.id, 'C', 'typed');
      expect(songImportKeys(keyed)).toContain(scannedImportKey('Cornerstone', text));
      // …and that person's key is the C copy a scanned "Cornerstone (C)" finds.
      expect(songImportKeys(keyed)).toContain(scannedImportKey('Cornerstone (C)', text));
    });

    it('keeps a modulation title whole on both sides', () => {
      const stored = repo.add({ title: 'Oceans (D - E)', text });
      expect(songImportKeys(stored)).toContain(scannedImportKey('Oceans (D - E)', text));
      expect(scannedImportKey('Oceans (D - E)', text)).not.toBe(scannedImportKey('Oceans', text));
    });
  });
});
