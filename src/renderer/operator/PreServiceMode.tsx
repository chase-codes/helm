import { useContext, useState, type CSSProperties, type JSX } from 'react';
import type { ThemeMode } from './App';
import { ThemeCtx } from './ThemeCtx';
import { usePreState, usePresentationState } from './useHelm';
import { preSlideFor } from '../../shared/preservice/cards';
import { SlideCanvas } from '../shared/SlideCanvas';
import { PreCardEditor } from './PreCardEditor';
import type { PreCard } from '../../shared/types';

export interface PreServiceModeProps {
  themeMode: ThemeMode;
  active: boolean;
}

const PRE_RAIL_W = 320;
// Fixed accent for "currently projecting" — distinct from the theme's `live` (red,
// used elsewhere for on-air/recording indicators) since the design brief for this
// chip calls for a green dot specifically (see task B6 ambiguity #2).
const PROJECTING_GREEN = '#3fb950';

const PRE_HINT =
  'The loop rotates through the cards on the left while people arrive. Tap a card to show it now — while a song or reading is live, tap only arms it and "Show this card" takes the screen. Move to Songs when the music starts.';

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

// `active` isn't used yet: per the brief, pre-service needs no keep-alive (App only
// mounts this component while mode === 'pre', and engine state lives in main and is
// re-read on mount) — kept in the prop list to match App's mount call and leave room
// for a future keyboard delegate.
export function PreServiceMode({ themeMode }: PreServiceModeProps): JSX.Element {
  const T = useContext(ThemeCtx);
  const dark = themeMode === 'dark';
  const { engaged, dwellS, idx, cards } = usePreState();
  // Badges below read from the REAL presentation state, never from `engaged`. The engine
  // flag says "the loop intends to run"; only output/liveKey say what the congregation is
  // actually looking at, and the two diverge (another flow goes live, ✕ Take down) until
  // the next tick reconciles them. Claiming the screen we don't own is the BUG-008 class
  // of defect.
  const { output, liveKey } = usePresentationState();

  // null = closed, 'new' = add-card flow, a PreCard = editing that card.
  const [editing, setEditing] = useState<PreCard | 'new' | null>(null);

  const idxC = Math.max(0, Math.min(idx, cards.length - 1));
  const current = cards[idxC];
  const enabledCount = cards.filter((c) => c.enabled).length;

  const isCardLive = (c: PreCard): boolean => output === 'live' && liveKey === `pre:${c.id}`;
  const preOwnsScreen = output === 'live' && (liveKey?.startsWith('pre:') ?? false);
  // The selected card is "armed" when it's queued up in the preview but something else
  // still owns the audience screen — the operator has to press Show this card (or Start
  // loop) to take it. Visually distinct from ● ON SCREEN, which means actually live.
  const selectedIsLive = current ? isCardLive(current) : false;
  const armed = current !== undefined && !selectedIsLive;

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
  // "Show this card" — the deliberate single-card takeover. Reads as an action while the
  // selection is armed, and falls back to a quiet ghost once that card is already live so
  // it never competes with Start loop for attention.
  const showBtn: CSSProperties = armed
    ? { ...primaryBtn, background: 'transparent', color: T.accent, boxShadow: `inset 0 0 0 1.5px ${T.accent}` }
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

  const projColor = preOwnsScreen ? PROJECTING_GREEN : T.faint;
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
            Tap a card to show it now — or to arm it, if something else is live. Toggle cards in or out of the rotation.
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 10px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {cards.map((card, i) => {
            const isShowing = isCardLive(card);
            const isArmed = !isShowing && i === idxC;
            const canEdit = card.type !== 'logo';
            const rowStyle: CSSProperties = {
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '11px 13px',
              borderRadius: '11px',
              cursor: 'pointer',
              opacity: card.enabled || isShowing || isArmed ? 1 : 0.55,
              // Live gets the filled treatment; armed gets the ring only — the operator
              // must be able to tell "this is on the screen" from "this is queued up".
              background: isShowing ? (dark ? '#221d10' : '#fbf1da') : T.panel2,
              boxShadow: isShowing
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
              <button key={card.id} style={rowStyle} onClick={() => window.helm.preservice.showCard(i)}>
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginTop: '20px', flexWrap: 'wrap' }}>
            <button style={ghostBtn} onClick={() => window.helm.preservice.step(-1)} title="Previous card">
              ‹
            </button>
            <button
              style={showBtn}
              onClick={() => window.helm.preservice.showNow()}
              disabled={!armed}
              title={armed ? 'Put this card on the audience screen now — no rotation' : 'This card is already on screen'}
            >
              {armed ? 'Show this card' : 'On screen'}
            </button>
            <button
              style={primaryBtn}
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
          </div>
          <div style={{ fontSize: '13px', color: T.dim, marginTop: '18px', lineHeight: 1.5 }}>{PRE_HINT}</div>
        </div>
      </div>

      {editing !== null && (
        <PreCardEditor card={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
