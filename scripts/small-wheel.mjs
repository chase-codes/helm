/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JS script */
// Programmatic 16/32px app icon (issue #64). The vector mark downscaled to
// these sizes reads as a crosshair: thin ring + four cardinal spokes + centre
// dot is the universal reticle glyph. What says "helm wheel" at taskbar size
// is a thick rim with chunky handle nubs protruding past it — so this routine
// keeps only those: no interior spokes, 8 nubs (cardinals + diagonals), and a
// solid hub only where there is room for one.
//
// Only invoked by `generate-brand-assets.mjs --small`; the committed
// icon-16/32 PNGs are otherwise never touched.
import { createCanvas } from '@napi-rs/canvas'

// Same tile as the large sizes (see generate-brand-assets.mjs).
export const TILE = { radius: 0.23, markScale: 0.64, gradTop: '#26324B', gradBottom: '#0D1422' }
export const GOLD = '#E0A341'

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export function paintTile(ctx, size) {
  roundRect(ctx, 0, 0, size, size, size * TILE.radius)
  const g = ctx.createLinearGradient(0, 0, 0, size)
  g.addColorStop(0, TILE.gradTop)
  g.addColorStop(1, TILE.gradBottom)
  ctx.fillStyle = g
  ctx.fill()
}

// Geometry in device pixels, chosen so rim edges on the axes land on whole
// pixels (no half-covered rows) at 1x.
//   rimR / rimW   — rim centreline radius and stroke width
//   nubFrom/nubTo — handle nub extent (radial), nubW its width
//   hub           — filled hub radius, 0 for none
//   handles       — number of nubs (8 = cardinals + diagonals)
//   cap           — nub line cap ('round' gives knob ends)
export const SMALL_WHEEL = {
  16: { rimR: 3.5, rimW: 2, nubFrom: 3.5, nubTo: 7.5, nubW: 1.5, hub: 0, handles: 8, cap: 'round' },
  32: { rimR: 7.5, rimW: 3, nubFrom: 7.5, nubTo: 15.5, nubW: 2, hub: 3, handles: 8, cap: 'round' }
}

export function drawSmallWheel(size, geom = SMALL_WHEEL[size]) {
  const c = createCanvas(size, size)
  const ctx = c.getContext('2d')
  paintTile(ctx, size)
  const cx = size / 2
  const cy = size / 2
  ctx.strokeStyle = GOLD
  ctx.fillStyle = GOLD
  ctx.lineCap = geom.cap ?? 'butt'
  // Handle nubs first so the rim paints over their inner ends.
  ctx.lineWidth = geom.nubW
  for (let i = 0; i < geom.handles; i++) {
    const a = (i * 2 * Math.PI) / geom.handles
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    ctx.beginPath()
    ctx.moveTo(cx + dx * geom.nubFrom, cy + dy * geom.nubFrom)
    ctx.lineTo(cx + dx * geom.nubTo, cy + dy * geom.nubTo)
    ctx.stroke()
  }
  ctx.lineWidth = geom.rimW
  ctx.beginPath()
  ctx.arc(cx, cy, geom.rimR, 0, 2 * Math.PI)
  ctx.stroke()
  if (geom.hub > 0) {
    ctx.beginPath()
    ctx.arc(cx, cy, geom.hub, 0, 2 * Math.PI)
    ctx.fill()
  }
  return c
}
