// The wonders of the world, two for every era: chat votes for the one
// BotWorld builds and the rival builds the other. Each stands on its own
// plot in the ring round the landing pad (about 0.9 across), faces +z and,
// like everything else, is made of simple shapes. Where a wonder has many
// small parts (arches, lattice, battlements) they are merged into one mesh,
// so even the Colosseum costs only a few draw calls.
import { three, mats, geo, mesh, mergeGeos, signTexture, beamGeo, palmMesh } from './meshes.js';

let T = null;
const V = (x, y, z) => new T.Vector3(x, y, z);
const box = (w, h, d) => new T.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, n = 12) => new T.CylinderGeometry(rt, rb, h, n);
const sph = (r, w = 12, h = 8, ...rest) => new T.SphereGeometry(r, w, h, ...rest);
// A box turned about y and moved into place, ready to merge.
const boxAt = (w, h, d, x, y, z, ry = 0) => box(w, h, d).rotateY(ry).translate(x, y, z);
// A square pyramid with its sides along x and z.
const pyramid = (r, h) => new T.ConeGeometry(r, h, 4).rotateY(Math.PI / 4);
// A gable roof: a triangular prism along x.
const gable = (w, h, d) => new T.CylinderGeometry(1, 1, 1, 3).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2).scale(w, h * 0.67, d * 0.58);
const beam = beamGeo;
// Open shapes (shells, the bowl of seats) are seen from inside. They cast
// no shadow: an open shape would shade itself in stripes.
const twoSided = {};
function inside(m, side = 'DoubleSide') {
  const key = m.uuid + side;
  return twoSided[key] || (twoSided[key] = Object.assign(m.clone(), { side: T[side], userData: { noShadow: true } }));
}
// Windows that repeat up a tall box instead of stretching.
function tiled(g, u, v) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v);
  return g;
}
const ground = (k, name, m = mats.grass) => k.part(name, () => cyl(0.47, 0.48, 0.02, 6), m, 0, 0.01, 0);
function palm(k, x, z, s = 1) {
  const g = palmMesh();
  g.position.set(x, 0, z);
  g.scale.setScalar(s);
  k.g.add(g);
}

