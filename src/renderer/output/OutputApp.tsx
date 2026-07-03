import React, { useEffect, useState } from 'react'
import type { OutputPayload } from '../../shared/types'
import { SlideCanvas } from '../shared/SlideCanvas'

export function OutputApp(): React.JSX.Element {
  const [payload, setPayload] = useState<OutputPayload>({ slide: { kind: 'black' }, variant: 'audience' })
  useEffect(() => window.helm.output.onSlide(setPayload), [])
  useEffect(() => {
    document.body.style.cursor = 'none'
    document.body.style.background = '#000'
  }, [])
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <SlideCanvas slide={payload.slide} variant={payload.variant} fill />
    </div>
  )
}
