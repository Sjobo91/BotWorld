// The world map: a big piece of land around the landing pad, with forests,
// berry meadows, rocky hills, mountains with coal and iron, lakes, a river
// and a sea coast on one side. It is made from a seed, so the server and
// every page draw the very same world without sending it around.
//
// Only the land around the landing pad is known at the start. Everything
// else is fog until a bot explores it (!explore) or a building stands near.
import { DIRS, hexDist, hexKey, ringTiles } from './hex.js';

export const MAP_RADIUS = 40;
export const START_RADIUS = 6;
export const SCOUT_RADIUS = 3;

// land: bots walk and build here. water: no walking, fish live here.
// wall: mountains, bots walk around them. ford: bots wade through.
export const TERRAIN = {
  deep: { label: 'sea', water: true },
  water: { label: 'lake', water: true },
  river: { label: 'river', water: true, ford: true },
  sand: { label: 'beach', land: true },
  grass: { label: 'grassland', land: true },
  meadow: { label: 'berry meadow', land: true },
  forest: { label: 'forest', land: true },
  hills: { label: 'rocky hills', land: true },
  mountain: { label: 'mountains', wall: true },
};
export const FEATURES = {
  coal: { label: 'coal deposit', emoji: '⚫' },
  iron: { label: 'iron deposit', emoji: '⛓️' },
  ruins: { label: 'ancient ruins', emoji: '🏚️' },
  tablet: { label: 'old stone tablet', emoji: '📜' },
};
export const walkable = (t) => !!t && (TERRAIN[t.t].land || TERRAIN[t.t].ford);

// Where each building may stand, and what nearby makes it work better.
//   on:   terrain under the building (default grass, sand, meadow)
//   near: terrain it needs right next to it
//   rich: terrain within two plots that makes it produce more
//   ore:  needs a coal or iron deposit within two plots
const BUILD_ON = ['grass', 'sand', 'meadow'];
const WATER = ['deep', 'water', 'river'];
export const SITES = {
  woodcutter: { near: ['forest'], rich: ['forest'], why: 'a forest' },
  quarry: { on: [...BUILD_ON, 'hills'], near: ['hills', 'mountain'], rich: ['hills', 'mountain'], why: 'rocky hills' },
  gatherer: { near: ['meadow'], rich: ['meadow'], why: 'a berry meadow' },
  fisher: { near: WATER, rich: WATER, why: 'water' },
  harbor: { near: ['deep', 'water'], rich: ['deep', 'water'], why: 'the sea or a lake' },
  lighthouse: { near: ['deep'], why: 'the sea' },
  mine: { on: [...BUILD_ON, 'hills'], ore: true, why: 'a coal or iron deposit' },
  farm: { on: ['grass', 'meadow'], rich: ['grass', 'meadow'], why: 'grassland' },
  greenhouse: { rich: ['grass', 'meadow'] },
  turbine: { on: [...BUILD_ON, 'hills'], rich: ['hills', 'sand', 'deep'] },
  solar: { rich: ['sand', 'grass'] },
};
export const siteOf = (item) => SITES[item] || {};

// --- Noise -------------------------------------------------------------------------------
function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed + 0x9e37, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, seed, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(x * f, y * f, seed + i * 1013);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
// Tile centre in "tile units" (neighbouring tiles are 1 apart).
export const tileXY = (q, r) => ({ x: q + r / 2, y: r * 0.8660254 });

