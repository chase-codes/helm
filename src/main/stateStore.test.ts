import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CH } from '../shared/types';
import type { Slide } from '../shared/types';

// Minimal fake BrowserWindow: enough for stateStore's broadcast path (getAllWindows,
// webContents.send/on, isDestroyed) to run without a real Electron runtime. Same shape as
// displays.test.ts's, trimmed to what this file exercises.
vi.mock('electron', () => {
  const instances: FakeBrowserWindow[] = [];

  class FakeBrowserWindow {
    webContents = { send: vi.fn(), on: vi.fn() };
    private destroyed = false;

    constructor() {
      instances.push(this);
    }
    on(): this {
      return this;
    }
    isDestroyed(): boolean {
      return this.destroyed;
    }
    destroy(): void {
      this.destroyed = true;
    }

    static getAllWindows(): FakeBrowserWindow[] {
      return instances.filter((w) => !w.isDestroyed());
    }
  }

  return { BrowserWindow: FakeBrowserWindow };
});

import { BrowserWindow } from 'electron';
import { presentation } from './stateStore';

const slideA: Slide = { kind: 'title', label: 'A', title: 'A' };
const slideB: Slide = { kind: 'title', label: 'B', title: 'B' };

// The whole reason `takeLive` returns its input BY IDENTITY: every broadcast re-sends
// `outputSlide` to every output window, and a no-op double-click on the slide already live
// must not re-push an identical payload at an output window that may be playing video.
// Nothing else in the suite covers `take`'s skip — core.test.ts proves the identity return,
// but not that the store acts on it.
describe('stateStore.take', () => {
  let win: InstanceType<typeof BrowserWindow>;

  beforeEach(() => {
    win = new BrowserWindow();
    presentation.registerOutput(win, 'audience');
    presentation.setOutput('black');
    (win.webContents.send as ReturnType<typeof vi.fn>).mockClear();
  });

  it('broadcasts when the take actually changes what is live', () => {
    presentation.take('pres:a:0', slideA);
    expect(presentation.get()).toMatchObject({ output: 'live', liveKey: 'pres:a:0' });
    const channels = (win.webContents.send as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(channels).toContain(CH.presState);
    expect(channels).toContain(CH.outputSlide);
  });

  it('does not broadcast when that key is already live', () => {
    presentation.take('pres:a:0', slideA);
    const send = win.webContents.send as ReturnType<typeof vi.fn>;
    send.mockClear();

    presentation.take('pres:a:0', slideA);
    expect(send).not.toHaveBeenCalled();
    expect(presentation.get()).toMatchObject({ output: 'live', liveKey: 'pres:a:0' });
  });

  it('broadcasts again once the live key moves on', () => {
    presentation.take('pres:a:0', slideA);
    const send = win.webContents.send as ReturnType<typeof vi.fn>;
    send.mockClear();

    presentation.take('pres:b:0', slideB);
    expect(send).toHaveBeenCalled();
    expect(presentation.get().liveKey).toBe('pres:b:0');
  });

  // The skip is keyed on the whole state, not just the key: after a take-down the same key
  // is no longer LIVE, so re-taking it is a real change the outputs have to hear about.
  it('broadcasts when the same key is re-taken after a blackout', () => {
    presentation.take('pres:a:0', slideA);
    presentation.setOutput('black');
    const send = win.webContents.send as ReturnType<typeof vi.fn>;
    send.mockClear();

    presentation.take('pres:a:0', slideA);
    expect(send).toHaveBeenCalled();
    expect(presentation.get().output).toBe('live');
  });
});

// The show effect fires on every cursor move AND on activation/output flips with the
// cursor at rest — and `showLive` returns its input BY IDENTITY on every refusal (output
// not live, cross-kind). Without the same skip `take` has, each refused show still
// re-broadcasts byte-identical state to every output window (#188 review).
describe('stateStore.show', () => {
  let win: InstanceType<typeof BrowserWindow>;

  beforeEach(() => {
    win = new BrowserWindow();
    presentation.registerOutput(win, 'audience');
    presentation.setOutput('black');
    (win.webContents.send as ReturnType<typeof vi.fn>).mockClear();
  });

  it('does not broadcast when showLive refuses (output down)', () => {
    const send = win.webContents.send as ReturnType<typeof vi.fn>;
    send.mockClear();
    presentation.show('scr:Genesis:1:2', slideA);
    expect(send).not.toHaveBeenCalled();
  });

  it('broadcasts when live and the cursor moves within the kind', () => {
    presentation.take('scr:Genesis:1:1', slideA);
    const send = win.webContents.send as ReturnType<typeof vi.fn>;
    send.mockClear();
    presentation.show('scr:Genesis:1:2', slideB);
    expect(send.mock.calls.map((c) => c[0])).toContain(CH.outputSlide);
    expect(presentation.get().liveKey).toBe('scr:Genesis:1:2');
  });
});

describe('stateStore.invalidate (#40)', () => {
  let win: InstanceType<typeof BrowserWindow>;

  beforeEach(() => {
    win = new BrowserWindow();
    presentation.registerOutput(win, 'audience');
    presentation.setOutput('black');
    (win.webContents.send as ReturnType<typeof vi.fn>).mockClear();
  });

  it('blacks the outputs and forgets the live pair when the deleted item is on screen', () => {
    presentation.take('pres:a:1', slideA);
    const send = win.webContents.send as ReturnType<typeof vi.fn>;
    send.mockClear();

    presentation.invalidate('pres:a');
    expect(send.mock.calls.map((c) => c[0])).toContain(CH.outputSlide);
    expect(presentation.get()).toMatchObject({ output: 'black', liveKey: null, liveSnap: null });
  });

  it('does not broadcast when the deleted item is not the live one', () => {
    presentation.take('pres:a:0', slideA);
    const send = win.webContents.send as ReturnType<typeof vi.fn>;
    send.mockClear();

    presentation.invalidate('pres:b');
    expect(send).not.toHaveBeenCalled();
    expect(presentation.get().liveKey).toBe('pres:a:0');
  });
});
