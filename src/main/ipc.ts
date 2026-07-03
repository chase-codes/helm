import { ipcMain } from 'electron';
import { CH, type NewSongInput, type OutputMode, type SearchField, type Slide } from '../shared/types';
import type { SongsRepo } from './songsRepo';
import { presentation } from './stateStore';
import { displayStatus, openTestOutput } from './displays';

export function registerIpc(repo: SongsRepo): void {
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
}
