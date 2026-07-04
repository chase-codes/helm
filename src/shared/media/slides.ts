import type { MediaItem, Slide } from '../types';

export function keyForMedia(itemId: string, slideIdx: number): string {
  return `pres:${itemId}:${slideIdx}`;
}

export function mediaSrc(relPath: string): string {
  return `helm-media://${relPath}`;
}

export function buildImageSlide(src: string, label?: string): Slide {
  return label === undefined ? { kind: 'image', src } : { kind: 'image', src, label };
}

export function buildVideoPlaceholderSlide(title: string): Slide {
  return { kind: 'title', accent: '#6f9c7a', title: `▶ ${title}`, subtitle: 'Video plays in Slice 5b' };
}

export function slidesOf(item: MediaItem): Slide[] {
  if (item.type === 'deck') {
    return item.slides.map((relPath) => buildImageSlide(mediaSrc(relPath)));
  }
  if (item.type === 'image') {
    return [buildImageSlide(item.filePath ? mediaSrc(item.filePath) : '')];
  }
  return [buildVideoPlaceholderSlide(item.title)];
}