// --- The map ----------------------------------------------------------------------------------
const cache = new Map();
export function makeMap(seed, cleared = []) {
  const ck = seed + '|' + cleared.join(';');
  if (cache.has(ck)) return cache.get(ck);
  const tiles = [];
  const index = new Map();
  for (let n = 0; n <= MAP_RADIUS; n++) {
    for (const [q, r] of ringTiles(n)) {
      const t = { i: tiles.length, q, r, d: n, t: 'grass', f: null, e: 0 };
      index.set(hexKey(q, r), t.i);
      tiles.push(t);
    }
  }
  const map = { seed, radius: MAP_RADIUS, tiles, index, total: tiles.length, seaAngle: 0 };
  const rnd = mulberry(seed);
  const seaAngle = rnd() * Math.PI * 2;
  map.seaAngle = seaAngle;
  const ca = Math.cos(seaAngle);
  const sa = Math.sin(seaAngle);
  for (const t of tiles) {
    const { x, y } = tileXY(t.q, t.r);
    let e = fbm(x / 9, y / 9, seed) + 0.22 * (fbm(x / 3.5, y / 3.5, seed + 7) - 0.5);
    e += 0.12 * smooth(10, 32, t.d);
    e -= 0.6 * smooth(9, 19, x * ca + y * sa);
    if (t.d <= 5) e += (0.5 - e) * smooth(5.5, 2, t.d);
    t.e = e;
    let type;
    if (e < 0.26) type = 'deep';
    else if (e < 0.33) type = 'water';
    else if (e < 0.365) type = 'sand';
    else if (e < 0.64) type = 'grass';
    else if (e < 0.735) type = 'hills';
    else type = 'mountain';
    if (type === 'grass') {
      const m = fbm(x / 6.5 + 40, y / 6.5 - 30, seed + 3, 3);
      if (m > 0.56) type = 'forest';
      else if (m < 0.5 && vnoise(x / 2.6, y / 2.6, seed + 9) > 0.74) type = 'meadow';
    }
    // Lakes and sea that touch the sand stay shallow; open sea far out is deep.
    if (type === 'water' && x * ca + y * sa > 14) type = 'deep';
    t.t = type;
  }
  for (const t of tiles) if (t.d <= 2) t.t = 'grass';
  carveRivers(map, rnd);
  guaranteeStart(map, seaAngle);
  placeFeatures(map);
  for (const key of cleared) {
    const i = index.get(key);
    if (i != null) { tiles[i].t = 'grass'; tiles[i].f = null; }
  }
  if (cache.size > 8) cache.clear();
  cache.set(ck, map);
  return map;
}

