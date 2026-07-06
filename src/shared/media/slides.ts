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

export function buildVideoSlide(src: string): Slide {
  return { kind: 'video', src };
}

export function slidesOf(item: MediaItem): Slide[] {
  if (item.type === 'deck') {
    if (item.slides.length === 0) return [{ kind: 'logo', title: 'HELM' }];
    return item.slides.map((relPath) => buildImageSlide(mediaSrc(relPath)));
  }
  if (item.type === 'image') {
    return [buildImageSlide(item.filePath ? mediaSrc(item.filePath) : '')];
  }
  return [buildVideoSlide(item.filePath ? mediaSrc(item.filePath) : '')];
}
