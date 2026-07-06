import { useContext, useEffect, useState, type CSSProperties, type JSX, type MouseEvent as ReactMouseEvent, type MutableRefObject } from 'react';
import { ThemeCtx } from './ThemeCtx';
import { usePresentationState, useVideoState } from './useHelm';
import { keyForMedia, slidesOf } from '../../shared/media/slides';
import type { MediaItem, Slide } from '../../shared/types';
import { type SermonTrack } from './SchedulePanel';
import { SermonCenter } from './SermonCenter';
import { SlideCanvas } from '../shared/SlideCanvas';
import { VideoCanvas } from '../shared/VideoCanvas';
import { TrackTabs } from './TrackTabs';

/**
 * Delegate this mode populates on `slidesKeyRef` while active — mirrors MessageMode's
 * MessageKeyHandler/MessageKeyRef (see that file's doc comment for why a private ref,
 * not SermonMode's shared `keyHandlerRef`, is the right shape here).
 */
export interface SlidesKeyHandler {
  onArrow: (dir: 1 | -1) => void;
  onGoLive: () => void;
}
export type SlidesKeyRef = MutableRefObject<SlidesKeyHandler | null>;

export interface SlidesTrackProps {
  slidesKeyRef: SlidesKeyRef;
  active: boolean;
  track: SermonTrack;
  setTrack: (t: SermonTrack) => void;
}

const RAIL_W = 270;
const RIGHT_PANEL_W = 330;

function iconFor(item: MediaItem): string {
  if (item.type === 'deck') return '▤';
  if (item.type === 'video') return '▶';
  return '▣';
}

function metaFor(item: MediaItem): string {
  if (item.type === 'deck') return `PowerPoint · ${item.slides.length} ${item.slides.length === 1 ? 'slide' : 'slides'}`;
  if (item.type === 'video') return 'Video clip';
  return 'Image';
}

function fmtClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/** Slides track: a media library (left rail), the cued slide as the center hero (shared
 * with Scripture/Message via SermonCenter's `variant="slide"`), and — for decks only —
 * a numbered slide rail on the right. Ported character-exact from Lectern.dc.html's
 * `trackIsPresentation` branches: library list L209-225 (`mediaRows` L962), deck rail
 * L324-337 (`deckSlideRows` L964). Owns its own TrackTabs (not SchedulePanel) for the
 * same reason MessageMode does — see MessageMode.tsx's doc comment on the double-rail
 * bug that splitting them would cause. */
