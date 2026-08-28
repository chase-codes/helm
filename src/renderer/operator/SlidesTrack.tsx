import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type MutableRefObject
} from 'react';
import { ThemeCtx } from './ThemeCtx';
import { ModalShell } from './ModalShell';
import { usePresentationState, useVideoState } from '../shared/useHelm';
import { keyForMedia, slidesOf } from '../../shared/media/slides';
import { sameFlow } from '../../shared/presentation/core';
import type { MediaItem, MediaImportResult, Slide } from '../../shared/types';
import { PanelDivider } from './PanelDivider';
import { type SermonTrack } from './SchedulePanel';
import { SermonCenter } from './SermonCenter';
import { SlideCanvas } from '../shared/SlideCanvas';
import { VideoCanvas } from '../shared/VideoCanvas';
import { TrackTabs } from './TrackTabs';
import { useContextMenu } from './useContextMenu';
import { filterPending, useDeferredRemove } from './useDeferredRemove';
import { deleteMenuItems, useListSelection } from './useListSelection';
import { UndoToast } from './UndoToast';
import { ListEmpty } from './ListEmpty';
import { pickNeighborId } from './pickNeighbor';
import type { PanelWidthControl } from './usePanelWidth';

/**
 * Delegate this mode populates on `slidesKeyRef` while active — mirrors MessageMode's
 * MessageKeyHandler/MessageKeyRef (see that file's doc comment for why a private ref,
 * not SermonMode's shared `keyHandlerRef`, is the right shape here).
 */
export interface SlidesKeyHandler {
  onArrow: (dir: 1 | -1) => void;
  onGoLive: () => void;
  /** Escape rung for this track's own overlays (deck-fallback modal, import popover) —
   * SermonMode's ladder consults this FIRST so Escape closes an overlay rather than
   * blacking the screen. Returns true if it consumed the press. */
  onEscape: () => boolean;
  /** True while the deck-fallback modal is up — a blocking modal, so SermonMode reports
   * it and App suppresses Enter/Delete behind it (same contract as SongsMode's QuickAdd). */
  isModalOpen: () => boolean;
  /** Delete/Backspace: remove the library selection, if any (#90). The media library is a
   * schedule-shaped list like the scripture rail, so it answers the same key. */
  onDelete: () => void;
}
export type SlidesKeyRef = MutableRefObject<SlidesKeyHandler | null>;

