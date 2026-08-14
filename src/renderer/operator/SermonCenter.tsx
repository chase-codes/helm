import type { CSSProperties, JSX } from 'react';
import type { Theme } from '../../shared/theme';
import type { OutputMode, Slide, SlideColumn } from '../../shared/types';
import { SlideCanvas } from '../shared/SlideCanvas';
import { INSTALL_HINT } from '../../shared/scripture/labels';
import { GoLiveIcon, ScreenBlackIcon } from '../shared/icons';

export interface SermonCenterProps {
  theme: Theme;
  output: OutputMode;
  cuedIsLive: boolean;
  /** Track accent driving the cued-live hero border/label color — T.scripture for the
   * verse variant, T.message for the quote variant, T.sermon for the slide variant
   * (Lectern.pretty.html:1318/1320; Lectern.dc.html:953 `trackColor`). */
  accent: string;
  heroLabel: string;
  ondeckTag: string;
  ondeckTagColor: string;
  ondeckTitle: string;
  ondeckPreview: string;
  /** "Next verse ›" / "Next ¶ ›" / "Next slide ›" (Lectern.pretty.html:1326) — the
   * "‹ Back" label never varies by track. */
  nextLabel: string;
  onPrev: () => void;
  onNext: () => void;
  onGoLive: () => void;
  onToggleLogo: () => void;
  variant: 'verse' | 'quote' | 'slide';
  /** verse-only */
  cols?: SlideColumn[];
  /** The version-picker button + popover (Task 6's VersionPicker), rendered in the
   * transport row where the design's static version button used to sit — verse-only,
   * omitted entirely for the quote variant (Lectern.pretty.html:361: `trackIsScripture`). */
  versionPicker?: JSX.Element;
  /** quote-only */
  quoteText?: string;
  quoteSource?: string;
  /** slide-only: the cued deck/image/video slide, full-bleed (Lectern.dc.html:244-246
   * `liveIsSlide` branch — no heroLabel is shown alongside it, unlike verse/quote). */
  slide?: Slide;
  /** slide-only: when provided, replaces the hero's SlideCanvas — used to mount a
   * synced <video> (VideoCanvas) for video items instead of a static poster. */
  heroMedia?: JSX.Element;
}

/** The slide hero's width: the largest 16:9 rectangle that fits the hero card in BOTH
 * dimensions (#56) — full card width in a wide window, clamped by the card's height
 * (100cqh resolves against heroCardStyle's containerType) in a short one. Named and
 * exported because jsdom can't hold it (cssstyle drops declarations with container-query
 * units), so SermonCenter.test pins the formula here instead of through the DOM. */
export const SLIDE_HERO_WIDTH = 'min(100%, calc(100cqh * 16 / 9))';

/** Now-bar, hero card (verse columns or a message quote), on-deck preview, and
 * transport — shared shell for the Scripture and Message tracks (Lectern.pretty.html
 * computes heroCardStyle/heroLabelStyle/ondeck/transport once for both). */
