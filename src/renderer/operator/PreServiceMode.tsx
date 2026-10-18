import { useContext, useEffect, useLayoutEffect, useState, type CSSProperties, type JSX } from 'react';
import { ThemeCtx } from './ThemeCtx';
import { usePreState, usePresentationState } from '../shared/useHelm';
import { preSlideFor } from '../../shared/preservice/cards';
import { SlideCanvas } from '../shared/SlideCanvas';
import { ScreenBlackIcon } from '../shared/icons';
import { PreCardEditor } from './PreCardEditor';
import { ListEmpty } from './ListEmpty';
import { UndoToast } from './UndoToast';
import { useContextMenu } from './useContextMenu';
import { deleteMenuItems, useListSelection } from './useListSelection';
import type { ContextMenuItem } from './ContextMenu';
import { useTimedUndo } from './useTimedUndo';
import { usePanelWidth } from './usePanelWidth';
import { PanelDivider } from './PanelDivider';
import type { ModeKeyHandlerRef } from './App';
import type { PreCard } from '../../shared/types';
import type { ResolvedHotkey } from '../../shared/hotkeys/match';
import {
  primaryBtnStyle,
  screenToneColor,
  secondaryVerbStyle,
  statusChipStyle,
  statusDotStyle,
  transportGhostBtn,
  verbDividerStyle
} from './transport';
import { preVerbs, runPreVerb } from './preTransport';
import { screenStatus } from '../../shared/presentation/screenOwner';
import { liveRing } from './railTint';
import { LiveBadge } from './StateBadge';
import { MONO } from '../shared/fonts';
import { railHint } from './railHints';
import { RowNumber } from './RowNumber';
import { clearSelectionRung, runEscapeLadder, takeDownWhenLive } from './escapeLadder';

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

// Same shape as SermonMode's SERMON_LEFT. The max is the transport's constraint, not the
// rail's: at the 1200px minimum window the shared row has to fit in what the rail leaves.
const PRE_RAIL = { def: 320, min: 240, max: 360, anchor: 'left' } as const;

