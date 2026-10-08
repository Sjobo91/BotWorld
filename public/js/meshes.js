// Every 3D thing in BotWorld, made from simple shapes so there are no model
// files to load. Things stand on y = 0 and face +z.
import { COLORS, PALETTE, hashStr } from '../shared/catalog.js';

let T = null;
export const mats = {};
const geos = {};

export const three = () => T;
export function initMeshes(three) {
  T = three;
  setupMaterials();
}
export function geo(name, make) {
  return geos[name] || (geos[name] = make());
}
export function std(color, extra) {
  return new T.MeshStandardMaterial(Object.assign({ color, roughness: 0.8, metalness: 0, flatShading: true }, extra || {}));
}
export function mesh(g, m, x, y, z, parent) {
  const o = new T.Mesh(g, m);
  o.position.set(x, y, z);
  if (parent) parent.add(o);
  return o;
}
export function rng(seed) {
  let a = seed || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'));
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const trims = {};
export function trimMat(color) {
  return trims[color] || (trims[color] = std(color));
}
// The color of a build: the one chat asked for, or a cheerful default.
export function colorOf(b) {
  return (b.color && COLORS[b.color]) || PALETTE[hashStr('c' + b.id) % PALETTE.length];
}

function setupMaterials() {
  Object.assign(mats, {
    wall: std(0xf2f4f7),
    wall2: std(0xe1e6ee),
    roof: std(0x75839a),
    stone: std(0xb9b4aa),
    stoneDark: std(0x8f8a80),
    domes: [std(0x9b5a33), std(0xd8b07a), std(0xf4f4f1), std(0x6d8fb3)],
    panel: std(0x22408f, { roughness: 0.35, metalness: 0.35 }),
    metal: std(0xa9b3c0, { roughness: 0.5, metalness: 0.4 }),
    door: std(0x3a4658),
    window: std(0x34455f, { emissive: 0xffc45c, emissiveIntensity: 0 }),
    wood: std(0x9a6a43),
    woodDark: std(0x6e4a2e),
    trunk: std(0x8a5a3b),
    leaf: std(0x5fae5a),
    leaf2: std(0x4a9852),
    rock: std(0x9aa1aa),
    soil: std(0x7a5a3c),
    crop: std(0xd9b44a),
    crop2: std(0x8cbf4f),
    bot: new T.MeshStandardMaterial({ color: 0xf8f9fb, roughness: 0.5 }),
    visor: new T.MeshStandardMaterial({ color: 0x1b2540, roughness: 0.2, metalness: 0.3 }),
    eye: new T.MeshBasicMaterial({ color: 0xbff0ff }),
    hammerHead: std(0x5d6878, { metalness: 0.5, roughness: 0.4 }),
    sand: std(0xe8d09f),
    water: new T.MeshStandardMaterial({ color: 0x7bc4da, roughness: 0.35, metalness: 0.05 }),
    tile: new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }),
    pad: new T.MeshStandardMaterial({ color: 0xd6dce6, roughness: 0.85 }),
    padMark: new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }),
    shipRed: std(0xe0473f),
    shipWhite: std(0xf6f7f9),
    glass: std(0x7fc8ee, { roughness: 0.15, metalness: 0.2, emissive: 0x7fc8ee, emissiveIntensity: 0.15 }),
    lamp: std(0xfff1c9, { emissive: 0xffd27a, emissiveIntensity: 0 }),
    flame: new T.MeshBasicMaterial({ color: 0xffa23a }),
    flame2: new T.MeshBasicMaterial({ color: 0xffe066 }),
    white: std(0xfbfbfb),
    black: std(0x23262d),
    yellow: std(0xf4c430),
    cup: std(0xffffff),
    cat: std(0x3b3b44),
    sail: new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, side: T.DoubleSide }),
    statue: std(0x9aa3ad, { roughness: 0.6 }),
    waterLight: new T.MeshStandardMaterial({ color: 0x8fd3f0, roughness: 0.2, emissive: 0x3a8fb8, emissiveIntensity: 0.15 }),
    grass: std(0x6bb35d),
    hit: new T.MeshBasicMaterial({ visible: false }),
    glow: new T.SpriteMaterial({ map: glowTexture(), color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending }),
    fireGlow: new T.SpriteMaterial({ map: glowTexture(), color: 0xff9a3c, transparent: true, opacity: 0.35, depthWrite: false, blending: T.AdditiveBlending }),
    beam: new T.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide }),
    flowers: [std(0xff6b8b), std(0xffd23f), std(0xb07cff), std(0xff9f43), std(0xffffff)],
    starTex: starTexture(),
    sign: new T.MeshBasicMaterial({ map: signTexture('MARKET') }),
    straw: std(0xd2ac5f),
    mud: std(0xa47a52),
    brick: std(0xb5583b),
    brickDark: std(0x8e4330),
    timber: std(0x5a3d28),
    plaster: std(0xf1e7d0),
    slate: std(0x56606e),
    roofTile: std(0xb4553a),
    concrete: std(0xc9cdd2),
    concreteDark: std(0x8d939b),
    steel: std(0x8e99a6, { roughness: 0.45, metalness: 0.5 }),
    darkMetal: std(0x4a525e, { roughness: 0.5, metalness: 0.4 }),
    coal: std(0x2b2b2e),
    hay: std(0xe2c35a),
    berryRed: std(0xc0304a),
    berryBlue: std(0x4a5bd0),
    furnace: std(0xff7a2e, { emissive: 0xff5a1e, emissiveIntensity: 1.2 }),
    panelBlue: std(0x1d3f8f, { roughness: 0.3, metalness: 0.5 }),
    whiteGloss: new T.MeshStandardMaterial({ color: 0xf4f7fb, roughness: 0.25, metalness: 0.1 }),
    glassBlue: new T.MeshStandardMaterial({ color: 0x7fb2e0, roughness: 0.1, metalness: 0.6, transparent: true, opacity: 0.8 }),
    neonCyan: new T.MeshStandardMaterial({ color: 0x5ef2ff, emissive: 0x3fe0ff, emissiveIntensity: 1.4, roughness: 0.3 }),
    neonPink: new T.MeshStandardMaterial({ color: 0xff7ad9, emissive: 0xff4fc8, emissiveIntensity: 1.2, roughness: 0.3 }),
    holo: new T.MeshBasicMaterial({ color: 0x7ffcff, transparent: true, opacity: 0.45, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide }),
    redLight: new T.MeshStandardMaterial({ color: 0xff3b3b, emissive: 0xff2020, emissiveIntensity: 1.5 }),
    clockFace: std(0xfaf6ea),
    rail: std(0x6b5a4a),
  });
  mats.towerGlass = towerGlassMat();
}
// Glass and steel with a grid of windows; some light up at night.
function towerGlassMat() {
  const r = rng(99);
  const draw = (lit) => (g) => {
    g.fillStyle = lit ? '#000000' : '#5d7fa6';
    g.fillRect(0, 0, 64, 128);
    for (let y = 4; y < 128; y += 10) {
      for (let x = 4; x < 64; x += 10) {
        const on = r() < 0.45;
        g.fillStyle = lit ? (on ? '#ffd58a' : '#000000') : on ? '#a9c6e6' : '#7e9dc2';
        g.fillRect(x, y, 6, 6);
      }
    }
  };
  const map = canvasTex(64, 128, draw(false));
  const emissiveMap = canvasTex(64, 128, draw(true));
  return new T.MeshStandardMaterial({ map, emissiveMap, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.25, metalness: 0.4 });
}
export function glowTexture() {
  return canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
  });
}
function starTexture() {
  return canvasTex(32, 32, (g) => {
    g.fillStyle = '#ffd93b';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 6 : 15;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      g.lineTo(16 + Math.cos(a) * r, 16 + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  });
}
export function signTexture(text) {
  return canvasTex(128, 40, (g) => {
    g.fillStyle = '#2b3a55';
    g.fillRect(0, 0, 128, 40);
    g.fillStyle = '#ffe9b0';
    g.font = '700 24px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 64, 21);
  });
}
const stripeMats = {};
export function stripeMat(color) {
  if (!stripeMats[color]) {
    const map = canvasTex(64, 64, (g) => {
      for (let i = 0; i < 8; i++) {
        g.fillStyle = i % 2 ? '#ffffff' : color;
        g.fillRect(i * 8, 0, 8, 64);
      }
    });
    stripeMats[color] = new T.MeshStandardMaterial({ map, roughness: 0.8 });
  }
  return stripeMats[color];
}

// --- Small pieces --------------------------------------------------------------
export const oct = (rt, rb, h) => new T.CylinderGeometry(rt, rb, h, 8, 1, false, Math.PI / 8);
export function addWindows(g, radius, y, count, skipFront) {
  const ap = radius * Math.cos(Math.PI / 8);
  for (let i = 0; i < 8 && count > 0; i++) {
    if (skipFront && i === 0) continue;
    const th = (i * Math.PI) / 4;
    const w = mesh(geo('win', () => new T.BoxGeometry(0.075, 0.06, 0.014)), mats.window, Math.sin(th) * (ap + 0.012), y, Math.cos(th) * (ap + 0.012), g);
    w.rotation.y = th;
    count--;
  }
}
export function treeMesh(pine) {
  const g = new T.Group();
  mesh(geo('trunk', () => new T.CylinderGeometry(0.03, 0.04, 0.2, 5)), mats.trunk, 0, 0.1, 0, g);
  if (pine) {
    mesh(geo('cone1', () => new T.ConeGeometry(0.2, 0.32, 7)), mats.leaf2, 0, 0.32, 0, g);
    mesh(geo('cone2', () => new T.ConeGeometry(0.15, 0.26, 7)), mats.leaf, 0, 0.5, 0, g);
  } else {
    mesh(geo('crown', () => new T.DodecahedronGeometry(0.2, 0)), mats.leaf, 0, 0.36, 0, g);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
export function benchMesh() {
  const g = new T.Group();
  mesh(geo('benchSeat', () => new T.BoxGeometry(0.34, 0.03, 0.11)), mats.wood, 0, 0.1, 0, g);
  mesh(geo('benchBack', () => new T.BoxGeometry(0.34, 0.09, 0.02)), mats.wood, 0, 0.17, -0.05, g);
  for (const sx of [-0.14, 0.14]) for (const sz of [-0.04, 0.04]) mesh(geo('benchLeg', () => new T.BoxGeometry(0.02, 0.1, 0.02)), mats.woodDark, sx, 0.05, sz, g);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
export function lampMesh() {
  const g = new T.Group();
  mesh(geo('lampPost', () => new T.CylinderGeometry(0.012, 0.016, 0.55, 6)), mats.metal, 0, 0.275, 0, g);
  mesh(geo('lampHead', () => new T.BoxGeometry(0.07, 0.07, 0.07)), mats.lamp, 0, 0.58, 0, g);
  const glow = new T.Sprite(mats.glow);
  glow.position.set(0, 0.58, 0);
  glow.scale.set(0.7, 0.7, 1);
  g.add(glow);
  return g;
}
export function flowerBed(g, r, n, radius, fixed) {
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const rr = Math.sqrt(r()) * radius;
    mesh(geo('stem', () => new T.CylinderGeometry(0.006, 0.006, 0.08, 4)), mats.leaf2, Math.cos(a) * rr, 0.07, Math.sin(a) * rr, g);
    mesh(geo('bloom', () => new T.SphereGeometry(0.025, 6, 5)), fixed || mats.flowers[i % mats.flowers.length], Math.cos(a) * rr, 0.12, Math.sin(a) * rr, g);
  }
}
export function crenellations(g, radius, y, m) {
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    mesh(geo('cren', () => new T.BoxGeometry(0.05, 0.05, 0.05)), m, Math.sin(a) * radius, y, Math.cos(a) * radius, g).rotation.y = a;
  }
}

// Poles and planks around a build site.
export function scaffoldMesh(h) {
  const g = new T.Group();
  const s = 0.27;
  const hh = Math.max(0.3, h + 0.05);
  for (const [x, z] of [[-s, -s], [s, -s], [-s, s], [s, s]]) {
    const p = mesh(geo('scafPole', () => new T.CylinderGeometry(0.008, 0.008, 1, 4)), mats.metal, x, hh / 2, z, g);
    p.scale.y = hh;
  }
  for (let y = 0.15; y < hh; y += 0.17) {
    for (const [x, z, ry] of [[0, -s, 0], [0, s, 0], [-s, 0, Math.PI / 2], [s, 0, Math.PI / 2]]) {
      mesh(geo('scafBar', () => new T.BoxGeometry(s * 2, 0.01, 0.01)), mats.metal, x, y, z, g).rotation.y = ry;
    }
  }
  mesh(geo('plank', () => new T.BoxGeometry(0.5, 0.012, 0.07)), mats.wood, 0, 0.16, s + 0.04, g);
  mesh(geo('crateS', () => new T.BoxGeometry(0.08, 0.08, 0.08)), mats.wood, -0.36, 0.04, 0.12, g);
  return g;
}

// A little flag on a stake: this plot is taken, a bot is on its way.
export function stakeMesh(color) {
  const g = new T.Group();
  mesh(geo('stakePole', () => new T.CylinderGeometry(0.008, 0.01, 0.34, 5)), mats.wood, 0, 0.17, 0, g);
  const flagGeo = geo('stakeFlag', () => {
    const fg = new T.BufferGeometry();
    fg.setAttribute('position', new T.BufferAttribute(new Float32Array([0, 0.34, 0, 0, 0.24, 0, 0.14, 0.29, 0]), 3));
    fg.computeVertexNormals();
    return fg;
  });
  const flagMat = new T.MeshStandardMaterial({ color, side: T.DoubleSide, roughness: 0.7 });
  mesh(flagGeo, flagMat, 0, 0, 0, g);
  return g;
}

export function shipMesh() {
  const g = new T.Group();
  mesh(geo('shipBody', () => new T.CylinderGeometry(0.3, 0.36, 0.95, 14)), mats.shipWhite, 0, 0.62, 0, g);
  mesh(geo('shipNose', () => new T.ConeGeometry(0.3, 0.5, 14)), mats.shipRed, 0, 1.345, 0, g);
  mesh(geo('shipBand', () => new T.CylinderGeometry(0.365, 0.365, 0.08, 14)), mats.shipRed, 0, 0.2, 0, g);
  const win = mesh(geo('shipWin', () => new T.CylinderGeometry(0.1, 0.1, 0.04, 16)), mats.glass, 0, 0.8, 0.305, g);
  win.rotation.x = Math.PI / 2;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const fin = mesh(geo('fin', () => new T.BoxGeometry(0.05, 0.36, 0.26)), mats.shipRed, Math.cos(a) * 0.38, 0.3, Math.sin(a) * 0.38, g);
    fin.rotation.y = -a;
  }
  const ramp = mesh(geo('ramp', () => new T.BoxGeometry(0.22, 0.02, 0.5)), mats.metal, 0, 0.12, 0.52, g);
  ramp.rotation.x = 0.42;
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.ship = true; } });
  g.scale.setScalar(0.78);
  return g;
}

