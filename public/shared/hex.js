// Axial hex coordinates (pointy top). Plot (0, 0) is the landing pad in the
// middle of the island; ring n holds the 6n plots at distance n from it.
// Ring 1 is kept for the wonders of the first six eras, around the landing
// pad; the Future's wonder rises just outside them, behind the pad.

export const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
export const MAX_RING = 12;
export const WONDER_RING = 1;

export const hexKey = (q, r) => q + ',' + r;
export function hexDist(q, r) {
  return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
}
export const hexBetween = (a, b) => hexDist(a.q - b.q, a.r - b.r);
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
// never smaller than three rings so a fresh island still has room.
export function landRingFor(maxBuiltRing) {
  return Math.max(3, Math.min(MAX_RING, maxBuiltRing + 1));
}
// The plot of the wonder of era e.
export const FINAL_WONDER_TILE = [-1, -1];
export function wonderTile(era) {
  return era < 6 ? ringTiles(WONDER_RING)[era] : FINAL_WONDER_TILE;
}
// Plots no town building may take: the wonder ring, and from the Future on
// the plot of its wonder.
export function isWonderPlot(q, r, era) {
  return hexDist(q, r) <= WONDER_RING || (era >= 6 && q === FINAL_WONDER_TILE[0] && r === FINAL_WONDER_TILE[1]);
}