export function SlidesTrack({ slidesKeyRef, active, track, setTrack }: SlidesTrackProps): JSX.Element {
  const T = useContext(ThemeCtx);
  const { output, liveKey } = usePresentationState();
  const vstate = useVideoState();
  const [posMs, setPosMs] = useState(0);
  const [durMs, setDurMs] = useState(0);

  const [items, setItems] = useState<MediaItem[]>([]);
  const [selId, setSelId] = useState('');
  const [slideIdx, setSlideIdx] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  // Deck-import calm-fallback surface (spec §9: never let an import failure throw
  // uncaught). 'no-libreoffice' is the structural `{ error }` result D1's importDeck
  // resolves with when soffice isn't found; 'failed' covers the promise REJECTING
  // mid-conversion (D1 flagged this can happen) — same modal, different copy.
  const [deckFallback, setDeckFallback] = useState<'no-libreoffice' | 'failed' | null>(null);

  // Initial load: the media library, picking the first item as current.
  useEffect(() => {
    let live = true;
    void window.helm.media
      .list()
      .then((l) => {
        if (!live) return;
        setItems(l);
        setSelId((cur) => cur || (l[0]?.id ?? ''));
      })
      .catch(console.error);
    return () => {
      live = false;
    };
  }, []);

  const selected = items.find((i) => i.id === selId) ?? null;
  const slides: Slide[] = selected ? slidesOf(selected) : [];
  const curIdx = Math.max(0, Math.min(slideIdx, slides.length - 1));
  const curSlide: Slide = slides[curIdx] ?? { kind: 'logo', title: 'HELM' };

  // Cue on every item/slide change (mirrors SermonMode's scripture cue effect and
  // MessageMode's quote cue effect) — recomputed from `items`/`selId`/`slideIdx` rather
  // than from the render-time `selected`/`slides`/`curIdx` above so the effect's own
  // dependency array stays primitive. Main's `applyCue` only hot-updates the live output
  // when the new key shares the current live key's flow (same item id for `pres:` keys;
  // see shared/presentation/core.ts's `sameFlow`) — so stepping within the SAME deck
  // while live hot-updates, and selecting a DIFFERENT item while live does not disturb
  // the output until Go Live is pressed again.
  useEffect(() => {
    const sel = items.find((i) => i.id === selId);
    if (!sel) return;
    const sl = slidesOf(sel);
    if (!sl.length) return;
    const idx = Math.max(0, Math.min(slideIdx, sl.length - 1));
    window.helm.presentation.cue(keyForMedia(sel.id, idx), sl[idx]);
  }, [items, selId, slideIdx]);

  // Video items are backed by the shared main-owned video state: arm the selected
  // clip so the operator hero previews it (muted) and Go Live can mirror it. Uses
  // slidesOf's src so the key/src match what SlideCanvas/VideoCanvas render.
  useEffect(() => {
    const sel = items.find((i) => i.id === selId);
    if (!sel || sel.type !== 'video') return;
    const vsl = slidesOf(sel)[0];
    window.helm.video.load(keyForMedia(sel.id, 0), vsl.src ?? '');
  }, [items, selId]);

  const curKey = selected ? keyForMedia(selected.id, curIdx) : '';
  const cuedIsLive = output === 'live' && liveKey === curKey;

  const selectItem = (item: MediaItem): void => {
    setSelId(item.id);
    setSlideIdx(0);
  };

  const stepSlide = (dir: 1 | -1): void => {
    if (!slides.length) return;
    setSlideIdx((i) => Math.max(0, Math.min(slides.length - 1, i + dir)));
  };

  const goLive = (): void => {
    if (!selected || !slides.length) return;
    window.helm.presentation.goLive(keyForMedia(selected.id, curIdx), slides[curIdx]);
  };

  const toggleLogo = (): void => {
    window.helm.presentation.setOutput(output === 'logo' ? 'live' : 'logo');
  };

  const refreshFrom = (l: MediaItem[]): void => {
    setItems(l);
    setSelId((cur) => cur || (l[0]?.id ?? ''));
  };

  const importImages = (): void => {
    setImportOpen(false);
    void window.helm.media.importImages().then(refreshFrom).catch(console.error);
  };
  const importVideo = (): void => {
    setImportOpen(false);
    void window.helm.media.importVideo().then(refreshFrom).catch(console.error);
  };
  // PowerPoint import: unlike Images/Video, importDeck's success value carries an
  // optional `error` (no-LibreOffice is a structural result, not a rejection) AND the
  // promise can still reject mid-conversion (D1 flagged this) — so both paths route to
  // the same calm fallback modal rather than letting either crash the UI (spec §9).
  // importDeck's resolved `{ items }` is indistinguishable between a real import and a
  // cancelled OS file picker (no IPC discriminator) — so a cancel still resolves with
  // the unchanged library. We diff the returned items against `prevItems` (captured from
  // this render's `items`, i.e. the library as it stood right before this click) by id;
  // only a genuinely new id (real import; repo orders newest-first via mediaRepo's
  // `ORDER BY created_at DESC`, so it's `res.items[0]`) reassigns selection. A cancel —
  // same ids, same order — leaves selId/slideIdx untouched, so it doesn't silently steal
  // the operator's current selection or re-fire the cue effect during a live service.
  const importDeck = (): void => {
    setImportOpen(false);
    const prevItems = items;
    void window.helm.media
      .importDeck()
      .then((res) => {
        if (res.error === 'no-libreoffice') {
          setDeckFallback('no-libreoffice');
          return;
        }
        const prevIds = new Set(prevItems.map((i) => i.id));
        const added = res.items.find((i) => !prevIds.has(i.id));
        setItems(res.items);
        if (added) {
          setSelId(added.id);
          setSlideIdx(0);
        }
      })
      .catch((err: unknown) => {
        console.error(err);
        setDeckFallback('failed');
      });
  };

  // Registers this mode's own key delegate only while active (mirrors MessageMode's
  // messageKeyRef-registration effect) — no deps array so it always captures the latest
  // stepSlide/goLive closures.
  useEffect(() => {
    if (!active) return;
    slidesKeyRef.current = { onArrow: stepSlide, onGoLive: goLive };
    return () => {
      slidesKeyRef.current = null;
    };
  });

  // On-deck: preview the next slide within the deck; end-of-deck (or single-slide
  // image/video items) past the last slide. Real deck slides are plain images (D1
  // rasterizes each PPTX slide to a PNG) rather than the design mock's richly-typed
  // title/point slides, so the preview text is positional rather than content-derived.
  let ondeckTag = '—';
  let ondeckTagColor = T.faint;
  let ondeckTitle = '';
  let ondeckPreview = '';
  if (selected) {
    const hasNext = curIdx + 1 < slides.length;
    if (hasNext) {
      ondeckTag = 'SLIDE';
      ondeckTagColor = T.sermon;
      ondeckTitle = selected.type === 'deck' ? `${selected.title} — Slide ${curIdx + 2}` : selected.title;
      ondeckPreview = selected.type === 'deck' ? `Slide ${curIdx + 2} of ${slides.length}` : 'Single item';
    } else {
      ondeckTitle = selected.type === 'deck' ? `End of ${selected.title}` : 'Single item';
      ondeckPreview = 'Pick another from the left';
    }
  }

  const rootStyle: CSSProperties = { flex: 1, minHeight: 0, display: 'flex', gap: '1px', background: T.hairline };
  const railStyle: CSSProperties = { width: `${RAIL_W}px`, flexShrink: 0, background: T.panel, display: 'flex', flexDirection: 'column', minHeight: 0 };
  const rowStyle = (isCurrent: boolean): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    width: '100%',
    padding: '8px 9px',
    borderRadius: '11px',
    cursor: 'pointer',
    background: isCurrent ? T.panel3 : 'transparent',
    boxShadow: isCurrent ? `inset 0 0 0 1px ${T.sermon}55` : 'none'
  });
  const thumbBoxStyle: CSSProperties = { width: '74px', aspectRatio: '16/9', borderRadius: '6px', overflow: 'hidden', position: 'relative', flexShrink: 0, boxShadow: `inset 0 0 0 1px ${T.border}` };
  const importBtnStyle: CSSProperties = {
    width: '100%',
    height: '42px',
    marginTop: '8px',
    borderRadius: '11px',
    boxShadow: `inset 0 0 0 1px ${T.border}`,
    border: 'none',
    color: T.dim,
    fontSize: '13.5px',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent'
  };
  const importPopStyle: CSSProperties = {
    position: 'absolute',
    bottom: '46px',
    left: 0,
    zIndex: 40,
    width: '180px',
    background: T.panel3,
    borderRadius: '12px',
    padding: '6px',
    boxShadow: `0 18px 50px rgba(0,0,0,.45), inset 0 0 0 1px ${T.border}`
  };
  const importRowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    padding: '9px 10px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '12.5px',
    fontWeight: 600,
    color: T.text,
    background: 'transparent'
  };

  const comingPanelStyle: CSSProperties = { width: `${RIGHT_PANEL_W}px`, flexShrink: 0, background: T.panel, display: 'flex', flexDirection: 'column', minHeight: 0 };
  const numStyle = (isCued: boolean): CSSProperties => ({
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: '11px',
    width: '16px',
    flexShrink: 0,
    textAlign: 'right',
    color: isCued ? T.sermon : T.faint,
    fontWeight: isCued ? 700 : 400
  });
  const thumbStyle = (isCued: boolean, isLive: boolean): CSSProperties => ({
    flex: 1,
    aspectRatio: '16/9',
    borderRadius: '8px',
    overflow: 'hidden',
    position: 'relative',
    boxShadow: isLive ? `0 0 0 2px ${T.sermon}, 0 6px 18px rgba(0,0,0,.25)` : isCued ? `0 0 0 2px ${T.sermon}66` : `inset 0 0 0 1px ${T.border}`
  });
  const deckRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: '9px', width: '100%', padding: '5px 6px', borderRadius: '9px', cursor: 'pointer', background: 'transparent' };
  const transportBtnStyle: CSSProperties = {
    height: '34px', padding: '0 14px', borderRadius: '9px', background: T.panel2,
    boxShadow: `inset 0 0 0 1px ${T.border}`, fontSize: '13px', fontWeight: 600, color: T.dim,
    display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap'
  };
  const transportTimeStyle: CSSProperties = {
    fontFamily: "'JetBrains Mono',monospace", fontSize: '12px', color: T.dim, fontVariantNumeric: 'tabular-nums'
  };

  // Calm fallback modal for deck import — overlay/card values copied character-exact
  // from PreCardEditor's shell (the smallest single-purpose modal in the app; see that
  // file's overlayStyle/modalStyle), not invented fresh.
  const stopDeckFallbackClick = (e: ReactMouseEvent): void => e.stopPropagation();
  const deckFallbackOverlayStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 50,
    background: 'rgba(8,9,12,.6)',
    backdropFilter: 'blur(3px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '5vh 4vw'
  };
  const deckFallbackModalStyle: CSSProperties = {
    width: '100%',
    maxWidth: '420px',
    background: T.panel,
    borderRadius: '16px',
    padding: '22px 24px',
    boxShadow: '0 30px 80px rgba(0,0,0,.5)'
  };
  const deckFallbackCloseBtnStyle: CSSProperties = {
    height: '38px',
    padding: '0 18px',
    borderRadius: '10px',
    background: T.panel2,
    boxShadow: `inset 0 0 0 1px ${T.border}`,
    fontSize: '13.5px',
    fontWeight: 600,
    color: T.dim
  };

  const heroMedia =
    selected && selected.type === 'video' ? (
      <VideoCanvas
        slide={curSlide}
        forceMuted
        fill
        onTime={setPosMs}
        onDuration={(ms) => { setDurMs(ms); window.helm.video.reportDuration(ms); }}
        onEnded={() => window.helm.video.pause()}
      />
    ) : undefined;

  return (
    <div style={rootStyle}>
      <div style={railStyle}>
        <div style={{ padding: '12px 12px 10px', flexShrink: 0 }}>
          <TrackTabs theme={T} track={track} setTrack={setTrack} />
        </div>
        <div style={{ fontSize: '10px', letterSpacing: '0.1em', color: T.faint, fontWeight: 600, padding: '0 14px 9px', flexShrink: 0 }}>PRESENTATIONS &amp; MEDIA</div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {items.map((item) => (
            <button key={item.id} style={rowStyle(item.id === selId)} onClick={() => selectItem(item)}>
              <div style={thumbBoxStyle}>
                <SlideCanvas slide={slidesOf(item)[0]} fill />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {iconFor(item)} {item.title}
                </div>
                <div style={{ fontSize: '11px', color: T.faint, marginTop: '1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{metaFor(item)}</div>
              </div>
              {item.id === selId && <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: T.live, flexShrink: 0 }} />}
            </button>
          ))}
          <div style={{ position: 'relative' }}>
            <button style={importBtnStyle} onClick={() => setImportOpen((o) => !o)}>
              + Import
            </button>
            {importOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 39 }} onClick={() => setImportOpen(false)} />
                <div style={importPopStyle}>
                  <button style={importRowStyle} onClick={importImages}>
                    Images
                  </button>
                  <button style={importRowStyle} onClick={importVideo}>
                    Video
                  </button>
                  <button style={importRowStyle} onClick={importDeck}>
                    PowerPoint
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <SermonCenter
        theme={T}
        variant="slide"
        accent={T.sermon}
        output={output}
        cuedIsLive={cuedIsLive}
        heroLabel=""
        slide={curSlide}
        heroMedia={heroMedia}
        ondeckTag={ondeckTag}
        ondeckTagColor={ondeckTagColor}
        ondeckTitle={ondeckTitle}
        ondeckPreview={ondeckPreview}
        nextLabel={'Next slide ›'}
        onPrev={() => stepSlide(-1)}
        onNext={() => stepSlide(1)}
        onGoLive={goLive}
        onToggleLogo={toggleLogo}
      />

      {selected && selected.type === 'deck' && (
        <div style={comingPanelStyle}>
          <div style={{ padding: '14px 15px 10px', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '11px', letterSpacing: '0.1em', color: T.faint, fontWeight: 600 }}>{selected.title}</div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: '10px', color: T.sermon }}>{slides.length} slides</div>
            </div>
            <div style={{ fontSize: '11.5px', color: T.faint, marginTop: '6px', lineHeight: 1.45 }}>
              Tap any slide to put it on screen — jump anywhere, not just next.
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 12px 14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {slides.map((sl, i) => {
              const isCued = i === curIdx;
              const isLive = output === 'live' && liveKey === keyForMedia(selected.id, i);
              return (
                <button key={i} style={deckRowStyle} onClick={() => setSlideIdx(i)}>
                  <div style={numStyle(isCued)}>{i + 1}</div>
                  <div style={thumbStyle(isCued, isLive)}>
                    <SlideCanvas slide={sl} fill />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {selected && selected.type === 'video' && (
        <div style={comingPanelStyle}>
          <div style={{ padding: '14px 15px 10px', flexShrink: 0 }}>
            <div style={{ fontSize: '11px', letterSpacing: '0.1em', color: T.faint, fontWeight: 600 }}>VIDEO</div>
            <div style={{ fontSize: '11.5px', color: T.faint, marginTop: '6px', lineHeight: 1.45 }}>
              Preview plays here muted; the audience hears it once it&rsquo;s live.
            </div>
          </div>
          <div style={{ padding: '0 15px 15px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button
                style={transportBtnStyle}
                onClick={() => (vstate.playing ? window.helm.video.pause() : window.helm.video.play())}
              >
                {vstate.playing ? '❙❙ Pause' : '▶ Play'}
              </button>
              <div style={transportTimeStyle}>
                {fmtClock(posMs)} / {fmtClock(durMs)}
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(1, durMs)}
              value={Math.min(posMs, durMs || 0)}
              onInput={(e) => setPosMs(Number((e.target as HTMLInputElement).value))}
              onChange={(e) => window.helm.video.seek(Number(e.target.value))}
              style={{ width: '100%' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button style={transportBtnStyle} onClick={() => window.helm.video.setMuted(!vstate.muted)}>
                {vstate.muted ? 'Muted' : 'Mute'}
              </button>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(vstate.volume * 100)}
                onChange={(e) => window.helm.video.setVolume(Number(e.target.value) / 100)}
                style={{ flex: 1 }}
              />
            </div>
          </div>
        </div>
      )}

      {deckFallback && (
        <div style={deckFallbackOverlayStyle} onClick={() => setDeckFallback(null)}>
          <div style={deckFallbackModalStyle} onClick={stopDeckFallbackClick}>
            <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '10px' }}>
              {deckFallback === 'no-libreoffice' ? 'PowerPoint import unavailable' : "Couldn't import PowerPoint"}
            </div>
            <div style={{ fontSize: '13px', color: T.dim, lineHeight: 1.5 }}>
              {deckFallback === 'no-libreoffice'
                ? 'Install LibreOffice to import PowerPoint decks, or export your slides as images and add them individually.'
                : "Couldn't convert that PowerPoint file."}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '18px' }}>
              <button style={deckFallbackCloseBtnStyle} onClick={() => setDeckFallback(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
