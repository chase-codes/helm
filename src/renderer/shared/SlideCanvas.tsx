import { useRef, type CSSProperties, type JSX } from 'react';
import type { Slide, OutputVariant } from '../../shared/types';
import { bandCandidates } from '../../shared/slides/fitText';
import { fitSizeValue, useFitText } from './useFitText';

// Auto-fit bands, in cqmin. Scripture sits slightly under lyrics: it is serif body text
// and usually longer. Both lost the px ceilings that made scripture render at 55% of
// lyrics on a 1080p projector (BUG-007).
//
// Hoisted to module scope so their array identity is stable across renders. `fitBand`
// (one of these, or null) sits in useFitText's deps array, compared with Object.is — a
// fresh array from calling bandCandidates() inside the component body would make every
// render look "changed" and re-run the effect (tear down/recreate the ResizeObserver,
// force a synchronous re-measure) even when nothing fit-relevant changed, e.g. once a
// second from the stage variant's ticking clock prop.
const LYRICS_BAND = bandCandidates(8, 3.5);
const SCRIPTURE_BAND = bandCandidates(6.5, 3);

export interface SlideCanvasProps {
  slide: Slide;
  variant?: OutputVariant;
  clock?: string;
  next?: string;
  title?: string;
  fill?: boolean;
}