const BUILD = {
  // --- Stone Age ---------------------------------------------------------------------------
  // Stonehenge: a ring of standing stones with lintels, and a horseshoe of
  // great trilithons inside, open to the sunrise.
  stonehenge(k) {
    ground(k, 'shGround');
    k.part('shRing', () => {
      const parts = [];
      const n = 16;
      for (let i = 0; i < n; i++) {
        if (i === 11 || i === 12) continue;
        const a = (i / n) * Math.PI * 2;
        parts.push(boxAt(0.05, 0.24, 0.075, Math.cos(a) * 0.36, 0.14, Math.sin(a) * 0.36, -a));
        if (i === 4 || i === 10) continue;
        const b = ((i + 0.5) / n) * Math.PI * 2;
        parts.push(boxAt(0.155, 0.04, 0.07, Math.cos(b) * 0.36, 0.28, Math.sin(b) * 0.36, -b - Math.PI / 2));
      }
      return mergeGeos(parts);
    }, mats.sarsen, 0, 0, 0);
    k.part('shTrilithons', () => {
      const parts = [];
      for (const s of [-1.9, -1, 0, 1, 1.9]) {
        const a = -Math.PI / 2 + s * 0.55;
        const x = Math.cos(a) * 0.19;
        const z = Math.sin(a) * 0.19;
        const tx = -Math.sin(a) * 0.042;
        const tz = Math.cos(a) * 0.042;
        const h = s === 0 ? 0.34 : 0.28;
        parts.push(boxAt(0.05, h, 0.055, x + tx, h / 2 + 0.02, z + tz, -a));
        parts.push(boxAt(0.05, h, 0.055, x - tx, h / 2 + 0.02, z - tz, -a));
        parts.push(boxAt(0.15, 0.045, 0.06, x, h + 0.042, z, -a - Math.PI / 2));
      }
      return mergeGeos(parts);
    }, mats.stoneDark, 0, 0, 0);
    k.part('shFallen', () => box(0.05, 0.22, 0.075).rotateZ(Math.PI / 2 - 0.1).rotateY(0.7), mats.sarsen, 0.27, 0.04, 0.27);
    k.part('shAltar', () => box(0.14, 0.025, 0.05), mats.stoneDark, 0, 0.032, -0.02);
    k.part('shHeel', () => box(0.06, 0.15, 0.06).rotateZ(0.12), mats.sarsen, 0.05, 0.085, 0.43);
    return 0.42;
  },
  // The Moai of Easter Island: big stone heads in a row on their platform,
  // some wearing a red topknot.
  moai(k) {
    ground(k, 'moGround');
    k.part('moAhu', () => box(0.74, 0.07, 0.2), mats.stoneDark, 0, 0.055, -0.1);
    k.part('moAhuFront', () => box(0.78, 0.025, 0.12), mats.stone, 0, 0.032, 0.05);
    [-0.28, -0.14, 0, 0.14, 0.28].forEach((x, i) => {
      const g = new T.Group();
      g.position.set(x, 0.09, -0.1);
      g.scale.setScalar([0.9, 1, 1.12, 1, 0.92][i]);
      g.rotation.y = (i - 2) * 0.04;
      // Mostly head: a long face under a heavy brow, a long nose, pursed
      // lips and long ears, on a short body.
      mesh(geo('moBody', () => box(0.086, 0.1, 0.064)), mats.tuff, 0, 0.05, 0, g);
      mesh(geo('moHead', () => box(0.08, 0.2, 0.066)), mats.tuff, 0, 0.2, 0, g);
      mesh(geo('moBrow', () => box(0.082, 0.024, 0.016)), mats.tuff, 0, 0.268, 0.039, g);
      for (const sx of [-1, 1]) mesh(geo('moEye', () => box(0.024, 0.014, 0.006)), mats.black, sx * 0.02, 0.248, 0.035, g);
      mesh(geo('moNose', () => box(0.022, 0.07, 0.022)), mats.tuff, 0, 0.215, 0.043, g);
      mesh(geo('moLips', () => box(0.04, 0.012, 0.012)), mats.tuff, 0, 0.162, 0.038, g);
      mesh(geo('moChin', () => box(0.06, 0.03, 0.02)), mats.tuff, 0, 0.13, 0.035, g);
      for (const sx of [-1, 1]) mesh(geo('moEar', () => box(0.01, 0.1, 0.022)), mats.tuff, sx * 0.045, 0.21, -0.004, g);
      if (i % 2 === 0) mesh(geo('moPukao', () => cyl(0.04, 0.043, 0.045, 10)), mats.pukao, 0, 0.322, -0.004, g);
      k.g.add(g);
    });
    return 0.5;
  },
  // --- Ancient Egypt ------------------------------------------------------------------------
  // The Great Pyramid of Giza with its golden tip, two small queens'
  // pyramids, the Sphinx keeping watch and a pair of palms.
  pyramid(k) {
    ground(k, 'pySand', mats.sand);
    k.part('pyMain', () => pyramid(0.4, 0.62), mats.limestone, -0.03, 0.33, -0.07);
    k.part('pyCap', () => pyramid(0.058, 0.09), mats.gold, -0.03, 0.598, -0.07);
    k.part('pyQueen', () => pyramid(0.11, 0.16), mats.limestone, 0.31, 0.1, -0.23);
    k.part('pyQueen', () => pyramid(0.11, 0.16), mats.limestone, 0.33, 0.1, -0.02);
    const s = new T.Group();
    s.position.set(-0.05, 0.02, 0.32);
    mesh(geo('sxBody', () => box(0.055, 0.045, 0.15)), mats.sandstone, 0, 0.0225, -0.02, s);
    mesh(geo('sxPaws', () => box(0.05, 0.016, 0.06)), mats.sandstone, 0, 0.008, 0.08, s);
    mesh(geo('sxHead', () => box(0.034, 0.045, 0.036)), mats.sandstone, 0, 0.07, 0.04, s);
    mesh(geo('sxNemes', () => box(0.056, 0.05, 0.03)), mats.limestone, 0, 0.06, 0.02, s);
    k.g.add(s);
    palm(k, -0.36, 0.2, 0.9);
    palm(k, 0.38, 0.2, 0.75);
    return 0.66;
  },
  // The Ziggurat of Ur: three terraces of mud brick and three stairways that
  // meet at the gate, with a temple on top.
  ziggurat(k) {
    ground(k, 'zgSand', mats.sand);
    const tiers = [[0.6, 0.15, 0.5], [0.42, 0.13, 0.34], [0.26, 0.12, 0.2]];
    let y = 0.02;
    tiers.forEach(([w, h, d], i) => {
      k.part('zgTier' + i, () => box(w, h, d), i === 0 ? mats.mud : i === 1 ? mats.brick : mats.mudLight, 0, y + h / 2, -0.06);
      y += h;
    });
    k.part('zgPanels', () => {
      const parts = [];
      let yy = 0.02;
      for (const [w, h, d] of tiers) {
        for (let x = -w / 2 + 0.05; x < w / 2 - 0.02; x += 0.07) parts.push(boxAt(0.02, h * 0.8, 0.012, x, yy + h * 0.45, -0.06 + d / 2 + 0.004));
        yy += h;
      }
      return mergeGeos(parts);
    }, mats.brickDark, 0, 0, 0);
    k.part('zgShrine', () => box(0.14, 0.09, 0.12), mats.mudLight, 0, y + 0.045, -0.06);
    k.part('zgShrineRoof', () => box(0.16, 0.02, 0.14), mats.brickDark, 0, y + 0.1, -0.06);
    k.part('zgStairs', () => mergeGeos([
      beam(V(0, 0.02, 0.4), V(0, 0.17, 0.19), 0.075, 0.025),
      beam(V(0, 0.17, 0.19), V(0, 0.3, 0.11), 0.06, 0.025),
      beam(V(-0.25, 0.02, 0.33), V(-0.05, 0.17, 0.21), 0.05, 0.02),
      beam(V(0.25, 0.02, 0.33), V(0.05, 0.17, 0.21), 0.05, 0.02),
    ]), mats.limestone, 0, 0, 0);
    k.part('zgGate', () => box(0.07, 0.07, 0.04), mats.brickDark, 0, 0.205, 0.19);
    return y + 0.12;
  },
  // --- Roman Empire --------------------------------------------------------------------------
  // The Colosseum: four storeys of arches round the arena, one side still at
  // full height, the rest broken off, and the seats sloping down inside.
  colosseum(k) {
    const A = 0.44;
    const B = 0.36;
    const N = 32;
    const at = (t, s = 1) => [Math.cos(t) * A * s, Math.sin(t) * B * s];
    k.part('coFloor', () => cyl(1, 1, 0.02, 32).scale(A * 0.52, 1, B * 0.52), mats.sand, 0, 0.03, 0);
    k.part('coPits', () => {
      const parts = [];
      for (let i = -3; i <= 3; i++) parts.push(boxAt(0.006, 0.012, B * 0.7, i * 0.03, 0.045, 0));
      parts.push(boxAt(A * 0.75, 0.012, 0.006, 0, 0.045, 0));
      return mergeGeos(parts);
    }, mats.travertineDark, 0, 0, 0);
    k.part('coSeats', () => new T.CylinderGeometry(0.96, 0.55, 0.22, 32, 1, true).scale(A, 1, B), inside(mats.travertineDark, 'BackSide'), 0, 0.13, 0);
    k.part('coWall', () => {
      const parts = [];
      const th = 0.1;
      for (let i = 0; i < N; i++) {
        const t = (i / N) * Math.PI * 2;
        const t2 = ((i + 1) / N) * Math.PI * 2;
        const [x, z] = at(t);
        const [x2, z2] = at(t2);
        const len = Math.hypot(x2 - x, z2 - z);
        const ang = Math.atan2(z2 - z, x2 - x);
        const high = t > Math.PI + 0.25 && t < Math.PI * 2 - 0.25;
        const floors = high ? 4 : i % 3 === 0 ? 3 : 2;
        for (let f = 0; f < floors; f++) {
          const y = 0.02 + f * th;
          parts.push(boxAt(0.026, th, 0.036, x, y + th / 2, z, -ang));
          if (f === 3) parts.push(boxAt(len - 0.02, th * 0.98, 0.026, (x + x2) / 2, y + th / 2, (z + z2) / 2, -ang));
          else parts.push(boxAt(len - 0.02, 0.024, 0.03, (x + x2) / 2, y + th - 0.012, (z + z2) / 2, -ang));
        }
      }
      return mergeGeos(parts);
    }, mats.travertine, 0, 0, 0);
    return 0.44;
  },
  // The Great Wall of China, winding over green hills between two
  // watchtowers.
  greatwall(k) {
    ground(k, 'gwGround');
    k.part('gwHill', () => new T.IcosahedronGeometry(0.26, 1).scale(1.15, 0.36, 0.8), mats.grass, -0.12, 0.01, -0.08);
    k.part('gwHill2', () => new T.IcosahedronGeometry(0.19, 1).scale(1.05, 0.48, 0.9), mats.leaf2, 0.17, 0.01, 0.1);
    const path = [[-0.46, 0.02, -0.2], [-0.26, 0.09, -0.12], [-0.06, 0.1, -0.03], [0.1, 0.05, 0.04], [0.26, 0.09, 0.13], [0.45, 0.02, 0.24]];
    k.part('gwWall', () => {
      const parts = [];
      for (let i = 0; i < path.length - 1; i++) {
        const [x1, y1, z1] = path[i];
        const [x2, y2, z2] = path[i + 1];
        const steps = 6;
        const ang = Math.atan2(z2 - z1, x2 - x1);
        const seg = Math.hypot(x2 - x1, z2 - z1) / steps;
        const px = -Math.sin(ang) * 0.031;
        const pz = Math.cos(ang) * 0.031;
        for (let j = 0; j < steps; j++) {
          const f = (j + 0.5) / steps;
          const x = x1 + (x2 - x1) * f;
          const z = z1 + (z2 - z1) * f;
          const top = y1 + (y2 - y1) * f + 0.09;
          parts.push(boxAt(seg + 0.004, top, 0.07, x, top / 2, z, -ang));
          for (const s of [-1, 1]) parts.push(boxAt(seg * 0.5, 0.022, 0.01, x + px * s, top + 0.011, z + pz * s, -ang));
        }
      }
      return mergeGeos(parts);
    }, mats.stone, 0, 0, 0);
    for (const i of [1, 4]) {
      const [x, y, z] = path[i];
      const h = y + 0.18;
      k.part('gwTower' + i, () => box(0.11, h, 0.11), mats.stoneDark, x, h / 2, z);
      k.part('gwTowerRoof', () => pyramid(0.1, 0.07), mats.slate, x, h + 0.035, z);
      k.part('gwTowerDoor', () => box(0.035, 0.05, 0.01), mats.black, x, y + 0.11, z + 0.056);
    }
    return 0.34;
  },
  // --- Middle Ages ---------------------------------------------------------------------------
  // Notre Dame de Paris: the twin towers and rose window of the west front,
  // the long nave under a steep roof, the slim spire and flying buttresses.
  notredame(k) {
    const M = mats.gothic;
    for (const sx of [-1, 1]) {
      k.part('ndTower', () => box(0.13, 0.5, 0.12), M, sx * 0.115, 0.25, 0.2);
      k.part('ndTowerTop', () => box(0.14, 0.025, 0.13), mats.stoneDark, sx * 0.115, 0.512, 0.2);
      for (const dx of [-0.028, 0.028]) k.part('ndLouvre', () => box(0.026, 0.12, 0.01), mats.black, sx * 0.115 + dx, 0.4, 0.262);
    }
    k.part('ndFront', () => box(0.1, 0.38, 0.11), M, 0, 0.19, 0.2);
    k.part('ndRose', () => cyl(0.045, 0.045, 0.01, 16).rotateX(Math.PI / 2), mats.window, 0, 0.29, 0.256);
    k.part('ndRoseRing', () => new T.TorusGeometry(0.047, 0.006, 6, 20), mats.stoneDark, 0, 0.29, 0.258);
    k.part('ndGallery', () => box(0.37, 0.02, 0.125), mats.stoneDark, 0, 0.37, 0.2);
    for (const x of [-0.115, 0, 0.115]) k.part('ndPortal', () => box(0.05, 0.1, 0.01), mats.door, x, 0.05, 0.262);
    k.part('ndNave', () => box(0.17, 0.27, 0.46), M, 0, 0.135, -0.1);
    k.part('ndNaveRoof', () => gable(0.48, 0.14, 0.2).rotateY(Math.PI / 2), mats.slate, 0, 0.318, -0.1);
    k.part('ndTransept', () => box(0.38, 0.25, 0.1), M, 0, 0.125, -0.12);
    k.part('ndTransRoof', () => gable(0.4, 0.13, 0.12), mats.slate, 0, 0.3, -0.12);
    k.part('ndSpire', () => cyl(0.003, 0.026, 0.34, 6), mats.slate, 0, 0.52, -0.12);
    k.part('ndButtress', () => {
      const parts = [];
      for (const z of [-0.3, -0.22, -0.02, 0.07]) {
        for (const sx of [-1, 1]) {
          parts.push(boxAt(0.03, 0.2, 0.03, sx * 0.17, 0.1, z));
          parts.push(beam(V(sx * 0.17, 0.19, z), V(sx * 0.085, 0.26, z), 0.014, 0.02));
        }
      }
      return mergeGeos(parts);
    }, M, 0, 0, 0);
    return 0.86;
  },
  // Angkor Wat: a temple mountain on its island in a moat, with five towers
  // shaped like lotus buds.
  angkorwat(k) {
    const S = mats.sandstone;
    k.part('akMoat', () => box(0.72, 0.012, 0.72), mats.waterLight, 0, 0.006, 0);
    k.part('akIsland', () => box(0.58, 0.025, 0.58), mats.grass, 0, 0.0125, 0);
    k.part('akCauseway', () => box(0.07, 0.022, 0.1), S, 0, 0.011, 0.33);
    k.part('akT1', () => box(0.48, 0.05, 0.48), S, 0, 0.05, 0);
    k.part('akT2', () => box(0.36, 0.06, 0.36), S, 0, 0.105, 0);
    k.part('akT3', () => box(0.24, 0.07, 0.24), S, 0, 0.17, 0);
    k.part('akGalleries', () => {
      const parts = [];
      for (const [w, y] of [[0.48, 0.09], [0.36, 0.15]]) {
        for (const r of [0, 1, 2, 3]) {
          const ry = (r * Math.PI) / 2;
          const c = Math.cos(ry);
          const sn = Math.sin(ry);
          parts.push(boxAt(w, 0.03, 0.02, sn * (w / 2 - 0.01), y, c * (w / 2 - 0.01), ry));
        }
      }
      return mergeGeos(parts);
    }, mats.stoneDark, 0, 0, 0);
    const bud = (name, s) => geo(name, () => {
      const parts = [];
      let y = 0;
      [0.06, 0.056, 0.05, 0.043, 0.035, 0.026, 0.016].forEach((r, i) => {
        const h = 0.045 - i * 0.002;
        parts.push(cyl(r * 0.9, r, h, 8).translate(0, y + h / 2, 0));
        y += h;
      });
      parts.push(cyl(0.002, 0.012, 0.05, 8).translate(0, y + 0.025, 0));
      return mergeGeos(parts).scale(s, s, s);
    });
    mesh(bud('akBudBig', 1.3), S, 0, 0.205, 0, k.g);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) mesh(bud('akBudSmall', 0.85), S, x * 0.14, 0.135, z * 0.14, k.g);
    return 0.62;
  },
  // --- Industrial Revolution -------------------------------------------------------------------
  // The Eiffel Tower: four iron legs with arches between them, three
  // platforms, cross bracing all the way up, and lights that sparkle at night.
  eiffel(k) {
    ground(k, 'efGround');
    const legAt = (y) => (y <= 0.22 ? 0.3 - (0.1 * y) / 0.22 : y <= 0.41 ? 0.2 - (0.06 * (y - 0.22)) / 0.19 : y <= 0.83 ? 0.13 - (0.06 * (y - 0.41)) / 0.42 : 0.06 - (0.042 * (y - 0.83)) / 0.79);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    k.part('efFrame', () => {
      const parts = [];
      const leg = (y1, y2, w) => {
        for (const [sx, sz] of corners) parts.push(beam(V(sx * legAt(y1), y1, sz * legAt(y1)), V(sx * legAt(y2), y2, sz * legAt(y2)), w));
      };
      leg(0, 0.22, 0.05);
      leg(0.22, 0.41, 0.04);
      leg(0.41, 0.83, 0.03);
      leg(0.83, 1.62, 0.02);
      const pairs = [[0.41, 0.55], [0.55, 0.69], [0.69, 0.83], [0.83, 1.03], [1.03, 1.23], [1.23, 1.43], [1.43, 1.62]];
      for (let f = 0; f < 4; f++) {
        const [ax, az] = corners[f];
        const [bx, bz] = corners[(f + 1) % 4];
        for (const [y1, y2] of pairs) {
          const r1 = legAt(y1);
          const r2 = legAt(y2);
          parts.push(beam(V(ax * r1, y1, az * r1), V(bx * r2, y2, bz * r2), 0.007));
          parts.push(beam(V(bx * r1, y1, bz * r1), V(ax * r2, y2, az * r2), 0.007));
        }
        // The great arch between two legs at the bottom.
        const arch = new T.TorusGeometry(0.26, 0.013, 5, 16, Math.PI);
        if (f % 2) arch.rotateY(Math.PI / 2);
        parts.push(arch.translate(((ax + bx) / 2) * 0.26, -0.05, ((az + bz) / 2) * 0.26));
      }
      parts.push(boxAt(0.34, 0.03, 0.34, 0, 0.41, 0), boxAt(0.17, 0.025, 0.17, 0, 0.83, 0), boxAt(0.05, 0.04, 0.05, 0, 1.64, 0));
      parts.push(cyl(0.003, 0.006, 0.22, 5).translate(0, 1.77, 0));
      return mergeGeos(parts);
    }, mats.ironwork, 0, 0, 0);
    for (let i = 0; i < 14; i++) {
      const y = 0.25 + (i / 14) * 1.35;
      const [sx, sz] = corners[i % 4];
      const r = legAt(y) + 0.012;
      const light = k.part('efSparkle', () => sph(0.009, 5, 4), mats.sparkle, sx * r, y, sz * r);
      k.anim.push({ kind: 'twinkle', o: light, ph: i * 1.7 });
    }
    return 1.86;
  },
  // Big Ben: the clock tower over the Houses of Parliament, with four clock
  // faces that show the real time and a gilded spire.
  bigben(k) {
    const W = mats.westminster;
    k.part('bbPalace', () => box(0.5, 0.18, 0.15), W, -0.12, 0.09, -0.2);
    k.part('bbPalaceRoof', () => gable(0.52, 0.08, 0.17), mats.slate, -0.12, 0.21, -0.2);
    k.part('bbPinnacles', () => mergeGeos([-0.34, -0.22, -0.1, 0.02, 0.1].map((x) => cyl(0.004, 0.012, 0.12, 6).translate(x, 0.24, -0.12))), mats.gold, 0, 0, 0);
    const X = 0.13;
    const Z = 0.06;
    k.part('bbShaft', () => box(0.17, 0.95, 0.17), W, X, 0.475, Z);
    k.part('bbRibs', () => {
      const parts = [];
      for (const r of [0, 1, 2, 3]) {
        const ry = (r * Math.PI) / 2;
        for (const o of [-0.05, 0, 0.05]) {
          const c = Math.cos(ry);
          const sn = Math.sin(ry);
          parts.push(boxAt(0.012, 0.85, 0.008, c * o + sn * 0.088, 0.5, -sn * o + c * 0.088, ry));
        }
      }
      return mergeGeos(parts);
    }, mats.sandstone, X, 0, Z);
    k.part('bbClockStage', () => box(0.21, 0.22, 0.21), W, X, 1.06, Z);
    const hands = [];
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const face = new T.Group();
      face.position.set(X + Math.sin(a) * 0.107, 1.06, Z + Math.cos(a) * 0.107);
      face.rotation.y = a;
      mesh(geo('bbFace', () => cyl(0.075, 0.075, 0.01, 20).rotateX(Math.PI / 2)), mats.clockFace, 0, 0, 0, face);
      mesh(geo('bbFaceRim', () => new T.TorusGeometry(0.077, 0.008, 5, 20)), mats.gold, 0, 0, 0.004, face);
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
    k.part('bbBelfry', () => box(0.18, 0.13, 0.18), W, X, 1.235, Z);
    for (const r of [0, 1, 2, 3]) {
      const ry = (r * Math.PI) / 2;
      k.part('bbBelfryOpen', () => box(0.07, 0.08, 0.01), mats.black, X + Math.sin(ry) * 0.091, 1.235, Z + Math.cos(ry) * 0.091).rotation.y = ry;
    }
    k.part('bbBand', () => box(0.19, 0.014, 0.19), mats.gold, X, 1.305, Z);
    k.part('bbSpire', () => pyramid(0.135, 0.38), mats.slate, X, 1.5, Z);
    k.part('bbFinial', () => cyl(0.004, 0.009, 0.12, 6), mats.gold, X, 1.74, Z);
    return 1.8;
  },
  // --- Modern Age ----------------------------------------------------------------------------
  // The Empire State Building: limestone and glass rising in art deco
  // setbacks to a mast with a light on top.
  empirestate(k) {
    const G = mats.towerGlass;
    const L = mats.concrete;
    k.part('esBase', () => tiled(box(0.5, 0.17, 0.42), 2, 1), G, 0, 0.085, 0);
    k.part('esLedge0', () => box(0.52, 0.02, 0.44), L, 0, 0.17, 0);
    k.part('esMid', () => tiled(box(0.36, 0.26, 0.3), 1.5, 1.5), G, 0, 0.3, 0);
    k.part('esLedge1', () => box(0.38, 0.02, 0.32), L, 0, 0.43, 0);
    k.part('esShaft', () => tiled(box(0.25, 1.0, 0.2), 1, 4), G, 0, 0.93, 0);
    k.part('esPiers', () => {
      const parts = [];
      for (const x of [-0.105, -0.035, 0.035, 0.105]) parts.push(boxAt(0.014, 1.0, 0.205, x, 0.93, 0));
      for (const z of [-0.07, 0, 0.07]) parts.push(boxAt(0.255, 1.0, 0.014, 0, 0.93, z));
      return mergeGeos(parts);
    }, L, 0, 0, 0);
    k.part('esLedge2', () => box(0.27, 0.02, 0.22), L, 0, 1.43, 0);
    k.part('esTop1', () => tiled(box(0.19, 0.12, 0.15), 1, 0.5), G, 0, 1.5, 0);
    k.part('esTop2', () => box(0.14, 0.09, 0.11), L, 0, 1.6, 0);
    k.part('esCrown', () => cyl(0.05, 0.065, 0.1, 8), L, 0, 1.69, 0);
    k.part('esMast', () => cyl(0.02, 0.04, 0.2, 8), mats.metal, 0, 1.84, 0);
    k.part('esAntenna', () => cyl(0.004, 0.008, 0.28, 5), mats.metal, 0, 2.08, 0);
    const light = k.part('esLight', () => sph(0.018, 8, 6), mats.redLight, 0, 2.23, 0);
    k.anim.push({ kind: 'blink', o: light });
    return 2.25;
  },
  // The Sydney Opera House: white shells like sails, two halls side by side
  // on a granite podium by the water.
  operahouse(k) {
    ground(k, 'ohWater', mats.waterLight);
    k.part('ohPodium', () => box(0.58, 0.07, 0.6), mats.granite, 0, 0.045, -0.04);
    k.part('ohSteps', () => box(0.34, 0.03, 0.1), mats.granite, 0, 0.025, 0.3);
    // A shell: a wedge of a dome from its top down, standing up like a sail
    // with its point in the air and its round back to the front.
    const shell = (name, r) => geo(name, () => sph(r, 12, 10, Math.PI / 4, Math.PI / 2, 0, Math.PI / 2).scale(0.85, 1.75, 0.95));
    const W = inside(mats.whiteGloss);
    [[-0.13, 1], [0.15, 0.85]].forEach(([x, s]) => {
      [[0.27, -0.24], [0.22, -0.1], [0.17, 0.02], [0.12, 0.12]].forEach(([r, z], i) => {
        const m = mesh(shell('ohShell' + i, r), W, x, 0.08, z * s, k.g);
        m.scale.setScalar(s);
        m.rotation.x = 0.16;
      });
    });
    k.part('ohGlass', () => box(0.44, 0.07, 0.02), mats.glassBlue, 0, 0.115, 0.22);
    return 0.56;
  },
  // --- Future --------------------------------------------------------------------------------
  // The Fusion Spire: a crystal of light ringed by turning halos.
  spire(k) {
    k.part('spBase', () => cyl(0.36, 0.42, 0.1, 6), mats.whiteGloss, 0, 0.05, 0);
    const crystal = k.part('spCrystal', () => new T.OctahedronGeometry(0.22, 0).scale(1, 5.5, 1), mats.neonCyan, 0, 1.3, 0);
    k.anim.push({ kind: 'pulse', o: crystal });
    for (let i = 0; i < 3; i++) {
      const ring = k.part('spRing' + i, () => new T.TorusGeometry(0.3 - i * 0.06, 0.012, 6, 32), i === 1 ? mats.neonPink : mats.holo, 0, 0.7 + i * 0.6, 0);
      ring.rotation.x = Math.PI / 2 + 0.2 * (i - 1);
      k.anim.push({ kind: 'spinY', o: ring, speed: 0.4 + i * 0.3 });
    }
    const beamUp = new T.Group();
    beamUp.position.y = 2.5;
    mesh(geo('spBeam', () => new T.CylinderGeometry(0.02, 0.12, 6, 10, 1, true)), mats.beam, 0, 3, 0, beamUp);
    k.g.add(beamUp);
    k.anim.push({ kind: 'beamUp', o: beamUp });
    return 2.6;
  },
  // The Space Elevator: a ribbon from the ground station up into the sky,
  // with a climber riding up and down it.
  elevator(k) {
    k.part('elBase', () => cyl(0.4, 0.44, 0.06, 6), mats.whiteGloss, 0, 0.03, 0);
    k.part('elRing', () => new T.TorusGeometry(0.34, 0.014, 6, 36).rotateX(Math.PI / 2), mats.neonCyan, 0, 0.068, 0);
    k.part('elFins', () => mergeGeos([0, 1, 2].map((i) => {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      return beam(V(Math.cos(a) * 0.32, 0.05, Math.sin(a) * 0.32), V(Math.cos(a) * 0.06, 0.58, Math.sin(a) * 0.06), 0.04, 0.014);
    })), mats.whiteGloss, 0, 0, 0);
    k.part('elHub', () => cyl(0.05, 0.08, 0.62, 12), mats.metal, 0, 0.33, 0);
    k.part('elCap', () => sph(0.07, 12, 8), mats.glassBlue, 0, 0.66, 0);
    k.part('elTether', () => cyl(0.006, 0.006, 12, 5), mats.neonCyan, 0, 6.66, 0);
    const climber = new T.Group();
    mesh(geo('elClimber', () => box(0.09, 0.07, 0.09)), mats.whiteGloss, 0, 0, 0, climber);
    mesh(geo('elClimberBand', () => new T.TorusGeometry(0.065, 0.008, 5, 16).rotateX(Math.PI / 2)), mats.neonPink, 0, 0, 0, climber);
    climber.position.y = 1;
    k.g.add(climber);
    k.anim.push({ kind: 'climb', o: climber, y0: 0.78, span: 3.2 });
    return 2.6;
  },
  // A wonder nobody has chosen yet: foundations, scaffolding and a sign
  // asking chat to vote.
  wondersite(k) {
    k.part('wsBase', () => cyl(0.42, 0.44, 0.04, 6), mats.stone, 0, 0.02, 0);
    k.part('wsPiles', () => {
      const parts = [];
      const piles = [[-0.22, -0.18], [0.24, -0.12], [-0.18, 0.22]];
      for (const [x, z] of piles) {
        for (let i = 0; i < 3; i++) for (let j = 0; j < 2 - (i > 1 ? 1 : 0); j++) parts.push(boxAt(0.07, 0.045, 0.06, x + j * 0.075, 0.062 + i * 0.046, z));
      }
      return mergeGeos(parts);
    }, mats.stone, 0, 0, 0);
    k.part('wsFrame', () => {
      const parts = [];
      for (const [x, z] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]]) parts.push(boxAt(0.016, 0.5, 0.016, x, 0.29, z));
      for (const y of [0.22, 0.4]) {
        parts.push(boxAt(0.26, 0.012, 0.012, 0, y, -0.12), boxAt(0.26, 0.012, 0.012, 0, y, 0.12));
        parts.push(boxAt(0.012, 0.012, 0.26, -0.12, y, 0), boxAt(0.012, 0.012, 0.26, 0.12, y, 0));
      }
      parts.push(boxAt(0.02, 0.62, 0.02, 0.3, 0.35, 0.08), boxAt(0.36, 0.018, 0.018, 0.14, 0.65, 0.08));
      return mergeGeos(parts);
    }, mats.woodDark, 0, 0, 0);
    k.part('wsRope', () => cyl(0.003, 0.003, 0.3, 4), mats.black, -0.02, 0.5, 0.08);
    k.part('wsLoad', () => box(0.06, 0.04, 0.05), mats.stone, -0.02, 0.33, 0.08);
    const sign = new T.Group();
    sign.position.set(0.16, 0, 0.3);
    mesh(geo('wsPost', () => cyl(0.008, 0.008, 0.22, 5)), mats.woodDark, 0, 0.11, 0, sign);
    mesh(geo('wsBoard', () => new T.PlaneGeometry(0.2, 0.0625)), voteSign(), 0, 0.22, 0.01, sign);
    k.g.add(sign);
    return 0.7;
  },
};

let voteMat = null;
function voteSign() {
  return voteMat || (voteMat = new T.MeshBasicMaterial({ map: signTexture('VOTE !1 !2'), side: T.DoubleSide }));
}

// Called with the same builder object every building gets (see buildings.js).
export function wonderModel(item, k) {
  T = three();
  const make = BUILD[item];
  return make ? make(k) : null;
}
export const isWonderModel = (item) => !!BUILD[item];
