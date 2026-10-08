// The island in 3D: land that grows ring by ring, the buildings chat ordered,
// and one bot per viewer that walks to its plot, hammers, chats and sleeps.
// The server decides everything; this file only makes it look alive.
import { ITEMS, hashStr } from '../shared/catalog.js';
import { landRingFor, hexDist, ringTiles } from '../shared/hex.js';
import { initMeshes, mats, geo, mesh, std, rng, glowTexture, buildingMesh, scaffoldMesh, stakeMesh, shipMesh, botMesh, hatMesh, treeMesh, benchMesh, lampMesh } from './meshes.js';
import { createAudio } from './audio.js';

const R = 0.62;
const SQ3 = Math.sqrt(3);
const PATH_TOP = 0.035;
const TILE_TOP = 0.07;
const DAY = 864e5;
const SLEEP_AFTER = 3 * DAY;
const GONE_AFTER = 14 * DAY;
const MAX_BOTS = 60;
const WALK = 0.42;
const CHAT_EMOJI = ['☕', '💬', '😄', '🔨', '🎉', '🤔', '👍', '🍕', '🌻', '✨', '🏠', '📦'];
const LINES = {
  hello: ['Hi! I am {name}.', 'Hello there!', 'Nice island, right?', 'I build what {name} asks for.'],
  work: ['Tap, tap, tap!', 'Almost there!', 'This is going to look great.', 'Hammer time!'],
  done: ['Done!', 'Ta-da!', 'Looks good!', 'Another one!'],
  sleep: ['Zzz…', 'Five more minutes…', 'Dreaming of bricks.'],
  poke: ['Hey, I am busy!', 'That tickles!', 'I am getting dizzy…'],
};
const POI_DEFS = {
  shop: ['drink', 'drink'],
  park: ['sit', 'sit'],
  campfire: ['sit', 'sit', 'sit'],
  garden: ['water'],
  farm: ['water'],
  fountain: ['look', 'look'],
  statue: ['look'],
  lighthouse: ['look'],
  tower: ['look'],
  windmill: ['look'],
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
  const rand = Math.random;
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const still = !opts.stream && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const low = opts.quality === 'low';
  const audio = createAudio();
  const data = { builders: new Map() };
  mats.path = std(0xdccfb2);

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
  const camera = new T.PerspectiveCamera(34, 1, 0.05, 400);
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
  scene.add(hemi, sun, sun.target);
  const water = new T.Mesh(new T.CircleGeometry(220, 48), mats.water);
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.55;
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

  const TILE_COLORS = { empty: new T.Color('#8ccd74'), edge: new T.Color('#9fd889'), done: new T.Color('#74bb63'), dirt: new T.Color('#b48d5f') };

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
  function onLand(x, z, margin) {
    const t = tileAtPoint(x, z);
    return !!t && Math.hypot(x - t.x, z - t.z) < R * margin;
  }

  // --- The island ------------------------------------------------------------------
  let world = null;
  let pathMesh = null;
  let tileMesh = null;
  let ship = null;
  let framedR = 0;
  const layout = { landRing: 0, tiles: [], index: new Map(), landR: 0, beachR: 0, islandR: 0, pierEnd: null };
  const nav = { nodes: [], adj: [], ring: [], keys: new Map(), door: -1 };
  let beachPois = [];
  let buildPois = [];
  const poiUser = new Map();

  function buildIsland(landRing) {
    if (world) {
      scene.remove(world);
      pathMesh.dispose();
      tileMesh.dispose();
    }
    world = new T.Group();
    scene.add(world);
    layout.landRing = landRing;
    layout.tiles = [];
    layout.index.clear();
    for (let n = 0; n <= landRing; n++) {
      for (const [q, r] of ringTiles(n)) {
        const p = hexToWorld(q, r);
        const t = { q, r, x: p.x, z: p.z, ring: n, i: layout.tiles.length };
        layout.tiles.push(t);
        layout.index.set(q + ',' + r, t);
      }
    }
    layout.landR = landRing * SQ3 * R + R;
    layout.beachR = layout.landR + 0.35;
    layout.islandR = layout.landR + 1.7;
    const island = mesh(new T.CylinderGeometry(layout.islandR, layout.islandR + 0.6, 0.6, 72), mats.sand, 0, -0.3, 0, world);
    island.receiveShadow = true;
    const n = layout.tiles.length;
    pathMesh = new T.InstancedMesh(geo('pathHex', () => new T.CylinderGeometry(R, R, PATH_TOP, 6)), mats.path, n);
    tileMesh = new T.InstancedMesh(geo('tileHex', () => new T.CylinderGeometry(R * 0.9, R * 0.92, TILE_TOP - PATH_TOP, 6)), mats.tile, n);
    const m = new T.Matrix4();
    for (const t of layout.tiles) {
      m.makeTranslation(t.x, PATH_TOP / 2, t.z);
      pathMesh.setMatrixAt(t.i, m);
      m.makeTranslation(t.x, PATH_TOP + (TILE_TOP - PATH_TOP) / 2, t.z);
      tileMesh.setMatrixAt(t.i, m);
      tileMesh.setColorAt(t.i, TILE_COLORS.empty);
    }
    pathMesh.receiveShadow = true;
    tileMesh.receiveShadow = true;
    world.add(pathMesh, tileMesh);
    mesh(geo('pad', () => new T.CylinderGeometry(R * 0.92, R * 0.92, TILE_TOP - PATH_TOP + 0.006, 6)), mats.pad, 0, (PATH_TOP + TILE_TOP) / 2 + 0.003, 0, world).receiveShadow = true;
    const mark = mesh(geo('padRing', () => new T.RingGeometry(R * 0.55, R * 0.6, 48)), mats.padMark, 0, TILE_TOP + 0.008, 0, world);
    mark.rotation.x = -Math.PI / 2;
    ship = { g: shipMesh(), hopT: 1, amp: 0 };
    ship.g.position.y = TILE_TOP;
    world.add(ship.g);
    buildNav();
    buildBeach();
    decorate();
    refreshTiles();
    refreshPois();
    const span = layout.islandR + 2;
    const sc = sun.shadow.camera;
    sc.left = -span;
    sc.right = span;
    sc.top = span;
    sc.bottom = -span;
    sc.near = 0.5;
    sc.far = span * 5;
    sc.updateProjectionMatrix();
    if (Math.abs(layout.islandR - framedR) > 0.4) {
      frameCamera();
      framedR = layout.islandR;
    }
    for (const b of bots.values()) resnap(b);
    makeCritters();
    updateSky();
  }

  function ensureLand() {
    let max = 0;
    for (const v of builds.values()) max = Math.max(max, hexDist(v.b.q, v.b.r));
    const want = landRingFor(max);
    if (want > layout.landRing) buildIsland(want);
  }

  function refreshTiles() {
    if (!tileMesh) return;
    const at = new Map();
    for (const v of builds.values()) at.set(v.b.q + ',' + v.b.r, v.b);
    for (const t of layout.tiles) {
      const b = at.get(t.q + ',' + t.r);
      let c = t.ring === layout.landRing ? TILE_COLORS.edge : TILE_COLORS.empty;
      if (b && (b.status === 'done' || b.upgradeTo)) c = TILE_COLORS.done;
      else if (b && b.status === 'building') c = TILE_COLORS.dirt;
      tileMesh.setColorAt(t.i, c);
    }
    tileMesh.instanceColor.needsUpdate = true;
    renderer.shadowMap.needsUpdate = true;
  }

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
  function segmentClear(A, B) {
    for (let i = 1; i < 10; i++) {
      const x = A.x + ((B.x - A.x) * i) / 10;
      const z = A.z + ((B.z - A.z) * i) / 10;
      if (onLand(x, z, 0.8)) return false;
    }
    return true;
  }
  function buildNav() {
    nav.nodes = [];
    nav.adj = [];
    nav.keys.clear();
    const count = new Map();
    for (const t of layout.tiles) {
      for (let k = 0; k < 6; k++) {
        const p = cornerPos(t, k);
        const key = cornerKey(p.x, p.z);
        if (!nav.keys.has(key)) nav.keys.set(key, addNode(p.x, p.z, PATH_TOP, 'corner'));
        count.set(key, (count.get(key) || 0) + 1);
      }
    }
    for (const t of layout.tiles) for (let k = 0; k < 6; k++) link(cornerNode(t, k), cornerNode(t, (k + 1) % 6));
    const n = Math.max(36, Math.round((2 * Math.PI * layout.beachR) / 0.45));
    nav.ring = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      nav.ring.push(addNode(Math.cos(a) * layout.beachR, Math.sin(a) * layout.beachR, 0, 'ring'));
    }
    for (let i = 0; i < n; i++) link(nav.ring[i], nav.ring[(i + 1) % n]);
    for (const [key, c] of count) {
      if (c > 1) continue;
      const i = nav.keys.get(key);
      const nd = nav.nodes[i];
      let best = -1;
      let bd = Infinity;
      for (const r of nav.ring) {
        const d = Math.hypot(nav.nodes[r].x - nd.x, nav.nodes[r].z - nd.z);
        if (d < bd) { bd = d; best = r; }
      }
      if (best >= 0 && segmentClear(nd, nav.nodes[best])) link(i, best);
    }
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
    const g = new Float64Array(N).fill(Infinity);
    const f = new Float64Array(N).fill(Infinity);
    const from = new Int32Array(N).fill(-1);
    const open = new Set([start]);
    const closed = new Uint8Array(N);
    const gx = nav.nodes[goal].x;
    const gz = nav.nodes[goal].z;
    const H = (i) => Math.hypot(nav.nodes[i].x - gx, nav.nodes[i].z - gz);
    g[start] = 0;
    f[start] = H(start);
    while (open.size) {
      let cur = -1;
      let best = Infinity;
      for (const i of open) if (f[i] < best) { best = f[i]; cur = i; }
      if (cur === goal) {
        const path = [cur];
        while (from[path[0]] >= 0) path.unshift(from[path[0]]);
        return path;
      }
      open.delete(cur);
      closed[cur] = 1;
      for (const [nb, d] of nav.adj[cur]) {
        if (closed[nb]) continue;
        const ng = g[cur] + d;
        if (ng < g[nb]) { g[nb] = ng; f[nb] = ng + H(nb); from[nb] = cur; open.add(nb); }
      }
    }
    return null;
  }

  // --- The beach: lamps, benches and a pier, so bots have somewhere to go --------------
  function ringNodeAt(angle) {
    const n = nav.ring.length;
    let i = Math.round((angle / (Math.PI * 2)) * n) % n;
    if (i < 0) i += n;
    return nav.ring[i];
  }
  function buildBeach() {
    beachPois = [];
    const bR = layout.beachR;
    const at = (a, r) => ({ x: Math.cos(a) * r, z: Math.sin(a) * r });
    const faceOut = (a) => Math.atan2(Math.cos(a), Math.sin(a));
    const poi = (id, x, z, y, yaw, pose, parentNode) => {
      const node = addNode(x, z, y, 'poi');
      link(node, parentNode);
      beachPois.push({ id, node, x, z, y, yaw, pose, night: false });
    };
    [1.3, 2.9, 4.5].forEach((a, i) => {
      const p = at(a, bR + 0.45);
      const g = benchMesh();
      g.position.set(p.x, 0, p.z);
      g.rotation.y = faceOut(a);
      world.add(g);
      for (const off of [-0.09, 0.09]) poi('bench' + i + off, p.x - Math.sin(a) * off, p.z + Math.cos(a) * off, 0, faceOut(a), 'sit', ringNodeAt(a));
    });
    {
      const a = -0.35;
      const len = 2.1;
      const start = layout.islandR - 0.5;
      const mid = at(a, start + len / 2);
      const g = new T.Group();
      g.position.set(mid.x, 0, mid.z);
      g.rotation.y = faceOut(a);
      mesh(geo('pierDeck', () => new T.BoxGeometry(0.36, 0.04, 2.1)), mats.wood, 0, 0.03, 0, g);
      for (const s of [-1, 1]) for (const zz of [-0.8, -0.2, 0.4, 1.0]) mesh(geo('pierPost', () => new T.CylinderGeometry(0.025, 0.025, 0.6, 6)), mats.woodDark, s * 0.17, -0.25, zz, g);
      g.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
      world.add(g);
      const p0 = at(a, start + 0.1);
      const n0 = addNode(p0.x, p0.z, 0.06, 'pier');
      link(n0, ringNodeAt(a));
      const e1 = at(a, start + len - 0.2);
      poi('pier1', e1.x, e1.z, 0.06, faceOut(a), 'fish', n0);
      const e2 = at(a + 0.08, start + len - 0.55);
      poi('pier2', e2.x, e2.z, 0.06, faceOut(a), 'fish', n0);
      layout.pierEnd = at(a, start + len + 0.4);
    }
    for (let i = 0; i < 10; i++) {
      const p = at((i / 10) * Math.PI * 2 + 0.2, bR + 0.3);
      const l = lampMesh();
      l.position.set(p.x, 0, p.z);
      world.add(l);
    }
    for (const k of [0, 2, 3, 5]) {
      const node = cornerNode(layout.tiles[0], k);
      const nd = nav.nodes[node];
      beachPois.push({ id: 'plaza' + k, node, x: nd.x, z: nd.z, y: PATH_TOP, yaw: Math.atan2(nd.x, nd.z), pose: 'look', night: false });
    }
  }
  function decorate() {
    const r = rng(1234 + layout.landRing);
    const want = Math.round(14 + layout.islandR * 3);
    const avoid = beachPois.map((p) => [p.x, p.z]).concat(layout.pierEnd ? [[layout.pierEnd.x, layout.pierEnd.z]] : []);
    let placed = 0;
    for (let i = 0; i < want * 4 && placed < want; i++) {
      const a = r() * Math.PI * 2;
      const d = layout.beachR + 0.45 + r() * (layout.islandR - layout.beachR - 0.6);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (avoid.some(([px, pz]) => Math.hypot(px - x, pz - z) < 0.7)) continue;
      if (Math.abs(Math.atan2(Math.sin(a + 0.35), Math.cos(a + 0.35))) < 0.2) continue;
      placed++;
      if (r() < 0.7) {
        const g = treeMesh(r() < 0.5);
        g.position.set(x, 0, z);
        g.scale.setScalar(0.7 + r() * 0.6);
        world.add(g);
      } else {
        const rock = mesh(geo('rock', () => new T.DodecahedronGeometry(0.12, 0)), mats.rock, x, 0.04, z, world);
        rock.scale.set(1 + r(), 0.6 + r() * 0.5, 1 + r() * 0.6);
        rock.rotation.y = r() * Math.PI;
        rock.castShadow = true;
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
  function workSpot(b) {
    const t = tileOf(b);
    if (!t) return null;
    const fr = frontCorners(t);
    return spotAt(t, fr[hashStr('w' + b.id) % 2], 0.22);
  }
  function refreshPois() {
    buildPois = [];
    for (const v of builds.values()) {
      if (v.b.status !== 'done' && !v.b.upgradeTo) continue;
      const t = tileOf(v.b);
      const defs = POI_DEFS[v.b.item];
      if (!t || !defs) continue;
      const fr = frontCorners(t);
      defs.forEach((pose, i) => {
        const k = v.b.item === 'shop' ? fr[i % 2] : (hashStr('p' + v.b.id) + i * 2) % 6;
        const s = spotAt(t, k, 0.2);
        if (s) buildPois.push({ id: v.b.id + ':' + i, node: s.node, x: s.x, z: s.z, y: s.y, yaw: s.yaw, pose, night: v.b.item === 'campfire' });
      });
    }
    const live = new Set(buildPois.map((p) => p.id).concat(beachPois.map((p) => p.id)));
    for (const id of [...poiUser.keys()]) if (!live.has(id)) poiUser.delete(id);
  }

  function setBody(v, level, celebrate) {
    if (v.body && v.level === level) return;
    if (v.body) v.root.remove(v.body);
    const made = buildingMesh(v.b, level);
    v.body = made.g;
    v.h = made.h;
    v.anim = made.anim;
    v.level = level;
    v.root.add(v.body);
    if (celebrate) v.grow = 0.25;
    renderer.shadowMap.needsUpdate = true;
  }
  function clearBody(v) {
    if (v.body) v.root.remove(v.body);
    v.body = null;
    v.level = 0;
    v.anim = [];
  }
  function setScaffold(v, on) {
    if (on && !v.scaffold) {
      v.scaffold = scaffoldMesh(Math.min(0.8, v.h));
      v.root.add(v.scaffold);
    } else if (!on && v.scaffold) {
      v.root.remove(v.scaffold);
      v.scaffold = null;
    }
  }
  function setStake(v, on) {
    if (on && !v.stake) {
      const bd = data.builders.get(v.b.ownerId);
      v.stake = stakeMesh(bd ? bd.color : '#3b7ddd');
      v.stake.position.set(0.18, 0, 0.18);
      v.root.add(v.stake);
    } else if (!on && v.stake) {
      v.root.remove(v.stake);
      v.stake = null;
    }
  }
  function progressOf(b) {
    if (b.status === 'done') return 1;
    if (b.status !== 'building') return 0;
    return Math.max(0, Math.min(1, (now() - b.startedAt - b.walkSec * 1000) / (b.buildSec * 1000)));
  }
  function syncBuild(b, live) {
    let v = builds.get(b.id);
    const prev = v ? v.b : null;
    if (!v) {
      const p = hexToWorld(b.q, b.r);
      v = { id: b.id, b, root: new T.Group(), body: null, level: 0, h: 0.4, anim: [], scaffold: null, stake: null, label: null, grow: 1, puff: 0, doneAt: 0, drop: 0 };
      v.root.position.set(p.x, TILE_TOP, p.z);
      v.root.rotation.y = Math.atan2(-p.x, -p.z);
      buildGroup.add(v.root);
      builds.set(b.id, v);
    }
    v.b = b;
    const finished = live && prev && prev.status !== 'done' && b.status === 'done';
    if (b.status === 'done') setBody(v, b.level, finished && !!prev.upgradeTo);
    else if (b.upgradeTo) setBody(v, b.level, false);
    else if (b.status === 'building') setBody(v, 1, false);
    else clearBody(v);
    if (b.status === 'done' && v.body) v.body.scale.y = v.grow < 1 ? v.grow : 1;
    setScaffold(v, b.status === 'building');
    setStake(v, b.status === 'queued');
    if (finished) {
      v.doneAt = performance.now();
      const p = v.root.position;
      confetti(p.x, p.y + v.h + 0.2, p.z);
      if (sky.night > 0.5) fireworks(p.x, p.z);
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
  function jobOf(id) {
    let job = null;
    for (const v of builds.values()) if (v.b.ownerId === id && v.b.status !== 'done') job = v;
    return job;
  }
  function homeSpot(id) {
    let first = null;
    for (const v of builds.values()) if (v.b.ownerId === id && v.b.status === 'done' && (!first || v.b.id < first.b.id)) first = v;
    return first ? workSpot(first.b) : null;
  }
  function wantedBots() {
    const t = now();
    const busy = new Set();
    for (const v of builds.values()) if (v.b.status !== 'done') busy.add(v.b.ownerId);
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
  function addBot(builder, arrive) {
    const parts = botMesh(builder.color);
    const start = homeSpot(builder.id);
    const node = start ? start.node : pick(nav.nodes.map((n, i) => (n.kind === 'corner' || n.kind === 'ring' ? i : -1)).filter((i) => i >= 0));
    const n = nav.nodes[node];
    const b = {
      id: builder.id, builder, parts, x: start ? start.x : n.x, y: start ? start.y : n.y, z: start ? start.z : n.z,
      yaw: rand() * Math.PI * 2, yawTarget: null, node, path: null, pi: 0, tail: null, then: null, speed: WALK,
      mode: 'idle', act: null, after: null, timer: 0.5 + rand() * 3, phase: (hashStr(builder.id) % 1000) / 160,
      react: null, partner: null, poi: null, claim: null, bubble: null, tag: null, wave: 0, taps: 0, lastTap: 0, hat: null, struck: false,
    };
    botGroup.add(parts.g);
    b.tag = addLabel('tag', builder.name);
    b.tag.bot = b;
    bots.set(builder.id, b);
    refreshLook(b);
    if (arrive) arriveFromShip(b);
    return b;
  }
  function removeBot(b) {
    releasePoi(b);
    unpair(b);
    removeBubble(b);
    if (b.tag) b.tag.el.remove();
    botGroup.remove(b.parts.g);
    bots.delete(b.id);
    if (tour.track === b) tour.track = null;
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
  function goSpot(b, s, then, deadline) {
    if (Math.hypot(b.x - s.x, b.z - s.z) < 0.03) { then(b); return; }
    if (!walkTo(b, s.node, then, WALK, s)) return;
    if (deadline) {
      const left = (deadline - now()) / 1000;
      b.speed = Math.max(WALK, Math.min(2.4, pathLength(b) / Math.max(1.2, left)));
    }
  }
  function startAct(b, kind, dur, yaw) {
    b.mode = 'act';
    b.act = kind;
    b.timer = dur;
    if (yaw != null) b.yawTarget = yaw;
  }
  // What should this bot do now? Its own build comes first, then rest.
  function decide(b) {
    if (b.mode === 'arrive') return;
    b.act = null;
    b.after = null;
    const job = jobOf(b.id);
    if (job) {
      const s = workSpot(job.b);
      if (s) {
        const working = job.b.status === 'building';
        const deadline = working ? job.b.startedAt + job.b.walkSec * 1000 : 0;
        goSpot(b, s, (x) => { x.mode = working ? 'work' : 'wait'; x.yawTarget = s.yaw; x.wave = 0; }, deadline);
        if (!working && b.mode === 'walk') b.speed = WALK * 1.4;
        return;
      }
    }
    if (now() - b.builder.lastSeen > SLEEP_AFTER) {
      const h = homeSpot(b.id);
      if (h) { goSpot(b, h, (x) => { x.mode = 'sleep'; x.yawTarget = h.yaw + Math.PI / 2; }); return; }
    }
    leisure(b);
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
      const partner = [...bots.values()].find((o) => o !== b && !o.partner && !jobOf(o.id) && (o.mode === 'idle' || (o.mode === 'act' && o.act === 'look')) && Math.hypot(o.x - b.x, o.z - b.z) < 6);
      if (partner) return startChat(b, partner);
    }
    if (r < 0.92) {
      const target = Math.floor(rand() * nav.nodes.length);
      const kind = nav.nodes[target].kind;
      if (kind === 'corner' || kind === 'ring') { walkTo(b, target, (x) => startAct(x, 'look', 2 + rand() * 4)); return; }
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
      case 'wait': {
        const job = jobOf(b.id);
        if (!job || job.b.status !== 'queued') decide(b);
        break;
      }
      case 'sleep':
        if (now() - b.builder.lastSeen < SLEEP_AFTER || jobOf(b.id)) decide(b);
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
  function poseBot(b, t, dt) {
    const p = b.parts;
    p.inner.rotation.set(0, 0, 0);
    p.inner.position.set(0, 0, 0);
    p.head.rotation.set(0, 0, 0);
    p.armL.rotation.set(0, 0, 0.08);
    p.armR.rotation.set(0, 0, -0.08);
    p.legL.rotation.set(0, 0, 0);
    p.legR.rotation.set(0, 0, 0);
    p.hammer.visible = b.mode === 'work';
    p.cup.visible = b.act === 'drink';
    p.rod.visible = b.act === 'fish';
    p.can.visible = b.act === 'water';
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
    } else if (b.mode === 'work') {
      if (!still) {
        const c = (t * 1.5 + b.phase) % 1;
        const up = c < 0.72 ? c / 0.72 : 1 - (c - 0.72) / 0.28;
        p.armR.rotation.x = -0.5 - up * 2.0;
        p.inner.rotation.x = 0.06 + (1 - up) * 0.06;
        if (c > 0.72 && c < 0.8) {
          lift = 0.008;
          if (!b.struck) { b.struck = true; if (distVol(b) > 0.3) audio.sfx('hammer', distVol(b)); }
        } else b.struck = false;
      } else p.armR.rotation.x = -1.4;
      p.armL.rotation.x = -0.4;
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
    p.umbrella.visible = weather.rain > 0.3 && (b.mode === 'walk' || b.mode === 'idle' || (b.mode === 'act' && b.act !== 'drink'));
    if (p.hat && p.hat.userData.prop && !still) p.hat.userData.prop.rotation.y += dt * (b.mode === 'walk' ? 18 : 6);
  }

  // --- Builds every frame: growing, scaffolding dust, moving parts ------------------------
  function stepBuilds(t, dt) {
    const night = sky.night;
    for (const v of builds.values()) {
      const b = v.b;
      if (b.status === 'building' && !b.upgradeTo && v.body) {
        const pr = progressOf(b);
        const e = 1 - Math.pow(1 - pr, 2);
        v.body.scale.y = Math.max(0.04, e);
        v.puff -= dt;
        if (pr > 0 && pr < 1 && v.puff <= 0) {
          v.puff = 2 + rand() * 1.5;
          dust(v.root.position.x, TILE_TOP, v.root.position.z, 0.5);
        }
      } else if (v.grow < 1 && v.body) {
        v.grow = Math.min(1, v.grow + dt / 1.6);
        v.body.scale.y = 1 - Math.pow(1 - v.grow, 3);
      }
      for (const a of v.anim) {
        if (a.kind === 'spin') { if (!still) a.o.rotation.z += dt * a.speed * (1 + weather.rain); }
        else if (a.kind === 'beam') { a.o.visible = night > 0.2; if (!still) a.o.rotation.y += dt * 0.9; }
        else if (a.kind === 'flag') { if (!still) a.o.rotation.y = Math.sin(t * 2 + v.id) * 0.3; }
        else if (a.kind === 'fire' && !still) {
          const flick = 1 + Math.sin(t * 13 + v.id) * 0.12 + Math.sin(t * 7.3) * 0.08;
          a.f1.scale.set(1, flick, 1);
          a.f2.scale.set(1, 2 - flick, 1);
        } else if (a.kind === 'fountain' && !low && !still) {
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

  // --- Sky: the sun and moon follow the real clock -------------------------------------------
  const DEG = Math.PI / 180;
  const LAT = Number(opts.lat) || 52.2;
  const LON = Number(opts.lon) || 5.1;
  function sunAt(ms) {
    const d = new Date(ms);
    const doy = (ms - Date.UTC(d.getUTCFullYear(), 0, 0)) / DAY;
    const decl = -23.44 * Math.cos(((2 * Math.PI) / 365) * (doy + 10)) * DEG;
    const lat = LAT * DEG;
    const utcHours = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
    const H = (utcHours + LON / 15 - 12) * 15 * DEG;
    const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
    const alt = Math.asin(sinAlt);
    const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat));
    return { alt, az, sinAlt };
  }
  const C = (hex) => new T.Color(hex);
  const SKY = {
    nightTop: C('#081127'), nightBottom: C('#1c2b52'), duskTop: C('#3d4f8f'), duskBottom: C('#f2a46c'),
    dayTop: C('#8fcdee'), dayBottom: C('#fbe6c6'), rainTop: C('#7d8a99'), rainBottom: C('#b9c2cc'),
    waterNight: C('#12294a'), waterDay: C('#7bc4da'), hemiNight: C('#3b5082'), hemiDay: C('#c4e6f6'),
    groundNight: C('#3a3226'), groundDay: C('#c7a676'), sunLow: C('#ffc98a'), sunHigh: C('#fff4e0'),
  };
  const mixC = (a, b, t) => a.clone().lerp(b, Math.max(0, Math.min(1, t)));
  const sky = { day: 1, night: 0, dusk: 0 };
  function updateSky() {
    const s = sunAt(opts.clock ? opts.clock() : Date.now());
    const day = Math.max(0, Math.min(1, (s.sinAlt + 0.1) / 0.35));
    const dusk = Math.max(0, 1 - Math.abs(s.sinAlt - 0.02) / 0.16);
    const rain = weather.rain;
    let top = mixC(SKY.nightTop, SKY.dayTop, day);
    let bottom = mixC(SKY.nightBottom, SKY.dayBottom, day);
    top = mixC(top, SKY.duskTop, dusk * 0.6);
    bottom = mixC(bottom, SKY.duskBottom, dusk * 0.85);
    top = mixC(top, SKY.rainTop, rain * 0.55 * day);
    bottom = mixC(bottom, SKY.rainBottom, rain * 0.5 * day);
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
    const span = layout.islandR + 3;
    if (day > 0.15) {
      const dir = new T.Vector3(-Math.sin(s.az) * Math.cos(s.alt), Math.max(0.12, Math.sin(s.alt)), Math.cos(s.az) * Math.cos(s.alt)).normalize();
      sun.position.copy(dir.multiplyScalar(span * 1.6));
      sun.color.copy(mixC(SKY.sunLow, SKY.sunHigh, Math.min(1, s.sinAlt / 0.45)));
      sun.intensity = 2.7 * day * (1 - rain * 0.55);
    } else {
      sun.position.set(-span * 0.6, span * 1.2, -span * 0.8);
      sun.color.set('#a9bfff');
      sun.intensity = 0.95;
    }
    const night = 1 - day;
    mats.window.emissiveIntensity = night * 1.7 + dusk * 0.3;
    mats.lamp.emissiveIntensity = night * 1.6;
    mats.glow.opacity = night * 0.85;
    mats.glass.emissiveIntensity = 0.15 + night * 0.8;
    mats.beam.opacity = night * 0.16;
    mats.fireGlow.opacity = 0.2 + night * 0.6;
    stars.material.opacity = Math.pow(night, 2) * (1 - rain);
    moon.visible = night > 0.3;
    renderer.shadowMap.needsUpdate = true;
  }

  // --- Weather -----------------------------------------------------------------------------
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
    if (t > weather.next) {
      weather.next = t + 150e3;
      if (weather.target > 0) { if (rand() < 0.55) weather.target = 0; }
      else if (rand() < 0.12) weather.target = 0.55 + rand() * 0.45;
    }
    weather.rain += (weather.target - weather.rain) * Math.min(1, dt * 0.15);
    const on = weather.rain > 0.03;
    rainLines.visible = on;
    if (!on) return;
    rainLines.material.opacity = weather.rain * 0.55;
    rainLines.position.set(controls.target.x, 0, controls.target.z);
    const pos = rainLines.geometry.attributes.position;
    const arr = pos.array;
    const fall = dt * 7;
    for (let i = 0; i < arr.length; i += 6) {
      arr[i + 1] -= fall;
      arr[i + 4] -= fall;
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
  function fireworks(x, z) {
    if (still) return;
    for (let i = 0; i < 2; i++) {
      setTimeout(() => {
        burst({ x: x + (rand() - 0.5) * 2, y: 3 + rand(), z: z + (rand() - 0.5) * 2, count: 160, colors: [pick(['#ff5a5a', '#ffd23f', '#5ad1ff', '#b07cff', '#7dffb0'])], speed: 1.5, life: 1.8, size: 0.07, gravity: 0.7, sphere: true, additive: true, drag: 0.9 });
        audio.sfx('pop');
      }, i * 500);
    }
  }
  function dust(x, y, z, k = 1) {
    if (still) return;
    burst({ x, y: y + 0.05, z, count: Math.round(40 * k), colors: ['#d8cbb0', '#c2b59a', '#efe6d2'], speed: 0.6, life: 1.4, size: 0.07, gravity: -0.2, drag: 1.5, spread: 0.4, up: 0.4, grow: 0.04 });
  }
  function shipHop(power) {
    if (!ship) return;
    if (ship.hopT >= 1) ship.hopT = 0;
    ship.amp = Math.max(ship.amp, 0.5 * power);
    if (!still) burst({ x: 0, y: TILE_TOP + 0.1, z: 0, count: 60, colors: ['#ffb347', '#ff7a3c', '#cfcfcf'], speed: 0.8, life: 1.1, size: 0.06, gravity: -0.3, spread: 0.3, up: -0.2, drag: 1.2 });
  }

  // --- Critters: birds, a sailing boat, a cat and fireflies ------------------------------------
  const critters = { birds: [], boat: null, cat: null, flies: null };
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
      critters.birds.push({ g, wl, wr, r: 2 + rand() * layout.landR, h: 2.4 + rand() * 2, sp: (0.25 + rand() * 0.25) * (rand() < 0.5 ? -1 : 1), a: rand() * Math.PI * 2, ph: rand() * 10 });
    }
    const boat = new T.Group();
    mesh(geo('hull', () => new T.BoxGeometry(0.22, 0.08, 0.5)), mats.wood, 0, 0.02, 0, boat);
    mesh(geo('boatMast', () => new T.CylinderGeometry(0.008, 0.008, 0.5, 5)), mats.woodDark, 0, 0.3, 0, boat);
    const sailGeo = new T.BufferGeometry();
    sailGeo.setAttribute('position', new T.BufferAttribute(new Float32Array([0, 0.1, 0.02, 0, 0.52, 0.02, 0, 0.1, 0.24]), 3));
    sailGeo.computeVertexNormals();
    mesh(sailGeo, mats.sail, 0, 0, 0, boat);
    critterGroup.add(boat);
    critters.boat = { g: boat, a: rand() * Math.PI * 2 };
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
    if (bt) {
      bt.a += dt * 0.03;
      const r = layout.islandR + 2.8;
      bt.g.position.set(Math.cos(bt.a) * r, -0.5 + Math.sin(t * 1.3) * 0.03, Math.sin(bt.a) * r);
      bt.g.rotation.y = Math.atan2(-Math.sin(bt.a), Math.cos(bt.a));
      bt.g.rotation.z = Math.sin(t * 1.1) * 0.06;
    }
    const c = critters.cat;
    if (c) {
      const r = layout.beachR;
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
      c.g.position.set(Math.cos(c.a) * r, 0, Math.sin(c.a) * r);
      c.g.rotation.y = Math.atan2(-Math.sin(c.a) * c.dir, Math.cos(c.a) * c.dir);
      c.body.position.y = c.sit ? 0.045 : 0.06;
      c.tail.rotation.z = still ? 0 : Math.sin(t * 3) * 0.4;
      c.host.x = c.g.position.x;
      c.host.z = c.g.position.z;
    }
    const fl = critters.flies;
    if (fl) {
      fl.p.material.opacity = sky.night > 0.5 ? (sky.night - 0.5) * 1.8 : 0;
      if (fl.p.material.opacity > 0) {
        const spots = [...builds.values()].filter((v) => v.b.status === 'done' && (v.b.item === 'park' || v.b.item === 'garden'));
        const arr = fl.p.geometry.attributes.position.array;
        fl.seeds.forEach((s, i) => {
          const home = spots.length ? spots[i % spots.length].root.position : { x: Math.cos(i) * layout.beachR, z: Math.sin(i) * layout.beachR };
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

  // --- Labels, nametags and speech bubbles (HTML on top of the canvas) -------------------------
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
    const title = item.label + (b.upgradeTo ? ' → level ' + b.upgradeTo : '') + ' #' + b.id;
    const sub = (bd ? bd.name : '') + (b.status === 'queued' ? ' · waiting for a builder' : '');
    if (L.parts.title.textContent !== title) { L.parts.title.textContent = title; L.w = 0; }
    if (L.parts.sub.textContent !== sub) { L.parts.sub.textContent = sub; L.w = 0; }
    if (L.parts.em.textContent !== item.emoji) L.parts.em.textContent = item.emoji;
    const showBar = b.status === 'building';
    L.parts.bar.hidden = !showBar;
    if (showBar) L.parts.fill.style.width = Math.round(progressOf(b) * 100) + '%';
    L.el.classList.toggle('done', b.status === 'done');
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
    const hosts = [...bots.values()].filter((b) => b.bubble).concat(ghostBubbles.filter((h) => h.bubble));
    if (critters.cat && critters.cat.host.bubble) hosts.push(critters.cat.host);
    for (const h of hosts) {
      const bb = h.bubble;
      if (t > bb.until) { removeBubble(h); continue; }
      const p = project(h.x, (h.y || 0) + (h.parts ? 0.62 : 0.35), h.z);
      bb.el.hidden = !p.vis;
      if (!p.vis) continue;
      if (!bb.w) { bb.w = bb.el.offsetWidth; bb.h = bb.el.offsetHeight; }
      bb.el.style.transform = 'translate(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px) translate(-50%,-100%)';
      placed.push({ l: p.x - bb.w / 2, r: p.x + bb.w / 2, t: p.y - bb.h, b: p.y });
    }
    for (let i = ghostBubbles.length - 1; i >= 0; i--) if (!ghostBubbles[i].bubble) ghostBubbles.splice(i, 1);
    // Build labels: always for work in progress, up close for finished ones.
    const target = controls.target;
    const order = [...builds.values()].map((v) => {
      const active = v.b.status !== 'done' || t - v.doneAt < 7000;
      const d = Math.hypot(v.root.position.x - target.x, v.root.position.z - target.z);
      return { v, active, d };
    }).sort((a, b) => (b.active - a.active) || a.d - b.d);
    let doneShown = 0;
    for (const { v, active, d } of order) {
      const wantDone = !active && camDist < 5.5 && d < 3.2 && doneShown < 10;
      if (!active && !wantDone) { if (v.label) setShown(v.label, false); continue; }
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
    const showTags = camDist < 8.5;
    const near = [...bots.values()].sort((a, b) => Math.hypot(a.x - target.x, a.z - target.z) - Math.hypot(b.x - target.x, b.z - target.z));
    near.forEach((b, i) => {
      const L = b.tag;
      if (!showTags || i > 24 || b.bubble || b.mode === 'arrive') { setShown(L, false); return; }
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
    controls.maxDistance = fitDistance() * 1.9;
  }
  function fitDistance() {
    const s = layout.landR + 0.9;
    const dW = (s * view.f) / (view.visW / 2);
    const dH = ((s * Math.sin(elevation()) + 0.6) * view.f) / (view.visH / 2);
    return Math.max(3, Math.min(80, Math.max(dW, dH) * 0.95));
  }
  function frameCamera() {
    const d = fitDistance();
    const el = elevation();
    const az = 0.72;
    controls.target.set(0, 0, 0);
    camera.position.set(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);
    controls.update();
    scene.fog.near = d * 0.9;
    scene.fog.far = d * 3.4;
  }
  function clampTarget() {
    const t = controls.target;
    t.y = 0;
    const len = Math.hypot(t.x, t.z);
    const max = layout.islandR;
    if (len > max) { t.x *= max / len; t.z *= max / len; }
  }
  // focus: a smooth flight of the camera to a point (or a bot it then follows).
  let focus = null;
  function flyTo(x, z, want, dur, track) {
    const offset = camera.position.clone().sub(controls.target);
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
  // In stream mode the camera directs itself: it flies to whatever chat just
  // did, and otherwise slowly tours the island.
  const tour = { next: 0, i: 0, track: null, lastEvent: 0, prio: 0 };
  function interest(prio, x, z, want, track, hold) {
    if (!opts.stream) return;
    const t = performance.now();
    if (t - tour.lastEvent < 6000 && prio < tour.prio) return;
    tour.lastEvent = t;
    tour.prio = prio;
    tour.track = null;
    tour.next = t + (hold || 9000);
    flyTo(x, z, want, 1400, track);
  }
  function stepTour() {
    if (!opts.stream || still) return;
    const t = performance.now();
    controls.autoRotate = !tour.track;
    if (t < tour.next) return;
    tour.next = t + 15000;
    tour.prio = 0;
    tour.track = null;
    tour.i++;
    const busy = [...builds.values()].filter((v) => v.b.status === 'building');
    const done = [...builds.values()].filter((v) => v.b.status === 'done');
    const walkers = [...bots.values()].filter((b) => b.mode === 'walk' || b.mode === 'work' || b.mode === 'act');
    const step = tour.i % 4;
    if (step === 0 || (!busy.length && !done.length && !walkers.length)) flyTo(0, 0, fitDistance(), 2600);
    else if (step === 1 && busy.length) { const v = pick(busy); flyTo(v.root.position.x, v.root.position.z, 6.5, 2400); }
    else if (step === 2 && walkers.length) { const b = pick(walkers); flyTo(b.x, b.z, 5.5, 2400, b); }
    else if (done.length) { const v = pick(done.slice(-12)); flyTo(v.root.position.x, v.root.position.z, 6, 2400); }
    else flyTo(0, 0, fitDistance() * 0.8, 2600);
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

  // --- Main loop --------------------------------------------------------------------------------
  let skyTimer = 0;
  let frame = 0;
  function loop() {
    requestAnimationFrame(loop);
    if (document.hidden && !opts.stream) { clock.getDelta(); return; }
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;
    frame++;
    stepTour();
    stepFocus(dt);
    controls.update();
    skyTimer -= dt;
    if (skyTimer <= 0) { skyTimer = 4; updateSky(); }
    updateWeather(dt);
    for (const b of [...bots.values()]) stepBot(b, t, dt);
    stepBuilds(t, dt);
    stepCritters(t, dt);
    stepParticles(dt);
    if (frame % 3 === 0) renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
    updateOverlay();
  }

  // --- Start ------------------------------------------------------------------------------------
  audio.weather = () => ({ rain: weather.rain, day: sky.day });
  resize();
  new ResizeObserver(resize).observe(stage);
  if (!opts.stream) bindPointer();
  buildIsland(2);
  requestAnimationFrame(loop);

  function afterBuildsChanged() {
    ensureLand();
    refreshTiles();
    refreshPois();
  }

  return {
    // The whole world at once (first connect, or after a reconnect).
    load(list, builderList) {
      data.builders = new Map(builderList.map((b) => [b.id, b]));
      const ids = new Set(list.map((b) => b.id));
      for (const id of [...builds.keys()]) if (!ids.has(id)) removeBuild(id, false);
      for (const b of list) syncBuild(b, false);
      afterBuildsChanged();
      syncBots(null);
      for (const b of bots.values()) if (b.mode !== 'walk' && b.mode !== 'arrive') decide(b);
    },
    updateBuild(b) {
      const { v, prev, finished } = syncBuild(b, true);
      afterBuildsChanged();
      syncBots(null);
      const bot = bots.get(b.ownerId);
      if (bot && bot.mode !== 'arrive' && bot.mode !== 'walk' && !(bot.mode === 'act' && bot.act === 'party')) decide(bot);
      else if (bot && bot.mode === 'walk' && (!prev || prev.status !== b.status)) decide(bot);
      const p = v.root.position;
      if (finished) {
        if (bot && Math.hypot(bot.x - p.x, bot.z - p.z) < 1) { party(bot); showBubble(bot, pick(LINES.done), 2500); }
        interest(3, p.x, p.z, 6, null, 8000);
      } else if (b.status === 'building' && (!prev || prev.status !== 'building')) {
        if (bot) interest(2, bot.x, bot.z, 6.5, bot, 9000);
        else interest(2, p.x, p.z, 6.5, null, 9000);
      }
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
    debug() {
      return {
        bots: [...bots.values()].map((b) => ({ id: b.id, name: b.builder.name, mode: b.mode, act: b.act, x: +b.x.toFixed(2), z: +b.z.toFixed(2) })),
        builds: [...builds.values()].map((v) => ({ id: v.id, item: v.b.item, status: v.b.status, level: v.level, scaleY: v.body ? +v.body.scale.y.toFixed(2) : 0 })),
        landRing: layout.landRing,
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
