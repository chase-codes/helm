import { BrowserWindow } from 'electron';
import type { PushPayloads } from '../shared/types';

/** The one all-windows fan-out (operator + outputs) every progress/state push channel
 * uses. Curried so a subsystem can hold `broadcastAll(CH.x)` as its callback; the
 * channel key ties the payload type to the channel at compile time. */
export const broadcastAll =
  <C extends keyof PushPayloads>(channel: C) =>
  (payload: PushPayloads[C]): void => {
    for (const w of BrowserWindow.getAllWindows())
      if (!w.isDestroyed()) w.webContents.send(channel, payload);
  };
