import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, freshState, migrate, reachOf, LABOR, TOWN_CREW } from '../server/world.js';
import { freshRival } from '../server/rival.js';
import { hexDist, hexKey } from '../public/shared/hex.js';
import { ITEMS, ERAS, RESOURCES } from '../public/shared/catalog.js';
import * as M from '../public/shared/terrain.js';
import * as E from '../server/economy.js';

const T0 = Date.UTC(2026, 9, 8, 12);
const alice = { id: 'a', name: 'alice' };
const bob = { id: 'b', name: 'bob' };
const carol = { id: 'c', name: 'carol' };
const mod = { id: 'm', name: 'mod', mod: true };

// Most tests are about other things than short jobs, so their bots keep
// working for ten minutes per command, like a busy chat would.
function makeWorld(opts = {}) {
  const w = new World(freshState(T0, 1), { ...opts, limits: { shiftSec: 600, workShiftSec: 600, ...(opts.limits || {}) } });
  const events = [];
  w.on((e) => events.push(e));
  return { w, events };
}
// Moves time forward in small steps, like the server's clock.
function run(w, from, ms, step = 5000) {
  let now = from;
  const end = from + ms;
  while (now < end) {
    now += step;
    w.tick(now);
  }
  return now;
}
const say = (w, user, text, now) => w.handleChat(user, text, now);
// An old (version 3) rival in the medieval era, with its own cathedral.
function freshRivalFor(v3) {
  const rv = freshRival(M.makeMap(v3.mapSeed), T0, 2);
  rv.builds.push({ id: 1_000_001, item: 'cathedral', wonder: true, rival: true, q: rv.origin.q, r: rv.origin.r, status: 'building', built: false, delivered: {} });
  rv.eraFirst = { 2: 'rival' };
  return rv;
}
// Gives the town whatever it needs, for tests about other things.
const rich = (w) => { for (const r of ['wood', 'stone', 'food', 'bricks', 'coal', 'iron', 'steel', 'parts', 'chips']) w.state.stock[r] = 100; };
const revealAll = (w) => { for (const t of w.map.tiles) M.setExplored(w.bits, t.i); w.saveBits(); };
// Starts a project and finishes it with a few helpers.
function finish(w, user, item, now) {
  rich(w);
  const res = say(w, user, '!build ' + item, now);
  assert.equal(res.ok, true, res.message);
  return run(w, now, (ITEMS[item].buildSec * LABOR * 1000) / (1 + TOWN_CREW) + 10e3);
}

test('a fresh world starts in the Stone Age, with goods, a wonder site and land around the pad explored', () => {
  const { w } = makeWorld();
  assert.equal(w.state.era, 0);
  assert.ok(w.state.stock.wood > 0 && w.state.stock.stone > 0);
  const wonder = w.builds.find((b) => b.wonder);
  // Chat has not chosen between Stonehenge and the Moai yet.
  assert.equal(wonder.item, 'stonehenge');
  assert.equal(wonder.pending, true);
  assert.equal(hexDist(wonder.q, wonder.r), 1);
  assert.equal(w.map.total, 4921);
  const known = M.exploredCount(w.map, w.bits);
  assert.equal(known, 1 + 3 * M.START_RADIUS * (M.START_RADIUS + 1));
  assert.ok(w.state.explored.length > 100);
});

test('the map is the same for the same seed, and the start has wood, stone and berries', () => {
  const a = M.makeMap(7);
  const b = M.makeMap(7);
  assert.deepEqual(a.tiles.map((t) => t.t + t.f), b.tiles.map((t) => t.t + t.f));
  for (const seed of [1, 2, 3, 99, 1234]) {
    const m = M.makeMap(seed);
    const near = (types, rad) => m.tiles.filter((t) => t.d <= rad && types.includes(t.t)).length;
    assert.ok(near(['forest'], 7) >= 6, 'forest near start, seed ' + seed);
    assert.ok(near(['hills', 'mountain'], 8) >= 4, 'hills near start, seed ' + seed);
    assert.ok(near(['meadow'], 6) >= 3, 'berries near start, seed ' + seed);
    assert.ok(m.tiles.some((t) => t.f === 'coal' && t.d <= 13) && m.tiles.some((t) => t.f === 'iron' && t.d <= 13), 'ore in reach, seed ' + seed);
    assert.ok(m.tiles.filter((t) => t.d <= 2).every((t) => t.t === 'grass'), 'the middle is grass');
  }
});

test('explored land survives a trip through text', () => {
  const m = M.makeMap(3);
  const bits = M.newExplored(m);
  M.reveal(m, bits, 5, -2, 3);
  const back = M.decodeBits(M.encodeBits(bits), m);
  assert.deepEqual([...back], [...bits]);
});

test('!home builds your own home: half price, timed, and only one per viewer', () => {
  const { w } = makeWorld();
  const wood = w.state.stock.wood;
  const b = say(w, alice, '!home', T0).build;
  assert.equal(b.item, 'hut');
  assert.equal(b.home, true);
  assert.equal(b.ownerId, 'a');
  assert.equal(b.status, 'building');
  assert.equal(w.state.stock.wood, wood - Math.ceil(ITEMS.hut.cost.wood / 2));
  w.tick(T0 + (b.walkSec + b.buildSec) * 1000 - 1);
  assert.equal(b.status, 'building');
  w.tick(T0 + (b.walkSec + b.buildSec) * 1000);
  assert.equal(b.status, 'done');
  assert.match(say(w, alice, '!home', T0 + 60e3).message, /already have a home/);
  assert.equal(w.homeOf('a'), b);
});

test('"!build house" is your home first, and a town hut once you have one', () => {
  const { w } = makeWorld();
  rich(w);
  const home = say(w, alice, '!build house', T0).build;
  assert.equal(home.home, true);
  const hut = say(w, alice, '!build house', T0 + 1000).build;
  assert.equal(hut.project, true);
  assert.equal(hut.item, 'hut');
  assert.equal(hut.founderId, 'a');
});

test('buildings from later eras are explained, not built', () => {
  const { w } = makeWorld();
  const res = say(w, alice, '!build factory', T0);
  assert.equal(res.ok, false);
  assert.match(res.message, /Industrial Revolution/);
});

test('a town project is built by helpers: the more bots, the faster', () => {
  const { w, events } = makeWorld();
  rich(w);
  const p = say(w, alice, '!build woodcutter', T0).build;
  assert.equal(p.project, true);
  assert.equal(p.status, 'building');
  assert.equal(w.state.jobs.a.kind, 'build', 'the founder helps right away');
  let now = run(w, T0, 20e3);
  const alone = p.progress;
  assert.ok(Math.abs(alone - 20 * (1 + TOWN_CREW)) < 6, 'one bot and the townsfolk: ' + alone);
  assert.equal(say(w, bob, '!help', now).ok, true);
  assert.equal(say(w, carol, '!help #' + p.id, now).ok, true);
  const before = p.progress;
  now = run(w, now, 20e3);
  assert.ok(p.progress - before > 2.5 * alone, 'three bots are faster');
  now = run(w, now, 60e3);
  assert.equal(p.status, 'done');
  assert.ok(p.built);
  assert.ok(w.state.builders.b.xp > 5 && w.state.builders.c.xp > 5);
  assert.deepEqual(new Set(p.crew), new Set(['a', 'b', 'c']));
  assert.ok(events.some((e) => e.type === 'notice' && e.kind === 'project' && /alice/.test(e.text)));
  assert.equal(w.state.jobs.b, undefined, 'helpers are free again');
});

test('projects finish even without helpers, just slowly', () => {
  const { w } = makeWorld();
  rich(w);
  const p = say(w, alice, '!build campfire', T0).build;
  w.endJob('a', false, T0);
  run(w, T0, ((p.work / TOWN_CREW) + 30) * 1000, 30e3);
  assert.equal(p.status, 'done');
});

