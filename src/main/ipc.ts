import { ipcMain } from 'electron';
import {
  CH,
  type MessageImportResult,
  type NewSongInput,
  type OutputMode,
  type PreCard,
  type ScriptureReading,
  type SearchField,
  type Slide,
} from '../shared/types';
import type { SongsRepo } from './songsRepo';
import type { BiblesRepo } from './biblesRepo';
import type { ScheduleRepo } from './scheduleRepo';
import type { SettingsRepo } from './settingsRepo';
import type { BibleInstaller } from './bibleInstaller';
import type { MessagesRepo } from './messagesRepo';
import type { MessagesScheduleRepo } from './messagesScheduleRepo';
import type { MessageInstaller } from './messageInstaller';
import type { PreserviceEngine } from './preserviceEngine';
import type { MediaRepo } from './mediaRepo';
import type { MediaImport } from './mediaImport';
import { parseMessageText } from '../shared/message/parseImport';
import { presentation } from './stateStore';
import { video } from './videoState';
import { displayStatus, openTestOutput } from './displays';

export function registerIpc(
  repo: SongsRepo,
  biblesRepo: BiblesRepo,
  scheduleRepo: ScheduleRepo,
  settingsRepo: SettingsRepo,
  installer: BibleInstaller,
  messagesRepo: MessagesRepo,
  messagesScheduleRepo: MessagesScheduleRepo,
  messageInstaller: MessageInstaller,
  preserviceEngine: PreserviceEngine,
  mediaRepo: MediaRepo,
  mediaImport: MediaImport,
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
  ipcMain.handle(CH.biblesBookExtent, (_e, book: string) => {
    // Version-agnostic to the caller: chapter/verse counts are canonically stable across
    // the KJV-family translations for clamping, so resolve to the first installed version
    // (or return {0, []} when none is installed — the builder then can't advance past book).
    const versionId = biblesRepo.installed()[0]?.id
    return versionId ? biblesRepo.bookExtent(book, versionId) : { chapters: 0, verseCounts: [] }
  });
  ipcMain.handle(CH.scheduleList, () => scheduleRepo.list());
  ipcMain.handle(CH.scheduleAdd, (_e, r: Omit<ScriptureReading, 'id'>) => scheduleRepo.add(r));
  ipcMain.handle(CH.settingsGet, (_e, key: string, fallback: unknown) =>
    settingsRepo.get(key, fallback),
  );
  ipcMain.on(CH.settingsSet, (_e, key: string, value: unknown) => settingsRepo.set(key, value));

  ipcMain.handle(CH.messageSearch, (_e, q: string, scope: string | null) =>
    messagesRepo.search(q, scope),
  );
  ipcMain.handle(CH.messageList, () => messagesRepo.list());
  ipcMain.handle(CH.messageGet, (_e, id: string) => messagesRepo.get(id));
  ipcMain.on(CH.messageInstallCorpus, () => messageInstaller.installCorpus());
  ipcMain.handle(CH.messageImportParse, (_e, _kind: 'txt' | 'pdf', data: string) =>
    parseMessageText(data),
  );
  ipcMain.handle(CH.messageImportSave, (_e, r: MessageImportResult) => messagesRepo.addImported(r));
  ipcMain.on(CH.messageDownloadAudio, (_e, id: string) => messageInstaller.downloadAudio(id));
  ipcMain.handle(CH.messageTiming, (_e, id: string) => messagesRepo.timings(id));
  ipcMain.handle(CH.quoteScheduleList, () => messagesScheduleRepo.list());
  ipcMain.handle(CH.quoteScheduleAdd, (_e, msgId: string, ord: number) =>
    messagesScheduleRepo.add(msgId, ord),
  );

  ipcMain.handle(CH.preserviceGetState, () => preserviceEngine.getState());
  ipcMain.on(CH.preserviceEngage, () => preserviceEngine.engage());
  ipcMain.on(CH.preserviceDisengage, () => preserviceEngine.disengage());
  ipcMain.on(CH.preserviceShow, (_e, idx: number) => preserviceEngine.showCard(idx));
  ipcMain.on(CH.preserviceStep, (_e, dir: 1 | -1) => preserviceEngine.step(dir));
  ipcMain.on(CH.preserviceToggleLoop, () => preserviceEngine.toggleLoop());
  ipcMain.on(CH.preserviceSetDwell, (_e, d: number) => preserviceEngine.setDwell(d));
  ipcMain.on(CH.preserviceToggleEnabled, (_e, id: string) => preserviceEngine.toggleEnabled(id));
  ipcMain.on(CH.preserviceSaveCard, (_e, c: Omit<PreCard, 'id'> & { id?: string }) =>
    preserviceEngine.saveCard(c),
  );
  ipcMain.on(CH.preserviceRemoveCard, (_e, id: string) => preserviceEngine.removeCard(id));

  ipcMain.handle(CH.mediaList, () => mediaRepo.list());
  ipcMain.handle(CH.mediaImportImages, () => mediaImport.importImages());
  ipcMain.handle(CH.mediaImportVideo, () => mediaImport.importVideo());
  ipcMain.handle(CH.mediaImportDeck, () => mediaImport.importDeck());
  ipcMain.handle(CH.mediaRemove, (_e, id: string) => mediaRepo.remove(id));

  ipcMain.handle(CH.videoGetState, () => video.get());
  ipcMain.on(CH.videoLoad, (_e, key: string, src: string) => video.load(key, src));
  ipcMain.on(CH.videoPlay, () => video.play());
  ipcMain.on(CH.videoPause, () => video.pause());
  ipcMain.on(CH.videoSeek, (_e, ms: number) => video.seek(ms));
  ipcMain.on(CH.videoSetVolume, (_e, v: number) => video.setVolume(v));
  ipcMain.on(CH.videoSetMuted, (_e, m: boolean) => video.setMuted(m));
  ipcMain.on(CH.videoReportDuration, (_e, ms: number) => video.reportDuration(ms));
}
