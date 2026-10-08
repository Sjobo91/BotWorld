// The island in 3D: land that grows ring by ring, the buildings chat ordered,
// and one bot per viewer that walks to its plot, hammers, hauls goods to the
// wonder, chats and sleeps. Each era changes how the island itself looks.
// The server decides everything; this file only makes it look alive.
import { ITEMS, ERAS, RESOURCES, hashStr } from '../shared/catalog.js';
import { DIRS, hexDist } from '../shared/hex.js';
import { makeMap, decodeBits, isExplored, TERRAIN, MAP_RADIUS, START_RADIUS, GATHER, HAND_LOAD, HAND_TRIP_SEC, HAND_FIRST_SEC } from '../shared/terrain.js';
import { sunAt, seasonAt } from '../shared/sun.js';
import { initMeshes, mats, geo, mesh, std, rng, glowTexture, scaffoldMesh, stakeMesh, shipMesh, botMesh, hatMesh, treeMesh, benchMesh, trimMat } from './meshes.js';
import { buildingMesh } from './buildings.js';
import { createAudio } from './audio.js';

const R = 0.62;
const SQ3 = Math.sqrt(3);
const PATH_TOP = 0.035;
const TILE_TOP = 0.07;
const DAY = 864e5;
const SLEEP_AFTER = 3 * DAY;
const GONE_AFTER = 14 * DAY;
const MAX_BOTS = 60;
const RING2 = [];
for (let dq = -2; dq <= 2; dq++) for (let dr = -2; dr <= 2; dr++) if (Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr)) === 2) RING2.push([dq, dr]);
const WALK = 0.42;
const CHAT_EMOJI = ['☕', '💬', '😄', '🔨', '🎉', '🤔', '👍', '🍕', '🌻', '✨', '🏠', '📦'];
const LINES = {
  hello: ['Hi! I am {name}.', 'Hello there!', 'Nice island, right?', 'I build what {name} asks for.'],
  work: ['Tap, tap, tap!', 'Almost there!', 'This is going to look great.', 'Hammer time!'],
  job: ['Hard work!', 'Every bit helps.', 'For the village!', 'Heave ho!'],
  chop: ['Timber!', 'Chop, chop!', 'Nice logs here.', 'Wood for the town!'],
  mine: ['Clink, clink!', 'Rock solid.', 'Heavy stuff!', 'Found a good vein!'],
  pick: ['So many berries!', 'One for the basket, one for me.', 'Yum!'],
  fish: ['Come on, fishy...', 'A bite!', 'Patience...'],
  done: ['Done!', 'Ta-da!', 'Looks good!', 'Another one!'],
  sleep: ['Zzz…', 'Five more minutes…', 'Dreaming of bricks.'],
  poke: ['Hey, I am busy!', 'That tickles!', 'I am getting dizzy…'],
};
const POI_DEFS = {
  market: ['drink', 'drink'], park: ['sit', 'sit'], campfire: ['sit', 'sit', 'sit'], garden: ['water'], farm: ['water'],
  greenhouse: ['water'], fountain: ['look', 'look'], well: ['look'], statue: ['look'], totem: ['look'], lighthouse: ['look'],
  tower: ['look'], windmill: ['look'], stadium: ['sit', 'sit'], holopark: ['look', 'look'], school: ['look'],
  stonecircle: ['look', 'look'], greathall: ['sit'], cathedral: ['look'], clocktower: ['look'], skyline: ['look'], spire: ['look', 'look'],
};
const RES_COLORS = { wood: '#8a5a3b', stone: '#9aa1aa', food: '#e0a040', bricks: '#b5583b', coal: '#2b2b2e', iron: '#7d8794', steel: '#aab4c0', parts: '#c9a227', chips: '#2bb3b3' };
const WATER_JOBS = new Set(['farm', 'gatherer', 'garden', 'greenhouse', 'vertifarm']);
const FISH_JOBS = new Set(['fisher', 'harbor']);
const SEASON_LOOK = {
  spring: { leaf: '#7ccf6a', leaf2: '#f2a7c3', grass: '#7fcf6a', tiles: ['#93d77c', '#a5df8f', '#7dc56a'] },
  summer: { leaf: '#5fae5a', leaf2: '#4a9852', grass: '#6bb35d', tiles: ['#8ccd74', '#9fd889', '#74bb63'] },
  autumn: { leaf: '#e08a2e', leaf2: '#c4532d', grass: '#9cb55a', tiles: ['#a9bd66', '#b9c977', '#93a854'] },
  winter: { leaf: '#e9eef2', leaf2: '#cfd8de', grass: '#dfe8ec', tiles: ['#e4ecef', '#eef3f5', '#d6e0e4'] },
};