function mulberry(a) {
  let s = a >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const tileAt = (map, q, r) => {
  const i = map.index.get(hexKey(q, r));
  return i == null ? null : map.tiles[i];
};
export function neighborsOf(map, t) {
  const out = [];
  for (const [dq, dr] of DIRS) {
    const n = tileAt(map, t.q + dq, t.r + dr);
    if (n) out.push(n);
  }
  return out;
}
export function tilesWithin(map, t, rad) {
  const out = [];
  for (let dq = -rad; dq <= rad; dq++) {
    for (let dr = Math.max(-rad, -dq - rad); dr <= Math.min(rad, -dq + rad); dr++) {
      const n = tileAt(map, t.q + dq, t.r + dr);
      if (n) out.push(n);
    }
  }
  return out;
}

// A river or two, running downhill from the mountains to the water.
function carveRivers(map, rnd) {
  const springs = map.tiles.filter((t) => t.t === 'mountain' && t.d >= 14 && t.d <= 32);
  for (let k = 0; k < 2 && springs.length; k++) {
    let cur = springs.splice(Math.floor(rnd() * springs.length), 1)[0];
    const seen = new Set([cur.i]);
    const path = [];
    for (let step = 0; step < 70; step++) {
      const next = neighborsOf(map, cur).filter((n) => !seen.has(n.i)).sort((a, b) => a.e - b.e)[0];
      if (!next || next.d <= 4) { path.length = 0; break; }
      if (next.t === 'deep' || next.t === 'water') break;
      seen.add(next.i);
      path.push(next);
      cur = next;
    }
    if (path.length >= 4) for (const t of path) if (t.t !== 'mountain') { t.t = 'river'; t.f = null; }
  }
}

// Every world starts playable: wood, stone and berries close to the pad.
function guaranteeStart(map, seaAngle) {
  const near = (types, rad) => map.tiles.filter((t) => t.d <= rad && types.includes(t.t)).length;
  const stamp = (angle, dist, type, rad) => {
    const q = Math.round(dist * Math.cos(angle) - (dist * Math.sin(angle)) / Math.sqrt(3));
    const r = Math.round((2 * dist * Math.sin(angle)) / Math.sqrt(3));
    const c = tileAt(map, q, r);
    if (!c) return;
    for (const t of tilesWithin(map, c, rad)) if (t.d > 2 && !TERRAIN[t.t].water) t.t = type;
  };
  const away = seaAngle + Math.PI;
  if (near(['forest'], 7) < 6) stamp(away, 4.5, 'forest', 1);
  if (near(['hills', 'mountain'], 8) < 4) stamp(away + 1.9, 6, 'hills', 1);
  if (near(['meadow'], 6) < 3) stamp(away - 1.7, 3.6, 'meadow', 1);
  if (near(['deep', 'water', 'river'], 11) < 3) stamp(seaAngle, 9, 'water', 1);
}

// Coal and iron in the hills and mountains, and a few ruins and old tablets
// far out, waiting to be found.
function placeFeatures(map) {
  const s = map.seed;
  for (const t of map.tiles) {
    const { x, y } = tileXY(t.q, t.r);
    if ((t.t === 'hills' || t.t === 'mountain') && t.d >= 5) {
      if (vnoise(x / 2.2, y / 2.2, s + 21) > 0.8) t.f = 'coal';
      else if (vnoise(x / 2.4, y / 2.4, s + 33) > 0.81) t.f = 'iron';
    } else if (TERRAIN[t.t].land && t.d >= 9) {
      const h = hash2(t.q, t.r, s + 77);
      if (h < 0.007) t.f = 'ruins';
      else if (h < 0.011) t.f = 'tablet';
    }
  }
  // At least one coal and one iron deposit within reach of an early scout.
  for (const ore of ['coal', 'iron']) {
    if (map.tiles.some((t) => t.f === ore && t.d <= 13)) continue;
    const spot = map.tiles
      .filter((t) => (t.t === 'hills' || t.t === 'mountain') && t.d >= 6 && t.d <= 13 && !t.f)
      .sort((a, b) => a.d - b.d || hash2(a.q, a.r, s) - hash2(b.q, b.r, s))[0];
    if (spot) spot.f = ore;
    else {
      const t = map.tiles.filter((x) => x.d === 10 && TERRAIN[x.t].land).sort((a, b) => hash2(a.q, a.r, s) - hash2(b.q, b.r, s))[0];
      if (t) { t.t = 'hills'; t.f = ore; }
    }
  }
}

// --- Explored land: one bit per tile, sent around as hex text --------------------------------
export const newExplored = (map) => new Uint8Array(Math.ceil(map.total / 8));
export const isExplored = (bits, i) => (bits[i >> 3] & (1 << (i & 7))) !== 0;
export function setExplored(bits, i) {
  if (isExplored(bits, i)) return false;
  bits[i >> 3] |= 1 << (i & 7);
  return true;
}
export function encodeBits(bits) {
  let s = '';
  for (const b of bits) s += b.toString(16).padStart(2, '0');
  return s;
}
export function decodeBits(hex, map) {
  const bits = newExplored(map);
  for (let i = 0; i < bits.length && i * 2 + 1 < (hex || '').length; i++) bits[i] = parseInt(hex.substr(i * 2, 2), 16) || 0;
  return bits;
}
// Reveals every tile within rad of (q, r). Returns the newly seen tiles.
export function reveal(map, bits, q, r, rad) {
  const c = tileAt(map, q, r);
  if (!c) return [];
  const out = [];
  for (const t of tilesWithin(map, c, rad)) if (setExplored(bits, t.i)) out.push(t);
  return out;
}
export function exploredCount(map, bits) {
  let n = 0;
  for (let i = 0; i < map.total; i++) if (isExplored(bits, i)) n++;
  return n;
}
// Unexplored tiles next to explored ones: where scouts go next.
export function frontier(map, bits) {
  const out = [];
  for (const t of map.tiles) {
    if (isExplored(bits, t.i)) continue;
    if (neighborsOf(map, t).some((n) => isExplored(bits, n.i))) out.push(t);
  }
  return out;
}

// --- Building sites --------------------------------------------------------------------------
// May this building stand on tile t? known(t) says whether a tile is explored.
export function siteOk(map, item, t, known) {
  const s = siteOf(item);
  if (!(s.on || BUILD_ON).includes(t.t)) return false;
  if (t.f === 'coal' || t.f === 'iron') return false;
  if (s.near && !neighborsOf(map, t).some((n) => s.near.includes(n.t) && (!known || known(n)))) return false;
  if (s.ore && !tilesWithin(map, t, 2).some((n) => (n.f === 'coal' || n.f === 'iron') && (!known || known(n)))) return false;
  return true;
}
// How well a producer works on tile t: 0.6 (poor spot) to 1.6 (perfect).
export function richness(map, item, t) {
  const s = siteOf(item);
  if (s.ore) {
    const n = tilesWithin(map, t, 2).filter((x) => x.f === 'coal' || x.f === 'iron').length;
    return Math.min(1.6, 0.7 + 0.3 * n);
  }
  if (!s.rich) return 1;
  const n = tilesWithin(map, t, 2).filter((x) => x !== t && s.rich.includes(x.t)).length;
  return Math.max(0.6, Math.min(1.6, 0.6 + n * 0.1));
}
// The ores a mine on tile t can dig.
export function oresNear(map, t) {
  const set = new Set();
  for (const n of tilesWithin(map, t, 2)) if (n.f === 'coal' || n.f === 'iron') set.add(n.f);
  return [...set];
}

// --- Gathering by hand -----------------------------------------------------------------------
// !wood, !stone, !food, !fish, !coal, !iron send a bot on one trip: walk out
// to the right land, work there HAND_WORK_SEC seconds, carry the load back to
// the nearest store. How much it carries depends on its tools. Buildings make
// more, and keep going while chat sleeps.
export const HAND_WORK_SEC = 8;
// Bots walk about 0.4 tiles a second, and paths wind a little.
export const BOT_TILES_PER_SEC = 0.39;
export const PATH_WIND = 1.3;
export function walkSec(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (PATH_WIND * Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr))) / BOT_TILES_PER_SEC;
}
const nearWater = (map, t) => TERRAIN[t.t].land && neighborsOf(map, t).some((n) => WATER.includes(n.t));
export const GATHER = {
  wood: { res: 'wood', pose: 'chop', verb: 'cut wood', land: 'a forest', on: (map, t) => t.t === 'forest' },
  stone: { res: 'stone', pose: 'mine', verb: 'break stone', land: 'rocky hills', on: (map, t) => t.t === 'hills' || t.t === 'mountain' },
  food: { res: 'food', pose: 'pick', verb: 'pick berries', land: 'a berry meadow', on: (map, t) => t.t === 'meadow' },
  fish: { res: 'food', pose: 'fish', verb: 'catch fish', land: 'water', on: nearWater },
  coal: { res: 'coal', pose: 'mine', verb: 'dig coal', land: 'a coal deposit', on: (map, t) => t.f === 'coal' },
  iron: { res: 'iron', pose: 'mine', verb: 'dig iron', land: 'an iron deposit', on: (map, t) => t.f === 'iron' },
};
// The nearest known tiles to gather on, closest to the town first. taken
// holds the tile numbers that have a building on them.
export function gatherSpots(map, kind, known, taken) {
  const g = GATHER[kind];
  if (!g) return [];
  const out = [];
  for (const t of map.tiles) if ((!known || known(t)) && !taken?.has(t.i) && g.on(map, t)) out.push(t);
  // Hills before mountains: a bot can stand right on them.
  const cost = (t) => t.d + (t.t === 'mountain' ? 3 : 0);
  out.sort((a, b) => cost(a) - cost(b));
  return out.slice(0, 8);
}

