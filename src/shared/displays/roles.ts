import type { OutputVariant, OutputRole, OutputViewMode } from '../types';

export const OUTPUT_ROLES: OutputRole[] = ['audience', 'stage', 'livestream'];
export const DEFAULT_ROLE: OutputRole = 'audience';

export const OUTPUT_VIEWS: OutputViewMode[] = ['slides', 'leader', 'mirror'];
export const DEFAULT_VIEW: OutputViewMode = 'slides';

// Roles map onto the SlideCanvas variants that already exist (types.ts OutputVariant).
// 'main'/'leader' variants are not exposed as roles in v1.
export const ROLE_VARIANT: Record<OutputRole, OutputVariant> = {
  audience: 'audience',
  stage: 'stage',
  livestream: 'livestream',
};

export interface DisplaySnapshot {
  id: number; // Electron display.id (NOT stable across sessions/replug)
  label: string; // display.label (monitor name on macOS; often '' on Win/Linux)
  size: { width: number; height: number };
  scaleFactor: number;
  rotation: number; // 0 | 90 | 180 | 270
  bounds: { x: number; y: number; width: number; height: number };
  internal: boolean;
}

export interface Attachment {
  displayId: number;
  fingerprint: string;
  role: OutputRole;
  bounds: { x: number; y: number; width: number; height: number };
}

// Stable-ish identity that survives a replug. Electron's Display does NOT expose EDID
// vendor/model/serial cross-platform, so we prefer a meaningful label and otherwise fall
// back to geometry. KNOWN LIMITATION (documented, acceptable for v1): two identical,
// unlabeled monitors produce the same fingerprint and therefore share a role.
export function fingerprintDisplay(d: DisplaySnapshot): string {
  const label = d.label.trim();
  const generic = label === '' || /^(built-?in|display|monitor|unknown)\b/i.test(label);
  return generic
    ? `geo:${d.size.width}x${d.size.height}@${d.scaleFactor}r${d.rotation}`
    : `label:${label}`;
}

// Pure planner: for every NON-operator display, resolve its role from saved assignments,
// defaulting an unknown display to 'audience' (a plugged-in screen shows the audience feed
// until the operator assigns it a role in 6b). The operator's own display is never an output.
export function planAttachments(
  displays: DisplaySnapshot[],
  operatorDisplayId: number,
  savedRoles: Record<string, OutputRole>,
): Attachment[] {
  return displays
    .filter((d) => d.id !== operatorDisplayId)
    .map((d) => {
      const fingerprint = fingerprintDisplay(d);
      const role = savedRoles[fingerprint] ?? DEFAULT_ROLE;
      return { displayId: d.id, fingerprint, role, bounds: d.bounds };
    });
}

/** Saved view for a fingerprint, defaulting to the plain slides render. */
export function resolveView(saved: Record<string, OutputViewMode>, fingerprint: string): OutputViewMode {
  return saved[fingerprint] ?? DEFAULT_VIEW;
}
