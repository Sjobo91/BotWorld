// Buildings that stand through many eras keep up with the times. The
// woodcutter's log cabin becomes a steam sawmill in the Industrial
// Revolution, a lumber yard in the Modern Age and a tree farm in the Future;
// the lighthouse starts as a Roman pharos and ends as a spire of light.
// LOOKS[item][era] builds the look an item has from that era on. Before the
// first one it keeps the look its own builder in buildings.js gives it. The
// town's buildings follow the town's era, the rival's follow the rival's.
import { ITEMS } from '../shared/catalog.js';
import { three, mats, geo, mesh, mergeGeos, beamGeo, treeMesh, crenellations, benchMesh } from './meshes.js';

let T = null;
const V = (x, y, z) => new T.Vector3(x, y, z);
const box = (w, h, d) => new T.BoxGeometry(w, h, d);
const boxAt = (w, h, d, x, y, z, ry = 0) => box(w, h, d).rotateY(ry).translate(x, y, z);
const cyl = (rt, rb, h, n = 12) => new T.CylinderGeometry(rt, rb, h, n);
const cylAt = (rt, rb, h, x, y, z, n = 12) => cyl(rt, rb, h, n).translate(x, y, z);
const cone = (r, h, n = 12) => new T.ConeGeometry(r, h, n);
const sph = (r, w = 12, h = 8, ...rest) => new T.SphereGeometry(r, w, h, ...rest);
const dome = (r) => new T.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
const blob = (r) => new T.IcosahedronGeometry(r, 1);
// A box tipped back about x (solar panels, a sloping canopy), ready to merge.
const tilted = (w, h, d, x, y, z, rx) => box(w, h, d).rotateX(rx).translate(x, y, z);
// A ring lying flat (a torus turned onto the ground).
const flatRing = (r, tube, arc = Math.PI * 2, n = 24) => new T.TorusGeometry(r, tube, 6, n, arc).rotateX(Math.PI / 2);
// A gable roof: a triangular prism along x, h tall and d deep. Put it
// 0.335 * h above the top of the walls.
const gable = (w, h, d) => new T.CylinderGeometry(1, 1, 1, 3).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2).scale(w, h * 0.67, d * 0.58);

