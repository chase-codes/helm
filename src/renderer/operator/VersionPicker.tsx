import { useState, type CSSProperties, type JSX } from 'react';
import type { Theme } from '../../shared/theme';
import type { BibleManifestEntry } from '../../shared/types';

export interface VersionPickerProps {
  theme: Theme;
  manifest: BibleManifestEntry[];
  versions: string[];
  onPick: (id: string) => void;
  onOpenSettings: () => void;
}

/** Transport version button + popover: pick up to two installed translations to compare
 * side by side (hero + live output). One row per manifest entry (installed and not);
 * NOT INSTALLED rows are dimmed and route to Settings instead of picking. */
export function VersionPicker({ theme: T, manifest, versions, onPick, onOpenSettings }: VersionPickerProps): JSX.Element {
  const [open, setOpen] = useState(false);

  const abbrOf = (id: string): string => manifest.find((m) => m.id === id)?.abbr ?? id.toUpperCase();
  const versionLabel = versions.map(abbrOf).join(' + ');

  const versionBtnStyle: CSSProperties = {
    height: '46px',
    padding: '0 14px',
    borderRadius: '11px',
    background: 'transparent',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    boxShadow: `inset 0 0 0 1px ${versions.length > 1 || open ? T.scripture + '66' : T.border}`,
    fontSize: '13px',
    fontWeight: 600,
    color: versions.length > 1 ? T.scripture : T.dim,
    display: 'flex',
    alignItems: 'center'
  };
  const verPopStyle: CSSProperties = {
    position: 'absolute',
    bottom: '46px',
    right: 0,
    zIndex: 40,
    width: '290px',
    background: T.panel3,
    borderRadius: '12px',
    padding: '10px 8px 8px',
    boxShadow: `0 18px 50px rgba(0,0,0,.45), inset 0 0 0 1px ${T.border}`
  };
  const rowStyle = (installed: boolean, sel: boolean): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    width: '100%',
    padding: '9px 9px',
    borderRadius: '8px',
    cursor: installed ? 'pointer' : 'default',
    opacity: installed ? 1 : 0.45,
    background: sel ? `${T.scripture}18` : 'transparent',
    marginBottom: '2px'
  });
  const abbrStyle = (sel: boolean): CSSProperties => ({
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: '11px',
    width: '38px',
    flexShrink: 0,
    fontWeight: 600,
    color: sel ? T.scripture : T.dim,
    textAlign: 'left'
  });
  const nameStyle = (sel: boolean): CSSProperties => ({
    flex: 1,
    fontSize: '12.5px',
    fontWeight: 500,
    color: sel ? T.text : T.dim,
    textAlign: 'left',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  });
  const markStyle = (sel: boolean): CSSProperties => ({
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: '8.5px',
    letterSpacing: '0.06em',
    fontWeight: 600,
    color: sel ? T.scripture : T.faint,
    flexShrink: 0,
    whiteSpace: 'nowrap'
  });

  // Installed rows toggle selection via pickVersion; NOT INSTALLED rows close the
  // popover and hand off to Settings (Task 7 wires a real modal — onOpenSettings is an
  // interim no-op prop until then).
  const handleRowClick = (entry: BibleManifestEntry): void => {
    if (entry.installed) {
      onPick(entry.id);
      return;
    }
    setOpen(false);
    onOpenSettings();
  };

  return (
    <div style={{ position: 'relative' }}>
      <button style={versionBtnStyle} onClick={() => setOpen((o) => !o)} title="Choose translations">
        <span>{versionLabel}</span>
        <span style={{ fontSize: '8px', marginLeft: '6px', opacity: 0.7 }}>▲</span>
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 39 }} onClick={() => setOpen(false)} />
          <div style={verPopStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 9px 8px' }}>
              <span style={{ fontSize: '10px', letterSpacing: '0.1em', fontWeight: 600, color: T.faint }}>TRANSLATIONS</span>
              <span style={{ fontSize: '10.5px', color: T.faint }}>pick two to compare</span>
            </div>
            {manifest.map((entry) => {
              const idx = versions.indexOf(entry.id);
              const sel = idx >= 0;
              const mark = sel ? (idx === 0 ? '● PRIMARY' : '◧ COMPARE') : entry.installed ? '' : 'NOT INSTALLED';
              const title = entry.installed
                ? sel
                  ? 'Tap to take off screen'
                  : 'Tap to show — two at once appear side by side'
                : 'Downloadable in a full install';
              return (
                <button key={entry.id} style={rowStyle(entry.installed, sel)} onClick={() => handleRowClick(entry)} title={title}>
                  <span style={abbrStyle(sel)}>{entry.abbr}</span>
                  <span style={nameStyle(sel)}>{entry.name}</span>
                  <span style={markStyle(sel)}>{mark}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
