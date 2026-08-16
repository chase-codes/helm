import { useContext, useLayoutEffect, useState, type CSSProperties, type JSX } from 'react';
import { ThemeCtx } from './ThemeCtx';
import { usePreState, usePresentationState } from './useHelm';
import { preSlideFor } from '../../shared/preservice/cards';
import { SlideCanvas } from '../shared/SlideCanvas';
import { ScreenBlackIcon } from '../shared/icons';
import { PreCardEditor } from './PreCardEditor';
import { ListEmpty } from './ListEmpty';
import { UndoToast } from './UndoToast';
import { useContextMenu } from './useContextMenu';
import { useListSelection } from './useListSelection';
import { useTimedUndo } from './useTimedUndo';
import type { ModeKeyHandlerRef } from './App';
import type { PreCard } from '../../shared/types';

export interface PreServiceModeProps {
  active: boolean;
  keyHandlerRef: ModeKeyHandlerRef;
}

/** A removed card plus where it sat, which is all `preservice.restoreCard` needs to put
 * the rotation back exactly as the operator built it. */
interface RemovedCard {
  card: PreCard;
  index: number;
}

/**
 * The seeded logo card is the one row on this rail with no creation path — PreCardEditor
 * only builds verse/list/message cards, and its edit chip already skips logo — so once its
 * five-second undo lapsed it would be gone for good with no way back. It is therefore
 * excluded from every delete path; SKIPPED (toggleEnabled) is how you stop showing it.
 */
const isDeletable = (c: PreCard): boolean => c.type !== 'logo';

const PRE_RAIL_W = 320;

// Must keep the engine's promise exactly (BUG-018): a tap is navigation, so it switches the
// screen only while pre-service is already projecting, and never starts projecting.
const PRE_HINT =
  'The loop rotates through the cards on the left while people arrive. Tap a card to select and preview it — "Start loop" or "Show this card" puts it on the screen. Once pre-service is projecting, a tap switches cards straight away. Move to Songs when the music starts.';

/** Port of the prototype's per-row snippet logic (Lectern.dc.html ~L1023–1027). */
function snippetFor(card: PreCard): string {
  switch (card.type) {
    case 'message':
      return (card.headline || 'Welcome') + (card.subtitle ? ` — ${card.subtitle}` : '');
    case 'verse':
      return card.text || '';
    case 'list':
      return (card.points || []).join('  ·  ');
    default:
      return 'Church logo on a dark screen';
  }
}