// Must keep the engine's promise exactly (BUG-018): a click is navigation, so it switches the
// screen only while pre-service is already projecting, and never starts projecting.
const PRE_HINT =
  'The loop rotates through the cards on the left while people arrive. Click a card to cue it; "Start loop" or "Show this card" puts it on the screen. Once pre-service is live, a click switches cards straight away. Move to Songs when the music starts.';

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
  const railPanel = usePanelWidth('helmPreRailW', PRE_RAIL);

  // Kept alive while hidden (App.tsx), so a menu opened here must not outlive the page
  // being on screen: a page hotkey would otherwise leave it open behind Songs or Sermon.
  const { close: closeMenu } = contextMenu;
  useEffect(() => {
    if (!active) closeMenu();
  }, [active, closeMenu]);
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
  // "Cued" = selected and in the preview, but NOT on the audience screen — whether that's
  // because a song owns it or because nothing is up yet. Deliberately broader than "another
  // flow is live": the roadmap's pre-live selection marker asks for this state before
  // anything is live, so the operator can see which card Start loop would put up.
  // Visually distinct from ● LIVE, which means actually live.
  const selectedIsLive = current ? isCardLive(current) : false;
  const armed = current !== undefined && !selectedIsLive;
  // Decision 4 is made in preVerbs, not here: the row and Enter both read `verbs.primary`.
  const verbs = preVerbs({ engaged, armed, hasCards: cards.length > 0 });

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
  //   Enter          → `verbs.primary`, the green slot's own verb, gated on the same
  //                    `enabled` flag as the button (rule 3: Enter is the button's twin).
  //                    Neither pre-service verb blacks the screen, so Enter never does,
  //                    unlike Songs/Sermon where the same button toggles.
  //   Take down      → the last rung of the Escape ladder, as everywhere else.
  //   1-9            → a tap on card N (select + showCard), so it inherits the tap's guarantee.
  //
  // The ladder has no blur rung: the only text entry on this page lives inside
  // PreCardEditor, which the first rung closes outright.
  //
  // While inactive, skip touching the ref entirely rather than nulling it: App keeps all
  // three pages mounted (keep-alive contract), so a mode switch re-runs every page's
  // effects in the same commit, and an inactive page writing null could clobber the
  // handler the newly active page just registered. Deactivation is handled by this
  // effect's own cleanup, which only fires when this page was the one that last set it.
  useLayoutEffect(() => {
    if (!active) return;
    keyHandlerRef.current = {
      onEscape: () =>
        runEscapeLadder({
          closeOverlay: () => {
            if (editing === null) return false;
            setEditing(null);
            return true;
          },
          // A stray Escape while a delete-range is picked out drops the range, not the screen.
          clearSelection: clearSelectionRung(sel),
          // The only text entry on this page lives inside PreCardEditor, which rung 1 closes.
          leaveField: false,
          // `takeDown` also disengages the loop (see its comment above).
          takeDown: takeDownWhenLive(output, takeDown)
        }),
      onArrow: (dir) => window.helm.preservice.step(dir),
      onGoLive: () => {
        if (verbs.primary.enabled) runPreVerb(verbs.primary.id);
      },
      isModalOpen: () => editing !== null,
      onDelete: () => {
        if (sel.selectedIds.length > 0) removeCards(sel.selectedIds);
      },
      // A digit is a tap on card N: it selects the row and calls showCard, which switches the
      // screen only while pre-service already owns it (BUG-018), never starts it. No search
      // on this page, so `/` is a deliberate no-op (Shortcuts says so).
      onAction: (a: ResolvedHotkey) => {
        if (a.id !== 'item.jump' || !a.digit) return;
        const card = cards[a.digit - 1];
        if (!card) return;
        sel.select(card.id);
        window.helm.preservice.showCard(a.digit - 1);
      }
    };
    return () => {
      keyHandlerRef.current = null;
    };
  });

  // ---------------- styles (ported verbatim from Lectern.dc.html's computed values) ----------------
  const preRailStyle: CSSProperties = { width: `${railPanel.width}px`, flexShrink: 0, background: T.panel, display: 'flex', flexDirection: 'column', minHeight: 0 };
  const loopCountTag: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2px 7px',
    borderRadius: '5px',
    fontFamily: MONO,
    fontSize: '9px',
    letterSpacing: '0.06em',
    fontWeight: 500,
    color: T.accent,
    background: `${T.accent}22`,
    flexShrink: 0,
    whiteSpace: 'nowrap'
  };
  // The add chip every rail carries at the top (Songs' addChip, Scripture's schedAddStyle).
  // It used to be the last list item, so the control that fills the loop moved down the
  // rail as the loop grew.
  const addChipStyle: CSSProperties = {
    width: '100%',
    height: '34px',
    marginTop: '10px',
    padding: '0 10px',
    borderRadius: '9px',
    background: `${T.accent}22`,
    color: T.accent,
    fontSize: '12.5px',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  };

  const ghostBtn: CSSProperties = transportGhostBtn(T);
  const takeDownStyle = primaryBtnStyle(T, canTakeDown ? 'down' : 'ghost');
  // One bordered group instead of three loose controls, so the row fits beside a
  // resizable rail at the 1200px minimum window (main/index.ts).
  const dwellGroupStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    height: '46px',
    borderRadius: '11px',
    boxShadow: `inset 0 0 0 1px ${T.border}`,
    flexShrink: 0
  };
  const dwellStepStyle: CSSProperties = {
    width: '34px',
    height: '46px',
    background: 'transparent',
    color: T.dim,
    fontSize: '15px',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  };
  const dwellLabelStyle: CSSProperties = {
    fontFamily: MONO,
    fontSize: '12px',
    color: T.dim,
    minWidth: '74px',
    textAlign: 'center',
    fontVariantNumeric: 'tabular-nums'
  };

  // Red is the whole app's word for "the congregation sees this" (#87), and the words are
  // the shared ones (docs/ux-vocabulary.md): this page's own card reads LIVE ON SCREEN in
  // red; another page's content reads LIVE FROM <PAGE> in faint, because the header
  // already carries the global on-air red.
  const status = screenStatus({ output, liveKey }, 'pre');
  const projColor = screenToneColor(T, status.tone);
  const projBarStyle: CSSProperties = statusChipStyle(projColor);
  const projDotStyle: CSSProperties = statusDotStyle(projColor, status.tone === 'live');
  const projText = status.text;

  // Full pane width, pinned to the bottom, the same row Songs and Sermon draw (rule 2):
  // ‹ › and this page's extras left of the spacer, then Take down and the primary slot.
  // It never wraps, so Take down can't land on an orphan second line.
  const transportStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '14px', flexShrink: 0 };
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
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    padding: '16px 12px',
    background: T.appBg
  };
  // Same shape as the Songs title row: page text left and truncating, the status chip
  // fixed-footprint at the right end.
  const statusRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '14px', flexShrink: 0 };
  const stageStyle: CSSProperties = {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center'
  };

  const cardForSlide: PreCard = current ?? { id: '', type: 'logo', title: '', enabled: true };

  return (
    <div style={rootStyle}>
      <div style={preRailStyle} data-pre-rail>
        <div style={{ padding: '13px 13px 9px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '10px', letterSpacing: '0.12em', color: T.faint, fontWeight: 600 }}>PRE-SERVICE LOOP</span>
            <span style={loopCountTag}>{`${enabledCount} IN LOOP`}</span>
          </div>
          <div style={{ fontSize: '11.5px', color: T.faint, marginTop: '5px', lineHeight: 1.4 }}>
            {`${railHint('card', { range: 'select a range' })} Toggle cards in or out of the rotation.`}
          </div>
          <button style={addChipStyle} onClick={() => setEditing('new')}>
            + Add a card — verse, announcements, prayer…
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 10px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {cards.length === 0 && (
            <ListEmpty>
              The loop is empty. Use <b>+ Add a card</b> above to put something on screen before the service.
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
              // Live gets the filled treatment and the red ring (rule 1); armed gets a
              // track-colour ring only, so the operator can tell "this is on the screen"
              // from "this is queued up". Live outranks a delete-selection ring, as on every
              // other list, so the card on screen always reads red; the selection ring
              // outranks armed, so what Delete would take stays unambiguous.
              background: isShowing ? T.selBg : T.panel2,
              boxShadow: isShowing
                ? liveRing(T)
                : isSelected
                  ? `inset 0 0 0 1.5px ${T.accent}`
                  : isArmed
                    ? `inset 0 0 0 1.5px ${T.accent}44`
                    : `inset 0 0 0 1px ${T.hairline}`
            };
            const labelStyle: CSSProperties = {
              fontFamily: MONO,
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
              fontFamily: MONO,
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
            const armedBadge: CSSProperties = {
              fontFamily: MONO,
              fontSize: '9px',
              letterSpacing: '0.06em',
              fontWeight: 600,
              color: T.accent,
              whiteSpace: 'nowrap',
              flexShrink: 0
            };
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
                  // Edit opens one card, so it is offered for the row under the pointer only,
                  // never inside a range; the logo card has no editor at all.
                  const inRange = isSelected && sel.selectedIds.length > 1;
                  const edit: ContextMenuItem[] =
                    canEdit && !inRange ? [{ label: 'Edit', onSelect: () => setEditing(card) }] : [];
                  contextMenu.open(e, [
                    ...edit,
                    ...deleteMenuItems(sel, card.id, 'cards', removeCards, {
                      // The logo card has no creation path, so it never goes (see isDeletable);
                      // the count names only the cards that actually will.
                      canDelete: (id) => cards.some((c) => c.id === id && isDeletable(c)),
                      blockedLabel: 'The logo card can’t be deleted'
                    })
                  ]);
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '5px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0 }}>
                    <RowNumber n={i + 1} color={T.faint} />
                    <div style={labelStyle}>{card.title}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {isShowing && <LiveBadge theme={T} />}
                    {isArmed && <span style={armedBadge}>● CUED</span>}
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
      <PanelDivider active={railPanel.dragging} onMouseDown={railPanel.startDrag} background={T.appBg} />

      <div style={centerStyle}>
        <div style={statusRowStyle}>
          <span style={{ flex: 1, minWidth: 0, display: 'inline-flex', alignItems: 'center', gap: '9px' }}>
            <span style={{ fontSize: '11px', letterSpacing: '0.1em', color: T.faint, fontWeight: 600 }}>PREVIEW — CURRENT CARD</span>
            {armed && (
              <span style={{ fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.06em', fontWeight: 600, color: T.accent }}>
                ● CUED
              </span>
            )}
          </span>
          <div style={projBarStyle} data-status-chip>
            <span style={projDotStyle} />
            <span style={{ fontFamily: MONO, fontSize: '11.5px', letterSpacing: '0.06em' }}>{projText}</span>
          </div>
        </div>
        <div style={stageStyle}>
          <div style={{ width: '100%', maxWidth: '680px' }}>
            <div
              data-pre-preview
              style={{
                width: '100%',
                aspectRatio: '16/9',
                borderRadius: '14px',
                overflow: 'hidden',
                position: 'relative',
                boxShadow: selectedIsLive ? `0 0 0 2px ${T.live}, 0 18px 50px rgba(0,0,0,.3)` : '0 18px 50px rgba(0,0,0,.3)'
              }}
            >
              <SlideCanvas slide={preSlideFor(cardForSlide)} fill />
            </div>
          </div>
          <div style={hintStyle}>{PRE_HINT}</div>
        </div>
        <div style={transportStyle} data-transport-bar>
          <button style={ghostBtn} onClick={() => window.helm.preservice.step(-1)} title="Previous card">
            ‹
          </button>
          <button style={ghostBtn} onClick={() => window.helm.preservice.step(1)} title="Next card">
            ›
          </button>
          <button
            style={secondaryVerbStyle(T, verbs.secondary.enabled)}
            onClick={() => runPreVerb(verbs.secondary.id)}
            disabled={!verbs.secondary.enabled}
            title={verbs.secondary.title}
            data-secondary-verb
          >
            {verbs.secondary.label}
          </button>
          <div style={dwellGroupStyle} data-dwell>
            <button style={dwellStepStyle} onClick={() => window.helm.preservice.setDwell(-1)} title="Less time on each card">
              −
            </button>
            <span style={dwellLabelStyle}>{`${dwellS}s / card`}</span>
            <button style={dwellStepStyle} onClick={() => window.helm.preservice.setDwell(1)} title="More time on each card">
              +
            </button>
          </div>
          <div style={{ flex: 1 }} />
          <button
            style={takeDownStyle}
            onClick={takeDown}
            disabled={!canTakeDown}
            title={canTakeDown ? 'Black the audience screen' : 'Nothing on screen'}
          >
            <ScreenBlackIcon size={14} /> Take down
          </button>
          <div style={verbDividerStyle(T)} />
          <button
            style={primaryBtnStyle(T, verbs.primary.kind)}
            onClick={() => runPreVerb(verbs.primary.id)}
            disabled={!verbs.primary.enabled}
            title={verbs.primary.title}
            data-primary-verb
          >
            {verbs.primary.label}
          </button>
        </div>
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
