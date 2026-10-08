import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, freshState, migrate } from '../server/world.js';
import { hexDist, hexKey } from '../public/shared/hex.js';
import { ITEMS, ERAS } from '../public/shared/catalog.js';

const T0 = Date.UTC(2026, 9, 8, 12);
const alice = { id: 'a', name: 'alice' };
const bob = { id: 'b', name: 'bob' };

function makeWorld(opts = {}) {
  const w = new World(freshState(T0), opts);
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
// Gives the village whatever it needs, for tests about other things.
const rich = (w) => { for (const r of ['wood', 'stone', 'food', 'bricks', 'coal', 'iron', 'steel', 'parts', 'chips']) w.state.stock[r] = 100; };

test('a fresh island starts in the Stone Age with goods and a wonder site', () => {
  const { w } = makeWorld();
  assert.equal(w.state.era, 0);
  assert.ok(w.state.stock.wood > 0 && w.state.stock.stone > 0);
  const wonder = w.builds.find((b) => b.wonder);
  assert.equal(wonder.item, 'stonecircle');
  assert.equal(hexDist(wonder.q, wonder.r), 1);
});

test('"!build house" builds the house of the current era, pays, and finishes on time', () => {
  const { w } = makeWorld();
  const wood = w.state.stock.wood;
  const b = say(w, alice, '!build house', T0).build;
  assert.equal(b.item, 'hut');
  assert.equal(b.status, 'building');
  assert.equal(w.state.stock.wood, wood - ITEMS.hut.cost.wood);
  w.tick(T0 + (b.walkSec + b.buildSec) * 1000 - 1);
  assert.equal(b.status, 'building');
  w.tick(T0 + (b.walkSec + b.buildSec) * 1000);
  assert.equal(b.status, 'done');
  assert.equal(b.built, true);
});

test('buildings from later eras are explained, not built', () => {
  const { w } = makeWorld();
  const res = say(w, alice, '!build factory', T0);
  assert.equal(res.ok, false);
  assert.match(res.message, /Industrial Age/);
});

test('a build waits for missing goods and starts when they arrive', () => {
  const { w } = makeWorld();
  w.state.stock.wood = 0;
  const b = say(w, alice, '!build hut', T0).build;
  assert.equal(b.status, 'queued');
  assert.deepEqual(b.waitingFor, ['wood']);
  w.state.stock.wood = 50;
  w.tick(T0 + 1000);
  assert.equal(b.status, 'building');
});

test('one build at a time per viewer, and slots grow with level and era', () => {
  const { w } = makeWorld();
  rich(w);
  assert.equal(say(w, alice, '!build hut', T0).ok, true);
  assert.match(say(w, alice, '!build hut', T0 + 1).message, /still busy/);
  assert.equal(w.slotsOf('a'), 3 + 1);
  w.state.era = 2;
  assert.equal(w.slotsOf('a'), 3 + 1 + 4);
});

test('no plot is ever shared, the pad and the wonder ring stay free', () => {
  const { w } = makeWorld({ limits: { maxBuildsPerUser: 100, maxConcurrentBuilds: 100, maxQueue: 1000 } });
  const items = ['hut', 'woodcutter', 'fisher', 'totem', 'quarry', 'campfire', 'stockpile'];
  let now = T0;
  for (let i = 0; i < 150; i++) {
    rich(w);
    const res = say(w, { id: 'u' + (i % 20), name: 'u' }, '!build ' + items[i % items.length], now);
    if (!res.ok) now = run(w, now, 120e3, 30e3);
    now += 10;
  }
  const normal = w.builds.filter((b) => !b.wonder);
  const keys = normal.map((b) => hexKey(b.q, b.r));
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(normal.every((b) => hexDist(b.q, b.r) >= 2));
  assert.ok(normal.length >= 100);
});

test('people move in, work, and producers make goods up to the storage limit', () => {
  const { w } = makeWorld();
  rich(w);
  let now = T0;
  for (const [u, item] of [[alice, 'hut'], [bob, 'woodcutter'], [{ id: 'c', name: 'c' }, 'hut'], [{ id: 'd', name: 'd' }, 'gatherer']]) say(w, u, '!build ' + item, now);
  now = run(w, now, 60e3);
  w.state.stock.wood = 10;
  now = run(w, now, 20 * 60e3);
  assert.ok(w.state.population >= 7, 'population ' + w.state.population);
  assert.ok(w.state.stock.wood > 10, 'wood ' + w.state.stock.wood);
  now = run(w, now, 6 * 3600e3, 30e3);
  assert.equal(Math.round(w.state.stock.wood), w.econ.cap);
});

test('a kiln turns stone and wood into bricks, and stalls without them', () => {
  const { w } = makeWorld();
  w.state.era = 1;
  w.ensureWonder(T0);
  rich(w);
  say(w, alice, '!build kiln', T0);
  say(w, bob, '!build cottage', T0);
  let now = run(w, T0, 90e3);
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
  const { w } = makeWorld({ limits: { maxBuildsPerUser: 30 } });
  w.state.era = 3;
  w.ensureWonder(T0);
  let now = T0;
  for (const [u, item] of [[alice, 'factory'], [bob, 'apartments'], [{ id: 'c', name: 'c' }, 'apartments'], [{ id: 'e', name: 'e' }, 'warehouse']]) {
    rich(w);
    say(w, u, '!build ' + item, now);
  }
  now = run(w, now, 3 * 60e3);
  rich(w);
  w.state.population = 48;
  const parts = w.state.stock.parts;
  now = run(w, now, 5 * 60e3);
  assert.ok(w.state.stock.parts <= parts + 0.01, 'no power, no parts');
  rich(w);
  say(w, { id: 'd', name: 'd' }, '!build coalplant', now);
  now = run(w, now, 3 * 60e3);
  rich(w);
  w.state.population = 48;
  const before = w.state.stock.parts;
  now = run(w, now, 5 * 60e3);
  assert.ok(w.econ.power.supply >= 20);
  assert.ok(w.state.stock.parts > before, 'powered factory makes parts');
});

test('parks next to homes make people happier', () => {
  const { w } = makeWorld();
  rich(w);
  let now = T0;
  say(w, alice, '!build hut', now);
  now = run(w, now, 60e3);
  const bare = w.econ.happy;
  rich(w);
  say(w, bob, '!build totem near hut', now);
  say(w, { id: 'c', name: 'c' }, '!build campfire near hut', now);
  now = run(w, now, 120e3);
  assert.ok(w.econ.happy > bare, bare + ' -> ' + w.econ.happy);
});

test('!work sends your bot to help, speeds things up and pays XP', () => {
  const { w, events } = makeWorld();
  rich(w);
  say(w, alice, '!build woodcutter', T0);
  let now = run(w, T0, 60e3);
  const res = say(w, alice, '!work wood', now);
  assert.equal(res.ok, true);
  const job = w.state.jobs.a;
  assert.equal(job.kind, 'work');
  assert.equal(w.builds.find((b) => b.id === job.buildId).item, 'woodcutter');
  assert.equal(say(w, alice, '!work stone', now).ok, false);
  const xp = w.state.builders.a.xp;
  now = run(w, now, 11 * 60e3);
  assert.equal(w.state.jobs.a, undefined);
  assert.ok(w.state.builders.a.xp > xp);
  assert.ok(events.some((e) => e.type === 'job' && e.job === null));
});

test('!work explains what to build when nothing makes that resource', () => {
  const { w } = makeWorld();
  say(w, alice, '!build hut', T0);
  run(w, T0, 60e3);
  assert.match(say(w, alice, '!work stone', T0 + 61e3).message, /Build a quarry/);
});

test('the wonder fills up, and the era changes when wonder, people and knowledge are ready', () => {
  const { w, events } = makeWorld({ pace: { eraDays: 0.02 } });
  rich(w);
  let now = T0;
  for (let i = 0; i < 8; i++) {
    rich(w);
    say(w, { id: 'h' + i, name: 'h' + i }, '!build hut', now);
  }
  now = run(w, now, 60e3);
  for (let i = 0; i < 40; i++) {
    for (const r of ['wood', 'stone', 'food']) w.state.stock[r] = 100;
    now = run(w, now, 60e3);
  }
  const wonder = w.builds.find((b) => b.item === 'stonecircle');
  assert.equal(wonder.status, 'done');
  assert.ok(w.state.population >= ERAS[0].popGoal);
  assert.equal(w.state.era, 1);
  assert.ok(events.some((e) => e.type === 'era' && e.era === 1));
  assert.ok(w.builds.some((b) => b.item === 'greathall' && b.wonder));
});

test('!upgrade turns an old hut into the home of the current era', () => {
  const { w } = makeWorld();
  rich(w);
  say(w, alice, '!build hut', T0);
  let now = run(w, T0, 60e3);
  assert.match(say(w, alice, '!upgrade', now).message, /newest kind/);
  w.state.era = 1;
  rich(w);
  const res = say(w, alice, '!upgrade', now + 30e3);
  assert.equal(res.ok, true);
  assert.equal(res.build.upgrade.item, 'cottage');
  now = run(w, now, 120e3);
  assert.equal(res.build.item, 'cottage');
  assert.equal(res.build.upgrade, undefined);
});

test('votes start when chat is around, and the winner happens', () => {
  const { w, events } = makeWorld();
  rich(w);
  say(w, alice, '!build hut', T0);
  say(w, bob, '!build hut', T0);
  let now = run(w, T0, 21 * 60e3, 30e3);
  assert.ok(w.state.vote, 'a vote started');
  say(w, alice, '!vote 2', now);
  say(w, bob, '!vote 2', now);
  assert.deepEqual(w.voteView().counts, [0, 2, 0]);
  const winner = w.state.vote.options[1];
  now = run(w, now, 4 * 60e3);
  assert.equal(w.state.vote, null);
  assert.ok(events.some((e) => e.type === 'vote' && e.winner === winner));
  assert.ok(events.some((e) => e.type === 'event' && e.event && e.event.key === winner));
});

test('a storm breaks buildings and !repair fixes them', () => {
  const { w } = makeWorld();
  rich(w);
  say(w, alice, '!build hut', T0);
  say(w, bob, '!build woodcutter', T0);
  let now = run(w, T0, 60e3);
  say(w, { id: 'm', name: 'mod', mod: true }, '!event storm', now);
  const broken = w.builds.filter((b) => b.damaged);
  assert.equal(broken.length, 2);
  assert.equal(say(w, alice, '!repair', now).ok, true);
  now = run(w, now, 25e3);
  assert.equal(w.builds.filter((b) => b.damaged).length, 1);
});

test('levels: XP levels you up, and hats unlock with levels', () => {
  const { w, events } = makeWorld();
  rich(w);
  say(w, alice, '!build hut', T0);
  run(w, T0, 60e3);
  assert.match(say(w, alice, '!hat tophat', T0 + 61e3).message, /level 10/);
  w.grant('a', 30, T0);
  assert.ok(events.some((e) => e.type === 'level' && e.userId === 'a' && e.level === 2));
  assert.equal(say(w, alice, '!hat hardhat', T0 + 62e3).ok, true);
});

test('!me shows a card with level and buildings', () => {
  const { w, events } = makeWorld();
  rich(w);
  say(w, alice, '!build hut', T0);
  run(w, T0, 60e3);
  say(w, alice, '!me', T0 + 61e3);
  const card = events.find((e) => e.type === 'me').card;
  assert.equal(card.name, 'alice');
  assert.equal(card.buildings, 1);
  assert.equal(card.level, 1);
});

test('the merchant brings a fair gift, not a fortune', () => {
  const { w } = makeWorld();
  w.state.stock = { wood: 0, stone: 0, food: 0 };
  const gift = w.merchantGift();
  const total = Object.values(gift).reduce((a, b) => a + b, 0);
  assert.ok(total > 0 && total <= 2 * 30);
});

test('only moderators can remove builds or start events; owners can demolish', () => {
  const { w } = makeWorld();
  rich(w);
  const b = say(w, alice, '!build hut', T0).build;
  run(w, T0, 60e3);
  assert.equal(say(w, bob, '!remove #' + b.id, T0).ok, false);
  assert.equal(say(w, bob, '!event festival', T0).ok, false);
  assert.equal(say(w, bob, '!demolish #' + b.id, T0).ok, false);
  assert.equal(say(w, alice, '!demolish #' + b.id, T0 + 70e3).ok, true);
  assert.ok(!w.builds.some((x) => x.id === b.id));
});

test('refusals reach the screen at most once per cooldown', () => {
  const { w, events } = makeWorld();
  for (let i = 0; i < 5; i++) say(w, alice, '!build spaceship', T0 + i * 1000);
  assert.equal(events.filter((e) => e.type === 'notice').length, 1);
});

test('the village says what it needs, with the building that helps', () => {
  const { w } = makeWorld();
  w.state.stock.food = 0;
  w.economy(T0, 0);
  const food = w.econ.needs.find((n) => n.res === 'food');
  assert.ok(food);
  assert.ok(['gatherer', 'fisher'].includes(food.item));
});

test('a restart catches up on builds that finished while offline', () => {
  const { w } = makeWorld();
  const b = say(w, alice, '!build hut', T0).build;
  const revived = new World(JSON.parse(JSON.stringify(w.state)));
  revived.tick(T0 + 3_600_000);
  assert.equal(revived.builds.find((x) => x.id === b.id).status, 'done');
});

test('a save from before eras is migrated', () => {
  const old = { version: 1, createdAt: T0, seq: 2, builders: {}, builds: [
    { id: 1, item: 'house', level: 3, q: 1, r: -1, ownerId: 'a', status: 'done' },
    { id: 2, item: 'shop', level: 1, q: 2, r: -1, ownerId: 'a', status: 'building' },
  ] };
  const s = migrate(old, T0);
  assert.equal(s.version, 2);
  assert.deepEqual(s.builds.map((b) => b.item), ['hut', 'market']);
  assert.ok(s.builds.every((b) => b.built));
  const w = new World(s);
  assert.ok(w.builds.filter((b) => !b.wonder).every((b) => hexDist(b.q, b.r) >= 2), 'moved off the wonder ring');
});

test('names are cleaned before they reach the screen', () => {
  const { w } = makeWorld();
  say(w, { id: 'z', name: 'evil\u0007name\nthat is way too long for a nametag' }, '!build hut', T0);
  const name = w.state.builders.z.name;
  assert.ok(!/[\u0000-\u001f]/.test(name));
  assert.ok(name.length <= 25);
});

test('moderators can start a vote right away with !vote start', () => {
  const { w } = makeWorld();
  assert.equal(say(w, alice, '!vote start', T0).ok, false);
  assert.equal(w.state.vote, null);
  const res = say(w, { id: 'm', name: 'mod', mod: true }, '!vote start', T0);
  assert.equal(res.ok, true);
  assert.equal(w.state.vote.options.length, 3);
  assert.equal(say(w, { id: 'm', name: 'mod', mod: true }, '!vote start', T0 + 1000).ok, false);
});

test('the snapshot carries the era history for the timelapse', () => {
  const { w } = makeWorld();
  const snap = w.snapshot(T0);
  assert.deepEqual(snap.eraHistory, [{ era: 0, at: T0 }]);
  assert.equal(snap.finished, false);
});
