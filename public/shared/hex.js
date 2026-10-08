// Axial hex coordinates (pointy top). Plot (0, 0) is the landing pad in the
// middle of the island; ring n holds the 6n plots at distance n from it.

export const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
export const MAX_RING = 10;

export const hexKey = (q, r) => q + ',' + r;
export function hexDist(q, r) {
  return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
}
export function ringTiles(n) {
  if (n === 0) return [[0, 0]];
  const out = [];
  let q = DIRS[4][0] * n;
  let r = DIRS[4][1] * n;
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < n; step++) {
      out.push([q, r]);
      q += DIRS[side][0];
      r += DIRS[side][1];
    }
  }
  return out;
}
export function neighbors(q, r) {
  return DIRS.map(([dq, dr]) => [q + dq, r + dr]);
}
// How far the land reaches: one free ring around the outermost building,
// never smaller than two rings so a fresh island still looks like an island.
export function landRingFor(maxBuiltRing) {
  return Math.max(2, Math.min(MAX_RING, maxBuiltRing + 1));
}
