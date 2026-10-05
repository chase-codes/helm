import { describe, it, expect } from 'vitest';
import { videoErrorText, VIDEO_ERROR_TITLE } from './errorText';

describe('videoErrorText', () => {
  it('always uses the one fixed title', () => {
    expect(videoErrorText({ kind: 'error', code: 4 }).title).toBe(VIDEO_ERROR_TITLE);
    expect(videoErrorText({ kind: 'play-rejected' }).title).toBe("Can't play this video");
  });
  it('unsupported format/codec suggests re-exporting as H.264 MP4', () => {
    expect(videoErrorText({ kind: 'error', code: 4 }).reason).toMatch(/format or codec.*H\.264 MP4/);
    expect(videoErrorText({ kind: 'play-rejected', name: 'NotSupportedError' }).reason).toMatch(/H\.264 MP4/);
  });
  it('decode and network errors say so', () => {
    expect(videoErrorText({ kind: 'error', code: 3 }).reason).toMatch(/decoded/);
    expect(videoErrorText({ kind: 'error', code: 2 }).reason).toMatch(/couldn't be read/);
  });
  it('falls back to a plain reason for anything else', () => {
    expect(videoErrorText({ kind: 'play-rejected', name: 'NotAllowedError' }).reason).toMatch(/blocked/);
    expect(videoErrorText({ kind: 'error', code: 1 }).reason).toBe('Playback failed to start.');
  });
});
