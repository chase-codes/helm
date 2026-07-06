// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { expect, test, vi, beforeEach } from 'vitest';
import { VideoCanvas } from './VideoCanvas';
import type { VideoStateWire } from '../../shared/types';

const idle: VideoStateWire = { key: null, src: null, playing: false, positionMs: 0, durationMs: 0, volume: 1, muted: false };

beforeEach(() => {
  (window as unknown as { helm: unknown }).helm = {
    video: {
      get: vi.fn().mockResolvedValue(idle),
      onState: vi.fn().mockReturnValue(() => {})
    }
  };
});

test('renders a <video> with the slide src and subscribes to video state', () => {
  const { container } = render(
    <VideoCanvas slide={{ kind: 'video', src: 'helm-media://videos/clip.mp4' }} fill />
  );
  const video = container.querySelector('video');
  expect(video).not.toBeNull();
  expect(video?.getAttribute('src')).toBe('helm-media://videos/clip.mp4');
  const helm = (window as unknown as { helm: { video: { get: () => void; onState: () => void } } }).helm;
  expect(helm.video.get).toHaveBeenCalled();
  expect(helm.video.onState).toHaveBeenCalled();
});
