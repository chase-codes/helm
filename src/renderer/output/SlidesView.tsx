import type { JSX } from 'react';
import type { OutputPayload } from '../../shared/types';
import { SlideCanvas } from '../shared/SlideCanvas';
import { ReadingCanvas } from '../shared/ReadingCanvas';
import { VideoCanvas } from '../shared/VideoCanvas';

export function SlidesView({ payload }: { payload: OutputPayload }): JSX.Element {
  return payload.slide.kind === 'reading' ? (
    <ReadingCanvas slide={payload.slide} fill />
  ) : payload.slide.kind === 'video' ? (
    <VideoCanvas slide={payload.slide} fill />
  ) : (
    <SlideCanvas slide={payload.slide} variant={payload.variant} fill />
  );
}
