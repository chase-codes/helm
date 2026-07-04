import { useContext, useEffect, useState, type CSSProperties, type JSX, type MutableRefObject } from 'react';
import type { ThemeMode } from './App';
import { ThemeCtx } from './ThemeCtx';
import { usePresentationState } from './useHelm';
import { buildQuoteSlide, keyForMessageQuote } from '../../shared/message/slides';
import { norm } from '../../shared/search/fuzzy';
import type { Message, MessageMeta, QuoteRow, QuoteScheduleItem, TapeRow } from '../../shared/types';
import { MessageSearchRail, type MsgQuoteRow, type MsgScheduleRow, type MsgTapeRow } from './MessageSearchRail';
import { ParagraphRail } from './ParagraphRail';
import { type SermonTrack } from './SchedulePanel';
import { SermonCenter } from './SermonCenter';
import { TrackTabs } from './TrackTabs';

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
}

const RAIL_W = 270;
const RIGHT_PANEL_W = 330;

/** Message track: a single left rail (track tabs + search/scope the tape corpus, owned
 * here rather than split across SchedulePanel and a sibling MessageSearchRail column —
 * see TrackTabs/MessageSearchRail doc comments), the cued quote as the center hero, and
 * the current tape's paragraphs (planned quotes highlighted) on the right. Ported
 * character-exact from Lectern.pretty.html's `trackIsMessage` branch. */
export function MessageMode({ themeMode, messageKeyRef, active, track, setTrack }: MessageModeProps): JSX.Element {
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
  useEffect(() => {
    if (!liveMsg) return;
    const key = keyForMessageQuote(msgId, msgIdx);
    window.helm.presentation.cue(key, buildQuoteSlide(liveMsg, msgIdx));
  }, [msgId, msgIdx, liveMsg]);

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
  // closures, mirroring SermonMode's own keyHandlerRef-registration effect.
  useEffect(() => {
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
  const railStyle: CSSProperties = { width: `${RAIL_W}px`, flexShrink: 0, background: T.panel, display: 'flex', flexDirection: 'column', minHeight: 0 };

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
          tapePlayer={null}
        />
      </div>
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
      <ParagraphRail
        theme={T}
        dark={dark}
        width={RIGHT_PANEL_W}
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
