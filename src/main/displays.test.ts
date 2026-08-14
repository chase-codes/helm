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

import { BrowserWindow, screen } from 'electron';
import {
  displayStatus,
  openTestOutput,
  closeAllOutputs,
  initDisplays,
  resyncDisplays,
  setDisplayRole,
  toggleOutputsReleased,
} from './displays';
import type { SettingsRepo } from './settingsRepo';

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

// Enough Electron.Display surface for snapshot(): id/label/size/scaleFactor/rotation/bounds/internal.
function disp(id: number, over: Record<string, unknown> = {}): Electron.Display {
  return {
    id,
    label: `EXT${id}`,
    size: { width: 1920, height: 1080 },
    scaleFactor: 1,
    rotation: 0,
    bounds: { x: 1920 * id, y: 0, width: 1920, height: 1080 },
    internal: false,
    ...over,
  } as unknown as Electron.Display;
}

// In-memory SettingsRepo; exposes the map so tests can assert persistence.
function memRepo(seed: Record<string, unknown> = {}): { repo: SettingsRepo; map: Map<string, unknown> } {
  const map = new Map(Object.entries(seed));
  const repo: SettingsRepo = {
    get: <T,>(key: string, fallback: T): T => (map.has(key) ? (map.get(key) as T) : fallback),
    set: (key, value) => void map.set(key, value),
  };
  return { repo, map };
}

describe('off role (#51)', () => {
  beforeEach(() => {
    closeAllOutputs();
    vi.mocked(screen.getAllDisplays).mockReturnValue([]);
  });

  // getOperator returns null → operatorDisplayId falls back to the mocked primary, id 1.
  it('creates no window for a display saved as off and reports its role', () => {
    vi.mocked(screen.getAllDisplays).mockReturnValue([disp(1), disp(2)]);
    initDisplays(() => null, memRepo({ 'displays:roles': { 'label:EXT2': 'off' } }).repo);
    expect(displayStatus().outputs).toBe(0);
    expect(displayStatus().displays.find((d) => d.id === 2)?.role).toBe('off');
  });

  it('setDisplayRole off destroys the window; back to audience recreates it', () => {
    vi.mocked(screen.getAllDisplays).mockReturnValue([disp(1), disp(2)]);
    const { repo, map } = memRepo();
    initDisplays(() => null, repo);
    expect(displayStatus().outputs).toBe(1);

    setDisplayRole('label:EXT2', 'off');
    expect(displayStatus().outputs).toBe(0);
    expect(map.get('displays:roles')).toEqual({ 'label:EXT2': 'off' });

    setDisplayRole('label:EXT2', 'audience');
    expect(displayStatus().outputs).toBe(1);
  });

  it('an off display stays off across a resync', () => {
    vi.mocked(screen.getAllDisplays).mockReturnValue([disp(1), disp(2)]);
    initDisplays(() => null, memRepo({ 'displays:roles': { 'label:EXT2': 'off' } }).repo);
    resyncDisplays();
    expect(displayStatus().outputs).toBe(0);
  });
});

describe('release / take (#51)', () => {
  beforeEach(() => {
    closeAllOutputs();
    vi.mocked(screen.getAllDisplays).mockReturnValue([disp(1), disp(2), disp(3)]);
    initDisplays(() => null, memRepo().repo);
  });

  it('release destroys every output and flags status; take restores them', () => {
    expect(displayStatus().outputs).toBe(2);
    expect(displayStatus().released).toBe(false);

    toggleOutputsReleased();
    expect(displayStatus().outputs).toBe(0);
    expect(displayStatus().released).toBe(true);

    toggleOutputsReleased();
    expect(displayStatus().outputs).toBe(2);
    expect(displayStatus().released).toBe(false);
  });

  it('a display plugged in while released is left alone until take', () => {
    toggleOutputsReleased();
    vi.mocked(screen.getAllDisplays).mockReturnValue([disp(1), disp(2), disp(3), disp(4)]);
    resyncDisplays(); // what the display-added handler runs
    expect(displayStatus().outputs).toBe(0);

    toggleOutputsReleased();
    expect(displayStatus().outputs).toBe(3);
  });

  it('released is transient: re-init starts un-released', () => {
    toggleOutputsReleased();
    expect(displayStatus().released).toBe(true);
    initDisplays(() => null, memRepo().repo); // relaunch equivalent
    expect(displayStatus().released).toBe(false);
    expect(displayStatus().outputs).toBe(2);
  });
});
