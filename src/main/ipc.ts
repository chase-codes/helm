import { app, ipcMain } from 'electron';
import { CH, type HelmApi } from '../shared/types';
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
import type { SongImport } from './songImport';
import type { SongSources } from './songSources';
import type { Updater } from './updater';
import { parseMessageText } from '../shared/message/parseImport';
import { presentation } from './stateStore';
import { video } from './videoState';
import {
  displayStatus,
  openTestOutput,
  setDisplayRole,
  setDisplayView,
  setLeaderSplitByFingerprint,
  setLeaderSplitFromSender,
  toggleOutputsReleased,
} from './displays';

type AnyFn = (...args: never[]) => unknown;

// Registration helpers: each callback's argument and return types are derived from the
// HelmApi method the channel serves (instantiate as `handleApi<HelmApi['songs']['search']>`),
// so the main side of the renderer contract is compile-checked instead of hand-annotated —
// preload and main can't drift silently as channels are added.
function handleApi<F extends AnyFn>(
  channel: string,
  fn: (...args: Parameters<F>) => Awaited<ReturnType<F>> | Promise<Awaited<ReturnType<F>>>,
): void {
  ipcMain.handle(channel, (_e, ...args) => fn(...(args as Parameters<F>)));
}

function onApi<F extends AnyFn>(channel: string, fn: (...args: Parameters<F>) => void): void {
  ipcMain.on(channel, (_e, ...args) => fn(...(args as Parameters<F>)));
}

// Same as onApi, for the rare registration that also needs the sending WebContents
// (the leader window reports its own split drag; main resolves the window from the sender).
function onApiWithEvent<F extends AnyFn>(
  channel: string,
  fn: (e: Electron.IpcMainEvent, ...args: Parameters<F>) => void,
): void {
  ipcMain.on(channel, (e, ...args) => fn(e, ...(args as Parameters<F>)));
}

export interface IpcDeps {
  repo: SongsRepo;
  biblesRepo: BiblesRepo;
  scheduleRepo: ScheduleRepo;
  settingsRepo: SettingsRepo;
  installer: BibleInstaller;
  messagesRepo: MessagesRepo;
  messagesScheduleRepo: MessagesScheduleRepo;
  messageInstaller: MessageInstaller;
  preserviceEngine: PreserviceEngine;
  mediaRepo: MediaRepo;
  mediaImport: MediaImport;
  songImport: SongImport;
  songSources: SongSources;
  updater: Updater;
}

