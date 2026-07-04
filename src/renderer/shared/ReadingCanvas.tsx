import type { CSSProperties, JSX } from 'react';
import { useEffect, useRef } from 'react';
import type { Slide } from '../../shared/types';

export interface ReadingCanvasProps {
  slide: Slide;
  fill?: boolean;
}

export function ReadingCanvas({ slide: s, fill = false }: ReadingCanvasProps): JSX.Element {
  const accent = s.accent || '#a88bc4';
  const paras = s.paras || [];
  const activeOrd = s.activeOrd ?? 0;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const paraRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const activeEl = paraRefs.current[activeOrd];
    activeEl?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [activeOrd, paras.length]);

  const rootStyle: CSSProperties = {
    position: 'relative',
    width: '100%',
    ...(fill ? { height: '100%' } : { aspectRatio: '16 / 9', height: 'auto' }),
    overflow: 'hidden',
    containerType: 'size',
    background: 'radial-gradient(135% 135% at 50% 0%, #1c1925 0%, #08070b 72%)',
    color: '#fff',
    fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
    display: 'flex',
    flexDirection: 'column'
  };
  const headerStyle: CSSProperties = {
    position: 'relative',
    zIndex: 2,
    flexShrink: 0,
    padding: '5cqmin 7cqmin 2cqmin',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.6cqmin'
  };
  const titleStyle: CSSProperties = {
    fontWeight: 700,
    fontSize: 'clamp(11px,4.2cqmin,32px)',
    letterSpacing: '-0.01em',
    color: '#fff'
  };
  const sourceStyle: CSSProperties = {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 'clamp(7px,2.2cqmin,15px)',
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    color: accent
  };
  const scrollStyle: CSSProperties = {
    position: 'relative',
    zIndex: 2,
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    padding: '2cqmin 7cqmin 30cqmin'
  };
  const paraRowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '3cqmin',
    padding: '2.4cqmin 0'
  };
  const gutterStyle: CSSProperties = {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 'clamp(7px,2.2cqmin,15px)',
    letterSpacing: '0.05em',
    color: accent,
    flexShrink: 0,
    minWidth: '5cqmin',
    marginTop: '0.4cqmin'
  };
  const paraTextBaseStyle: CSSProperties = {
    fontFamily: "'Newsreader', Georgia, serif",
    fontSize: 'clamp(11px,4.6cqmin,36px)',
    lineHeight: 1.42,
    transition: 'opacity .5s ease, color .5s ease, border-color .5s ease',
    borderLeft: '3px solid transparent',
    paddingLeft: '2.4cqmin'
  };

  return (
    <div style={rootStyle}>
      <div style={headerStyle}>
        <div style={titleStyle}>{s.title || ''}</div>
        <div style={sourceStyle}>{s.source || ''}</div>
      </div>
      {paras.length > 0 && (
        <div style={scrollStyle} ref={scrollRef}>
          {paras.map((p, i) => {
            const isActive = i === activeOrd;
            const paraTextStyle: CSSProperties = isActive
              ? { ...paraTextBaseStyle, opacity: 1, color: '#f2eee5', borderLeftColor: accent }
              : { ...paraTextBaseStyle, opacity: 1, color: 'rgba(255,255,255,.32)' };
            return (
              <div
                key={i}
                ref={(el) => {
                  paraRefs.current[i] = el;
                }}
                data-active={isActive ? 'true' : 'false'}
                style={paraRowStyle}
              >
                <div style={gutterStyle}>{'¶' + p.label}</div>
                <div style={paraTextStyle}>{p.text}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