export async function createWorld(stage, overlay, opts) {
  let T;
  let OrbitControls;
  try {
    T = await import('three');
    ({ OrbitControls } = await import('three/addons/controls/OrbitControls.js'));
  } catch (err) {
    console.warn('BotWorld: could not load three.js', err);
    return fallback(stage, 'The 3D world could not load. Check the internet connection or run npm install.');
  }
  initMeshes(T);
  const now = opts.now;
  const clockNow = () => (opts.clock ? opts.clock() : Date.now());
  const rand = Math.random;
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const still = !opts.stream && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const low = opts.quality === 'low';
  const audio = createAudio();
  const data = { builders: new Map(), jobs: new Map(), econ: null, event: null };
  mats.path = std(0xdccfb2);
  mats.mountain = std(0x8c867f);
  mats.snow = std(0xf3f6f8);
  mats.bush = std(0x4f8f45);
  mats.berry = std(0xd23a55);
  mats.coalOre = std(0x26272b, { roughness: 0.5 });
  mats.ironOre = std(0xa65a35, { roughness: 0.6, metalness: 0.2 });
  mats.ruin = std(0xcfc6b3);
  mats.neonGlow = new T.SpriteMaterial({ map: glowTexture(), color: 0x5ef2ff, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending });
  const crateMats = Object.fromEntries(Object.entries(RES_COLORS).map(([r, c]) => [r, std(c)]));

  let renderer;
  try {
    renderer = new T.WebGLRenderer({ antialias: !low, alpha: true, powerPreference: 'high-performance' });
  } catch (err) {
    console.warn('BotWorld: no WebGL', err);
    return fallback(stage, 'This browser cannot draw 3D (WebGL is off).');
  }
  renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = !low;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  stage.append(renderer.domElement);
  // A 24/7 stream must survive a GPU hiccup: start over instead of freezing.
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    setTimeout(() => location.reload(), 3000);
  });

  const scene = new T.Scene();
  scene.fog = new T.Fog(0xf8e6cd, 30, 90);
  // A near plane not too close keeps depth precise even on 16 bit depth buffers.
  const camera = new T.PerspectiveCamera(34, 1, 0.3, 400);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = !still;
  controls.dampingFactor = 0.08;
  controls.minPolarAngle = 0.3;
  controls.maxPolarAngle = 1.25;
  controls.minDistance = 1.2;
  controls.maxDistance = 60;
  controls.screenSpacePanning = false;
  controls.autoRotateSpeed = 0.25;
  controls.touches = { ONE: T.TOUCH.PAN, TWO: T.TOUCH.DOLLY_ROTATE };
  controls.mouseButtons = { LEFT: T.MOUSE.PAN, MIDDLE: T.MOUSE.DOLLY, RIGHT: T.MOUSE.ROTATE };
  controls.enabled = !opts.stream;
  controls.addEventListener('change', clampTarget);
  const raycaster = new T.Raycaster();
  const clock = new T.Clock();

  const hemi = new T.HemisphereLight(0xc4e6f6, 0xc7a676, 1.7);
  const sun = new T.DirectionalLight(0xfff0d4, 2.6);
  sun.castShadow = !low;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  const flash = new T.AmbientLight(0xdfe8ff, 0);
  scene.add(hemi, sun, sun.target, flash);
  const water = new T.Mesh(new T.CircleGeometry(R * SQ3 * (MAP_RADIUS + 1.5), 96), mats.water);
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.1;
  scene.add(water);
  const stars = makeStars();
  scene.add(stars);
  const moon = mesh(new T.SphereGeometry(2.2, 20, 14), new T.MeshBasicMaterial({ color: 0xf3f0dc, fog: false }), -60, 55, -90, scene);
  const rainLines = makeRain();
  scene.add(rainLines);
  const buildGroup = new T.Group();
  const botGroup = new T.Group();
  const fxGroup = new T.Group();
  const critterGroup = new T.Group();
  scene.add(buildGroup, botGroup, fxGroup, critterGroup);

  const TILE_COLORS = { dirt: new T.Color('#b48d5f'), plaza: new T.Color('#cfd6df') };
  let era = 0;
  const look = () => ERAS[era].look;

  // --- Hex helpers -------------------------------------------------------------
  const hexToWorld = (q, r) => ({ x: R * SQ3 * (q + r / 2), z: R * 1.5 * r });
  function tileAtPoint(x, z) {
    const qf = ((SQ3 / 3) * x - z / 3) / R;
    const rf = ((2 / 3) * z) / R;
    let q = Math.round(qf);
    let r = Math.round(rf);
    const s = Math.round(-qf - rf);
    const dq = Math.abs(q - qf);
    const dr = Math.abs(r - rf);
    const ds = Math.abs(s + qf + rf);
    if (dq > dr && dq > ds) q = -r - s;
    else if (dr > ds) r = -q - s;
    return layout.index.get(q + ',' + r) || null;
  }

  // --- The world: terrain, fog, roads ---------------------------------------------------
  // Every tile of the map is drawn once, as two instanced hex prisms: a base
  // (its edge shows as a road in town, a seam in the wild, the owner's colour
  // round a home) and a top slab in the colour of the land. Land nobody has
  // explored yet is drawn as flat dark fog, and lifts into view when a scout
  // or a new building reveals it.
  const LAND = {
    deep: { top: -0.34, c: '#2f6f9f' }, water: { top: -0.24, c: '#4d93c2' }, river: { top: -0.18, c: '#5ba7d1' },
    sand: { top: 0.06, c: '#e6d39a' }, grass: { top: TILE_TOP, c: '#8ccd74' }, meadow: { top: TILE_TOP, c: '#a8c86a' },
    forest: { top: TILE_TOP, c: '#5f9f53' }, hills: { top: 0.11, c: '#b3a586' }, mountain: { top: 0.13, c: '#8f8a84' },
  };
  const BASE_TOP = PATH_TOP;
  const FOG = { edge: C3('#5e6878'), mid: C3('#434b59'), deep: C3('#2c323d') };
  function C3(hex) { return new T.Color(hex); }
  const landColor = {};
  for (const [k, v] of Object.entries(LAND)) landColor[k] = new T.Color(v.c);
  const layout = { map: null, seed: null, tiles: [], index: new Map(), extent: 6, knownR: 6, townR: 3, pierEnd: null, railR: 0, seaAngle: 0, coastD: 0, townTiles: [] };
  let known = new Uint8Array(0);
  let world = null;
  let baseMesh = null;
  let topMesh = null;
  let ship = null;
  let lampGroup = null;
  let poiGroup = null;
  let framed = false;
  const nav = { nodes: [], adj: [], keys: new Map(), door: -1, town: [] };
  let beachPois = [];
  let buildPois = [];
  const poiUser = new Map();
  const reveals = [];
  const decor = { meshes: [], byTile: new Map() };
  const isWater = (t) => !!t && (t.t === 'deep' || t.t === 'water' || t.t === 'river');
  const walkTile = (t) => !!t && TERRAIN[t.t] && (TERRAIN[t.t].land || TERRAIN[t.t].ford);

  function buildWorld(mapInfo, exploredHex) {
    if (world) {
      scene.remove(world);
      baseMesh.dispose();
      topMesh.dispose();
      for (const d of decor.meshes) d.dispose();
    }
    world = new T.Group();
    scene.add(world);
    const map = makeMap(mapInfo.seed, mapInfo.cleared || []);
    layout.map = map;
    layout.seed = mapInfo.seed;
    layout.seaAngle = map.seaAngle;
    layout.tiles = map.tiles.map((m) => {
      const p = hexToWorld(m.q, m.r);
      return { i: m.i, q: m.q, r: m.r, d: m.d, ring: m.d, t: m.t, f: m.f, x: p.x, z: p.z, top: LAND[m.t].top, k: 0 };
    });
    layout.index.clear();
    for (const t of layout.tiles) layout.index.set(t.q + ',' + t.r, t);
    const bits = decodeBits(exploredHex || '', map);
    known = new Uint8Array(map.total);
    for (let i = 0; i < map.total; i++) known[i] = isExplored(bits, i) ? 1 : 0;
    for (const t of layout.tiles) t.k = known[t.i];
    // The world goes on beyond the map, lost in the fog.
    const outer = mesh(new T.RingGeometry(R * SQ3 * (MAP_RADIUS + 0.4), 420, 96, 1), new T.MeshStandardMaterial({ color: FOG.deep, roughness: 1 }), 0, BASE_TOP - 0.002, 0, world);
    outer.rotation.x = -Math.PI / 2;
    const n = layout.tiles.length;
    baseMesh = new T.InstancedMesh(geo('baseHex', () => new T.CylinderGeometry(R, R, 1, 6).translate(0, -0.5, 0)), mats.tile, n);
    topMesh = new T.InstancedMesh(geo('topHex', () => new T.CylinderGeometry(R * 0.9, R * 0.93, 1, 6).translate(0, -0.5, 0)), mats.tile, n);
    baseMesh.receiveShadow = true;
    topMesh.receiveShadow = true;
    world.add(baseMesh, topMesh);
    mesh(geo('pad', () => new T.CylinderGeometry(R * 0.92, R * 0.92, TILE_TOP - PATH_TOP + 0.006, 6)), mats.pad, 0, (PATH_TOP + TILE_TOP) / 2 + 0.003, 0, world).receiveShadow = true;
    const mark = mesh(geo('padRing', () => new T.RingGeometry(R * 0.55, R * 0.6, 48)), mats.padMark, 0, TILE_TOP + 0.008, 0, world);
    mark.rotation.x = -Math.PI / 2;
    ship = { g: shipMesh(), hopT: 1, amp: 0 };
    ship.g.position.y = TILE_TOP;
    world.add(ship.g);
    buildDecor();
    poiGroup = new T.Group();
    lampGroup = new T.Group();
    world.add(poiGroup, lampGroup);
    afterExplore(true);
    if (!framed) { frameCamera(); framed = true; }
    for (const p of [...porters]) removePorter(p);
    train = null;
    makeCritters();
    updateSky();
  }

  // Everything that depends on what is explored: the town size, paths, the
  // pier and benches, the camera limits.
  function updateTownSize() {
    let far = START_RADIUS;
    let knownFar = START_RADIUS;
    for (const t of layout.tiles) if (known[t.i]) knownFar = Math.max(knownFar, t.d);
    for (const v of builds.values()) far = Math.max(far, hexDist(v.b.q, v.b.r) + 2);
    layout.extent = Math.min(MAP_RADIUS, far);
    layout.knownR = knownFar;
    layout.townR = (Math.max(3, far - 1) * SQ3 + 1) * R;
    layout.railR = Math.max(3, far - 1.4) * SQ3 * R;
    layout.townTiles = layout.tiles.filter((t) => known[t.i] && walkTile(t) && t.d <= layout.extent);
  }
  function afterExplore(full) {
    updateTownSize();
    let coast = null;
    for (const t of layout.tiles) {
      if (!known[t.i] || !isWater(t) || t.t === 'river') continue;
      if (!coast || t.d < coast.d) coast = t;
    }
    layout.coastD = coast ? Math.hypot(coast.x, coast.z) : 0;
    buildNav();
    buildBeach();
    rebuildLamps();
    refreshTiles();
    refreshPois();
    // Node numbers changed: every bot finds its feet again and carries on.
    for (const p of [...porters]) removePorter(p);
    for (const b of bots.values()) { const walking = b.mode === 'walk' || b.mode === 'job'; resnap(b); if (walking || full) b.timer = 0.05; }
    syncTrain();
    updateView();
    renderer.shadowMap.needsUpdate = true;
  }

  // Tiles next to a building are town: their edges are roads.
  function townSet() {
    const s = new Set();
    for (const t of layout.tiles) if (t.d <= 2) s.add(t.i);
    for (const v of builds.values()) {
      const c = layout.index.get(v.b.q + ',' + v.b.r);
      if (!c) continue;
      s.add(c.i);
      for (const [dq, dr] of DIRS) {
        const nb = layout.index.get(c.q + dq + ',' + (c.r + dr));
        if (nb && walkTile(nb)) s.add(nb.i);
      }
    }
    return s;
  }
  function fogShade(t) {
    let best = 9;
    for (let rad = 1; rad <= 2 && best > rad; rad++) {
      for (const [dq, dr] of rad === 1 ? DIRS : RING2) {
        const nb = layout.index.get(t.q + dq + ',' + (t.r + dr));
        if (nb && known[nb.i]) { best = rad; break; }
      }
    }
    return best === 1 ? FOG.edge : best === 2 ? FOG.mid : FOG.deep;
  }
  const tmpC = new T.Color();
  const tmpM = new T.Matrix4();
  const tmpQ = new T.Quaternion();
  const tmpS = new T.Vector3();
  const tmpP = new T.Vector3();
  function seasonColor(t) {
    const L = SEASON_LOOK[season] || SEASON_LOOK.summer;
    if (t.t === 'grass') return tmpC.set(L.tiles[0]);
    if (t.t === 'meadow') return tmpC.set(L.tiles[1]).lerp(landColor.meadow, 0.5);
    if (t.t === 'forest') return tmpC.set(L.tiles[2]).multiplyScalar(0.82);
    if (season === 'winter' && (t.t === 'hills' || t.t === 'sand')) return tmpC.copy(landColor[t.t]).lerp(C3('#eef3f5'), 0.55);
    return tmpC.copy(landColor[t.t]);
  }
  // Draws one tile: k is how far it has risen out of the fog (0 to 1).
  function drawTile(t, town, homes, at) {
    const k = t.k;
    const real = LAND[t.t].top;
    const water = isWater(t);
    // Fog is one flat, even surface; explored land rises (or water sinks) out of it.
    const top = k >= 1 ? real : BASE_TOP + (real - BASE_TOP) * k;
    const baseTop = water ? top : BASE_TOP;
    tmpM.compose(tmpP.set(t.x, baseTop, t.z), tmpQ, tmpS.set(1, baseTop + 0.7, 1));
    baseMesh.setMatrixAt(t.i, tmpM);
    const slab = water ? 0.0001 : Math.max(0.0001, top - BASE_TOP);
    tmpM.compose(tmpP.set(t.x, water ? top - 0.0001 : top, t.z), tmpQ, tmpS.set(1, slab, 1));
    topMesh.setMatrixAt(t.i, tmpM);
    const fog = fogShade(t);
    // Base: road in town, owner colour round a home, a darker seam elsewhere.
    let base;
    const h = homes.get(t.i);
    if (h) base = tmpC.set(h);
    else if (water) base = seasonColor(t).multiplyScalar(0.8);
    else if (town.has(t.i) && t.t !== 'mountain') base = tmpC.copy(mats.path.color);
    else base = seasonColor(t).multiplyScalar(0.84);
    baseMesh.setColorAt(t.i, k >= 1 ? base : base.clone().lerp(fog, 1 - k));
    let c = t.d === 1 ? TILE_COLORS.plaza.clone() : seasonColor(t).clone();
    const b = at.get(t.i);
    if (b && b.status === 'building' && !b.built && !b.wonder) c = TILE_COLORS.dirt.clone();
    topMesh.setColorAt(t.i, k >= 1 ? c : c.lerp(fog, 1 - k));
  }
  function refreshTiles() {
    if (!topMesh) return;
    const town = townSet();
    const homes = new Map();
    const at = new Map();
    for (const v of builds.values()) {
      const t = layout.index.get(v.b.q + ',' + v.b.r);
      if (!t) continue;
      at.set(t.i, v.b);
      if (v.b.home) homes.set(t.i, (data.builders.get(v.b.ownerId) || {}).color || '#3b7ddd');
    }
    for (const t of layout.tiles) {
      drawTile(t, town, homes, at);
      setDecor(t, at.has(t.i) ? 0 : t.k);
    }
    baseMesh.instanceMatrix.needsUpdate = true;
    topMesh.instanceMatrix.needsUpdate = true;
    baseMesh.instanceColor.needsUpdate = true;
    topMesh.instanceColor.needsUpdate = true;
    for (const d of decor.meshes) d.instanceMatrix.needsUpdate = true;
    renderer.shadowMap.needsUpdate = true;
  }
  // Newly explored tiles rise out of the fog over a second.
  function revealTiles(list, animate) {
    for (const i of list) {
      if (known[i]) continue;
      known[i] = 1;
      const t = layout.tiles[i];
      if (!t) continue;
      if (animate && !still) { t.k = 0.001; reveals.push(t); } else t.k = 1;
    }
    afterExplore(false);
  }
  function stepReveals(dt) {
    if (!reveals.length) return;
    for (let i = reveals.length - 1; i >= 0; i--) {
      const t = reveals[i];
      t.k = Math.min(1, t.k + dt / 1.1);
      if (t.k >= 1) reveals.splice(i, 1);
    }
    refreshTiles();
  }

  // Trees in the forests, rocks on the hills, peaks with snow, berry bushes,
  // ore, ruins and old stones, all instanced: thousands of them in a few draws.
  function buildDecor() {
    decor.meshes = [];
    decor.byTile.clear();
    const kinds = {
      trunk: { g: () => new T.CylinderGeometry(0.025, 0.035, 0.16, 5).translate(0, 0.08, 0), m: mats.trunk, list: [] },
      pine: { g: () => new T.ConeGeometry(0.15, 0.4, 7).translate(0, 0.34, 0), m: mats.leaf2, list: [] },
      crown: { g: () => new T.DodecahedronGeometry(0.15, 0).translate(0, 0.28, 0), m: mats.leaf, list: [] },
      rock: { g: () => new T.DodecahedronGeometry(0.1, 0), m: mats.rock, list: [] },
      peak: { g: () => new T.ConeGeometry(R * 0.82, 0.8, 7).translate(0, 0.4, 0), m: mats.mountain, list: [] },
      snow: { g: () => new T.ConeGeometry(R * 0.3, 0.3, 7).translate(0, 0.66, 0), m: mats.snow, list: [] },
      bush: { g: () => new T.DodecahedronGeometry(0.075, 0).translate(0, 0.06, 0), m: mats.bush, list: [] },
      berry: { g: () => new T.SphereGeometry(0.022, 5, 4), m: mats.berry, list: [] },
      coal: { g: () => new T.DodecahedronGeometry(0.06, 0), m: mats.coalOre, list: [] },
      iron: { g: () => new T.DodecahedronGeometry(0.06, 0), m: mats.ironOre, list: [] },
      column: { g: () => new T.CylinderGeometry(0.035, 0.04, 1, 6).translate(0, 0.5, 0), m: mats.ruin, list: [] },
      slab: { g: () => new T.BoxGeometry(0.13, 0.22, 0.045).translate(0, 0.11, 0), m: mats.ruin, list: [] },
      reed: { g: () => new T.ConeGeometry(0.018, 0.16, 4).translate(0, 0.08, 0), m: mats.leaf2, list: [] },
    };
    const add = (t, kind, x, y, z, s, sy, ry) => {
      kinds[kind].list.push({ t, x, y, z, s, sy: sy || s, ry: ry || 0 });
    };
    for (const t of layout.tiles) {
      const r = rng(hashStr('d' + layout.seed + ':' + t.i));
      const top = LAND[t.t].top;
      const jit = (a) => (r() - 0.5) * a;
      if (t.t === 'forest') {
        for (let j = 0; j < 3; j++) {
          const x = t.x + jit(0.62);
          const z = t.z + jit(0.62);
          const s = 0.8 + r() * 0.5;
          add(t, 'trunk', x, top, z, s);
          add(t, r() < 0.55 ? 'pine' : 'crown', x, top, z, s, s, r() * 6);
        }
      } else if (t.t === 'grass' && t.d > 3 && r() < 0.07) {
        const x = t.x + jit(0.4);
        const z = t.z + jit(0.4);
        add(t, 'trunk', x, top, z, 0.9);
        add(t, 'crown', x, top, z, 0.9, 0.9, r() * 6);
      } else if (t.t === 'hills') {
        const n = 2 + Math.floor(r() * 2);
        for (let j = 0; j < n; j++) add(t, 'rock', t.x + jit(0.6), top + 0.03, t.z + jit(0.6), 0.8 + r() * 0.9, 0.6 + r() * 0.5, r() * 6);
      } else if (t.t === 'mountain') {
        const s = 0.85 + r() * 0.4;
        add(t, 'peak', t.x + jit(0.1), top, t.z + jit(0.1), 1, s, r() * 6);
        add(t, 'snow', t.x, top, t.z, 1, s, 0);
      } else if (t.t === 'meadow') {
        for (let j = 0; j < 3; j++) {
          const x = t.x + jit(0.6);
          const z = t.z + jit(0.6);
          add(t, 'bush', x, top, z, 0.9 + r() * 0.5);
          add(t, 'berry', x + 0.03, top + 0.1, z + 0.02, 1);
          add(t, 'berry', x - 0.04, top + 0.08, z - 0.01, 1);
        }
      } else if (t.t === 'sand' && r() < 0.3) {
        add(t, 'rock', t.x + jit(0.5), top + 0.02, t.z + jit(0.5), 0.6, 0.4, r() * 6);
      } else if (t.t === 'river' && r() < 0.5) {
        for (let j = 0; j < 3; j++) add(t, 'reed', t.x + jit(0.8), top, t.z + jit(0.8), 1);
      }
      if (t.f === 'coal' || t.f === 'iron') {
        for (let j = 0; j < 3; j++) add(t, t.f, t.x + jit(0.5), top + 0.04, t.z + jit(0.5), 0.8 + r() * 0.6, 0.7, r() * 6);
      } else if (t.f === 'ruins') {
        for (let j = 0; j < 4; j++) add(t, 'column', t.x + jit(0.55), top, t.z + jit(0.55), 1, 0.08 + r() * 0.2, 0);
        add(t, 'slab', t.x + jit(0.3), top, t.z + jit(0.3), 1, 0.4, r() * 6);
      } else if (t.f === 'tablet') {
        add(t, 'slab', t.x, top, t.z, 1, 1, r() * 6);
      }
    }
    for (const [name, kd] of Object.entries(kinds)) {
      if (!kd.list.length) continue;
      const im = new T.InstancedMesh(geo('decor:' + name, kd.g), kd.m, kd.list.length);
      im.castShadow = name !== 'reed' && name !== 'berry';
      im.receiveShadow = name === 'peak';
      kd.list.forEach((e, idx) => {
        e.mesh = im;
        e.idx = idx;
        if (!decor.byTile.has(e.t.i)) decor.byTile.set(e.t.i, []);
        decor.byTile.get(e.t.i).push(e);
      });
      decor.meshes.push(im);
      world.add(im);
    }
    for (const t of layout.tiles) setDecor(t, t.k);
  }
  const decorShown = new Map();
  function setDecor(t, k) {
    const list = decor.byTile.get(t.i);
    if (!list) return;
    const kk = k >= 1 ? 1 : k;
    if (decorShown.get(t.i) === kk) return;
    decorShown.set(t.i, kk);
    for (const e of list) {
      tmpQ.setFromAxisAngle(UP, e.ry);
      tmpM.compose(tmpP.set(e.x, e.y, e.z), tmpQ, tmpS.set(e.s * kk + 1e-4, e.sy * kk + 1e-4, e.s * kk + 1e-4));
      e.mesh.setMatrixAt(e.idx, tmpM);
    }
  }
  const UP = new T.Vector3(0, 1, 0);

  // --- Paths: every hex corner is a crossing, every hex edge a lane -----------------
  const cornerKey = (x, z) => Math.round(x * 400) + ':' + Math.round(z * 400);
  function cornerPos(t, k) {
    const a = Math.PI / 6 + (k * Math.PI) / 3;
    return { x: t.x + Math.cos(a) * R, z: t.z + Math.sin(a) * R };
  }
  function cornerNode(t, k) {
    const p = cornerPos(t, k);
    const i = nav.keys.get(cornerKey(p.x, p.z));
    return i == null ? -1 : i;
  }
  function addNode(x, z, y, kind) {
    nav.nodes.push({ x, z, y, kind });
    nav.adj.push([]);
    return nav.nodes.length - 1;
  }
  function link(a, b) {
    if (a === b || a < 0 || b < 0 || nav.adj[a].some((e) => e[0] === b)) return;
    const d = Math.hypot(nav.nodes[a].x - nav.nodes[b].x, nav.nodes[a].z - nav.nodes[b].z);
    nav.adj[a].push([b, d]);
    nav.adj[b].push([a, d]);
  }
  // Bots walk along the edges of land they know, and one step into the fog
  // (that is how scouts go exploring).
  function buildNav() {
    nav.nodes = [];
    nav.adj = [];
    nav.keys.clear();
    nav.town = [];
    const near = (t) => known[t.i] || DIRS.some(([dq, dr]) => { const nb = layout.index.get(t.q + dq + ',' + (t.r + dr)); return nb && known[nb.i]; });
    const walk = layout.tiles.filter((t) => walkTile(t) && near(t));
    for (const t of walk) {
      for (let k = 0; k < 6; k++) {
        const p = cornerPos(t, k);
        const key = cornerKey(p.x, p.z);
        if (!nav.keys.has(key)) {
          const i = addNode(p.x, p.z, PATH_TOP, 'corner');
          nav.keys.set(key, i);
          if (known[t.i] && Math.hypot(p.x, p.z) < layout.townR + R * 2) nav.town.push(i);
        }
      }
    }
    for (const t of walk) for (let k = 0; k < 6; k++) link(cornerNode(t, k), cornerNode(t, (k + 1) % 6));
    nav.door = cornerNode(layout.tiles[0], 1);
  }
  function nearestNode(x, z) {
    let best = 0;
    let bd = Infinity;
    nav.nodes.forEach((n, i) => {
      if (n.kind === 'poi') return;
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }
  function astar(start, goal) {
    if (start === goal) return [start];
    const N = nav.nodes.length;
    if (start < 0 || goal < 0 || start >= N || goal >= N) return null;
    const g = new Float64Array(N).fill(Infinity);
    const from = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const gx = nav.nodes[goal].x;
    const gz = nav.nodes[goal].z;
    const H = (i) => Math.hypot(nav.nodes[i].x - gx, nav.nodes[i].z - gz);
    const heap = [[H(start), start]];
    g[start] = 0;
    let steps = 0;
    while (heap.length && steps++ < 20000) {
      const cur = heapPop(heap)[1];
      if (closed[cur]) continue;
      if (cur === goal) {
        const path = [cur];
        while (from[path[0]] >= 0) path.unshift(from[path[0]]);
        return path;
      }
      closed[cur] = 1;
      for (const [nb, d] of nav.adj[cur]) {
        if (closed[nb]) continue;
        const ng = g[cur] + d;
        if (ng < g[nb]) { g[nb] = ng; from[nb] = cur; heapPush(heap, [ng + H(nb), nb]); }
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

  // --- The shore: a pier and benches where the land meets the water ------------------
  function buildBeach() {
    beachPois = [];
    poiGroup.clear();
    layout.pierEnd = null;
    const faceTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
    const poi = (id, x, z, y, yaw, pose, parentNode) => {
      const node = addNode(x, z, y, 'poi');
      link(node, parentNode);
      beachPois.push({ id, node, x, z, y, yaw, pose, night: false });
    };
    // Coast tiles near town: land with known water next to it.
    const coast = [];
    for (const t of layout.tiles) {
      if (!known[t.i] || !walkTile(t) || t.t === 'river' || t.d < 2) continue;
      const wet = DIRS.map(([dq, dr]) => layout.index.get(t.q + dq + ',' + (t.r + dr))).find((nb) => nb && known[nb.i] && (nb.t === 'deep' || nb.t === 'water'));
      if (wet) coast.push({ t, wet });
    }
    coast.sort((a, b) => a.t.d - b.t.d);
    const taken = new Set([...builds.values()].map((v) => v.b.q + ',' + v.b.r));
    const free = coast.filter((c) => !taken.has(c.t.q + ',' + c.t.r));
    const pier = free[0];
    if (pier) {
      const { t, wet } = pier;
      const dir = Math.atan2(wet.z - t.z, wet.x - t.x);
      const at = (dist) => ({ x: t.x + Math.cos(dir) * dist, z: t.z + Math.sin(dir) * dist });
      const len = 2.1;
      const mid = at(R * 0.4 + len / 2);
      const g = new T.Group();
      g.position.set(mid.x, 0, mid.z);
      g.rotation.y = Math.atan2(Math.cos(dir), Math.sin(dir));
      mesh(geo('pierDeck', () => new T.BoxGeometry(0.36, 0.04, 2.1)), mats.wood, 0, 0.06, 0, g);
      for (const s of [-1, 1]) for (const zz of [-0.8, -0.2, 0.4, 1.0]) mesh(geo('pierPost', () => new T.CylinderGeometry(0.025, 0.025, 0.6, 6)), mats.woodDark, s * 0.17, -0.22, zz, g);
      g.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; o.castShadow = true; } });
      poiGroup.add(g);
      const start = at(R * 0.5);
      const n0 = addNode(start.x, start.z, 0.08, 'pier');
      link(n0, nearestNode(t.x, t.z));
      const e1 = at(R * 0.4 + len - 0.2);
      poi('pier1', e1.x, e1.z, 0.08, faceTo(e1, at(len * 2)), 'fish', n0);
      const e2 = at(R * 0.4 + len - 0.6);
      poi('pier2', e2.x + Math.sin(dir) * 0.08, e2.z - Math.cos(dir) * 0.08, 0.08, faceTo(e1, at(len * 2)), 'fish', n0);
      layout.pierEnd = at(R * 0.4 + len + 0.5);
    }
    free.slice(1, 4).forEach(({ t, wet }, i) => {
      const dir = Math.atan2(wet.z - t.z, wet.x - t.x);
      const p = { x: t.x + Math.cos(dir) * R * 0.45, z: t.z + Math.sin(dir) * R * 0.45 };
      const g = benchMesh();
      g.position.set(p.x, TILE_TOP, p.z);
      g.rotation.y = Math.atan2(Math.cos(dir), Math.sin(dir));
      poiGroup.add(g);
      const node = nearestNode(p.x, p.z);
      for (const off of [-0.09, 0.09]) poi('bench' + i + off, p.x - Math.sin(dir) * off, p.z + Math.cos(dir) * off, TILE_TOP, g.rotation.y, 'sit', node);
    });
    for (const k of [0, 2, 3, 5]) {
      const node = cornerNode(layout.tiles[0], k);
      if (node < 0) continue;
      const nd = nav.nodes[node];
      beachPois.push({ id: 'plaza' + k, node, x: nd.x, z: nd.z, y: PATH_TOP, yaw: Math.atan2(nd.x, nd.z), pose: 'look', night: false, plaza: true });
    }
  }

  // --- Street lights change with the era: torches, lanterns, gas, electric, neon -----
  function lampFor(style) {
    const g = new T.Group();
    const glow = (y, m = mats.glow, s = 0.7) => {
      const sp = new T.Sprite(m);
      sp.position.set(0, y, 0);
      sp.scale.set(s, s, 1);
      g.add(sp);
    };
    if (style === 'torch') {
      mesh(geo('torchPole', () => new T.CylinderGeometry(0.012, 0.016, 0.42, 5)), mats.woodDark, 0, 0.21, 0, g);
      mesh(geo('torchCup', () => new T.CylinderGeometry(0.03, 0.02, 0.05, 6)), mats.wood, 0, 0.43, 0, g);
      mesh(geo('torchFlame', () => new T.ConeGeometry(0.025, 0.08, 6)), mats.flame, 0, 0.49, 0, g);
      glow(0.49, mats.fireGlow, 0.6);
    } else if (style === 'lantern') {
      mesh(geo('lanternPost', () => new T.CylinderGeometry(0.014, 0.018, 0.5, 6)), mats.woodDark, 0, 0.25, 0, g);
      mesh(geo('lanternBox', () => new T.BoxGeometry(0.06, 0.07, 0.06)), mats.lamp, 0, 0.53, 0, g);
      mesh(geo('lanternCap', () => new T.ConeGeometry(0.05, 0.04, 4)), mats.black, 0, 0.585, 0, g).rotation.y = Math.PI / 4;
      glow(0.53);
    } else if (style === 'gas') {
      mesh(geo('gasPost', () => new T.CylinderGeometry(0.01, 0.018, 0.6, 6)), mats.darkMetal, 0, 0.3, 0, g);
      mesh(geo('gasHead', () => new T.CylinderGeometry(0.04, 0.025, 0.07, 6)), mats.lamp, 0, 0.63, 0, g);
      mesh(geo('gasCap', () => new T.ConeGeometry(0.05, 0.04, 6)), mats.darkMetal, 0, 0.685, 0, g);
      glow(0.63);
    } else if (style === 'electric') {
      mesh(geo('elecPost', () => new T.CylinderGeometry(0.01, 0.014, 0.78, 6)), mats.metal, 0, 0.39, 0, g);
      mesh(geo('elecArm', () => new T.BoxGeometry(0.16, 0.012, 0.012)), mats.metal, 0.07, 0.77, 0, g);
      mesh(geo('elecHead', () => new T.BoxGeometry(0.07, 0.02, 0.04)), mats.lamp, 0.14, 0.76, 0, g);
      const sp = new T.Sprite(mats.glow);
      sp.position.set(0.14, 0.74, 0);
      sp.scale.set(0.8, 0.8, 1);
      g.add(sp);
    } else {
      mesh(geo('neonPost', () => new T.CylinderGeometry(0.01, 0.014, 0.66, 8)), mats.whiteGloss, 0, 0.33, 0, g);
      mesh(geo('neonRing', () => new T.TorusGeometry(0.05, 0.01, 6, 16)), mats.neonCyan, 0, 0.68, 0, g);
      glow(0.68, mats.neonGlow, 0.8);
    }
    return g;
  }
  // Street lights stand on street corners next to buildings, nearest the
  // middle of town first.
  function rebuildLamps() {
    if (!lampGroup || !layout.tiles.length) return;
    lampGroup.clear();
    const spots = [];
    const seen = new Set();
    const addCorner = (t, k) => {
      const node = cornerNode(t, k);
      if (node < 0 || seen.has(node)) return;
      seen.add(node);
      spots.push(nav.nodes[node]);
    };
    for (const k of [0, 2, 4]) for (const [dq, dr] of DIRS) { const t = layout.index.get(dq * 2 + ',' + dr * 2); if (t) addCorner(t, k); }
    for (const v of builds.values()) {
      if (!v.b.built || v.b.wonder) continue;
      const t = layout.index.get(v.b.q + ',' + v.b.r);
      if (t) addCorner(t, hashStr('l' + v.b.id) % 6);
    }
    spots.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
    for (const n of spots.slice(0, low ? 18 : 32)) {
      const l = lampFor(look().lamp);
      l.position.set(n.x, 0, n.z);
      lampGroup.add(l);
    }
    renderer.shadowMap.needsUpdate = true;
  }

  // --- The train: a ring of rails along the beach once a station is built -------------
  let train = null;
  function syncTrain() {
    if (!world) return;
    const built = [...builds.values()].filter((v) => v.b.built && ITEMS[v.b.item]?.train);
    const style = built.some((v) => v.b.item === 'maglev') ? 'maglev' : built.length ? 'steam' : null;
    if (train && train.style === style) return;
    if (train) world.remove(train.g);
    train = null;
    if (!style) return;
    const g = new T.Group();
    const rr = layout.railR;
    for (const off of [-0.035, 0.035]) {
      const rail = mesh(new T.TorusGeometry(rr + off, style === 'maglev' ? 0.012 : 0.007, 4, 180), style === 'maglev' ? mats.neonCyan : mats.rail, 0, 0.012, 0, g);
      rail.rotation.x = Math.PI / 2;
    }
    const cars = [];
    for (let i = 0; i < 4; i++) {
      const c = new T.Group();
      if (style === 'steam') {
        if (i === 0) {
          mesh(geo('locoBoiler', () => new T.CylinderGeometry(0.045, 0.045, 0.2, 10)), mats.black, 0, 0.08, 0.02, c).rotation.x = Math.PI / 2;
          mesh(geo('locoCab', () => new T.BoxGeometry(0.1, 0.1, 0.08)), mats.shipRed, 0, 0.09, -0.1, c);
          mesh(geo('locoStack', () => new T.CylinderGeometry(0.018, 0.012, 0.06, 8)), mats.black, 0, 0.15, 0.08, c);
        } else mesh(geo('wagon', () => new T.BoxGeometry(0.1, 0.08, 0.22)), [mats.wood, mats.brick, mats.darkMetal][i % 3], 0, 0.07, 0, c);
        mesh(geo('chassis', () => new T.BoxGeometry(0.1, 0.02, 0.24)), mats.black, 0, 0.025, 0, c);
      } else {
        mesh(geo('magCar', () => new T.CapsuleGeometry(0.05, 0.2, 4, 10)), mats.whiteGloss, 0, 0.07, 0, c).rotation.x = Math.PI / 2;
        mesh(geo('magStripe', () => new T.BoxGeometry(0.102, 0.012, 0.2)), mats.neonCyan, 0, 0.07, 0, c);
      }
      g.add(c);
      cars.push(c);
    }
    world.add(g);
    train = { g, cars, style, a: rand() * Math.PI * 2, puff: 0 };
  }
  function stepTrain(dt) {
    if (!train) return;
    const rr = layout.railR;
    const speed = train.style === 'maglev' ? 0.22 : 0.09;
    train.a += (dt * speed * 4) / rr;
    train.cars.forEach((c, i) => {
      const a = train.a - (i * 0.27) / rr;
      c.position.set(Math.cos(a) * rr, train.style === 'maglev' ? 0.03 + Math.sin(performance.now() / 300 + i) * 0.005 : 0, Math.sin(a) * rr);
      c.rotation.y = -a;
    });
    if (train.style === 'steam' && !still) {
      train.puff -= dt;
      if (train.puff <= 0) {
        train.puff = 0.5;
        const c = train.cars[0].position;
        burst({ x: c.x, y: 0.2, z: c.z, count: 8, colors: ['#f1f1f1', '#d6d6d6'], speed: 0.1, life: 1.8, size: 0.08, gravity: -0.3, up: 1, grow: 0.06 });
      }
    }
  }

  // --- Builds ------------------------------------------------------------------------
  const builds = new Map();
  const tileOf = (b) => layout.index.get(b.q + ',' + b.r) || null;
  // The two corners on the side that faces the landing pad: doors face the
  // middle of the island, so that is where bots stand to work or shop.
  function frontCorners(t) {
    if (t.ring === 0) return [1, 0];
    const af = Math.atan2(-t.z, -t.x);
    const ks = [0, 1, 2, 3, 4, 5]
      .map((k) => {
        const a = Math.PI / 6 + (k * Math.PI) / 3;
        return [Math.abs(Math.atan2(Math.sin(a - af), Math.cos(a - af))), k];
      })
      .sort((x, y) => x[0] - y[0]);
    return [ks[0][1], ks[1][1]];
  }
  function spotAt(t, k, inward) {
    const node = cornerNode(t, k);
    if (node < 0) return null;
    const nd = nav.nodes[node];
    const x = nd.x + (t.x - nd.x) * inward;
    const z = nd.z + (t.z - nd.z) * inward;
    return { node, x, z, y: TILE_TOP, yaw: Math.atan2(t.x - x, t.z - z) };
  }
  function workSpot(b, salt = 0) {
    const t = tileOf(b);
    if (!t) return null;
    if (t.ring === 1) {
      // Wonders: helpers spread around the outer side.
      const k = (hashStr('w' + b.id) + salt) % 6;
      return spotAt(t, k, 0.18);
    }
    const fr = frontCorners(t);
    return spotAt(t, fr[(hashStr('w' + b.id) + salt) % 2], 0.22);
  }
  // Goods are kept at the landing pad: haulers fetch them there.
  function padSpot(salt) {
    const ks = [0, 2, 3, 5];
    return spotAt(layout.tiles[0], ks[salt % ks.length], 0.2);
  }
  function refreshPois() {
    buildPois = [];
    for (const v of builds.values()) {
      if (!v.b.built || v.b.damaged) continue;
      const t = tileOf(v.b);
      const defs = POI_DEFS[v.b.item];
      if (!t || !defs) continue;
      const fr = frontCorners(t);
      defs.forEach((pose, i) => {
        const k = v.b.item === 'market' ? fr[i % 2] : (hashStr('p' + v.b.id) + i * 2) % 6;
        const s = spotAt(t, k, 0.2);
        if (s) buildPois.push({ id: v.b.id + ':' + i, node: s.node, x: s.x, z: s.z, y: s.y, yaw: s.yaw, pose, night: v.b.item === 'campfire' });
      });
    }
    const live = new Set(buildPois.map((p) => p.id).concat(beachPois.map((p) => p.id)));
    for (const id of [...poiUser.keys()]) if (!live.has(id)) poiUser.delete(id);
  }

  function setBody(v, item, level, celebrate) {
    const key = item + ':' + level;
    if (v.body && v.key === key) return;
    if (v.body) v.root.remove(v.body);
    const made = buildingMesh({ ...v.b, item, level }, level);
    v.body = made.g;
    v.h = made.h;
    v.anim = made.anim;
    v.key = key;
    v.root.add(v.body);
    if (celebrate) v.grow = 0.25;
    if (v.damaged) v.body.rotation.z = 0.07;
    renderer.shadowMap.needsUpdate = true;
  }
  function clearBody(v) {
    if (v.body) v.root.remove(v.body);
    v.body = null;
    v.key = '';
    v.anim = [];
  }
  function setScaffold(v, on) {
    if (on && !v.scaffold) {
      v.scaffold = scaffoldMesh(Math.min(0.9, v.h));
      v.root.add(v.scaffold);
    } else if (!on && v.scaffold) {
      v.root.remove(v.scaffold);
      v.scaffold = null;
    }
  }
  // A home flies the flag of its owner, in their colour.
  function setFlag(v, on) {
    const color = on ? (data.builders.get(v.b.ownerId) || {}).color || '#3b7ddd' : null;
    if (v.flag && v.flag.userData.color !== color) { v.root.remove(v.flag); v.flag = null; }
    if (on && !v.flag) {
      v.flag = stakeMesh(color);
      v.flag.userData.color = color;
      v.flag.scale.set(1.3, 1.6, 1.3);
      v.flag.position.set(-0.3, 0, -0.16);
      v.root.add(v.flag);
      v.anim = v.anim.filter((a) => a.o !== v.flag);
    }
  }
  function setStake(v, on) {
    if (on && !v.stake) {
      const bd = data.builders.get(v.b.ownerId || v.b.founderId);
      v.stake = stakeMesh(bd ? bd.color : '#3b7ddd');
      v.stake.position.set(0.18, 0, 0.18);
      v.root.add(v.stake);
    } else if (!on && v.stake) {
      v.root.remove(v.stake);
      v.stake = null;
    }
  }
  function progressOf(b) {
    if (b.wonder) {
      const w = data.econ?.wonder;
      if (w && w.id === b.id) return w.progress;
      return b.status === 'done' ? 1 : 0;
    }
    if (b.status === 'done') return 1;
    if (b.status !== 'building') return 0;
    // Town projects: work done so far, plus what the helpers did since.
    if (b.project && !b.evolving && !b.upgrade && b.work) {
      const extra = b.rate && b.progressAt ? (b.rate * Math.max(0, now() - b.progressAt)) / 1000 : 0;
      return Math.max(0, Math.min(1, ((b.progress || 0) + extra) / b.work));
    }
    return Math.max(0, Math.min(1, (now() - b.startedAt - b.walkSec * 1000) / (b.buildSec * 1000)));
  }
  function syncBuild(b, live) {
    let v = builds.get(b.id);
    const prev = v ? v.b : null;
    if (!v) {
      const p = hexToWorld(b.q, b.r);
      const t = layout.index.get(b.q + ',' + b.r);
      v = { id: b.id, b, root: new T.Group(), body: null, key: '', h: 0.4, anim: [], scaffold: null, stake: null, flag: null, label: null, grow: 1, puff: 0, doneAt: 0, drop: 0, damaged: false, smoke: 0, shown: 0.05 };
      v.root.position.set(p.x, t && !isWater(t) ? LAND[t.t].top : TILE_TOP, p.z);
      v.root.rotation.y = Math.atan2(-p.x, -p.z);
      buildGroup.add(v.root);
      builds.set(b.id, v);
    }
    v.b = b;
    const finished = live && prev && prev.status !== 'done' && b.status === 'done';
    // Houses being upgraded keep standing as they are until the new one is done.
    if (b.wonder || b.built || b.status === 'building') setBody(v, b.item, b.level || 1, finished && !!prev.upgrade);
    else clearBody(v);
    if (v.body && b.built && !b.wonder) v.body.scale.y = v.grow < 1 ? v.grow : 1;
    setScaffold(v, b.status === 'building');
    setStake(v, b.status === 'queued' && !b.built);
    setFlag(v, !!b.home);
    v.damaged = !!b.damaged;
    if (v.body) v.body.rotation.z = v.damaged ? 0.07 : 0;
    if (finished) {
      v.doneAt = performance.now();
      const p = v.root.position;
      confetti(p.x, p.y + v.h + 0.2, p.z);
      if (sky.night > 0.5 || b.wonder) fireworks(p.x, p.z, b.wonder ? 6 : 2);
      audio.sfx('party', distVol(p));
    }
    return { v, prev, finished };
  }
  function removeBuild(id, animate) {
    const v = builds.get(id);
    if (!v) return;
    if (animate) dust(v.root.position.x, TILE_TOP, v.root.position.z);
    buildGroup.remove(v.root);
    if (v.label) v.label.el.remove();
    builds.delete(id);
  }

  // --- Bots ----------------------------------------------------------------------------
  const bots = new Map();
  const porters = new Set();
  let porterSeq = 0;
  function jobOf(id) {
    let job = null;
    for (const v of builds.values()) if (v.b.ownerId === id && v.b.status !== 'done') job = v;
    return job;
  }
  function homeOf(id) {
    for (const v of builds.values()) if (v.b.home && v.b.ownerId === id) return v;
    return null;
  }
  function homeSpot(id) {
    const v = homeOf(id);
    return v && v.b.built ? workSpot(v.b) : null;
  }
  function wantedBots() {
    const t = now();
    const busy = new Set();
    for (const v of builds.values()) if (v.b.status !== 'done') busy.add(v.b.ownerId);
    for (const id of data.jobs.keys()) busy.add(id);
    return [...data.builders.values()]
      .filter((bd) => busy.has(bd.id) || t - bd.lastSeen < GONE_AFTER)
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(0, MAX_BOTS);
  }
  function syncBots(arrivingId) {
    const want = wantedBots();
    const ids = new Set(want.map((b) => b.id));
    for (const [id, b] of bots) if (!ids.has(id)) removeBot(b);
    for (const bd of want) {
      const b = bots.get(bd.id);
      if (b) { b.builder = bd; refreshLook(b); }
      else addBot(bd, bd.id === arrivingId);
    }
  }
  function newWalker(id, builder, parts, spot) {
    const node = spot ? spot.node : nav.town.length ? pick(nav.town) : Math.max(0, nav.door);
    const n = nav.nodes[node];
    const crate = mesh(geo('carryCrate', () => new T.BoxGeometry(0.09, 0.07, 0.07)), crateMats.wood, 0, 0.2, 0.09, parts.inner);
    crate.visible = false;
    parts.crate = crate;
    return {
      id, builder, parts, x: spot ? spot.x : n.x, y: spot ? spot.y : n.y, z: spot ? spot.z : n.z,
      yaw: rand() * Math.PI * 2, yawTarget: null, node, path: null, pi: 0, tail: null, then: null, speed: WALK,
      mode: 'idle', act: null, after: null, timer: 0.5 + rand() * 3, phase: (hashStr(String(id)) % 1000) / 160,
      react: null, partner: null, poi: null, claim: null, bubble: null, tag: null, wave: 0, taps: 0, lastTap: 0, hat: null, struck: false,
      carrying: false, jobPose: null, haulSalt: hashStr(String(id)) % 4,
    };
  }
  function addBot(builder, arrive) {
    const parts = botMesh(builder.color);
    const b = newWalker(builder.id, builder, parts, homeSpot(builder.id));
    botGroup.add(parts.g);
    b.tag = addLabel('tag', builder.name);
    b.tag.bot = b;
    bots.set(builder.id, b);
    refreshLook(b);
    if (arrive) arriveFromShip(b);
    return b;
  }
  function removeBot(b) {
    if (b.beacon) removeBeacon(b);
    releasePoi(b);
    unpair(b);
    removeBubble(b);
    if (b.tag) b.tag.el.remove();
    botGroup.remove(b.parts.g);
    bots.delete(b.id);
    if (tour.track === b) tour.track = null;
  }
  function carry(b, res) {
    b.carrying = !!res;
    b.parts.crate.visible = !!res;
    if (res) b.parts.crate.material = crateMats[res] || crateMats.wood;
  }
  // Porters: little helper bots that carry fresh goods to the nearest store.
  function spawnPorter(v, res) {
    if (porters.size >= (low ? 3 : 6) || !nav.nodes.length || lapse) return;
    const from = workSpot(v.b, 1);
    if (!from) return;
    let dest = null;
    let best = Infinity;
    for (const o of builds.values()) {
      if (!o.b.built || ITEMS[o.b.item]?.kind !== 'storage') continue;
      const d = Math.hypot(o.root.position.x - v.root.position.x, o.root.position.z - v.root.position.z);
      if (d < best) { best = d; dest = o; }
    }
    const to = dest ? workSpot(dest.b, 1) : padSpot(porterSeq);
    if (!to) return;
    const parts = botMesh('#9aa3ad');
    parts.g.scale.setScalar(0.7);
    const p = newWalker('porter' + porterSeq++, { name: '', lastSeen: now(), hat: 'none', color: '#9aa3ad' }, parts, from);
    p.porter = true;
    parts.antenna.visible = false;
    carry(p, res);
    botGroup.add(parts.g);
    porters.add(p);
    if (!walkTo(p, to.node, () => removePorter(p), WALK * 1.15, to)) removePorter(p);
  }
  function removePorter(p) {
    botGroup.remove(p.parts.g);
    porters.delete(p);
  }
  function refreshLook(b) {
    const p = b.parts;
    if (b.hat !== b.builder.hat) {
      if (p.hat) p.head.remove(p.hat);
      p.hat = b.builder.hat && b.builder.hat !== 'none' ? hatMesh(b.builder.hat, b.builder.color) : null;
      if (p.hat) p.head.add(p.hat);
      p.antenna.visible = !p.hat || b.builder.hat === 'flowers' || b.builder.hat === 'headphones';
      b.hat = b.builder.hat;
    }
    if (b.tag && b.tag.el.textContent !== b.builder.name) { b.tag.el.textContent = b.builder.name; b.tag.w = 0; }
  }
  function resnap(b) {
    releasePoi(b);
    unpair(b);
    b.node = nearestNode(b.x, b.z);
    b.path = null;
    b.tail = null;
    if (b.mode !== 'arrive') { b.mode = 'idle'; b.timer = 0.3; }
  }
  function releasePoi(b) {
    for (const k of ['poi', 'claim']) {
      if (b[k] && poiUser.get(b[k].id) === b) poiUser.delete(b[k].id);
      b[k] = null;
    }
  }
  function unpair(b) {
    const o = b.partner;
    b.partner = null;
    if (o && o.partner === b) o.partner = null;
  }
  function walkTo(b, target, then, speed, tail) {
    releasePoi(b);
    const path = astar(b.node, target);
    if (!path) { b.mode = 'idle'; b.timer = 2 + rand() * 2; return false; }
    if (path.length > 1) {
      const a = nav.nodes[path[0]];
      const c = nav.nodes[path[1]];
      if (Math.hypot(c.x - b.x, c.z - b.z) < Math.hypot(c.x - a.x, c.z - a.z)) path.shift();
    }
    b.path = path;
    b.pi = 0;
    b.tail = tail || null;
    b.mode = 'walk';
    b.act = null;
    b.then = then || null;
    b.speed = speed || WALK;
    return true;
  }
  function pathLength(b) {
    let len = 0;
    let px = b.x;
    let pz = b.z;
    for (const i of b.path) { len += Math.hypot(nav.nodes[i].x - px, nav.nodes[i].z - pz); px = nav.nodes[i].x; pz = nav.nodes[i].z; }
    if (b.tail) len += Math.hypot(b.tail.x - px, b.tail.z - pz);
    return len;
  }
  function goSpot(b, s, then, deadline, speed) {
    if (Math.hypot(b.x - s.x, b.z - s.z) < 0.03) { then(b); return true; }
    if (!walkTo(b, s.node, then, speed || WALK, s)) return false;
    if (deadline) {
      const left = (deadline - now()) / 1000;
      b.speed = Math.max(WALK, Math.min(2.4, pathLength(b) / Math.max(1.2, left)));
    }
    return true;
  }
  function startAct(b, kind, dur, yaw) {
    b.mode = 'act';
    b.act = kind;
    b.timer = dur;
    if (yaw != null) b.yawTarget = yaw;
  }
  // What should this bot do now? Its own build first, then its job, then rest.
  function decide(b) {
    if (b.porter) { removePorter(b); return; }
    if (b.mode === 'arrive') return;
    b.act = null;
    b.after = null;
    b.gatherUntil = 0;
    const own = jobOf(b.id);
    if (own && own.b.status === 'building') {
      const s = workSpot(own.b);
      if (s) {
        carry(b, null);
        goSpot(b, s, (x) => { x.mode = 'work'; x.yawTarget = s.yaw; }, own.b.startedAt + own.b.walkSec * 1000);
        return;
      }
    }
    const job = data.jobs.get(b.id);
    if (job && doJob(b, job)) return;
    carry(b, null);
    if (own) {
      const s = workSpot(own.b);
      if (s) {
        goSpot(b, s, (x) => { x.mode = 'wait'; x.yawTarget = s.yaw; x.wave = 0; }, 0, WALK * 1.4);
        return;
      }
    }
    if (now() - b.builder.lastSeen > SLEEP_AFTER) {
      const h = homeSpot(b.id);
      if (h) { goSpot(b, h, (x) => { x.mode = 'sleep'; x.yawTarget = h.yaw + Math.PI / 2; }); return; }
    }
    if (data.event?.key === 'festival' && rand() < 0.7) {
      const plaza = freePois().filter((p) => p.plaza);
      if (plaza.length) {
        const p = pick(plaza);
        walkTo(b, p.node, (x) => { startAct(x, 'party', 6); x.after = () => decide(x); }, WALK * 1.2, { x: p.x, z: p.z, y: p.y });
        return;
      }
    }
    leisure(b);
  }
  function doJob(b, job) {
    if (job.kind === 'explore') {
      const t = layout.index.get(job.q + ',' + job.r);
      if (!t) return false;
      let node = -1;
      for (let k = 0; k < 6 && node < 0; k++) node = cornerNode(t, k);
      if (node < 0) node = nearestNode(t.x, t.z);
      const nd = nav.nodes[node];
      const deadline = job.startedAt + (job.until - job.startedAt) * 0.85;
      carry(b, null);
      return goSpot(b, { node, x: nd.x, z: nd.z, y: nd.y, yaw: Math.atan2(t.x - nd.x, t.z - nd.z) }, (x) => { x.mode = 'job'; x.jobPose = 'scout'; x.yawTarget = Math.atan2(t.x - nd.x, t.z - nd.z); }, deadline, WALK * 1.6);
    }
    if (job.kind === 'hand') return gatherTrip(b, job);
    const v = builds.get(job.buildId);
    if (!v) return false;
    if (job.kind === 'wonder') {
      // Haul: fetch goods at the pad, carry them to the wonder, repeat.
      const needs = ITEMS[v.b.item]?.needs || {};
      const res = pick(Object.keys(needs)) || 'stone';
      if (b.carrying) {
        const site = workSpot(v.b, b.haulSalt);
        return site ? goSpot(b, site, (x) => { carry(x, null); dust(x.x, x.y, x.z, 0.3); startAct(x, 'look', 0.8, site.yaw); }) : false;
      }
      const pad = padSpot(b.haulSalt);
      return pad ? goSpot(b, pad, (x) => { carry(x, res); startAct(x, 'look', 0.6, pad.yaw); }) : false;
    }
    const s = workSpot(v.b, 1);
    if (!s) return false;
    const pose = job.kind === 'repair' ? 'hammer' : WATER_JOBS.has(v.b.item) ? 'water' : FISH_JOBS.has(v.b.item) ? 'fish' : 'hammer';
    return goSpot(b, s, (x) => { x.mode = 'job'; x.jobPose = pose; x.yawTarget = s.yaw; });
  }
  // Gathering by hand: work on the land, carry a crate to the nearest store
  // (or the landing pad), and go back. The crate reaches town about when the
  // server counts the load.
  function gatherTrip(b, job) {
    const drop = dropSpot(b);
    if (b.carrying) {
      if (!drop) return false;
      return goSpot(b, drop, (x) => {
        carry(x, null);
        dust(x.x, x.y, x.z, 0.25);
        popAt(x.x, x.y + 0.5, x.z, { [job.res]: HAND_LOAD });
        startAct(x, 'look', 0.8, drop.yaw);
      });
    }
    const t = layout.index.get(job.q + ',' + job.r);
    if (!t) return false;
    let node = -1;
    for (let k = 0; k < 6 && node < 0; k++) node = cornerNode(t, (k + b.haulSalt) % 6);
    if (node < 0) node = nearestNode(t.x, t.z);
    const nd = nav.nodes[node];
    const yaw = Math.atan2(t.x - nd.x, t.z - nd.z);
    return goSpot(b, { node, x: nd.x, z: nd.z, y: nd.y, yaw }, (x) => {
      x.mode = 'job';
      x.jobPose = job.pose || 'chop';
      x.yawTarget = yaw;
      const back = drop ? (Math.hypot(drop.x - x.x, drop.z - x.z) * 1.3) / WALK : 0;
      const first = job.startedAt + HAND_FIRST_SEC * 1000;
      let at = first + Math.max(0, Math.ceil((now() - first) / (HAND_TRIP_SEC * 1000))) * HAND_TRIP_SEC * 1000;
      if (at - back * 1000 < now() + 5000) at += HAND_TRIP_SEC * 1000;
      x.gatherUntil = Math.min(job.until, at) - back * 1000;
    });
  }
  function dropSpot(b) {
    let best = null;
    let bd = Infinity;
    for (const o of builds.values()) {
      if (!o.b.built || o.b.damaged || ITEMS[o.b.item]?.kind !== 'storage') continue;
      const d = Math.hypot(o.root.position.x - b.x, o.root.position.z - b.z);
      if (d < bd) { bd = d; best = o; }
    }
    return (best && workSpot(best.b, b.haulSalt)) || padSpot(b.haulSalt);
  }
  function freePois() {
    return beachPois.concat(buildPois).filter((p) => !poiUser.has(p.id) && (!p.night || sky.night > 0.5));
  }
  function leisure(b) {
    const r = rand();
    const free = freePois();
    if (weather.rain > 0.3 && r < 0.6) {
      const dry = free.filter((p) => p.pose === 'drink');
      if (dry.length) return visitPoi(b, pick(dry));
    }
    if (sky.night > 0.5 && r < 0.5) {
      const fire = free.filter((p) => p.night);
      if (fire.length) return visitPoi(b, pick(fire));
    }
    if (r < 0.45 && free.length) return visitPoi(b, pick(free));
    if (r < 0.62) {
      const partner = [...bots.values()].find((o) => o !== b && !o.partner && !jobOf(o.id) && !data.jobs.has(o.id) && (o.mode === 'idle' || (o.mode === 'act' && o.act === 'look')) && Math.hypot(o.x - b.x, o.z - b.z) < 6);
      if (partner) return startChat(b, partner);
    }
    if (r < 0.92 && nav.town.length) {
      walkTo(b, pick(nav.town), (x) => startAct(x, 'look', 2 + rand() * 4));
      return;
    }
    startAct(b, 'look', 3 + rand() * 4);
  }
  function visitPoi(b, p) {
    const ok = walkTo(b, p.node, (x) => {
      x.poi = p;
      poiUser.set(p.id, x);
      const dur = { sit: 14, drink: 9, fish: 16, water: 10, look: 7 }[p.pose] || 10;
      startAct(x, p.pose, dur * (0.7 + rand() * 0.6), p.yaw);
      if (p.pose === 'drink' && rand() < 0.5) showBubble(x, '☕', 2500, true);
    }, WALK, { x: p.x, z: p.z, y: p.y });
    if (ok) { poiUser.set(p.id, b); b.claim = p; }
  }
  function startChat(a, b) {
    const path = astar(a.node, b.node);
    if (!path || path.length < 2) { startAct(a, 'look', 3); return; }
    const meet = path[Math.floor(path.length / 2)];
    const near = nav.adj[meet][0] ? nav.adj[meet][0][0] : meet;
    a.partner = b;
    b.partner = a;
    a.arrived = false;
    b.arrived = false;
    const arrive = (x) => {
      x.arrived = true;
      x.mode = 'idle';
      x.timer = 20;
      const o = x.partner;
      if (!o) { decide(x); return; }
      if (o.arrived && o.partner === x) {
        const dur = 8 + rand() * 6;
        for (const [p, q] of [[x, o], [o, x]]) {
          startAct(p, 'chat', dur, Math.atan2(q.x - p.x, q.z - p.z));
          p.chatNext = 0.3 + rand();
        }
      }
    };
    walkTo(a, meet, arrive, WALK);
    walkTo(b, near, arrive, WALK);
  }
  function party(b) {
    b.path = null;
    b.tail = null;
    releasePoi(b);
    unpair(b);
    startAct(b, 'party', 3.2);
    b.after = () => decide(b);
    confetti(b.x, b.y + 0.4, b.z);
  }
  function arriveFromShip(b) {
    b.mode = 'arrive';
    b.timer = 0;
    b.x = 0;
    b.z = 0.12;
    b.y = TILE_TOP + 0.25;
    b.node = nav.door;
    b.parts.g.scale.setScalar(0.01);
    shipHop(0.6);
    audio.sfx('whoosh');
  }

  // --- Every frame: walking, poses, reactions ---------------------------------------------
  function turnTo(b, yaw, dt) {
    let d = yaw - b.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    b.yaw += still ? d : d * Math.min(1, dt * 8);
  }
  function stepBot(b, t, dt) {
    if (b.react) {
      b.react.t += dt;
      if (b.react.t > b.react.dur) b.react = null;
    }
    const busy = !!b.react;
    switch (b.mode) {
      case 'walk': {
        if (busy) break;
        const target = b.pi < b.path.length ? nav.nodes[b.path[b.pi]] : b.tail;
        const dx = target.x - b.x;
        const dz = target.z - b.z;
        const d = Math.hypot(dx, dz);
        const step = b.speed * dt * (weather.rain > 0.3 ? 1.2 : 1);
        if (d <= step || d < 1e-4) {
          b.x = target.x;
          b.z = target.z;
          b.y = target.y;
          if (b.pi < b.path.length) { b.node = b.path[b.pi]; b.pi++; }
          else b.tail = null;
          if (b.pi >= b.path.length && !b.tail) {
            b.path = null;
            b.mode = 'idle';
            b.timer = 0.6;
            const then = b.then;
            b.then = null;
            if (b.claim && poiUser.get(b.claim.id) === b) poiUser.delete(b.claim.id);
            b.claim = null;
            if (then) then(b); else decide(b);
          }
        } else {
          b.x += (dx / d) * step;
          b.z += (dz / d) * step;
          b.y += (target.y - b.y) * Math.min(1, step / d);
          b.yawTarget = Math.atan2(dx, dz);
        }
        break;
      }
      case 'act':
        if (busy) break;
        b.timer -= dt;
        if (b.act === 'chat') {
          b.chatNext -= dt;
          if (b.chatNext <= 0) { showBubble(b, pick(CHAT_EMOJI), 1600, true); b.chatNext = 2.2 + rand() * 1.5; }
        }
        if (b.timer <= 0) {
          const after = b.after;
          b.after = null;
          b.act = null;
          unpair(b);
          releasePoi(b);
          b.mode = 'idle';
          b.timer = 0.5;
          if (after) after(); else decide(b);
        }
        break;
      case 'idle':
        b.timer -= dt;
        if (b.timer <= 0) { unpair(b); decide(b); }
        break;
      case 'work': {
        const job = jobOf(b.id);
        if (!job || job.b.status !== 'building') { decide(b); break; }
        if (rand() < dt * 0.05) showBubble(b, pick(LINES.work), 2600);
        break;
      }
      case 'job': {
        const job = data.jobs.get(b.id);
        if (!job || jobOf(b.id)?.b.status === 'building') { decide(b); break; }
        if (job.kind === 'hand') {
          if (b.gatherUntil && now() >= b.gatherUntil) { carry(b, job.res); decide(b); break; }
          if ((b.jobPose === 'chop' || b.jobPose === 'mine') && b.struck && !b.chipped) chips(b);
          b.chipped = b.struck;
        }
        if (rand() < dt * 0.03) showBubble(b, pick(LINES[job.kind === 'hand' ? b.jobPose : 'job'] || LINES.job), 2200);
        break;
      }
      case 'wait': {
        const job = jobOf(b.id);
        if (!job || job.b.status !== 'queued' || data.jobs.has(b.id)) decide(b);
        break;
      }
      case 'sleep':
        if (now() - b.builder.lastSeen < SLEEP_AFTER || jobOf(b.id) || data.jobs.has(b.id)) decide(b);
        break;
      case 'arrive': {
        b.timer += dt;
        const k = Math.min(1, b.timer / 1.3);
        const door = nav.nodes[nav.door];
        b.x = door.x * k;
        b.z = 0.12 + (door.z - 0.12) * k;
        b.y = TILE_TOP + 0.25 * (1 - k) + (door.y - TILE_TOP) * k;
        b.parts.g.scale.setScalar(0.85 * Math.min(1, k * 1.6 + 0.05));
        b.yawTarget = 0;
        if (k >= 1) {
          b.node = nav.door;
          b.mode = 'idle';
          b.timer = 0;
          b.parts.g.scale.setScalar(0.85);
          showBubble(b, LINES.hello[0].replace('{name}', b.builder.name), 3000);
          decide(b);
        }
        break;
      }
      default:
        break;
    }
    poseBot(b, t, dt);
  }
  function hammerPose(b, p, t, speed = 1.5) {
    let lift = 0;
    if (!still) {
      const c = (t * speed + b.phase) % 1;
      const up = c < 0.72 ? c / 0.72 : 1 - (c - 0.72) / 0.28;
      p.armR.rotation.x = -0.5 - up * 2.0;
      p.inner.rotation.x = 0.06 + (1 - up) * 0.06;
      if (c > 0.72 && c < 0.8) {
        lift = 0.008;
        if (!b.struck) { b.struck = true; if (!b.porter && distVol(b) > 0.3) audio.sfx('hammer', distVol(b)); }
      } else b.struck = false;
    } else p.armR.rotation.x = -1.4;
    p.armL.rotation.x = -0.4;
    return lift;
  }
  function poseBot(b, t, dt) {
    const p = b.parts;
    p.inner.rotation.set(0, 0, 0);
    p.inner.position.set(0, 0, 0);
    p.head.rotation.set(0, 0, 0);
    p.armL.rotation.set(0, 0, 0.08);
    p.armR.rotation.set(0, 0, -0.08);
    p.legL.rotation.set(0, 0, 0);
    p.legR.rotation.set(0, 0, 0);
    const jobPose = b.mode === 'job' ? b.jobPose : null;
    const swing = jobPose === 'hammer' || jobPose === 'chop' || jobPose === 'mine';
    p.hammer.visible = b.mode === 'work' || swing;
    p.cup.visible = b.act === 'drink' || jobPose === 'pick';
    p.rod.visible = b.act === 'fish' || jobPose === 'fish';
    p.can.visible = b.act === 'water' || jobPose === 'water';
    p.dizzy.visible = false;
    let lift = 0;
    if (b.mode === 'walk' && !b.react) {
      const w = still ? 0 : Math.sin(t * 11 * Math.min(2, b.speed / WALK) + b.phase);
      p.legL.rotation.x = w * 0.6;
      p.legR.rotation.x = -w * 0.6;
      p.armL.rotation.x = -w * 0.5;
      p.armR.rotation.x = w * 0.5;
      lift = Math.abs(w) * 0.012;
      if (b.speed > WALK * 1.6) p.inner.rotation.x = 0.15;
    } else if (b.mode === 'work' || swing) {
      lift = hammerPose(b, p, t, data.event?.key === 'builderRush' && !jobPose ? 2.6 : jobPose === 'mine' ? 1.2 : 1.5);
    } else if (jobPose === 'pick') {
      // Bent over a bush, picking with one hand, basket in the other.
      p.inner.rotation.x = 0.35;
      p.armR.rotation.x = -0.6;
      p.armL.rotation.x = still ? -1.1 : -0.9 - Math.max(0, Math.sin(t * 3 + b.phase)) * 0.6;
      p.head.rotation.x = 0.2;
    } else if (jobPose === 'water') {
      p.armR.rotation.x = -1.1;
      p.can.rotation.x = still ? 0.6 : 0.4 + Math.sin(t * 3) * 0.3;
      p.inner.rotation.x = 0.15;
    } else if (jobPose === 'fish') {
      p.armR.rotation.x = -1.0;
      p.armL.rotation.x = -0.9;
    } else if (jobPose === 'scout') {
      // Hand over the eyes, looking out over the new land.
      p.armR.rotation.x = -2.6;
      p.armR.rotation.z = -0.5;
      if (!still) p.head.rotation.y = Math.sin(t * 0.8 + b.phase) * 0.7;
    } else if (b.mode === 'wait') {
      b.yawTarget = Math.atan2(camera.position.x - b.x, camera.position.z - b.z);
      b.wave = (b.wave || 0) + dt;
      if (b.wave % 5 < 1.4 && !still) {
        p.armR.rotation.x = -2.8;
        p.armR.rotation.z = -0.3 + Math.sin(t * 14) * 0.35;
      } else if (!still) p.inner.rotation.z = Math.sin(t * 1.6 + b.phase) * 0.06;
    } else if (b.mode === 'sleep') {
      p.inner.rotation.z = Math.PI / 2 - 0.05;
      p.inner.position.set(0.17, 0.065, 0);
      if (rand() < dt * 0.04) showBubble(b, pick(LINES.sleep), 2500);
    } else if (b.mode === 'act') {
      const k = b.act;
      if (k === 'sit') {
        p.inner.position.y = -0.055;
        p.legL.rotation.x = -1.45;
        p.legR.rotation.x = -1.45;
        p.armL.rotation.x = -0.3;
        p.armR.rotation.x = -0.3;
      } else if (k === 'drink') {
        const c = (t * 0.5 + b.phase) % 1;
        p.armR.rotation.x = c < 0.25 ? -2.2 : -0.9;
        p.head.rotation.x = c < 0.25 ? -0.25 : 0;
      } else if (k === 'fish') {
        p.armR.rotation.x = -1.0;
        p.armL.rotation.x = -0.9;
        if (!still) p.inner.rotation.z = Math.sin(t * 0.8 + b.phase) * 0.03;
      } else if (k === 'water') {
        p.armR.rotation.x = -1.1;
        p.can.rotation.x = still ? 0.6 : 0.4 + Math.sin(t * 3) * 0.3;
        p.inner.rotation.x = 0.15;
      } else if (k === 'chat') {
        if (!still) {
          p.armR.rotation.x = -0.6 + Math.sin(t * 5 + b.phase) * 0.5;
          p.head.rotation.z = Math.sin(t * 2.3 + b.phase) * 0.1;
          lift = Math.max(0, Math.sin(t * 4 + b.phase)) * 0.006;
        }
      } else if (k === 'party') {
        lift = still ? 0 : Math.abs(Math.sin(t * 9 + b.phase)) * 0.12;
        p.armL.rotation.set(-2.9, 0, 0.3);
        p.armR.rotation.set(-2.9, 0, -0.3);
        if (!still) b.yawTarget = b.yaw + dt * 6;
      } else if (k === 'look') {
        if (!still) p.head.rotation.y = Math.sin(t * 0.9 + b.phase) * 0.6;
      }
    }
    if (b.carrying) {
      p.armL.rotation.x = -1.3;
      p.armR.rotation.x = -1.3;
      p.hammer.visible = false;
    }
    if (b.react) {
      const r = b.react;
      const k = r.t / r.dur;
      b.yawTarget = Math.atan2(camera.position.x - b.x, camera.position.z - b.z);
      if (r.kind === 'wave') p.armR.rotation.set(-2.8, 0, -0.3 + (still ? 0 : Math.sin(t * 16) * 0.4));
      else if (r.kind === 'jump') { lift = still ? 0 : Math.sin(Math.min(1, k) * Math.PI) * 0.25; p.armL.rotation.x = -2.5; p.armR.rotation.x = -2.5; }
      else if (r.kind === 'spin') { if (!still) p.inner.rotation.y = k * Math.PI * 2; lift = still ? 0 : Math.sin(Math.min(1, k) * Math.PI) * 0.06; }
      else if (r.kind === 'dizzy') {
        p.dizzy.visible = true;
        if (!still) { p.inner.rotation.z = Math.sin(t * 6) * 0.18; p.head.rotation.z = Math.sin(t * 6 + 1) * 0.25; }
        p.dizzy.children.forEach((st, i) => { const a = t * 5 + (i / 3) * Math.PI * 2; st.position.set(Math.cos(a) * 0.09, 0.02, Math.sin(a) * 0.09); });
      }
    }
    if (b.yawTarget != null) turnTo(b, b.yawTarget, dt);
    p.g.position.set(b.x, b.y + lift, b.z);
    p.g.rotation.y = b.yaw;
    p.umbrella.visible = !b.porter && weather.rain > 0.3 && (b.mode === 'walk' || b.mode === 'idle' || (b.mode === 'act' && b.act !== 'drink'));
    if (p.hat && p.hat.userData.prop && !still) p.hat.userData.prop.rotation.y += dt * (b.mode === 'walk' ? 18 : 6);
  }

  // --- Builds every frame: growing, scaffolding dust, moving parts ------------------------
  function stepBuilds(t, dt) {
    const night = sky.night;
    const minutes = new Date(clockNow());
    for (const v of builds.values()) {
      const b = v.b;
      if (b.wonder && v.body && b.status !== 'done') {
        const want = 0.05 + 0.95 * progressOf(b);
        v.shown += (want - v.shown) * Math.min(1, dt * 0.8);
        v.body.scale.y = v.shown;
        v.puff -= dt;
        if (v.puff <= 0 && !lapse) { v.puff = 3 + rand() * 2; dust(v.root.position.x, TILE_TOP, v.root.position.z, 0.6); }
      } else if (b.wonder && v.body) {
        v.body.scale.y = v.grow < 1 ? v.grow : 1;
      } else if (b.status === 'building' && !b.built && v.body) {
        const pr = progressOf(b);
        v.body.scale.y = Math.max(0.04, 1 - Math.pow(1 - pr, 2));
        v.puff -= dt;
        if (pr > 0 && pr < 1 && v.puff <= 0) {
          v.puff = 2 + rand() * 1.5;
          dust(v.root.position.x, TILE_TOP, v.root.position.z, 0.5);
        }
      } else if (v.grow < 1 && v.body) {
        v.grow = Math.min(1, v.grow + dt / 1.6);
        v.body.scale.y = 1 - Math.pow(1 - v.grow, 3);
      }
      if (v.damaged && !still) {
        v.smoke -= dt;
        if (v.smoke <= 0) { v.smoke = 1.2 + rand(); smoke(v.root.position.x, v.root.position.y + v.h * 0.6, v.root.position.z, true); }
      }
      if (!v.body || still) continue;
      const lit = !v.damaged && !blackout();
      for (const a of v.anim) {
        if (a.kind === 'spin') { if (lit) a.o.rotation.z += dt * a.speed * (1 + weather.rain); }
        else if (a.kind === 'spinZ') { if (lit) a.o.rotation.z += dt * a.speed; }
        else if (a.kind === 'spinY') a.o.rotation.y += dt * a.speed;
        else if (a.kind === 'beam') { a.o.visible = night > 0.2 && lit; a.o.rotation.y += dt * 0.9; }
        else if (a.kind === 'beamUp') a.o.visible = night > 0.2 || data.finale;
        else if (a.kind === 'flag') a.o.rotation.y = Math.sin(t * 2 + v.id) * 0.3;
        else if (a.kind === 'bob') { a.o.position.y = 0.02 + Math.sin(t * 1.3 + v.id) * 0.012; a.o.rotation.z = Math.sin(t * 1.1 + v.id) * 0.05; }
        else if (a.kind === 'blink') a.o.visible = Math.sin(t * 3 + v.id) > 0;
        else if (a.kind === 'pulse') a.o.scale.setScalar(1 + Math.sin(t * 2.5 + v.id) * 0.06);
        else if (a.kind === 'hover') a.o.position.y = a.y + Math.sin(t * 1.4 + v.id) * 0.04;
        else if (a.kind === 'drone') {
          const k = t * 0.8 + a.ph;
          a.o.position.set(a.x + Math.cos(k) * 0.12, 0.25 + Math.sin(k * 1.7) * 0.06, a.z + Math.sin(k) * 0.12);
        } else if (a.kind === 'arm') {
          a.o.rotation.y = Math.sin(t * 0.8 + v.id) * 1.2;
          a.upper.rotation.z = -0.4 + Math.sin(t * 1.3 + v.id) * 0.35;
          a.fore.rotation.z = 0.9 + Math.sin(t * 1.7 + v.id) * 0.4;
        } else if (a.kind === 'clock') {
          const h = minutes.getHours() % 12;
          const m = minutes.getMinutes();
          for (const hd of a.hands) {
            hd.hour.rotation.z = -((h + m / 60) / 12) * Math.PI * 2;
            hd.min.rotation.z = -(m / 60) * Math.PI * 2;
          }
        } else if (a.kind === 'fire') {
          const flick = 1 + Math.sin(t * 13 + v.id) * 0.12 + Math.sin(t * 7.3) * 0.08;
          a.f1.scale.set(1, flick, 1);
          a.f2.scale.set(1, 2 - flick, 1);
        } else if (a.kind === 'smoke') {
          if (!lit || lapse) continue;
          a.t -= dt;
          if (a.t <= 0 && camera.position.distanceTo(v.root.position) < 14) {
            a.t = a.every * (0.7 + rand() * 0.6);
            const p = new T.Vector3(a.x, a.y, a.z).applyMatrix4(v.body.matrixWorld);
            smoke(p.x, p.y, p.z, a.dark);
          }
        } else if (a.kind === 'fountain' && !low) {
          v.drop -= dt;
          if (v.drop <= 0 && camera.position.distanceTo(v.root.position) < 9) {
            v.drop = 0.35;
            const p = v.root.position;
            burst({ x: p.x, y: p.y + a.y, z: p.z, count: 8, colors: ['#cfefff', '#ffffff', '#9fdcf5'], speed: 0.35, life: 0.8, size: 0.03, gravity: 2.4, up: 2.2 });
          }
        }
      }
    }
  }

  // --- Sky: the sun and moon follow the real clock, the air follows the era ---------------
  // The server says where the island is (page ?lat= and ?lon= win, for testing).
  let LAT = Number(opts.lat) || 52.2;
  let LON = Number(opts.lon) || 5.1;
  function setGeo(g) {
    if (!g) return;
    if (!opts.lat && Number.isFinite(Number(g.lat))) LAT = Number(g.lat);
    if (!opts.lon && Number.isFinite(Number(g.lon))) LON = Number(g.lon);
  }
  const C = (hex) => new T.Color(hex);
  const SKY = {
    nightTop: C('#081127'), nightBottom: C('#1c2b52'), duskTop: C('#3d4f8f'), duskBottom: C('#f2a46c'),
    dayTop: C('#8fcdee'), dayBottom: C('#fbe6c6'), rainTop: C('#7d8a99'), rainBottom: C('#b9c2cc'),
    smogTop: C('#a39a8c'), smogBottom: C('#d2c4a8'),
    waterNight: C('#12294a'), waterDay: C('#7bc4da'), hemiNight: C('#3b5082'), hemiDay: C('#c4e6f6'),
    groundNight: C('#3a3226'), groundDay: C('#c7a676'), sunLow: C('#ffc98a'), sunHigh: C('#fff4e0'),
  };
  const mixC = (a, b, t) => a.clone().lerp(b, Math.max(0, Math.min(1, t)));
  // The sun and its shadows follow the camera around the big world.
  const sunDir = new T.Vector3(-0.4, 0.8, -0.55).normalize();
  let shadowSpan = 0;
  function followSun(force) {
    const tg = controls.target;
    const want = Math.max(6, Math.min(26, camera.position.distanceTo(tg) * 0.8));
    if (force || Math.abs(want - shadowSpan) > shadowSpan * 0.15) {
      shadowSpan = want;
      const sc = sun.shadow.camera;
      Object.assign(sc, { left: -want, right: want, top: want, bottom: -want, near: 0.5, far: want * 6 });
      sc.updateProjectionMatrix();
    }
    sun.target.position.set(tg.x, 0, tg.z);
    sun.position.set(tg.x + sunDir.x * shadowSpan * 2, sunDir.y * shadowSpan * 2, tg.z + sunDir.z * shadowSpan * 2);
  }
  const sky = { day: 1, night: 0, dusk: 0 };
  let season = '';
  const blackout = () => data.event?.key === 'blackout';
  function applySeason(s) {
    season = s;
    const L = SEASON_LOOK[s];
    mats.leaf.color.set(L.leaf);
    mats.leaf2.color.set(L.leaf2);
    mats.grass.color.set(L.grass);
    decorShown.clear();
    refreshTiles();
  }
  function updateSky() {
    const ms = clockNow();
    const s = sunAt(ms, LAT, LON);
    const sea = seasonAt(ms, LAT);
    if (sea !== season) applySeason(sea);
    const day = Math.max(0, Math.min(1, (s.sinAlt + 0.1) / 0.35));
    const dusk = Math.max(0, 1 - Math.abs(s.sinAlt - 0.02) / 0.16);
    const rain = weather.rain;
    const haze = look().haze;
    let top = mixC(SKY.nightTop, SKY.dayTop, day);
    let bottom = mixC(SKY.nightBottom, SKY.dayBottom, day);
    top = mixC(top, SKY.duskTop, dusk * 0.6);
    bottom = mixC(bottom, SKY.duskBottom, dusk * 0.85);
    top = mixC(top, SKY.rainTop, rain * 0.55 * day);
    bottom = mixC(bottom, SKY.rainBottom, rain * 0.5 * day);
    top = mixC(top, SKY.smogTop, haze * day);
    bottom = mixC(bottom, SKY.smogBottom, haze * day);
    Object.assign(sky, { day, night: 1 - day, dusk });
    const topCss = '#' + top.getHexString();
    stage.style.background = 'linear-gradient(180deg, ' + topCss + ' 0%, #' + bottom.getHexString() + ' 70%)';
    document.body.style.background = topCss;
    const lum = 0.2126 * top.r + 0.7152 * top.g + 0.0722 * top.b;
    document.documentElement.style.setProperty('--title-ink', lum < 0.25 ? '#f2f5fb' : '#172130');
    document.documentElement.style.setProperty('--title-glow', lum < 0.25 ? 'rgba(0, 0, 0, 0.35)' : 'rgba(255, 255, 255, 0.5)');
    scene.fog.color.copy(bottom);
    mats.water.color.copy(mixC(SKY.waterNight, SKY.waterDay, day * (1 - rain * 0.3)));
    hemi.color.copy(mixC(SKY.hemiNight, SKY.hemiDay, day));
    hemi.groundColor.copy(mixC(SKY.groundNight, SKY.groundDay, day));
    hemi.intensity = 1.2 + 0.5 * day;
    if (day > 0.15) {
      sunDir.set(-Math.sin(s.az) * Math.cos(s.alt), Math.max(0.12, Math.sin(s.alt)), Math.cos(s.az) * Math.cos(s.alt)).normalize();
      sun.color.copy(mixC(SKY.sunLow, SKY.sunHigh, Math.min(1, s.sinAlt / 0.45)));
      sun.intensity = 2.7 * day * (1 - rain * 0.55) * (1 - haze * 0.3);
    } else {
      sunDir.set(-0.4, 0.8, -0.55).normalize();
      sun.color.set('#a9bfff');
      sun.intensity = 0.95;
    }
    followSun(true);
    const night = blackout() ? 0 : 1 - day;
    const glowNight = 1 - day;
    mats.window.emissiveIntensity = night * 1.7 + (blackout() ? 0 : dusk * 0.3);
    mats.towerGlass.emissiveIntensity = night * 1.2;
    mats.lamp.emissiveIntensity = night * 1.6;
    mats.glow.opacity = night * 0.85;
    mats.neonGlow.opacity = night * 0.9;
    mats.glass.emissiveIntensity = 0.15 + night * 0.8;
    mats.beam.opacity = night * 0.16;
    mats.fireGlow.opacity = 0.2 + glowNight * 0.6;
    stars.material.opacity = Math.pow(glowNight, 2) * (1 - rain) * (1 - haze);
    moon.visible = glowNight > 0.3;
    renderer.shadowMap.needsUpdate = true;
  }

  // --- Weather (snow in winter) --------------------------------------------------------------
  const weather = { rain: 0, target: 0, next: 0 };
  function makeRain() {
    const n = low ? 300 : 700;
    const pos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const x = (Math.random() - 0.5) * 18;
      const y = Math.random() * 10;
      const z = (Math.random() - 0.5) * 18;
      pos.set([x, y, z, x + 0.03, y - 0.28, z], i * 6);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    const lines = new T.LineSegments(g, new T.LineBasicMaterial({ color: 0xcfe3f5, transparent: true, opacity: 0 }));
    lines.frustumCulled = false;
    lines.visible = false;
    return lines;
  }
  function updateWeather(dt) {
    const t = Date.now();
    if (data.event?.key === 'storm') weather.target = 1;
    else if (t > weather.next) {
      weather.next = t + 150e3;
      if (weather.target > 0) { if (rand() < 0.55) weather.target = 0; }
      else if (rand() < 0.12) weather.target = 0.55 + rand() * 0.45;
    }
    weather.rain += (weather.target - weather.rain) * Math.min(1, dt * 0.15);
    const on = weather.rain > 0.03;
    rainLines.visible = on;
    if (!on) return;
    const snow = season === 'winter';
    rainLines.material.color.set(snow ? '#ffffff' : '#cfe3f5');
    rainLines.material.opacity = weather.rain * (snow ? 0.8 : 0.55);
    rainLines.position.set(controls.target.x, 0, controls.target.z);
    const pos = rainLines.geometry.attributes.position;
    const arr = pos.array;
    const fall = dt * (snow ? 1.4 : 7);
    for (let i = 0; i < arr.length; i += 6) {
      arr[i + 1] -= fall;
      arr[i + 4] -= fall;
      if (snow) { const w = Math.sin((arr[i + 1] + i) * 2) * dt * 0.2; arr[i] += w; arr[i + 3] = arr[i] + 0.02; arr[i + 4] = arr[i + 1] - 0.04; }
      if (arr[i + 4] < -0.2) { arr[i + 1] += 10; arr[i + 4] += 10; }
    }
    pos.needsUpdate = true;
  }
  function makeStars() {
    const n = 500;
    const pos = new Float32Array(n * 3);
    const r = rng(7);
    for (let i = 0; i < n; i++) {
      const th = r() * Math.PI * 2;
      const ph = Math.acos(0.15 + r() * 0.85);
      pos.set([Math.cos(th) * Math.sin(ph) * 150, Math.cos(ph) * 150, Math.sin(th) * Math.sin(ph) * 150], i * 3);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    const p = new T.Points(g, new T.PointsMaterial({ color: 0xffffff, size: 1.3, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    p.frustumCulled = false;
    return p;
  }

  // --- Effects --------------------------------------------------------------------------------
  const particles = [];
  const dotTex = glowTexture();
  function burst(o) {
    if (particles.length > (low ? 30 : 90)) return;
    const n = low ? Math.ceil(o.count / 3) : o.count;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const vel = [];
    const color = new T.Color();
    for (let i = 0; i < n; i++) {
      pos.set([o.x + (rand() - 0.5) * (o.spread || 0.1), o.y, o.z + (rand() - 0.5) * (o.spread || 0.1)], i * 3);
      const a = rand() * Math.PI * 2;
      const sp = o.speed * (0.4 + rand() * 0.6);
      const up = o.up != null ? o.up : 1;
      vel.push([Math.cos(a) * sp, o.sphere ? (rand() - 0.5) * 2 * sp : up * (0.6 + rand() * 0.8) * o.speed, Math.sin(a) * sp]);
      color.set(pick(o.colors));
      col.set([color.r, color.g, color.b], i * 3);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    const m = new T.PointsMaterial({ size: (o.size || 0.05) * 1.4, map: dotTex, alphaTest: 0.05, vertexColors: true, transparent: true, opacity: 1, depthWrite: false, blending: o.additive ? T.AdditiveBlending : T.NormalBlending });
    const pts = new T.Points(g, m);
    pts.frustumCulled = false;
    fxGroup.add(pts);
    particles.push({ pts, vel, life: o.life, age: 0, gravity: o.gravity != null ? o.gravity : 3, drag: o.drag || 0, grow: o.grow || 0 });
  }
  const highlights = [];
  // A floating arrow and a column of light over one bot, so a viewer can find
  // their own bot on the shared stream.
  const BEACON_SEC = 20;
  function addBeacon(b, color) {
    if (b.beacon) removeBeacon(b);
    const g = new T.Group();
    const mat = new T.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
    const arrow = mesh(new T.ConeGeometry(0.055, 0.12, 4), mat, 0, 0, 0, g);
    arrow.rotation.x = Math.PI;
    const beamMat = new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, blending: T.AdditiveBlending });
    mesh(new T.CylinderGeometry(0.03, 0.03, 1.6, 8, 1, true), beamMat, 0, 0.9, 0, g);
    g.position.y = 0.66;
    b.parts.g.add(g);
    b.beacon = { g, mat, beamMat, t: 0 };
    b.tag.el.classList.add('me');
    b.tag.el.style.borderColor = color;
    b.tag.w = 0;
  }
  function removeBeacon(b) {
    const k = b.beacon;
    b.parts.g.remove(k.g);
    k.g.traverse((o) => o.geometry?.dispose());
    k.mat.dispose();
    k.beamMat.dispose();
    b.beacon = null;
    b.tag.el.classList.remove('me');
    b.tag.el.style.borderColor = '';
    b.tag.w = 0;
  }
  function stepBeacons(dt) {
    for (const b of bots.values()) {
      const k = b.beacon;
      if (!k) continue;
      k.t += dt;
      if (k.t > BEACON_SEC) { removeBeacon(b); continue; }
      const fade = Math.min(1, (BEACON_SEC - k.t) / 2);
      k.g.children[0].position.y = 0.04 * Math.sin(k.t * 4);
      k.g.rotation.y += dt * 2;
      k.mat.opacity = fade;
      k.beamMat.opacity = 0.35 * fade;
    }
  }
  function stepHighlights(dt) {
    for (let i = highlights.length - 1; i >= 0; i--) {
      const h = highlights[i];
      h.t += dt;
      h.ring.scale.setScalar(1 + 0.08 * Math.sin(h.t * 5));
      h.ring.material.opacity = Math.max(0, 0.9 * (1 - h.t / 9));
      if (h.t > 9) { fxGroup.remove(h.ring); h.ring.geometry.dispose(); h.ring.material.dispose(); highlights.splice(i, 1); }
    }
  }
  function stepParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      const arr = p.pts.geometry.attributes.position.array;
      for (let j = 0; j < p.vel.length; j++) {
        const v = p.vel[j];
        v[1] -= p.gravity * dt;
        if (p.drag) { const k = 1 - p.drag * dt; v[0] *= k; v[1] *= k; v[2] *= k; }
        arr[j * 3] += v[0] * dt;
        arr[j * 3 + 1] += v[1] * dt;
        arr[j * 3 + 2] += v[2] * dt;
      }
      p.pts.geometry.attributes.position.needsUpdate = true;
      p.pts.material.opacity = Math.max(0, 1 - p.age / p.life);
      if (p.grow) p.pts.material.size += p.grow * dt;
      if (p.age >= p.life) {
        fxGroup.remove(p.pts);
        p.pts.geometry.dispose();
        p.pts.material.dispose();
        particles.splice(i, 1);
      }
    }
  }
  function confetti(x, y, z) {
    if (still) return;
    burst({ x, y, z, count: 140, colors: ['#f2c230', '#e5608a', '#3b7ddd', '#47ad6b', '#ff8c42', '#ffffff'], speed: 1.4, life: 2.6, size: 0.04, gravity: 2.2, drag: 0.8 });
  }
  function fireworks(x, z, n = 2) {
    if (still) return;
    for (let i = 0; i < n; i++) {
      setTimeout(() => {
        burst({ x: x + (rand() - 0.5) * 2.5, y: 3 + rand() * 1.5, z: z + (rand() - 0.5) * 2.5, count: 160, colors: [pick(['#ff5a5a', '#ffd23f', '#5ad1ff', '#b07cff', '#7dffb0'])], speed: 1.5, life: 1.8, size: 0.07, gravity: 0.7, sphere: true, additive: true, drag: 0.9 });
        audio.sfx('pop');
      }, i * 450);
    }
  }
  function dust(x, y, z, k = 1) {
    if (still) return;
    burst({ x, y: y + 0.05, z, count: Math.round(40 * k), colors: ['#d8cbb0', '#c2b59a', '#efe6d2'], speed: 0.6, life: 1.4, size: 0.07, gravity: -0.2, drag: 1.5, spread: 0.4, up: 0.4, grow: 0.04 });
  }
  // Wood chips or bits of stone where a gathering bot strikes.
  function chips(b) {
    if (still || distVol(b) < 0.2) return;
    const x = b.x + Math.sin(b.yaw) * 0.14;
    const z = b.z + Math.cos(b.yaw) * 0.14;
    const colors = b.jobPose === 'mine' ? ['#8c8f94', '#b3b6ba', '#6f7378'] : ['#c79a5b', '#a8783f', '#e2c08c'];
    burst({ x, y: b.y + 0.12, z, count: 6, colors, speed: 0.5, life: 0.7, size: 0.035, gravity: 3, spread: 0.05, up: 1.2 });
  }
  function smoke(x, y, z, dark) {
    if (still) return;
    burst({ x, y, z, count: 10, colors: dark ? ['#5d636e', '#7a808a', '#454a52'] : ['#e9ecef', '#d6dbe0', '#f6f7f8'], speed: 0.1, life: 3, size: 0.12, gravity: -0.3, spread: 0.06, up: 1, grow: 0.1 });
  }
  function sparkle(x, y, z) {
    if (still) return;
    burst({ x, y, z, count: 18, colors: ['#fff3a3', '#ffd23f', '#ffffff'], speed: 0.4, life: 1.1, size: 0.05, gravity: -0.4, additive: true, spread: 0.3, up: 0.8 });
  }
  function shipHop(power) {
    if (!ship) return;
    if (ship.hopT >= 1) ship.hopT = 0;
    ship.amp = Math.max(ship.amp, 0.5 * power);
    if (!still) burst({ x: 0, y: TILE_TOP + 0.1, z: 0, count: 60, colors: ['#ffb347', '#ff7a3c', '#cfcfcf'], speed: 0.8, life: 1.1, size: 0.06, gravity: -0.3, spread: 0.3, up: -0.2, drag: 1.2 });
  }

  // --- Events: storms, festivals, meteors, the merchant ship ---------------------------------
  const ev = { flashT: 0, flash: 0, festT: 0, meteorT: 0, sparkT: 0, streaks: [], merchant: null };
  const BOOSTED = { harvest: ['food'], tallTrees: ['wood'], richVeins: ['stone', 'coal', 'iron'] };
  function makeMerchant() {
    const g = new T.Group();
    mesh(geo('mHull', () => new T.BoxGeometry(0.42, 0.14, 1.1)), mats.woodDark, 0, 0.02, 0, g);
    mesh(geo('mDeck', () => new T.BoxGeometry(0.38, 0.02, 1.0)), mats.wood, 0, 0.1, 0, g);
    for (const [z, h] of [[-0.25, 0.9], [0.25, 0.75]]) {
      mesh(geo('mMast' + h, () => new T.CylinderGeometry(0.012, 0.016, h, 5)), mats.woodDark, 0, 0.1 + h / 2, z, g);
      mesh(geo('mSail' + h, () => new T.BoxGeometry(0.008, h * 0.6, 0.34)), mats.sail, 0, 0.1 + h * 0.55, z + 0.02, g);
    }
    mesh(geo('mFlag', () => new T.BoxGeometry(0.004, 0.06, 0.12)), trimMat('#e0473f'), 0, 1.06, -0.2, g);
    for (let i = 0; i < 3; i++) mesh(geo('mCrate', () => new T.BoxGeometry(0.1, 0.08, 0.1)), mats.wood, 0.08 - i * 0.07, 0.15, 0.35 - i * 0.12, g);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }
  function stepEvents(t, dt) {
    const key = data.event?.key;
    // Lightning during storms.
    if (key === 'storm' && !still) {
      ev.flashT -= dt;
      if (ev.flashT <= 0) {
        ev.flashT = 3 + rand() * 6;
        ev.flash = 0.18;
        audio.sfx('pop', 0.6);
      }
    }
    if (ev.flash > 0) { ev.flash -= dt; flash.intensity = ev.flash > 0 ? 5 * (ev.flash / 0.18) : 0; }
    if (key === 'festival' && !still) {
      ev.festT -= dt;
      if (ev.festT <= 0) {
        ev.festT = 1.5;
        const tile = layout.townTiles.length ? pick(layout.townTiles) : { x: 0, z: 0 };
        confetti(tile.x, 0.6, tile.z);
        if (sky.night > 0.5 && rand() < 0.4) fireworks(tile.x, tile.z, 1);
      }
    }
    if (key === 'meteor' && !still) {
      ev.meteorT -= dt;
      if (ev.meteorT <= 0) {
        ev.meteorT = 0.3 + rand() * 0.4;
        const a = rand() * Math.PI * 2;
        const start = new T.Vector3(Math.cos(a) * 8, 16 + rand() * 4, Math.sin(a) * 8 - 10);
        const dir = new T.Vector3(-0.6 + rand() * 1.2, -1, 0.5).normalize();
        const geom = new T.BufferGeometry().setFromPoints([start, start.clone().addScaledVector(dir, -1.6)]);
        const line = new T.Line(geom, new T.LineBasicMaterial({ color: 0xfff6c8, transparent: true, opacity: 1, fog: false }));
        fxGroup.add(line);
        ev.streaks.push({ line, dir, age: 0 });
      }
    }
    for (let i = ev.streaks.length - 1; i >= 0; i--) {
      const s = ev.streaks[i];
      s.age += dt;
      s.line.position.addScaledVector(s.dir, dt * 14);
      s.line.material.opacity = Math.max(0, 1 - s.age / 1.2);
      if (s.age > 1.2) { fxGroup.remove(s.line); s.line.geometry.dispose(); s.line.material.dispose(); ev.streaks.splice(i, 1); }
    }
    if (BOOSTED[key] && !still) {
      ev.sparkT -= dt;
      if (ev.sparkT <= 0) {
        ev.sparkT = 0.8;
        const makers = [...builds.values()].filter((v) => v.b.built && Object.keys(ITEMS[v.b.item]?.recipe?.out || {}).some((r) => BOOSTED[key].includes(r)));
        if (makers.length) { const v = pick(makers); sparkle(v.root.position.x, v.h + 0.2, v.root.position.z); }
      }
    }
    // The merchant ship sails in to the pier, waits, and sails away again.
    const m = ev.merchant;
    if (m && layout.pierEnd) {
      const far = { x: layout.pierEnd.x + Math.cos(layout.seaAngle) * 30, z: layout.pierEnd.z + Math.sin(layout.seaAngle) * 30 };
      m.t += dt;
      let k = 1;
      if (m.state === 'arrive') { k = Math.min(1, m.t / 18); if (k >= 1) m.state = 'stay'; }
      if (m.state === 'leave') { k = 1 - Math.min(1, m.t / 18); if (k <= 0) { scene.remove(m.g); ev.merchant = null; return; } }
      const e = k * k * (3 - 2 * k);
      m.g.position.set(far.x + (layout.pierEnd.x - far.x) * e, -0.14 + Math.sin(t * 1.2) * 0.02, far.z + (layout.pierEnd.z - far.z) * e);
      m.g.rotation.y = Math.atan2(layout.pierEnd.x - far.x, layout.pierEnd.z - far.z) + Math.PI / 2;
      m.g.rotation.z = Math.sin(t * 0.9) * 0.03;
    }
    if (data.finale && !still) {
      ev.festT -= dt;
      if (ev.festT <= 0) {
        ev.festT = 1.2;
        const s = [...builds.values()].find((v) => v.b.item === 'spire');
        fireworks(s ? s.root.position.x : 0, s ? s.root.position.z : 0, 1);
      }
    }
  }
  function setEvent(e) {
    const before = data.event?.key;
    data.event = e;
    const key = e?.key;
    if (key === 'merchant' && !ev.merchant) {
      ev.merchant = { g: makeMerchant(), state: 'arrive', t: 0 };
      scene.add(ev.merchant.g);
    } else if (key !== 'merchant' && ev.merchant && ev.merchant.state !== 'leave') {
      ev.merchant.state = 'leave';
      ev.merchant.t = 0;
    }
    if (before === 'storm' && key !== 'storm') weather.target = 0;
    updateSky();
    if (key === 'festival') for (const b of bots.values()) if (b.mode === 'idle' || b.mode === 'act') decide(b);
  }

  // --- Critters: birds, a boat that changes with the era, a cat and fireflies ---------------
  const critters = { birds: [], boat: null, cat: null, flies: null };
  function boatFor(style) {
    const g = new T.Group();
    if (style === 'canoe') {
      const hull = mesh(geo('canoeHull', () => new T.CylinderGeometry(0.06, 0.06, 0.5, 8)), mats.wood, 0, 0.02, 0, g);
      hull.rotation.x = Math.PI / 2;
      hull.scale.set(1, 1, 0.45);
      mesh(geo('paddle', () => new T.BoxGeometry(0.01, 0.01, 0.3)), mats.woodDark, 0.06, 0.06, 0.05, g).rotation.x = 0.6;
    } else if (style === 'steam') {
      mesh(geo('steamHull', () => new T.BoxGeometry(0.24, 0.1, 0.62)), mats.black, 0, 0.03, 0, g);
      mesh(geo('steamCabin', () => new T.BoxGeometry(0.18, 0.1, 0.22)), mats.white, 0, 0.13, -0.05, g);
      mesh(geo('steamFunnel', () => new T.CylinderGeometry(0.03, 0.035, 0.16, 8)), mats.shipRed, 0, 0.24, 0.05, g);
      g.userData.smoke = true;
    } else if (style === 'motor') {
      mesh(geo('motorHull', () => new T.BoxGeometry(0.18, 0.07, 0.48)), mats.white, 0, 0.02, 0, g);
      mesh(geo('motorCabin', () => new T.BoxGeometry(0.14, 0.07, 0.14)), mats.glassBlue, 0, 0.09, -0.04, g);
      mesh(geo('motorStripe', () => new T.BoxGeometry(0.182, 0.015, 0.482)), mats.shipRed, 0, 0.04, 0, g);
    } else if (style === 'hover') {
      mesh(geo('hoverBody', () => new T.CylinderGeometry(0.16, 0.2, 0.06, 20)), mats.whiteGloss, 0, 0.08, 0, g);
      mesh(geo('hoverRing', () => new T.TorusGeometry(0.19, 0.012, 6, 24)), mats.neonCyan, 0, 0.05, 0, g).rotation.x = Math.PI / 2;
      mesh(geo('hoverDome', () => new T.SphereGeometry(0.08, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)), mats.glassBlue, 0, 0.11, 0, g);
    } else {
      mesh(geo('hull', () => new T.BoxGeometry(0.22, 0.08, 0.5)), mats.wood, 0, 0.02, 0, g);
      mesh(geo('boatMast', () => new T.CylinderGeometry(0.008, 0.008, 0.5, 5)), mats.woodDark, 0, 0.3, 0, g);
      const sailGeo = geo('sailTri', () => {
        const sg = new T.BufferGeometry();
        sg.setAttribute('position', new T.BufferAttribute(new Float32Array([0, 0.1, 0.02, 0, 0.52, 0.02, 0, 0.1, 0.24]), 3));
        sg.computeVertexNormals();
        return sg;
      });
      mesh(sailGeo, mats.sail, 0, 0, 0, g);
    }
    return g;
  }
  function makeCritters() {
    critterGroup.clear();
    critters.birds = [];
    const birdMat = std(0x2f3540);
    for (let i = 0; i < 5; i++) {
      const g = new T.Group();
      mesh(geo('birdBody', () => new T.ConeGeometry(0.035, 0.14, 5)), birdMat, 0, 0, 0, g).rotation.x = Math.PI / 2;
      const wl = mesh(geo('wing', () => new T.BoxGeometry(0.16, 0.006, 0.05)), birdMat, -0.08, 0, 0, g);
      const wr = mesh(geo('wing', () => new T.BoxGeometry(0.16, 0.006, 0.05)), birdMat, 0.08, 0, 0, g);
      critterGroup.add(g);
      critters.birds.push({ g, wl, wr, r: 2 + rand() * layout.townR, h: 2.4 + rand() * 2, sp: (0.25 + rand() * 0.25) * (rand() < 0.5 ? -1 : 1), a: rand() * Math.PI * 2, ph: rand() * 10 });
    }
    makeBoat();
    const cat = new T.Group();
    const body = mesh(geo('catBody', () => new T.BoxGeometry(0.06, 0.06, 0.14)), mats.cat, 0, 0.06, 0, cat);
    mesh(geo('catHead', () => new T.BoxGeometry(0.065, 0.06, 0.06)), mats.cat, 0, 0.1, 0.085, cat);
    for (const s of [-1, 1]) mesh(geo('catEar', () => new T.ConeGeometry(0.015, 0.03, 4)), mats.cat, s * 0.02, 0.14, 0.085, cat);
    const tail = mesh(geo('catTail', () => new T.CylinderGeometry(0.008, 0.008, 0.12, 4)), mats.cat, 0, 0.1, -0.1, cat);
    tail.rotation.x = -0.6;
    for (const [sx, sz] of [[-0.02, 0.05], [0.02, 0.05], [-0.02, -0.05], [0.02, -0.05]]) mesh(geo('catLeg', () => new T.BoxGeometry(0.015, 0.04, 0.015)), mats.cat, sx, 0.02, sz, cat);
    const hit = mesh(geo('catHit', () => new T.SphereGeometry(0.2, 6, 5)), mats.hit, 0, 0.08, 0, cat);
    cat.traverse((o) => { if (o.isMesh) { o.castShadow = o !== hit; o.userData.cat = true; } });
    critterGroup.add(cat);
    critters.cat = { g: cat, body, tail, a: rand() * Math.PI * 2, target: 0, pause: 2, run: 0, sit: false, dir: 1, host: { x: 0, y: 0, z: 0, bubble: null } };
    critters.cat.target = critters.cat.a + 1;
    const fg = new T.BufferGeometry();
    fg.setAttribute('position', new T.BufferAttribute(new Float32Array(24 * 3), 3));
    const flies = new T.Points(fg, new T.PointsMaterial({ color: 0xfff27a, size: 0.05, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending }));
    flies.frustumCulled = false;
    critterGroup.add(flies);
    critters.flies = { p: flies, seeds: Array.from({ length: 24 }, () => [rand() * 10, rand() * 10, rand() * 10]) };
  }
  function makeBoat() {
    const a = critters.boat ? critters.boat.a : rand() * Math.PI * 2;
    if (critters.boat) critterGroup.remove(critters.boat.g);
    const g = boatFor(look().boat);
    critterGroup.add(g);
    critters.boat = { g, a, puff: 0 };
  }
  function stepCritters(t, dt) {
    for (const b of critters.birds) {
      b.g.visible = sky.day > 0.3 && weather.rain < 0.5;
      if (!b.g.visible) continue;
      b.a += (b.sp * dt) / Math.max(1, b.r / 3);
      b.g.position.set(Math.cos(b.a) * b.r, b.h + Math.sin(t * 0.7 + b.ph) * 0.3, Math.sin(b.a) * b.r);
      b.g.rotation.y = Math.atan2(-Math.sin(b.a) * Math.sign(b.sp), Math.cos(b.a) * Math.sign(b.sp));
      const flap = still ? 0 : Math.sin(t * 12 + b.ph) * 0.6;
      b.wl.rotation.z = flap;
      b.wr.rotation.z = -flap;
    }
    const bt = critters.boat;
    // The boat sails up and down the coast, out at sea.
    if (bt) bt.g.visible = layout.coastD > 0;
    if (bt && layout.coastD > 0) {
      bt.a += dt * (look().boat === 'motor' || look().boat === 'hover' ? 0.07 : 0.03);
      const sa = layout.seaAngle;
      const off = layout.coastD + 2.4;
      const sway = Math.sin(bt.a) * 6;
      const hover = look().boat === 'hover';
      bt.g.position.set(Math.cos(sa) * off - Math.sin(sa) * sway, (hover ? -0.04 : -0.12) + Math.sin(t * 1.3) * 0.03, Math.sin(sa) * off + Math.cos(sa) * sway);
      const dir = Math.cos(bt.a) >= 0 ? 1 : -1;
      bt.g.rotation.y = Math.atan2(-Math.sin(sa) * dir, Math.cos(sa) * dir);
      bt.g.rotation.z = hover ? 0 : Math.sin(t * 1.1) * 0.06;
      if (bt.g.userData.smoke && !still) {
        bt.puff -= dt;
        if (bt.puff <= 0) { bt.puff = 0.7; burst({ x: bt.g.position.x, y: bt.g.position.y + 0.35, z: bt.g.position.z, count: 6, colors: ['#5d636e', '#7a808a'], speed: 0.08, life: 2, size: 0.09, gravity: -0.3, up: 1, grow: 0.06 }); }
      }
    }
    const c = critters.cat;
    if (c) {
      const r = R * SQ3 * 1.5;
      if (c.pause > 0) { c.pause -= dt; c.sit = true; }
      else {
        c.sit = false;
        const diff = c.target - c.a;
        const sp = (c.run > 0 ? 1.4 : 0.35) / r;
        c.a += Math.sign(diff) * Math.min(Math.abs(diff), sp * dt);
        c.run = Math.max(0, c.run - dt);
        c.dir = Math.sign(diff) || c.dir;
        if (Math.abs(diff) < 0.01) { c.pause = 2 + rand() * 6; c.target = c.a + (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 1.5); }
      }
      c.g.position.set(Math.cos(c.a) * r, PATH_TOP, Math.sin(c.a) * r);
      c.g.rotation.y = Math.atan2(-Math.sin(c.a) * c.dir, Math.cos(c.a) * c.dir);
      c.body.position.y = c.sit ? 0.045 : 0.06;
      c.tail.rotation.z = still ? 0 : Math.sin(t * 3) * 0.4;
      c.host.x = c.g.position.x;
      c.host.z = c.g.position.z;
    }
    const fl = critters.flies;
    if (fl) {
      fl.p.material.opacity = sky.night > 0.5 && season !== 'winter' ? (sky.night - 0.5) * 1.8 : 0;
      if (fl.p.material.opacity > 0) {
        const spots = [...builds.values()].filter((v) => v.b.built && (v.b.item === 'park' || v.b.item === 'garden'));
        const arr = fl.p.geometry.attributes.position.array;
        fl.seeds.forEach((s, i) => {
          const home = spots.length ? spots[i % spots.length].root.position : { x: Math.cos(i) * layout.townR * 0.6, z: Math.sin(i) * layout.townR * 0.6 };
          arr[i * 3] = home.x + Math.sin(t * 0.3 + s[0]) * 0.5;
          arr[i * 3 + 1] = 0.3 + Math.sin(t * 0.7 + s[1]) * 0.15;
          arr[i * 3 + 2] = home.z + Math.cos(t * 0.25 + s[2]) * 0.5;
        });
        fl.p.geometry.attributes.position.needsUpdate = true;
      }
    }
    if (ship && ship.hopT < 1) {
      ship.hopT = Math.min(1, ship.hopT + dt / 2.4);
      ship.g.position.y = TILE_TOP + Math.sin(ship.hopT * Math.PI) * ship.amp;
      if (ship.hopT >= 1) { ship.g.position.y = TILE_TOP; ship.amp = 0; }
    }
  }

  // --- Labels, nametags, speech bubbles and "+2 wood" pops (HTML over the canvas) ---------
  function addLabel(kind, text) {
    const e = document.createElement('div');
    e.className = kind === 'tag' ? 'nametag' : 'blabel';
    if (kind === 'tag') e.textContent = text;
    e.hidden = true;
    overlay.append(e);
    return { el: e, kind, shown: false, w: 0, h: 0, bot: null };
  }
  function setShown(L, vis) {
    if (vis !== L.shown) { L.el.hidden = !vis; L.shown = vis; }
  }
  function measure(L) {
    if (L.w) return;
    L.el.hidden = false;
    L.w = L.el.offsetWidth;
    L.h = L.el.offsetHeight;
    L.el.hidden = !L.shown;
  }
  const resName = (r) => (RESOURCES[r] ? RESOURCES[r].emoji + ' ' + RESOURCES[r].label.toLowerCase() : r);
  function buildLabel(v) {
    if (!v.label) {
      v.label = addLabel('build');
      v.label.parts = {};
      v.label.el.innerHTML = '<span class="em"></span><span class="bl-main"><b></b><small></small></span><span class="bar"><span></span></span>';
      v.label.parts.em = v.label.el.querySelector('.em');
      v.label.parts.title = v.label.el.querySelector('b');
      v.label.parts.sub = v.label.el.querySelector('small');
      v.label.parts.bar = v.label.el.querySelector('.bar');
      v.label.parts.fill = v.label.el.querySelector('.bar span');
    }
    const L = v.label;
    const b = v.b;
    const item = ITEMS[b.item] || { label: b.item, emoji: '📦' };
    const bd = data.builders.get(b.ownerId);
    let title;
    let sub;
    let bar = null;
    if (b.wonder) {
      const pr = progressOf(b);
      title = item.label + (b.status === 'done' ? '' : ' ' + Math.floor(pr * 100) + '%');
      const short = data.econ?.wonder?.id === b.id ? data.econ.wonder.short : [];
      sub = b.status === 'done' ? 'Wonder of the ' + ERAS[item.era].name : short.length ? 'needs ' + short.map(resName).join(', ') : 'wonder · !help wonder to haul';
      if (b.status !== 'done') bar = pr;
    } else if (v.damaged) {
      title = '🔧 ' + item.label + ' is broken';
      sub = '!repair to fix it';
    } else if (b.project && b.status !== 'done' && !b.evolving) {
      // A town project: how far along, who helps, what it waits for.
      const pr = progressOf(b);
      title = item.label + ' ' + Math.floor(pr * 100) + '% #' + b.id;
      let helpers = 0;
      for (const j of data.jobs.values()) if (j.buildId === b.id && j.kind === 'build') helpers++;
      if (b.status === 'queued' && b.waitingFor?.length) sub = 'needs ' + b.waitingFor.map(resName).join(', ') + ' · ' + (GATHER[b.waitingFor[0]] ? '!' : '!work ') + b.waitingFor[0];
      else sub = (helpers ? helpers + (helpers === 1 ? ' helper' : ' helpers') : 'nobody helping yet') + ' · !help #' + b.id;
      bar = pr;
    } else if (b.home && b.status === 'done') {
      title = (bd ? bd.name + "'s home" : item.label) + (b.level > 1 ? ' · level ' + b.level : '');
      sub = item.label + ' #' + b.id;
    } else {
      const to = b.upgrade ? ITEMS[b.upgrade.item] : null;
      title = (to && to !== item ? item.label + ' → ' + to.label : item.label + (b.upgrade ? ' → level ' + b.upgrade.level : '')) + ' #' + b.id;
      const founder = data.builders.get(b.founderId);
      sub = b.evolving ? 'the ' + ERAS[era].name + ' is here' : bd ? bd.name + (b.home ? "'s home" : '') : founder ? 'started by ' + founder.name : 'town';
      if (b.status === 'queued') sub += b.waitingFor?.length ? ' · waiting for ' + b.waitingFor.map(resName).join(', ') : ' · waiting for a builder';
      if (b.status === 'building') bar = progressOf(b);
    }
    if (L.parts.title.textContent !== title) { L.parts.title.textContent = title; L.w = 0; }
    if (L.parts.sub.textContent !== sub) { L.parts.sub.textContent = sub; L.w = 0; }
    if (L.parts.em.textContent !== item.emoji) L.parts.em.textContent = item.emoji;
    L.parts.bar.hidden = bar == null;
    if (bar != null) L.parts.fill.style.width = Math.round(bar * 100) + '%';
    L.el.classList.toggle('done', b.status === 'done' && !v.damaged);
    L.el.classList.toggle('wonder', !!b.wonder);
    L.el.classList.toggle('broken', v.damaged);
    return L;
  }
  function showBubble(host, text, ms, emoji) {
    if (!host.bubble) {
      const e = document.createElement('div');
      overlay.append(e);
      host.bubble = { el: e, until: 0, w: 0, h: 0 };
    }
    const bb = host.bubble;
    bb.el.className = 'bubble' + (emoji ? ' emoji' : '');
    bb.el.textContent = text;
    bb.until = performance.now() + ms;
    bb.w = 0;
    bb.el.hidden = false;
  }
  function removeBubble(host) {
    if (host.bubble) { host.bubble.el.remove(); host.bubble = null; }
  }
  const ghostBubbles = [];
  function bubbleAt(x, y, z, text, ms = 2500) {
    const host = { x, y, z, bubble: null, ghost: true };
    showBubble(host, text, ms);
    ghostBubbles.push(host);
  }
  const pops = [];
  function addPop(v, out) {
    popAt(v.root.position.x, v.root.position.y + v.h + 0.1, v.root.position.z, out);
  }
  function popAt(x, y, z, out) {
    if (pops.length >= (low ? 4 : 8)) return;
    const e = document.createElement('div');
    e.className = 'pop';
    e.textContent = Object.entries(out).map(([r, n]) => '+' + Math.round(n) + ' ' + (RESOURCES[r] ? RESOURCES[r].emoji : '')).join('  ');
    overlay.append(e);
    pops.push({ el: e, x, y, z, t0: performance.now() });
  }
  const v3 = new T.Vector3();
  function project(x, y, z) {
    v3.set(x, y, z).project(camera);
    return { vis: v3.z < 1 && Math.abs(v3.x) < 1.1 && Math.abs(v3.y) < 1.1, x: (v3.x * 0.5 + 0.5) * stageW, y: (-v3.y * 0.5 + 0.5) * stageH };
  }
  function updateOverlay() {
    const placed = (opts.blocked ? opts.blocked() : []).slice();
    const camDist = camera.position.distanceTo(controls.target);
    const t = performance.now();
    const fits = (r) => !placed.some((p) => r.l < p.r && r.r > p.l && r.t < p.b && r.b > p.t);
    for (let i = pops.length - 1; i >= 0; i--) {
      const p = pops[i];
      const k = (t - p.t0) / 1600;
      if (k >= 1) { p.el.remove(); pops.splice(i, 1); continue; }
      const s = project(p.x, p.y + k * 0.35, p.z);
      p.el.hidden = !s.vis;
      p.el.style.opacity = String(1 - k * k);
      p.el.style.transform = 'translate(' + s.x.toFixed(1) + 'px,' + s.y.toFixed(1) + 'px) translate(-50%,-100%)';
    }
    const hosts = [...bots.values()].filter((b) => b.bubble).concat(ghostBubbles.filter((h) => h.bubble));
    if (critters.cat && critters.cat.host.bubble) hosts.push(critters.cat.host);
    for (const h of hosts) {
      const bb = h.bubble;
      if (t > bb.until) { removeBubble(h); continue; }
      const p = project(h.x, (h.y || 0) + (h.parts ? 0.62 : 0.35), h.z);
      bb.el.hidden = !p.vis || !!lapse;
      if (!p.vis) continue;
      if (!bb.w) { bb.w = bb.el.offsetWidth; bb.h = bb.el.offsetHeight; }
      bb.el.style.transform = 'translate(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px) translate(-50%,-100%)';
      placed.push({ l: p.x - bb.w / 2, r: p.x + bb.w / 2, t: p.y - bb.h, b: p.y });
    }
    for (let i = ghostBubbles.length - 1; i >= 0; i--) if (!ghostBubbles[i].bubble) ghostBubbles.splice(i, 1);
    // Build labels: wonders and work in progress first, then finished ones up close.
    const target = controls.target;
    const order = [...builds.values()].map((v) => {
      const active = v.b.status !== 'done' || v.damaged || (v.doneAt > 0 && t - v.doneAt < 7000);
      const rank = v.b.wonder ? 2 : active ? 1 : 0;
      const d = Math.hypot(v.root.position.x - target.x, v.root.position.z - target.z);
      return { v, active, rank, d };
    }).sort((a, b) => b.rank - a.rank || a.d - b.d);
    let doneShown = 0;
    for (const { v, active, d } of order) {
      const wantDone = !active && camDist < 5.5 && d < 3.2 && doneShown < 10;
      const wonderDone = v.b.wonder && v.b.status === 'done' && camDist > 5.5;
      if (lapse || wonderDone || (!active && !wantDone && !v.b.wonder)) { if (v.label) setShown(v.label, false); continue; }
      if (!active) doneShown++;
      const L = buildLabel(v);
      const top = v.root.position.y + (v.body ? v.h * v.body.scale.y : 0.1) + 0.12;
      const p = project(v.root.position.x, Math.max(top, 0.45), v.root.position.z);
      let vis = p.vis;
      if (vis) {
        measure(L);
        let ok = false;
        for (const dy of [0, -(L.h + 4), -2 * (L.h + 4)]) {
          const r = { l: p.x - L.w / 2 - 3, r: p.x + L.w / 2 + 3, t: p.y + dy - L.h - 2, b: p.y + dy + 2 };
          if (fits(r)) { placed.push(r); ok = true; L.el.style.transform = 'translate(' + p.x.toFixed(1) + 'px,' + (p.y + dy).toFixed(1) + 'px) translate(-50%,-100%)'; break; }
        }
        vis = ok;
      }
      setShown(L, vis);
    }
    // Nametags under the bots.
    const showTags = camDist < 8.5 && !lapse;
    const near = [...bots.values()].sort((a, b) => !!b.beacon - !!a.beacon || Math.hypot(a.x - target.x, a.z - target.z) - Math.hypot(b.x - target.x, b.z - target.z));
    near.forEach((b, i) => {
      const L = b.tag;
      if (!(showTags || (b.beacon && !lapse)) || i > 24 || b.bubble || b.mode === 'arrive') { setShown(L, false); return; }
      const p = project(b.x, b.y - 0.02, b.z);
      let vis = p.vis;
      if (vis) {
        measure(L);
        const r = { l: p.x - L.w / 2 - 2, r: p.x + L.w / 2 + 2, t: p.y, b: p.y + L.h };
        vis = fits(r);
        if (vis) { placed.push(r); L.el.style.transform = 'translate(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px) translate(-50%,0)'; }
      }
      setShown(L, vis);
    });
  }

  // --- Camera ---------------------------------------------------------------------------------
  let stageW = 1;
  let stageH = 1;
  let view = { visW: 1, visH: 1, f: 1 };
  const elevation = () => (stageW / stageH < 0.8 ? 0.92 : 0.72);
  function resize() {
    stageW = Math.max(1, stage.clientWidth);
    stageH = Math.max(1, stage.clientHeight);
    renderer.setSize(stageW, stageH, false);
    updateView();
  }
  // The HUD covers parts of the screen; aim the camera at the middle of what is left.
  function updateView() {
    const w = stageW;
    const h = stageH;
    const ins = opts.insets ? opts.insets() : { left: 0, right: 0, top: 0, bottom: 0 };
    const visW = Math.max(160, w - ins.left - ins.right);
    const visH = Math.max(160, h - ins.top - ins.bottom);
    const dx = ins.left + visW / 2 - w / 2;
    const dy = ins.top + visH / 2 - h / 2;
    const fullW = w + 2 * Math.abs(dx);
    const fullH = h + 2 * Math.abs(dy);
    const base = w / h < 0.8 ? 44 : 32;
    const tb = Math.tan((base * Math.PI) / 360);
    camera.fov = (Math.atan((tb * fullH) / h) * 360) / Math.PI;
    camera.aspect = fullW / fullH;
    camera.setViewOffset(fullW, fullH, dx < 0 ? -2 * dx : 0, dy < 0 ? -2 * dy : 0, w, h);
    camera.updateProjectionMatrix();
    view = { visW, visH, f: h / 2 / tb };
    controls.maxDistance = opts.stream ? fitDistance() * 1.9 : Math.max(fitDistance() * 1.9, fitDistance(layout.knownR) * 1.3);
  }
  // How far back the camera has to be to see the town (or rings tiles out).
  function fitDistance(rings) {
    const s = (rings || layout.extent) * SQ3 * R + R;
    const dW = (s * view.f) / (view.visW / 2);
    const dH = ((s * Math.sin(elevation()) + 0.6) * view.f) / (view.visH / 2);
    return Math.max(3, Math.min(80, Math.max(dW, dH) * 0.95));
  }
  function frameCamera() {
    focus = null;
    const d = fitDistance();
    const el = elevation();
    const az = 0.72;
    controls.target.set(0, 0, 0);
    camera.position.set(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);
    controls.update();
    updateFog();
  }
  function updateFog() {
    const d = camera.position.distanceTo(controls.target);
    scene.fog.near = d * 1.1;
    scene.fog.far = d * 3.2 + 12;
  }
  function clampTarget() {
    const t = controls.target;
    t.y = 0;
    const len = Math.hypot(t.x, t.z);
    const max = (layout.knownR + 1) * SQ3 * R;
    if (len > max) { t.x *= max / len; t.z *= max / len; }
  }
  let focus = null;
  let zoomGoal = null; // where the mouse wheel is taking the camera
  function flyTo(x, z, want, dur, track) {
    const offset = camera.position.clone().sub(controls.target);
    // Never fly with a camera sitting on its target: look from the usual angle.
    if (offset.length() < 1.5 || !Number.isFinite(offset.length())) {
      const el = elevation();
      offset.set(Math.sin(0.72) * Math.cos(el), Math.sin(el), Math.cos(0.72) * Math.cos(el)).multiplyScalar(Math.max(3, want || 8));
    }
    zoomGoal = null;
    focus = { from: controls.target.clone(), to: new T.Vector3(x, 0, z), offset, want, start: performance.now(), dur: still ? 0 : dur, track: track || null };
  }
  function stepFocus(dt) {
    if (focus) {
      const k = focus.dur ? Math.min(1, (performance.now() - focus.start) / focus.dur) : 1;
      const e = 1 - Math.pow(1 - k, 3);
      const to = focus.track ? new T.Vector3(focus.track.x, 0, focus.track.z) : focus.to;
      const target = focus.from.clone().lerp(to, e);
      const len = focus.offset.length();
      const off = focus.offset.clone().setLength(len + (focus.want - len) * e);
      controls.target.copy(target);
      camera.position.copy(target).add(off);
      if (k >= 1) { tour.track = focus.track; focus = null; }
      return;
    }
    const tr = tour.track;
    if (tr) {
      if (!bots.has(tr.id)) { tour.track = null; return; }
      const delta = new T.Vector3(tr.x, 0, tr.z).sub(controls.target).multiplyScalar(Math.min(1, dt * 2.5));
      controls.target.add(delta);
      camera.position.add(delta);
    }
  }
  // Wheel zoom of our own. The one in OrbitControls (three r160) divides by the
  // whole part of devicePixelRatio, which is 0 when the browser is zoomed out
  // below 100%, and then every notch jumps to the nearest or farthest view.
  stage.addEventListener('wheel', (e) => {
    if (!controls.enabled) return;
    e.preventDefault();
    e.stopPropagation();
    const px = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : 1);
    if (!px) return;
    focus = null;
    const from = zoomGoal ?? camera.position.distanceTo(controls.target);
    const notches = Math.max(-3, Math.min(3, px / 100));
    zoomGoal = Math.max(controls.minDistance, Math.min(controls.maxDistance, from * Math.pow(1.12, notches)));
  }, { capture: true, passive: false });
  function stepZoom(dt) {
    if (zoomGoal == null) return;
    const offset = camera.position.clone().sub(controls.target);
    const d = offset.length();
    const next = still ? zoomGoal : d + (zoomGoal - d) * Math.min(1, dt * 14);
    camera.position.copy(controls.target).add(offset.setLength(next));
    if (Math.abs(next - zoomGoal) < 0.005) zoomGoal = null;
  }
  // In stream mode the camera directs itself: it flies to whatever chat just
  // did, and otherwise slowly tours the island.
  const tour = { next: 0, i: 0, track: null, lastEvent: 0, prio: 0 };
  function interest(prio, x, z, want, track, hold) {
    if (!opts.stream || lapse) return;
    const t = performance.now();
    if (t - tour.lastEvent < 6000 && prio < tour.prio) return;
    tour.lastEvent = t;
    tour.prio = prio;
    tour.track = null;
    tour.next = t + (hold || 9000);
    flyTo(x, z, want, 1400, track);
  }
  function stepTour() {
    if (!opts.stream || still || lapse) return;
    const t = performance.now();
    controls.autoRotate = !tour.track;
    if (t < tour.next) return;
    tour.next = t + 15000;
    tour.prio = 0;
    tour.track = null;
    tour.i++;
    const all = [...builds.values()];
    const busy = all.filter((v) => v.b.status === 'building' && !v.b.wonder);
    const done = all.filter((v) => v.b.built && !v.b.wonder);
    const walkers = [...bots.values()].filter((b) => b.mode === 'walk' || b.mode === 'work' || b.mode === 'job' || b.mode === 'act');
    const wonder = all.find((v) => v.b.wonder && v.b.item === ERAS[era].wonder);
    const step = tour.i % 5;
    if (step === 0 || (!busy.length && !done.length && !walkers.length)) flyTo(0, 0, fitDistance(), 2600);
    else if (step === 1 && busy.length) { const v = pick(busy); flyTo(v.root.position.x, v.root.position.z, 9, 2400); }
    else if (step === 2 && walkers.length) { const b = pick(walkers); flyTo(b.x, b.z, 8, 2400, b); }
    else if (step === 3 && wonder) flyTo(wonder.root.position.x * 0.6, wonder.root.position.z * 0.6, 8, 2400);
    else if (done.length) { const v = pick(done.slice(-15)); flyTo(v.root.position.x, v.root.position.z, 9, 2400); }
    else flyTo(0, 0, fitDistance() * 0.8, 2600);
  }

  // --- Timelapse: the island growing from its first hut to now -------------------------------
  let lapse = null;
  function startTimelapse(info) {
    if (lapse || !builds.size) return;
    lapse = { from: info.createdAt, to: now(), start: performance.now(), dur: (info.seconds || 36) * 1000, rotate: controls.autoRotateSpeed };
    focus = null;
    tour.track = null;
    flyTo(0, 0, fitDistance() * 1.02, 1500);
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.6;
  }
  function stepTimelapse() {
    if (!lapse) return;
    const k = Math.min(1, (performance.now() - lapse.start) / lapse.dur);
    const at = lapse.from + (lapse.to - lapse.from) * Math.min(1, k * 1.08);
    for (const v of builds.values()) {
      const when = v.b.wonder ? v.b.requestedAt : v.b.doneAt || v.b.startedAt || v.b.requestedAt || 0;
      v.root.visible = when <= at;
    }
    for (const b of bots.values()) b.parts.g.visible = false;
    if (opts.onTimelapse) opts.onTimelapse({ at, k, from: lapse.from });
    if (k >= 1) {
      for (const v of builds.values()) v.root.visible = true;
      for (const b of bots.values()) b.parts.g.visible = true;
      controls.autoRotateSpeed = lapse.rotate;
      lapse = null;
      tour.next = performance.now() + 4000;
      if (opts.onTimelapse) opts.onTimelapse(null);
    }
  }

  // --- Pointer: tap bots, buildings, the cat and the ship (not in stream mode) -------------------
  function bindPointer() {
    const cv = renderer.domElement;
    let down = null;
    cv.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    cv.addEventListener('pointermove', (e) => { if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) { focus = null; tour.track = null; } });
    cv.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.t < 600;
      down = null;
      if (moved > 8 || !quick) return;
      if (!audio.on && opts.onFirstTap) opts.onFirstTap();
      const rect = cv.getBoundingClientRect();
      const ndc = new T.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects([botGroup, buildGroup, critterGroup, ship.g], true);
      const hit = hits.find((h) => h.object.userData.cat || h.object.userData.ship || h.object.userData.buildId || botOf(h.object));
      if (!hit) return;
      const o = hit.object;
      if (o.userData.cat) {
        const c = critters.cat;
        showBubble(c.host, 'Meow!', 1800);
        c.pause = 0;
        c.run = 3;
        c.target = c.a + (rand() < 0.5 ? -1 : 1) * 2.4;
        audio.sfx('meow');
      } else if (o.userData.ship) {
        shipHop(0.5);
        audio.sfx('whoosh');
        bubbleAt(0, 1.1, 0.3, 'New bots land here.');
      } else if (botOf(o)) {
        tapBot(botOf(o));
      } else {
        const v = builds.get(o.userData.buildId);
        if (v) {
          const bd = data.builders.get(v.b.ownerId);
          const p = v.root.position;
          bubbleAt(p.x, v.h + 0.15, p.z, (ITEMS[v.b.item]?.label || v.b.item) + ' #' + v.b.id + (bd ? ' by ' + bd.name : ''), 3200);
          audio.sfx('tap');
        }
      }
    });
  }
  function botOf(o) {
    for (const b of bots.values()) {
      let x = o;
      while (x) { if (x === b.parts.g) return b; x = x.parent; }
    }
    return null;
  }
  function tapBot(b) {
    const t = performance.now();
    b.taps = t - b.lastTap < 6000 ? b.taps + 1 : 1;
    b.lastTap = t;
    const kind = b.taps >= 4 ? 'dizzy' : ['wave', 'jump', 'spin'][b.taps - 1];
    b.react = { kind, t: 0, dur: kind === 'dizzy' ? 2.6 : kind === 'spin' ? 1.1 : 1.4 };
    audio.sfx(kind === 'dizzy' ? 'boing' : 'tap', distVol(b));
    const text = b.taps >= 4 ? pick(LINES.poke) : pick(LINES.hello).replace('{name}', b.builder.name);
    showBubble(b, text, 3800);
  }
  function distVol(p) {
    const d = Math.hypot(p.x - controls.target.x, p.z - controls.target.z) + camera.position.distanceTo(controls.target) * 0.5;
    return Math.max(0.08, Math.min(1, 1 - (d - 2) / 12));
  }

  // --- Eras -----------------------------------------------------------------------------------
  function applyEra(e) {
    era = Math.max(0, Math.min(ERAS.length - 1, e || 0));
    mats.path.color.set(look().path);
    mats.bot.color.set(look().bot);
    rebuildLamps();
    if (world) makeBoat();
    updateSky();
  }

  // --- Main loop --------------------------------------------------------------------------------
  let skyTimer = 0;
  let frame = 0;
  function loop() {
    requestAnimationFrame(loop);
    if (document.hidden && !opts.stream) { clock.getDelta(); return; }
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;
    frame++;
    stepTimelapse();
    stepTour();
    stepFocus(dt);
    stepZoom(dt);
    controls.update();
    skyTimer -= dt;
    if (skyTimer <= 0) { skyTimer = 4; updateSky(); }
    updateWeather(dt);
    for (const b of [...bots.values()]) stepBot(b, t, dt);
    for (const p of [...porters]) stepBot(p, t, dt);
    stepBuilds(t, dt);
    stepTrain(dt);
    stepEvents(t, dt);
    stepCritters(t, dt);
    stepParticles(dt);
    stepHighlights(dt);
    stepBeacons(dt);
    stepReveals(dt);
    if (frame % 3 === 0) { followSun(false); updateFog(); renderer.shadowMap.needsUpdate = true; }
    renderer.render(scene, camera);
    updateOverlay();
  }

  // --- Start ------------------------------------------------------------------------------------
  audio.weather = () => ({ rain: weather.rain, day: sky.day });
  resize();
  new ResizeObserver(resize).observe(stage);
  if (!opts.stream) bindPointer();
  requestAnimationFrame(loop);

  function afterBuildsChanged() {
    if (!world) return;
    updateTownSize();
    rebuildLamps();
    refreshTiles();
    refreshPois();
    syncTrain();
  }

  return {
    // The whole world at once (first connect, or after a reconnect).
    load(list, builderList, extra = {}) {
      setGeo(extra.geo);
      data.builders = new Map(builderList.map((b) => [b.id, b]));
      // A new world (or the first connect): draw the map. A reconnect only
      // catches up on what was explored meanwhile.
      if (extra.map && (layout.seed !== extra.map.seed || !world)) buildWorld(extra.map, extra.explored);
      else if (extra.explored && layout.map) {
        const bits = decodeBits(extra.explored, layout.map);
        const fresh = [];
        for (let i = 0; i < layout.map.total; i++) if (!known[i] && isExplored(bits, i)) fresh.push(i);
        if (fresh.length) revealTiles(fresh, false);
      }
      data.jobs = new Map(Object.entries(extra.jobs || {}));
      data.econ = extra.econ || data.econ;
      if (extra.era != null && extra.era !== era) applyEra(extra.era);
      data.finale = !!extra.finished;
      setEvent(extra.event || null);
      const ids = new Set(list.map((b) => b.id));
      for (const id of [...builds.keys()]) if (!ids.has(id)) removeBuild(id, false);
      for (const b of list) syncBuild(b, false);
      afterBuildsChanged();
      syncBots(null);
      for (const b of bots.values()) if (b.mode !== 'walk' && b.mode !== 'arrive') decide(b);
    },
    updateBuild(b) {
      const before = builds.get(b.id)?.b;
      const changed = !before || before.status !== b.status || before.item !== b.item || before.level !== b.level || !!before.damaged !== !!b.damaged || !!before.built !== !!b.built;
      const { v, prev, finished } = syncBuild(b, true);
      // Projects send their progress every few seconds: only redraw the map when something really changed.
      if (!changed) return;
      afterBuildsChanged();
      syncBots(null);
      const bot = b.ownerId ? bots.get(b.ownerId) : null;
      if (bot && bot.mode !== 'arrive' && !(bot.mode === 'act' && bot.act === 'party')) {
        if (bot.mode !== 'walk' || !prev || prev.status !== b.status) decide(bot);
      }
      const p = v.root.position;
      if (finished) {
        if (bot && Math.hypot(bot.x - p.x, bot.z - p.z) < 1) { party(bot); showBubble(bot, pick(LINES.done), 2500); }
        if (b.project) for (const o of bots.values()) if (o !== bot && Math.hypot(o.x - p.x, o.z - p.z) < 1.2 && o.mode !== 'walk') { party(o); if (rand() < 0.5) showBubble(o, pick(LINES.done), 2500); }
        interest(b.wonder ? 4 : 3, p.x, p.z, b.wonder ? 7.5 : 8, null, b.wonder ? 12000 : 8000);
      } else if (b.status === 'building' && (!prev || prev.status !== 'building') && !b.wonder && !b.evolving) {
        if (bot) interest(2, bot.x, bot.z, 8.5, bot, 9000);
        else interest(2, p.x, p.z, 8.5, null, 9000);
      }
      if (b.damaged && prev && !prev.damaged) interest(3, p.x, p.z, 7, null, 6000);
    },
    removeBuild(id) {
      removeBuild(id, true);
      afterBuildsChanged();
    },
    updateBuilder(builder, joined) {
      data.builders.set(builder.id, builder);
      syncBots(joined ? builder.id : null);
      for (const v of builds.values()) if (v.b.ownerId === builder.id && v.label) v.label.w = 0;
      if (joined) interest(1, 0, 0, 7, null, 6000);
    },
    setJob(userId, job) {
      if (job) data.jobs.set(userId, job);
      else data.jobs.delete(userId);
      syncBots(null);
      const b = bots.get(userId);
      if (b && b.mode !== 'arrive' && b.mode !== 'walk') decide(b);
      else if (b && b.mode === 'walk' && job) decide(b);
    },
    setEconomy(econ) {
      data.econ = econ;
    },
    produce(list) {
      const camDist = camera.position.distanceTo(controls.target);
      for (const p of list) {
        const v = builds.get(p.id);
        if (!v) continue;
        const res = Object.keys(p.out)[0];
        if (rand() < 0.22) spawnPorter(v, res);
        const d = Math.hypot(v.root.position.x - controls.target.x, v.root.position.z - controls.target.z);
        if ((camDist < 10 && d < 6) || rand() < 0.06) addPop(v, p.out);
      }
    },
    setEvent,
    // Land just explored: it rises out of the fog, with sparkles where
    // something was found.
    explore(ev) {
      if (!layout.map) return;
      revealTiles(ev.tiles || [], true);
      const at = ev.at && layout.index.get(ev.at.q + ',' + ev.at.r);
      for (const f of ev.found || []) {
        const t = layout.index.get(f.q + ',' + f.r);
        if (!t) continue;
        sparkle(t.x, LAND[t.t].top + 0.3, t.z);
        const word = { coal: '⚫ Coal!', iron: '⛓️ Iron!', ruins: '🏚️ Ruins!', tablet: '📜 An old tablet!' }[f.f];
        if (word) bubbleAt(t.x, LAND[t.t].top + 0.5, t.z, word, 4500);
      }
      const scout = ev.userId ? bots.get(ev.userId) : null;
      if (scout && ev.found?.length) showBubble(scout, 'Look what I found!', 3000);
      if (at && ev.userId) interest(ev.found?.length ? 4 : 2, at.x, at.z, ev.found?.length ? 7 : 8, null, 9000);
    },
    // !me: a beacon in your colour over your bot, a glowing ring around your
    // home, and the camera goes to see your bot.
    highlight(userId) {
      const v = homeOf(userId);
      const b = bots.get(userId);
      const bot = b && b.mode !== 'arrive' ? b : null;
      const target = bot ? { x: bot.x, z: bot.z } : v ? v.root.position : null;
      if (!target) return;
      const color = (data.builders.get(userId) || {}).color || '#3b7ddd';
      if (v) {
        const ring = mesh(new T.TorusGeometry(R * 0.95, 0.03, 6, 48), new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }), v.root.position.x, PATH_TOP + 0.04, v.root.position.z, fxGroup);
        ring.rotation.x = Math.PI / 2;
        highlights.push({ ring, t: 0 });
        sparkle(v.root.position.x, v.h + 0.3, v.root.position.z);
      }
      if (bot) addBeacon(bot, color);
      if (opts.stream) interest(5, target.x, target.z, 5.5, bot, 9000);
      else flyTo(target.x, target.z, Math.min(camera.position.distanceTo(controls.target), 7), 1400);
    },
    eraChanged(e) {
      applyEra(e);
      fireworks(0, 0, 8);
      for (const b of bots.values()) if (b.mode !== 'arrive' && b.mode !== 'walk' && b.mode !== 'work') party(b);
      interest(9, 0, 0, fitDistance(), null, 14000);
      if (opts.stream) setTimeout(() => startTimelapse({ createdAt: opts.createdAt ? opts.createdAt() : now() - DAY }), 18000);
    },
    finale() {
      data.finale = true;
      const s = [...builds.values()].find((v) => v.b.item === 'spire');
      if (s) interest(10, s.root.position.x, s.root.position.z, 6, null, 30000);
    },
    timelapse: startTimelapse,
    dance(id) {
      const b = bots.get(id);
      if (!b || b.mode === 'arrive') return;
      party(b);
      audio.sfx('party', distVol(b));
      interest(1, b.x, b.z, 5, b, 7000);
    },
    setSound(on) {
      if (on) return audio.start();
      audio.stop();
      return false;
    },
    get soundOn() { return audio.on; },
    relayout: updateView,
    // For tests and curious people: what every bot and build is doing.
    debugHide(name) {
      const o = { water, base: baseMesh, top: topMesh }[name];
      if (o) o.visible = !o.visible;
      return o ? o.visible : null;
    },
    debugTiles() {
      const e = new T.Matrix4();
      const p = new T.Vector3();
      const q = new T.Quaternion();
      const sc = new T.Vector3();
      let flat = 0;
      for (let i = 0; i < baseMesh.count; i++) { baseMesh.getMatrixAt(i, e); e.decompose(p, q, sc); if (sc.y < 0.05) flat++; }
      return { count: baseMesh.count, flat, sphere: baseMesh.boundingSphere ? baseMesh.boundingSphere.radius : null, frustum: baseMesh.frustumCulled, visible: baseMesh.visible, inScene: !!baseMesh.parent };
    },
    debug() {
      return {
        era,
        bots: [...bots.values()].map((b) => ({ id: b.id, name: b.builder.name, mode: b.mode, act: b.act, carrying: b.carrying, x: +b.x.toFixed(2), z: +b.z.toFixed(2) })),
        porters: porters.size,
        builds: [...builds.values()].map((v) => ({ id: v.id, item: v.b.item, status: v.b.status, key: v.key, scaleY: v.body ? +v.body.scale.y.toFixed(2) : 0 })),
        camera: { d: +camera.position.distanceTo(controls.target).toFixed(2), y: +camera.position.y.toFixed(2), tx: +controls.target.x.toFixed(2), tz: +controls.target.z.toFixed(2), fit: +fitDistance().toFixed(2), max: +controls.maxDistance.toFixed(2) },
        knownR: layout.knownR,
        explored: known.reduce((a, b) => a + b, 0),
        train: train ? train.style : null,
        season,
      };
    },
  };
}

function fallback(stage, text) {
  const p = document.createElement('p');
  p.className = 'no3d';
  p.textContent = text;
  stage.append(p);
  return null;
}
