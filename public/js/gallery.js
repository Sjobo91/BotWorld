// Every building of every era side by side, for checking the models.
// Open /gallery.html (add ?era=3 to see one era up close, &zoom=2 closer
// still, &level=3 to see upgraded buildings, ?wonders=1 for the wonders of
// every era, and &site=1 for the building site of a wonder not chosen yet).
// ?looks=1 shows the buildings that change with the eras, every look of one
// building in a row (?looks=market,mine just those); &in=5 shows any set as
// it looks in a town in era 5.
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ITEMS, ERAS } from '../shared/catalog.js';
import { initMeshes, mats } from './meshes.js';
import { buildingMesh } from './buildings.js';
import { itemsWithLooks, lookErasOf } from './eralooks.js';

initMeshes(T);
const params = new URLSearchParams(location.search);
const only = params.has('era') ? Number(params.get('era')) : null;
const night = params.get('night') === '1';
const stage = document.getElementById('stage');
const labels = document.getElementById('labels');
const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.shadowMap.enabled = true;
stage.append(renderer.domElement);
const scene = new T.Scene();
const camera = new T.PerspectiveCamera(30, 1, 0.05, 200);
const controls = new OrbitControls(camera, renderer.domElement);
scene.add(new T.HemisphereLight(night ? 0x3b5082 : 0xc4e6f6, 0xc7a676, night ? 1.2 : 1.7));
const sun = new T.DirectionalLight(night ? 0xa9bfff : 0xfff0d4, night ? 0.9 : 2.6);
sun.position.set(-6, 10, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, far: 60 });
scene.add(sun);
if (night) {
  mats.window.emissiveIntensity = 1.7;
  mats.lamp.emissiveIntensity = 1.6;
  mats.glow.opacity = 0.85;
  mats.beam.opacity = 0.16;
  mats.towerGlass.emissiveIntensity = 1.2;
  document.body.style.background = '#0b1530';
}

// ?items=villa,temple shows just those, side by side.
const pickOnly = params.get('items') ? params.get('items').split(',') : null;
const eras = pickOnly ? [0] : only == null ? ERAS.map((_, i) => i) : [only];
const wondersOnly = params.get('wonders') === '1';
const inEra = params.has('in') ? Number(params.get('in')) : undefined;
const spacing = 1.25;
const tags = [];
let maxCols = 0;
// Each row: a title and its cells (an item, the era of the town it stands in).
const looks = params.get('looks');
const rows = looks
  ? (looks === '1' ? itemsWithLooks() : looks.split(',')).map((key) => ({ title: ITEMS[key].emoji + ' ' + ITEMS[key].label, cells: lookErasOf(key).map((e) => ({ key, era: e, tag: ERAS[e].name })) }))
  : eras.map((era, row) => {
    const items = pickOnly || Object.keys(ITEMS).filter((k) => ITEMS[k].era === era && (!wondersOnly || ITEMS[k].kind === 'wonder'));
    if (wondersOnly && params.get('site') === '1' && row === 0) items.unshift('wondersite');
    return { title: pickOnly ? null : ERAS[era].emoji + ' ' + ERAS[era].name, cells: items.map((key) => ({ key, era: inEra })) };
  });
rows.forEach(({ title, cells }, row) => {
  maxCols = Math.max(maxCols, cells.length);
  cells.forEach(({ key, era, tag }, col) => {
    const it = ITEMS[key] || { kind: 'wonder', emoji: '🏗️' };
    const lv = it.kind === 'wonder' ? 1 : Number(params.get('level')) || 1;
    const { g } = buildingMesh({ id: row * 100 + col, item: key, level: lv, color: null, wonder: it.kind === 'wonder' }, lv, era);
    const x = col * spacing;
    const z = row * spacing * 1.6;
    const plot = new T.Mesh(new T.CylinderGeometry(0.58, 0.6, 0.04, 6), new T.MeshStandardMaterial({ color: it.kind === 'wonder' ? 0xd6dce6 : 0x8ccd74, flatShading: true }));
    plot.position.set(x, -0.02, z);
    plot.receiveShadow = true;
    scene.add(plot);
    g.position.set(x, 0, z);
    scene.add(g);
    tags.push({ text: tag || it.emoji + ' ' + key, pos: new T.Vector3(x, -0.05, z + 0.62) });
  });
  if (title) tags.push({ text: title, pos: new T.Vector3(-1.1, 0, row * spacing * 1.6), era: true });
});
for (const t of tags) {
  const e = document.createElement('div');
  e.className = t.era ? 'era' : 'tag';
  e.textContent = t.text;
  labels.append(e);
  t.el = e;
}
const cx = ((maxCols - 1) * spacing) / 2;
const cz = ((rows.length - 1) * spacing * 1.6) / 2;
// &y=1 looks higher up (for the tall wonders).
const ty = Number(params.get('y')) || 0;
controls.target.set(cx, ty, cz);
const zoom = Number(params.get('zoom')) || 1;
const dist = (Math.max(maxCols * spacing * 0.9, rows.length * spacing * 2.2) + 2) / zoom;
camera.position.set(cx, ty + dist * 0.75, cz + dist * 0.75);
function resize() {
  renderer.setSize(stage.clientWidth, stage.clientHeight, false);
  camera.aspect = stage.clientWidth / stage.clientHeight;
  camera.updateProjectionMatrix();
}
resize();
addEventListener('resize', resize);
const v = new T.Vector3();
function loop() {
  requestAnimationFrame(loop);
  controls.update();
  renderer.render(scene, camera);
  for (const t of tags) {
    v.copy(t.pos).project(camera);
    t.el.style.left = ((v.x * 0.5 + 0.5) * stage.clientWidth).toFixed(1) + 'px';
    t.el.style.top = ((-v.y * 0.5 + 0.5) * stage.clientHeight).toFixed(1) + 'px';
  }
}
loop();
