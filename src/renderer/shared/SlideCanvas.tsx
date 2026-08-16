import { useRef, type CSSProperties, type JSX } from 'react';
import type { Slide, OutputVariant } from '../../shared/types';
import { bandCandidates } from '../../shared/slides/fitText';
import { fitSizeScaled, fitSizeValue, useFitText } from './useFitText';

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
const LYRICS_BAND = bandCandidates(10.5, 3.5);
// Scripture's floor sits at 1.5, not 3: versions stack vertically, so two long verses
// need roughly double the height the old side-by-side layout did, and fitFontSize
// degrades to the smallest candidate when nothing fits — with a 3cqmin floor the walk
// gave up and the slide clipped (no scrolling exists on the output) in any
// narrower-than-16:9 window. The walk is descending and stops at the first fit, so the
// extra candidates cost nothing unless the content actually needs them. Exported for
// the test that pins the floor.
export const SCRIPTURE_BAND = bandCandidates(10, 1.5);
// Title/list slides fit as one block — title, subtitle, and points — because a three-item
// list and a nine-item list genuinely want different sizes (#49; same defect class as
// BUG-007: the old static clamp's 28px bullet ceiling made announcements *relatively
// smaller the better the projector*). The ceiling is the 9.2cqmin design size: fitting
// shrinks a crowded slide, it never balloons a short one past the design. The 2.2cqmin
// floor (a whole number of 0.25 steps below 9.2) is the degrade case for a very long
// list — the output has no scrolling, so the walk must be able to keep shrinking until
// the slide fits.
export const TITLE_BAND = bandCandidates(9.2, 2.2);
// List slides (title + points) speak the scripture slide's grammar: the title is fixed
// chrome — a small accent eyebrow, like the scripture ref — and the POINTS are the fitted
// base. The old arrangement inverted the hierarchy: the label ("Announcements") was the
// biggest thing on the slide while the items people actually read sat at 0.37× that size,
// ~37px on 1080p even after #49 removed the px ceiling. 6.4cqmin is the design size for a
// three-item list; the 2.15cqmin floor (a whole number of 0.25 steps below 6.4) is the
// degrade case for a very long one (no scrolling exists on the output, so the walk must
// be able to keep shrinking).
export const LIST_BAND = bandCandidates(6.4, 2.15);

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
    fontSize: `max(11px, ${fitSizeValue('7.4cqmin')})`,
    lineHeight: 1.16,
    letterSpacing: '-0.015em',
    color: '#fff',
    textShadow: '0 2px 22px rgba(0,0,0,.55)',
    // No maxWidth here: with nowrap, a capped line box overflows to the right only, pushing
    // long lines off-center where the fitter can't see it. contentStyle's padding is the margin.
    whiteSpace: 'nowrap'
  };

  const scriptureWrap: CSSProperties = {
    position: 'relative',
    zIndex: 2,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4cqmin',
    width: '100%',
    // Tighter side padding than the 6cqmin this launched with: stacked versions live or
    // die by line length — every cqmin of margin costs wrapped lines, which costs font
    // size. 3.5cqmin keeps a visible safe area (projectors overscan) without starving
    // the text run; columnStyle's 94% cap provides the rest of the breathing room.
    padding: '5cqmin 3.5cqmin',
    boxSizing: 'border-box'
  };
  const refStyle: CSSProperties = {
    fontFamily: "'JetBrains Mono', monospace",
    // Fixed, deliberately NOT tied to the fitted verse size: the fit re-runs per verse,
    // so a scaled ref rescaled on every advance — the ref is chrome and must hold still
    // while the verse text moves (#48). Container-relative cqmin, not px, so the operator
    // preview and the projector keep the same proportions (BUG-007); no ceiling, only the
    // 8px floor. It still sits inside the measured box: a constant-size child keeps the
    // fit walk monotonic, at the cost of a fixed floor on the block's height.
    // (calc() wrapper only because jsdom's CSSOM drops a bare top-level max().)
    fontSize: 'calc(max(8px, 2.9cqmin))',
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
    color: accent,
    fontWeight: 500
  };
  // Versions stack vertically (never side by side): two columns sharing the width were
  // too cramped to read from the congregation — each version gets the full slide width.
  const colsStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '4cqmin',
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center'
  };
  const columnStyle: CSSProperties = {
    width: '100%',
    maxWidth: '94%',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.8cqmin',
    textAlign: 'center'
  };
  const versionStyle: CSSProperties = {
    fontFamily: "'JetBrains Mono', monospace",
    // Unlike the ref, this scales with the fitted verse size (0.47x, its original
    // proportion against the 4.7cqmin verse): it is part of each verse block, not
    // slide chrome, so it shrinks with the text it labels. No ceiling (BUG-007).
    fontSize: fitSizeScaled(7, '4.7cqmin', 0.47),
    letterSpacing: '0.16em',
    color: 'rgba(255,255,255,.4)'
  };
  const verseTextStyle: CSSProperties = {
    fontFamily: "'Newsreader', Georgia, serif",
    fontSize: `max(10px, ${fitSizeValue('4.7cqmin')})`,
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

  // A title slide WITH points is a list slide, and the list is the message: the title
  // demotes to fixed chrome and the points take the fitted base (see LIST_BAND). Message
  // and sermon title slides (no points) really are about their title and keep the big
  // fitted-title treatment.
  const listMode = (kind === 'title' || kind === 'sermon') && (s.points || []).length > 0 && !isLT;
  const titleStyle: CSSProperties = listMode
    ? {
        // Identical to the scripture ref treatment: same face, size, tracking, and accent
        // colour, so every pre-service slide speaks one grammar — small label up top, big
        // content underneath. Fixed size (not the fit var): it is chrome, it holds still
        // while the fitter works, and a constant-size child keeps the fit walk monotonic.
        // (calc() wrapper only because jsdom's CSSOM drops a bare top-level max().)
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 'calc(max(8px, 2.9cqmin))',
        letterSpacing: '0.2em',
        textTransform: 'uppercase',
        color: accent,
        fontWeight: 500
      }
    : {
        fontWeight: 800,
        // The fitted base for the title block; the subtitle scales off it so the whole
        // block moves as one unit (and the fit walk stays monotonic). No px ceiling (#49).
        fontSize: `max(14px, ${fitSizeValue('9.2cqmin')})`,
        lineHeight: 1.04,
        letterSpacing: '-0.02em'
      };
  const subtitleStyle: CSSProperties = {
    fontWeight: 500,
    // 0.39: the subtitle's original proportion against the title (3.6cqmin / 9.2cqmin).
    // In list mode the base var is the point size instead; 0.56 keeps the subtitle at the
    // same intended cqmin (3.6 / 6.4) should a list slide ever carry one.
    fontSize: listMode ? fitSizeScaled(9, '6.4cqmin', 0.56) : fitSizeScaled(9, '9.2cqmin', 0.39),
    color: 'rgba(255,255,255,.58)',
    marginTop: '1.4cqmin'
  };
  const pointsWrap: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    // The wrap carries the fitted size so the em-based gap and dot metrics below scale
    // with the text they space — one knob for the fitter to turn.
    fontSize: `max(9px, ${fitSizeValue('6.4cqmin')})`,
    gap: '0.4em',
    marginTop: '3.2cqmin',
    alignItems: 'flex-start'
  };
  const pointStyle: CSSProperties = {
    display: 'flex',
    // flex-start, not center: a wrapped item must hang under its own first line with the
    // dot pinned beside that line — centered, the dot floated between the lines.
    alignItems: 'flex-start',
    gap: '0.55em',
    fontWeight: 600,
    // The points are the fitted base — the congregation reads these, not the label (#49
    // removed the px ceiling; this removes the 0.37× title ratio that kept them small).
    fontSize: `max(9px, ${fitSizeValue('6.4cqmin')})`,
    lineHeight: 1.22,
    letterSpacing: '-0.01em',
    color: '#f2efe8',
    textAlign: 'left',
    textShadow: '0 2px 22px rgba(0,0,0,.55)'
  };
  const pointDotStyle: CSSProperties = {
    width: '0.24em',
    height: '0.24em',
    minWidth: '5px',
    minHeight: '5px',
    borderRadius: '50%',
    background: accent,
    display: 'inline-block',
    flexShrink: 0,
    // Optically centers the dot on the first line: half the 1.22 line box minus half the
    // dot's 0.24em height.
    marginTop: '0.49em'
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

  const isAudience = variant === 'audience';
  const audienceLabelText = [s.sectionLabel, s.songKey ? `Key ${s.songKey}` : '']
    .filter(Boolean)
    .join(' · ');
  const showAudienceLabel = isAudience && kind === 'lyrics' && !!audienceLabelText;
  const audienceLabelStyle: CSSProperties = {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '3.2cqmin',
    zIndex: 5,
    textAlign: 'center',
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: 'clamp(7px,2.2cqmin,14px)',
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,.34)'
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

  // Lyrics, scripture, and title/list slides auto-fit; every other kind passes null and
  // keeps its own clamp. List slides fit on their own band: the points are the fitted
  // base there, not the title (see LIST_BAND).
  const fitBand = isLyrics
    ? LYRICS_BAND
    : isScripture
      ? SCRIPTURE_BAND
      : isTitle
        ? hasPoints
          ? LIST_BAND
          : TITLE_BAND
        : null;
  useFitText(rootRef, fitRef, fitBand, [
    kind,
    fitBand,
    lines.join('\n'),
    columns.map((c) => c.text).join('\n'),
    [s.title ?? '', s.subtitle ?? '', ...points].join('\n'),
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
        <div ref={fitRef} style={contentStyle}>
          <div style={titleStyle}>{s.title || ''}</div>
          {!!s.subtitle && <div style={subtitleStyle}>{s.subtitle}</div>}
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

      {showAudienceLabel && (
        <div style={audienceLabelStyle} data-testid="audience-label">
          {audienceLabelText}
        </div>
      )}

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
