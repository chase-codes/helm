import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CH } from '../shared/types';

// Minimal fake BrowserWindow: enough surface for displays.ts + stateStore.ts to run
// (constructor options, on/closed, webContents.send/on, isDestroyed/destroy, bounds/loadURL/loadFile
// no-ops) without a real Electron runtime.
vi.mock('electron', () => {
  const instances: FakeBrowserWindow[] = [];

  class FakeBrowserWindow {
    webContents = { send: vi.fn(), on: vi.fn() };
    private listeners = new Map<string, Array<() => void>>();
    private destroyed = false;

    constructor() {
      instances.push(this);
    }
    on(ev: string, cb: () => void): this {
      const arr = this.listeners.get(ev) ?? [];
      arr.push(cb);
      this.listeners.set(ev, arr);
      return this;
    }
    isDestroyed(): boolean {
      return this.destroyed;
    }
    destroy(): void {
      if (this.destroyed) return;
      this.destroyed = true;
      for (const cb of this.listeners.get('closed') ?? []) cb();
    }
    setBounds = vi.fn();
    setAlwaysOnTop = vi.fn();
    setSkipTaskbar = vi.fn();
    loadURL = vi.fn();
    loadFile = vi.fn();

    static getAllWindows(): FakeBrowserWindow[] {
      return instances.filter((w) => !w.isDestroyed());
    }
  }

  return {
    BrowserWindow: FakeBrowserWindow,
    screen: {
      getAllDisplays: vi.fn(() => []),
      getPrimaryDisplay: vi.fn(() => ({ id: 1 })),
      getDisplayMatching: vi.fn(() => ({ id: 1 })),
      on: vi.fn(),
    },
  };
});

// displays.ts pulls in `is` from @electron-toolkit/utils only to branch on dev-server URLs
// (loadOutput); its real implementation itself imports 'electron', which would otherwise
// bypass our mock above (node_modules deps aren't transformed/intercepted by vi.mock).
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }));

import { BrowserWindow } from 'electron';
import { displayStatus, openTestOutput, closeAllOutputs } from './displays';

type Instance = InstanceType<typeof BrowserWindow> & { webContents: { send: ReturnType<typeof vi.fn> } };

function newOperatorWindow(): Instance {
  return new BrowserWindow({}) as unknown as Instance;
}

describe('test output windows are visible to displayStatus (Finding 1)', () => {
  beforeEach(() => {
    closeAllOutputs();
  });

  it('counts zero outputs with no test output open', () => {
    expect(displayStatus().outputs).toBe(0);
  });

  it('opening a test output increments the output count and broadcasts status', () => {
    const operator = newOperatorWindow();

    openTestOutput();

    expect(displayStatus().outputs).toBe(1);
    expect(operator.webContents.send).toHaveBeenCalledWith(
      CH.displaysStatus,
      expect.objectContaining({ outputs: 1 }),
    );
  });

  it('closing a test output decrements the output count and broadcasts status', () => {
    const operator = newOperatorWindow();

    openTestOutput();
    operator.webContents.send.mockClear();

    // The most recently created live window is the test output just opened.
    const testWin = BrowserWindow.getAllWindows().at(-1) as unknown as Instance;
    testWin.destroy();

    expect(displayStatus().outputs).toBe(0);
    expect(operator.webContents.send).toHaveBeenCalledWith(
      CH.displaysStatus,
      expect.objectContaining({ outputs: 0 }),
    );
  });

  it('two test outputs then closing one leaves outputs at one', () => {
    const operator = newOperatorWindow();

    openTestOutput();
    openTestOutput();
    expect(displayStatus().outputs).toBe(2);

    const lastWin = BrowserWindow.getAllWindows().at(-1) as unknown as Instance;
    lastWin.destroy();

    expect(displayStatus().outputs).toBe(1);
    expect(operator.webContents.send).toHaveBeenLastCalledWith(
      CH.displaysStatus,
      expect.objectContaining({ outputs: 1 }),
    );
  });
});
