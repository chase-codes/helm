import type { OutputVariant, OutputRole, OutputViewMode } from '../types';

/** Roles that actually drive a window; 'off' means Helm leaves the screen alone. */
export type ActiveOutputRole = Exclude<OutputRole, 'off'>;

export const OUTPUT_ROLES: OutputRole[] = ['audience', 'stage', 'livestream', 'off'];
export const DEFAULT_ROLE: OutputRole = 'audience';

export const OUTPUT_VIEWS: OutputViewMode[] = ['slides', 'leader', 'mirror'];
export const DEFAULT_VIEW: OutputViewMode = 'slides';

// Roles map onto the SlideCanvas variants that already exist (types.ts OutputVariant).
// 'main'/'leader' variants are not exposed as roles in v1.
export const ROLE_VARIANT: Record<ActiveOutputRole, OutputVariant> = {
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
  role: ActiveOutputRole;
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
// until the operator assigns it a role). A display saved as 'off' produces no attachment at
// all — Helm leaves it alone. The operator's own display is never an output.
export function planAttachments(
  displays: DisplaySnapshot[],
  operatorDisplayId: number,
  savedRoles: Record<string, OutputRole>,
): Attachment[] {
  const out: Attachment[] = [];
  for (const d of displays) {
    if (d.id === operatorDisplayId) continue;
    const fingerprint = fingerprintDisplay(d);
    const role = savedRoles[fingerprint] ?? DEFAULT_ROLE;
    if (role === 'off') continue;
    out.push({ displayId: d.id, fingerprint, role, bounds: d.bounds });
  }
  return out;
}

/** Saved view for a fingerprint, defaulting to the plain slides render. */
export function resolveView(saved: Record<string, OutputViewMode>, fingerprint: string): OutputViewMode {
  return saved[fingerprint] ?? DEFAULT_VIEW;
}

/** Leader view hero/rail split: the rail's width in px. */
export const LEADER_SPLIT_MIN = 220;
export const LEADER_SPLIT_MAX = 560;
export const DEFAULT_LEADER_SPLIT = 320;
export function clampLeaderSplit(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : DEFAULT_LEADER_SPLIT;
  return Math.max(LEADER_SPLIT_MIN, Math.min(LEADER_SPLIT_MAX, Math.round(n)));
}
export function resolveLeaderSplit(saved: Record<string, number>, fingerprint: string): number {
  return clampLeaderSplit(saved[fingerprint]);
}
