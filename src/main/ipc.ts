import { ipcMain } from 'electron';
import {
  CH,
  type NewSongInput,
  type OutputMode,
  type ScriptureReading,
  type SearchField,
  type Slide,
} from '../shared/types';
import type { SongsRepo } from './songsRepo';
import type { BiblesRepo } from './biblesRepo';
import type { ScheduleRepo } from './scheduleRepo';
import type { SettingsRepo } from './settingsRepo';
import type { BibleInstaller } from './bibleInstaller';
import { presentation } from './stateStore';
import { displayStatus, openTestOutput } from './displays';

export function registerIpc(
  repo: SongsRepo,
  biblesRepo: BiblesRepo,
  scheduleRepo: ScheduleRepo,
  settingsRepo: SettingsRepo,
  installer: BibleInstaller,
): void {
  ipcMain.handle(CH.songsSearch, (_e, q: string, field: SearchField) => repo.search(q, field));
  ipcMain.handle(CH.songsList, () => repo.list());
  ipcMain.handle(CH.songsGet, (_e, id: string) => repo.get(id));
  ipcMain.handle(CH.songsAdd, (_e, input: NewSongInput) => repo.add(input));
  ipcMain.handle(CH.presGet, () => presentation.get());
  ipcMain.on(CH.presCue, (_e, key: string, slide: Slide) => presentation.cue(key, slide));
  ipcMain.on(CH.presGoLive, (_e, key: string, slide: Slide) => presentation.goLive(key, slide));
  ipcMain.on(CH.presSetOutput, (_e, mode: OutputMode) => presentation.setOutput(mode));
  ipcMain.handle(CH.displaysGet, () => displayStatus());
  ipcMain.on(CH.displaysOpenTest, () => openTestOutput());
  ipcMain.handle(CH.biblesManifest, () => installer.manifest());
  ipcMain.on(CH.biblesInstall, (_e, id: string) => installer.install(id));
  ipcMain.handle(CH.biblesUninstall, (_e, id: string) => installer.uninstall(id));
  ipcMain.handle(CH.biblesGetChapter, (_e, book: string, chapter: number) =>
    biblesRepo.getChapter(book, chapter),
  );
  ipcMain.handle(CH.scheduleList, () => scheduleRepo.list());
  ipcMain.handle(CH.scheduleAdd, (_e, r: Omit<ScriptureReading, 'id'>) => scheduleRepo.add(r));
  ipcMain.handle(CH.settingsGet, (_e, key: string, fallback: unknown) =>
    settingsRepo.get(key, fallback),
  );
  ipcMain.on(CH.settingsSet, (_e, key: string, value: unknown) => settingsRepo.set(key, value));
}
