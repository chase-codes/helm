import {
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type JSX,
  type MutableRefObject
} from 'react';
import type { ThemeMode } from './App';
import { ThemeCtx } from './ThemeCtx';
import { usePresentationState } from './useHelm';
import { buildQuoteSlide, buildReadingSlide, keyForMessageQuote, keyForReading } from '../../shared/message/slides';
import { norm } from '../../shared/search/fuzzy';
import type { Message, MessageMeta, QuoteRow, QuoteScheduleItem, TapeRow, TimingMap } from '../../shared/types';
import { MessageSearchRail, type MsgQuoteRow, type MsgScheduleRow, type MsgTapeRow } from './MessageSearchRail';
import { ParagraphRail } from './ParagraphRail';
import { PanelDivider } from './PanelDivider';
import { type SermonTrack } from './SchedulePanel';
import { SermonCenter } from './SermonCenter';
import { TapePlayer } from './TapePlayer';
import { TrackTabs } from './TrackTabs';
import type { PanelWidthControl } from './usePanelWidth';

/** Absolute filesystem path (as returned by `Message.audioPath`) → a `file://` URL
 * playable by an HTML5 `<audio>` element. Handles POSIX paths (`/a/b.m4a`) and Windows
 * drive paths (`C:\a\b.m4a` → `file:///C:/a/b.m4a`) the same way: normalize slashes,
 * ensure a leading `/`, percent-encode. */
function audioFileUrl(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const abs = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return `file://${encodeURI(abs)}`;
}

/**
 * Delegate this mode populates on `messageKeyRef` while active — a ref private to the
 * SermonMode/MessageMode pair, distinct from App's shared `keyHandlerRef`. SermonMode
 * stays the sole owner of `keyHandlerRef` (registers it once, unconditionally) and its
 * delegate reads `messageKeyRef.current` when `track === 'message'`. Giving MessageMode
 * its own private ref — instead of writing `keyHandlerRef.current` directly in parallel
 * with SermonMode's own registration effect — avoids the ordering race SermonMode's
 * keyHandlerRef-registration comment warns about (two effects racing to own the same
 * ref, order-dependent on which mode's effect runs last in a given commit).
 */
export interface MessageKeyHandler {
  onArrow: (dir: 1 | -1) => void;
  onGoLive: () => void;
}
export type MessageKeyRef = MutableRefObject<MessageKeyHandler | null>;

export interface MessageModeProps {
  themeMode: ThemeMode;
  messageKeyRef: MessageKeyRef;
  active: boolean;
  track: SermonTrack;
  setTrack: (t: SermonTrack) => void;
  // Shared with the Scripture and Slides tracks — SermonMode owns a single pair for the
  // whole sermon page (Task 4), so the left/right rails stay the same width switching
  // tracks rather than each track remembering (or resetting) its own.
  leftPanel: PanelWidthControl;
  rightPanel: PanelWidthControl;
}

/** Message track: a single left rail (track tabs + search/scope the tape corpus, owned
 * here rather than split across SchedulePanel and a sibling MessageSearchRail column —
 * see TrackTabs/MessageSearchRail doc comments), the cued quote as the center hero, and
 * the current tape's paragraphs (planned quotes highlighted) on the right. Ported
 * character-exact from Lectern.pretty.html's `trackIsMessage` branch. */