function smokeAt(k, x, y, z, every = 2.2, dark = false) {
  k.anim.push({ kind: 'smoke', x, y, z, every, dark, t: Math.random() * every });
}
function glowAt(k, m, x, y, z, s) {
  const g = new T.Sprite(m);
  g.position.set(x, y, z);
  g.scale.set(s, s, 1);
  k.g.add(g);
  return g;
}
// A fire that flickers (a beacon, a brazier).
function fire(k, x, y, z) {
  const f1 = k.part('lkFlame1', () => blob(0.05).scale(1, 1.9, 1).translate(0, 0.015, 0), mats.flame, x, y, z);
  const f2 = k.part('lkFlame2', () => blob(0.03).scale(1, 1.9, 1), mats.flame2, x, y, z);
  glowAt(k, mats.fireGlow, x, y + 0.04, z, 0.8);
  k.anim.push({ kind: 'fire', f1, f2 });
}
// The light of a lighthouse: a glow and a turning beam, both at night.
function lightBeam(k, y, size = 1.1) {
  glowAt(k, mats.glow, 0, y, 0, size);
  const beam = new T.Group();
  beam.position.y = y;
  mesh(geo('beam', () => new T.ConeGeometry(0.22, 2.4, 12, 1, true)), mats.beam, 0, 0, 1.2, beam).rotation.x = -Math.PI / 2;
  k.g.add(beam);
  k.anim.push({ kind: 'beam', o: beam });
}
// Clear glass for domes and vaults: it casts no shadow on what is
// inside.
const own = {};
function clearGlass(tint = 0xc9ecff, opacity = 0.38) {
  const key = tint + ':' + opacity;
  if (!own[key]) {
    own[key] = new T.MeshStandardMaterial({ color: tint, roughness: 0.08, metalness: 0.3, transparent: true, opacity, depthWrite: false, side: T.DoubleSide, flatShading: true });
    own[key].userData.noShadow = true;
  }
  return own[key];
}
// Strapped timber, bricks on a pallet, crates: small stacks of goods.
function brickStack(k, x, z) {
  k.part('lkPallet', () => box(0.12, 0.02, 0.1), mats.wood, x, 0.01, z);
  k.part('lkBricks', () => mergeGeos([0, 1, 2].flatMap((l) => [-1, 1].flatMap((sx) => [-1, 1].map((sz) => boxAt(0.05, 0.026, 0.04, sx * 0.028, 0.034 + l * 0.028, sz * 0.022))))), mats.brick, x, 0, z);
}
function drone(k, cargo, x, z) {
  const d = new T.Group();
  mesh(geo('lkDrone', () => box(0.07, 0.022, 0.07)), mats.whiteGloss, 0, 0, 0, d);
  mesh(geo('lkRotors', () => mergeGeos([[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => cylAt(0.024, 0.024, 0.004, a * 0.05, 0.015, b * 0.05, 10)))), mats.holo, 0, 0, 0, d);
  if (cargo === 'log') mesh(geo('lkDroneLog', () => cyl(0.022, 0.022, 0.16, 8).rotateZ(Math.PI / 2)), mats.trunk, 0, -0.035, 0, d);
  else mesh(geo('lkDroneBox', () => box(0.045, 0.04, 0.045)), mats.whiteGloss, 0, -0.035, 0, d);
  k.g.add(d);
  k.anim.push({ kind: 'drone', o: d, x, z, ph: k.r() * 6 });
}
function flag(k, x, y, z, pole) {
  k.part('lkFlagPole' + Math.round(pole * 100), () => cyl(0.006, 0.006, pole, 5), mats.woodDark, x, y + pole / 2, z);
  k.anim.push({ kind: 'flag', o: k.part('lkFlag', () => box(0.13, 0.075, 0.005).translate(0.065, 0, 0), k.trim, x, y + pole - 0.045, z) });
}
function blinkAt(k, x, y, z) {
  k.anim.push({ kind: 'blink', o: k.part('lkBlink', () => sph(0.016, 8, 6), mats.redLight, x, y, z) });
}

// --- Lighthouse --------------------------------------------------------------------------
// Middle Ages: a round stone tower with battlements and a fire basket.
function stoneLighthouse(k) {
  k.part('lmBase', () => cyl(0.18, 0.21, 0.08, 12), mats.stoneDark, 0, 0.04, 0);
  k.part('lmTower', () => cyl(0.13, 0.165, 0.5, 12), mats.stone, 0, 0.33, 0);
  k.part('lmBand', () => cyl(0.152, 0.152, 0.025, 12), mats.stoneDark, 0, 0.3, 0);
  k.part('lmSlits', () => mergeGeos([boxAt(0.025, 0.06, 0.012, 0, 0.2, 0.156), boxAt(0.025, 0.06, 0.012, 0, 0.44, 0.141)]), mats.black, 0, 0, 0);
  k.part('lmDoor', () => box(0.07, 0.12, 0.014), mats.door, 0, 0.14, 0.162);
  k.part('lmTop', () => cyl(0.165, 0.135, 0.04, 12), mats.stoneDark, 0, 0.6, 0);
  crenellations(k.g, 0.14, 0.645, mats.stone);
  k.part('lmPost', () => cyl(0.012, 0.016, 0.08, 6), mats.ironwork, 0, 0.66, 0);
  k.part('lmBasket', () => cyl(0.06, 0.035, 0.05, 8), mats.ironwork, 0, 0.71, 0);
  fire(k, 0, 0.75, 0);
  glowAt(k, mats.glow, 0, 0.78, 0, 1.2);
  return 0.86;
}
// Industrial Revolution and Modern Age: a striped tower with a lantern room
// and a turning beam.
function stripedLighthouse(k) {
  const bands = [[0.17, 0.2, 0.2], [0.145, 0.17, 0.2], [0.125, 0.145, 0.2]];
  bands.forEach(([rt, rb, hh], i) => k.part('lhBand' + i, () => cyl(rt, rb, hh, 12), i % 2 ? mats.white : k.trim, 0, hh / 2 + i * hh, 0));
  k.part('lhGallery', () => cyl(0.17, 0.17, 0.025, 12), mats.black, 0, 0.61, 0);
  k.part('lhGlass', () => cyl(0.09, 0.09, 0.1, 10), mats.glass, 0, 0.67, 0);
  k.part('lhLamp', () => sph(0.05, 10, 8), mats.lamp, 0, 0.67, 0);
  k.part('lhRoof', () => cone(0.12, 0.1, 10), k.trim, 0, 0.77, 0);
  k.part('door', () => box(0.08, 0.13, 0.012), mats.door, 0, 0.065, 0.2);
  lightBeam(k, 0.67);
  return 0.85;
}
// Future: a slim white spire, rings of light and a halo turning round the
// lantern.
function lightSpire(k) {
  k.part('lfBase', () => cyl(0.17, 0.21, 0.05, 16), mats.whiteGloss, 0, 0.025, 0);
  k.part('lfShaft', () => cyl(0.05, 0.1, 0.62, 16), mats.whiteGloss, 0, 0.36, 0);
  k.part('lfStripe0', () => flatRing(0.09, 0.008), mats.neonCyan, 0, 0.22, 0);
  k.part('lfStripe1', () => flatRing(0.074, 0.008), mats.neonCyan, 0, 0.42, 0);
  k.part('lfDoor', () => box(0.06, 0.1, 0.02), mats.glassBlue, 0, 0.1, 0.1);
  k.part('lfLantern', () => sph(0.06, 14, 10), mats.lamp, 0, 0.74, 0);
  k.part('lfCap', () => cone(0.05, 0.12, 12), mats.whiteGloss, 0, 0.85, 0);
  const spin = new T.Group();
  const halo = mesh(geo('lfHalo', () => flatRing(0.13, 0.008, Math.PI * 2, 32)), mats.neonCyan, 0, 0.74, 0, spin);
  halo.rotation.z = 0.35;
  k.g.add(spin);
  k.anim.push({ kind: 'spinY', o: spin, speed: 1.2 });
  lightBeam(k, 0.74, 1.3);
  return 0.92;
}

// --- Woodcutter ---------------------------------------------------------------------------
// Industrial Revolution: a steam sawmill with a round saw that never stops.
function sawmill(k) {
  k.part('smYard', () => cyl(0.4, 0.4, 0.012, 6), mats.soil, 0, 0.006, 0);
  k.part('smShed', () => box(0.3, 0.2, 0.22), mats.brick, -0.1, 0.1, -0.13);
  k.part('smRoof', () => gable(0.34, 0.1, 0.26), mats.slate, -0.1, 0.234, -0.13);
  k.part('smDoor', () => box(0.11, 0.13, 0.012), mats.black, -0.1, 0.065, -0.018);
  k.part('smChimney', () => cyl(0.026, 0.036, 0.52, 8), mats.brickDark, -0.21, 0.26, -0.2);
  smokeAt(k, -0.21, 0.54, -0.2, 1.8, true);
  k.part('smBench', () => box(0.32, 0.025, 0.09), mats.woodDark, 0.1, 0.1, 0.12);
  k.part('smLegs', () => mergeGeos([[-0.04, 0.09], [0.24, 0.09], [-0.04, 0.15], [0.24, 0.15]].map(([x, z]) => boxAt(0.02, 0.09, 0.02, x, 0.045, z))), mats.woodDark, 0, 0, 0);
  k.part('smLog', () => cyl(0.032, 0.032, 0.2, 8).rotateZ(Math.PI / 2), mats.trunk, 0.02, 0.145, 0.12);
  const blade = k.part('smBlade', () => cyl(0.07, 0.07, 0.006, 18).rotateX(Math.PI / 2), mats.metal, 0.17, 0.13, 0.12);
  k.anim.push({ kind: 'spinZ', o: blade, speed: 9 });
  k.part('smPlanks', () => mergeGeos(Array.from({ length: 6 }, (_, i) => boxAt(0.22, 0.014, 0.05, 0, 0.007 + i * 0.016, i % 2 ? 0.028 : -0.028))), mats.wood, 0.2, 0, -0.17);
  for (const [i, row] of [[0, 0], [1, 0], [2, 0], [0.5, 1], [1.5, 1]]) k.part('smPileLog', () => cyl(0.034, 0.034, 0.26, 8).rotateX(Math.PI / 2), mats.trunk, -0.3 + i * 0.07, 0.034 + row * 0.06, 0.17);
  return 0.56;
}
// Modern Age: a lumber yard with strapped bundles and a log loader.
function lumberyard(k) {
  k.part('lyYard', () => cyl(0.4, 0.4, 0.012, 6), mats.concreteDark, 0, 0.006, 0);
  k.part('lyShed', () => box(0.34, 0.2, 0.22), mats.wall2, -0.06, 0.1, -0.15);
  k.part('lyRoof', () => box(0.36, 0.025, 0.24), mats.panelBlue, -0.06, 0.21, -0.15);
  k.part('lyDoor', () => box(0.16, 0.15, 0.012), mats.darkMetal, -0.06, 0.075, -0.038);
  k.part('lySign', () => box(0.2, 0.035, 0.012), k.trim, -0.06, 0.18, -0.037);
  for (const [x, z, n] of [[0.24, -0.1, 3], [0.24, 0.06, 2]]) {
    for (let i = 0; i < n; i++) {
      k.part('lyBundle', () => box(0.16, 0.05, 0.1), mats.wood, x, 0.03 + i * 0.052, z);
      k.part('lyStraps', () => mergeGeos([boxAt(0.008, 0.052, 0.102, -0.05, 0, 0), boxAt(0.008, 0.052, 0.102, 0.05, 0, 0)]), mats.black, x, 0.03 + i * 0.052, z);
    }
  }
  const ld = new T.Group();
  ld.position.set(0.02, 0, 0.2);
  ld.rotation.y = -0.5;
  mesh(geo('lyLoader', () => box(0.14, 0.05, 0.08)), mats.yellow, 0, 0.055, 0, ld);
  mesh(geo('lyCab', () => box(0.06, 0.06, 0.07)), mats.yellow, -0.035, 0.11, 0, ld);
  mesh(geo('lyCabGlass', () => box(0.062, 0.032, 0.072)), mats.glass, -0.035, 0.122, 0, ld);
  mesh(geo('lyWheels', () => mergeGeos([[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => cyl(0.028, 0.028, 0.02, 10).rotateX(Math.PI / 2).translate(a * 0.045, 0.028, b * 0.045)))), mats.black, 0, 0, 0, ld);
  mesh(geo('lyBoom', () => beamGeo(V(0.03, 0.09, 0), V(0.15, 0.16, 0), 0.02)), mats.yellow, 0, 0, 0, ld);
  mesh(geo('lyGrab', () => box(0.025, 0.04, 0.05)), mats.darkMetal, 0.155, 0.13, 0, ld);
  mesh(geo('lyGrabLog', () => cyl(0.026, 0.026, 0.22, 8).rotateX(Math.PI / 2)), mats.trunk, 0.155, 0.1, 0, ld);
  k.g.add(ld);
  for (const [i, row] of [[0, 0], [1, 0], [2, 0], [0.5, 1], [1.5, 1]]) k.part('lyLog', () => cyl(0.032, 0.032, 0.24, 8).rotateZ(Math.PI / 2), mats.trunk, -0.22, 0.032 + row * 0.058, 0.06 + i * 0.065);
  return 0.3;
}
// Future: young trees growing under a glass dome, a drum that saws them
// and a drone flying the logs in.
function treefarm(k) {
  k.part('tfGround', () => cyl(0.42, 0.42, 0.014, 6), mats.grass, 0, 0.007, 0);
  k.part('tfDomeBase', () => cyl(0.21, 0.21, 0.03, 20), mats.whiteGloss, -0.1, 0.015, -0.1);
  for (const [x, z, s] of [[-0.16, -0.14, 0.42], [-0.04, -0.16, 0.36], [-0.1, -0.02, 0.4]]) {
    const t = treeMesh(true);
    t.position.set(x, 0.03, z);
    t.scale.setScalar(s);
    k.g.add(t);
  }
  k.part('tfDome', () => dome(0.2), clearGlass(), -0.1, 0.03, -0.1);
  k.part('tfDomeRib', () => flatRing(0.2, 0.006, Math.PI * 2, 32), mats.whiteGloss, -0.1, 0.032, -0.1);
  k.part('tfPod', () => cyl(0.1, 0.11, 0.16, 18), mats.whiteGloss, 0.23, 0.08, -0.1);
  k.part('tfPodBand', () => flatRing(0.106, 0.01), mats.neonCyan, 0.23, 0.1, -0.1);
  k.part('tfPodTop', () => dome(0.1), mats.whiteGloss, 0.23, 0.16, -0.1);
  k.part('tfBeams', () => mergeGeos([0, 1, 2].flatMap((row) => [0, 1, 2].map((i) => boxAt(0.2, 0.035, 0.035, 0, 0.018 + row * 0.037, -0.045 + i * 0.045)))), mats.wood, 0.18, 0, 0.18);
  drone(k, 'log', 0.05, 0.08);
  return 0.4;
}

// --- Quarries ---------------------------------------------------------------------------
// The stepped pit every quarry keeps, in its own stone (grey for the quarry,
// white for the marble quarry).
const STONE = () => ({ rim: mats.stone, step: mats.stoneDark, floor: mats.rock, block: mats.stone });
const MARBLE = () => ({ rim: mats.marbleShade, step: mats.marble, floor: mats.marbleShade, block: mats.marble });
function pit(k, m) {
  k.part('qRim', () => cyl(0.36, 0.38, 0.05, 6), m.rim, 0, 0.025, 0);
  k.part('qStep', () => cyl(0.27, 0.27, 0.052, 6), m.step, 0, 0.03, 0);
  k.part('qFloor', () => cyl(0.17, 0.17, 0.054, 6), m.floor, 0, 0.032, 0);
}
function cutBlocks(k, m, spots) {
  for (const [x, z, up] of spots) {
    const b = k.part('qBlock', () => box(0.1, 0.07, 0.08), m, x, 0.085 + up * 0.07, z);
    b.rotation.y = k.r() * 0.6 - 0.3;
  }
}
// Industrial Revolution: an iron derrick worked by a steam engine, and a
// cart on rails.
function steamQuarry(k, m) {
  pit(k, m);
  cutBlocks(k, m.block, [[-0.2, 0.2, 0], [-0.08, 0.24, 0], [-0.14, 0.22, 1], [0.27, 0.06, 0]]);
  k.part('sqDerrick', () => mergeGeos([
    boxAt(0.028, 0.52, 0.028, -0.24, 0.26, -0.18),
    beamGeo(V(-0.24, 0.5, -0.18), V(-0.38, 0.02, -0.02), 0.012),
    beamGeo(V(-0.24, 0.5, -0.18), V(-0.06, 0.02, -0.36), 0.012),
    beamGeo(V(-0.24, 0.06, -0.18), V(0.0, 0.42, 0.02), 0.024),
  ]), mats.ironwork, 0, 0, 0);
  k.part('sqCable', () => cyl(0.003, 0.003, 0.2, 4), mats.black, 0.0, 0.32, 0.02);
  k.part('sqLoad', () => box(0.08, 0.06, 0.07), m.block, 0.0, 0.2, 0.02);
  k.part('sqBoiler', () => cyl(0.045, 0.045, 0.13, 12).rotateX(Math.PI / 2), mats.darkMetal, 0.27, 0.095, -0.14);
  k.part('sqStack', () => cyl(0.012, 0.015, 0.14, 6), mats.black, 0.27, 0.19, -0.18);
  smokeAt(k, 0.27, 0.28, -0.18, 1.6, true);
  k.part('sqRails', () => mergeGeos([-1, 1].map((s) => boxAt(0.3, 0.008, 0.008, 0, 0, s * 0.03))), mats.rail, 0.14, 0.054, 0.27);
  k.part('sqCart', () => box(0.08, 0.05, 0.07), mats.darkMetal, 0.1, 0.085, 0.27);
  k.part('sqCartLoad', () => blob(0.04).scale(1, 0.5, 0.9), m.block, 0.1, 0.112, 0.27);
  return 0.56;
}
// Modern Age: an excavator in the pit and a conveyor up to a heap of
// gravel.
function excavatorQuarry(k, m) {
  pit(k, m);
  cutBlocks(k, m.block, [[-0.22, 0.2, 0], [-0.1, 0.25, 0]]);
  const ex = new T.Group();
  ex.position.set(-0.08, 0.056, -0.06);
  ex.rotation.y = 0.7;
  mesh(geo('exTracks', () => mergeGeos([boxAt(0.18, 0.035, 0.035, 0, 0.0175, -0.045), boxAt(0.18, 0.035, 0.035, 0, 0.0175, 0.045)])), mats.black, 0, 0, 0, ex);
  mesh(geo('exBody', () => box(0.12, 0.05, 0.1)), mats.yellow, -0.01, 0.06, 0, ex);
  mesh(geo('exCab', () => box(0.05, 0.055, 0.05)), mats.yellow, -0.025, 0.11, 0.025, ex);
  mesh(geo('exCabGlass', () => box(0.052, 0.03, 0.052)), mats.glass, -0.025, 0.118, 0.025, ex);
  mesh(geo('exWeight', () => box(0.03, 0.04, 0.09)), mats.darkMetal, -0.075, 0.065, 0, ex);
  mesh(geo('exArm', () => mergeGeos([beamGeo(V(0.03, 0.08, -0.02), V(0.14, 0.21, -0.02), 0.024), beamGeo(V(0.14, 0.21, -0.02), V(0.2, 0.08, -0.02), 0.018)])), mats.yellow, 0, 0, 0, ex);
  mesh(geo('exBucket', () => box(0.04, 0.04, 0.05)), mats.darkMetal, 0.205, 0.06, -0.02, ex);
  k.g.add(ex);
  k.part('exBelt', () => mergeGeos([beamGeo(V(0.06, 0.07, 0.06), V(0.27, 0.25, -0.18), 0.04, 0.012), beamGeo(V(0.2, 0.0, -0.1), V(0.2, 0.19, -0.1), 0.014)]), mats.darkMetal, 0, 0, 0);
  k.part('exHeap', () => blob(0.1).scale(1, 0.55, 1), m.block, 0.3, 0.05, -0.22);
  return 0.34;
}
// Future: a white gantry whose laser cuts blocks that float away.
function laserQuarry(k, m) {
  pit(k, m);
  k.part('lqRimLight', () => flatRing(0.37, 0.008, Math.PI * 2, 6).rotateY(Math.PI / 6), mats.neonCyan, 0, 0.052, 0);
  k.part('lqGantry', () => mergeGeos([boxAt(0.03, 0.4, 0.03, -0.3, 0.2, -0.05), boxAt(0.03, 0.4, 0.03, 0.3, 0.2, -0.05), boxAt(0.63, 0.03, 0.04, 0, 0.41, -0.05)]), mats.whiteGloss, 0, 0, 0);
  k.part('lqHead', () => box(0.06, 0.05, 0.06), mats.whiteGloss, 0.04, 0.37, -0.05);
  k.part('lqLaser', () => cyl(0.005, 0.005, 0.3, 6), mats.neonPink, 0.04, 0.2, -0.05);
  k.part('lqCutting', () => box(0.1, 0.07, 0.08), m.block, 0.04, 0.09, -0.05);
  glowAt(k, mats.fireGlow, 0.04, 0.13, -0.05, 0.4);
  for (const [x, z, y] of [[-0.18, 0.2, 0.2], [0.2, 0.18, 0.26]]) {
    k.part('lqPad', () => cyl(0.05, 0.05, 0.01, 12), mats.holo, x, 0.06, z);
    const b = k.part('qBlock', () => box(0.1, 0.07, 0.08), m.block, x, y, z);
    b.rotation.y = k.r() * 0.6;
    k.anim.push({ kind: 'hover', o: b, y });
  }
  return 0.46;
}
// The marble quarry keeps a column drum by the pit, whatever the era.
const marble = (look) => (k) => {
  const h = look(k, MARBLE());
  k.part('mqDrum', () => cyl(0.03, 0.03, 0.07, 10), mats.marble, -0.3, 0.035, 0.08);
  return h;
};
const stone = (look) => (k) => look(k, STONE());

// --- Kiln ---------------------------------------------------------------------------------
// Industrial Revolution: a long Hoffmann kiln, its fires glowing behind the
// chamber doors, and a tall chimney.
function hoffmannKiln(k) {
  k.part('hkYard', () => cyl(0.4, 0.4, 0.012, 6), mats.soil, 0, 0.006, 0);
  k.part('hkBody', () => box(0.52, 0.14, 0.24), mats.brick, 0, 0.07, -0.08);
  k.part('hkRoof', () => gable(0.54, 0.07, 0.27), mats.slate, 0, 0.163, -0.08);
  k.part('hkFires', () => mergeGeos([-0.18, 0.06].map((x) => boxAt(0.05, 0.07, 0.012, x, 0.045, 0.041))), mats.furnace, 0, 0, 0);
  k.part('hkDoors', () => mergeGeos([-0.06, 0.18].map((x) => boxAt(0.05, 0.07, 0.012, x, 0.045, 0.041))), mats.black, 0, 0, 0);
  k.part('hkLintels', () => mergeGeos([-0.18, -0.06, 0.06, 0.18].map((x) => boxAt(0.07, 0.016, 0.014, x, 0.088, 0.042))), mats.brickDark, 0, 0, 0);
  k.part('hkStack', () => cyl(0.035, 0.06, 0.78, 12), mats.brickDark, 0, 0.39, -0.14);
  k.part('hkStackBand', () => cyl(0.04, 0.04, 0.03, 12), k.trim, 0, 0.7, -0.14);
  k.part('hkStackCap', () => cyl(0.045, 0.04, 0.03, 12), mats.brick, 0, 0.78, -0.14);
  smokeAt(k, 0, 0.82, -0.14, 1.6, true);
  brickStack(k, -0.2, 0.22);
  brickStack(k, 0.2, 0.22);
  return 0.84;
}
// Modern Age: a brickworks hall, a conveyor and pallets of bricks.
function brickworks(k) {
  k.part('bwYard', () => cyl(0.4, 0.4, 0.012, 6), mats.concreteDark, 0, 0.006, 0);
  k.part('bwHall', () => box(0.46, 0.2, 0.26), mats.wall2, 0, 0.1, -0.1);
  k.part('bwRoof', () => box(0.48, 0.025, 0.28), mats.steel, 0, 0.212, -0.1);
  k.part('bwBand', () => box(0.462, 0.035, 0.262), k.trim, 0, 0.16, -0.1);
  k.part('bwDoor', () => box(0.12, 0.12, 0.012), mats.darkMetal, -0.1, 0.06, 0.031);
  k.part('bwStack', () => cyl(0.025, 0.03, 0.3, 10), mats.steel, 0.16, 0.36, -0.18);
  k.part('bwStackBand', () => cyl(0.031, 0.031, 0.025, 10), mats.shipRed, 0.16, 0.48, -0.18);
  smokeAt(k, 0.16, 0.52, -0.18, 2.2, false);
  k.part('bwBelt', () => beamGeo(V(0.06, 0.1, 0.035), V(0.2, 0.03, 0.2), 0.035), mats.darkMetal, 0, 0, 0);
  brickStack(k, 0.27, 0.12);
  brickStack(k, -0.25, 0.18);
  brickStack(k, -0.12, 0.25);
  return 0.52;
}
// Future: a white gantry whose printing arm lays a curved wall of clay,
// layer by layer.
function brickPrinter(k) {
  k.part('bpPad', () => cyl(0.41, 0.41, 0.016, 6), mats.concrete, 0, 0.008, 0);
  for (let i = 0; i < 3; i++) k.part('bpLayer' + i, () => flatRing(0.16, 0.022, Math.PI * (1.7 - i * 0.3), 20), mats.brick, 0, 0.038 + i * 0.042, 0);
  k.part('bpFrame', () => mergeGeos([
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => boxAt(0.025, 0.42, 0.025, x * 0.25, 0.21, z * 0.25)),
    boxAt(0.53, 0.025, 0.025, 0, 0.42, -0.25),
    boxAt(0.53, 0.025, 0.025, 0, 0.42, 0.25),
    boxAt(0.025, 0.025, 0.53, 0, 0.42, 0),
  ]), mats.whiteGloss, 0, 0, 0);
  k.part('bpShaft', () => cyl(0.012, 0.012, 0.2, 6), mats.metal, 0, 0.31, 0);
  const arm = new T.Group();
  arm.position.y = 0.21;
  mesh(geo('bpArm', () => box(0.17, 0.02, 0.02).translate(0.085, 0, 0)), mats.whiteGloss, 0, 0, 0, arm);
  mesh(geo('bpHead', () => box(0.04, 0.05, 0.04)), mats.whiteGloss, 0.16, -0.025, 0, arm);
  mesh(geo('bpNozzle', () => cyl(0.012, 0.006, 0.03, 8)), mats.neonPink, 0.16, -0.065, 0, arm);
  k.g.add(arm);
  k.anim.push({ kind: 'spinY', o: arm, speed: 0.7 });
  brickStack(k, 0.33, 0);
  return 0.44;
}

// --- Market ---------------------------------------------------------------------------------
const WARES = () => [mats.crop, mats.berryRed, mats.yellow, mats.crop2];
// Middle Ages: a half timbered market hall on posts, the market held
// underneath it.
function marketHall(k) {
  k.part('mkSquare', () => cyl(0.42, 0.42, 0.012, 6), mats.stone, 0, 0.006, 0);
  k.part('mkPosts', () => mergeGeos([-0.22, -0.075, 0.075, 0.22].flatMap((x) => [-0.17, 0.09].map((z) => boxAt(0.03, 0.15, 0.03, x, 0.075, z)))), mats.timber, 0, 0, 0);
  k.part('mkUpper', () => box(0.5, 0.15, 0.3), mats.plaster, 0, 0.225, -0.04);
  k.part('mkTimber', () => mergeGeos([
    ...[-0.24, -0.08, 0.08, 0.24].map((x) => boxAt(0.02, 0.15, 0.01, x, 0.225, 0.112)),
    boxAt(0.5, 0.018, 0.01, 0, 0.158, 0.112),
    boxAt(0.5, 0.018, 0.01, 0, 0.292, 0.112),
    beamGeo(V(-0.24, 0.16, 0.112), V(-0.08, 0.29, 0.112), 0.014, 0.01),
    beamGeo(V(0.24, 0.16, 0.112), V(0.08, 0.29, 0.112), 0.014, 0.01),
  ]), mats.timber, 0, 0, 0);
  k.part('mkWins', () => mergeGeos([-0.16, 0, 0.16].map((x) => boxAt(0.04, 0.05, 0.01, x, 0.23, 0.114))), mats.window, 0, 0, 0);
  k.part('mkRoof', () => gable(0.58, 0.2, 0.36), k.b.color ? k.trim : mats.roofTile, 0, 0.367, -0.04);
  k.part('mkTurret', () => box(0.06, 0.06, 0.06), mats.plaster, 0, 0.53, -0.04);
  k.part('mkTurretCap', () => cone(0.055, 0.09, 4).rotateY(Math.PI / 4), mats.slate, 0, 0.605, -0.04);
  WARES().slice(0, 3).forEach((m, i) => {
    const x = -0.14 + i * 0.14;
    const z = i === 1 ? -0.07 : 0.0;
    k.part('mkCrate', () => box(0.1, 0.05, 0.07), mats.wood, x, 0.025, z);
    k.part('mkWares', () => blob(0.04).scale(1.1, 0.5, 0.8), m, x, 0.06, z);
  });
  k.part('mkBarrels', () => mergeGeos([cylAt(0.028, 0.028, 0.06, -0.3, 0.03, 0.2, 8), cylAt(0.028, 0.028, 0.06, -0.24, 0.03, 0.25, 8)]), mats.wood, 0, 0, 0);
  return 0.65;
}
// Industrial Revolution: a covered market of iron and glass, its end a fan
// of glass over a brick doorway.
function glassMarket(k) {
  k.part('gmSquare', () => cyl(0.42, 0.42, 0.012, 6), mats.stone, 0, 0.006, 0);
  k.part('gmWalls', () => mergeGeos([boxAt(0.03, 0.12, 0.46, -0.2, 0.06, -0.03), boxAt(0.03, 0.12, 0.46, 0.2, 0.06, -0.03), boxAt(0.43, 0.12, 0.03, 0, 0.06, -0.25), boxAt(0.14, 0.12, 0.03, -0.145, 0.06, 0.19), boxAt(0.14, 0.12, 0.03, 0.145, 0.06, 0.19)]), mats.brick, 0, 0, 0);
  k.part('gmVault', () => new T.CylinderGeometry(0.21, 0.21, 0.46, 18, 1, true, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2), clearGlass(0xbfe3f5, 0.5), 0, 0.12, -0.03);
  k.part('gmRibs', () => mergeGeos([-0.25, -0.1, 0.05, 0.19].map((z) => new T.TorusGeometry(0.212, 0.009, 4, 18, Math.PI).translate(0, 0, z))), mats.ironwork, 0, 0.12, 0);
  k.part('gmRidge', () => box(0.02, 0.02, 0.48), mats.ironwork, 0, 0.335, -0.03);
  k.part('gmFan', () => new T.CircleGeometry(0.205, 18, 0, Math.PI), clearGlass(0xbfe3f5, 0.5), 0, 0.12, 0.19);
  k.part('gmFanBars', () => mergeGeos([0.3, 0.9, 1.57, 2.24, 2.84].map((a) => beamGeo(V(0, 0.12, 0.192), V(Math.cos(a) * 0.2, 0.12 + Math.sin(a) * 0.2, 0.192), 0.008, 0.006))), mats.ironwork, 0, 0, 0);
  k.part('gmSign', () => new T.PlaneGeometry(0.15, 0.045), mats.sign, 0, 0.15, 0.207);
  WARES().forEach((m, i) => {
    const x = i % 2 ? 0.09 : -0.09;
    const z = i < 2 ? -0.13 : 0.03;
    k.part('gmStall', () => box(0.1, 0.05, 0.08), mats.wood, x, 0.025, z);
    k.part('gmWares', () => blob(0.04).scale(1.1, 0.5, 0.8), m, x, 0.06, z);
  });
  return 0.36;
}
// Modern Age: a supermarket with a glass front, the owner's colour on its
// sign, trolleys and a car in the car park.
function supermarket(k) {
  k.part('smkLot', () => cyl(0.42, 0.42, 0.01, 6), mats.concreteDark, 0, 0.005, 0);
  k.part('smkStore', () => box(0.5, 0.17, 0.26), mats.wall, 0, 0.085, -0.1);
  k.part('smkRoofEdge', () => box(0.52, 0.02, 0.28), mats.concrete, 0, 0.18, -0.1);
  k.part('smkGlass', () => box(0.36, 0.11, 0.01), mats.glass, 0.03, 0.058, 0.031);
  k.part('smkSign', () => box(0.5, 0.04, 0.012), k.trim, 0, 0.145, 0.032);
  k.part('smkUnits', () => mergeGeos([boxAt(0.06, 0.04, 0.05, -0.14, 0.21, -0.14), boxAt(0.06, 0.04, 0.05, 0.1, 0.21, -0.06)]), mats.metal, 0, 0, 0);
  k.part('smkLines', () => mergeGeos([-0.24, -0.12, 0, 0.12, 0.24].map((x) => boxAt(0.008, 0.003, 0.12, x, 0.011, 0.22))), mats.white, 0, 0, 0);
  const car = new T.Group();
  car.position.set(-0.06, 0.011, 0.22);
  mesh(geo('smkCar', () => box(0.07, 0.03, 0.11)), mats.shipRed, 0, 0.025, 0, car);
  mesh(geo('smkCarTop', () => box(0.06, 0.025, 0.06)), mats.glass, 0, 0.05, -0.005, car);
  mesh(geo('smkCarWheels', () => mergeGeos([[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => cyl(0.014, 0.014, 0.01, 8).rotateZ(Math.PI / 2).translate(a * 0.036, 0.012, b * 0.035)))), mats.black, 0, 0, 0, car);
  k.g.add(car);
  k.part('smkTrolleys', () => mergeGeos([0, 1, 2].map((i) => boxAt(0.03, 0.03, 0.04, 0.2 + i * 0.012, 0.025, 0.07))), mats.metal, 0, 0, 0);
  return 0.24;
}
// Future: a glass dome full of wares, with holo signs floating round it.
function holoMarket(k) {
  k.part('hmPlaza', () => cyl(0.42, 0.42, 0.014, 6), mats.whiteGloss, 0, 0.007, 0);
  k.part('hmRing', () => flatRing(0.25, 0.008, Math.PI * 2, 32), mats.neonCyan, 0, 0.016, -0.04);
  WARES().slice(0, 3).forEach((m, i) => {
    const x = [-0.08, 0.08, 0][i];
    const z = [-0.1, -0.1, 0.02][i];
    k.part('hmStand', () => cyl(0.05, 0.05, 0.05, 10), mats.whiteGloss, x, 0.04, z);
    k.part('hmWares', () => blob(0.035).scale(1.1, 0.6, 1.1), m, x, 0.08, z);
  });
  k.part('hmDome', () => dome(0.22), clearGlass(), 0, 0.014, -0.04);
  for (const [x, z, y, m] of [[-0.25, 0.16, 0.3, mats.neonPink], [0.25, 0.16, 0.36, mats.neonCyan], [0.0, -0.3, 0.4, mats.neonCyan]]) {
    const s = k.part('hmSign', () => box(0.12, 0.06, 0.008), m, x, y, z);
    s.rotation.y = Math.atan2(x, z) * 0.5;
    k.anim.push({ kind: 'hover', o: s, y });
  }
  return 0.46;
}

// --- Harbor -------------------------------------------------------------------------------
// Industrial Revolution: a dock warehouse of brick, an iron crane and a
// steamboat at the pier.
function steamHarbor(k) {
  k.part('quay', () => box(0.5, 0.05, 0.22), mats.stone, 0, 0.025, -0.12);
  k.part('shPier', () => box(0.14, 0.035, 0.42), mats.concreteDark, 0.12, 0.032, 0.18);
  k.part('shPierLegs', () => mergeGeos([0.05, 0.2, 0.35].flatMap((z) => [-1, 1].map((s) => cylAt(0.012, 0.012, 0.12, 0.12 + s * 0.065, 0, z, 5)))), mats.darkMetal, 0, 0, 0);
  k.part('shStore', () => box(0.24, 0.16, 0.16), mats.brick, -0.12, 0.13, -0.15);
  k.part('shStoreRoof', () => gable(0.26, 0.08, 0.18), mats.slate, -0.12, 0.237, -0.15);
  k.part('shStoreDoor', () => box(0.07, 0.1, 0.012), mats.door, -0.12, 0.1, -0.069);
  k.part('shCrane', () => mergeGeos([boxAt(0.03, 0.36, 0.03, 0.22, 0.23, -0.16), beamGeo(V(0.22, 0.4, -0.16), V(0.12, 0.42, 0.12), 0.02), beamGeo(V(0.22, 0.12, -0.16), V(0.12, 0.42, 0.12), 0.014)]), mats.ironwork, 0, 0, 0);
  k.part('shCable', () => cyl(0.003, 0.003, 0.2, 4), mats.black, 0.12, 0.32, 0.12);
  k.part('shCrate', () => box(0.07, 0.06, 0.07), mats.wood, 0.12, 0.2, 0.12);
  const boat = new T.Group();
  boat.position.set(-0.08, 0.02, 0.22);
  mesh(geo('shHull', () => box(0.12, 0.06, 0.32)), mats.darkMetal, 0, 0, 0, boat);
  mesh(geo('shHullBand', () => box(0.122, 0.015, 0.322)), mats.shipRed, 0, -0.02, 0, boat);
  mesh(geo('shCabin', () => box(0.08, 0.06, 0.12)), mats.shipWhite, 0, 0.06, -0.04, boat);
  mesh(geo('shFunnel', () => cyl(0.022, 0.022, 0.1, 10)), mats.shipRed, 0, 0.13, 0.03, boat);
  mesh(geo('shFunnelTop', () => cyl(0.023, 0.023, 0.025, 10)), mats.black, 0, 0.18, 0.03, boat);
  k.g.add(boat);
  k.anim.push({ kind: 'bob', o: boat });
  smokeAt(k, -0.08, 0.24, 0.25, 1.4, true);
  for (let i = 0; i < 2; i++) k.part('barrel', () => cyl(0.03, 0.03, 0.06, 8), mats.wood, 0.05 + i * 0.065, 0.08, -0.06);
  return 0.5;
}
// Modern Age: a container port, its gantry crane reaching out over a
// container ship.
function containerPort(k) {
  const colours = [mats.shipRed, mats.panelBlue, k.trim, mats.yellow, mats.leaf2];
  k.part('cpQuay', () => box(0.56, 0.05, 0.26), mats.concrete, 0, 0.025, -0.12);
  k.part('cpEdge', () => box(0.56, 0.012, 0.02), mats.yellow, 0, 0.056, 0.0);
  [[-0.2, -0.18, 0], [-0.2, -0.18, 1], [-0.2, -0.07, 0], [-0.06, -0.18, 0], [-0.06, -0.07, 0], [-0.06, -0.18, 1]].forEach(([x, z, up], i) => k.part('cpBox', () => box(0.12, 0.05, 0.08), colours[i % colours.length], x, 0.077 + up * 0.052, z));
  k.part('cpCrane', () => mergeGeos([
    ...[[0.1, -0.2], [0.24, -0.2], [0.1, -0.04], [0.24, -0.04]].map(([x, z]) => boxAt(0.02, 0.4, 0.02, x, 0.25, z)),
    boxAt(0.16, 0.025, 0.02, 0.17, 0.25, -0.2),
    boxAt(0.16, 0.025, 0.02, 0.17, 0.25, -0.04),
    boxAt(0.05, 0.03, 0.64, 0.17, 0.46, 0.07),
    boxAt(0.02, 0.18, 0.02, 0.17, 0.56, -0.12),
    beamGeo(V(0.17, 0.64, -0.12), V(0.17, 0.47, 0.36), 0.008),
  ]), mats.panelBlue, 0, 0, 0);
  k.part('cpTrolley', () => box(0.05, 0.03, 0.06), mats.darkMetal, 0.17, 0.43, 0.24);
  k.part('cpCable', () => cyl(0.003, 0.003, 0.14, 4), mats.black, 0.17, 0.35, 0.24);
  k.part('cpLift', () => box(0.05, 0.04, 0.1), mats.shipRed, 0.17, 0.26, 0.24);
  const ship = new T.Group();
  ship.position.set(0.17, 0.02, 0.24);
  mesh(geo('cpHull', () => box(0.14, 0.05, 0.32)), mats.darkMetal, 0, 0, 0, ship);
  mesh(geo('cpHullRed', () => box(0.142, 0.016, 0.322)), mats.shipRed, 0, -0.02, 0, ship);
  mesh(geo('cpBridge', () => box(0.1, 0.08, 0.05)), mats.shipWhite, 0, 0.065, -0.14, ship);
  for (let i = 0; i < 3; i++) mesh(geo('cpDeckBox', () => box(0.11, 0.035, 0.06)), colours[(i + 1) % colours.length], 0, 0.043, -0.06 + i * 0.07, ship);
  k.g.add(ship);
  k.anim.push({ kind: 'bob', o: ship });
  return 0.66;
}
// Future: a white quay edged with light, a hover ship and a cargo lift.
function hoverHarbor(k) {
  k.part('hhQuay', () => box(0.5, 0.05, 0.22), mats.whiteGloss, 0, 0.025, -0.12);
  k.part('hhEdge', () => box(0.5, 0.01, 0.015), mats.neonCyan, 0, 0.055, -0.005);
  k.part('hhPier', () => box(0.1, 0.025, 0.36), mats.whiteGloss, 0.14, 0.04, 0.17);
  k.part('hhPierLights', () => mergeGeos([0.06, 0.18, 0.3].map((z) => boxAt(0.012, 0.008, 0.012, 0.19, 0.056, z))), mats.neonCyan, 0, 0, 0);
  const at = new T.Group();
  at.position.set(-0.07, 0, 0.22);
  const ship = new T.Group();
  mesh(geo('hhHull', () => new T.CapsuleGeometry(0.05, 0.22, 4, 10).rotateX(Math.PI / 2).scale(1, 0.55, 1)), mats.whiteGloss, 0, 0, 0, ship);
  mesh(geo('hhCanopy', () => sph(0.04, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.8, 2)), clearGlass(0x9fd8ff, 0.6), 0, 0.02, -0.03, ship);
  mesh(geo('hhGlow', () => box(0.102, 0.008, 0.2)), mats.neonPink, 0, -0.012, 0, ship);
  at.add(ship);
  k.g.add(at);
  k.anim.push({ kind: 'hover', o: ship, y: 0.1 });
  k.part('hhLiftPad', () => cyl(0.06, 0.06, 0.01, 16), mats.concreteDark, -0.16, 0.055, -0.14);
  k.part('hhLiftRing', () => flatRing(0.06, 0.006), mats.neonCyan, -0.16, 0.062, -0.14);
  const crate = k.part('hhCrate', () => box(0.06, 0.06, 0.06), mats.whiteGloss, -0.16, 0.16, -0.14);
  k.anim.push({ kind: 'hover', o: crate, y: 0.16 });
  k.part('hhMast', () => cyl(0.012, 0.018, 0.4, 8), mats.whiteGloss, 0.2, 0.25, -0.18);
  blinkAt(k, 0.2, 0.46, -0.18);
  return 0.5;
}

// --- Mine ---------------------------------------------------------------------------------
// Industrial Revolution and Modern Age: a pithead, the winding wheel turning
// on its iron headframe, the engine house beside it.
function pithead(k) {
  k.part('phHill', () => dome(0.2).scale(1.2, 0.8, 1), mats.stoneDark, -0.17, 0, -0.17);
  k.part('phRock', () => new T.DodecahedronGeometry(0.09, 0), mats.rock, -0.3, 0.05, 0.02);
  k.part('phFrame', () => mergeGeos([
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => beamGeo(V(0.1 + x * 0.08, 0, 0.04 + z * 0.08), V(0.1 + x * 0.03, 0.48, 0.04 + z * 0.03), 0.018)),
    ...[0.16, 0.32].flatMap((y) => {
      const w = 0.08 - (y / 0.48) * 0.05;
      return [boxAt(2 * w, 0.012, 0.012, 0.1, y, 0.04 + w), boxAt(2 * w, 0.012, 0.012, 0.1, y, 0.04 - w), boxAt(0.012, 0.012, 2 * w, 0.1 + w, y, 0.04), boxAt(0.012, 0.012, 2 * w, 0.1 - w, y, 0.04)];
    }),
    beamGeo(V(0.1, 0.48, 0.04), V(0.3, 0.02, -0.16), 0.016),
    boxAt(0.1, 0.02, 0.1, 0.1, 0.49, 0.04),
  ]), mats.ironwork, 0, 0, 0);
  const wheel = new T.Group();
  wheel.position.set(0.1, 0.56, 0.04);
  mesh(geo('phWheel', () => new T.TorusGeometry(0.07, 0.009, 5, 18)), mats.ironwork, 0, 0, 0, wheel);
  mesh(geo('phSpokes', () => mergeGeos([0, 1, 2].map((i) => box(0.14, 0.008, 0.008).rotateZ((i * Math.PI) / 3)))), mats.ironwork, 0, 0, 0, wheel);
  k.g.add(wheel);
  k.anim.push({ kind: 'spinZ', o: wheel, speed: 1.4 });
  k.part('phEngine', () => box(0.16, 0.14, 0.14), mats.brick, 0.26, 0.07, -0.24);
  k.part('phEngineRoof', () => gable(0.18, 0.07, 0.16), mats.slate, 0.26, 0.163, -0.24);
  k.part('phChimney', () => cyl(0.02, 0.028, 0.34, 8), mats.brickDark, 0.33, 0.17, -0.29);
  smokeAt(k, 0.33, 0.35, -0.29, 1.8, true);
  k.part('phRope', () => beamGeo(V(0.1, 0.56, 0.04), V(0.22, 0.12, -0.18), 0.004), mats.black, 0, 0, 0);
  for (const s of [-1, 1]) k.part('mineRail', () => box(0.008, 0.008, 0.26), mats.darkMetal, 0.1 + s * 0.035, 0.005, 0.3);
  k.part('cart', () => box(0.08, 0.05, 0.1), mats.darkMetal, 0.1, 0.04, 0.3);
  k.part('cartCoal', () => sph(0.04, 8, 5), mats.coal, 0.1, 0.07, 0.3).scale.set(1, 0.5, 1.2);
  k.part('coalPile', () => blob(0.07).scale(1, 0.6, 1), mats.coal, -0.16, 0.03, 0.2);
  return 0.64;
}
// Future: a white dome over the shaft, a beam of light down into the rock
// and a conveyor of glowing ore.
function futureMine(k) {
  k.part('fmHill', () => dome(0.22).scale(1.2, 0.75, 1), mats.stoneDark, -0.14, 0, -0.17);
  k.part('fmDome', () => dome(0.15), mats.whiteGloss, 0.1, 0, -0.02);
  k.part('fmDomeRing', () => flatRing(0.15, 0.01), mats.neonCyan, 0.1, 0.02, -0.02);
  k.part('fmDoor', () => box(0.06, 0.07, 0.04), mats.darkMetal, 0.1, 0.035, 0.12);
  k.part('fmMast', () => cyl(0.015, 0.02, 0.16, 8), mats.whiteGloss, 0.1, 0.22, -0.02);
  const beam = k.part('fmBeam', () => cyl(0.022, 0.022, 0.42, 10), mats.holo, 0.1, 0.5, -0.02);
  k.anim.push({ kind: 'pulse', o: beam });
  k.part('fmBelt', () => mergeGeos([boxAt(0.05, 0.012, 0.26, -0.14, 0.06, 0.18), ...[0.08, 0.28].map((z) => boxAt(0.012, 0.055, 0.012, -0.14, 0.027, z))]), mats.whiteGloss, 0, 0, 0);
  k.part('fmOre', () => mergeGeos([0.1, 0.18, 0.26].map((z) => boxAt(0.035, 0.03, 0.035, -0.14, 0.081, z))), mats.neonPink, 0, 0, 0);
  k.part('fmBins', () => mergeGeos([boxAt(0.08, 0.06, 0.08, 0.26, 0.03, 0.16), boxAt(0.08, 0.06, 0.08, 0.26, 0.09, 0.16)]), mats.whiteGloss, 0, 0, 0);
  return 0.72;
}

// --- Outpost --------------------------------------------------------------------------------
// Middle Ages and the Industrial Revolution: a palisade of sharpened logs
// round a lookout tower.
function blockhouse(k) {
  k.part('obYard', () => cyl(0.38, 0.38, 0.012, 6), mats.soil, 0, 0.006, 0);
  k.part('obPalisade', () => {
    const parts = [];
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      if (Math.min(a, Math.PI * 2 - a) < 0.4) continue;
      const x = Math.sin(a) * 0.32;
      const z = Math.cos(a) * 0.32;
      parts.push(cylAt(0.022, 0.022, 0.18, x, 0.09, z, 6), cone(0.022, 0.04, 6).translate(x, 0.2, z));
    }
    return mergeGeos(parts);
  }, mats.trunk, 0, 0, 0);
  k.part('obTower', () => mergeGeos([
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => boxAt(0.025, 0.52, 0.025, -0.08 + x * 0.075, 0.26, -0.1 + z * 0.075)),
    boxAt(0.2, 0.025, 0.2, -0.08, 0.4, -0.1),
    boxAt(0.2, 0.014, 0.012, -0.08, 0.46, -0.006),
    boxAt(0.2, 0.014, 0.012, -0.08, 0.46, -0.194),
    boxAt(0.012, 0.014, 0.2, 0.014, 0.46, -0.1),
    boxAt(0.012, 0.014, 0.2, -0.174, 0.46, -0.1),
    beamGeo(V(-0.155, 0.02, -0.025), V(-0.005, 0.38, -0.025), 0.012),
  ]), mats.woodDark, 0, 0, 0);
  k.part('obRoof', () => cone(0.17, 0.12, 4).rotateY(Math.PI / 4), mats.woodDark, -0.08, 0.58, -0.1);
  flag(k, -0.08, 0.64, -0.1, 0.18);
  for (const [x, y, z] of [[0.12, 0.05, 0.1], [0.2, 0.05, 0.02], [0.15, 0.15, 0.06]]) {
    const c = k.part('crate', () => box(1, 1, 1), mats.crate2 || mats.wood, x, y, z);
    c.scale.setScalar(0.1);
    c.rotation.y = k.r() * 0.6;
  }
  return 0.84;
}
// Modern Age: a depot of shipping containers with a radio mast and a dish.
function depot(k) {
  k.part('odPad', () => cyl(0.38, 0.38, 0.014, 6), mats.concrete, 0, 0.007, 0);
  k.part('odBoxA', () => box(0.3, 0.1, 0.12), k.trim, -0.06, 0.064, -0.16);
  k.part('odBoxB', () => box(0.3, 0.1, 0.12), mats.panelBlue, 0.0, 0.064, -0.02);
  k.part('odBoxC', () => box(0.3, 0.1, 0.12), mats.shipRed, -0.06, 0.165, -0.16);
  k.part('odDoors', () => mergeGeos([boxAt(0.006, 0.08, 0.1, 0.15, 0.064, -0.02), boxAt(0.006, 0.08, 0.1, 0.09, 0.064, -0.16)]), mats.darkMetal, 0, 0, 0);
  k.part('odMast', () => mergeGeos([boxAt(0.014, 0.62, 0.014, 0.25, 0.31, -0.2), ...[0.15, 0.3, 0.45].map((y) => beamGeo(V(0.25, y, -0.2), V(0.25, y + 0.1, -0.16), 0.006)), boxAt(0.006, 0.6, 0.006, 0.25, 0.3, -0.16)]), mats.metal, 0, 0, 0);
  blinkAt(k, 0.25, 0.63, -0.2);
  k.part('odDishPost', () => cyl(0.01, 0.012, 0.14, 6), mats.metal, 0.24, 0.07, 0.14);
  k.part('odDish', () => cyl(0.065, 0.03, 0.025, 16).rotateX(1.0), mats.whiteGloss, 0.24, 0.16, 0.14);
  flag(k, -0.26, 0.0, 0.12, 0.5);
  for (const [x, z] of [[0.04, 0.2], [-0.06, 0.24]]) {
    const c = k.part('crate', () => box(1, 1, 1), mats.crate2 || mats.wood, x, 0.05, z);
    c.scale.setScalar(0.1);
    c.rotation.y = k.r() * 0.6;
  }
  return 0.66;
}
// Future: a dome to live in, a landing pad ringed with light and a drone.
function habitat(k) {
  k.part('ohPad', () => cyl(0.38, 0.38, 0.014, 6), mats.whiteGloss, 0, 0.007, 0);
  k.part('ohDome', () => dome(0.17), mats.whiteGloss, -0.1, 0.014, -0.1);
  k.part('ohDomeBand', () => flatRing(0.162, 0.014, Math.PI * 2, 28), mats.neonCyan, -0.1, 0.07, -0.1);
  k.part('ohTunnel', () => cyl(0.045, 0.045, 0.12, 12).rotateX(Math.PI / 2), mats.whiteGloss, -0.1, 0.045, 0.08);
  k.part('ohDoor', () => cyl(0.03, 0.03, 0.01, 12).rotateX(Math.PI / 2), mats.glassBlue, -0.1, 0.045, 0.142);
  k.part('ohLanding', () => cyl(0.11, 0.11, 0.012, 20), mats.concreteDark, 0.17, 0.014, 0.13);
  k.part('ohLandingRing', () => flatRing(0.09, 0.006, Math.PI * 2, 28), mats.neonCyan, 0.17, 0.022, 0.13);
  drone(k, 'box', 0.12, 0.1);
  k.part('ohMast', () => cyl(0.008, 0.012, 0.4, 6), mats.whiteGloss, 0.22, 0.2, -0.2);
  blinkAt(k, 0.22, 0.41, -0.2);
  k.part('ohCrates', () => mergeGeos([boxAt(0.07, 0.07, 0.07, 0.26, 0.035, -0.02), boxAt(0.07, 0.07, 0.07, 0.24, 0.105, -0.03)]), mats.whiteGloss, 0, 0, 0);
  return 0.5;
}

