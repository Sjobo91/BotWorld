// What every building looks like, era by era. Each one is made of simple
// shapes, stands on y = 0, faces +z (towards the middle of the island) and
// fits inside one plot. buildingMesh returns { g, h, anim }: h is about how
// tall it is (for scaffolding and labels), anim lists the parts that move.
import { ITEMS, hashStr } from '../shared/catalog.js';
import { three, mats, geo, mesh, rng, trimMat, colorOf, stripeMat, oct, addWindows, treeMesh, benchMesh, flowerBed, crenellations } from './meshes.js';

let T = null;
const box = (w, h, d) => new T.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, n = 12) => new T.CylinderGeometry(rt, rb, h, n);
const cone = (r, h, n = 12) => new T.ConeGeometry(r, h, n);
const sph = (r, w = 12, h = 8, ...rest) => new T.SphereGeometry(r, w, h, ...rest);
const dome = (r) => new T.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
// A round, soft lump (bushes, berry piles, flames).
const blob = (r) => new T.IcosahedronGeometry(r, 1);
// A thatched dome roof: half a sphere, a bit flattened, overhanging its walls.
const roundRoof = (r, h) => new T.SphereGeometry(r, 16, 7, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, h / r, 1);
// A gable roof: a triangular prism along x.
const gable = (w, h, d) => {
  const g = new T.CylinderGeometry(1, 1, 1, 3);
  g.rotateZ(Math.PI / 2);
  g.rotateX(-Math.PI / 2);
  g.scale(w, h * 0.67, d * 0.58);
  return g;
};

function smokeAt(anim, x, y, z, every = 2.2, dark = false) {
  anim.push({ kind: 'smoke', x, y, z, every, dark, t: Math.random() * every });
}

