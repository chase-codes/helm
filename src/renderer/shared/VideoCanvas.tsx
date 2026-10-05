import { useEffect, useRef, type CSSProperties, type JSX } from 'react';
import type { Slide, VideoErrorReport, VideoStateWire } from '../../shared/types';

export interface VideoCanvasProps {
  slide: Slide;                       // must be kind:'video' with a src
  forceMuted?: boolean;               // operator hero passes true (monitors visually)
  onTime?: (ms: number) => void;      // timeupdate → operator time display
  onDuration?: (ms: number) => void;  // loadedmetadata → reported to main
  onEnded?: () => void;               // → operator sends pause() (hold last frame)
  fill?: boolean;
}

const DRIFT_MS = 250;
// How long an element may sit "wanted playing but not advancing" before we say so. Long
// enough that an ordinary buffer hiccup never reports.
const STUCK_MS = 3000;

export function VideoCanvas({
  slide, forceMuted = false, onTime, onDuration, onEnded, fill = false
}: VideoCanvasProps): JSX.Element {
  const ref = useRef<HTMLVideoElement>(null);
  const last = useRef<VideoStateWire | null>(null);
  const src = slide.src ?? '';
  const stuckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stalledFor = useRef<string | null>(null); // src we already reported `stalled` for

  // Tell main what this element is doing. Main logs every report and, for a fatal one
  // (element error / non-Abort play() rejection), pauses and broadcasts the error so the
  // operator is told — a failure here used to be swallowed without a trace.
  const report = (kind: VideoErrorReport['kind'], extra: Partial<VideoErrorReport> = {}): void => {
    const el = ref.current;
    if (!src) return;
    window.helm.video.reportError({
      src, kind, ...extra,
      readyState: el?.readyState ?? 0, networkState: el?.networkState ?? 0,
      currentTime: Math.round((el?.currentTime ?? 0) * 1000) / 1000
    });
  };

  const clearStuck = (): void => {
    if (stuckTimer.current) clearTimeout(stuckTimer.current);
    stuckTimer.current = null;
  };
  // Armed whenever we ask the element to play or it says it is waiting: if it is still
  // wanted-playing and has not moved STUCK_MS later, report `waiting`. This is the only
  // signal for a source that hangs — play() neither resolves nor rejects, no error fires.
  const armStuck = (): void => {
    if (stuckTimer.current) return;
    const from = ref.current?.currentTime ?? 0;
    stuckTimer.current = setTimeout(() => {
      stuckTimer.current = null;
      const el = ref.current;
      const s = last.current;
      if (!el || !s || !s.playing || s.src !== src) return;
      if (el.paused || el.readyState < 3 || el.currentTime === from) report('waiting');
    }, STUCK_MS);
  };

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
    if (s.playing && el.paused) {
      armStuck();
      void el.play().catch((err: unknown) => {
        const e = err as { name?: string; message?: string } | null;
        // AbortError is play() interrupted by our own pause()/load — benign, by design.
        if (e?.name === 'AbortError') return;
        clearStuck();
        report('play-rejected', { name: e?.name ?? 'Error', message: e?.message ?? String(err) });
      });
    }
    if (!s.playing) {
      clearStuck();
      if (!el.paused) el.pause();
    }
  };

  // Fetch-then-subscribe, same guard as useMainState: a pushed state is always at least
  // as fresh as the in-flight initial fetch, so once one arrives (or we unmount) the
  // fetch's result is stale and must not overwrite it.
  useEffect(() => {
    let gotPush = false;
    const off = window.helm.video.onState((s) => { gotPush = true; apply(s); });
    void window.helm.video.get().then((s) => { if (!gotPush) apply(s); });
    return () => { gotPush = true; off(); clearStuck(); };
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
        onEnded={() => { clearStuck(); report('ended'); onEnded?.(); }}
        onError={(e) => {
          const me = e.currentTarget.error;
          clearStuck();
          report('error', { code: me?.code, message: me?.message });
        }}
        onPlaying={() => { clearStuck(); report('playing'); }}
        onWaiting={armStuck}
        onStalled={() => {
          if (stalledFor.current === src) return; // once per src — stalls repeat on a slow disk
          stalledFor.current = src;
          report('stalled');
        }}
      />
    </div>
  );
}
