import type { BuiltinPatternId } from '../../types/pattern'

/**
 * Procedural, smooth height evaluators for the built-in patterns.
 *
 * Each evaluator takes a pattern-space coordinate and returns a height in 0–1
 * using signed-distance-style math with soft (smoothstep) edges, so the relief
 * has clean rounded borders instead of pixelated blocks. All evaluators are
 * periodic on the unit tile so they tile seamlessly.
 */

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function frac(x: number): number {
  return x - Math.floor(x)
}

/** Distance from x to the nearest integer (period 1). */
function distToNearestInt(x: number): number {
  return Math.abs(frac(x + 0.5) - 0.5)
}

/** Smooth line mask: 1 on the line core, fading to 0 over `soft`. */
function lineMask(dist: number, halfWidth: number, soft: number): number {
  return 1 - smoothstep(halfWidth, halfWidth + soft, dist)
}

/** Smooth filled-disc mask centered on the tile lattice. */
function discMask(dist: number, radius: number, soft: number): number {
  return 1 - smoothstep(radius - soft, radius + soft, dist)
}

const LINE = 0.06
const SOFT = 0.05

function grid(u: number, v: number): number {
  const d = Math.min(distToNearestInt(u), distToNearestInt(v))
  return lineMask(d, LINE, SOFT)
}

function diamond(u: number, v: number): number {
  const d = Math.min(distToNearestInt(u + v), distToNearestInt(u - v))
  return lineMask(d, LINE, SOFT)
}

function crosshatch(u: number, v: number): number {
  const a = distToNearestInt((u + v) * 1.4)
  const b = distToNearestInt((u - v) * 1.4)
  return Math.max(lineMask(a, LINE * 0.8, SOFT), lineMask(b, LINE * 0.8, SOFT))
}

function dots(u: number, v: number): number {
  const du = frac(u) - 0.5
  const dv = frac(v) - 0.5
  const d = Math.hypot(du, dv)
  return discMask(d, 0.3, 0.09)
}

function ribbed(_u: number, v: number): number {
  return lineMask(distToNearestInt(v), 0.24, 0.14)
}

/** Signed distance to a set of infinite lines at three 60° orientations → hex net. */
function hexLines(u: number, v: number): number {
  const s = 1.15
  const x = u * s
  const y = v * s
  const a = distToNearestInt(y)
  const b = distToNearestInt(x * 0.8660254 + y * 0.5)
  const c = distToNearestInt(x * 0.8660254 - y * 0.5)
  const d = Math.min(a, b, c)
  return lineMask(d, LINE, SOFT)
}

function hex(u: number, v: number): number {
  return hexLines(u, v)
}

function honeycomb(u: number, v: number): number {
  // Raised cells with recessed borders (inverse of the hex line network).
  return 1 - hexLines(u, v)
}

function waves(u: number, v: number): number {
  const rows = 2
  const shifted = v * rows + 0.16 * Math.sin(u * Math.PI * 2)
  return lineMask(distToNearestInt(shifted), 0.2, 0.16)
}

function triangleWave(x: number): number {
  return Math.abs(frac(x) - 0.5) * 2
}

function zigzag(u: number, v: number): number {
  const rows = 2
  const shifted = v * rows + 0.5 * triangleWave(u)
  return lineMask(distToNearestInt(shifted), 0.18, 0.14)
}

function brick(u: number, v: number): number {
  const rows = 2
  const row = Math.floor(v * rows)
  const offset = row % 2 ? 0.5 : 0
  const mortarH = lineMask(distToNearestInt(v * rows), 0.12, 0.09)
  const mortarV = lineMask(distToNearestInt(u * rows + offset), 0.1, 0.08)
  // Bricks raised, mortar recessed.
  return 1 - Math.max(mortarH, mortarV)
}

function scales(u: number, v: number): number {
  // Offset rows of arcs read as overlapping fish scales.
  const rows = 2
  const row = Math.floor(v * rows)
  const offset = row % 2 ? 0.5 : 0
  const du = frac(u * rows + offset) - 0.5
  const dv = frac(v * rows) - 0.5
  const d = Math.hypot(du, dv * 1.1)
  const disc = discMask(d, 0.34, 0.12)
  const rim = lineMask(Math.abs(d - 0.34), 0.05, 0.05)
  return Math.max(disc * 0.85, rim)
}

const EVALUATORS: Partial<Record<BuiltinPatternId, (u: number, v: number) => number>> = {
  hex,
  grid,
  diamond,
  honeycomb,
  scales,
  ribbed,
  dots,
  waves,
  zigzag,
  brick,
  crosshatch,
}

/** True when a smooth procedural evaluator exists for this pattern. */
export function hasProceduralEvaluator(patternId: string): boolean {
  return patternId in EVALUATORS
}

/**
 * Evaluate the smooth procedural height (0–1) for a built-in pattern at a
 * pattern-space coordinate. Returns null for patterns without a procedural form
 * (e.g. `cracks`), which fall back to bitmap sampling.
 */
export function evaluatePattern(patternId: string, u: number, v: number): number | null {
  const evaluator = EVALUATORS[patternId as BuiltinPatternId]
  return evaluator ? evaluator(u, v) : null
}