test('at most three projects at once, and one per founder', () => {
  const { w } = makeWorld();
  rich(w);
  assert.equal(say(w, alice, '!build woodcutter', T0).ok, true);
  assert.match(say(w, alice, '!build quarry', T0 + 1).message, /Help finish it first/);
  assert.equal(say(w, bob, '!build quarry', T0 + 2).ok, true);
  assert.equal(say(w, carol, '!build gatherer', T0 + 3).ok, true);
  const res = say(w, { id: 'd', name: 'dave' }, '!build campfire', T0 + 4);
  assert.equal(res.ok, false);
  assert.match(res.message, /3 projects/);
});

test('a project waits for missing goods, !help then gathers them', () => {
  const { w } = makeWorld();
  rich(w);
  finish(w, bob, 'woodcutter', T0);
  w.state.stock.wood = 0;
  const p = say(w, alice, '!build stockpile', T0 + 200e3).build;
  assert.equal(p.status, 'queued');
  assert.deepEqual(p.waitingFor, ['wood']);
  const res = say(w, carol, '!help', T0 + 201e3);
  assert.equal(res.ok, true);
  assert.match(res.message, /waiting for/);
  assert.equal(w.state.jobs.c.kind, 'hand');
  assert.equal(w.state.jobs.c.res, 'wood');
  w.state.stock.wood = 50;
  w.tick(T0 + 202e3);
  assert.equal(p.status, 'building');
});

test('!help with nothing to build hauls to the wonder', () => {
  const { w } = makeWorld();
  const res = say(w, alice, '!help', T0);
  assert.equal(res.ok, true);
  assert.equal(w.state.jobs.a.kind, 'wonder');
  assert.equal(say(w, bob, '!help wonder', T0).ok, true);
  // Nobody builds the wonder alone: !build wonder hauls to it as well.
  assert.equal(say(w, carol, '!build wonder', T0).ok, true);
  assert.equal(w.state.jobs.c.kind, 'wonder');
});

test('producers need the right land, and richer land works faster', () => {
  const { w } = makeWorld();
  rich(w);
  finish(w, alice, 'woodcutter', T0);
  const wc = w.builds.find((b) => b.item === 'woodcutter');
  const t = M.tileAt(w.map, wc.q, wc.r);
  assert.ok(M.neighborsOf(w.map, t).some((n) => n.t === 'forest'), 'a woodcutter stands by a forest');
  assert.ok(wc.rich >= 1, 'and picks a rich spot: ' + wc.rich);
  for (const b of w.builds.filter((x) => !x.wonder)) assert.ok(w.known(M.tileAt(w.map, b.q, b.r)), 'only on explored land');
});

test('a mine needs a known ore deposit: explore first', () => {
  const { w } = makeWorld();
  w.state.era = 3;
  w.ensureWonder(T0);
  rich(w);
  const ore = w.map.tiles.find((t) => (t.f === 'coal' || t.f === 'iron') && !w.known(t));
  assert.ok(ore);
  // Pretend nothing with ore is known yet.
  for (const t of w.map.tiles) if ((t.f === 'coal' || t.f === 'iron') && w.known(t)) w.bits[t.i >> 3] &= ~(1 << (t.i & 7));
  const res = say(w, alice, '!build mine', T0);
  assert.equal(res.ok, false);
  assert.match(res.message, /!explore/);
  M.reveal(w.map, w.bits, ore.q, ore.r, 2);
  const ok = say(w, alice, '!build mine', T0 + 1000);
  assert.equal(ok.ok, true, ok.message);
  assert.ok(ok.build.ores.length >= 1);
});

test('!explore sends a scout into the fog, reveals land and pays XP', () => {
  const { w, events } = makeWorld();
  const before = M.exploredCount(w.map, w.bits);
  const res = say(w, alice, '!explore north', T0);
  assert.equal(res.ok, true, res.message);
  const job = w.state.jobs.a;
  assert.equal(job.kind, 'explore');
  const t = M.tileAt(w.map, job.q, job.r);
  assert.ok(M.angleOf(t) < 0, 'north is up the map');
  // Typed again while out: the next trip waits in line.
  assert.match(say(w, alice, '!explore', T0 + 1000).message, /lined up one more job/);
  run(w, T0, job.until - T0 + 2000, 1000);
  assert.equal(w.state.jobs.a?.kind, 'explore');
  assert.notEqual(w.state.jobs.a.startedAt, job.startedAt);
  assert.equal(w.state.queues.a, undefined);
  assert.ok(M.exploredCount(w.map, w.bits) > before);
  assert.ok(w.known(t));
  assert.ok(w.state.builders.a.xp >= 6);
  const e = events.find((x) => x.type === 'explore');
  assert.ok(e && e.tiles.length > 0 && e.userId === 'a');
});

test('ruins found while exploring give goods, once', () => {
  const { w, events } = makeWorld();
  const front = M.frontier(w.map, w.bits).find((t) => M.walkable(t));
  front.f = 'ruins';
  w.state.stock.stone = 0;
  M.reveal(w.map, w.bits, 0, 0, 0);
  const found = w.discover([front], T0);
  assert.equal(found[0].f, 'ruins');
  assert.ok(Object.values(found[0].gift).reduce((a, b) => a + b, 0) > 0);
  assert.equal(w.discover([front], T0).length, 0, 'only once');
  front.f = null;
  void events;
});

test('no plot is ever shared, the pad and the wonder ring stay free, and land suits each building', () => {
  const { w } = makeWorld();
  revealAll(w);
  let now = T0;
  for (let i = 0; i < 40; i++) {
    rich(w);
    say(w, { id: 'h' + i, name: 'h' + i }, '!home', now);
    now += 10;
  }
  // As many town buildings as 40 homes have room for.
  const items = ['woodcutter', 'quarry', 'gatherer', 'fisher', 'campfire', 'stockpile', 'totem', 'hut'];
  for (let i = 0; i < 40; i++) {
    const item = items.slice(i % items.length).concat(items).find((k) => !w.crowded(k));
    if (!item) break;
    now = finish(w, { id: 'p' + i, name: 'p' + i }, item, now);
  }
  const normal = w.builds.filter((b) => !b.wonder);
  const keys = normal.map((b) => hexKey(b.q, b.r));
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(normal.every((b) => hexDist(b.q, b.r) >= 2));
  for (const b of normal) assert.ok(M.siteOk(w.map, b.item, M.tileAt(w.map, b.q, b.r)), b.item + ' on ' + M.tileAt(w.map, b.q, b.r).t);
  assert.ok(normal.length >= 65, String(normal.length));
});

test('people move in, work, and producers make goods up to the storage limit', () => {
  const { w } = makeWorld();
  let now = T0;
  for (const u of [alice, bob, carol]) { rich(w); say(w, u, '!home', now); }
  now = finish(w, alice, 'hut', now);
  now = finish(w, bob, 'woodcutter', now);
  w.state.stock.wood = 10;
  now = run(w, now, 20 * 60e3);
  assert.ok(w.state.population >= 10, 'population ' + w.state.population);
  assert.ok(w.state.stock.wood > 10, 'wood ' + w.state.stock.wood);
  run(w, now, 6 * 3600e3, 30e3);
  // Full, give or take what the wonder takes now and then.
  assert.ok(w.state.stock.wood <= w.econ.cap && w.state.stock.wood >= w.econ.cap - 2, 'wood ' + w.state.stock.wood + ' of ' + w.econ.cap);
});

test('a kiln turns stone and wood into bricks, and stalls without them', () => {
  const { w } = makeWorld();
  w.state.era = 1;
  w.ensureWonder(T0);
  let now = finish(w, bob, 'mudhouse', T0);
  now = finish(w, alice, 'kiln', now);
  w.state.population = 10;
  w.state.stock.bricks = 0;
  now = run(w, now, 5 * 60e3);
  assert.ok(w.state.stock.bricks > 0);
  w.state.stock.stone = 0;
  const b2 = w.state.stock.bricks;
  run(w, now, 5 * 60e3);
  assert.ok(w.state.stock.bricks <= b2, 'no stone, no new bricks');
  const kiln = w.builds.find((b) => b.item === 'kiln');
  assert.match(w.stalled[kiln.id], /needs stone/);
});