// --- Fountain -------------------------------------------------------------------------------
// Future: rings of light turning over a white basin.
function holoFountain(k) {
  k.part('hfBasin', () => cyl(0.3, 0.32, 0.07, 20), mats.whiteGloss, 0, 0.035, 0);
  k.part('hfWater', () => cyl(0.27, 0.27, 0.02, 20), mats.waterLight, 0, 0.065, 0);
  k.part('hfRim', () => flatRing(0.31, 0.008, Math.PI * 2, 32), mats.neonCyan, 0, 0.072, 0);
  k.part('hfColumn', () => cyl(0.02, 0.03, 0.34, 10), mats.holo, 0, 0.24, 0);
  const rings = new T.Group();
  [[0.16, 0.16, mats.neonCyan], [0.12, 0.26, mats.neonPink], [0.08, 0.36, mats.neonCyan]].forEach(([r, y, m], i) => {
    const ring = mesh(geo('hfRing' + i, () => flatRing(r, 0.008, Math.PI * 2, 28)), m, 0, y, 0, rings);
    ring.rotation.z = (i - 1) * 0.3;
  });
  k.g.add(rings);
  k.anim.push({ kind: 'spinY', o: rings, speed: 0.8 });
  glowAt(k, mats.glow, 0, 0.3, 0, 0.9);
  k.anim.push({ kind: 'fountain', x: 0, y: 0.42, z: 0 });
  return 0.45;
}