export function registerIpc(deps: IpcDeps): void {
  const {
    repo,
    biblesRepo,
    scheduleRepo,
    settingsRepo,
    installer,
    messagesRepo,
    messagesScheduleRepo,
    messageInstaller,
    preserviceEngine,
    mediaRepo,
    mediaImport,
    songImport,
    songSources,
    updater,
  } = deps;
  handleApi<HelmApi['songs']['search']>(CH.songsSearch, (q, field) => repo.search(q, field));
  handleApi<HelmApi['songs']['list']>(CH.songsList, () => repo.list());
  handleApi<HelmApi['songs']['get']>(CH.songsGet, (id) => repo.get(id));
  handleApi<HelmApi['songs']['add']>(CH.songsAdd, (input) => repo.add(input));
  handleApi<HelmApi['songs']['update']>(CH.songsUpdate, (id, input) => repo.update(id, input));
  // Deleting a song forgets it as the live slide (#40) — keyed by item so any section goes.
  handleApi<HelmApi['songs']['remove']>(CH.songsRemove, (id) => { const r = repo.remove(id); presentation.invalidate(`song:${id}`); return r; });
  handleApi<HelmApi['presentation']['get']>(CH.presGet, () => presentation.get());
  onApi<HelmApi['presentation']['cue']>(CH.presCue, (key, slide) => presentation.cue(key, slide));
  onApi<HelmApi['presentation']['goLive']>(CH.presGoLive, (key, slide) => presentation.goLive(key, slide));
  onApi<HelmApi['presentation']['show']>(CH.presShow, (key, slide) => presentation.show(key, slide));
  onApi<HelmApi['presentation']['take']>(CH.presTake, (key, slide) => presentation.take(key, slide));
  onApi<HelmApi['presentation']['setOutput']>(CH.presSetOutput, (mode) => presentation.setOutput(mode));
  onApi<HelmApi['presentation']['invalidate']>(CH.presInvalidate, (key) => presentation.invalidate(key));
  handleApi<HelmApi['displays']['get']>(CH.displaysGet, () => displayStatus());
  onApi<HelmApi['displays']['openTest']>(CH.displaysOpenTest, () => openTestOutput());
  onApi<HelmApi['displays']['setRole']>(CH.displaysSetRole, (fp, role) => setDisplayRole(fp, role));
  onApi<HelmApi['displays']['setView']>(CH.displaysSetView, (fp, view) => setDisplayView(fp, view));
  onApiWithEvent<HelmApi['displays']['setLeaderSplit']>(CH.displaysSetLeaderSplit, (e, fp, px) =>
    fp === null ? setLeaderSplitFromSender(e.sender, px) : setLeaderSplitByFingerprint(fp, px));
  onApi<HelmApi['displays']['toggleReleased']>(CH.displaysToggleReleased, () => toggleOutputsReleased());
  handleApi<HelmApi['bibles']['manifest']>(CH.biblesManifest, () => installer.manifest());
  onApi<HelmApi['bibles']['install']>(CH.biblesInstall, (id) => installer.install(id));
  handleApi<HelmApi['bibles']['uninstall']>(CH.biblesUninstall, (id) => installer.uninstall(id));
  handleApi<HelmApi['bibles']['getChapter']>(CH.biblesGetChapter, (book, chapter) =>
    biblesRepo.getChapter(book, chapter),
  );
  handleApi<HelmApi['bibles']['bookExtent']>(CH.biblesBookExtent, (book) =>
    biblesRepo.bookExtentAnyVersion(book),
  );
  handleApi<HelmApi['bibles']['search']>(CH.biblesSearch, (q, versionId) =>
    biblesRepo.search(q, versionId),
  );
  handleApi<HelmApi['schedule']['list']>(CH.scheduleList, () => scheduleRepo.list());
  handleApi<HelmApi['schedule']['add']>(CH.scheduleAdd, (r) => scheduleRepo.add(r));
  handleApi<HelmApi['schedule']['remove']>(CH.scheduleRemove, (id) => scheduleRepo.remove(id));
  handleApi<HelmApi['schedule']['removeMany']>(CH.scheduleRemoveMany, (ids) => scheduleRepo.removeMany(ids));
  handleApi<HelmApi['settings']['get']>(CH.settingsGet, (key, fallback) =>
    settingsRepo.get(key, fallback),
  );
  onApi<HelmApi['settings']['set']>(CH.settingsSet, (key, value) => settingsRepo.set(key, value));

  handleApi<HelmApi['message']['search']>(CH.messageSearch, (q, scope) =>
    messagesRepo.search(q, scope),
  );
  handleApi<HelmApi['message']['list']>(CH.messageList, () => messagesRepo.list());
  handleApi<HelmApi['message']['get']>(CH.messageGet, (id) => messagesRepo.get(id));
  onApi<HelmApi['message']['installCorpus']>(CH.messageInstallCorpus, () => messageInstaller.installCorpus());
  handleApi<HelmApi['message']['importParse']>(CH.messageImportParse, (_kind, data) =>
    parseMessageText(data),
  );
  handleApi<HelmApi['message']['importSave']>(CH.messageImportSave, (r) => messagesRepo.addImported(r));
  onApi<HelmApi['message']['downloadAudio']>(CH.messageDownloadAudio, (id) => messageInstaller.downloadAudio(id));
  handleApi<HelmApi['message']['timing']>(CH.messageTiming, (id) => messagesRepo.timings(id));
  handleApi<HelmApi['quoteSchedule']['list']>(CH.quoteScheduleList, () => messagesScheduleRepo.list());
  handleApi<HelmApi['quoteSchedule']['add']>(CH.quoteScheduleAdd, (msgId, ord) =>
    messagesScheduleRepo.add(msgId, ord),
  );
  handleApi<HelmApi['quoteSchedule']['remove']>(CH.quoteScheduleRemove, (id) => messagesScheduleRepo.remove(id));
  handleApi<HelmApi['quoteSchedule']['removeMany']>(CH.quoteScheduleRemoveMany, (ids) =>
    messagesScheduleRepo.removeMany(ids),
  );

  handleApi<HelmApi['preservice']['getState']>(CH.preserviceGetState, () => preserviceEngine.getState());
  onApi<HelmApi['preservice']['engage']>(CH.preserviceEngage, () => preserviceEngine.engage());
  onApi<HelmApi['preservice']['disengage']>(CH.preserviceDisengage, () => preserviceEngine.disengage());
  onApi<HelmApi['preservice']['showCard']>(CH.preserviceShow, (idx) => preserviceEngine.showCard(idx));
  onApi<HelmApi['preservice']['takeCard']>(CH.preserviceTake, (idx) => preserviceEngine.takeCard(idx));
  onApi<HelmApi['preservice']['step']>(CH.preserviceStep, (dir) => preserviceEngine.step(dir));
  onApi<HelmApi['preservice']['showNow']>(CH.preserviceShowNow, () => preserviceEngine.showNow());
  onApi<HelmApi['preservice']['toggleLoop']>(CH.preserviceToggleLoop, () => preserviceEngine.toggleLoop());
  onApi<HelmApi['preservice']['setDwell']>(CH.preserviceSetDwell, (d) => preserviceEngine.setDwell(d));
  onApi<HelmApi['preservice']['toggleEnabled']>(CH.preserviceToggleEnabled, (id) => preserviceEngine.toggleEnabled(id));
  onApi<HelmApi['preservice']['saveCard']>(CH.preserviceSaveCard, (c) => preserviceEngine.saveCard(c));
  onApi<HelmApi['preservice']['removeCard']>(CH.preserviceRemoveCard, (id) => preserviceEngine.removeCard(id));
  onApi<HelmApi['preservice']['restoreCard']>(CH.preserviceRestoreCard, (card, index) =>
    preserviceEngine.restoreCard(card, index),
  );

  handleApi<HelmApi['media']['list']>(CH.mediaList, () => mediaRepo.list());
  handleApi<HelmApi['media']['importImages']>(CH.mediaImportImages, () => mediaImport.importImages());
  handleApi<HelmApi['media']['importVideo']>(CH.mediaImportVideo, () => mediaImport.importVideo());
  handleApi<HelmApi['media']['importDeck']>(CH.mediaImportDeck, () => mediaImport.importDeck());
  // Runs when the rail's undo window closes — the moment the slides actually cease to exist (#40).
  handleApi<HelmApi['media']['remove']>(CH.mediaRemove, (id) => { const r = mediaImport.removeMedia(id); presentation.invalidate(`pres:${id}`); return r; });

  handleApi<HelmApi['songImport']['sources']>(CH.songImportSources, () => songImport.sources());
  handleApi<HelmApi['songImport']['scan']>(CH.songImportScan, (sourceId) => songImport.scan(sourceId));
  handleApi<HelmApi['songImport']['commit']>(CH.songImportCommit, (token) => songImport.commit(token));

  handleApi<HelmApi['songSources']['search']>(CH.songSourcesSearch, (q) => songSources.search(q));
  handleApi<HelmApi['songSources']['fromUrl']>(CH.songSourcesFromUrl, (url) => songSources.fromUrl(url));

  handleApi<HelmApi['video']['get']>(CH.videoGetState, () => video.get());
  onApi<HelmApi['video']['load']>(CH.videoLoad, (key, src) => video.load(key, src));
  onApi<HelmApi['video']['play']>(CH.videoPlay, () => video.play());
  onApi<HelmApi['video']['pause']>(CH.videoPause, () => video.pause());
  onApi<HelmApi['video']['seek']>(CH.videoSeek, (ms) => video.seek(ms));
  onApi<HelmApi['video']['setVolume']>(CH.videoSetVolume, (v) => video.setVolume(v));
  onApi<HelmApi['video']['setMuted']>(CH.videoSetMuted, (m) => video.setMuted(m));
  onApi<HelmApi['video']['reportDuration']>(CH.videoReportDuration, (ms) => video.reportDuration(ms));

  handleApi<HelmApi['updates']['getStatus']>(CH.updatesGetStatus, () => updater.status());
  handleApi<HelmApi['updates']['check']>(CH.updatesCheck, () => updater.check());
  handleApi<HelmApi['updates']['install']>(CH.updatesInstall, () => updater.install());
  handleApi<HelmApi['app']['version']>(CH.appGetVersion, () => app.getVersion());
}