const BUILDERS = {
  // --- Stone Age -------------------------------------------------------------------
  // A round mud hut under a thick dome of thatch.
  hut(k) {
    k.part('hutWall', () => cyl(0.2, 0.22, 0.16, 14), mats.mud, 0, 0.08, 0);
    k.part('hutThatch', () => roundRoof(0.28, 0.2), mats.straw, 0, 0.13, 0);
    k.part('hutThatchRing', () => new T.TorusGeometry(0.255, 0.025, 6, 18).rotateX(Math.PI / 2), mats.hay, 0, 0.15, 0);
    k.part('hutKnot', () => blob(0.045), mats.woodDark, 0, 0.34, 0).scale.set(1, 0.7, 1);
    k.part('hutDoor', () => box(0.09, 0.12, 0.03), mats.black, 0, 0.06, 0.2);
    k.part('hutCurtain', () => box(0.1, 0.035, 0.032), k.trim, 0, 0.115, 0.205);
    k.part('hutPot', () => sph(0.04, 8, 6), mats.mud, 0.2, 0.035, 0.16).scale.set(1, 0.8, 1);
    for (let i = 0; i < 3; i++) k.part('hutWood', () => cyl(0.015, 0.015, 0.12, 6), mats.trunk, -0.22, 0.016 + i * 0.03, 0.12 - i * 0.01).rotation.x = Math.PI / 2;
    return 0.38;
  },
  // A log cabin with a big pile of fresh logs and a chopping block.
  woodcutter(k) {
    k.part('wcCabin', () => box(0.28, 0.17, 0.22), mats.wood, -0.08, 0.085, -0.1);
    for (const x of [-0.22, 0.06]) for (const z of [-0.21, 0.01]) for (let i = 0; i < 3; i++) k.part('wcLogEnd', () => cyl(0.022, 0.022, 0.04, 7), mats.trunk, x, 0.03 + i * 0.055, z).rotation.x = Math.PI / 2;
    k.part('wcRoof', () => gable(0.34, 0.14, 0.28), mats.woodDark, -0.08, 0.22, -0.1);
    k.part('wcDoor', () => box(0.07, 0.11, 0.012), mats.timber, -0.08, 0.055, 0.012);
    // The log pile: 3, 2, 1, the woodcutter's sign.
    const pile = [[0, 0], [1, 0], [2, 0], [0.5, 1], [1.5, 1], [1, 2]];
    for (const [i, row] of pile) {
      const log = k.part('wcLog', () => cyl(0.036, 0.036, 0.3, 8), mats.trunk, 0.1 + i * 0.075, 0.036 + row * 0.064, 0.17);
      log.rotation.x = Math.PI / 2;
      k.part('wcLogFace', () => cyl(0.03, 0.03, 0.006, 8), mats.wood, 0.1 + i * 0.075, 0.036 + row * 0.064, 0.322).rotation.x = Math.PI / 2;
    }
    k.part('wcBlock', () => cyl(0.055, 0.06, 0.08, 9), mats.trunk, -0.2, 0.04, 0.18);
    const axe = k.part('wcAxe', () => cyl(0.007, 0.007, 0.16, 4), mats.wood, -0.19, 0.14, 0.18);
    axe.rotation.z = 0.35;
    k.part('wcAxeHead', () => box(0.05, 0.035, 0.012), mats.metal, -0.215, 0.2, 0.18);
    if (k.lv >= 2) {
      // A saw bench for a bigger woodcutter.
      k.part('wcSawTop', () => box(0.22, 0.02, 0.06), mats.wood, 0.22, 0.09, -0.16);
      for (const x of [0.13, 0.31]) k.part('wcSawLeg', () => box(0.02, 0.09, 0.05), mats.woodDark, x, 0.045, -0.16);
      k.part('wcSaw', () => box(0.12, 0.04, 0.004), mats.metal, 0.22, 0.12, -0.16);
    }
    const t = treeMesh(true);
    t.position.set(0.28, 0, -0.26);
    t.scale.setScalar(0.85);
    k.g.add(t);
    return 0.42;
  },
  // A stepped pit of pale stone, cut blocks and a hoist.
  quarry(k) {
    k.part('qRim', () => cyl(0.36, 0.38, 0.05, 6), mats.stone, 0, 0.025, 0);
    k.part('qStep', () => cyl(0.27, 0.27, 0.052, 6), mats.stoneDark, 0, 0.03, 0);
    k.part('qFloor', () => cyl(0.17, 0.17, 0.054, 6), mats.rock, 0, 0.032, 0);
    const blocks = [[-0.2, 0.2, 0], [-0.08, 0.24, 0], [-0.14, 0.22, 1], [0.24, -0.16, 0], [0.26, -0.04, 0]];
    for (const [x, z, up] of blocks) {
      const b = k.part('qBlock', () => box(0.1, 0.07, 0.08), mats.stone, x, 0.085 + up * 0.07, z);
      b.rotation.y = k.r() * 0.6 - 0.3;
    }
    // The hoist: two posts, a beam, a rope and a block on its way up.
    for (const x of [-0.16, 0.1]) k.part('qPost', () => box(0.03, 0.36, 0.03), mats.woodDark, x, 0.18, -0.2);
    k.part('qBeam', () => box(0.32, 0.03, 0.035), mats.woodDark, -0.03, 0.37, -0.2);
    k.part('qArm', () => box(0.03, 0.03, 0.22), mats.woodDark, -0.03, 0.37, -0.1);
    k.part('qRope', () => cyl(0.004, 0.004, 0.18, 3), mats.black, -0.03, 0.27, 0.0);
    k.part('qLift', () => box(0.08, 0.06, 0.07), mats.stone, -0.03, 0.16, 0.0);
    k.part('qPick', () => box(0.1, 0.012, 0.012), mats.metal, 0.2, 0.065, 0.16).rotation.z = 0.4;
    return 0.4;
  },
  // A lean-to with drying racks, baskets full of berries and bushes around.
  gatherer(k) {
    // An open shelter: four posts under a straw roof, berries hung to dry.
    for (const x of [-0.18, 0.18]) for (const z of [-0.26, -0.06]) k.part('gaPost', () => cyl(0.012, 0.012, 0.2, 5), mats.woodDark, x, 0.1, z);
    k.part('gaRoof', () => gable(0.46, 0.13, 0.3), mats.straw, 0, 0.25, -0.16);
    k.part('gaRack', () => box(0.36, 0.012, 0.012), mats.woodDark, 0, 0.17, -0.16);
    for (let i = 0; i < 4; i++) k.part('gaHang', () => sph(0.025, 6, 4), i % 2 ? mats.berryBlue : mats.berryRed, -0.135 + i * 0.09, 0.14, -0.16).scale.set(1, 1.5, 1);
    for (const [x, z, m] of [[-0.14, 0.12, mats.berryRed], [0, 0.17, mats.berryBlue], [0.14, 0.12, mats.berryRed]]) {
      k.part('gaBasket', () => cyl(0.065, 0.05, 0.07, 10), mats.straw, x, 0.035, z);
      k.part('gaFill' + (m === mats.berryRed ? 'R' : 'B'), () => blob(0.058), m, x, 0.075, z).scale.set(1, 0.45, 1);
    }
    for (const a of [0.2, 2.6, 4.4]) {
      const x = Math.cos(a) * 0.33;
      const z = Math.sin(a) * 0.3;
      k.part('gaBush', () => blob(0.09), mats.leaf2, x, 0.07, z).scale.set(1, 0.8, 1);
      for (let j = 0; j < 4; j++) k.part('berry', () => sph(0.016, 6, 4), j % 2 ? mats.berryRed : mats.berryBlue, x + (k.r() - 0.5) * 0.12, 0.08 + k.r() * 0.06, z + 0.05);
    }
    return 0.3;
  },
  // A fishing hut on stilts with a jetty, a rowing boat and fish drying.
  fisher(k) {
    for (const [x, z] of [[-0.16, -0.16], [0.08, -0.16], [-0.16, 0.04], [0.08, 0.04]]) k.part('stilt', () => cyl(0.014, 0.014, 0.12, 5), mats.woodDark, x, 0.06, z);
    k.part('fiDeck', () => box(0.34, 0.025, 0.3), mats.wood, -0.04, 0.12, -0.06);
    k.part('fiHut', () => box(0.24, 0.14, 0.18), mats.wood, -0.04, 0.2, -0.08);
    k.part('fiRoof', () => gable(0.3, 0.12, 0.24), mats.straw, -0.04, 0.32, -0.08);
    k.part('fiDoor', () => box(0.06, 0.09, 0.01), mats.timber, -0.04, 0.18, 0.012);
    // A little inlet of water at the front, with a jetty and a boat on it.
    k.part('fiPond', () => cyl(0.17, 0.17, 0.012, 7), mats.waterLight, 0.18, 0.008, 0.2).scale.set(1, 1, 0.8);
    k.part('fiJetty', () => box(0.07, 0.02, 0.24), mats.wood, 0.1, 0.05, 0.16);
    k.part('fiBoat', () => sph(0.07, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mats.wood, 0.25, 0.04, 0.22).scale.set(0.75, 0.7, 1.8);
    k.part('fiOar', () => box(0.008, 0.008, 0.16), mats.woodDark, 0.25, 0.05, 0.22).rotation.y = 0.5;
    for (const z of [-0.26, -0.02]) k.part('rackPost', () => cyl(0.008, 0.008, 0.2, 4), mats.woodDark, 0.24, 0.1, z);
    k.part('rackBar', () => cyl(0.006, 0.006, 0.26, 4), mats.woodDark, 0.24, 0.2, -0.14).rotation.x = Math.PI / 2;
    for (let i = 0; i < 4; i++) k.part('driedFish', () => sph(0.02, 6, 4), mats.fish || trimMat('#ff8c42'), 0.24, 0.16, -0.24 + i * 0.065).scale.set(0.6, 1.7, 0.6);
    k.part('fiNet', () => sph(0.05, 8, 4), trimMat('#c9b98f'), -0.24, 0.03, 0.18).scale.set(1.4, 0.3, 1);
    return 0.4;
  },
  // A ring of stones, crackling fire and logs to sit on.
  campfire(k) {
    for (let i = 0; i < 3; i++) {
      const log = k.part('log', () => cyl(0.025, 0.025, 0.26, 6), mats.woodDark, 0, 0.035, 0);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = (i / 3) * Math.PI;
    }
    for (let i = 0; i < 10; i++) {
      const sa = (i / 10) * Math.PI * 2;
      k.part('stone', () => new T.DodecahedronGeometry(0.045, 0), mats.rock, Math.cos(sa) * 0.19, 0.03, Math.sin(sa) * 0.19);
    }
    for (const sa of [0.6, 2.7, 4.6]) {
      const seat = k.part('seatLog', () => cyl(0.045, 0.045, 0.22, 8), mats.wood, Math.cos(sa) * 0.36, 0.045, Math.sin(sa) * 0.36);
      seat.rotation.z = Math.PI / 2;
      seat.rotation.y = -sa + Math.PI / 2;
    }
    // Flames as soft drops, not spikes.
    const f1 = k.part('flame1', () => blob(0.075).scale(1, 1.9, 1).translate(0, 0.02, 0), mats.flame, 0, 0.12, 0);
    const f2 = k.part('flame2', () => blob(0.045).scale(1, 1.9, 1), mats.flame2, 0, 0.12, 0);
    const glow = new T.Sprite(mats.fireGlow);
    glow.position.set(0, 0.16, 0);
    glow.scale.set(0.9, 0.9, 1);
    k.g.add(glow);
    k.anim.push({ kind: 'fire', f1, f2 });
    return 0.3;
  },
  // A fenced yard full of crates, sacks, logs and stone.
  stockpile(k) {
    k.part('spYard', () => cyl(0.4, 0.4, 0.015, 6), mats.soil, 0, 0.008, 0);
    for (let i = 0; i < 6; i++) {
      if (i === 1) continue;
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const b = ((i + 1) / 6) * Math.PI * 2 + Math.PI / 6;
      const mx = (Math.cos(a) + Math.cos(b)) * 0.19;
      const mz = (Math.sin(a) + Math.sin(b)) * 0.19;
      const rail = k.part('spRail', () => box(0.36, 0.02, 0.015), mats.woodDark, mx, 0.08, mz);
      rail.rotation.y = -Math.atan2(mz, mx) + Math.PI / 2;
      k.part('spPost', () => box(0.025, 0.11, 0.025), mats.woodDark, Math.cos(a) * 0.38, 0.055, Math.sin(a) * 0.38);
    }
    const spots = [[-0.14, -0.1], [0.0, -0.16], [0.14, -0.08], [-0.06, 0.04]];
    spots.forEach(([x, z], i) => {
      const c = k.part('crate', () => box(1, 1, 1), i % 2 ? mats.wood : mats.crate2 || mats.wood, x, 0.055, z);
      c.scale.setScalar(0.11);
      c.rotation.y = k.r() * 0.5;
    });
    k.part('crateTop', () => box(0.09, 0.09, 0.09), mats.wood, -0.12, 0.155, -0.1);
    k.part('sack', () => sph(0.06, 8, 6), mats.straw, 0.16, 0.05, 0.12).scale.set(1, 0.8, 1);
    k.part('sack', () => sph(0.06, 8, 6), mats.straw, 0.08, 0.05, 0.18).scale.set(1, 0.8, 1);
    for (let i = 0; i < 2; i++) k.part('pileLog', () => cyl(0.03, 0.03, 0.26, 6), mats.trunk, -0.16, 0.03 + i * 0.055, 0.16).rotation.z = Math.PI / 2;
    for (let i = 0; i < 3; i++) k.part('pileStone', () => new T.DodecahedronGeometry(0.045, 0), mats.stone, 0.24 - i * 0.05, 0.04, -0.2 + i * 0.03);
    return 0.26;
  },
  totem(k) {
    const segs = [mats.trunk, k.trim, mats.woodDark, k.trim, mats.trunk];
    segs.forEach((m, i) => k.part('totemSeg' + (i % 2), () => cyl(0.07, 0.075, 0.13, 8), m, 0, 0.065 + i * 0.13, 0));
    for (let i = 0; i < 5; i++) for (const s of [-1, 1]) k.part('totemEye', () => box(0.02, 0.02, 0.01), mats.black, s * 0.03, 0.09 + i * 0.13, 0.072);
    for (const s of [-1, 1]) {
      const wing = k.part('totemWing', () => box(0.14, 0.05, 0.02), k.trim, s * 0.12, 0.58, 0);
      wing.rotation.z = s * 0.25;
    }
    k.part('totemBeak', () => cone(0.025, 0.07, 4), mats.yellow, 0, 0.6, 0.09).rotation.x = Math.PI / 2;
    return 0.7;
  },
  // --- Village ------------------------------------------------------------------------
  cottage(k) {
    k.part('cotBase', () => box(0.4, 0.22, 0.3), mats.plaster, 0, 0.11, 0);
    for (const x of [-0.2, 0, 0.2]) k.part('cotBeamV', () => box(0.025, 0.22, 0.305), mats.timber, x, 0.11, 0);
    k.part('cotBeamH', () => box(0.405, 0.02, 0.305), mats.timber, 0, 0.2, 0);
    k.part('cotRoof', () => gable(0.46, 0.2, 0.38), k.b.color ? k.trim : mats.roofTile, 0, 0.29, 0);
    k.part('chimney', () => box(0.06, 0.16, 0.06), mats.brick, 0.12, 0.36, -0.06);
    k.part('cotDoor', () => box(0.07, 0.13, 0.012), mats.door, -0.08, 0.065, 0.152);
    for (const x of [0.1]) k.part('cotWin', () => box(0.07, 0.06, 0.012), mats.window, x, 0.12, 0.152);
    k.part('flowerBox', () => box(0.09, 0.025, 0.03), k.trim, 0.1, 0.08, 0.165);
    smokeAt(k.anim, 0.12, 0.46, -0.06, 3.5);
    return 0.48;
  },
  farm(k) {
    k.part('field', () => box(0.62, 0.03, 0.42), mats.soil, 0.04, 0.015, 0.06);
    for (let i = 0; i < 5; i++) {
      const row = k.part('cropRow', () => box(0.56, 0.05, 0.04), i % 2 ? mats.crop : mats.crop2, 0.04, 0.05, -0.1 + i * 0.08);
      row.scale.y = 0.8 + k.r() * 0.4;
    }
    const barn = new T.Group();
    barn.position.set(-0.22, 0, -0.24);
    barn.rotation.y = 0.5;
    mesh(geo('barnBody', () => box(0.2, 0.16, 0.18)), k.b.color ? k.trim : mats.shipRed, 0, 0.08, 0, barn);
    mesh(geo('barnRoofS', () => gable(0.22, 0.1, 0.2)), mats.roof, 0, 0.2, 0, barn);
    mesh(geo('barnDoor', () => box(0.07, 0.1, 0.01)), mats.white, 0, 0.05, 0.091, barn);
    k.g.add(barn);
    return 0.3;
  },
  windmill(k) {
    k.part('millBody', () => oct(0.12, 0.2, 0.5), mats.wall, 0, 0.25, 0);
    k.part('millCap', () => roundRoof(0.15, 0.12), k.trim, 0, 0.5, 0);
    k.part('door', () => box(0.08, 0.13, 0.012), mats.door, 0, 0.065, 0.19);
    addWindows(k.g, 0.15, 0.32, 2, true);
    const blades = new T.Group();
    blades.position.set(0, 0.5, 0.17);
    mesh(geo('hub', () => cyl(0.025, 0.025, 0.04, 8)), mats.woodDark, 0, 0, 0, blades).rotation.x = Math.PI / 2;
    for (let i = 0; i < 4; i++) {
      const arm = new T.Group();
      arm.rotation.z = (i * Math.PI) / 2;
      mesh(geo('bladeArm', () => box(0.016, 0.34, 0.01)), mats.woodDark, 0, 0.18, 0.01, arm);
      mesh(geo('bladeSail', () => box(0.07, 0.24, 0.006)), mats.sail, 0.042, 0.21, 0.016, arm);
      blades.add(arm);
    }
    k.g.add(blades);
    k.anim.push({ kind: 'spin', o: blades, speed: 0.8 + k.r() * 0.4 });
    return 0.8;
  },
  kiln(k) {
    k.part('kilnDome', () => dome(0.2), mats.brick, 0, 0, 0);
    k.part('kilnMouth', () => box(0.09, 0.08, 0.04), mats.furnace, 0, 0.05, 0.18);
    k.part('kilnChimney', () => cyl(0.035, 0.045, 0.22, 8), mats.brickDark, 0.08, 0.26, -0.06);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) k.part('brickStack', () => box(0.07, 0.03, 0.04), mats.brick, 0.24, 0.015 + i * 0.032, -0.06 + j * 0.06);
    smokeAt(k.anim, 0.08, 0.4, -0.06, 2.4);
    return 0.4;
  },
  well(k) {
    k.part('wellRing', () => cyl(0.14, 0.15, 0.12, 12), mats.stone, 0, 0.06, 0);
    k.part('wellWater', () => cyl(0.11, 0.11, 0.01, 12), mats.waterLight, 0, 0.1, 0);
    for (const s of [-1, 1]) k.part('wellPost', () => box(0.025, 0.28, 0.025), mats.woodDark, s * 0.13, 0.2, 0);
    k.part('wellRoof', () => gable(0.36, 0.1, 0.24), k.b.color ? k.trim : mats.roof, 0, 0.36, 0);
    k.part('wellBar', () => cyl(0.008, 0.008, 0.26, 5), mats.wood, 0, 0.28, 0).rotation.z = Math.PI / 2;
    k.part('bucket', () => cyl(0.03, 0.025, 0.04, 8), mats.wood, 0, 0.2, 0);
    return 0.42;
  },
  market(k) {
    const stalls = [[-0.16, -0.06, 0.25], [0.16, -0.06, -0.25], [0, 0.16, 0]];
    for (const [x, z, ry] of stalls) {
      const s = new T.Group();
      s.position.set(x, 0, z);
      s.rotation.y = ry;
      mesh(geo('stallTable', () => box(0.2, 0.08, 0.12)), mats.wood, 0, 0.04, 0, s);
      for (const px of [-0.09, 0.09]) mesh(geo('stallPost', () => cyl(0.006, 0.006, 0.22, 4)), mats.woodDark, px, 0.11, -0.05, s);
      const aw = mesh(geo('stallAwning', () => box(0.22, 0.012, 0.16)), stripeMat(k.color), 0, 0.22, 0, s);
      aw.rotation.x = 0.3;
      for (let i = 0; i < 4; i++) mesh(geo('produce', () => sph(0.02, 6, 4)), [mats.berryRed, mats.crop, mats.crop2, mats.yellow][i], -0.06 + i * 0.04, 0.095, 0.02, s);
      k.g.add(s);
    }
    k.part('marketSign', () => new T.PlaneGeometry(0.2, 0.06), mats.sign, 0, 0.3, 0.165);
    k.part('signPost', () => cyl(0.006, 0.006, 0.27, 4), mats.woodDark, 0, 0.135, 0.15);
    return 0.32;
  },
  garden(k) {
    k.part('bed', () => cyl(0.44, 0.45, 0.04, 6), mats.soil, 0, 0.02, 0);
    for (let row = -2; row <= 2; row++) {
      for (let i = -2; i <= 2; i++) {
        if (Math.abs(row) + Math.abs(i) > 3) continue;
        const x = i * 0.12 + (row % 2 ? 0.06 : 0);
        const z = row * 0.12;
        mesh(geo('stem', () => cyl(0.006, 0.006, 0.08, 4)), mats.leaf2, x, 0.08, z, k.g);
        mesh(geo('bloomBig', () => sph(0.035, 6, 5)), k.b.color ? k.trim : mats.flowers[(row + i + 7) % mats.flowers.length], x, 0.13, z, k.g);
      }
    }
    return 0.2;
  },
  park(k) {
    k.part('lawn', () => cyl(0.47, 0.47, 0.02, 6), mats.grass, 0, 0.01, 0);
    const n = 2 + Math.floor(k.r() * 2);
    for (let i = 0; i < n; i++) {
      const t = treeMesh(k.r() < 0.4);
      const a = (i / n) * Math.PI * 2 + k.r();
      t.position.set(Math.cos(a) * 0.24, 0, Math.sin(a) * 0.24);
      t.scale.setScalar(0.75 + k.r() * 0.35);
      k.g.add(t);
    }
    const bench = benchMesh();
    bench.position.set(0, 0, 0.3);
    k.g.add(bench);
    flowerBed(k.g, k.r, 6, 0.12, k.b.color ? k.trim : null);
    return 0.5;
  },
  barn(k) {
    k.part('barnBig', () => box(0.46, 0.26, 0.34), k.b.color ? k.trim : mats.shipRed, 0, 0.13, 0);
    k.part('barnBigRoof', () => gable(0.5, 0.2, 0.38), mats.slate, 0, 0.34, 0);
    k.part('barnBigDoor', () => box(0.16, 0.18, 0.012), mats.white, 0, 0.09, 0.172);
    const x1 = k.part('barnX', () => box(0.22, 0.012, 0.014), mats.shipRed, 0, 0.09, 0.18);
    x1.rotation.z = 0.8;
    const x2 = k.part('barnX', () => box(0.22, 0.012, 0.014), mats.shipRed, 0, 0.09, 0.18);
    x2.rotation.z = -0.8;
    for (const x of [-0.3, 0.3]) k.part('hayBale', () => cyl(0.05, 0.05, 0.08, 10), mats.hay, x, 0.05, 0.12).rotation.z = Math.PI / 2;
    return 0.44;
  },
  // --- Medieval Town -----------------------------------------------------------------
  townhouse(k) {
    for (const [x, w, hh] of [[-0.12, 0.22, 0.42], [0.12, 0.22, 0.36]]) {
      const g = new T.Group();
      g.position.x = x;
      mesh(geo('thLow' + hh, () => box(w, 0.16, 0.3)), mats.stone, 0, 0.08, 0, g);
      mesh(geo('thUp' + hh, () => box(w + 0.02, hh - 0.16, 0.32)), mats.plaster, 0, 0.16 + (hh - 0.16) / 2, 0, g);
      mesh(geo('thBeam' + hh, () => box(w + 0.025, 0.02, 0.325)), mats.timber, 0, hh - 0.01, 0, g);
      mesh(geo('thRoof' + hh, () => gable(w + 0.04, 0.2, 0.36)), x < 0 ? mats.roofTile : mats.slate, 0, hh + 0.08, 0, g);
      mesh(geo('thWin', () => box(0.05, 0.06, 0.012)), mats.window, -0.04, hh - 0.09, 0.162, g);
      mesh(geo('thWin', () => box(0.05, 0.06, 0.012)), mats.window, 0.05, hh - 0.09, 0.162, g);
      for (const sx of [-0.075, 0.085]) mesh(geo('shutter', () => box(0.015, 0.06, 0.014)), k.trim, sx, hh - 0.09, 0.164, g);
      mesh(geo('thDoor', () => box(0.06, 0.11, 0.012)), mats.door, 0, 0.055, 0.152, g);
      k.g.add(g);
    }
    k.part('thChimney', () => box(0.05, 0.14, 0.05), mats.brickDark, -0.18, 0.56, -0.06);
    smokeAt(k.anim, -0.18, 0.65, -0.06, 3.2);
    return 0.6;
  },
  mine(k) {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 1.4 - 0.2 + Math.PI;
      const rock = k.part('mineRock', () => new T.DodecahedronGeometry(0.16, 0), mats.rock, Math.cos(a) * 0.17, 0.08, Math.sin(a) * 0.17 - 0.04);
      rock.scale.set(1, 0.7 + k.r() * 0.5, 1);
    }
    k.part('mineHill', () => dome(0.24), mats.stoneDark, 0, 0, -0.06);
    k.part('mineHole', () => box(0.14, 0.14, 0.05), mats.black, 0, 0.07, 0.16);
    for (const s of [-1, 1]) k.part('mineBeam', () => box(0.025, 0.17, 0.03), mats.timber, s * 0.08, 0.085, 0.18);
    k.part('mineLintel', () => box(0.2, 0.03, 0.03), mats.timber, 0, 0.17, 0.18);
    for (const s of [-1, 1]) k.part('mineRail', () => box(0.008, 0.008, 0.26), mats.darkMetal, s * 0.035, 0.005, 0.3);
    k.part('cart', () => box(0.08, 0.05, 0.1), mats.darkMetal, 0, 0.04, 0.3);
    k.part('cartCoal', () => sph(0.04, 8, 5), mats.coal, 0, 0.07, 0.3).scale.set(1, 0.5, 1.2);
    k.part('coalPile', () => blob(0.07).scale(1, 0.6, 1), mats.coal, 0.2, 0.03, 0.2);
    return 0.36;
  },
  tower(k) {
    const floors = 1 + k.lv;
    const fh = 0.2;
    for (let i = 0; i < floors; i++) {
      const rad = 0.2 - i * 0.012;
      k.part('towerFloor' + i, () => oct(rad, rad + 0.012, fh), i % 2 ? mats.stoneDark : mats.stone, 0, fh / 2 + i * fh, 0);
      if (i > 0) addWindows(k.g, rad, i * fh + fh / 2, 3, false);
    }
    const top = floors * fh;
    k.part('door', () => box(0.08, 0.13, 0.012), mats.door, 0, 0.065, 0.195);
    k.part('towerTop', () => oct(0.21, 0.19, 0.04), mats.stoneDark, 0, top + 0.02, 0);
    crenellations(k.g, 0.18, top + 0.065, mats.stone);
    k.part('flagPole', () => cyl(0.006, 0.006, 0.22, 4), mats.metal, 0, top + 0.11, 0);
    k.anim.push({ kind: 'flag', o: k.part('flag', () => box(0.12, 0.07, 0.005), k.trim, 0.06, top + 0.18, 0) });
    return top + 0.22;
  },
  school(k) {
    k.part('schoolBody', () => box(0.46, 0.22, 0.3), mats.brick, 0, 0.11, 0);
    k.part('schoolRoof', () => gable(0.5, 0.16, 0.34), mats.slate, 0, 0.29, 0);
    k.part('belfry', () => box(0.1, 0.16, 0.1), mats.plaster, 0, 0.42, 0.04);
    k.part('belfryRoof', () => cone(0.09, 0.12, 4), k.trim, 0, 0.56, 0.04).rotation.y = Math.PI / 4;
    k.part('bell', () => cone(0.025, 0.04, 8), mats.yellow, 0, 0.42, 0.095);
    k.part('schoolDoor', () => box(0.08, 0.13, 0.012), mats.door, 0, 0.065, 0.152);
    for (const x of [-0.15, 0.15]) k.part('schoolWin', () => box(0.08, 0.08, 0.012), mats.window, x, 0.12, 0.152);
    return 0.6;
  },
  harbor(k) {
    k.part('quay', () => box(0.5, 0.05, 0.22), mats.stone, 0, 0.025, -0.12);
    k.part('jetty', () => box(0.14, 0.03, 0.42), mats.wood, 0.1, 0.03, 0.18);
    for (const z of [0.05, 0.2, 0.35]) for (const s of [-1, 1]) k.part('jettyPost', () => cyl(0.012, 0.012, 0.12, 5), mats.woodDark, 0.1 + s * 0.065, 0.0, z);
    const boat = new T.Group();
    boat.position.set(-0.12, 0.02, 0.2);
    mesh(geo('hull', () => box(0.12, 0.06, 0.3)), mats.wood, 0, 0, 0, boat);
    mesh(geo('boatMastS', () => cyl(0.006, 0.006, 0.32, 4)), mats.woodDark, 0, 0.18, 0, boat);
    mesh(geo('harborSail', () => box(0.005, 0.18, 0.14)), mats.sail, 0, 0.2, 0.03, boat);
    k.g.add(boat);
    k.anim.push({ kind: 'bob', o: boat });
    k.part('craneMast', () => cyl(0.015, 0.02, 0.4, 6), mats.woodDark, -0.18, 0.2, -0.14);
    k.part('craneArm', () => box(0.3, 0.02, 0.02), mats.woodDark, -0.06, 0.38, -0.14);
    for (let i = 0; i < 3; i++) k.part('barrel', () => cyl(0.03, 0.03, 0.06, 8), mats.wood, 0.12 + i * 0.065, 0.08, -0.14);
    return 0.42;
  },
  lighthouse(k) {
    const bands = [[0.17, 0.2, 0.2], [0.145, 0.17, 0.2], [0.125, 0.145, 0.2]];
    bands.forEach(([rt, rb, hh], i) => k.part('lhBand' + i, () => cyl(rt, rb, hh, 12), i % 2 ? mats.white : k.trim, 0, hh / 2 + i * hh, 0));
    k.part('lhGallery', () => cyl(0.17, 0.17, 0.025, 12), mats.black, 0, 0.61, 0);
    k.part('lhGlass', () => cyl(0.09, 0.09, 0.1, 10), mats.glass, 0, 0.67, 0);
    k.part('lhLamp', () => sph(0.05, 10, 8), mats.lamp, 0, 0.67, 0);
    k.part('lhRoof', () => cone(0.12, 0.1, 10), k.trim, 0, 0.77, 0);
    k.part('door', () => box(0.08, 0.13, 0.012), mats.door, 0, 0.065, 0.2);
    const glow = new T.Sprite(mats.glow);
    glow.position.set(0, 0.67, 0);
    glow.scale.set(1.1, 1.1, 1);
    k.g.add(glow);
    const beam = new T.Group();
    beam.position.y = 0.67;
    mesh(geo('beam', () => new T.ConeGeometry(0.22, 2.4, 12, 1, true)), mats.beam, 0, 0, 1.2, beam).rotation.x = -Math.PI / 2;
    k.g.add(beam);
    k.anim.push({ kind: 'beam', o: beam });
    return 0.85;
  },
  fountain(k) {
    k.part('basin', () => cyl(0.3, 0.32, 0.09, 16), mats.statue, 0, 0.045, 0);
    k.part('basinWater', () => cyl(0.27, 0.27, 0.02, 16), mats.waterLight, 0, 0.085, 0);
    k.part('column', () => cyl(0.035, 0.045, 0.26, 8), k.b.color ? k.trim : mats.statue, 0, 0.17, 0);
    k.part('bowl', () => new T.SphereGeometry(0.09, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mats.statue, 0, 0.31, 0);
    k.part('bowlWater', () => cyl(0.08, 0.08, 0.01, 10), mats.waterLight, 0, 0.305, 0);
    k.anim.push({ kind: 'fountain', x: 0, y: 0.33, z: 0 });
    return 0.36;
  },
  statue(k) {
    k.part('pedestal', () => box(0.22, 0.16, 0.22), mats.stone, 0, 0.08, 0);
    k.part('pedestalTop', () => box(0.26, 0.03, 0.26), mats.stoneDark, 0, 0.175, 0);
    const fig = new T.Group();
    fig.position.y = 0.19;
    fig.scale.setScalar(1.35);
    const m = k.b.color ? k.trim : mats.statue;
    mesh(geo('botBody', () => new T.CapsuleGeometry(0.06, 0.07, 4, 10)), m, 0, 0.15, 0, fig);
    mesh(geo('botHead', () => sph(0.08, 14, 12)), m, 0, 0.3, 0, fig);
    mesh(geo('statueArm', () => new T.CapsuleGeometry(0.017, 0.08, 3, 6)), m, 0.08, 0.27, 0, fig).rotation.z = -2.6;
    k.g.add(fig);
    return 0.7;
  },
  // --- Industrial Age -------------------------------------------------------------------
  apartments(k) {
    k.part('aptBody', () => box(0.48, 0.56, 0.36), mats.brick, 0, 0.28, 0);
    k.part('aptBand', () => box(0.49, 0.03, 0.37), k.trim, 0, 0.19, 0);
    k.part('aptCornice', () => box(0.52, 0.04, 0.4), mats.stoneDark, 0, 0.57, 0);
    for (let f = 0; f < 3; f++) for (let i = 0; i < 4; i++) k.part('aptWin', () => box(0.06, 0.07, 0.012), mats.window, -0.165 + i * 0.11, 0.1 + f * 0.17, 0.182);
    k.part('aptDoor', () => box(0.08, 0.1, 0.012), mats.door, 0, 0.05, 0.183);
    for (const x of [-0.15, 0.12]) k.part('aptChimney', () => box(0.05, 0.12, 0.05), mats.brickDark, x, 0.65, -0.1);
    k.part('aptTank', () => cyl(0.05, 0.05, 0.08, 10), mats.wood, 0.05, 0.63, 0.06);
    smokeAt(k.anim, -0.15, 0.73, -0.1, 2.8, true);
    return 0.72;
  },
  steelmill(k) {
    k.part('millShed', () => box(0.52, 0.26, 0.34), mats.darkMetal, 0, 0.13, 0);
    k.part('millShedRoof', () => gable(0.56, 0.12, 0.38), mats.steel, 0, 0.32, 0);
    k.part('millGlow', () => box(0.16, 0.1, 0.012), mats.furnace, 0, 0.07, 0.172);
    for (const [x, hh] of [[-0.16, 0.7], [0.18, 0.6]]) {
      k.part('millStack' + hh, () => cyl(0.04, 0.055, hh, 10), mats.brickDark, x, hh / 2, -0.12);
      k.part('stackBand', () => cyl(0.045, 0.045, 0.03, 10), k.trim, x, hh - 0.08, -0.12);
      smokeAt(k.anim, x, hh + 0.02, -0.12, 1.4, true);
    }
    for (let i = 0; i < 3; i++) k.part('ingot', () => box(0.07, 0.025, 0.035), mats.steel, 0.2, 0.0125 + i * 0.026, 0.22);
    return 0.72;
  },
  coalplant(k) {
    k.part('plantHall', () => box(0.3, 0.24, 0.3), mats.brick, -0.12, 0.12, 0.06);
    const prof = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8; prof.push(new T.Vector2(0.15 - 0.06 * Math.sin(t * Math.PI) + 0.02 * t, t * 0.5)); }
    const lathe = () => new T.LatheGeometry(prof, 16);
    k.part('coolTower', lathe, mats.concrete, 0.16, 0, -0.08);
    k.part('plantStack', () => cyl(0.03, 0.04, 0.8, 8), mats.concreteDark, -0.2, 0.4, -0.16);
    k.part('stackStripe', () => cyl(0.034, 0.034, 0.05, 8), mats.shipRed, -0.2, 0.74, -0.16);
    k.part('plantCoal', () => blob(0.1).scale(1, 0.55, 1), mats.coal, 0.18, 0.04, 0.24);
    k.part('plantWin', () => box(0.2, 0.06, 0.012), mats.window, -0.12, 0.15, 0.212);
    smokeAt(k.anim, 0.16, 0.52, -0.08, 1.6, false);
    smokeAt(k.anim, -0.2, 0.82, -0.16, 1.2, true);
    return 0.82;
  },
  factory(k) {
    k.part('facBody', () => box(0.52, 0.24, 0.36), mats.brick, 0, 0.12, 0);
    for (let i = 0; i < 4; i++) {
      k.part('sawTooth', () => { const g = gable(0.36, 0.11, 0.13); g.rotateY(Math.PI / 2); return g; }, mats.slate, -0.195 + i * 0.13, 0.28, 0);
      k.part('sawGlass', () => box(0.012, 0.07, 0.34), mats.glass, -0.165 + i * 0.13, 0.29, 0);
    }
    k.part('facStack', () => cyl(0.035, 0.05, 0.62, 10), mats.brickDark, 0.2, 0.31, -0.13);
    k.part('facDoor', () => box(0.14, 0.14, 0.012), mats.darkMetal, -0.1, 0.07, 0.182);
    const gear = k.part('gearSign', () => new T.TorusGeometry(0.045, 0.014, 6, 10), k.trim, 0.12, 0.16, 0.19);
    k.anim.push({ kind: 'spinZ', o: gear, speed: 1.2 });
    smokeAt(k.anim, 0.2, 0.64, -0.13, 1.5, true);
    return 0.64;
  },
  warehouse(k) {
    k.part('whBody', () => box(0.54, 0.24, 0.36), mats.concrete, 0, 0.12, 0);
    k.part('whRoof', () => new T.CylinderGeometry(0.18, 0.18, 0.56, 12, 1, false, 0, Math.PI), mats.steel, 0, 0.24, 0).rotation.z = Math.PI / 2;
    for (const x of [-0.14, 0.14]) k.part('whDoor', () => box(0.16, 0.17, 0.012), k.trim, x, 0.085, 0.182);
    for (let i = 0; i < 4; i++) k.part('whCrate', () => box(0.07, 0.07, 0.07), mats.wood, -0.24 + i * 0.09, 0.035, 0.27);
    return 0.44;
  },
  station(k) {
    k.part('platform', () => box(0.56, 0.05, 0.2), mats.concrete, 0, 0.025, 0.12);
    k.part('stationHall', () => box(0.36, 0.22, 0.2), mats.brick, 0, 0.16, -0.1);
    k.part('stationRoof', () => box(0.6, 0.02, 0.24), mats.darkMetal, 0, 0.3, 0.06);
    for (const x of [-0.24, 0.24]) k.part('roofPillar', () => cyl(0.01, 0.01, 0.25, 5), mats.darkMetal, x, 0.17, 0.16);
    k.part('stationClock', () => cyl(0.04, 0.04, 0.012, 16), mats.clockFace, 0, 0.36, 0.0).rotation.x = Math.PI / 2;
    k.part('clockRim', () => new T.TorusGeometry(0.04, 0.006, 6, 16), k.trim, 0, 0.36, 0.008);
    for (const s of [-1, 1]) k.part('trackRail', () => box(0.6, 0.01, 0.01), mats.rail, 0, 0.005, 0.27 + s * 0.03);
    return 0.42;
  },
  watertower(k) {
    for (const [x, z] of [[-0.09, -0.09], [0.09, -0.09], [-0.09, 0.09], [0.09, 0.09]]) k.part('wtLeg', () => cyl(0.012, 0.015, 0.4, 5), mats.darkMetal, x, 0.2, z);
    k.part('wtTank', () => cyl(0.16, 0.16, 0.18, 14), k.trim, 0, 0.49, 0);
    k.part('wtTop', () => cone(0.17, 0.08, 14), mats.darkMetal, 0, 0.62, 0);
    k.part('wtBand', () => cyl(0.162, 0.162, 0.02, 14), mats.white, 0, 0.49, 0);
    return 0.66;
  },
  // --- Electric City -----------------------------------------------------------------------
  skyscraper(k) {
    const h = 1.05 + k.r() * 0.35;
    k.part('skyBase' + Math.round(h * 20), () => box(0.36, h, 0.32), mats.towerGlass, 0, h / 2, 0);
    k.part('skyTop', () => box(0.26, 0.2, 0.24), mats.towerGlass, 0, h + 0.1, 0);
    k.part('skyCrown', () => box(0.28, 0.025, 0.26), k.trim, 0, h + 0.012, 0);
    k.part('skyLobby', () => box(0.38, 0.08, 0.34), mats.concreteDark, 0, 0.04, 0);
    k.part('antenna', () => cyl(0.006, 0.008, 0.3, 4), mats.metal, 0.06, h + 0.35, 0);
    const light = k.part('antennaLight', () => sph(0.016, 6, 4), mats.redLight, 0.06, h + 0.5, 0);
    k.anim.push({ kind: 'blink', o: light });
    return h + 0.5;
  },
  turbine(k) {
    k.part('turbineBase', () => cyl(0.06, 0.07, 0.04, 10), mats.concrete, 0, 0.02, 0);
    k.part('turbineMast', () => cyl(0.018, 0.03, 1.0, 8), mats.whiteGloss, 0, 0.5, 0);
    k.part('nacelle', () => box(0.06, 0.05, 0.12), mats.whiteGloss, 0, 1.0, 0);
    const rotor = new T.Group();
    rotor.position.set(0, 1.0, 0.07);
    mesh(geo('rotorHub', () => cone(0.025, 0.05, 8)), mats.whiteGloss, 0, 0, 0.01, rotor).rotation.x = Math.PI / 2;
    for (let i = 0; i < 3; i++) {
      const arm = new T.Group();
      arm.rotation.z = (i * Math.PI * 2) / 3;
      mesh(geo('turbineBlade', () => box(0.025, 0.42, 0.006)), mats.whiteGloss, 0, 0.21, 0, arm);
      rotor.add(arm);
    }
    mesh(geo('bladeTip', () => box(0.026, 0.04, 0.007)), k.trim, 0, 0.4, 0, rotor.children[1]);
    k.g.add(rotor);
    k.anim.push({ kind: 'spin', o: rotor, speed: 1.6 + k.r() });
    return 1.42;
  },
  solar(k) {
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 2; col++) {
        const x = -0.14 + col * 0.28;
        const z = -0.2 + row * 0.18;
        k.part('solarLeg', () => cyl(0.006, 0.006, 0.08, 4), mats.metal, x, 0.04, z);
        const p = k.part('solarPanel', () => box(0.24, 0.012, 0.13), mats.panelBlue, x, 0.09, z);
        p.rotation.x = -0.5;
      }
    }
    k.part('inverter', () => box(0.06, 0.08, 0.05), k.trim, 0.3, 0.04, 0.25);
    return 0.16;
  },
  chipfab(k) {
    k.part('fabBody', () => box(0.54, 0.2, 0.38), mats.whiteGloss, 0, 0.1, 0);
    k.part('fabStripe', () => box(0.545, 0.03, 0.385), k.b.color ? k.trim : mats.neonCyan, 0, 0.16, 0);
    for (const x of [-0.16, 0, 0.16]) k.part('fabUnit', () => box(0.1, 0.06, 0.1), mats.concrete, x, 0.23, -0.06);
    k.part('chipLogo', () => box(0.1, 0.1, 0.012), mats.darkMetal, 0.14, 0.09, 0.192);
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) k.part('chipPin', () => box(0.008, 0.02, 0.012), mats.yellow, 0.105 + i * 0.023, 0.09 + s * 0.06, 0.193);
    k.part('fabPipe', () => cyl(0.02, 0.02, 0.5, 8), mats.steel, 0, 0.27, 0.1).rotation.z = Math.PI / 2;
    return 0.32;
  },
  lab(k) {
    k.part('labBody', () => box(0.4, 0.2, 0.32), mats.whiteGloss, 0, 0.1, 0);
    k.part('labDome', () => dome(0.15), mats.glassBlue, -0.06, 0.2, -0.02);
    const dish = new T.Group();
    dish.position.set(0.14, 0.2, 0.05);
    mesh(geo('dishMast', () => cyl(0.008, 0.01, 0.12, 5)), mats.metal, 0, 0.06, 0, dish);
    const d = mesh(geo('labDish', () => new T.ConeGeometry(0.08, 0.04, 14, 1, true)), mats.whiteGloss, 0, 0.13, 0, dish);
    d.rotation.x = Math.PI * 0.75;
    k.g.add(dish);
    k.anim.push({ kind: 'spinY', o: dish, speed: 0.3 });
    k.part('labDoor', () => box(0.08, 0.12, 0.012), mats.glassBlue, 0, 0.06, 0.162);
    k.part('labStripe', () => box(0.405, 0.02, 0.325), k.b.color ? k.trim : mats.neonCyan, 0, 0.19, 0);
    return 0.4;
  },
  stadium(k) {
    const prof = [new T.Vector2(0.3, 0), new T.Vector2(0.42, 0), new T.Vector2(0.44, 0.16), new T.Vector2(0.4, 0.18), new T.Vector2(0.32, 0.06)];
    k.part('stadiumBowl', () => new T.LatheGeometry(prof, 24), mats.concrete, 0, 0, 0);
    k.part('stadiumField', () => cyl(0.3, 0.3, 0.02, 24), mats.grass, 0, 0.02, 0);
    k.part('stadiumStripe', () => new T.TorusGeometry(0.43, 0.012, 6, 24), k.trim, 0, 0.16, 0).rotation.x = Math.PI / 2;
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      k.part('floodPole', () => cyl(0.008, 0.01, 0.42, 5), mats.metal, Math.cos(a) * 0.4, 0.21, Math.sin(a) * 0.4);
      k.part('floodLamp', () => box(0.06, 0.03, 0.02), mats.lamp, Math.cos(a) * 0.4, 0.43, Math.sin(a) * 0.4);
    }
    return 0.45;
  },
  greenhouse(k) {
    k.part('ghFrame', () => box(0.5, 0.24, 0.34), mats.glassBlue, 0, 0.12, 0);
    k.part('ghRoof', () => new T.CylinderGeometry(0.17, 0.17, 0.5, 10, 1, false, 0, Math.PI), mats.glassBlue, 0, 0.24, 0).rotation.z = Math.PI / 2;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) k.part('ghPlant', () => sph(0.035, 6, 5), j % 2 ? mats.leaf : mats.crop2, -0.18 + j * 0.12, 0.05, -0.1 + i * 0.1);
    for (const x of [-0.25, 0, 0.25]) k.part('ghRib', () => box(0.008, 0.25, 0.345), mats.metal, x, 0.125, 0);
    k.part('ghSign', () => box(0.1, 0.03, 0.012), k.trim, 0, 0.22, 0.172);
    return 0.42;
  },
  // --- Future ------------------------------------------------------------------------------
  // Future homes come in three shapes (picked per building) so a whole city
  // of them still looks varied: terraced towers, twin towers with a sky
  // bridge, and garden domes.
  arcology(k) {
    const style = Math.floor(k.r() * 3);
    const neon = [mats.neonCyan, mats.neonPink, k.b.color ? k.trim : mats.neonCyan][Math.floor(k.r() * 3)];
    if (style === 0) {
      const n = 2 + Math.floor(k.r() * 3);
      const tiers = [[0.33, 0.26], [0.27, 0.28], [0.21, 0.27], [0.15, 0.25]].slice(0, n);
      let y = 0;
      tiers.forEach(([r, hh], i) => {
        k.part('arcTier' + i, () => cyl(r * 0.85, r, hh, 20), mats.whiteGloss, 0, y + hh / 2, 0);
        k.part('arcRing' + i, () => new T.TorusGeometry(r * 0.9, 0.01, 6, 24), neon, 0, y + hh * 0.8, 0).rotation.x = Math.PI / 2;
        for (let j = 0; j < 4; j++) {
          const a = (j / 4) * Math.PI * 2 + i;
          k.part('arcGreen', () => sph(0.038, 6, 5), mats.leaf, Math.cos(a) * r * 0.84, y + hh + 0.01, Math.sin(a) * r * 0.84);
        }
        y += hh;
      });
      k.part('arcCrown', () => dome(0.1), mats.glassBlue, 0, y, 0);
      return y + 0.1;
    }
    if (style === 1) {
      const h1 = 0.7 + k.r() * 0.35;
      const h2 = h1 * (0.7 + k.r() * 0.2);
      for (const [x, hh] of [[-0.13, h1], [0.14, h2]]) {
        k.part('arcTwin' + Math.round(hh * 20), () => cyl(0.1, 0.12, hh, 16), mats.whiteGloss, x, hh / 2, 0);
        k.part('arcTwinCap', () => dome(0.1), mats.glassBlue, x, hh, 0);
        for (let f = 0.25; f < hh - 0.05; f += 0.22) k.part('arcBand', () => cyl(0.122, 0.122, 0.018, 16), neon, x, f, 0);
      }
      const by = h2 * 0.75;
      k.part('arcBridge', () => box(0.18, 0.05, 0.08), mats.glassBlue, 0, by, 0);
      k.part('arcBridgeTrim', () => box(0.19, 0.012, 0.085), neon, 0, by - 0.03, 0);
      k.part('arcPlaza', () => cyl(0.3, 0.32, 0.03, 20), mats.concrete, 0, 0.015, 0);
      for (const [x, z] of [[0.2, 0.2], [-0.22, 0.18]]) k.part('arcShrub', () => sph(0.05, 7, 5), mats.leaf, x, 0.06, z);
      return h1 + 0.1;
    }
    k.part('arcDomeBase', () => cyl(0.34, 0.36, 0.06, 24), mats.whiteGloss, 0, 0.03, 0);
    k.part('arcDome', () => dome(0.3), mats.glassBlue, 0, 0.06, 0);
    k.part('arcDomeRing', () => new T.TorusGeometry(0.3, 0.014, 6, 32), neon, 0, 0.065, 0).rotation.x = Math.PI / 2;
    k.part('arcTree', () => blob(0.1).scale(1, 1.2, 1), mats.leaf, 0, 0.17, 0);
    k.part('arcTreeTop', () => sph(0.07, 8, 6), mats.leaf, 0.07, 0.13, 0.05);
    const mast = 0.2 + k.r() * 0.25;
    k.part('arcMast' + Math.round(mast * 20), () => cyl(0.012, 0.016, mast, 6), mats.metal, 0, 0.36 + mast / 2, 0);
    const light = k.part('arcMastLight', () => sph(0.02, 8, 6), neon, 0, 0.36 + mast, 0);
    k.anim.push({ kind: 'blink', o: light });
    return 0.4 + mast;
  },
  fusion(k) {
    k.part('fusionBase', () => cyl(0.4, 0.42, 0.08, 24), mats.concrete, 0, 0.04, 0);
    const torus = k.part('tokamak', () => new T.TorusGeometry(0.24, 0.08, 14, 32), mats.whiteGloss, 0, 0.2, 0);
    torus.rotation.x = Math.PI / 2;
    const plasma = k.part('plasma', () => new T.TorusGeometry(0.24, 0.035, 10, 32), mats.neonPink, 0, 0.2, 0);
    plasma.rotation.x = Math.PI / 2;
    k.anim.push({ kind: 'pulse', o: plasma });
    k.part('fusionCore', () => sph(0.07, 14, 10), mats.neonCyan, 0, 0.2, 0);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      k.part('coil', () => box(0.04, 0.2, 0.05), k.b.color ? k.trim : mats.steel, Math.cos(a) * 0.24, 0.2, Math.sin(a) * 0.24).rotation.y = -a;
    }
    return 0.4;
  },
  robofactory(k) {
    k.part('roboBody', () => box(0.48, 0.18, 0.34), mats.whiteGloss, 0, 0.09, 0);
    k.part('roboStripe', () => box(0.485, 0.025, 0.345), k.b.color ? k.trim : mats.neonCyan, 0, 0.15, 0);
    const arm = new T.Group();
    arm.position.set(0, 0.18, 0.05);
    mesh(geo('armBase', () => cyl(0.05, 0.06, 0.04, 10)), mats.darkMetal, 0, 0.02, 0, arm);
    const upper = new T.Group();
    upper.position.y = 0.04;
    mesh(geo('armUpper', () => box(0.035, 0.22, 0.035)), mats.yellow, 0, 0.11, 0, upper);
    const fore = new T.Group();
    fore.position.y = 0.22;
    mesh(geo('armFore', () => box(0.03, 0.16, 0.03)), mats.yellow, 0, 0.08, 0, fore);
    mesh(geo('armClaw', () => box(0.06, 0.02, 0.03)), mats.darkMetal, 0, 0.16, 0, fore);
    upper.add(fore);
    arm.add(upper);
    k.g.add(arm);
    k.anim.push({ kind: 'arm', o: arm, upper, fore });
    return 0.55;
  },
  vertifarm(k) {
    for (let i = 0; i < 6; i++) {
      k.part('vfFloor', () => box(0.3, 0.02, 0.3), mats.whiteGloss, 0, 0.02 + i * 0.16, 0);
      k.part('vfGreen', () => box(0.26, 0.06, 0.26), i % 2 ? mats.leaf : mats.crop2, 0, 0.06 + i * 0.16, 0);
    }
    k.part('vfGlass', () => box(0.32, 0.98, 0.32), mats.glassBlue, 0, 0.49, 0);
    k.part('vfRoof', () => box(0.34, 0.03, 0.34), k.b.color ? k.trim : mats.neonCyan, 0, 0.99, 0);
    return 1.02;
  },
  maglev(k) {
    k.part('mgRoof', () => new T.CylinderGeometry(0.22, 0.22, 0.58, 16, 1, true, 0, Math.PI), mats.whiteGloss, 0, 0.08, 0.05).rotation.z = Math.PI / 2;
    k.part('mgPlatform', () => box(0.58, 0.06, 0.24), mats.concrete, 0, 0.03, 0.05);
    k.part('mgRail', () => box(0.6, 0.03, 0.05), mats.neonCyan, 0, 0.02, 0.27);
    k.part('mgSign', () => box(0.14, 0.04, 0.01), k.b.color ? k.trim : mats.neonPink, 0, 0.27, 0.2);
    return 0.34;
  },
  holopark(k) {
    k.part('holoPad', () => cyl(0.42, 0.44, 0.03, 6), mats.whiteGloss, 0, 0.015, 0);
    k.part('holoRing', () => new T.TorusGeometry(0.36, 0.01, 6, 24), mats.neonCyan, 0, 0.035, 0).rotation.x = Math.PI / 2;
    const shape = k.part('holoShape', () => new T.IcosahedronGeometry(0.13, 0), mats.holo, 0, 0.36, 0);
    k.anim.push({ kind: 'spinY', o: shape, speed: 0.7 });
    k.anim.push({ kind: 'hover', o: shape, y: 0.36 });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      k.part('holoTree', () => blob(0.06).scale(1, 1.8, 1), mats.holo, Math.cos(a) * 0.26, 0.14, Math.sin(a) * 0.26);
    }
    return 0.5;
  },
  droneport(k) {
    k.part('dpDeck', () => cyl(0.4, 0.42, 0.06, 6), mats.concreteDark, 0, 0.03, 0);
    for (const [x, z] of [[-0.16, -0.1], [0.16, -0.1], [0, 0.17]]) {
      k.part('dpPad', () => cyl(0.1, 0.1, 0.012, 16), mats.whiteGloss, x, 0.066, z);
      k.part('dpH', () => box(0.08, 0.004, 0.015), k.b.color ? k.trim : mats.neonCyan, x, 0.074, z);
    }
    for (let i = 0; i < 2; i++) {
      const d = new T.Group();
      mesh(geo('droneBody', () => box(0.06, 0.02, 0.06)), mats.darkMetal, 0, 0, 0, d);
      for (const [x, z] of [[-0.04, -0.04], [0.04, -0.04], [-0.04, 0.04], [0.04, 0.04]]) mesh(geo('droneRotor', () => cyl(0.02, 0.02, 0.004, 8)), mats.neonCyan, x, 0.012, z, d);
      d.position.set(i ? 0.16 : -0.16, 0.2, -0.1);
      k.g.add(d);
      k.anim.push({ kind: 'drone', o: d, x: d.position.x, z: d.position.z, ph: i * 2 });
    }
    return 0.3;
  },
  // --- Wonders --------------------------------------------------------------------------------
  stonecircle(k) {
    k.part('scGround', () => cyl(0.46, 0.47, 0.02, 20), mats.grass, 0, 0.01, 0);
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const st = k.part('scStone', () => box(0.07, 0.34, 0.1), mats.stone, Math.cos(a) * 0.34, 0.17, Math.sin(a) * 0.34);
      st.rotation.y = -a;
      if (i % 2 === 0) {
        const b2 = (((i + 1) / n) * Math.PI * 2 + a) / 2;
        const lin = k.part('scLintel', () => box(0.26, 0.05, 0.08), mats.stoneDark, Math.cos(b2) * 0.34, 0.365, Math.sin(b2) * 0.34);
        lin.rotation.y = -b2 + Math.PI / 2;
      }
    }
    k.part('scAltar', () => box(0.16, 0.08, 0.1), mats.stoneDark, 0, 0.04, 0);
    k.part('scFire', () => cone(0.04, 0.1, 6), mats.flame, 0, 0.13, 0);
    return 0.42;
  },
  greathall(k) {
    k.part('ghallBody', () => box(0.62, 0.24, 0.34), mats.wood, 0, 0.12, 0);
    k.part('ghallRoof', () => gable(0.68, 0.32, 0.44), mats.straw, 0, 0.37, 0);
    for (const s of [-1, 1]) {
      const head = k.part('dragonHead', () => cone(0.03, 0.14, 5), mats.woodDark, s * 0.34, 0.56, 0);
      head.rotation.z = -s * 0.9;
    }
    k.part('ghallDoor', () => box(0.12, 0.17, 0.012), mats.door, 0, 0.085, 0.172);
    for (const x of [-0.24, -0.08, 0.08, 0.24]) k.part('ghallPost', () => cyl(0.018, 0.018, 0.24, 6), mats.timber, x, 0.12, 0.19);
    for (const x of [-0.18, 0.18]) k.part('banner', () => box(0.06, 0.12, 0.008), x < 0 ? mats.shipRed : mats.yellow, x, 0.14, 0.2);
    return 0.6;
  },
  cathedral(k) {
    k.part('nave', () => box(0.3, 0.32, 0.56), mats.stone, 0, 0.16, -0.04);
    k.part('naveRoof', () => { const g = gable(0.6, 0.22, 0.34); g.rotateY(Math.PI / 2); return g; }, mats.slate, 0, 0.4, -0.04);
    k.part('spireTower', () => box(0.18, 0.5, 0.18), mats.stone, 0, 0.25, 0.22);
    k.part('spire', () => cone(0.13, 0.45, 4), mats.slate, 0, 0.72, 0.22).rotation.y = Math.PI / 4;
    k.part('rose', () => cyl(0.06, 0.06, 0.012, 16), mats.window, 0, 0.36, 0.312).rotation.x = Math.PI / 2;
    k.part('cathDoor', () => box(0.08, 0.14, 0.012), mats.door, 0, 0.07, 0.312);
    for (const z of [-0.2, 0, 0.18]) for (const s of [-1, 1]) k.part('buttress', () => box(0.04, 0.22, 0.05), mats.stoneDark, s * 0.17, 0.11, z - 0.04);
    k.part('cross', () => box(0.012, 0.08, 0.012), mats.yellow, 0, 0.98, 0.22);
    return 1.0;
  },
  clocktower(k) {
    k.part('ctShaft', () => box(0.26, 0.9, 0.26), mats.brick, 0, 0.45, 0);
    k.part('ctBand', () => box(0.28, 0.04, 0.28), mats.stoneDark, 0, 0.92, 0);
    k.part('ctTop', () => box(0.3, 0.24, 0.3), mats.stone, 0, 1.06, 0);
    k.part('ctRoof', () => cone(0.24, 0.36, 4), mats.slate, 0, 1.36, 0).rotation.y = Math.PI / 4;
    const hands = [];
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const face = new T.Group();
      face.position.set(Math.sin(a) * 0.152, 1.06, Math.cos(a) * 0.152);
      face.rotation.y = a;
      mesh(geo('ctFace', () => cyl(0.09, 0.09, 0.012, 20)), mats.clockFace, 0, 0, 0, face).rotation.x = Math.PI / 2;
      const hour = new T.Group();
      hour.position.z = 0.008;
      mesh(geo('ctHour', () => box(0.012, 0.05, 0.004)), mats.black, 0, 0.025, 0, hour);
      const min = new T.Group();
      min.position.z = 0.01;
      mesh(geo('ctMin', () => box(0.008, 0.075, 0.004)), mats.black, 0, 0.037, 0, min);
      face.add(hour, min);
      k.g.add(face);
      hands.push({ hour, min });
    }
    k.anim.push({ kind: 'clock', hands });
    return 1.55;
  },
  skyline(k) {
    k.part('stBase', () => cyl(0.16, 0.24, 0.12, 12), mats.concrete, 0, 0.06, 0);
    k.part('stShaft', () => cyl(0.05, 0.08, 1.9, 12), mats.concrete, 0, 1.07, 0);
    k.part('stPod', () => sph(0.17, 16, 12), mats.glassBlue, 0, 1.55, 0).scale.set(1, 0.6, 1);
    k.part('stDeck', () => new T.TorusGeometry(0.17, 0.025, 8, 24), k.b.color ? k.trim : mats.neonCyan, 0, 1.55, 0).rotation.x = Math.PI / 2;
    k.part('stNeedle', () => cyl(0.008, 0.02, 0.6, 6), mats.metal, 0, 2.3, 0);
    const light = k.part('stLight', () => sph(0.025, 8, 6), mats.redLight, 0, 2.62, 0);
    k.anim.push({ kind: 'blink', o: light });
    return 2.65;
  },
  spire(k) {
    k.part('spBase', () => cyl(0.36, 0.42, 0.1, 6), mats.whiteGloss, 0, 0.05, 0);
    const crystal = k.part('spCrystal', () => { const g = new T.OctahedronGeometry(0.22, 0); g.scale(1, 5.5, 1); return g; }, mats.neonCyan, 0, 1.3, 0);
    k.anim.push({ kind: 'pulse', o: crystal });
    for (let i = 0; i < 3; i++) {
      const ring = k.part('spRing' + i, () => new T.TorusGeometry(0.3 - i * 0.06, 0.012, 6, 32), i === 1 ? mats.neonPink : mats.holo, 0, 0.7 + i * 0.6, 0);
      ring.rotation.x = Math.PI / 2 + 0.2 * (i - 1);
      k.anim.push({ kind: 'spinY', o: ring, speed: 0.4 + i * 0.3 });
    }
    const beam = new T.Group();
    beam.position.y = 2.5;
    mesh(geo('spBeam', () => new T.CylinderGeometry(0.02, 0.12, 6, 10, 1, true)), mats.beam, 0, 3, 0, beam);
    k.g.add(beam);
    k.anim.push({ kind: 'beamUp', o: beam });
    return 2.6;
  },
};

