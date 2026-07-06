import { useEffect, useRef, type CSSProperties, type JSX } from 'react';
import type { Slide, VideoStateWire } from '../../shared/types';

export interface VideoCanvasProps {
  slide: Slide;                       // must be kind:'video' with a src
  forceMuted?: boolean;               // operator hero passes true (monitors visually)
  onTime?: (ms: number) => void;      // timeupdate → operator time display
  onDuration?: (ms: number) => void;  // loadedmetadata → reported to main
  onEnded?: () => void;               // → operator sends pause() (hold last frame)
  fill?: boolean;
}

const DRIFT_MS = 250;

export function VideoCanvas({
  slide, forceMuted = false, onTime, onDuration, onEnded, fill = false
}: VideoCanvasProps): JSX.Element {
  const ref = useRef<HTMLVideoElement>(null);
  const last = useRef<VideoStateWire | null>(null);
  const src = slide.src ?? '';

  // Reconcile the element to a broadcast state — but only for the video WE show
  // (src gate). This is what lets a live clip keep playing untouched if the
  // operator cues a different video: single-active-video safety.
  const apply = (s: VideoStateWire): void => {
    last.current = s;
    const el = ref.current;
    if (!el || !src || s.src !== src) return;
    el.muted = forceMuted || s.muted;
    el.volume = forceMuted ? 0 : s.volume;
    const target = s.positionMs / 1000;
    const driftMs = Math.abs(el.currentTime - target) * 1000;
    if (s.playing ? driftMs > DRIFT_MS : driftMs > 1) el.currentTime = target;
    if (s.playing && el.paused) void el.play().catch(() => {});
    if (!s.playing && !el.paused) el.pause();
  };

  useEffect(() => {
    let live = true;
    void window.helm.video.get().then((s) => { if (live) apply(s); });
    const off = window.helm.video.onState(apply);
    return () => { live = false; off(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, forceMuted]);

  // Once metadata is ready, re-apply the latest state so a mid-play go-live seeks
  // correctly (setting currentTime before metadata loads is a no-op).
  const reapply = (): void => { if (last.current) apply(last.current); };

  const rootStyle: CSSProperties = fill
    ? { position: 'absolute', inset: 0, background: '#000' }
    : { position: 'relative', width: '100%', aspectRatio: '16 / 9', background: '#000', overflow: 'hidden' };

  return (
    <div style={rootStyle}>
      <video
        ref={ref}
        src={src}
        playsInline
        muted={forceMuted}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
        onLoadedMetadata={(e) => { onDuration?.(Math.round(e.currentTarget.duration * 1000)); reapply(); }}
        onTimeUpdate={(e) => onTime?.(Math.round(e.currentTarget.currentTime * 1000))}
        onEnded={() => onEnded?.()}
      />
    </div>
  );
}