// --- Paths over land (A* with a small heap) ------------------------------------------------------
export function findPath(map, from, to, ok = walkable, maxNodes = 6000) {
  if (!from || !to) return null;
  if (from.i === to.i) return [from];
  const g = new Map([[from.i, 0]]);
  const prev = new Map();
  const heap = [[hexDist(from.q - to.q, from.r - to.r), from.i]];
  const closed = new Set();
  while (heap.length && closed.size < maxNodes) {
    const [, i] = heapPop(heap);
    if (closed.has(i)) continue;
    if (i === to.i) {
      const path = [map.tiles[i]];
      let k = i;
      while (prev.has(k)) { k = prev.get(k); path.unshift(map.tiles[k]); }
      return path;
    }
    closed.add(i);
    const cur = map.tiles[i];
    for (const n of neighborsOf(map, cur)) {
      if (closed.has(n.i) || (n.i !== to.i && !ok(n))) continue;
      const ng = g.get(i) + (n.t === 'river' ? 2 : 1);
      if (ng < (g.get(n.i) ?? Infinity)) {
        g.set(n.i, ng);
        prev.set(n.i, i);
        heapPush(heap, [ng + hexDist(n.q - to.q, n.r - to.r), n.i]);
      }
    }
  }
  return null;
}
function heapPush(h, x) {
  h.push(x);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p][0] <= h[i][0]) break;
    [h[p], h[i]] = [h[i], h[p]];
    i = p;
  }
}
function heapPop(h) {
  const top = h[0];
  const last = h.pop();
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < h.length && h[l][0] < h[m][0]) m = l;
      if (r < h.length && h[r][0] < h[m][0]) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]];
      i = m;
    }
  }
  return top;
}

// Compass words for !explore, as angles in tile units (north is up the map).
export const DIRECTIONS = { north: -Math.PI / 2, northeast: -Math.PI / 4, east: 0, southeast: Math.PI / 4, south: Math.PI / 2, southwest: (3 * Math.PI) / 4, west: Math.PI, northwest: (-3 * Math.PI) / 4 };
export const DIRECTION_ALIASES = { n: 'north', ne: 'northeast', e: 'east', se: 'southeast', s: 'south', sw: 'southwest', w: 'west', nw: 'northwest', up: 'north', down: 'south', left: 'west', right: 'east' };
export function angleOf(t) {
  const { x, y } = tileXY(t.q, t.r);
  return Math.atan2(y, x);
}