// Buildings fill most of their plot (wonders are sized for their ring), and
// grow a little with every level.
const KIND_SCALE = { wonder: 1, house: 1.25, decor: 1.2 };
export function buildingMesh(b, level) {
  T = three();
  const g = new T.Group();
  const body = new T.Group();
  g.add(body);
  const anim = [];
  const color = colorOf(b);
  const lv = level || b.level || 1;
  const kind = ITEMS[b.item]?.kind;
  const scale = (KIND_SCALE[kind] || 1.3) * (kind === 'wonder' || b.home ? 1 : 1 + 0.05 * (lv - 1));
  body.scale.setScalar(scale);
  const k = {
    g: body,
    b,
    anim,
    color,
    trim: trimMat(color),
    r: rng(hashStr('b' + b.id)),
    lv,
    part: (name, make, m, x, y, z) => mesh(geo(name, make), m, x, y, z, body),
  };
  const make = BUILDERS[b.item] || ((kk) => { kk.part('crate', () => box(1, 1, 1), mats.wood, 0, 0.1, 0).scale.setScalar(0.2); return 0.25; });
  const h = make(k) * scale;
  // Upgraded town buildings fly pennants: silver at level 2, gold at level 3.
  if (lv > 1 && !b.home && kind !== 'wonder') levelPennants(k, lv);
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = o.material !== mats.beam && o.material !== mats.holo;
      o.receiveShadow = true;
      o.userData.buildId = b.id;
    }
  });
  return { g, h, anim };
}

export const hasModel = (item) => !!BUILDERS[item];

const pennantMats = {};
function levelPennants(k, lv) {
  const color = lv >= 3 ? '#f2c230' : '#d9dee6';
  const m = pennantMats[color] || (pennantMats[color] = new T.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3, side: T.DoubleSide, flatShading: true }));
  for (let i = 0; i < lv - 1; i++) {
    const x = -0.3 + i * 0.07;
    const z = -0.28 + i * 0.04;
    k.part('lvPole', () => cyl(0.006, 0.006, 0.34, 4), mats.woodDark, x, 0.17, z);
    const flag = k.part('lvFlag', () => { const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute([0, 0, 0, 0, -0.07, 0, 0.11, -0.035, 0], 3)); g.computeVertexNormals(); return g; }, m, x, 0.34, z);
    flag.material = m;
    k.anim.push({ kind: 'flag', o: flag });
  }
}