export function SermonCenter({
  theme: T,
  output,
  cuedIsLive,
  accent,
  heroLabel,
  cols,
  quoteText,
  quoteSource,
  ondeckTag,
  ondeckTagColor,
  ondeckTitle,
  ondeckPreview,
  nextLabel,
  versionPicker,
  variant,
  slide,
  heroMedia,
  onPrev,
  onNext,
  onGoLive,
  onToggleLogo
}: SermonCenterProps): JSX.Element {
  const outColor = output === 'black' ? T.dim : output === 'logo' ? T.accent : T.live;
  const projText = output === 'black' ? 'NOTHING ON SCREEN' : output === 'logo' ? 'LOGO ON SCREEN' : 'LIVE ON SCREEN';

  const centerStyle: CSSProperties = { flex: 1, minWidth: 0, background: T.appBg, display: 'flex', flexDirection: 'column', padding: '16px 22px', minHeight: 0 };
  const nowBarStyle: CSSProperties = {
    alignSelf: 'flex-start',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    height: '28px',
    padding: '0 12px',
    borderRadius: '9px',
    background: `${outColor}1c`,
    boxShadow: `inset 0 0 0 1px ${outColor}55`,
    color: outColor,
    marginBottom: '4px'
  };
  const projDotStyle: CSSProperties = {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: outColor,
    animation: output === 'live' ? 'lecPulse 1.6s ease-in-out infinite' : 'none'
  };
  const heroCardStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    // The verse/quote heroes hold text that can genuinely overflow (long stacked
    // versions), so they scroll. A slide preview must never scroll — it shrinks to fit
    // instead (#56) — and the slide variant doubles as the size container the hero box's
    // cqh width formula below resolves against.
    ...(variant === 'slide'
      ? ({ overflowY: 'hidden', containerType: 'size' } as CSSProperties)
      : { overflowY: 'auto' }),
    borderRadius: '14px',
    background: T.panel,
    boxShadow: cuedIsLive ? `inset 0 0 0 2px ${accent}66` : `inset 0 0 0 1px ${T.hairline}`
  };
  const heroLabelStyle: CSSProperties = {
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: '12px',
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: cuedIsLive ? accent : T.faint,
    fontWeight: 500
  };
  const verseCols = cols ?? [];
  const verseVerStyle: CSSProperties = { fontFamily: "'JetBrains Mono',monospace", fontSize: '11px', letterSpacing: '0.14em', color: T.faint, marginBottom: '8px' };
  const verseTextStyle: CSSProperties = {
    fontFamily: "'Newsreader', Georgia, serif",
    fontSize: 'clamp(26.0px, 2.70vw, 38.0px)',
    lineHeight: 1.4,
    color: T.text,
    fontWeight: 400
  };
  const quoteTextStyle: CSSProperties = {
    fontFamily: "'Newsreader', Georgia, serif",
    fontSize: 'clamp(22.0px, 2.10vw, 30.0px)',
    lineHeight: 1.55,
    color: T.text,
    textAlign: 'left',
    marginTop: '18px'
  };
  const quoteSourceStyle: CSSProperties = {
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: '11.5px',
    letterSpacing: '0.08em',
    color: T.faint,
    marginTop: '18px',
    textAlign: 'left'
  };
  const ondeckStyle: CSSProperties = { flexShrink: 0, padding: '12px 15px', borderRadius: '12px', background: T.panel2, boxShadow: `inset 0 0 0 1px ${T.hairline}` };
  const ondeckTagStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2px 7px',
    borderRadius: '5px',
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: '9px',
    letterSpacing: '0.06em',
    fontWeight: 500,
    color: ondeckTagColor,
    background: `${ondeckTagColor}22`,
    flexShrink: 0,
    whiteSpace: 'nowrap'
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
  const goLiveStyle: CSSProperties = {
    height: '46px',
    padding: '0 20px',
    borderRadius: '11px',
    background: cuedIsLive ? T.live : T.go,
    color: '#fff',
    fontSize: '14.5px',
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '7px',
    whiteSpace: 'nowrap'
  };
  const logoBtnStyle: CSSProperties = {
    height: '46px',
    padding: '0 14px',
    borderRadius: '11px',
    background: 'transparent',
    boxShadow: `inset 0 0 0 1px ${output === 'logo' ? T.accent + '66' : T.border}`,
    fontSize: '13px',
    fontWeight: 600,
    color: output === 'logo' ? T.accent : T.dim,
    display: 'flex',
    alignItems: 'center'
  };

  return (
    <div style={centerStyle}>
      <div style={nowBarStyle}>
        <span style={projDotStyle} />
        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: '11.5px', letterSpacing: '0.06em' }}>{projText}</span>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={heroCardStyle}>
          {variant === 'verse' ? (
            <div style={{ margin: 'auto', width: '100%', maxWidth: '92%', textAlign: 'center', padding: '22px 30px' }}>
              <div style={heroLabelStyle}>{heroLabel}</div>
              {verseCols.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '26px', textAlign: 'left', marginTop: '18px' }}>
                  {verseCols.map((c, i) => (
                    <div key={i} style={{ width: '100%' }}>
                      <div style={verseVerStyle}>{c.version}</div>
                      <div style={verseTextStyle}>{c.text}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ marginTop: '18px', fontSize: '13px', color: T.faint }}>{INSTALL_HINT}</div>
              )}
            </div>
          ) : variant === 'quote' ? (
            <div style={{ margin: 'auto', width: '100%', maxWidth: '720px', padding: '26px 36px' }}>
              <div style={heroLabelStyle}>{heroLabel}</div>
              <div style={quoteTextStyle}>{quoteText}</div>
              <div style={quoteSourceStyle}>{quoteSource}</div>
            </div>
          ) : (
            <div
              style={{
                margin: 'auto',
                // So the slide grows into all the space the operator has and shrinks
                // instead of scrolling — which matters most for imported decks, whose
                // text is baked into the image at a fixed pixel size.
                width: SLIDE_HERO_WIDTH,
                aspectRatio: '16/9',
                borderRadius: '10px',
                overflow: 'hidden',
                position: 'relative',
                boxShadow: '0 10px 30px rgba(0,0,0,.28)'
              }}
            >
              {heroMedia ?? <SlideCanvas slide={slide ?? { kind: 'logo', title: 'HELM' }} variant="audience" fill />}
            </div>
          )}
        </div>
      </div>

      <div style={ondeckStyle}>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: '10px', letterSpacing: '0.12em', color: T.faint }}>
          UP NEXT — TAP OR PRESS →
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '7px' }}>
          <div style={ondeckTagStyle}>{ondeckTag}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ondeckTitle}</div>
            <div style={{ fontSize: '12px', color: T.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ondeckPreview}</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginTop: '13px', flexShrink: 0 }}>
        <button style={ghostBtn} onClick={onPrev}>
          &lsaquo; Back
        </button>
        <button style={ghostBtn} onClick={onNext}>
          {nextLabel}
        </button>
        <div style={{ flex: 1 }} />
        <button
          style={{ ...goLiveStyle, display: 'inline-flex', alignItems: 'center', gap: '8px' }}
          onClick={onGoLive}
        >
          {cuedIsLive ? <ScreenBlackIcon size={14} /> : <GoLiveIcon size={14} />}
          {cuedIsLive ? 'Take down' : 'Go live'}
        </button>
        {versionPicker}
        <button style={logoBtnStyle} onClick={onToggleLogo}>
          {output === 'logo' ? 'Logo on screen' : 'Logo'}
        </button>
      </div>
    </div>
  );
}
