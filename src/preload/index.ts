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
  },
  bibles: {
    manifest: () => ipcRenderer.invoke(CH.biblesManifest),
    install: (id) => ipcRenderer.send(CH.biblesInstall, id),
    uninstall: (id) => ipcRenderer.invoke(CH.biblesUninstall, id),
    getChapter: (book, chapter) => ipcRenderer.invoke(CH.biblesGetChapter, book, chapter),
    onProgress: sub(CH.biblesProgress),
  },
  schedule: {
    list: () => ipcRenderer.invoke(CH.scheduleList),
    add: (r) => ipcRenderer.invoke(CH.scheduleAdd, r),
  },
  settings: {
    get: (key, fallback) => ipcRenderer.invoke(CH.settingsGet, key, fallback),
    set: (key, value) => ipcRenderer.send(CH.settingsSet, key, value),
  },
};
contextBridge.exposeInMainWorld('helm', api);
