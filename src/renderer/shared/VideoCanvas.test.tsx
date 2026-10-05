// @vitest-environment jsdom
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { afterEach, expect, test, vi, beforeEach } from 'vitest';
import { VideoCanvas } from './VideoCanvas';
import type { VideoStateWire } from '../../shared/types';
import { settleAndClear } from '../../test/mocks';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

const SRC = 'helm-media://videos/clip.mp4';
const idle: VideoStateWire = { key: null, src: null, playing: false, positionMs: 0, durationMs: 0, volume: 1, muted: false };
const playing: VideoStateWire = { ...idle, key: 'pres:a:0', src: SRC, playing: true };
const paused: VideoStateWire = { ...playing, playing: false };

type Push = (s: VideoStateWire) => void;
let reportError: ReturnType<typeof vi.fn>;
let push: Push;

function installHelm(get: () => Promise<VideoStateWire>): void {
  reportError = vi.fn();
  push = () => { throw new Error('onState not subscribed yet'); };
  (window as unknown as { helm: unknown }).helm = {
    video: {
      get: vi.fn(get),
      onState: vi.fn((cb: Push) => { push = cb; return () => {}; }),
      reportError
    }
  };
}

// jsdom's play()/pause() are "not implemented" stubs; each test says what play() does.
function stubPlay(impl: () => Promise<void>): ReturnType<typeof vi.fn> {
  const play = vi.fn(impl);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play as unknown as () => Promise<void>);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  return play;
}
const domErr = (name: string, message: string): Error => Object.assign(new Error(message), { name });

const renderCanvas = (): HTMLVideoElement =>
  render(<VideoCanvas slide={{ kind: 'video', src: SRC }} fill />).container.querySelector('video') as HTMLVideoElement;

beforeEach(() => installHelm(() => Promise.resolve(idle)));

test('renders a <video> with the slide src and subscribes to video state', () => {
  const video = renderCanvas();
  expect(video).not.toBeNull();
  expect(video.getAttribute('src')).toBe(SRC);
  const helm = (window as unknown as { helm: { video: { get: () => void; onState: () => void } } }).helm;
  expect(helm.video.get).toHaveBeenCalled();
  expect(helm.video.onState).toHaveBeenCalled();
});

test('a play() rejection is reported to main, not swallowed', async () => {
  installHelm(() => Promise.resolve(playing));
  stubPlay(() => Promise.reject(domErr('NotSupportedError', 'The element has no supported sources.')));
  renderCanvas();
  await settleAndClear(reportError, expect.objectContaining({
    src: SRC, kind: 'play-rejected', name: 'NotSupportedError',
    message: 'The element has no supported sources.', readyState: 0, networkState: 0, currentTime: 0
  }));
});

test('an AbortError (play() interrupted by pause) is benign and not reported', async () => {
  installHelm(() => Promise.resolve(playing));
  const play = stubPlay(() => Promise.reject(domErr('AbortError', 'interrupted by a call to pause()')));
  renderCanvas();
  await act(async () => {});
  expect(play).toHaveBeenCalled();
  expect(reportError).not.toHaveBeenCalled();
});

test('an element error reports MediaError code and message', () => {
  const video = renderCanvas();
  Object.defineProperty(video, 'error', { configurable: true, get: () => ({ code: 4, message: 'DEMUXER_ERROR_COULD_NOT_OPEN' }) });
  fireEvent.error(video);
  expect(reportError).toHaveBeenCalledWith(expect.objectContaining({
    src: SRC, kind: 'error', code: 4, message: 'DEMUXER_ERROR_COULD_NOT_OPEN'
  }));
});

test('playing and ended are reported, so the log can tell an instant `ended` from a pause', () => {
  const onEnded = vi.fn();
  const video = render(<VideoCanvas slide={{ kind: 'video', src: SRC }} onEnded={onEnded} />)
    .container.querySelector('video') as HTMLVideoElement;
  fireEvent.playing(video);
  fireEvent.ended(video);
  expect(reportError.mock.calls.map((c) => (c[0] as { kind: string }).kind)).toEqual(['playing', 'ended']);
  expect(onEnded).toHaveBeenCalled();
});

test('stalled is reported once per src', () => {
  const video = renderCanvas();
  fireEvent.stalled(video);
  fireEvent.stalled(video);
  expect(reportError).toHaveBeenCalledTimes(1);
  expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ kind: 'stalled' }));
});

test('a play that never starts is reported as waiting after 3s; a brief buffer is not', async () => {
  vi.useFakeTimers();
  stubPlay(() => new Promise<void>(() => {})); // hangs: neither resolves nor rejects
  const video = renderCanvas();
  await act(async () => {});
  act(() => push(playing));
  act(() => { vi.advanceTimersByTime(2900); });
  expect(reportError).not.toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(200); });
  expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ src: SRC, kind: 'waiting' }));

  // A waiting that recovers (the element fires `playing`) inside the window stays quiet.
  reportError.mockClear();
  fireEvent.waiting(video);
  act(() => { vi.advanceTimersByTime(1000); });
  fireEvent.playing(video);
  reportError.mockClear();
  act(() => { vi.advanceTimersByTime(5000); });
  expect(reportError).not.toHaveBeenCalled();
});

test('a stale mount-time get() does not overwrite a fresher pushed state', async () => {
  let resolveGet: (s: VideoStateWire) => void = () => {};
  installHelm(() => new Promise<VideoStateWire>((r) => { resolveGet = r; }));
  const play = stubPlay(() => Promise.resolve());
  renderCanvas();
  act(() => push(paused));          // the push lands first…
  await act(async () => { resolveGet(playing); }); // …then the older fetch resolves
  expect(play).not.toHaveBeenCalled();
});
