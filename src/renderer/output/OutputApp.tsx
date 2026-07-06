import React, { useEffect, useState } from 'react'
import type { OutputPayload } from '../../shared/types'
import { SlideCanvas } from '../shared/SlideCanvas'
import { ReadingCanvas } from '../shared/ReadingCanvas'
import { VideoCanvas } from '../shared/VideoCanvas'

export function OutputApp(): React.JSX.Element {
  const [payload, setPayload] = useState<OutputPayload>({ slide: { kind: 'black' }, variant: 'audience' })
  useEffect(() => window.helm.output.onSlide(setPayload), [])
  useEffect(() => {
    document.body.style.cursor = 'none'
    document.body.style.background = '#000'
  }, [])
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      {payload.slide.kind === 'reading' ? (
        <ReadingCanvas slide={payload.slide} fill />
      ) : payload.slide.kind === 'video' ? (
        <VideoCanvas slide={payload.slide} fill />
      ) : (
        <SlideCanvas slide={payload.slide} variant={payload.variant} fill />
      )}
    </div>
  )
}
