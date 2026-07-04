import { describe, it, expect } from 'vitest';
import { sameFlow } from '../presentation/core';
import type { MediaItem } from '../types';
import {
  keyForMedia,
  mediaSrc,
  buildImageSlide,
  buildVideoPlaceholderSlide,
  slidesOf
} from './slides';

describe('keyForMedia', () => {
  it('builds a pres:<id>:<idx> key', () => {
    expect(keyForMedia('abc', 0)).toBe('pres:abc:0');
    expect(keyForMedia('abc', 3)).toBe('pres:abc:3');
  });
});

describe('mediaSrc', () => {
  it('prefixes a relative path with the helm-media protocol', () => {
    expect(mediaSrc('foo/bar.png')).toBe('helm-media://foo/bar.png');
  });
});

describe('buildImageSlide', () => {
  it('builds an image slide with no label when omitted', () => {
    const slide = buildImageSlide('helm-media://x.png');
    expect(slide).toEqual({ kind: 'image', src: 'helm-media://x.png' });
    expect(slide).not.toHaveProperty('label');
  });

  it('builds an image slide including the label when provided', () => {
    const slide = buildImageSlide('helm-media://x.png', 'Slide 1');
    expect(slide).toEqual({ kind: 'image', src: 'helm-media://x.png', label: 'Slide 1' });
  });
});

describe('buildVideoPlaceholderSlide', () => {
  it('builds a title-kind placeholder slide', () => {
    expect(buildVideoPlaceholderSlide('Welcome Reel')).toEqual({
      kind: 'title',
      accent: '#6f9c7a',
      title: '▶ Welcome Reel',
      subtitle: 'Video plays in Slice 5b'
    });
  });
});

describe('sameFlow interop with keyForMedia', () => {
  it('treats stepping within the same media item as the same flow', () => {
    expect(sameFlow(keyForMedia('a', 0), keyForMedia('a', 1))).toBe(true);
  });

  it('treats switching to a different media item as a new flow', () => {
    expect(sameFlow(keyForMedia('a', 0), keyForMedia('b', 0))).toBe(false);
  });
});

describe('slidesOf', () => {
  it('returns one image slide per deck slide path', () => {
    const item: MediaItem = {
      id: 'd1',
      type: 'deck',
      title: 'My Deck',
      filePath: null,
      slides: ['deck/1.png', 'deck/2.png', 'deck/3.png'],
      createdAt: 0
    };
    const slides = slidesOf(item);
    expect(slides).toEqual([
      { kind: 'image', src: 'helm-media://deck/1.png' },
      { kind: 'image', src: 'helm-media://deck/2.png' },
      { kind: 'image', src: 'helm-media://deck/3.png' }
    ]);
  });

  it('returns a single image slide for an image item', () => {
    const item: MediaItem = {
      id: 'i1',
      type: 'image',
      title: 'My Image',
      filePath: 'images/pic.jpg',
      slides: [],
      createdAt: 0
    };
    expect(slidesOf(item)).toEqual([{ kind: 'image', src: 'helm-media://images/pic.jpg' }]);
  });

  it('returns a single video placeholder slide for a video item', () => {
    const item: MediaItem = {
      id: 'v1',
      type: 'video',
      title: 'Announcement Clip',
      filePath: 'videos/clip.mp4',
      slides: [],
      createdAt: 0
    };
    expect(slidesOf(item)).toEqual([
      { kind: 'title', accent: '#6f9c7a', title: '▶ Announcement Clip', subtitle: 'Video plays in Slice 5b' }
    ]);
  });

  it('returns a safe fallback slide for a deck with no slides', () => {
    const item: MediaItem = {
      id: 'd2',
      type: 'deck',
      title: 'Empty Deck',
      filePath: null,
      slides: [],
      createdAt: 0
    };
    const slides = slidesOf(item);
    expect(slides).toHaveLength(1);
    expect(slides[0]).toEqual({ kind: 'logo', title: 'HELM' });
    expect(slides[0].kind).toBeTruthy();
  });

  it('guards against a null filePath on image/video items rather than emitting helm-media://null', () => {
    const item: MediaItem = {
      id: 'i2',
      type: 'image',
      title: 'Broken',
      filePath: null,
      slides: [],
      createdAt: 0
    };
    const slides = slidesOf(item);
    expect(slides).toEqual([{ kind: 'image', src: '' }]);
  });
});
