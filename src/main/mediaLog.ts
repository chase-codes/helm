import { app, shell } from 'electron';
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The media diagnostics log: an append-only text file a user can send us when playback
// fails on a machine we cannot reach. One line per event, also echoed to the console so
// a CI probe capturing main's stdout sees the same thing. Dependency-free and never
// throws — a logger that can take the app down is worse than no logger.
//
//   <userData>/logs/media.log        (rotated once to media.log.1 at MAX_BYTES)
//   2026-10-05T14:03:22.123Z video.play {"key":"pres:a:0","playing":true,"positionMs":0}

const MAX_BYTES = 1024 * 1024;
const MAX_STRING = 500;

export type MediaLogLevel = 'info' | 'error';

/** One log line (no trailing newline): ISO time, event name, compact JSON data. Pure. */
export function formatLogLine(at: Date, event: string, data?: Record<string, unknown>): string {
  const head = `${at.toISOString()} ${event}`;
  if (!data) return head;
  let body: string;
  try {
    body = JSON.stringify(data, (_k, v: unknown) => {
      // JSON turns NaN/Infinity into null, which would hide exactly the bad duration or
      // position we want to see; long strings are clipped so one line stays one line.
      if (typeof v === 'number' && !Number.isFinite(v)) return String(v);
      if (typeof v === 'string' && v.length > MAX_STRING) return v.slice(0, MAX_STRING) + '…';
      if (v instanceof Error) return `${v.name}: ${v.message}`;
      return v;
    });
  } catch {
    body = '"[unserializable]"';
  }
  return `${head} ${body}`;
}

/** True when appending `incoming` bytes to a file of `size` bytes should rotate first. Pure. */
export function shouldRotate(size: number, incoming: number, max = MAX_BYTES): boolean {
  return size > 0 && size + incoming > max;
}

export function mediaLogPath(): string {
  return join(app.getPath('userData'), 'logs', 'media.log');
}

let size = -1; // bytes in the current file; -1 until the first write stats it
let started = false;

function write(line: string): void {
  try {
    const file = mediaLogPath();
    if (size < 0) {
      mkdirSync(join(file, '..'), { recursive: true });
      size = existsSync(file) ? statSync(file).size : 0;
    }
    const bytes = Buffer.byteLength(line) + 1;
    if (shouldRotate(size, bytes)) {
      renameSync(file, `${file}.1`); // replaces the previous .1 — two files, bounded
      size = 0;
    }
    appendFileSync(file, line + '\n');
    size += bytes;
  } catch {
    // Read-only profile, no `app` under test, disk full: the console copy still exists.
  }
}

/**
 * Append one event to the media log (and the console). Safe to call from anywhere in
 * main, at any time, with anything JSON-ish; never throws.
 */
export function mediaLog(event: string, data?: Record<string, unknown>, level: MediaLogLevel = 'info'): void {
  try {
    if (!started) {
      started = true;
      // Once per launch: the facts every Windows-only report turns on.
      mediaLog('session.start', {
        version: app.getVersion(), platform: process.platform, arch: process.arch,
        osRelease: process.getSystemVersion?.(), electron: process.versions.electron,
        chrome: process.versions.chrome, packaged: app.isPackaged
      });
    }
  } catch {
    // no `app` (unit tests) — carry on without the header
  }
  const line = formatLogLine(new Date(), event, data);
  if (level === 'error') console.error(`[media] ${line}`);
  else console.log(`[media] ${line}`);
  write(line);
}

/** Show media.log in Explorer/Finder so the operator can attach it to a report. */
export function revealMediaLog(): void {
  try {
    mediaLog('log.reveal');
    shell.showItemInFolder(mediaLogPath());
  } catch {
    // nothing useful to do
  }
}