// --- Farm -----------------------------------------------------------------------------------
function fields(k) {
  k.part('field', () => box(0.62, 0.03, 0.42), mats.soil, 0.04, 0.015, 0.06);
  for (let i = 0; i < 5; i++) {
    const row = k.part('cropRow', () => box(0.56, 0.05, 0.04), i % 2 ? mats.crop : mats.crop2, 0.04, 0.05, -0.1 + i * 0.08);
    row.scale.y = 0.8 + k.r() * 0.4;
  }
}
// Middle Ages: a timber barn under a steep thatch, and haystacks.
function thatchFarm(k) {
  fields(k);
  const barn = new T.Group();
  barn.position.set(-0.22, 0, -0.24);
  barn.rotation.y = 0.5;
  mesh(geo('tfBarn', () => box(0.22, 0.14, 0.18)), mats.wood, 0, 0.07, 0, barn);
  mesh(geo('tfThatch', () => gable(0.27, 0.17, 0.23)), mats.straw, 0, 0.197, 0, barn);
  mesh(geo('tfBarnDoor', () => box(0.07, 0.1, 0.01)), mats.door, 0, 0.05, 0.091, barn);
  k.g.add(barn);
  for (const [x, z] of [[0.2, -0.28], [0.32, -0.22]]) k.part('tfHay', () => cone(0.06, 0.13, 8), mats.hay, x, 0.065, z);
  return 0.36;
}
// Industrial Revolution: a red barn with white doors and a silo.
function redBarnFarm(k) {
  fields(k);
  const barn = new T.Group();
  barn.position.set(-0.2, 0, -0.24);
  barn.rotation.y = 0.5;
  mesh(geo('rbBarn', () => box(0.22, 0.16, 0.2)), mats.shipRed, 0, 0.08, 0, barn);
  mesh(geo('rbRoof', () => gable(0.25, 0.12, 0.23)), mats.slate, 0, 0.2, 0, barn);
  mesh(geo('rbDoor', () => box(0.08, 0.11, 0.01)), mats.white, 0, 0.055, 0.101, barn);
  mesh(geo('rbBrace', () => mergeGeos([beamGeo(V(-0.035, 0.005, 0.107), V(0.035, 0.105, 0.107), 0.008, 0.004), beamGeo(V(0.035, 0.005, 0.107), V(-0.035, 0.105, 0.107), 0.008, 0.004)])), mats.shipRed, 0, 0, 0, barn);
  k.g.add(barn);
  k.part('rbSilo', () => cyl(0.05, 0.05, 0.32, 12), mats.metal, 0.0, 0.16, -0.32);
  k.part('rbSiloTop', () => dome(0.05), mats.metal, 0.0, 0.32, -0.32);
  return 0.38;
}