export function MessageMode({ themeMode, messageKeyRef, active, track, setTrack, leftPanel, rightPanel }: MessageModeProps): JSX.Element {
  const T = useContext(ThemeCtx);
  const dark = themeMode === 'dark';
  const { output, liveKey } = usePresentationState();

  const [list, setList] = useState<MessageMeta[]>([]);
  const [msgId, setMsgId] = useState('');
  const [msg, setMsg] = useState<Message | null>(null);
  const [msgIdx, setMsgIdx] = useState(0);
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<QuoteScheduleItem[]>([]);
  const [searchRes, setSearchRes] = useState<{ tapes: TapeRow[]; quotes: QuoteRow[] }>({ tapes: [], quotes: [] });
  // Tape-player state: `timing` and `activeOrd` drive the reading-view sync (Task 12);
  // `downloading` mirrors an in-flight on-demand audio fetch for the *current* tape,
  // owned here (not TapePlayer) so an `onAudioProgress` error can clear it cleanly
  // instead of leaving the player stuck. All three are tape-scoped and reset below
  // alongside the message refetch whenever `msgId` changes.
  const [timing, setTiming] = useState<TimingMap>([]);
  const [activeOrd, setActiveOrd] = useState(0);
  const [downloading, setDownloading] = useState(false);

  // Initial load: the tape list (picking the first as current) and the quote schedule.
  // `live` guards each against unmount (track switched away) before the promise resolves.
  useEffect(() => {
    let live = true;
    void window.helm.message
      .list()
      .then((l) => {
        if (!live) return;
        setList(l);
        setMsgId((cur) => cur || (l[0]?.id ?? ''));
      })
      .catch(console.error);
    void window.helm.quoteSchedule
      .list()
      .then((s) => {
        if (live) setSchedule(s);
      })
      .catch(console.error);
    return () => {
      live = false;
    };
  }, []);

  // Reset the tape-scoped player state (`activeOrd`/`downloading`/`timing`) the instant
  // `msgId` changes — a stale `activeOrd` from the previous tape would otherwise make a
  // same-render Follow-along click cue the *new* tape at the *old* tape's ord. This is
  // React's sanctioned "adjust state when a prop changes" pattern (setState during
  // render, guarded by comparing against a mirrored-in-state previous value) rather than
  // an effect — `react-hooks/set-state-in-effect` flags unconditional setState calls at
  // the top of a `useEffect` body, and this also avoids the extra committed render an
  // effect-based reset would cost.
  const [resetForMsgId, setResetForMsgId] = useState(msgId);
  if (msgId !== resetForMsgId) {
    setResetForMsgId(msgId);
    setActiveOrd(0);
    setDownloading(false);
    setTiming([]);
  }

  // Full message (paragraphs) refetch on tape change. Skips the fetch (without touching
  // state) while msgId is still empty pre-load — `liveMsg` below already reads as null
  // in that case since no fetched `msg.id` will ever equal ''.
  useEffect(() => {
    if (!msgId) return;
    let live = true;
    void window.helm.message
      .get(msgId)
      .then((m) => {
        if (live) setMsg(m);
      })
      .catch(console.error);
    return () => {
      live = false;
    };
  }, [msgId]);

  // The tape's timing map (Task 5's `activeOrdAt`/`TimingMap`) — `[]` for every tape in
  // slice 4 (aeneas alignment is slice 4b; see
  // docs/superpowers/notes/2026-07-03-the-table-acquisition.md), which makes
  // `activeOrdAt` always resolve to ord 0. The reading view therefore won't auto-scroll
  // yet, but the plumbing is wired so it "just works" once 4b populates real spans.
  useEffect(() => {
    if (!msgId) return;
    let live = true;
    void window.helm.message
      .timing(msgId)
      .then((t) => {
        if (live) setTiming(t);
      })
      .catch(console.error);
    return () => {
      live = false;
    };
  }, [msgId]);

  // On-demand audio download progress for the *current* tape. Re-`get`s the message on
  // `done` so `audioSrc` (derived from `liveMsg.audioPath` below) picks up the freshly
  // cached path; clears `downloading` on both `done` and `error` so a failed download
  // doesn't leave the player stuck.
  useEffect(() => {
    if (!msgId) return;
    const off = window.helm.message.onAudioProgress((p) => {
      if (p.msgId !== msgId) return;
      if (p.phase === 'done') {
        setDownloading(false);
        void window.helm.message
          .get(msgId)
          .then((m) => {
            if (m) setMsg(m);
          })
          .catch(console.error);
      } else if (p.phase === 'error') {
        setDownloading(false);
      } else {
        setDownloading(true);
      }
    });
    return off;
  }, [msgId]);

  // Tape/quote search, scoped to `scope` when set. Skips the fetch (without touching
  // state) while `q` is empty — consumers below gate all three row lists on `hasSearch`
  // so a stale non-empty `searchRes` from a previous query is never rendered once the
  // box is cleared, avoiding a synchronous setState-in-effect reset.
  useEffect(() => {
    if (!q.trim()) return;
    let live = true;
    void window.helm.message
      .search(q, scope)
      .then((r) => {
        if (live) setSearchRes(r);
      })
      .catch(console.error);
    return () => {
      live = false;
    };
  }, [q, scope]);

  // `msg` is fetched async and keyed by `msgId`; right after switching tapes there's a
  // render or two where `msg` still holds the *previous* tape's paragraphs before the
  // new fetch resolves. Only trust it once it actually matches the tape we're looking
  // at (mirrors SermonMode's `liveChapter` guard).
  const liveMsg = msg && msg.id === msgId ? msg : null;

  // Cue on every tape/paragraph change (mirrors SermonMode's scripture cue effect).
  // `active && track === 'message'` gates this to the track actually being the surface
  // the operator is driving — this component stays mounted while hidden (SermonMode's
  // track keep-alive), so without the gate the initial tape load would cue a quote from
  // a background track. Both are deps, so re-revealing the track re-cues the quote it
  // was left on (see SlidesTrack's cue effect for the same pattern).
  useEffect(() => {
    if (!active || track !== 'message') return;
    if (!liveMsg) return;
    const key = keyForMessageQuote(msgId, msgIdx);
    window.helm.presentation.cue(key, buildQuoteSlide(liveMsg, msgIdx));
  }, [msgId, msgIdx, liveMsg, active, track]);

  const curKey = keyForMessageQuote(msgId, msgIdx);
  const cuedIsLive = output === 'live' && liveKey === curKey;

  const stepPara = (dir: 1 | -1): void => {
    if (!liveMsg) return;
    setMsgIdx((i) => Math.max(0, Math.min(liveMsg.paragraphs.length - 1, i + dir)));
  };

  const goLive = (): void => {
    if (!liveMsg) return;
    window.helm.presentation.goLive(keyForMessageQuote(msgId, msgIdx), buildQuoteSlide(liveMsg, msgIdx));
  };

  // Playable URL for the tape player, derived (not stored) from `liveMsg.audioPath` so
  // it updates for free once the audio-progress effect above re-`get`s the message.
  const audioSrc = liveMsg?.audioPath ? audioFileUrl(liveMsg.audioPath) : null;

  const ensureAudio = (): void => {
    if (!liveMsg || liveMsg.audioPath) return;
    setDownloading(true);
    window.helm.message.downloadAudio(msgId);
  };

  // TapePlayer dedupes `timeupdate` → ord changes itself, so every call here is a real
  // boundary crossing: track it (for the Follow-along Go Live below) and re-cue the
  // reading slide so a live/hot-updated reading view scrolls along. This is entirely
  // separate from the quote-slide cue effect above — the two slide kinds/keys never
  // collide (`keyForReading` vs `keyForMessageQuote`).
  //
  // The tape deliberately keeps playing while this track is hidden (keep-alive): an
  // operator may keep listening while prepping slides, and a live follow-along must not
  // freeze mid-service because they switched tracks. So this callback still fires from
  // the background — the gate below decides what it may touch. While hidden it may only
  // hot-update a reading view that is ALREADY live (`liveKey === key`, the sameFlow case
  // applyCue hot-updates), which keeps the audience's view scrolling; it must not stomp
  // the cued preview some other surface owns at every paragraph boundary.
  const handleActiveOrd = (ord: number): void => {
    setActiveOrd(ord);
    if (!liveMsg) return;
    const key = keyForReading(msgId);
    if (!(active && track === 'message') && liveKey !== key) return;
    window.helm.presentation.cue(key, buildReadingSlide(liveMsg, ord));
  };

  // "Follow along": puts the scrolling reading view on screen at the tape's current
  // position (separate from — and doesn't disturb — the quote-slide Go Live path above).
  const followAlong = (): void => {
    if (!liveMsg) return;
    window.helm.presentation.goLive(keyForReading(msgId), buildReadingSlide(liveMsg, activeOrd));
  };

  const toggleLogo = (): void => {
    window.helm.presentation.setOutput(output === 'logo' ? 'live' : 'logo');
  };

  const selectQuote = (id: string, ord: number): void => {
    setMsgId(id);
    setMsgIdx(ord);
    setQ('');
  };
  const scopeToTape = (id: string): void => {
    setScope(id);
    setMsgId(id);
    setMsgIdx(0);
    setQ('');
  };
  const clearScope = (): void => setScope(null);
  const showPara = (ord: number): void => setMsgIdx(ord);

  // Registers this mode's own key delegate only while active (see the MessageKeyHandler
  // doc comment above) — no deps array so it always captures the latest stepPara/goLive
  // closures, mirroring SermonMode's own keyHandlerRef-registration effect. LAYOUT effect
  // for the same reason that one is: an imperative handle must not lag its commit.
  useLayoutEffect(() => {
    if (!active) return;
    messageKeyRef.current = { onArrow: stepPara, onGoLive: goLive };
    return () => {
      messageKeyRef.current = null;
    };
  });

  const plannedSet = new Set<number>();
  for (const it of schedule) {
    if (it.msgId === msgId) plannedSet.add(it.ord);
  }

  // On-deck: preview the next paragraph, tagged QUOTE if it's in the quote schedule for
  // this tape, else KEEP READING; end-of-tape past the last paragraph.
  let ondeckTag = '—';
  let ondeckTagColor = T.faint;
  let ondeckTitle = '';
  let ondeckPreview = '';
  if (liveMsg) {
    const np = liveMsg.paragraphs[msgIdx + 1];
    if (np) {
      ondeckTag = plannedSet.has(np.ord) ? 'QUOTE' : 'KEEP READING';
      ondeckTagColor = T.message;
      ondeckTitle = `${liveMsg.title} — ¶${np.label}`;
      ondeckPreview = np.text;
    } else {
      ondeckTitle = `End of ${liveMsg.title} quotes`;
      ondeckPreview = 'Pick another quote on the left';
    }
  }

  const curPara = liveMsg ? liveMsg.paragraphs[Math.max(0, Math.min(msgIdx, liveMsg.paragraphs.length - 1))] : null;
  const heroLabel = liveMsg && curPara ? `Tape ${liveMsg.tapeNo} — ¶${curPara.label}` : '';
  const quoteText = curPara?.text ?? '';
  const quoteSource = liveMsg ? `${liveMsg.title} · ${liveMsg.date}` : '';

  const scopeTitle = scope ? (list.find((m) => m.id === scope)?.title ?? null) : null;

  // Gated on `hasSearch` (rather than relying on `searchRes` being reset) so a stale
  // result from a just-cleared query never renders — see the search effect's comment.
  // Uses `norm` (not a plain trim) so a punctuation-only query falls back to the QUOTE
  // SCHEDULE idle view, matching the design's `hasMsgSearch` (Lectern.pretty.html:1170).
  const hasSearch = !!norm(q);
  const tapeRows: MsgTapeRow[] =
    hasSearch && !scope
      ? searchRes.tapes.map((t) => ({
          id: t.id,
          title: t.title,
          meta: `Tape ${t.tapeNo} · ${t.date}`,
          onClick: () => scopeToTape(t.id)
        }))
      : [];
  const quoteRows: MsgQuoteRow[] = hasSearch
    ? searchRes.quotes.map((r) => ({
        id: `${r.msgId}:${r.ord}`,
        title: scope ? `¶${r.label}` : `${r.title} — ¶${r.label}`,
        preview: r.text,
        onClick: () => selectQuote(r.msgId, r.ord)
      }))
    : [];
  const scheduleRows: MsgScheduleRow[] = schedule.map((it) => ({
    id: it.id,
    title: it.title,
    meta: `¶${it.label} · Tape ${it.tapeNo}`,
    isCurrent: it.msgId === msgId && it.ord === msgIdx,
    onClick: () => selectQuote(it.msgId, it.ord)
  }));

  const rootStyle: CSSProperties = { flex: 1, minHeight: 0, display: 'flex', gap: '1px', background: T.hairline };
  const railStyle: CSSProperties = { width: `${leftPanel.width}px`, flexShrink: 0, background: T.panel, display: 'flex', flexDirection: 'column', minHeight: 0 };
  // No design source for this action — the reading view is new in slice 4 — so it's
  // styled to sit quietly under the ported tape-player card rather than ported from
  // Lectern.pretty.html. `key={msgId}` below remounts TapePlayer (fresh `playing`/`pos`/
  // dedupe state, a fresh `<audio>` element) whenever the tape changes, instead of
  // relying on prop-diffing to reset it.
  const followAlongStyle: CSSProperties = {
    margin: '0 12px 12px',
    height: '30px',
    borderRadius: '9px',
    background: T.message + '18',
    color: T.message,
    fontSize: '11.5px',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: 'inset 0 0 0 1px ' + T.message + '40',
    flexShrink: 0
  };
  const tapePlayer = liveMsg ? (
    <>
      <TapePlayer key={msgId} theme={T} msg={liveMsg} audioSrc={audioSrc} timing={timing} downloading={downloading} onActiveOrd={handleActiveOrd} onEnsureAudio={ensureAudio} />
      <button style={followAlongStyle} onClick={followAlong}>
        Follow along ›
      </button>
    </>
  ) : null;

  return (
    <div style={rootStyle}>
      <div style={railStyle}>
        <div style={{ padding: '12px 12px 10px', flexShrink: 0 }}>
          <TrackTabs theme={T} track={track} setTrack={setTrack} />
        </div>
        <MessageSearchRail
          theme={T}
          q={q}
          onQChange={setQ}
          scopeLabel={scopeTitle}
          onClearScope={clearScope}
          tapeRows={tapeRows}
          quoteRows={quoteRows}
          scheduleRows={scheduleRows}
          tapePlayer={tapePlayer}
        />
      </div>
      <PanelDivider active={leftPanel.dragging} onMouseDown={leftPanel.startDrag} />
      <SermonCenter
        theme={T}
        variant="quote"
        accent={T.message}
        output={output}
        cuedIsLive={cuedIsLive}
        heroLabel={heroLabel}
        quoteText={quoteText}
        quoteSource={quoteSource}
        ondeckTag={ondeckTag}
        ondeckTagColor={ondeckTagColor}
        ondeckTitle={ondeckTitle}
        ondeckPreview={ondeckPreview}
        nextLabel={'Next ¶ ›'}
        onPrev={() => stepPara(-1)}
        onNext={() => stepPara(1)}
        onGoLive={goLive}
        onToggleLogo={toggleLogo}
      />
      <PanelDivider active={rightPanel.dragging} onMouseDown={rightPanel.startDrag} />
      <ParagraphRail
        theme={T}
        dark={dark}
        width={rightPanel.width}
        title={liveMsg?.title ?? ''}
        plannedCount={plannedSet.size}
        paragraphs={liveMsg?.paragraphs ?? []}
        cuedOrd={msgIdx}
        isLive={(ord) => output === 'live' && liveKey === keyForMessageQuote(msgId, ord)}
        plannedSet={plannedSet}
        onSelect={showPara}
      />
    </div>
  );
}