export function PreServiceMode({ active, keyHandlerRef }: PreServiceModeProps): JSX.Element {
  const T = useContext(ThemeCtx);
  const { engaged, dwellS, idx, cards } = usePreState();
  // Badges below read from the REAL presentation state, never from `engaged`. The engine
  // flag says "the loop intends to run"; only output/liveKey say what the congregation is
  // actually looking at, and the two diverge (another flow goes live, ✕ Take down) until
  // the next tick reconciles them. Claiming the screen we don't own is the BUG-008 class
  // of defect.
  const { output, liveKey } = usePresentationState();

  // null = closed, 'new' = add-card flow, a PreCard = editing that card.
  const [editing, setEditing] = useState<PreCard | 'new' | null>(null);

  // The standard list kit (#90). `sel` is the delete-selection, kept entirely separate
  // from the engine's `idx` — that is the card the loop is ON, and selecting rows to
  // delete must never move what the congregation is looking at.
  const contextMenu = useContextMenu();
  const sel = useListSelection(cards.map((c) => c.id));
  const undo = useTimedUndo<RemovedCard[]>();

  // Unlike the schedule rails, this delete is NOT deferred: the rotation lives in main,
  // and a card left in the engine for five more seconds can rotate onto the audience
  // screen after the operator has already removed it. So it commits immediately, and undo
  // buys exactness back with `restoreCard`, which re-inserts at the original index (#86).
  const removeCards = (ids: string[]): void => {
    const batch: RemovedCard[] = cards
      .map((card, index) => ({ card, index }))
      .filter(({ card }) => ids.includes(card.id) && isDeletable(card));
    if (!batch.length) return;
    sel.clear();
    for (const { card } of batch) window.helm.preservice.removeCard(card.id);
    undo.arm(batch);
  };

  const undoRemove = (): void => {
    const batch = undo.pending;
    if (!batch) return;
    undo.cancel();
    // Ascending index order: restoring the earliest slot first is what makes each later
    // index line up again, since every insert shifts the rows after it.
    for (const { card, index } of [...batch].sort((a, b) => a.index - b.index)) {
      window.helm.preservice.restoreCard(card, index);
    }
  };

  const idxC = Math.max(0, Math.min(idx, cards.length - 1));
  const current = cards[idxC];
  const enabledCount = cards.filter((c) => c.enabled).length;

  const isCardLive = (c: PreCard): boolean => output === 'live' && liveKey === `pre:${c.id}`;
  const preOwnsScreen = output === 'live' && (liveKey?.startsWith('pre:') ?? false);
  // "Armed" = selected and in the preview, but NOT on the audience screen — whether that's
  // because a song owns it or because nothing is up yet. Deliberately broader than "another
  // flow is live": the roadmap's pre-live selection marker asks for this state before
  // anything is live, so the operator can see which card Start loop would put up.
  // Visually distinct from ● ON SCREEN, which means actually live.
  const selectedIsLive = current ? isCardLive(current) : false;
  const armed = current !== undefined && !selectedIsLive;

  // The page's missing verb (#87). "Stop loop" halts the rotation but leaves the card lit,
  // so until now the only way to clear the screen from here was the header chip. Same reach
  // as that chip and as SongsMode's Escape rung: whoever owns the output, this clears it.
  //
  // `disengage` is explicit rather than left to the engine's tick, which yields on its own
  // but only at the next one-second boundary — a full second of the loop still claiming a
  // screen the operator has just taken down.
  const canTakeDown = output === 'live';
  const takeDown = (): void => {
    window.helm.presentation.setOutput('black');
    window.helm.preservice.disengage();
  };

  // This page's ModeKeyHandler. Arrows and Enter used to be no-ops on the theory that any
  // keystroke reaching the screen was the BUG-018 defect — but BUG-018 is about a single
  // TAP being navigation, not about the transport. So each key is wired to the control it
  // sits next to, and inherits that control's guarantees:
  //   ‹ ›            → `step`, which routes through the engine's navigate-only path and so
  //                    can never light a dark screen.
  //   Show this card → `showNow`, but only while `armed`, mirroring the button's own
  //                    disabled state. Enter is therefore never a take-down here, unlike
  //                    Songs/Sermon where the same button toggles.
  //   Take down      → the last rung of the Escape ladder, as everywhere else.
  //
  // The ladder has no blur rung: the only text entry on this page lives inside
  // PreCardEditor, which the first rung closes outright.
  useLayoutEffect(() => {
    if (!active) return;
    keyHandlerRef.current = {
      onEscape: () => {
        if (editing !== null) {
          setEditing(null);
          return true;
        }
        // Back out the most recent intent before touching the screen: a stray Escape while
        // a delete-range is picked out must drop the range, not black the projector.
        if (sel.selectedIds.length > 0) {
          sel.clear();
          return true;
        }
        if (canTakeDown) {
          takeDown();
          return true;
        }
        return false;
      },
      onArrow: (dir) => window.helm.preservice.step(dir),
      onGoLive: () => {
        if (armed) window.helm.preservice.showNow();
      },
      isModalOpen: () => editing !== null,
      onDelete: () => {
        if (sel.selectedIds.length > 0) removeCards(sel.selectedIds);
      }
    };
    return () => {
      keyHandlerRef.current = null;
    };
  });

  // ---------------- styles (ported verbatim from Lectern.dc.html's computed values) ----------------
  const preRailStyle: CSSProperties = { width: `${PRE_RAIL_W}px`, flexShrink: 0, background: T.panel, display: 'flex', flexDirection: 'column', minHeight: 0 };
  const loopCountTag: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2px 7px',
    borderRadius: '5px',
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: '9px',
    letterSpacing: '0.06em',
    fontWeight: 500,
    color: T.accent,
    background: `${T.accent}22`,
    flexShrink: 0,
    whiteSpace: 'nowrap'
  };
  const pasteSongStyle: CSSProperties = {
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

  const ghostBtn: CSSProperties = {
    height: '46px',
    padding: '0 16px',
    borderRadius: '11px',
    background: T.panel2,
    boxShadow: `inset 0 0 0 1px ${T.hairline}`,
    fontSize: '14px',
    fontWeight: 600,
    color: T.dim,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '7px'
  };
  const primaryBtn: CSSProperties = {
    height: '46px',
    padding: '0 22px',
    borderRadius: '11px',
    background: T.accent,
    color: T.accentInk,
    fontSize: '14.5px',
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '7px'
  };
  // Green = go, the same convention SermonCenter and SongsMode use for their Go live
  // buttons (#91). Start loop is this page's equivalent verb, so it wears the same colour.
  // Stop loop drops back to the accent rather than turning red: red is take-down, and
  // stopping the rotation leaves the current card lit — see `takeDown` above.
  const loopBtn: CSSProperties = engaged
    ? primaryBtn
    : { ...primaryBtn, background: T.go, color: '#fff' };
  // "Show this card" — the deliberate single-card takeover. Reads as an action while the
  // selection is armed, and falls back to a quiet ghost once that card is already live so
  // it never competes with Start loop for attention.
  // The label no longer reports state ("On screen") the way it used to: every toggle in
  // the app now says what the click DOES, and the ● ON SCREEN badge on the card already
  // says what is up (#92). That also makes the row's width constant across both states,
  // which the min-width below used to have to fake.
  const showBtn: CSSProperties = armed
    ? { ...primaryBtn, minWidth: '150px', background: 'transparent', color: T.accent, boxShadow: `inset 0 0 0 1.5px ${T.accent}` }
    : { ...ghostBtn, minWidth: '150px', cursor: 'default' };
  // Tinted rather than filled: a solid red button would out-shout Start loop, and this is
  // the page's escape hatch, not its primary verb. Same `1c`/`55` formula as the on-air bar
  // below, so the two red things on the page read as one signal.
  const takeDownBtn: CSSProperties = canTakeDown
    ? { ...ghostBtn, color: T.live, background: `${T.live}1c`, boxShadow: `inset 0 0 0 1px ${T.live}55` }
    : { ...ghostBtn, cursor: 'default' };
  const smallGhost: CSSProperties = {
    height: '46px',
    padding: '0 14px',
    borderRadius: '11px',
    background: 'transparent',
    boxShadow: `inset 0 0 0 1px ${T.border}`,
    fontSize: '13px',
    fontWeight: 600,
    color: T.dim,
    display: 'flex',
    alignItems: 'center'
  };

  // Red is the whole app's word for "the congregation sees this" (#87). This bar used to
  // say it in a hard-coded green, so the operator's most important signal changed colour
  // with the page they were on and ignored the theme families outright. The two not-ours
  // states stay faint on purpose: the bar reports THIS page's claim on the screen, and the
  // header already carries the global on-air state.
  const projColor = preOwnsScreen ? T.live : T.faint;
  const projBarStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    height: '30px',
    padding: '0 13px',
    borderRadius: '9px',
    background: `${projColor}1c`,
    boxShadow: `inset 0 0 0 1px ${projColor}55`,
    color: projColor
  };
  const projDotStyle: CSSProperties = {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: projColor,
    animation: preOwnsScreen ? 'lecPulse 1.6s ease-in-out infinite' : 'none'
  };
  const projText = preOwnsScreen ? 'PROJECTING' : output === 'live' ? 'ANOTHER FLOW LIVE' : 'OFF SCREEN';

  const dividerStyle: CSSProperties = { width: '1px', height: '28px', background: T.hairline, margin: '0 4px' };
  // The transport is a sibling of the preview rather than a child of it, so it can run wider
  // than the 680px the slide is clamped to. With Take down added, eight controls no longer
  // fit in 680 — and wrapping would put the page's one destructive verb on an orphan second
  // line, which is the last control that should move about.
  const transportStyle: CSSProperties = {
    width: '100%',
    maxWidth: '820px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    marginTop: '20px',
    flexWrap: 'wrap'
  };
  const hintStyle: CSSProperties = {
    width: '100%',
    maxWidth: '680px',
    textAlign: 'center',
    fontSize: '13px',
    color: T.dim,
    marginTop: '18px',
    lineHeight: 1.5
  };

  const rootStyle: CSSProperties = { flex: 1, minHeight: 0, display: 'flex', gap: '1px', background: T.hairline };
  const centerStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '26px',
    background: T.appBg
  };

  const cardForSlide: PreCard = current ?? { id: '', type: 'logo', title: '', enabled: true };

  return (
    <div style={rootStyle}>
      <div style={preRailStyle}>
        <div style={{ padding: '13px 13px 9px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '10px', letterSpacing: '0.12em', color: T.faint, fontWeight: 600 }}>PRE-SERVICE LOOP</span>
            <span style={loopCountTag}>{`${enabledCount} IN LOOP`}</span>
          </div>
          <div style={{ fontSize: '11.5px', color: T.faint, marginTop: '5px', lineHeight: 1.4 }}>
            Tap a card to select it — while pre-service is on the screen, that switches it. Toggle cards in or out of the rotation.
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 10px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {cards.length === 0 && (
            <ListEmpty>
              The loop is empty — add a card below to put something on screen before the
              service.
            </ListEmpty>
          )}
          {cards.map((card, i) => {
            const isShowing = isCardLive(card);
            const isArmed = !isShowing && i === idxC;
            const isSelected = sel.isSelected(card.id);
            const canEdit = card.type !== 'logo';
            const rowStyle: CSSProperties = {
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '11px 13px',
              borderRadius: '11px',
              cursor: 'pointer',
              userSelect: 'none',
              opacity: card.enabled || isShowing || isArmed ? 1 : 0.55,
              // Live gets the filled treatment; armed gets the ring only — the operator
              // must be able to tell "this is on the screen" from "this is queued up".
              // A delete-selection ring outranks both: while a range is picked out, what
              // Delete would take has to be the unambiguous thing on the rail.
              background: isShowing ? T.selBg : T.panel2,
              boxShadow: isSelected
                ? `inset 0 0 0 1.5px ${T.accent}`
                : isShowing
                  ? `inset 0 0 0 1.5px ${T.accent}88`
                  : isArmed
                    ? `inset 0 0 0 1.5px ${T.accent}44`
                    : `inset 0 0 0 1px ${T.hairline}`
            };
            const labelStyle: CSSProperties = {
              fontFamily: "'JetBrains Mono',monospace",
              fontSize: '10.5px',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              fontWeight: 500,
              color: isShowing || isArmed ? T.accent : T.faint
            };
            const snippetStyle: CSSProperties = {
              fontSize: '12.5px',
              lineHeight: 1.45,
              fontWeight: 500,
              color: isShowing || isArmed ? T.text : T.dim,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical'
            } as CSSProperties;
            const editChipStyle: CSSProperties = {
              fontSize: '11px',
              padding: '3px 7px',
              borderRadius: '6px',
              cursor: 'pointer',
              flexShrink: 0,
              color: T.dim,
              boxShadow: `inset 0 0 0 1px ${T.border}`
            };
            const chipStyle: CSSProperties = {
              fontFamily: "'JetBrains Mono',monospace",
              fontSize: '9px',
              letterSpacing: '0.06em',
              fontWeight: 600,
              padding: '3px 7px',
              borderRadius: '6px',
              cursor: 'pointer',
              flexShrink: 0,
              color: card.enabled ? T.accent : T.faint,
              background: card.enabled ? `${T.accent}1c` : 'transparent',
              boxShadow: card.enabled ? 'none' : `inset 0 0 0 1px ${T.border}`
            };
            const showingBadge: CSSProperties = {
              fontFamily: "'JetBrains Mono',monospace",
              fontSize: '9px',
              letterSpacing: '0.06em',
              fontWeight: 600,
              color: T.live,
              whiteSpace: 'nowrap',
              flexShrink: 0
            };
            const armedBadge: CSSProperties = { ...showingBadge, color: T.accent };
            return (
              <button
                key={card.id}
                data-pre-card={card.id}
                data-selected={isSelected || undefined}
                style={rowStyle}
                onClick={(e) => {
                  // Shift-click extends the delete-selection only. It must not reach
                  // showCard: on an engaged loop that call switches the audience screen,
                  // and picking rows to delete is not a request to project any of them.
                  if (e.shiftKey) {
                    sel.selectTo(card.id);
                    return;
                  }
                  sel.select(card.id);
                  window.helm.preservice.showCard(i);
                }}
                onDoubleClick={(e) => {
                  if (!e.shiftKey) window.helm.preservice.takeCard(i);
                }}
                onContextMenu={(e) => {
                  const batchMenu = isSelected && sel.selectedIds.length > 1;
                  if (!batchMenu) sel.select(card.id);
                  const ids = batchMenu ? sel.selectedIds : [card.id];
                  // The count names what will ACTUALLY go, so a range that happens to
                  // include the undeletable logo card doesn't promise more than it does.
                  const deletable = cards.filter((c) => ids.includes(c.id) && isDeletable(c));
                  contextMenu.open(e, [
                    deletable.length === 0
                      ? { label: 'The logo card can’t be deleted', disabled: true, onSelect: () => {} }
                      : {
                          label: deletable.length === 1 ? 'Delete' : `Delete ${deletable.length} cards`,
                          danger: true,
                          onSelect: () => removeCards(deletable.map((c) => c.id))
                        }
                  ]);
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '5px' }}>
                  <div style={labelStyle}>{card.title}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {isShowing && <span style={showingBadge}>● ON SCREEN</span>}
                    {isArmed && <span style={armedBadge}>● ARMED</span>}
                    {canEdit && (
                      <span
                        style={editChipStyle}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditing(card);
                        }}
                        title="Edit card"
                      >
                        ✎
                      </span>
                    )}
                    <span
                      style={chipStyle}
                      onClick={(e) => {
                        e.stopPropagation();
                        window.helm.preservice.toggleEnabled(card.id);
                      }}
                      title="Include or skip in the loop"
                    >
                      {card.enabled ? 'IN LOOP' : 'SKIPPED'}
                    </span>
                  </div>
                </div>
                <div style={snippetStyle}>{snippetFor(card)}</div>
              </button>
            );
          })}
          <button style={pasteSongStyle} onClick={() => setEditing('new')}>
            + Add a card — verse, announcements, prayer…
          </button>
        </div>
        {undo.pending && (
          <UndoToast
            label={
              undo.pending.length === 1 ? undo.pending[0].card.title : `${undo.pending.length} cards`
            }
            onUndo={undoRemove}
          />
        )}
      </div>

      <div style={centerStyle}>
        <div style={{ width: '100%', maxWidth: '680px', textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '9px' }}>
              <span style={{ fontSize: '11px', letterSpacing: '0.1em', color: T.faint, fontWeight: 600 }}>PREVIEW — CURRENT CARD</span>
              {armed && (
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: '9.5px', letterSpacing: '0.06em', fontWeight: 600, color: T.accent }}>
                  ● ARMED
                </span>
              )}
            </span>
            <div style={projBarStyle}>
              <span style={projDotStyle} />
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: '11.5px', letterSpacing: '0.06em' }}>{projText}</span>
            </div>
          </div>
          <div
            style={{
              width: '100%',
              aspectRatio: '16/9',
              borderRadius: '14px',
              overflow: 'hidden',
              position: 'relative',
              boxShadow: '0 18px 50px rgba(0,0,0,.3)'
            }}
          >
            <SlideCanvas slide={preSlideFor(cardForSlide)} fill />
          </div>
        </div>
        <div style={transportStyle}>
          <button style={ghostBtn} onClick={() => window.helm.preservice.step(-1)} title="Previous card">
            ‹
          </button>
          <button
            style={showBtn}
            onClick={() => window.helm.preservice.showNow()}
            disabled={!armed}
            title={armed ? 'Put this card on the audience screen now — no rotation' : 'This card is already on screen'}
          >
            Show this card
          </button>
          <button
            style={loopBtn}
            onClick={() => (engaged ? window.helm.preservice.disengage() : window.helm.preservice.engage())}
          >
            {engaged ? 'Stop loop' : 'Start loop'}
          </button>
          <button style={ghostBtn} onClick={() => window.helm.preservice.step(1)} title="Next card">
            ›
          </button>
          <div style={dividerStyle} />
          <button style={smallGhost} onClick={() => window.helm.preservice.setDwell(-1)}>
            −
          </button>
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: '12px', color: T.dim, minWidth: '74px' }}>
            {`${dwellS}s / card`}
          </span>
          <button style={smallGhost} onClick={() => window.helm.preservice.setDwell(1)}>
            +
          </button>
          <div style={dividerStyle} />
          <button
            style={takeDownBtn}
            onClick={takeDown}
            disabled={!canTakeDown}
            title={canTakeDown ? 'Clear the audience screen' : 'Nothing on screen'}
          >
            <ScreenBlackIcon size={14} /> Take down
          </button>
        </div>
        <div style={hintStyle}>{PRE_HINT}</div>
      </div>

      {editing !== null && (
        <PreCardEditor
          card={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onRemove={(card) => removeCards([card.id])}
        />
      )}
      {contextMenu.menu}
    </div>
  );
}
