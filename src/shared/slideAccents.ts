/**
 * Accents baked into slide payloads.
 *
 * Deliberately NOT theme tokens. The output canvas is dark whatever family the operator
 * picked, and the congregation should never see the screen shift because someone switched
 * to Grove between services (confirmed 2026-08-14, #71 — `preSlideFor` carries the same
 * note). Naming them here only stops the same four hexes being retyped per builder (#91).
 */

/** Songs and the pre-service title/list cards. */
export const CANVAS_AMBER = '#e0a341';
/** Scripture, on canvas — brighter than the operator UI's scripture blue (#48). */
export const CANVAS_GOLD = '#f0b24a';
/** The Message track: quote slides and the scrolling reading view. */
export const MESSAGE_ACCENT = '#a88bc4';