test('factories need power: nothing without a power plant, parts with one', () => {
  const { w } = makeWorld();
  w.state.era = 4;
  w.ensureWonder(T0);
  let now = finish(w, alice, 'factory', T0);
  now = finish(w, bob, 'apartments', now);
  now = finish(w, { id: 'd', name: 'dave' }, 'apartments', now);
  rich(w);
  w.state.population = 48;
  w.state.stock.parts = 0;
  const parts = w.state.stock.parts;
  now = run(w, now, 5 * 60e3);
  assert.ok(w.state.stock.parts <= parts + 0.01, 'no power, no parts');
  now = finish(w, carol, 'coalplant', now);
  rich(w);
  w.state.population = 48;
  w.state.stock.parts = 0;
  const before = w.state.stock.parts;
  run(w, now, 5 * 60e3);
  assert.ok(w.econ.power.supply >= 20);
  assert.ok(w.state.stock.parts > before, 'powered factory makes parts');
});

test('parks next to homes make people happier', () => {
  const { w } = makeWorld();
  rich(w);
  say(w, alice, '!home', T0);
  let now = run(w, T0, 60e3);
  const bare = w.econ.happy;
  now = finish(w, bob, 'totem', now);
  now = finish(w, carol, 'campfire', now);
  run(w, now, 60e3);
  assert.ok(w.econ.happy > bare, bare + ' -> ' + w.econ.happy);
});

test('!work bricks sends your bot to a kiln and pays XP', () => {
  const { w, events } = makeWorld();
  w.state.era = 1;
  w.ensureWonder(T0);
  assert.match(say(w, alice, '!work bricks', T0).message, /!build kiln/);
  const now = finish(w, bob, 'kiln', T0);
  const res = say(w, alice, '!work bricks', now);
  assert.equal(res.ok, true, res.message);
  const job = w.state.jobs.a;
  assert.equal(job.kind, 'work');
  assert.equal(w.builds.find((b) => b.id === job.buildId).item, 'kiln');
  assert.equal(say(w, carol, '!work steel', now).ok, false);
  const xp = w.state.builders.a.xp;
  run(w, now, 11 * 60e3);
  assert.equal(w.state.jobs.a, undefined);
  assert.ok(w.state.builders.a.xp > xp);
  assert.ok(events.some((e) => e.type === 'job' && e.job === null));
});

test('!wood sends your bot on one trip into a forest, and it brings wood to town', () => {
  const { w, events } = makeWorld();
  w.state.stock.wood = 10;
  const res = say(w, alice, '!wood', T0);
  assert.equal(res.ok, true, res.message);
  assert.match(res.message, /cut wood in a forest and brings back 2/);
  const job = w.state.jobs.a;
  assert.equal(job.kind, 'hand');
  assert.equal(job.res, 'wood');
  const t = M.tileAt(w.map, job.q, job.r);
  assert.equal(t.t, 'forest');
  assert.ok(M.isExplored(w.bits, t.i));
  // Out, work, back: about half a minute for land near the town.
  assert.equal(job.until, T0 + (2 * job.out + job.work) * 1000);
  assert.ok(job.until - T0 < 60e3);
  assert.ok(events.some((e) => e.type === 'job' && e.job?.kind === 'hand'));
  const xp = w.state.builders.a.xp;
  run(w, T0, job.until - T0 - 2000, 1000);
  assert.equal(w.state.stock.wood, 10);
  run(w, job.until - 2000, 3000, 1000);
  assert.equal(w.state.stock.wood, 12);
  assert.equal(w.state.builders.a.gathered, 2);
  assert.equal(w.state.jobs.a, undefined);
  assert.ok(w.state.builders.a.xp > xp);
  assert.ok(events.some((e) => e.type === 'gathered' && e.userId === 'a' && e.n === 2));
});

test('jobs typed while the bot is busy wait in line, and !stop clears them', () => {
  const { w, events } = makeWorld();
  w.state.stock.wood = 0;
  assert.equal(say(w, alice, '!wood 3', T0).ok, true);
  assert.equal(w.state.queues.a.length, 2);
  assert.match(say(w, alice, '!stone', T0 + 1000).message, /lined up one more job \(3 waiting\)/);
  assert.ok(events.some((e) => e.type === 'queue' && e.userId === 'a' && e.n === 3));
  say(w, alice, '!explore', T0 + 2000);
  say(w, alice, '!help', T0 + 3000);
  assert.match(say(w, alice, '!wood', T0 + 4000).message, /5 jobs lined up already/);
  // Three wood trips, then the stone trip starts.
  let now = T0 + 5000;
  for (let i = 0; i < 400 && w.state.jobs.a?.res !== 'stone'; i++) now = run(w, now, 1000, 1000);
  assert.equal(w.state.jobs.a.res, 'stone');
  assert.equal(w.state.builders.a.gathered, 6);
  assert.equal(w.state.queues.a.length, 2);
  assert.match(say(w, alice, '!stop', now).message, /forgets 2 jobs/);
  assert.equal(w.state.jobs.a, undefined);
  assert.equal(w.state.queues.a, undefined);
});

test('help comes in short shifts, so chat keeps typing !help', () => {
  const w = new World(freshState(T0, 1));
  rich(w);
  const p = say(w, bob, '!build woodcutter', T0).build;
  assert.equal(say(w, alice, '!help', T0).ok, true);
  assert.equal(w.state.jobs.a.until, T0 + 40e3);
  let now = run(w, T0, 41e3, 1000);
  assert.equal(w.state.jobs.a, undefined);
  const after = p.progress;
  assert.ok(after > 60 && after < p.work);
  say(w, alice, '!help 2', now);
  assert.equal(w.state.queues.a.length, 1);
  now = run(w, now, 90e3, 1000);
  assert.equal(p.status, 'done');
});

test('!upgrade tools needs a level, the era and some goods, and then carries more', () => {
  const { w, events } = makeWorld();
  assert.match(say(w, alice, '!upgrade tools', T0).message, /come with Ancient Egypt/);
  w.state.era = 1;
  w.ensureWonder(T0);
  assert.match(say(w, alice, '!upgrade tools', T0).message, /need level 3, you are level 1/);
  w.touchBuilder(alice, T0).xp = 80;
  w.state.stock.bricks = 0;
  assert.match(say(w, alice, '!tools', T0).message, /bricks/);
  rich(w);
  const res = say(w, alice, '!upgrade tools', T0);
  assert.equal(res.ok, true, res.message);
  assert.match(res.message, /copper tools: it carries 3 per trip/);
  assert.equal(w.state.builders.a.tool, 1);
  assert.equal(w.state.stock.bricks, 94);
  assert.ok(events.some((e) => e.type === 'tools' && e.tool === 1));
  w.state.stock.wood = 0;
  const job = say(w, alice, '!wood', T0) && w.state.jobs.a;
  run(w, T0, job.until - T0 + 1000, 1000);
  assert.equal(w.state.stock.wood, 3);
});