export interface SlidesTrackProps {
  slidesKeyRef: SlidesKeyRef;
  active: boolean;
  track: SermonTrack;
  setTrack: (t: SermonTrack) => void;
  // Shared with the Scripture and Message tracks — SermonMode owns a single pair for the
  // whole sermon page (Task 4), so the left/right rails stay the same width switching
  // tracks rather than each track remembering (or resetting) its own.
  leftPanel: PanelWidthControl;
  rightPanel: PanelWidthControl;
}

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
export function SlidesTrack({ slidesKeyRef, active, track, setTrack, leftPanel, rightPanel }: SlidesTrackProps): JSX.Element {
  const T = useContext(ThemeCtx);
  const { output, liveKey } = usePresentationState();
  const vstate = useVideoState();
  const [posMs, setPosMs] = useState(0);
  const [durMs, setDurMs] = useState(0);

  const [items, setItems] = useState<MediaItem[]>([]);
  const [selId, setSelId] = useState('');
  const [slideIdx, setSlideIdx] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [justImported, setJustImported] = useState(false);
  // Deck-import calm-fallback surface (spec §9: never let an import failure throw
  // uncaught). 'no-libreoffice' is the structural `{ error }` result D1's importDeck
  // resolves with when soffice isn't found; 'failed' covers the promise REJECTING
  // mid-conversion (D1 flagged this can happen) — same modal, different copy.
  const [deckFallback, setDeckFallback] = useState<'no-libreoffice' | 'failed' | null>(null);
  // Spinner shown while a deck import (conversion + rasterization) is in flight — a
  // multi-second PPTX/PDF import otherwise gives no feedback and looks hung.
  const [importing, setImporting] = useState<null | { label: string }>(null);

  const contextMenu = useContextMenu();
  // Two independent notions of "picked", exactly as the scripture rail has: `selId` is the
  // CUED item driving the hero, `sel` is the delete-selection a shift-click builds. They
  // usually agree (a plain click sets both) and deliberately diverge on a shift-click,
  // which extends the range without moving the cue off the slide on screen.
  const sel = useListSelection(items.map((i) => i.id));
  // Deferred commit — the row leaves the rail now, the file is deleted when the undo
  // window closes, and undo re-reads the library so the order is exactly as it was (#86).
  const undo = useDeferredRemove<MediaItem>({
    commit: (batch) => {
      for (const item of batch) void window.helm.media.remove(item.id).catch(console.error);
    },
    restore: () => {
      // Re-fetch rather than splice the batch back in: the library's order is main's to
      // know, and re-reading it is what makes the restore exact.
      void window.helm.media
        .list()
        .then((l) => {
          setItems(l);
          const back = displacedCueRef.current;
          displacedCueRef.current = null;
          if (back) {
            setSelId(back);
            setSlideIdx(0);
          }
        })
        .catch(console.error);
    }
  });

  // The cued id the pending removal displaced, or null if the cue was untouched by it.
  // Undo moves the hero back only when the delete is what moved it — deleting some other
  // row and undoing must not yank the operator off the slide they are looking at.
  const displacedCueRef = useRef<string | null>(null);

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
  //
  // `active && track === 'slides'` gates this to the track actually being the surface the
  // operator is driving — this component stays mounted while hidden (SermonMode's track
  // keep-alive, mirroring the mode-level contract), so without the gate the initial media
  // load would cue a slide from a background track. Both are deps, so re-revealing the
  // track re-cues the slide it was left on, restoring main's cued state after another
  // surface cued something else.
  useEffect(() => {
    if (!active || track !== 'slides') return;
    const sel = items.find((i) => i.id === selId);
    if (!sel) return;
    const sl = slidesOf(sel);
    if (!sl.length) return;
    const idx = Math.max(0, Math.min(slideIdx, sl.length - 1));
    window.helm.presentation.cue(keyForMedia(sel.id, idx), sl[idx]);
  }, [items, selId, slideIdx, active, track]);

  // Video items are backed by the shared main-owned video state: arm the selected
  // clip so the operator hero previews it (muted) and Go Live can mirror it. Uses
  // slidesOf's src so the key/src match what SlideCanvas/VideoCanvas render. Gated
  // like the cue effect above; the re-fire on reveal is safe because main's loadVideo
  // is idempotent on the already-loaded key (position/playing state kept).
  useEffect(() => {
    if (!active || track !== 'slides') return;
    const sel = items.find((i) => i.id === selId);
    if (!sel || sel.type !== 'video') return;
    const vsl = slidesOf(sel)[0];
    window.helm.video.load(keyForMedia(sel.id, 0), vsl.src ?? '');
  }, [items, selId, active, track]);

  // Progress broadcast from main (Task 2's media:importProgress) — updates the spinner
  // label with page counts while a deck import converts/rasterizes.
  useEffect(() => {
    const off = window.helm.media.onImportProgress((p) => {
      setImporting({
        label: p.phase === 'converting'
          ? 'Converting…'
          : `Rasterizing ${p.page ?? 0}/${p.pageCount ?? 0}…`
      });
    });
    return off;
  }, []);

  // Brief post-import confirmation; clears itself after 2.2s.
  useEffect(() => {
    if (!justImported) return;
    const t = setTimeout(() => setJustImported(false), 2200);
    return () => clearTimeout(t);
  }, [justImported]);

  const curKey = selected ? keyForMedia(selected.id, curIdx) : '';
  // `sameFlow`, not key equality: within the live deck the cue effect hot-updates the
  // screen (main's `applyCue` follows same-flow keys), so stepping slides leaves the verb
  // nothing to do — not one broadcast round-trip later. Key equality here made the button
  // flash green for the gap between the cue send and the liveKey broadcast returning.
  const cuedIsLive = output === 'live' && sameFlow(liveKey, curKey);

  const selectItem = (item: MediaItem): void => {
    setSelId(item.id);
    setSlideIdx(0);
  };

  // One remove path for a row's context menu, a shift-click range, and the Delete key
  // alike — the rows leave the rail immediately and the files go when the undo window
  // closes (see `undo` above; the expiry/supersede/unmount commit paths live in
  // useDeferredRemove now, which is where the scripture rail reads them from too).
  const removeItems = (ids: string[]): void => {
    const batch = items.filter((i) => ids.includes(i.id));
    if (!batch.length) return;
    const cueDisplaced = ids.includes(selId);
    displacedCueRef.current = cueDisplaced ? selId : null;
    const neighborId = pickNeighborId(items, ids);
    setItems((l) => l.filter((i) => !ids.includes(i.id)));
    if (cueDisplaced) {
      setSelId(neighborId);
      setSlideIdx(0);
    }
    sel.clear();
    undo.remove(batch);
  };

  const stepSlide = (dir: 1 | -1): void => {
    if (!slides.length) return;
    setSlideIdx((i) => Math.max(0, Math.min(slides.length - 1, i + dir)));
  };

  const goLive = (): void => {
    // Same stop SermonMode/SongsMode make (#85): when the cued slide is already on screen
    // the verb has nothing to do. Without this, Enter — the button's keyboard twin, which
    // ignores the disabled state — would reach main's goLive on the live key and take the
    // screen down.
    if (!selected || !slides.length || cuedIsLive) return;
    const key = keyForMedia(selected.id, curIdx);
    // Scope decision: Go Live on a video lands it PAUSED, never auto-playing audio —
    // the operator presses Play once it's on-air. This also preserves any position the
    // operator scrubbed to while previewing. A takedown (already live) and non-video
    // items are unaffected.
    if (selected.type === 'video' && !cuedIsLive) {
      if (vstate.key !== key) window.helm.video.load(key, curSlide.src ?? '');
      window.helm.video.pause(); // idempotent if already paused; re-anchors to the current position
    }
    window.helm.presentation.goLive(key, slides[curIdx]);
  };

  // Double-click a library row or a deck slide (#58). Idempotent, so a double-click on the
  // slide already showing is a no-op — which also means `takeLive` returns the state
  // unchanged and the store skips the broadcast, so a playing video is never re-pushed.
  //
  // Mirrors goLive's video rule: a video lands PAUSED, never auto-playing audio into the
  // room. Skipped when this key is already live, exactly as goLive skips it for a takedown.
  const takeSlideLive = (item: MediaItem, idx: number): void => {
    const itemSlides = slidesOf(item);
    const sl = itemSlides[idx];
    if (!sl) return;
    const key = keyForMedia(item.id, idx);
    const alreadyLive = output === 'live' && liveKey === key;
    if (item.type === 'video' && !alreadyLive) {
      if (vstate.key !== key) window.helm.video.load(key, sl.src ?? '');
      window.helm.video.pause();
    }
    window.helm.presentation.take(key, sl);
  };

  const takeDown = (): void => {
    window.helm.presentation.setOutput('black');
  };

  // Unified post-import handling for every media type: a canceled picker leaves selection
  // untouched; otherwise select the newly-added item (diff against the ids captured before
  // the import), scroll it into view, and flash "Imported ✓". Replaces the old per-type
  // refreshFrom (which left a non-empty library stuck on its prior selection) and the
  // fragile id-diff cancel heuristic (main now returns an explicit `canceled` flag).
  const applyImport = (res: MediaImportResult, prevIds: Set<string>): void => {
    if (res.canceled) return;
    const added = res.items.find((i) => !prevIds.has(i.id));
    // An import reply carries the whole library, which during an undo window still holds
    // the items the operator just deleted — see `filterPending`.
    setItems(filterPending(undo, res.items));
    if (added) {
      setSelId(added.id);
      setSlideIdx(0);
      setJustImported(true);
      requestAnimationFrame(() => {
        document.querySelector(`[data-media-id="${added.id}"]`)?.scrollIntoView?.({ block: 'nearest' });
      });
    }
  };

  const runImport = (
    call: () => Promise<MediaImportResult>,
    onError?: (err: unknown) => void
  ): void => {
    setImportOpen(false);
    const prevIds = new Set(items.map((i) => i.id));
    void call()
      .then((res) => {
        setImporting(null);
        if (res.error === 'no-libreoffice') { setDeckFallback('no-libreoffice'); return; }
        applyImport(res, prevIds);
      })
      .catch((err: unknown) => { setImporting(null); console.error(err); onError?.(err); });
  };

  const importImages = (): void => runImport(() => window.helm.media.importImages());
  const importVideo = (): void => runImport(() => window.helm.media.importVideo());
  const importDeck = (): void => {
    setImporting({ label: 'Importing…' });
    runImport(
      () => window.helm.media.importDeck(),
      () => setDeckFallback('failed')
    );
  };

  // Escape backs out this track's own overlays, modal before popover (only one can be
  // open from the UI today, but the blocking modal wins if both somehow are).
  const escapeOverlays = (): boolean => {
    if (deckFallback) {
      setDeckFallback(null);
      return true;
    }
    if (importOpen) {
      setImportOpen(false);
      return true;
    }
    return false;
  };

  // Registers this mode's own key delegate only while active (mirrors MessageMode's
  // messageKeyRef-registration effect) — no deps array so it always captures the latest
  // stepSlide/goLive closures. LAYOUT effect: SermonMode's isModalOpen delegates straight
  // through to this handle, so a passive registration would leave the whole chain a commit
  // behind and Escape would answer for an overlay that is already gone (see SongsMode.tsx).
  useLayoutEffect(() => {
    if (!active) return;
    slidesKeyRef.current = {
      onArrow: stepSlide,
      onGoLive: goLive,
      onEscape: escapeOverlays,
      isModalOpen: () => deckFallback !== null,
      onDelete: () => {
        if (sel.selectedIds.length > 0) removeItems(sel.selectedIds);
      }
    };
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
  const railStyle: CSSProperties = { width: `${leftPanel.width}px`, flexShrink: 0, background: T.panel, display: 'flex', flexDirection: 'column', minHeight: 0 };
  // Same two-state treatment the scripture rail uses: the delete-selection ring wins over
  // the cued tint, so a shift-click range reads as one block even where it crosses the
  // cued row.
  const rowStyle = (isCurrent: boolean, isSelected: boolean): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    width: '100%',
    padding: '8px 9px',
    borderRadius: '11px',
    cursor: 'pointer',
    background: isCurrent ? T.panel3 : isSelected ? T.panel2 : 'transparent',
    boxShadow: isSelected
      ? `inset 0 0 0 1.5px ${T.accent}`
      : isCurrent
        ? `inset 0 0 0 1px ${T.sermon}55`
        : 'none',
    userSelect: 'none'
  });
  const thumbBoxStyle: CSSProperties = { width: '74px', aspectRatio: '16/9', borderRadius: '6px', overflow: 'hidden', position: 'relative', flexShrink: 0, boxShadow: `inset 0 0 0 1px ${T.border}` };
  const importHeaderBtnStyle: CSSProperties = {
    height: '26px',
    padding: '0 10px',
    borderRadius: '8px',
    boxShadow: `inset 0 0 0 1px ${T.border}`,
    border: 'none',
    color: T.dim,
    fontSize: '12px',
    fontWeight: 600,
    background: 'transparent',
    // The verb must survive the rail's 200px minimum in one piece — the heading beside it
    // may wrap, the button may not ("+" over "Import" reads as two controls).
    whiteSpace: 'nowrap',
    flexShrink: 0
  };
  const importPopStyle: CSSProperties = {
    position: 'absolute',
    top: '30px',   // opens DOWNWARD from the header button (was bottom: 46px)
    right: 0,
    zIndex: 40,
    width: '180px',
    background: T.panel3,
    borderRadius: '12px',
    padding: '6px',
    boxShadow: T.floatShadow
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
  const importingRowStyle: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '8px',
    margin: '4px 2px', padding: '10px 12px', borderRadius: '10px',
    background: T.panel3, color: T.dim, fontSize: '12.5px', fontWeight: 600
  };
  const comingPanelStyle: CSSProperties = { width: `${rightPanel.width}px`, flexShrink: 0, background: T.panel, display: 'flex', flexDirection: 'column', minHeight: 0 };
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
  const deckRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: '9px', width: '100%', padding: '5px 6px', borderRadius: '9px', cursor: 'pointer', background: 'transparent', userSelect: 'none' };
  const transportBtnStyle: CSSProperties = {
    height: '34px', padding: '0 14px', borderRadius: '9px', background: T.panel2,
    boxShadow: `inset 0 0 0 1px ${T.border}`, fontSize: '13px', fontWeight: 600, color: T.dim,
    display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap'
  };
  const transportTimeStyle: CSSProperties = {
    fontFamily: "'JetBrains Mono',monospace", fontSize: '12px', color: T.dim, fontVariantNumeric: 'tabular-nums'
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

  // The right-hand panel (deck slide rail / video transport) only renders for those two
  // media types — gate its divider the same way so there's nothing to divide otherwise
  // (e.g. a plain image, which has no right panel at all).
  const hasRightPanel = selected != null && (selected.type === 'deck' || selected.type === 'video');

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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px 9px', flexShrink: 0 }}>
          <div
            // One line that gives way to the button: at the rail's 200px minimum the
            // heading truncates rather than wrapping into a two-line cram beside +Import.
            style={{ fontSize: '10px', letterSpacing: '0.1em', color: T.faint, fontWeight: 600, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            title="Presentations & media"
          >
            PRESENTATIONS &amp; MEDIA {justImported && <span style={{ color: T.live, letterSpacing: 0 }}>· Imported ✓</span>}
          </div>
          <div style={{ position: 'relative' }}>
            <button style={importHeaderBtnStyle} onClick={() => setImportOpen((o) => !o)}>
              + Import
            </button>
            {importOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 39 }} onClick={() => setImportOpen(false)} />
                <div style={importPopStyle}>
                  <button style={importRowStyle} onClick={importImages}>Images</button>
                  <button style={importRowStyle} onClick={importVideo}>Video</button>
                  <button style={importRowStyle} onClick={importDeck}>Slides / PDF</button>
                </div>
              </>
            )}
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {importing && (
            <div style={importingRowStyle}>
              <span style={{ opacity: 0.8 }}>⏳</span> {importing.label}
            </div>
          )}
          {items.length === 0 && (
            <ListEmpty>
              No media yet — import slides, images, or video with <b>+ Import</b> to get started.
            </ListEmpty>
          )}
          {items.map((item) => (
            <button
              key={item.id}
              data-media-id={item.id}
              style={rowStyle(item.id === selId, sel.isSelected(item.id))}
              data-selected={sel.isSelected(item.id) || undefined}
              onClick={(e) => {
                // Shift-click extends the delete-selection and deliberately leaves the cue
                // where it is (#90) — same split the scripture rail makes.
                if (e.shiftKey) sel.selectTo(item.id);
                else {
                  selectItem(item);
                  sel.select(item.id);
                }
              }}
              // Shift-double-click is two range-selection clicks landing fast, not a take:
              // without the guard, extending a selection could put a slide on screen.
              onDoubleClick={(e) => {
                if (e.shiftKey) return;
                selectItem(item);
                sel.select(item.id);
                takeSlideLive(item, 0);
              }}
              onContextMenu={(e) => contextMenu.open(e, deleteMenuItems(sel, item.id, 'items', removeItems))}
            >
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
        </div>
        {undo.pending && (
          <UndoToast
            label={undo.pending.length === 1 ? undo.pending[0].title : `${undo.pending.length} items`}
            onUndo={undo.undo}
            accent={T.sermon}
          />
        )}
      </div>

      <PanelDivider active={leftPanel.dragging} onMouseDown={leftPanel.startDrag} />

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
        // An empty library renders the fallback logo in the hero; Go live would be a no-op,
        // so it must not sit there looking armed (#88).
        canGoLive={selected !== null && slides.length > 0}
        onTakeDown={takeDown}
      />

      {hasRightPanel && <PanelDivider active={rightPanel.dragging} onMouseDown={rightPanel.startDrag} />}

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
                <button key={i} style={deckRowStyle} onClick={() => setSlideIdx(i)} onDoubleClick={() => { setSlideIdx(i); takeSlideLive(selected, i); }}>
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
                style={{ flex: 1, minWidth: 0 }}
              />
            </div>
          </div>
        </div>
      )}

      {deckFallback && (
        <ModalShell onClose={() => setDeckFallback(null)} variant="card" width="100%" maxWidth="420px">
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
        </ModalShell>
      )}

      {contextMenu.menu}
    </div>
  );
}
