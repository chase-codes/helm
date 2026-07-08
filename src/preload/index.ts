import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { CH, type HelmApi } from '../shared/types';

const sub = <T>(channel: string) => (cb: (v: T) => void) => {
  const h = (_e: IpcRendererEvent, v: T): void => cb(v);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};
const api: HelmApi = {
  songs: {
    search: (q, field) => ipcRenderer.invoke(CH.songsSearch, q, field),
    list: () => ipcRenderer.invoke(CH.songsList),
    get: (id) => ipcRenderer.invoke(CH.songsGet, id),
    add: (input) => ipcRenderer.invoke(CH.songsAdd, input),
  },
  presentation: {
    get: () => ipcRenderer.invoke(CH.presGet),
    cue: (key, slide) => ipcRenderer.send(CH.presCue, key, slide),
    goLive: (key, slide) => ipcRenderer.send(CH.presGoLive, key, slide),
    setOutput: (mode) => ipcRenderer.send(CH.presSetOutput, mode),
    onState: sub(CH.presState),
  },
  output: { onSlide: sub(CH.outputSlide) },
  displays: {
    get: () => ipcRenderer.invoke(CH.displaysGet),
    onStatus: sub(CH.displaysStatus),
    openTest: () => ipcRenderer.send(CH.displaysOpenTest),
    setRole: (fp, role) => ipcRenderer.send(CH.displaysSetRole, fp, role),
  },
  bibles: {
    manifest: () => ipcRenderer.invoke(CH.biblesManifest),
    install: (id) => ipcRenderer.send(CH.biblesInstall, id),
    uninstall: (id) => ipcRenderer.invoke(CH.biblesUninstall, id),
    getChapter: (book, chapter) => ipcRenderer.invoke(CH.biblesGetChapter, book, chapter),
    bookExtent: (book) => ipcRenderer.invoke(CH.biblesBookExtent, book),
    onProgress: sub(CH.biblesProgress),
  },
  schedule: {
    list: () => ipcRenderer.invoke(CH.scheduleList),
    add: (r) => ipcRenderer.invoke(CH.scheduleAdd, r),
    remove: (id) => ipcRenderer.invoke(CH.scheduleRemove, id),
  },
  settings: {
    get: (key, fallback) => ipcRenderer.invoke(CH.settingsGet, key, fallback),
    set: (key, value) => ipcRenderer.send(CH.settingsSet, key, value),
  },
  message: {
    search: (q, scope) => ipcRenderer.invoke(CH.messageSearch, q, scope),
    list: () => ipcRenderer.invoke(CH.messageList),
    get: (id) => ipcRenderer.invoke(CH.messageGet, id),
    installCorpus: () => ipcRenderer.send(CH.messageInstallCorpus),
    importParse: (kind, data) => ipcRenderer.invoke(CH.messageImportParse, kind, data),
    importSave: (r) => ipcRenderer.invoke(CH.messageImportSave, r),
    downloadAudio: (id) => ipcRenderer.send(CH.messageDownloadAudio, id),
    timing: (id) => ipcRenderer.invoke(CH.messageTiming, id),
    onInstallProgress: sub(CH.messageInstallProgress),
    onAudioProgress: sub(CH.messageAudioProgress),
  },
  quoteSchedule: {
    list: () => ipcRenderer.invoke(CH.quoteScheduleList),
    add: (msgId, ord) => ipcRenderer.invoke(CH.quoteScheduleAdd, msgId, ord),
  },
  preservice: {
    getState: () => ipcRenderer.invoke(CH.preserviceGetState),
    onState: sub(CH.preserviceState),
    engage: () => ipcRenderer.send(CH.preserviceEngage),
    disengage: () => ipcRenderer.send(CH.preserviceDisengage),
    showCard: (idx) => ipcRenderer.send(CH.preserviceShow, idx),
    step: (dir) => ipcRenderer.send(CH.preserviceStep, dir),
    toggleLoop: () => ipcRenderer.send(CH.preserviceToggleLoop),
    setDwell: (delta) => ipcRenderer.send(CH.preserviceSetDwell, delta),
    toggleEnabled: (id) => ipcRenderer.send(CH.preserviceToggleEnabled, id),
    saveCard: (c) => ipcRenderer.send(CH.preserviceSaveCard, c),
    removeCard: (id) => ipcRenderer.send(CH.preserviceRemoveCard, id),
  },
  media: {
    list: () => ipcRenderer.invoke(CH.mediaList),
    importImages: () => ipcRenderer.invoke(CH.mediaImportImages),
    importVideo: () => ipcRenderer.invoke(CH.mediaImportVideo),
    importDeck: () => ipcRenderer.invoke(CH.mediaImportDeck),
    remove: (id) => ipcRenderer.invoke(CH.mediaRemove, id),
    onImportProgress: sub(CH.mediaImportProgress),
  },
  video: {
    get: () => ipcRenderer.invoke(CH.videoGetState),
    onState: sub(CH.videoState),
    load: (key, src) => ipcRenderer.send(CH.videoLoad, key, src),
    play: () => ipcRenderer.send(CH.videoPlay),
    pause: () => ipcRenderer.send(CH.videoPause),
    seek: (ms) => ipcRenderer.send(CH.videoSeek, ms),
    setVolume: (v) => ipcRenderer.send(CH.videoSetVolume, v),
    setMuted: (m) => ipcRenderer.send(CH.videoSetMuted, m),
    reportDuration: (ms) => ipcRenderer.send(CH.videoReportDuration, ms)
  },
};
contextBridge.exposeInMainWorld('helm', api);