test('!upgrade woodcutter takes a town building to the next level, and it makes more', () => {
  const { w, events } = makeWorld();
  let now = finish(w, bob, 'woodcutter', T0);
  const wc = w.builds.find((b) => b.item === 'woodcutter');
  assert.equal(wc.status, 'done');
  const made = (b) => {
    const progress = new Map();
    const stock = { wood: 0 };
    E.produce([b], stock, { employment: 1, happyFactor: 1, global: 1, powerRatio: 1, helpers: () => 0, boosts: {}, progress, fuel: new Map(), cap: 1000 }, 600);
    return stock.wood;
  };
  const before = made(wc);
  rich(w);
  const res = say(w, alice, '!upgrade woodcutter', now);
  assert.equal(res.ok, true, res.message);
  assert.match(res.message, /to level 2/);
  assert.equal(wc.upgrade.level, 2);
  w.economy(now, 0);
  assert.ok(w.econ.projects.some((p) => p.id === wc.id && p.level === 2));
  assert.match(say(w, carol, '!upgrade #' + wc.id, now).message, /being built right now/);
  now = run(w, now, 400e3, 5000);
  assert.equal(wc.level, 2);
  assert.equal(wc.status, 'done');
  assert.ok(wc.helpers.b > 0, 'the first builders are still credited');
  assert.ok(events.some((e) => e.type === 'notice' && /now level 2/.test(e.text)));
  assert.ok(made(wc) >= before * 1.4);
  const home = say(w, carol, '!home', now).build;
  run(w, now, 60e3, 5000);
  assert.match(say(w, alice, '!upgrade #' + home.id, now + 60e3).message, /someone's own home/);
  assert.match(say(w, alice, '!upgrade banana', now).message, /!upgrade tools/);
});

test('gathering by hand needs known land, the right era and room in storage', () => {
  const { w } = makeWorld();
  assert.match(say(w, alice, '!coal', T0).message, /Middle Ages/);
  assert.match(say(w, alice, '!marble', T0).message, /Roman Empire/);
  assert.equal(say(w, alice, '!mine', T0).ok, true);
  assert.equal(w.state.jobs.a.res, 'stone');
  assert.ok(['hills', 'mountain'].includes(M.tileAt(w.map, w.state.jobs.a.q, w.state.jobs.a.r).t));
  w.state.stock.stone = w.econ ? w.econ.cap : 100;
  run(w, T0, 70e3);
  assert.ok(w.state.stock.stone <= 100);
  w.bits.fill(0);
  assert.match(say(w, bob, '!wood', T0 + 80e3).message, /Nobody has found a forest yet/);
  // Food comes from berries, or from fishing when no meadow is known.
  revealAll(w);
  assert.equal(say(w, carol, '!fish', T0 + 90e3).ok, true);
  assert.equal(w.state.jobs.c.pose, 'fish');
  assert.equal(w.state.jobs.c.res, 'food');
});

test('the wonder fills up, the era changes, and homes and huts grow into the new era', () => {
  const { w, events } = makeWorld({ pace: { eraDays: 0.02 } });
  let now = T0;
  const home = say(w, alice, '!home', now).build;
  now = run(w, now, 60e3);
  for (let i = 0; i < 4; i++) now = finish(w, { id: 'h' + i, name: 'h' + i }, 'hut', now);
  for (let i = 0; i < 40 && w.state.era === 0; i++) {
    for (const r of ['wood', 'stone', 'food']) w.state.stock[r] = 100;
    now = run(w, now, 60e3);
  }
  // Nobody voted for the Stone Age's wonder, so chance chose one.
  const wonder = w.builds.find((b) => b.wonder && ITEMS[b.item].era === 0);
  assert.equal(wonder.status, 'done');
  assert.ok(!wonder.pending && ['stonehenge', 'moai'].includes(wonder.item));
  assert.equal(w.state.picks[0], wonder.item);
  assert.equal(w.state.era, 1);
  assert.ok(events.some((e) => e.type === 'era' && e.era === 1));
  assert.ok(w.builds.some((b) => b.wonder && ITEMS[b.item].era === 1));
  now = run(w, now, 120e3);
  assert.equal(home.item, 'mudhouse');
  assert.ok(w.builds.filter((b) => b.project && ITEMS[b.item].kind === 'house').every((b) => b.item === 'mudhouse'));
});

test('!upgrade makes your home bigger, up to three levels', () => {
  const { w } = makeWorld();
  rich(w);
  assert.match(say(w, alice, '!upgrade', T0).message, /!home/);
  const home = say(w, alice, '!home', T0).build;
  let now = run(w, T0, 60e3);
  for (let lv = 2; lv <= 3; lv++) {
    rich(w);
    const res = say(w, alice, '!upgrade', now);
    assert.equal(res.ok, true, res.message);
    now = run(w, now, 60e3);
    assert.equal(home.level, lv);
  }
  assert.match(say(w, alice, '!upgrade', now).message, /as big as it gets/);
});

test('votes start when chat is around, and the winner happens', () => {
  const { w, events } = makeWorld();
  say(w, alice, '!home', T0);
  say(w, bob, '!home', T0);
  let now = run(w, T0, 21 * 60e3, 30e3);
  assert.ok(w.state.vote, 'a vote started');
  say(w, alice, '!vote 2', now);
  say(w, bob, '!vote 2', now);
  assert.deepEqual(w.voteView().counts, [0, 2, 0]);
  const winner = w.state.vote.options[1];
  run(w, now, 4 * 60e3);
  assert.equal(w.state.vote, null);
  assert.ok(events.some((e) => e.type === 'vote' && e.winner === winner));
  assert.ok(events.some((e) => e.type === 'event' && e.event && e.event.key === winner));
});

test('moderators can start a vote right away with !vote start', () => {
  const { w } = makeWorld();
  w.pickWonder(0, 'stonehenge', T0);
  assert.equal(say(w, alice, '!vote start', T0).ok, false);
  assert.equal(w.state.vote, null);
  assert.equal(say(w, mod, '!vote start', T0).ok, true);
  assert.equal(w.state.vote.options.length, 3);
  assert.equal(say(w, mod, '!vote start', T0 + 1000).ok, false);
});

test('a storm breaks buildings and !repair fixes them', () => {
  const { w } = makeWorld();
  rich(w);
  say(w, alice, '!home', T0);
  let now = finish(w, bob, 'woodcutter', T0);
  say(w, mod, '!event storm', now);
  assert.equal(w.builds.filter((b) => b.damaged).length, 2);
  assert.equal(say(w, alice, '!repair', now).ok, true);
  run(w, now, 25e3);
  assert.equal(w.builds.filter((b) => b.damaged).length, 1);
});

test('levels: XP levels you up, and hats unlock with levels', () => {
  const { w, events } = makeWorld();
  assert.match(say(w, alice, '!hat tophat', T0).message, /level 10/);
  w.grant('a', 30, T0);
  assert.ok(events.some((e) => e.type === 'level' && e.userId === 'a' && e.level === 2));
  assert.equal(say(w, alice, '!hat hardhat', T0 + 20e3).ok, true);
});

test('!me shows a card with level, home and buildings helped', () => {
  const { w, events } = makeWorld();
  const home = say(w, alice, '!home', T0).build;
  const now = finish(w, alice, 'campfire', T0);
  say(w, alice, '!me', now);
  const card = events.find((e) => e.type === 'me').card;
  assert.equal(card.name, 'alice');
  assert.equal(card.home.id, home.id);
  assert.equal(card.built, 1);
  assert.equal(card.founded, 1);
});

test('the merchant brings a fair gift, not a fortune', () => {
  const { w } = makeWorld();
  w.state.stock = { wood: 0, stone: 0, food: 0 };
  const gift = w.gift(0.1);
  const total = Object.values(gift).reduce((a, b) => a + b, 0);
  assert.ok(total > 0 && total <= 2 * 30);
});

// A town with a few buildings and chat around, and a Guild order due now.
function guildWorld() {
  const { w, events } = makeWorld();
  let now = T0;
  for (const [u, item] of [[alice, 'woodcutter'], [bob, 'quarry'], [carol, 'gatherer'], [alice, 'campfire'], [bob, 'stockpile']]) now = finish(w, u, item, now);
  rich(w);
  say(w, alice, '!me', now);
  w.state.nextContractAt = now;
  now = run(w, now, 10e3);
  return { w, events, now };
}

test('a Merchant Guild order: bots on !deliver haul for it, and the first town to fill it gets paid', () => {
  const { w, events, now: t0 } = guildWorld();
  const c = w.state.contract;
  assert.ok(c, 'an order is posted');
  assert.ok(['wood', 'stone', 'food'].includes(c.res), 'a good both towns know');
  assert.ok(events.some((e) => e.type === 'notice' && e.kind === 'guild' && /Merchant Guild wants/.test(e.text)));
  assert.equal(w.econ.plan[0].cmd, '!deliver', 'the plan says to deliver');
  w.state.stock[c.res] = 100;
  let now = t0;
  const res = say(w, alice, '!deliver 3', now);
  assert.equal(res.ok, true, res.message);
  assert.equal(w.state.jobs.a.kind, 'deliver');
  assert.equal(w.state.queues.a.length, 2, 'two more trips lined up');
  // One trip with stone tools (two crates) fills a twentieth of the order.
  const before = w.state.contract.town;
  now = run(w, now, 30e3);
  assert.ok(w.state.contract.town - before >= c.amount * 0.05 - 1e-6, 'a trip counts');
  const xp = w.state.builders.a.xp;
  const knowledge = w.state.knowledge;
  while (!w.state.contract.winner && now < t0 + 40 * 60e3) {
    for (const u of [alice, bob]) if (!w.state.jobs[u.id]) say(w, u, '!deliver 5', now);
    now = run(w, now, 30e3);
    for (const r of Object.keys(w.state.stock)) w.state.stock[r] = Math.max(w.state.stock[r], 60);
  }
  assert.equal(w.state.contract.winner, 'town');
  assert.equal(w.state.contracts.town, 1);
  assert.ok(Object.keys(w.state.contract.paid).length > 0, 'paid in goods');
  assert.ok(w.state.knowledge >= knowledge + 30, 'and some knowledge');
  assert.ok(w.state.builders.a.xp >= xp + 8, 'haulers earn XP');
  assert.equal(Object.values(w.state.jobs).some((j) => j.kind === 'deliver'), false, 'hauling stops');
  assert.ok(events.some((e) => e.type === 'notice' && e.kind === 'guild' && e.result === 'town'));
  // The order card goes away after a while, and the next one comes later.
  now = run(w, now, 120e3);
  assert.equal(w.state.contract, null);
  assert.ok(w.state.nextContractAt > now);
  assert.match(say(w, alice, '!deliver', now).message, /No Guild order right now/);
});

test('when chat does not haul, the rival fills the Guild order and chat gets its crates back', () => {
  const { w, events, now: t0 } = guildWorld();
  const c = w.state.contract;
  const before = w.state.rival.knowledge;
  let now = t0;
  while (!w.state.contract.winner && now < t0 + 40 * 60e3) {
    now = run(w, now, 30e3);
    for (const r of Object.keys(w.state.stock)) w.state.stock[r] = Math.max(w.state.stock[r], 60);
    for (const r of Object.keys(w.state.rival.stock)) w.state.rival.stock[r] = Math.max(w.state.rival.stock[r], 60);
  }
  assert.equal(w.state.contract.winner, 'rival');
  assert.ok(c.town > 0 && c.rival > c.town, 'the townsfolk hauled a little, the rival more');
  assert.equal(w.state.contracts.rival, 1);
  assert.ok(w.state.rival.knowledge > before + 30);
  assert.ok(events.some((e) => e.type === 'notice' && e.kind === 'guild' && e.result === 'rival' && /crates come back/.test(e.text)));
});

test('the Guild needs chat around, goods to deliver and the rival', () => {
  const { w } = makeWorld();
  let now = T0;
  for (const [u, item] of [[alice, 'woodcutter'], [bob, 'quarry'], [carol, 'gatherer'], [alice, 'campfire'], [bob, 'stockpile']]) now = finish(w, u, item, now);
  // Nobody has typed for an hour: no order, it waits.
  now += 3600e3;
  w.state.nextContractAt = now;
  now = run(w, now, 10e3);
  assert.equal(w.state.contract, null);
  assert.ok(w.state.nextContractAt > now);
  // Chat is back: the order comes, but nothing to deliver means a hint.
  say(w, alice, '!me', now);
  w.state.nextContractAt = now;
  now = run(w, now, 10e3);
  const c = w.state.contract;
  assert.ok(c);
  w.state.stock[c.res] = 0;
  assert.match(say(w, bob, '!deliver', now).message, /no .* to deliver\. Make some first/);
  // Moderators can call the next order right away.
  assert.equal(say(w, alice, '!deliver start', now).ok, false);
  w.state.contract.winner = 'none';
  w.state.contract.endedAt = now;
  assert.equal(say(w, mod, '!deliver start', now).ok, true);
  now = run(w, now, 10e3);
  assert.ok(w.state.contract && !w.state.contract.winner && w.state.contract.id === c.id + 1);
  // Without the rival there is no Guild.
  const solo = makeWorld({ limits: { rival: false } }).w;
  say(solo, alice, '!me', T0);
  solo.state.nextContractAt = T0;
  run(solo, T0, 60e3);
  assert.equal(solo.state.contract, null);
  assert.match(say(solo, alice, '!deliver', T0 + 60e3).message, /does not trade here/);
});

test('only moderators can remove builds or start events, and nobody can demolish town buildings', () => {
  const { w } = makeWorld();
  const b = say(w, alice, '!home', T0).build;
  run(w, T0, 60e3);
  assert.equal(say(w, bob, '!remove #' + b.id, T0).ok, false);
  assert.equal(say(w, bob, '!event festival', T0).ok, false);
  assert.equal(say(w, alice, '!demolish #' + b.id, T0).ok, false);
  assert.equal(say(w, mod, '!remove #' + b.id, T0 + 70e3).ok, true);
  assert.ok(!w.builds.some((x) => x.id === b.id));
});

test('refusals reach the screen at most once per cooldown', () => {
  const { w, events } = makeWorld();
  for (let i = 0; i < 5; i++) say(w, alice, '!build spaceship', T0 + i * 1000);
  assert.equal(events.filter((e) => e.type === 'notice').length, 1);
});

test('the town says what it needs and what to do next', () => {
  const { w } = makeWorld();
  w.state.stock.food = 0;
  w.economy(T0, 0);
  const food = w.econ.needs.find((n) => n.res === 'food');
  assert.ok(food);
  assert.ok(['gatherer', 'fisher'].includes(food.item));
  assert.equal(food.site, true);
  assert.equal(w.econ.plan[0].cmd, '!food');
  assert.ok(w.econ.plan.some((s) => s.cmd === '!build ' + food.item));
  rich(w);
  say(w, alice, '!build woodcutter', T0);
  w.economy(T0 + 5000, 5);
  assert.equal(w.econ.plan[0].kind, 'help');
  assert.equal(w.econ.projects.length, 1);
});

test('idle buildings point at what they wait for: a mine by coal, not more coal plants', () => {
  const { w } = makeWorld();
  w.state.era = 4;
  w.ensureWonder(T0);
  revealAll(w);
  let now = finish(w, alice, 'apartments', T0);
  now = finish(w, bob, 'apartments', now);
  now = finish(w, carol, 'coalplant', now);
  now = finish(w, alice, 'steelmill', now);
  now = finish(w, bob, 'factory', now);
  // The town's only mine digs iron, so nothing makes coal.
  const taken = new Set(w.builds.map((b) => hexKey(b.q, b.r)));
  const iron = w.map.tiles.find((t) => !taken.has(hexKey(t.q, t.r)) && t.d > 8 && M.siteOk(w.map, 'mine', t, w.known) && M.oresNear(w.map, t).join() === 'iron');
  w.builds.push({ id: ++w.state.seq, item: 'mine', project: true, level: 1, q: iron.q, r: iron.r, status: 'done', built: true, ores: ['iron'] });
  w.state.population = 64;
  w.state.stock.food = 200;
  w.state.stock.coal = 0;
  now = run(w, now, 2 * 60e3);
  const plant = w.builds.find((b) => b.item === 'coalplant');
  assert.deepEqual(w.starved[plant.id].goods, ['coal'], 'the coal plant stands idle');
  assert.ok(w.econ.power.supply < w.econ.power.demand, 'so the factory has no power');
  const coal = w.econ.needs.find((n) => n.res === 'coal');
  assert.ok(coal, 'the town needs coal: ' + JSON.stringify(w.econ.needs));
  assert.equal(coal.item, 'mine');
  assert.equal(coal.site, true);
  assert.equal(coal.where, 'a coal deposit');
  assert.ok(!w.econ.needs.some((n) => ['coalplant', 'steelmill', 'factory'].includes(n.item)), 'nothing that would stand idle too: ' + JSON.stringify(w.econ.needs));
  const cmds = w.econ.plan.map((st) => st.cmd);
  assert.ok(cmds.includes('!build mine'), cmds.join(', '));
  assert.ok(!cmds.some((c) => /coalplant|steelmill|factory/.test(c)), cmds.join(', '));
  const res = say(w, carol, '!build mine', now);
  assert.equal(res.ok, true, res.message);
  assert.ok(res.build.ores.includes('coal'), 'the new mine goes where it can dig coal: ' + res.build.ores);
});

test('a village has a few of each kind: past that, !build makes one bigger', () => {
  const { w } = makeWorld();
  let now = finish(w, alice, 'campfire', T0);
  rich(w);
  // One campfire is plenty for a town without homes: the next one is an upgrade.
  const more = say(w, bob, '!build campfire', now);
  assert.equal(more.ok, true, more.message);
  assert.match(more.message, /BotWorld has 1 campfires?, plenty for a town its size/);
  const fire = w.builds.find((b) => b.item === 'campfire');
  assert.equal(fire.upgrade?.level, 2);
  assert.equal(w.builds.filter((b) => b.item === 'campfire').length, 1);
  // Every one as big as it gets: a friendly no.
  Object.assign(fire, { level: 3, status: 'done', built: true });
  delete fire.upgrade;
  const no = say(w, carol, '!build campfire', now + 1000);
  assert.equal(no.ok, false);
  assert.match(no.message, /each as big as it gets/);
  // More homes make room for more.
  for (let i = 0; i < 8; i++) w.builds.push({ id: ++w.state.seq, item: 'hut', project: true, level: 1, q: 9, r: i - 4, status: 'done', built: true });
  assert.equal(w.crowded('campfire'), null);
});

test('town homes only while people need the room, and makers of a good the town is short of', () => {
  const { w } = makeWorld();
  let now = T0;
  for (let i = 0; i < 14; i++) { rich(w); say(w, { id: 'v' + i, name: 'v' + i }, '!home', now); now += 10; }
  now = run(w, now, 10 * 60e3);
  assert.ok(w.crowded('hut')?.room, 'fourteen homes have room for the Stone Age: ' + E.popCapacity(w.builds));
  const hut = say(w, alice, '!build hut', now);
  assert.equal(hut.ok, false);
  assert.match(hut.message, /roof over their head/);
  // Two quarries is the Stone Age limit for a small town...
  now = finish(w, alice, 'quarry', now);
  now = finish(w, bob, 'quarry', now);
  rich(w);
  w.economy(now, 0);
  assert.ok(w.crowded('quarry'));
  // ...unless the town runs out of stone.
  w.state.stock.stone = 0;
  w.economy(now, 0);
  assert.equal(w.crowded('quarry'), null);
});

test('outposts go out to rich land, and producers far from a store make less', () => {
  const { w } = makeWorld();
  revealAll(w);
  rich(w);
  const res = say(w, alice, '!build outpost', T0);
  assert.equal(res.ok, true, res.message);
  const o = res.build;
  assert.ok(hexDist(o.q, o.r) >= 6, 'an outpost is far from the pad');
  const north = say(w, bob, '!build outpost north', T0).build;
  assert.ok(M.angleOf(M.tileAt(w.map, north.q, north.r)) < -0.7, 'north is up the map');
  // A woodcutter far from any store works slower than one next to a store.
  const near = { item: 'woodcutter', q: o.q, r: o.r + 1, built: true, rich: 1, level: 1 };
  const far = { item: 'woodcutter', q: o.q + 9, r: o.r, built: true, rich: 1, level: 1 };
  const made = (b, stores) => {
    const stock = { wood: 0 };
    E.produce([b], stock, { employment: 1, happyFactor: 1, global: 1, powerRatio: 1, helpers: () => 0, boosts: {}, reach: (x) => reachOf(x, stores), progress: new Map(), fuel: new Map(), cap: 1000 }, 600);
    return stock.wood;
  };
  const stores = [{ q: 0, r: 0 }, o];
  assert.ok(made(near, stores) > made(far, stores) * 1.5);
  assert.ok(reachOf(far, stores) >= 0.4);
});

test('a rival AI town lives on the far side, builds by the same rules and keeps to its own land', () => {
  const { w, events } = makeWorld();
  const r = w.rival;
  assert.ok(r, 'the rival is on by default');
  const o = M.tileAt(w.map, r.s.origin.q, r.s.origin.r);
  assert.ok(o.d >= 24, 'far from the town');
  const off = Math.atan2(Math.sin(M.angleOf(o) - (w.map.seaAngle + Math.PI)), Math.cos(M.angleOf(o) - (w.map.seaAngle + Math.PI)));
  assert.ok(Math.abs(off) < 1, 'on the side away from the sea');
  // A day of the rival on its own.
  for (const k of Object.keys(r.s.stock)) r.s.stock[k] = 100;
  let now = run(w, T0, 864e5, 60e3);
  assert.ok(r.builds.filter((b) => !b.wonder).length >= 5, 'the rival builds');
  const town = w.ownLand();
  for (const b of r.builds) {
    const t = M.tileAt(w.map, b.q, b.r);
    if (!b.wonder) assert.ok(!town.has(t.i), 'never on the town\'s land');
  }
  assert.ok(events.some((e) => e.type === 'build' && e.build.rival));
  w.economy(now, 0);
  assert.equal(w.econ.race.rival.name, 'Cogsworth');
  assert.ok(w.econ.race.rival.progress.total > 0);
  assert.ok(w.econ.race.you.total >= 0);
  // The town never builds on the rival's land.
  revealAll(w);
  rich(w);
  const land = r.land();
  for (let i = 0; i < 3; i++) {
    const res = say(w, { id: 'x' + i, name: 'x' + i }, '!build outpost west', now);
    if (!res.ok) continue;
    assert.ok(!land.has(M.tileAt(w.map, res.build.q, res.build.r).i));
  }
  // Meeting them is news.
  assert.equal(r.s.met, false);
  w.checkMet([o]);
  assert.equal(r.s.met, true);
  assert.ok(events.some((e) => e.type === 'notice' && e.kind === 'rival' && /found Cogsworth/.test(e.text)));
});

test('the rival can be switched off', () => {
  const w = new World(freshState(T0, 1), { limits: { rival: false } });
  assert.equal(w.rival, null);
  w.economy(T0, 0);
  assert.equal(w.econ.race, null);
});

test('the rival plays a little slower than a small, active chat and leans towards a close race', () => {
  const { w } = makeWorld();
  const r = w.rival;
  // Level with chat it plays at its base pace: 75% at difficulty 1.
  assert.ok(Math.abs(r.speed() - 0.75) < 1e-9);
  // Chat an era ahead: it hurries (45% faster). Chat an era behind: it waits (35% slower).
  w.state.era = 1;
  assert.ok(Math.abs(r.speed() - 0.75 * 1.45) < 1e-9);
  w.state.era = 0;
  r.s.era = 1;
  assert.ok(Math.abs(r.speed() - 0.75 * 0.65) < 1e-9);
  // The difficulty scales it.
  const easy = new World(freshState(T0, 1), { limits: { rivalDifficulty: 0.5 } });
  assert.ok(Math.abs(easy.rival.speed() - 0.4) < 1e-9);
});

test('what the town is stuck on may start even when three projects are going', () => {
  const { w } = makeWorld();
  rich(w);
  for (const [u, item] of [[alice, 'hut'], [bob, 'campfire'], [carol, 'totem']]) assert.equal(say(w, u, '!build ' + item, T0).ok, true);
  w.state.stock.food = 0;
  w.economy(T0 + 5000, 5);
  const food = w.econ.needs.find((n) => n.res === 'food');
  assert.ok(food, 'the town is hungry');
  assert.ok(w.econ.plan.some((st) => st.cmd === '!build ' + food.item), 'the plan still says what to build');
  rich(w);
  w.state.stock.food = 0;
  assert.match(say(w, { id: 'd', name: 'dave' }, '!build stockpile', T0 + 6000).message, /3 projects are being built already/);
  const res = say(w, { id: 'e', name: 'erin' }, '!build ' + food.item, T0 + 6000);
  assert.equal(res.ok, true, res.message);
  assert.equal(res.build.urgent, true);
  assert.equal(w.projects().length, 4);
  assert.match(say(w, { id: 'f', name: 'finn' }, '!build ' + food.item, T0 + 6000).message, /4 projects are being built already/);
});

test('a full town makes room: old decor gives way, stores and homes stay', () => {
  const { w, events } = makeWorld();
  let now = finish(w, alice, 'campfire', T0);
  now = finish(w, bob, 'totem', now);
  now = finish(w, carol, 'stockpile', now);
  const fire = w.builds.find((b) => b.item === 'campfire');
  // No free land left anywhere.
  w.choosePlot = () => null;
  assert.equal(w.hasSite('hut'), true, 'decor can make way');
  rich(w);
  const res = say(w, { id: 'd', name: 'dave' }, '!build hut', now);
  assert.equal(res.ok, true, res.message);
  assert.equal(w.builds.some((b) => b.id === fire.id), false, 'the campfire made way');
  assert.deepEqual([res.build.q, res.build.r], [fire.q, fire.r]);
  assert.ok(events.some((e) => e.type === 'notice' && /old campfire .* makes way for a hut/.test(e.text)));
  // Decor only gives way to newer decor, stores never do, and only what the
  // town needs may take the place of decor (limits aside: a second store).
  w.crowded = () => null;
  const again = say(w, { id: 'e', name: 'erin' }, '!build campfire', now);
  assert.equal(again.ok, false);
  assert.match(again.message, /No free land left/);
  assert.equal(w.needed('stockpile'), false);
  w.happy = 50;
  assert.match(say(w, { id: 'f', name: 'finn' }, '!build stockpile', now).message, /No free land left|People want their parks/);
  assert.ok(w.builds.some((b) => b.item === 'totem') && w.builds.some((b) => b.item === 'stockpile'));
  // While people are content, decor makes way for anything.
  w.happy = 95;
  const store = say(w, { id: 'g', name: 'gina' }, '!build stockpile', now);
  assert.equal(store.ok, true, store.message);
  assert.equal(w.builds.some((b) => b.item === 'totem'), false);
});

test('what may make way: old decor first, spare producers of full goods, never food, stores or homes', () => {
  const b = (id, item, extra = {}) => ({ id, item, built: true, status: 'done', level: 1, ...extra });
  const builds = [b(1, 'campfire'), b(2, 'statue'), b(3, 'farm'), b(4, 'farm'), b(5, 'farm'), b(6, 'quarry'), b(7, 'quarry'), b(8, 'quarry'), b(9, 'kiln'), b(10, 'stockpile'), b(11, 'hut', { home: true })];
  const stock = { food: 1000, stone: 1000, bricks: 1000, wood: 10 };
  const need = E.spareScorer(builds, stock, 1000, ITEMS.steelmill, { need: true });
  const score = Object.fromEntries(builds.map((x) => [x.id, need(x)]));
  assert.ok(score[1] < score[2], 'a campfire goes before a statue');
  assert.ok(score[2] < score[6], 'decor goes before producers');
  assert.equal(score[3], null, 'food makers stay');
  assert.equal(score[9], null, 'the only kiln stays');
  assert.equal(score[10], null, 'stores stay');
  assert.equal(score[11], null, 'homes stay');
  // Without a need, decor gives way only while people are content, and
  // producers never; newer decor may always replace older decor.
  const unhappy = E.spareScorer(builds, stock, 1000, ITEMS.steelmill, { happy: 50 });
  assert.ok(builds.every((x) => unhappy(x) == null));
  const content = E.spareScorer(builds, stock, 1000, ITEMS.steelmill, { happy: 90 });
  assert.ok(content(builds[0]) != null && content(builds[5]) == null);
  const fountain = E.spareScorer(builds, stock, 1000, ITEMS.fountain, { happy: 50 });
  assert.ok(fountain(builds[0]) != null && fountain(builds[1]) == null);
});

test('a restart catches up on homes, and projects carry on', () => {
  const { w } = makeWorld();
  rich(w);
  const home = say(w, alice, '!home', T0).build;
  const p = say(w, bob, '!build campfire', T0).build;
  run(w, T0, 10e3);
  const revived = new World(JSON.parse(JSON.stringify(w.state)));
  revived.tick(T0 + 3_600_000);
  assert.equal(revived.builds.find((x) => x.id === home.id).status, 'done');
  run(revived, T0 + 3_600_000, 400e3);
  assert.equal(revived.builds.find((x) => x.id === p.id).status, 'done');
});

test('a save from before eras is migrated', () => {
  const old = { version: 1, createdAt: T0, seq: 2, builders: {}, builds: [
    { id: 1, item: 'house', level: 3, q: 1, r: -1, ownerId: 'a', status: 'done' },
    { id: 2, item: 'shop', level: 1, q: 2, r: -1, ownerId: 'a', status: 'building' },
  ] };
  const s = migrate(old, T0);
  assert.equal(s.version, 4);
  assert.deepEqual(s.builds.map((b) => b.item), ['hut', 'market']);
  assert.ok(s.builds.every((b) => b.built));
  const w = new World(s);
  assert.ok(w.builds.filter((b) => !b.wonder).every((b) => hexDist(b.q, b.r) >= 2), 'moved off the wonder ring');
  assert.equal(w.homeOf('a').item, 'hut');
  assert.equal(w.builds.find((b) => b.item === 'market').project, true);
});

test('a save from before the big world keeps its buildings on cleared land', () => {
  const v2 = { version: 2, createdAt: T0, seq: 3, era: 0, builders: { a: { id: 'a', name: 'alice' } }, stock: { wood: 5, stone: 5, food: 5 }, builds: [
    { id: 1, item: 'hut', level: 1, q: 3, r: 0, ownerId: 'a', status: 'done', built: true },
    { id: 2, item: 'hut', level: 1, q: 4, r: 0, ownerId: 'a', status: 'done', built: true },
    { id: 3, item: 'woodcutter', level: 1, q: 9, r: -4, ownerId: 'a', status: 'done', built: true },
  ] };
  const w = new World(migrate(v2, T0));
  assert.equal(w.state.version, 4);
  assert.equal(w.homeOf('a').id, 1);
  assert.equal(w.builds.find((b) => b.id === 2).project, true);
  for (const b of w.builds.filter((x) => !x.wonder)) {
    const t = M.tileAt(w.map, b.q, b.r);
    assert.equal(t.t, 'grass');
    assert.ok(w.known(t));
  }
});

test('names are cleaned before they reach the screen', () => {
  const { w } = makeWorld();
  say(w, { id: 'z', name: 'evil\u0007name\nthat is way too long for a nametag' }, '!home', T0);
  const name = w.state.builders.z.name;
  assert.ok(!/[\u0000-\u001f]/.test(name));
  assert.ok(name.length <= 25);
});

test('the snapshot carries the map, the explored land and the era history', () => {
  const { w } = makeWorld();
  const snap = w.snapshot(T0);
  assert.deepEqual(snap.eraHistory, [{ era: 0, at: T0 }]);
  assert.equal(snap.finished, false);
  assert.equal(snap.map.seed, 1);
  assert.equal(snap.explored, w.state.explored);
  assert.ok(JSON.stringify(snap).length < 20000);
});

test('ERAS still line up with houses and wonders', () => {
  ERAS.forEach((e, i) => {
    assert.equal(ITEMS[e.house].kind, 'house');
    assert.equal(ITEMS[e.house].era, i);
    // Two wonders from different places that need the very same goods.
    const [a, b] = e.wonders;
    assert.ok(ITEMS[a].kind === 'wonder' && ITEMS[b].kind === 'wonder' && ITEMS[a].era === i && ITEMS[b].era === i);
    assert.notEqual(ITEMS[a].place + ITEMS[a].label, ITEMS[b].place + ITEMS[b].label);
    assert.deepEqual(ITEMS[a].needs, ITEMS[b].needs);
  });
  // Nothing needs a good from a later era, and buildings only grow into later ones.
  for (const [k, it] of Object.entries(ITEMS)) {
    const goods = [it.cost, it.needs, it.recipe?.in, it.recipe?.out].flatMap((o) => Object.keys(o || {}));
    for (const r of goods) assert.ok(RESOURCES[r].era <= it.era, k + ' uses ' + r);
    if (it.evolve) assert.ok(ITEMS[it.evolve].era > it.era, k + ' evolves back');
  }
  for (const [r, info] of Object.entries(RESOURCES)) assert.equal(ITEMS[info.from].era, info.era, r);
});

test('chat votes for the wonder, and the rival builds the other one', () => {
  const { w, events } = makeWorld();
  assert.equal(w.state.vote, null, 'nobody around, no vote');
  say(w, alice, '!wood', T0);
  w.tick(T0 + 1000);
  const v = w.state.vote;
  assert.equal(v.kind, 'wonder');
  assert.deepEqual(v.options, ['stonehenge', 'moai']);
  assert.ok(events.some((e) => e.type === 'notice' && e.kind === 'wondervote' && /!vote 1 Stonehenge/.test(e.text)));
  assert.equal(say(w, alice, '!vote 3', T0 + 2000).ok, false);
  assert.equal(say(w, alice, '!vote 2', T0 + 2000).ok, true);
  assert.equal(say(w, bob, '!2', T0 + 3000).ok, true);
  assert.equal(say(w, carol, '!1', T0 + 4000).ok, true);
  assert.deepEqual(w.voteView().counts, [1, 2]);
  w.tick(T0 + 301e3);
  assert.equal(w.state.vote, null);
  assert.equal(w.state.picks[0], 'moai');
  const mine = w.currentWonder();
  assert.equal(mine.item, 'moai');
  assert.ok(!mine.pending);
  const theirs = w.rival.currentWonder();
  assert.equal(theirs.item, 'stonehenge');
  assert.ok(!theirs.pending);
  assert.ok(events.some((e) => e.type === 'notice' && e.kind === 'wonderpick' && e.item === 'moai' && /Chat chose the Moai for the Stone Age! Cogsworth builds Stonehenge\./.test(e.text)));
  // Event votes come back later, with three choices.
  assert.equal(say(w, mod, '!vote start', T0 + 302e3).ok, true);
  assert.equal(w.state.vote.kind, 'event');
  assert.equal(w.state.vote.options.length, 3);
});

test('when the rival reaches an era first, chat chooses for both before getting there', () => {
  const { w } = makeWorld();
  w.pickWonder(0, 'stonehenge', T0);
  const rv = w.rival;
  rv.ensureWonder(T0);
  // The rival finishes its Stone Age.
  rv.s.knowledge = w.knowledgeNeed();
  rv.s.population = 500;
  rv.currentWonder().delivered = { ...ITEMS.moai.needs };
  rv.currentWonder().status = 'done';
  rv.checkEra(T0);
  assert.equal(rv.s.era, 1);
  assert.equal(rv.currentWonder().pending, true);
  say(w, alice, '!wood', T0);
  w.tick(T0 + 1000);
  assert.equal(w.state.vote.kind, 'wonder');
  assert.equal(w.state.vote.era, 1);
  say(w, alice, '!vote 2', T0 + 2000);
  w.tick(T0 + 302e3);
  assert.equal(w.state.picks[1], 'ziggurat');
  assert.equal(rv.currentWonder().item, 'pyramid');
  // The town gets there later and starts its wonder right away.
  w.state.era = 1;
  const mine = w.ensureWonder(T0 + 400e3);
  assert.equal(mine.item, 'ziggurat');
  assert.ok(!mine.pending);
});

test('the Future\'s wonder rises behind the pad, and what stood there moves', () => {
  const { w } = makeWorld();
  rich(w);
  const hut = say(w, alice, '!home', T0).build;
  hut.q = -1;
  hut.r = -1;
  w.state.era = 6;
  const wonder = w.ensureWonder(T0);
  assert.deepEqual([wonder.q, wonder.r], [-1, -1]);
  assert.ok(hut.q !== -1 || hut.r !== -1, 'the home moved away');
  assert.ok(w.builds.includes(hut));
});

test('a save from before the eras of history moves to its new era and wonders', () => {
  const v3 = freshState(T0, 1);
  v3.version = 3;
  delete v3.picks;
  Object.assign(v3, { era: 2, eraHistory: [{ era: 0, at: T0 }, { era: 1, at: T0 + 1 }, { era: 2, at: T0 + 2 }] });
  v3.builds = [
    { id: 1, item: 'stonecircle', wonder: true, q: -1, r: 1, status: 'done', built: true, delivered: {} },
    { id: 2, item: 'greathall', wonder: true, q: 0, r: 1, status: 'done', built: true, delivered: {} },
    { id: 3, item: 'cathedral', wonder: true, q: 1, r: 0, status: 'building', built: false, delivered: { stone: 10 } },
    { id: 4, item: 'cottage', home: true, ownerId: 'a', q: 3, r: 0, status: 'done', built: true, level: 1 },
    { id: 5, item: 'barn', project: true, q: 4, r: 0, status: 'done', built: true, level: 1 },
  ];
  v3.builders = { a: { id: 'a', name: 'alice' } };
  v3.rival = freshRivalFor(v3);
  const s = migrate(v3, T0);
  assert.equal(s.version, 4);
  assert.equal(s.era, 3);
  assert.deepEqual(s.eraHistory.map((h) => h.era), [0, 1, 3]);
  assert.deepEqual(s.builds.map((b) => b.item), ['stonehenge', 'pyramid', 'notredame', 'mudhouse', 'granary']);
  assert.deepEqual(s.picks, { 0: 'stonehenge', 1: 'pyramid', 3: 'notredame' });
  const nd = s.builds.find((b) => b.item === 'notredame');
  assert.deepEqual([nd.q, nd.r], [1, -1]);
  assert.equal(s.rival.era, 3);
  assert.equal(s.rival.builds.find((b) => b.wonder).item, 'angkorwat');
  const w = new World(s);
  assert.equal(w.currentWonder().item, 'notredame');
  assert.equal(w.state.era, 3);
  // The Roman Empire it skipped is behind it: no vote for its wonder.
  assert.equal(w.wonderPickDue(), null);
});

test('a wonder finished during its vote goes to the votes already cast', () => {
  const { w } = makeWorld();
  w.state.era = 1;
  w.ensureWonder(T0);
  w.startWonderVote(1, T0);
  say(w, alice, '!vote 2', T0 + 1000);
  say(w, bob, '!vote 2', T0 + 2000);
  w.autoPick(1, T0 + 3000);
  assert.equal(w.state.picks[1], 'ziggurat');
  assert.equal(w.state.vote, null);
});

test('hungry people stay on the list when power is short, with a maker that needs none', () => {
  const { w } = makeWorld();
  w.state.era = 5;
  w.ensureWonder(T0);
  revealAll(w);
  let now = finish(w, alice, 'skyscraper', T0);
  now = finish(w, bob, 'factory', now);
  w.state.population = 20;
  w.state.stock.food = 0;
  w.economy(now, 0);
  assert.ok(w.econ.power.demand > w.econ.power.supply, 'power is short');
  const food = w.econ.needs.find((n) => n.res === 'food');
  assert.ok(food, JSON.stringify(w.econ.needs));
  assert.equal(food.why, 'hungry');
  assert.ok(!(ITEMS[food.item].power < 0), 'a food maker that works without power: ' + food.item);
  assert.ok(w.econ.plan.some((st) => st.cmd === '!food'), 'and chat can pick some by hand');
});

test('the rival only wins the race when it finishes before BotWorld', () => {
  const { w, events } = makeWorld();
  const rv = w.rival;
  const s = rv.s;
  s.era = ERAS.length - 1;
  rv.ensureWonder(T0);
  const wonder = rv.currentWonder();
  wonder.status = 'done';
  wonder.built = true;
  s.knowledge = w.knowledgeNeed();
  s.population = ERAS[s.era].popGoal;
  w.state.finished = true;
  w.state.finishedAt = T0;
  rv.checkEra(T0 + 1000);
  const note = events.filter((e) => e.type === 'notice' && e.kind === 'rival').pop();
  assert.ok(s.finished);
  assert.match(note.text, /too, after BotWorld/);
  assert.doesNotMatch(note.text, /won the race/);
});

test('goods of a later era say when they arrive', () => {
  const { w } = makeWorld();
  rich(w);
  assert.equal(say(w, alice, '!work bricks', T0).message, 'Bricks arrives in Ancient Egypt.');
});