// --- Granary --------------------------------------------------------------------------------
// Roman Empire: a horreum, a long storehouse of plaster under red tiles,
// amphorae and sacks by its arched door.
function horreum(k) {
  k.part('hoYard', () => cyl(0.4, 0.4, 0.012, 6), mats.travertine, 0, 0.006, 0);
  k.part('hoPlinth', () => box(0.56, 0.035, 0.28), mats.travertineDark, 0, 0.0175, -0.08);
  k.part('hoHall', () => box(0.54, 0.2, 0.26), mats.plaster, 0, 0.1, -0.08);
  k.part('hoRoof', () => gable(0.58, 0.11, 0.3), k.b.color ? k.trim : mats.terracotta, 0, 0.237, -0.08);
  k.part('hoSlits', () => mergeGeos([-0.2, -0.1, 0.1, 0.2].map((x) => boxAt(0.018, 0.05, 0.01, x, 0.15, 0.052))), mats.black, 0, 0, 0);
  k.part('hoDoor', () => box(0.08, 0.13, 0.012), mats.door, 0, 0.065, 0.052);
  k.part('hoArch', () => new T.TorusGeometry(0.045, 0.012, 5, 10, Math.PI), mats.travertine, 0, 0.13, 0.055);
  for (const [x, z, sc] of [[-0.16, 0.16, 1], [-0.1, 0.2, 0.9], [0.14, 0.18, 1], [0.2, 0.14, 0.85]]) {
    const a = k.part('hoAmphora', () => sph(0.03, 8, 6).scale(1, 1.6, 1), mats.terracotta, x, 0.05 * sc, z);
    a.scale.setScalar(sc);
  }
  for (const [x, z] of [[0.29, 0.04], [0.27, 0.2]]) k.part('grSack', () => sph(0.045, 8, 6), mats.straw, x, 0.04, z).scale.set(1, 0.85, 1);
  return 0.32;
}
// Middle Ages: a tithe barn of stone with a steep roof and a porch, and a
// cart of sacks outside.
function titheBarn(k) {
  const roof = k.b.color ? k.trim : mats.slate;
  k.part('tbYard', () => cyl(0.4, 0.4, 0.012, 6), mats.soil, 0, 0.006, 0);
  k.part('tbWalls', () => box(0.5, 0.17, 0.24), mats.stone, 0, 0.085, -0.08);
  k.part('tbRoof', () => gable(0.54, 0.22, 0.28), roof, 0, 0.244, -0.08);
  k.part('tbButtresses', () => mergeGeos([-0.17, 0.17].map((x) => boxAt(0.035, 0.12, 0.04, x, 0.06, 0.06))), mats.stoneDark, 0, 0, 0);
  k.part('tbPorch', () => box(0.14, 0.15, 0.08), mats.stone, 0, 0.075, 0.08);
  k.part('tbPorchRoof', () => gable(0.12, 0.08, 0.18).rotateY(Math.PI / 2), roof, 0, 0.177, 0.08);
  k.part('tbDoors', () => box(0.09, 0.12, 0.012), mats.woodDark, 0, 0.06, 0.121);
  k.part('tbSlits', () => mergeGeos([-0.22, 0.22].map((x) => boxAt(0.02, 0.06, 0.01, x, 0.11, 0.041))), mats.black, 0, 0, 0);
  const cart = new T.Group();
  cart.position.set(0.22, 0, 0.22);
  cart.rotation.y = 0.4;
  mesh(geo('tbCart', () => box(0.14, 0.04, 0.09)), mats.wood, 0, 0.06, 0, cart);
  mesh(geo('tbWheels', () => mergeGeos([-1, 1].map((sd) => cyl(0.04, 0.04, 0.012, 10).rotateX(Math.PI / 2).translate(0, 0.04, sd * 0.05)))), mats.woodDark, 0, 0, 0, cart);
  mesh(geo('tbCartSacks', () => mergeGeos([sph(0.03, 8, 6).translate(-0.03, 0.1, 0), sph(0.03, 8, 6).translate(0.03, 0.1, 0.01)])), mats.straw, 0, 0, 0, cart);
  k.g.add(cart);
  for (const [x, z] of [[-0.22, 0.16], [-0.15, 0.21]]) k.part('grSack', () => sph(0.045, 8, 6), mats.straw, x, 0.04, z).scale.set(1, 0.85, 1);
  return 0.42;
}