export function SlideCanvas({
  slide: s,
  variant = 'audience',
  clock,
  next,
  title,
  fill = false
}: SlideCanvasProps): JSX.Element {
  const kind = s.kind || 'blank';
  const isLT = variant === 'livestream';
  const isStage = variant === 'stage';
  const isMain = variant === 'main';
  const accent = s.accent || '#f0b24a';

  const rootRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<HTMLDivElement>(null);

  let bg = s.bg;
  if (!bg) {
    if (kind === 'quote') bg = 'radial-gradient(135% 135% at 50% 0%, #1c1925 0%, #08070b 72%)';
    else if (kind === 'title' || kind === 'sermon')
      bg = 'radial-gradient(140% 130% at 0% 0%, #20283a 0%, #08090d 70%)';
    else bg = 'radial-gradient(135% 125% at 50% -10%, #181d28 0%, #08090c 74%)';
  }
  if (isLT) bg = 'transparent';

  const rootStyle: CSSProperties = {
    position: 'relative',
    width: '100%',
    ...(fill ? { height: '100%' } : { aspectRatio: '16 / 9', height: 'auto' }),
    overflow: 'hidden',
    containerType: 'size',
    background: bg,
    color: '#fff',
    fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  };
  const contentStyle: CSSProperties = {
    position: 'relative',
    zIndex: 2,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '1.5cqmin',
    width: '100%',
    padding: '7cqmin',
    boxSizing: 'border-box',
    textAlign: 'center'
  };
  const lineStyle: CSSProperties = {
    fontWeight: 700,
    fontSize: fitSizeValue('clamp(11px, 7.4cqmin, 7.4cqmin)'),
    lineHeight: 1.16,
    letterSpacing: '-0.015em',
    color: '#fff',
    textShadow: '0 2px 22px rgba(0,0,0,.55)',
    maxWidth: '94%'
  };

  const single = (s.columns || []).length <= 1;
  const scriptureWrap: CSSProperties = {
    position: 'relative',
    zIndex: 2,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4cqmin',
    width: '100%',
    padding: '6cqmin',
    boxSizing: 'border-box'
  };
  const refStyle: CSSProperties = {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 'clamp(8px,2.9cqmin,22px)',
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
    color: accent,
    fontWeight: 500
  };
  const colsStyle: CSSProperties = {
    display: 'flex',
    gap: '5cqmin',
    width: '100%',
    justifyContent: 'center',
    alignItems: 'flex-start'
  };
  const columnStyle: CSSProperties = {
    flex: 1,
    maxWidth: single ? '86%' : '47%',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.8cqmin',
    textAlign: single ? 'center' : 'left'
  };
  const versionStyle: CSSProperties = {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 'clamp(7px,2.2cqmin,15px)',
    letterSpacing: '0.16em',
    color: 'rgba(255,255,255,.4)'
  };
  const verseTextStyle: CSSProperties = {
    fontFamily: "'Newsreader', Georgia, serif",
    fontSize: fitSizeValue('clamp(10px, 4.7cqmin, 4.7cqmin)'),
    lineHeight: 1.36,
    color: '#f3efe6',
    fontWeight: 400
  };

  const quoteMarkStyle: CSSProperties = {
    fontFamily: "'Newsreader', Georgia, serif",
    fontSize: 'clamp(28px,16cqmin,150px)',
    lineHeight: 0.6,
    color: accent,
    opacity: 0.55,
    marginBottom: '1cqmin'
  };
  const quoteTextStyle: CSSProperties = {
    fontFamily: "'Newsreader', Georgia, serif",
    fontStyle: 'italic',
    fontWeight: 400,
    fontSize: 'clamp(12px,5.4cqmin,52px)',
    lineHeight: 1.34,
    color: '#f2eee5',
    maxWidth: '88%'
  };
  const quoteSourceStyle: CSSProperties = {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 'clamp(7px,2.4cqmin,17px)',
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    color: accent,
    marginTop: '3cqmin'
  };

  const titleStyle: CSSProperties = {
    fontWeight: 800,
    fontSize: 'clamp(14px,9.2cqmin,90px)',
    lineHeight: 1.04,
    letterSpacing: '-0.02em'
  };
  const subtitleStyle: CSSProperties = {
    fontWeight: 500,
    fontSize: 'clamp(9px,3.6cqmin,30px)',
    color: 'rgba(255,255,255,.58)',
    marginTop: '1.4cqmin'
  };
  const pointsWrap: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.8cqmin',
    marginTop: '4cqmin',
    alignItems: 'flex-start'
  };
  const pointStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '2cqmin',
    fontWeight: 500,
    fontSize: 'clamp(9px,3.4cqmin,28px)',
    color: 'rgba(255,255,255,.85)'
  };
  const pointDotStyle: CSSProperties = {
    width: '1.4cqmin',
    height: '1.4cqmin',
    minWidth: '5px',
    minHeight: '5px',
    borderRadius: '50%',
    background: accent,
    display: 'inline-block'
  };

  const isLogo = kind === 'logo';
  const blankStyle: CSSProperties = isLogo
    ? {
        fontWeight: 800,
        fontSize: 'clamp(14px,7cqmin,60px)',
        letterSpacing: '0.12em',
        color: 'rgba(255,255,255,.92)'
      }
    : {
        color: 'rgba(255,255,255,.22)',
        fontFamily: "'JetBrains Mono',monospace",
        fontSize: 'clamp(8px,2.6cqmin,15px)',
        letterSpacing: '0.22em',
        textTransform: 'uppercase'
      };

  const showChrome = isStage;
  const clockStyle: CSSProperties = {
    position: 'absolute',
    top: '4cqmin',
    right: '5cqmin',
    zIndex: 5,
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: 'clamp(8px,3.4cqmin,24px)',
    color: 'rgba(255,255,255,.5)',
    fontVariantNumeric: 'tabular-nums'
  };
  const nextStyle: CSSProperties = {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 5,
    padding: '2.6cqmin 5cqmin',
    background: 'linear-gradient(0deg, rgba(0,0,0,.62), transparent)',
    display: 'flex',
    alignItems: 'center',
    gap: '2.4cqmin'
  };
  const nextTagStyle: CSSProperties = {
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: 'clamp(6px,2cqmin,12px)',
    letterSpacing: '0.18em',
    color: accent,
    border: '1px solid ' + accent,
    borderRadius: '3px',
    padding: '1px 6px',
    flexShrink: 0
  };
  const nextTextStyle: CSSProperties = {
    fontSize: 'clamp(8px,3cqmin,20px)',
    color: 'rgba(255,255,255,.72)',
    fontWeight: 500,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  };

  const showLabel =
    (isStage || isMain) && !!s.label && kind !== 'blank' && kind !== 'logo' && kind !== 'black';
  const labelStyle: CSSProperties = {
    position: 'absolute',
    top: '4cqmin',
    left: '5cqmin',
    zIndex: 5,
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: 'clamp(7px,2.7cqmin,15px)',
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,.38)'
  };

  let ltPrimary = '';
  let ltSecondary = '';
  if (kind === 'scripture') {
    ltPrimary = s.ref || '';
    ltSecondary = (s.columns && s.columns[0] && s.columns[0].version) || 'Scripture';
  } else if (kind === 'lyrics') {
    ltPrimary = title || 'Now singing';
    ltSecondary = s.label || '';
  } else if (kind === 'quote') {
    ltPrimary = s.source || '';
    ltSecondary = 'Message Archive';
  } else {
    ltPrimary = s.title || '';
    ltSecondary = s.subtitle || '';
  }
  const ltBarStyle: CSSProperties = {
    position: 'absolute',
    left: '5%',
    right: '5%',
    bottom: '9%',
    zIndex: 6,
    display: 'flex',
    alignItems: 'stretch',
    gap: '12px',
    background: 'rgba(9,11,15,.74)',
    backdropFilter: 'blur(10px)',
    borderRadius: '6px',
    padding: '10px 14px',
    boxShadow: '0 8px 30px rgba(0,0,0,.4)'
  };
  const ltAccentStyle: CSSProperties = {
    width: '4px',
    borderRadius: '2px',
    background: accent,
    flexShrink: 0
  };
  const ltPrimaryStyle: CSSProperties = {
    fontWeight: 700,
    fontSize: 'clamp(11px,4.4cqmin,18px)',
    color: '#fff',
    lineHeight: 1.2
  };
  const ltSecondaryStyle: CSSProperties = {
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: 'clamp(7px,2.6cqmin,11px)',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: accent,
    marginTop: '3px'
  };

  const backPlateStyle: CSSProperties = isLT
    ? {
        position: 'absolute',
        inset: 0,
        background: 'repeating-linear-gradient(135deg,#14161b,#14161b 14px,#181b21 14px,#181b21 28px)'
      }
    : { position: 'absolute', inset: 0 };

  const active = !isLT;
  const isLyrics = active && kind === 'lyrics';
  const isScripture = active && kind === 'scripture';
  const isQuote = active && kind === 'quote';
  const isTitle = active && (kind === 'title' || kind === 'sermon');
  const hasPoints = isTitle && (s.points || []).length > 0;
  const isImage = active && kind === 'image';
  const isVideo = active && kind === 'video';
  const isBlank = active && (kind === 'blank' || kind === 'black' || kind === 'logo');
  const blankText = isLogo ? s.title || 'HELM' : kind === 'black' ? '' : '—';
  const hasNext = isStage && !!next;
  const isLowerThird = isLT && kind !== 'blank' && kind !== 'black' && kind !== 'logo';
  const showBackPlate = isLT;

  const lines = s.lines || [];
  const columns = s.columns || [];
  const points = s.points || [];

  // Only lyrics and scripture auto-fit; every other kind passes null and keeps its clamp.
  const fitBand = isLyrics ? LYRICS_BAND : isScripture ? SCRIPTURE_BAND : null;
  useFitText(rootRef, fitRef, fitBand, [
    kind,
    fitBand,
    lines.join('\n'),
    columns.map((c) => c.text).join('\n'),
    variant
  ]);

  return (
    <div ref={rootRef} style={rootStyle}>
      {showBackPlate && <div style={backPlateStyle} />}

      {isLyrics && (
        <div ref={fitRef} style={contentStyle}>
          {lines.map((ln, i) => (
            <div key={i} style={lineStyle}>
              {ln}
            </div>
          ))}
        </div>
      )}

      {isScripture && (
        <div ref={fitRef} style={scriptureWrap}>
          <div style={refStyle}>{s.ref || ''}</div>
          <div style={colsStyle}>
            {columns.map((col, i) => (
              <div key={i} style={columnStyle}>
                <div style={versionStyle}>{col.version}</div>
                <div style={verseTextStyle}>{col.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {isQuote && (
        <div style={contentStyle}>
          <div style={quoteMarkStyle}>&ldquo;</div>
          <div style={quoteTextStyle}>{s.text || ''}</div>
          <div style={quoteSourceStyle}>{s.source || ''}</div>
        </div>
      )}

      {isTitle && (
        <div style={contentStyle}>
          <div style={titleStyle}>{s.title || ''}</div>
          <div style={subtitleStyle}>{s.subtitle || ''}</div>
          {hasPoints && (
            <div style={pointsWrap}>
              {points.map((p, i) => (
                <div key={i} style={pointStyle}>
                  <span style={pointDotStyle} />
                  {p}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {isBlank && <div style={blankStyle}>{blankText}</div>}

      {isImage && (
        <img
          src={s.src || ''}
          alt=""
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', zIndex: 1 }}
        />
      )}

      {isVideo && (
        <video
          src={s.src || ''}
          muted
          preload="metadata"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', zIndex: 1 }}
        />
      )}

      {showLabel && <div style={labelStyle}>{s.label || ''}</div>}

      {showChrome && (
        <>
          <div style={clockStyle}>{clock || ''}</div>
          {hasNext && (
            <div style={nextStyle}>
              <span style={nextTagStyle}>NEXT</span>
              <span style={nextTextStyle}>{next || ''}</span>
            </div>
          )}
        </>
      )}

      {isLowerThird && (
        <div style={ltBarStyle}>
          <div style={ltAccentStyle} />
          <div>
            <div style={ltPrimaryStyle}>{ltPrimary}</div>
            <div style={ltSecondaryStyle}>{ltSecondary}</div>
          </div>
        </div>
      )}
    </div>
  );
}
