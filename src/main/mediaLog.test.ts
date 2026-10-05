import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const h = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({
  app: { getPath: () => h.userData, getVersion: () => '9.9.9', isPackaged: false },
  shell: {}
}));

import { formatLogLine, shouldRotate, mediaLog, mediaLogPath } from './mediaLog';

const AT = new Date('2026-10-05T14:03:22.123Z');

describe('formatLogLine', () => {
  it('is ISO time, event, compact JSON', () => {
    expect(formatLogLine(AT, 'video.play', { key: 'pres:a:0', playing: true, positionMs: 0 }))
      .toBe('2026-10-05T14:03:22.123Z video.play {"key":"pres:a:0","playing":true,"positionMs":0}');
  });
  it('omits the data column when there is none', () => {
    expect(formatLogLine(AT, 'session.start')).toBe('2026-10-05T14:03:22.123Z session.start');
  });
  it('keeps non-finite numbers visible instead of JSON null', () => {
    expect(formatLogLine(AT, 'video.reportDuration', { reportedMs: Infinity, n: NaN }))
      .toBe('2026-10-05T14:03:22.123Z video.reportDuration {"reportedMs":"Infinity","n":"NaN"}');
  });
  it('clips long strings and stays on one line', () => {
    const line = formatLogLine(AT, 'x', { message: 'a'.repeat(2000) + '\nsecond' });
    expect(line.length).toBeLessThan(600);
    expect(line).not.toContain('\n');
  });
  it('never throws on unserializable data', () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(formatLogLine(AT, 'x', loop)).toBe('2026-10-05T14:03:22.123Z x "[unserializable]"');
  });
});

describe('shouldRotate', () => {
  it('rotates only when the append would cross the cap', () => {
    expect(shouldRotate(900, 50, 1000)).toBe(false);
    expect(shouldRotate(990, 50, 1000)).toBe(true);
  });
  it('never rotates an empty file, however large the line', () => {
    expect(shouldRotate(0, 5000, 1000)).toBe(false);
  });
});

describe('mediaLog', () => {
  it('appends to <userData>/logs/media.log under a once-per-launch session header, and echoes to the console', () => {
    h.userData = mkdtempSync(join(tmpdir(), 'helm-medialog-'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    mediaLog('video.play', { key: 'pres:a:0', playing: true });
    mediaLog('video.report', { kind: 'error', code: 4 }, 'error');

    expect(mediaLogPath()).toBe(join(h.userData, 'logs', 'media.log'));
    const lines = readFileSync(mediaLogPath(), 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^\S+Z session\.start \{"version":"9\.9\.9","platform":/);
    expect(lines[1]).toMatch(/^\S+Z video\.play \{"key":"pres:a:0","playing":true\}$/);
    expect(lines[2]).toMatch(/ video\.report \{"kind":"error","code":4\}$/);
    expect(log).toHaveBeenCalledWith(`[media] ${lines[1]}`);
    expect(err).toHaveBeenCalledWith(`[media] ${lines[2]}`);
    log.mockRestore();
    err.mockRestore();
  });

  it('never throws when the log cannot be written', () => {
    h.userData = '/dev/null/not-a-dir';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(() => mediaLog('video.pause')).not.toThrow();
    log.mockRestore();
  });
});