// --- Campfire -------------------------------------------------------------------------------
// Benches round a fire in the middle, facing it.
function benchesRound(k, r, angles) {
  for (const a of angles) {
    const b = benchMesh();
    b.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    b.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a));
    b.scale.setScalar(0.7);
    k.g.add(b);
  }
}
// Industrial Revolution: an iron brazier on a little cobbled square.
function brazierSquare(k) {
  k.part('bzSquare', () => cyl(0.38, 0.38, 0.014, 8), mats.stoneDark, 0, 0.007, 0);
  k.part('bzStand', () => mergeGeos([0, 1, 2].map((i) => beamGeo(V(Math.cos(i * 2.094) * 0.07, 0, Math.sin(i * 2.094) * 0.07), V(0, 0.13, 0), 0.012))), mats.ironwork, 0, 0, 0);
  k.part('bzBowl', () => cyl(0.08, 0.05, 0.05, 10), mats.ironwork, 0, 0.145, 0);
  fire(k, 0, 0.19, 0);
  benchesRound(k, 0.28, [0.5, 2.6, 4.7]);
  return 0.32;
}
// Modern Age: a fire pit, a kettle barbecue and a picnic table.
function firePit(k) {
  k.part('fpPatio', () => cyl(0.38, 0.38, 0.014, 6), mats.concrete, 0, 0.007, 0);
  k.part('fpRing', () => cyl(0.13, 0.14, 0.06, 16), mats.granite, -0.06, 0.03, -0.05);
  k.part('fpEmbers', () => cyl(0.1, 0.1, 0.01, 14), mats.furnace, -0.06, 0.062, -0.05);
  fire(k, -0.06, 0.08, -0.05);
  k.part('fpGrill', () => sph(0.05, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mats.black, 0.21, 0.14, -0.17);
  k.part('fpGrillLid', () => sph(0.05, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1), mats.black, 0.21, 0.15, -0.17);
  k.part('fpGrillLegs', () => mergeGeos([0, 1, 2].map((i) => beamGeo(V(0.21 + Math.cos(i * 2.094) * 0.05, 0, -0.17 + Math.sin(i * 2.094) * 0.05), V(0.21, 0.1, -0.17), 0.008))), mats.metal, 0, 0, 0);
  smokeAt(k, 0.21, 0.2, -0.17, 2.6, false);
  k.part('fpTable', () => mergeGeos([
    boxAt(0.22, 0.015, 0.09, 0, 0.1, 0),
    boxAt(0.22, 0.012, 0.04, 0, 0.06, 0.085),
    boxAt(0.22, 0.012, 0.04, 0, 0.06, -0.085),
    ...[-0.08, 0.08].map((x) => boxAt(0.015, 0.1, 0.17, x, 0.05, 0)),
  ]), mats.wood, 0.14, 0, 0.19);
  return 0.26;
}
// Future: a hologram fire that never needs wood, ringed by curved benches.
function holoFire(k) {
  k.part('hxPad', () => cyl(0.38, 0.38, 0.014, 6), mats.whiteGloss, 0, 0.007, 0);
  k.part('hxBase', () => cyl(0.12, 0.13, 0.04, 18), mats.whiteGloss, 0, 0.034, 0);
  k.part('hxRing', () => flatRing(0.12, 0.008, Math.PI * 2, 24), mats.neonCyan, 0, 0.056, 0);
  const flame = new T.Group();
  flame.position.y = 0.06;
  mesh(geo('hxFlameA', () => cone(0.07, 0.22, 6).translate(0, 0.11, 0)), mats.holo, 0, 0, 0, flame);
  mesh(geo('hxFlameB', () => cone(0.045, 0.16, 6).translate(0, 0.08, 0)), mats.neonPink, 0.02, 0, 0.01, flame);
  k.g.add(flame);
  k.anim.push({ kind: 'spinY', o: flame, speed: 1.6 });
  k.anim.push({ kind: 'pulse', o: flame });
  glowAt(k, mats.fireGlow, 0, 0.16, 0, 0.7);
  for (let i = 0; i < 3; i++) {
    const b = k.part('hxBench', () => flatRing(0.28, 0.026, Math.PI / 3, 10), mats.whiteGloss, 0, 0.06, 0);
    b.rotation.y = i * ((Math.PI * 2) / 3) + 0.3;
  }
  return 0.3;
}

// --- Factory --------------------------------------------------------------------------------
// The factory's gear sign turns in every era.
function gearSign(k, m, x, y, z) {
  const gear = k.part('gearSign', () => new T.TorusGeometry(0.045, 0.014, 6, 10), m, x, y, z);
  k.anim.push({ kind: 'spinZ', o: gear, speed: 1.2 });
}
// Modern Age: an assembly plant with a loading dock, a lorry and solar
// panels on the roof.
function assemblyPlant(k) {
  k.part('apYard', () => cyl(0.42, 0.42, 0.012, 6), mats.concreteDark, 0, 0.006, 0);
  k.part('apHall', () => box(0.52, 0.2, 0.3), mats.wall2, 0, 0.1, -0.08);
  k.part('apBand', () => box(0.522, 0.04, 0.302), mats.panelBlue, 0, 0.18, -0.08);
  k.part('apDocks', () => mergeGeos([-0.12, 0.02].map((x) => boxAt(0.1, 0.11, 0.012, x, 0.065, 0.071))), mats.darkMetal, 0, 0, 0);
  k.part('apSolar', () => mergeGeos([-0.17, 0, 0.17].map((x) => tilted(0.13, 0.01, 0.2, x, 0.225, -0.1, -0.3))), mats.panel, 0, 0, 0);
  k.part('apExhaust', () => cyl(0.02, 0.022, 0.18, 8), mats.steel, 0.22, 0.29, -0.18);
  smokeAt(k, 0.22, 0.39, -0.18, 2.4, false);
  gearSign(k, k.trim, 0.17, 0.12, 0.074);
  const lorry = new T.Group();
  lorry.position.set(-0.12, 0, 0.21);
  mesh(geo('apTrailer', () => box(0.1, 0.09, 0.2)), mats.white, 0, 0.065, 0, lorry);
  mesh(geo('apCab', () => box(0.1, 0.08, 0.07)), mats.shipRed, 0, 0.06, 0.14, lorry);
  mesh(geo('apCabGlass', () => box(0.102, 0.03, 0.02)), mats.glass, 0, 0.08, 0.17, lorry);
  mesh(geo('apWheels', () => mergeGeos([[-1, -0.06], [1, -0.06], [-1, 0.06], [1, 0.06], [-1, 0.15], [1, 0.15]].map(([sd, z]) => cyl(0.022, 0.022, 0.015, 10).rotateZ(Math.PI / 2).translate(sd * 0.05, 0.022, z)))), mats.black, 0, 0, 0, lorry);
  k.g.add(lorry);
  return 0.4;
}
// Future: a clean white plant with glowing skylights; parts ride a belt
// out of the door to a waiting drone.
function cleanPlant(k) {
  k.part('xfPad', () => cyl(0.42, 0.42, 0.014, 6), mats.concrete, 0, 0.007, 0);
  k.part('xfHall', () => box(0.48, 0.18, 0.3), mats.whiteGloss, 0, 0.09, -0.08);
  k.part('xfRoof', () => box(0.5, 0.02, 0.32), mats.whiteGloss, 0, 0.19, -0.08);
  k.part('xfSkylights', () => mergeGeos([-0.15, 0, 0.15].map((x) => boxAt(0.1, 0.03, 0.2, x, 0.212, -0.08))), mats.glassBlue, 0, 0, 0);
  k.part('xfStripe', () => box(0.485, 0.018, 0.305), mats.neonCyan, 0, 0.14, -0.08);
  k.part('xfDoor', () => box(0.16, 0.11, 0.012), mats.glassBlue, -0.1, 0.055, 0.071);
  gearSign(k, mats.neonCyan, 0.14, 0.09, 0.074);
  k.part('xfBelt', () => mergeGeos([boxAt(0.08, 0.02, 0.24, -0.1, 0.04, 0.19), boxAt(0.012, 0.03, 0.012, -0.1, 0.015, 0.29)]), mats.darkMetal, 0, 0, 0);
  k.part('xfParts', () => mergeGeos([0.12, 0.2, 0.28].map((z) => boxAt(0.045, 0.04, 0.045, -0.1, 0.07, z))), mats.whiteGloss, 0, 0, 0);
  drone(k, 'box', 0.12, 0.18);
  return 0.26;
}

// --- Steel mill -----------------------------------------------------------------------------
// Modern Age: an electric arc furnace: a steel shed, a big blue duct to its
// filter house, one slim stack letting off steam, coils of steel.
function arcFurnace(k) {
  k.part('afYard', () => cyl(0.42, 0.42, 0.012, 6), mats.concreteDark, 0, 0.006, 0);
  k.part('afShed', () => box(0.48, 0.24, 0.3), mats.steel, -0.02, 0.12, -0.06);
  k.part('afRoof', () => box(0.5, 0.02, 0.32), mats.darkMetal, -0.02, 0.25, -0.06);
  k.part('afGlow', () => box(0.16, 0.1, 0.012), mats.furnace, -0.1, 0.06, 0.091);
  k.part('afDuct', () => mergeGeos([cylAt(0.035, 0.035, 0.16, 0.12, 0.33, -0.12), cyl(0.035, 0.035, 0.2, 12).rotateZ(Math.PI / 2).translate(0.21, 0.41, -0.12), cylAt(0.035, 0.035, 0.24, 0.3, 0.29, -0.12)]), mats.panelBlue, 0, 0, 0);
  k.part('afFilter', () => box(0.12, 0.18, 0.12), mats.wall2, 0.3, 0.09, -0.12);
  k.part('afStack', () => cyl(0.022, 0.026, 0.62, 10), mats.steel, -0.2, 0.31, -0.16);
  k.part('afStackBands', () => mergeGeos([0.48, 0.56].map((y) => cylAt(0.024, 0.024, 0.03, 0, y, 0, 10))), mats.shipRed, -0.2, 0, -0.16);
  smokeAt(k, -0.2, 0.64, -0.16, 1.8, false);
  for (const [x, z] of [[0.1, 0.2], [0.2, 0.18], [0.15, 0.27]]) k.part('afCoil', () => cyl(0.04, 0.04, 0.05, 14).rotateX(Math.PI / 2), mats.steel, x, 0.04, z);
  return 0.66;
}
// Future: a white forge dome ringed with molten light, beams stacked
// beside it, and no smoke at all.
function lightForge(k) {
  k.part('lgPad', () => cyl(0.42, 0.42, 0.014, 6), mats.concrete, 0, 0.007, 0);
  k.part('lgDome', () => dome(0.2), mats.whiteGloss, -0.04, 0.014, -0.08);
  k.part('lgMolten', () => flatRing(0.2, 0.014, Math.PI * 2, 32), mats.furnace, -0.04, 0.03, -0.08);
  k.part('lgPort', () => box(0.08, 0.06, 0.04), mats.furnace, -0.04, 0.05, 0.11);
  glowAt(k, mats.fireGlow, -0.04, 0.06, 0.13, 0.5);
  k.part('lgVent', () => cyl(0.03, 0.04, 0.1, 12), mats.whiteGloss, -0.04, 0.25, -0.08);
  k.part('lgVentRing', () => flatRing(0.032, 0.006), mats.neonCyan, -0.04, 0.3, -0.08);
  k.part('lgBeams', () => mergeGeos([0, 1, 2].flatMap((row) => [0, 1].map((i) => boxAt(0.22, 0.03, 0.04, 0, 0.016 + row * 0.032, -0.025 + i * 0.05)))), mats.steel, 0.2, 0, 0.2);
  return 0.32;
}

// --- Warehouse ------------------------------------------------------------------------------
// Future: a logistics hub with a drone pad on the roof and crates riding a
// belt out of the door.
function logisticsHub(k) {
  k.part('xwPad', () => cyl(0.42, 0.42, 0.012, 6), mats.concrete, 0, 0.006, 0);
  k.part('xwHall', () => box(0.5, 0.2, 0.32), mats.whiteGloss, 0, 0.1, -0.06);
  k.part('xwStripe', () => box(0.505, 0.02, 0.325), mats.neonCyan, 0, 0.17, -0.06);
  k.part('xwDoors', () => mergeGeos([-0.14, 0.14].map((x) => boxAt(0.14, 0.13, 0.012, x, 0.065, 0.101))), k.trim, 0, 0, 0);
  k.part('xwRoofPad', () => cyl(0.1, 0.1, 0.012, 20), mats.concreteDark, 0.1, 0.206, -0.08);
  k.part('xwRoofRing', () => flatRing(0.08, 0.005, Math.PI * 2, 24), mats.neonCyan, 0.1, 0.214, -0.08);
  drone(k, 'box', 0.0, -0.05);
  k.part('xwBelt', () => box(0.07, 0.02, 0.22), mats.darkMetal, 0.14, 0.035, 0.22);
  k.part('xwCrates', () => mergeGeos([0.16, 0.24, 0.31].map((z) => boxAt(0.05, 0.045, 0.05, 0.14, 0.068, z))), mats.whiteGloss, 0, 0, 0);
  return 0.3;
}

// --- Station --------------------------------------------------------------------------------
// Modern Age: a station of glass and steel under a long canopy, with a
// departure board.
function glassStation(k) {
  k.part('platform', () => box(0.56, 0.05, 0.2), mats.concrete, 0, 0.025, 0.12);
  k.part('gsHall', () => box(0.34, 0.24, 0.18), mats.glass, 0, 0.12, -0.1);
  k.part('gsFrame', () => mergeGeos([...[-0.17, -0.06, 0.06, 0.17].map((x) => boxAt(0.012, 0.24, 0.012, x, 0.12, -0.009)), boxAt(0.35, 0.015, 0.012, 0, 0.24, -0.009)]), mats.steel, 0, 0, 0);
  k.part('gsRoof', () => box(0.36, 0.02, 0.2), mats.white, 0, 0.25, -0.1);
  k.part('gsCanopy', () => box(0.6, 0.015, 0.24), mats.white, 0, 0.28, 0.08);
  k.part('gsColumns', () => mergeGeos([-0.24, 0, 0.24].map((x) => cylAt(0.008, 0.008, 0.23, x, 0.165, 0.18, 6))), mats.steel, 0, 0, 0);
  k.part('gsBoard', () => box(0.12, 0.05, 0.01), mats.black, 0.1, 0.17, -0.002);
  k.part('gsBoardText', () => mergeGeos([0.155, 0.17, 0.185].map((y) => boxAt(0.1, 0.006, 0.002, 0, y, 0))), mats.yellow, 0.1, 0, 0.004);
  for (const sd of [-1, 1]) k.part('trackRail', () => box(0.6, 0.01, 0.01), mats.rail, 0, 0.005, 0.27 + sd * 0.03);
  return 0.32;
}
// Future: a white platform under a wave of glass, edged with light.
function lightStation(k) {
  k.part('lsPlatform', () => box(0.56, 0.05, 0.2), mats.whiteGloss, 0, 0.025, 0.12);
  k.part('lsEdge', () => box(0.56, 0.008, 0.012), mats.neonCyan, 0, 0.052, 0.215);
  k.part('lsHall', () => cyl(0.14, 0.16, 0.16, 20), mats.whiteGloss, 0, 0.08, -0.13);
  k.part('lsHallBand', () => flatRing(0.15, 0.01, Math.PI * 2, 28), mats.neonCyan, 0, 0.12, -0.13);
  k.part('lsCanopy', () => dome(0.3).scale(1, 0.35, 0.6), clearGlass(0x9fd8ff, 0.4), 0, 0.22, 0.08);
  k.part('lsCanopyRim', () => flatRing(0.3, 0.008, Math.PI * 2, 32).scale(1, 1, 0.6), mats.whiteGloss, 0, 0.22, 0.08);
  k.part('lsColumns', () => mergeGeos([-0.26, 0.26].map((x) => cylAt(0.01, 0.01, 0.17, x, 0.135, 0.08, 6))), mats.whiteGloss, 0, 0, 0);
  const board = k.part('lsBoard', () => box(0.12, 0.05, 0.006), mats.holo, -0.14, 0.17, 0.12);
  k.anim.push({ kind: 'hover', o: board, y: 0.17 });
  k.part('lsRail', () => box(0.6, 0.02, 0.04), mats.neonCyan, 0, 0.01, 0.27);
  return 0.34;
}

// --- Water tower ----------------------------------------------------------------------------
// Modern Age: a concrete water tower, a mushroom on one column.
function mushroomTower(k) {
  k.part('mtBase', () => cyl(0.1, 0.12, 0.04, 14), mats.concrete, 0, 0.02, 0);
  k.part('mtColumn', () => cyl(0.045, 0.055, 0.42, 14), mats.concrete, 0, 0.25, 0);
  k.part('mtCone', () => cone(0.2, 0.12, 20).rotateX(Math.PI), k.trim, 0, 0.52, 0);
  k.part('mtDrum', () => cyl(0.21, 0.2, 0.08, 20), k.trim, 0, 0.62, 0);
  k.part('mtCap', () => dome(0.21).scale(1, 0.25, 1), mats.concrete, 0, 0.66, 0);
  k.part('mtRail', () => flatRing(0.214, 0.006, Math.PI * 2, 28), mats.metal, 0, 0.668, 0);
  k.part('mtDoor', () => box(0.04, 0.07, 0.012), mats.door, 0, 0.075, 0.054);
  return 0.74;
}
// Future: a glass sphere of water on a slim white stem, a ring of light
// turning round it.
function glassTower(k) {
  k.part('gtBase', () => cyl(0.09, 0.11, 0.04, 16), mats.whiteGloss, 0, 0.02, 0);
  k.part('gtStem', () => cyl(0.03, 0.045, 0.44, 14), mats.whiteGloss, 0, 0.26, 0);
  k.part('gtWater', () => sph(0.15, 18, 12), mats.waterLight, 0, 0.6, 0);
  k.part('gtGlass', () => sph(0.17, 18, 12), clearGlass(0xd8f4ff, 0.35), 0, 0.6, 0);
  const spin = new T.Group();
  const ring = mesh(geo('gtRing', () => flatRing(0.2, 0.009, Math.PI * 2, 32)), mats.neonCyan, 0, 0.6, 0, spin);
  ring.rotation.z = 0.3;
  k.g.add(spin);
  k.anim.push({ kind: 'spinY', o: spin, speed: 0.9 });
  return 0.78;
}

const LOOKS = {
  lighthouse: { 3: stoneLighthouse, 4: stripedLighthouse, 6: lightSpire },
  woodcutter: { 4: sawmill, 5: lumberyard, 6: treefarm },
  quarry: { 4: stone(steamQuarry), 5: stone(excavatorQuarry), 6: stone(laserQuarry) },
  marblequarry: { 4: marble(steamQuarry), 5: marble(excavatorQuarry), 6: marble(laserQuarry) },
  kiln: { 4: hoffmannKiln, 5: brickworks, 6: brickPrinter },
  market: { 3: marketHall, 4: glassMarket, 5: supermarket, 6: holoMarket },
  harbor: { 4: steamHarbor, 5: containerPort, 6: hoverHarbor },
  mine: { 4: pithead, 6: futureMine },
  outpost: { 3: blockhouse, 5: depot, 6: habitat },
  fountain: { 6: holoFountain },
  farm: { 3: thatchFarm, 4: redBarnFarm },
  granary: { 2: horreum, 3: titheBarn },
  campfire: { 4: brazierSquare, 5: firePit, 6: holoFire },
  factory: { 5: assemblyPlant, 6: cleanPlant },
  steelmill: { 5: arcFurnace, 6: lightForge },
  warehouse: { 6: logisticsHub },
  station: { 5: glassStation, 6: lightStation },
  watertower: { 5: mushroomTower, 6: glassTower },
};

// The era whose look an item has in a town that has reached `era`: its own
// era, or the latest era from LOOKS it has reached.
export function lookEra(item, era) {
  const base = ITEMS[item]?.era ?? 0;
  const looks = LOOKS[item];
  if (!looks || era == null) return base;
  let pick = base;
  for (const e of Object.keys(looks).map(Number)) if (e <= era && e > pick) pick = e;
  return pick;
}
// Every look an item has, by the era it starts in (for the gallery).
export const lookErasOf = (item) => [ITEMS[item]?.era ?? 0, ...Object.keys(LOOKS[item] || {}).map(Number)];
export const itemsWithLooks = () => Object.keys(LOOKS);
// Called with the same builder object every building gets (see
// buildings.js); null when the item looks as its own builder makes it.
export function lookModel(item, look, k) {
  T = three();
  const make = LOOKS[item]?.[look];
  return make ? make(k) : null;
}