// --- Bots ---------------------------------------------------------------------------
export function hatMesh(type, color) {
  const g = new T.Group();
  g.position.y = 0.055;
  const c = trimMat(color || '#3b7ddd');
  if (type === 'chef') {
    mesh(geo('chefBand', () => new T.CylinderGeometry(0.058, 0.06, 0.05, 12)), mats.white, 0, 0.02, 0, g);
    mesh(geo('chefPuff', () => new T.SphereGeometry(0.07, 12, 8)), mats.white, 0, 0.075, 0, g).scale.set(1, 0.75, 1);
  } else if (type === 'hardhat') {
    mesh(geo('helmDome', () => new T.SphereGeometry(0.086, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)), mats.yellow, 0, -0.01, 0, g);
    mesh(geo('helmBrim', () => new T.CylinderGeometry(0.105, 0.105, 0.008, 14)), mats.yellow, 0, -0.01, 0.01, g);
  } else if (type === 'cap') {
    mesh(geo('capDome', () => new T.SphereGeometry(0.084, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)), c, 0, -0.012, 0, g);
    mesh(geo('capBill', () => new T.BoxGeometry(0.08, 0.008, 0.07)), c, 0, -0.01, 0.09, g);
  } else if (type === 'beanie') {
    mesh(geo('beanie', () => new T.SphereGeometry(0.087, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.8)), c, 0, -0.02, 0, g).scale.set(1, 1.15, 1);
    mesh(geo('pompom', () => new T.SphereGeometry(0.026, 8, 6)), mats.white, 0, 0.085, 0, g);
  } else if (type === 'headphones') {
    mesh(geo('hpBand', () => new T.TorusGeometry(0.088, 0.008, 6, 16, Math.PI)), mats.black, 0, -0.03, 0, g);
    for (const s of [-1, 1]) mesh(geo('earcup', () => new T.CylinderGeometry(0.03, 0.03, 0.025, 10)), c, s * 0.088, -0.035, 0, g).rotation.z = Math.PI / 2;
  } else if (type === 'propeller') {
    mesh(geo('capDome', () => new T.SphereGeometry(0.084, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)), c, 0, -0.012, 0, g);
    mesh(geo('propMast', () => new T.CylinderGeometry(0.005, 0.005, 0.04, 4)), mats.metal, 0, 0.085, 0, g);
    const prop = new T.Group();
    prop.position.y = 0.105;
    mesh(geo('blade', () => new T.BoxGeometry(0.12, 0.004, 0.022)), mats.shipRed, 0, 0, 0, prop);
    mesh(geo('blade2', () => new T.BoxGeometry(0.022, 0.004, 0.12)), mats.yellow, 0, 0, 0, prop);
    g.add(prop);
    g.userData.prop = prop;
  } else if (type === 'tophat') {
    mesh(geo('topHat', () => new T.CylinderGeometry(0.055, 0.058, 0.09, 12)), mats.black, 0, 0.04, 0, g);
    mesh(geo('topBrim', () => new T.CylinderGeometry(0.09, 0.09, 0.008, 14)), mats.black, 0, 0, 0, g);
    mesh(geo('topBandH', () => new T.CylinderGeometry(0.0585, 0.0585, 0.015, 12)), c, 0, 0.012, 0, g);
  } else if (type === 'flowers') {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      mesh(geo('crownBloom', () => new T.SphereGeometry(0.02, 6, 5)), mats.flowers[i % 5], Math.cos(a) * 0.07, -0.005, Math.sin(a) * 0.07, g);
    }
  }
  return g;
}

