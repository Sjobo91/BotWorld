import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, freshState, migrate, LABOR, TOWN_CREW } from '../server/world.js';
import { hexDist, hexKey } from '../public/shared/hex.js';
import { ITEMS, ERAS } from '../public/shared/catalog.js';
import * as M from '../public/shared/terrain.js';

const T0 = Date.UTC(2026, 9, 8, 12);
const alice = { id: 'a', name: 'alice' };
const bob = { id: 'b', name: 'bob' };
const carol = { id: 'c', name: 'carol' };
const mod = { id: 'm', name: 'mod', mod: true };

function makeWorld(opts = {}) {
  const w = new World(freshState(T0, 1), opts);
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
  assert.equal(wonder.item, 'stonecircle');
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
  assert.match(res.message, /Industrial Age/);
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
  w.state.era = 2;
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
  assert.match(say(w, alice, '!explore', T0 + 1000).message, /already out exploring/);
  run(w, T0, job.until - T0 + 2000, 1000);
  assert.equal(w.state.jobs.a, undefined);
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
  const items = ['woodcutter', 'quarry', 'gatherer', 'fisher', 'campfire', 'stockpile', 'totem', 'hut'];
  for (let i = 0; i < 40; i++) {
    now = finish(w, { id: 'p' + i, name: 'p' + i }, items[i % items.length], now);
  }
  const normal = w.builds.filter((b) => !b.wonder);
  const keys = normal.map((b) => hexKey(b.q, b.r));
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(normal.every((b) => hexDist(b.q, b.r) >= 2));
  for (const b of normal) assert.ok(M.siteOk(w.map, b.item, M.tileAt(w.map, b.q, b.r)), b.item + ' on ' + M.tileAt(w.map, b.q, b.r).t);
  assert.ok(normal.length >= 70);
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
  assert.equal(Math.round(w.state.stock.wood), w.econ.cap);
});

test('a kiln turns stone and wood into bricks, and stalls without them', () => {
  const { w } = makeWorld();
  w.state.era = 1;
  w.ensureWonder(T0);
  let now = finish(w, bob, 'cottage', T0);
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
  w.state.era = 3;
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
  assert.equal(say(w, alice, '!work steel', now).ok, false);
  const xp = w.state.builders.a.xp;
  run(w, now, 11 * 60e3);
  assert.equal(w.state.jobs.a, undefined);
  assert.ok(w.state.builders.a.xp > xp);
  assert.ok(events.some((e) => e.type === 'job' && e.job === null));
});

test('!wood sends your bot into a forest, and it brings wood to town', () => {
  const { w, events } = makeWorld();
  w.state.stock.wood = 10;
  const res = say(w, alice, '!wood', T0);
  assert.equal(res.ok, true, res.message);
  assert.match(res.message, /cut wood in a forest/);
  const job = w.state.jobs.a;
  assert.equal(job.kind, 'hand');
  assert.equal(job.res, 'wood');
  const t = M.tileAt(w.map, job.q, job.r);
  assert.equal(t.t, 'forest');
  assert.ok(M.isExplored(w.bits, t.i));
  assert.ok(events.some((e) => e.type === 'job' && e.job?.kind === 'hand'));
  const xp = w.state.builders.a.xp;
  run(w, T0, 70e3);
  assert.equal(w.state.stock.wood, 10 + M.HAND_LOAD);
  run(w, T0 + 70e3, 11 * 60e3);
  // One load a minute in, then one every two minutes until the job ends.
  const loads = 1 + Math.floor((10 * 60 - M.HAND_FIRST_SEC) / M.HAND_TRIP_SEC);
  assert.equal(w.state.stock.wood, 10 + loads * M.HAND_LOAD);
  assert.equal(w.state.builders.a.gathered, loads * M.HAND_LOAD);
  assert.equal(w.state.jobs.a, undefined);
  assert.ok(w.state.builders.a.xp > xp);
});

test('gathering by hand needs known land, the right era and room in storage', () => {
  const { w } = makeWorld();
  assert.match(say(w, alice, '!coal', T0).message, /Medieval Town/);
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
  const wonder = w.builds.find((b) => b.item === 'stonecircle');
  assert.equal(wonder.status, 'done');
  assert.equal(w.state.era, 1);
  assert.ok(events.some((e) => e.type === 'era' && e.era === 1));
  assert.ok(w.builds.some((b) => b.item === 'greathall' && b.wonder));
  now = run(w, now, 120e3);
  assert.equal(home.item, 'cottage');
  assert.ok(w.builds.filter((b) => b.project && ITEMS[b.item].kind === 'house').every((b) => b.item === 'cottage'));
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
  assert.equal(s.version, 3);
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
  assert.equal(w.state.version, 3);
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
  for (const e of ERAS) {
    assert.equal(ITEMS[e.house].kind, 'house');
    assert.equal(ITEMS[e.wonder].kind, 'wonder');
  }
});