export function botMesh(color) {
  const g = new T.Group();
  const inner = new T.Group();
  g.add(inner);
  const accent = trimMat(color || '#3b7ddd');
  mesh(geo('botBody', () => new T.CapsuleGeometry(0.06, 0.07, 4, 10)), mats.bot, 0, 0.15, 0, inner).castShadow = true;
  mesh(geo('botBelt', () => new T.CylinderGeometry(0.063, 0.063, 0.03, 12)), accent, 0, 0.13, 0, inner);
  const head = new T.Group();
  head.position.set(0, 0.3, 0);
  inner.add(head);
  mesh(geo('botHead', () => new T.SphereGeometry(0.08, 14, 12)), mats.bot, 0, 0, 0, head).castShadow = true;
  mesh(geo('botVisor', () => new T.SphereGeometry(0.062, 14, 10)), mats.visor, 0, 0.004, 0.045, head).scale.set(1, 0.72, 0.55);
  for (const ex of [-0.022, 0.022]) mesh(geo('botEye', () => new T.BoxGeometry(0.013, 0.022, 0.008)), mats.eye, ex, 0.008, 0.079, head);
  const antenna = new T.Group();
  head.add(antenna);
  mesh(geo('antenna', () => new T.CylinderGeometry(0.005, 0.005, 0.07, 5)), mats.metal, 0, 0.1, 0, antenna);
  mesh(geo('tip', () => new T.SphereGeometry(0.018, 8, 6)), accent, 0, 0.14, 0, antenna);
  const limb = (x, y) => { const p = new T.Group(); p.position.set(x, y, 0); inner.add(p); return p; };
  const armL = limb(-0.074, 0.2);
  const armR = limb(0.074, 0.2);
  mesh(geo('arm', () => new T.CapsuleGeometry(0.017, 0.06, 3, 6)), mats.bot, 0, -0.045, 0, armL);
  mesh(geo('arm', () => new T.CapsuleGeometry(0.017, 0.06, 3, 6)), mats.bot, 0, -0.045, 0, armR);
  const hammer = new T.Group();
  hammer.position.set(0, -0.09, 0.01);
  armR.add(hammer);
  mesh(geo('grip', () => new T.CylinderGeometry(0.007, 0.007, 0.1, 5)), mats.wood, 0, 0, 0.04, hammer).rotation.x = Math.PI / 2;
  mesh(geo('hHead', () => new T.BoxGeometry(0.03, 0.05, 0.03)), mats.hammerHead, 0, 0, 0.09, hammer);
  const cup = mesh(geo('cupMesh', () => new T.CylinderGeometry(0.018, 0.015, 0.035, 8)), mats.cup, 0, -0.095, 0.02, armR);
  const rod = new T.Group();
  rod.position.set(0, -0.09, 0.01);
  armR.add(rod);
  mesh(geo('rod', () => new T.CylinderGeometry(0.004, 0.006, 0.42, 4)), mats.woodDark, 0, 0.12, 0.16, rod).rotation.x = 0.95;
  const can = mesh(geo('can', () => new T.BoxGeometry(0.05, 0.04, 0.035)), trimMat('#47ad6b'), 0, -0.1, 0.03, armR);
  const legL = limb(-0.03, 0.085);
  const legR = limb(0.03, 0.085);
  mesh(geo('leg', () => new T.CylinderGeometry(0.02, 0.022, 0.075, 6)), mats.bot, 0, -0.04, 0, legL);
  mesh(geo('leg', () => new T.CylinderGeometry(0.02, 0.022, 0.075, 6)), mats.bot, 0, -0.04, 0, legR);
  const umbrella = new T.Group();
  umbrella.position.set(0.02, 0.42, 0);
  mesh(geo('umbStick', () => new T.CylinderGeometry(0.004, 0.004, 0.2, 4)), mats.black, 0, -0.06, 0, umbrella);
  const umbMat = mats['umb' + color] || (mats['umb' + color] = new T.MeshStandardMaterial({ color: color || '#3b7ddd', roughness: 0.6, side: T.DoubleSide }));
  mesh(geo('umbTop', () => new T.ConeGeometry(0.17, 0.08, 10, 1, true)), umbMat, 0, 0.06, 0, umbrella);
  umbrella.visible = false;
  inner.add(umbrella);
  const dizzy = new T.Group();
  dizzy.position.y = 0.42;
  const starMat = mats.starMat || (mats.starMat = new T.SpriteMaterial({ map: mats.starTex, transparent: true, depthWrite: false }));
  for (let i = 0; i < 3; i++) { const s = new T.Sprite(starMat); s.scale.set(0.06, 0.06, 1); dizzy.add(s); }
  dizzy.visible = false;
  inner.add(dizzy);
  mesh(geo('hit', () => new T.SphereGeometry(0.3, 8, 6)), mats.hit, 0, 0.22, 0, g);
  g.scale.setScalar(0.85);
  return { g, inner, head, antenna, armL, armR, legL, legR, hammer, cup, rod, can, umbrella, dizzy, hat: null };
}
