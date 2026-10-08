import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, freshState } from '../server/world.js';
import { hexDist, hexKey } from '../public/shared/hex.js';

const T0 = 1_800_000_000_000;
const alice = { id: 'a', name: 'alice' };
const bob = { id: 'b', name: 'bob' };

function makeWorld(limits) {
  const w = new World(freshState(T0), { limits });
  const events = [];
  w.on((e) => events.push(e));
  return { w, events };
}

function finishAll(w, from) {
  let now = from;
  for (let i = 0; i < 200 && w.builds.some((b) => b.status !== 'done'); i++) {
    now += 5000;
    w.tick(now);
  }
  return now;
}

test('a build is queued, started, and finished on time', () => {
  const { w, events } = makeWorld();
  const res = w.handleChat(alice, '!build red house', T0);
  assert.equal(res.ok, true);
  const b = res.build;
  assert.equal(b.status, 'building');
  assert.equal(b.color, 'red');
  assert.notDeepEqual([b.q, b.r], [0, 0]);
  assert.ok(events.some((e) => e.type === 'builder' && e.joined));
  w.tick(T0 + (b.walkSec + b.buildSec) * 1000 - 1);
  assert.equal(b.status, 'building');
  w.tick(T0 + (b.walkSec + b.buildSec) * 1000);
  assert.equal(b.status, 'done');
  assert.equal(w.dirty, true);
});

test('one build at a time per viewer', () => {
  const { w } = makeWorld();
  assert.equal(w.handleChat(alice, '!build house', T0).ok, true);
  const second = w.handleChat(alice, '!build tower', T0 + 1000);
  assert.equal(second.ok, false);
  assert.match(second.message, /still busy/);
  assert.equal(w.handleChat(bob, '!build tower', T0 + 1000).ok, true);
});

test('the per-viewer limit points at !upgrade', () => {
  const { w } = makeWorld({ maxBuildsPerUser: 2 });
  let now = T0;
  for (let i = 0; i < 2; i++) {
    assert.equal(w.handleChat(alice, '!build park', now).ok, true);
    now = finishAll(w, now);
  }
  const res = w.handleChat(alice, '!build park', now);
  assert.equal(res.ok, false);
  assert.match(res.message, /!upgrade/);
});

test('no two builds ever share a plot, and none uses the landing pad', () => {
  const { w } = makeWorld({ maxBuildsPerUser: 100, maxConcurrentBuilds: 100, maxQueue: 1000 });
  const items = ['house', 'farm', 'lighthouse', 'fountain', 'tower', 'campfire'];
  let now = T0;
  for (let i = 0; i < 120; i++) {
    const res = w.handleChat({ id: 'u' + (i % 15), name: 'u' + i }, '!build ' + items[i % items.length], now);
    if (!res.ok) now = finishAll(w, now);
    now += 10;
  }
  const keys = w.builds.map((b) => hexKey(b.q, b.r));
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(!keys.includes(hexKey(0, 0)));
  assert.ok(w.builds.length >= 100);
});

test('inner items stay near the middle, coast items go to the edge', () => {
  const { w } = makeWorld({ maxBuildsPerUser: 50 });
  let now = T0;
  for (let i = 0; i < 12; i++) {
    w.handleChat({ id: 'h' + i, name: 'h' + i }, '!build house', now);
    now = finishAll(w, now);
  }
  const edge = Math.max(...w.builds.map((b) => hexDist(b.q, b.r)));
  const fountain = w.handleChat({ id: 'f', name: 'f' }, '!build fountain', now).build;
  const lighthouse = w.handleChat({ id: 'l', name: 'l' }, '!build lighthouse', now).build;
  assert.ok(hexDist(fountain.q, fountain.r) <= 2);
  assert.ok(hexDist(lighthouse.q, lighthouse.r) >= edge);
});

test('the island grows ring by ring as it fills up, and stays compact', () => {
  const { w } = makeWorld({ maxBuildsPerUser: 50 });
  assert.equal(w.landRing(), 2);
  const items = ['house', 'farm', 'lighthouse', 'windmill', 'park', 'campfire'];
  let now = T0;
  for (let i = 0; i < 60; i++) {
    w.handleChat({ id: 'x' + (i % 10), name: 'x' }, '!build ' + items[i % items.length], now);
    now = finishAll(w, now);
  }
  // 60 plots fit inside ring 4 (3 * 4 * 5 = 60), so a compact island ends near there.
  assert.ok(w.landRing() >= 4, 'grew to ' + w.landRing());
  assert.ok(w.landRing() <= 6, 'grew to ' + w.landRing());
});

test('upgrade raises the level of the latest upgradeable build', () => {
  const { w } = makeWorld();
  w.handleChat(alice, '!build house', T0);
  let now = finishAll(w, T0);
  const res = w.handleChat(alice, '!upgrade', now);
  assert.equal(res.ok, true);
  assert.equal(res.build.upgradeTo, 2);
  now = finishAll(w, now);
  assert.equal(res.build.level, 2);
  assert.equal(res.build.upgradeTo, undefined);
  assert.equal(res.build.status, 'done');
});

test('upgrade explains itself when there is nothing to upgrade', () => {
  const { w } = makeWorld();
  assert.match(w.handleChat(alice, '!upgrade', T0).message, /Build something first/);
  w.handleChat(alice, '!build statue', T0);
  const now = finishAll(w, T0);
  assert.match(w.handleChat(alice, '!upgrade', now + 60_000).message, /Nothing left/);
});

test('builds wait in the queue when too many are running', () => {
  const { w } = makeWorld({ maxConcurrentBuilds: 2 });
  for (const u of ['p', 'q', 'r']) w.handleChat({ id: u, name: u }, '!build house', T0);
  assert.deepEqual(w.builds.map((b) => b.status), ['building', 'building', 'queued']);
  finishAll(w, T0);
  assert.ok(w.builds.every((b) => b.status === 'done'));
});

test('hats and dances need a bot first, then work with a cooldown', () => {
  const { w, events } = makeWorld();
  assert.equal(w.handleChat(alice, '!hat tophat', T0).ok, false);
  w.handleChat(alice, '!build house', T0);
  assert.equal(w.handleChat(alice, '!hat tophat', T0 + 1).ok, true);
  assert.equal(w.state.builders.a.hat, 'tophat');
  assert.equal(w.handleChat(alice, '!hat cap', T0 + 2).ok, false);
  assert.equal(w.handleChat(alice, '!dance', T0 + 3).ok, true);
  assert.equal(w.handleChat(alice, '!dance', T0 + 4).ok, false);
  assert.ok(events.some((e) => e.type === 'dance' && e.userId === 'a'));
});

test('only moderators can remove builds', () => {
  const { w } = makeWorld();
  const b = w.handleChat(alice, '!build house', T0).build;
  assert.equal(w.handleChat(bob, '!remove #' + b.id, T0).ok, false);
  assert.equal(w.builds.length, 1);
  assert.equal(w.handleChat({ id: 'm', name: 'mod', mod: true }, '!remove #' + b.id, T0).ok, true);
  assert.equal(w.builds.length, 0);
});

test('refusals reach the screen at most once per cooldown', () => {
  const { w, events } = makeWorld();
  for (let i = 0; i < 5; i++) w.handleChat(alice, '!build spaceship', T0 + i * 1000);
  assert.equal(events.filter((e) => e.type === 'notice').length, 1);
});

test('a restart catches up on builds that finished while offline', () => {
  const { w } = makeWorld();
  const b = w.handleChat(alice, '!build house', T0).build;
  const revived = new World(JSON.parse(JSON.stringify(w.state)));
  revived.tick(T0 + 3_600_000);
  assert.equal(revived.builds.find((x) => x.id === b.id).status, 'done');
});

test('names are cleaned before they reach the screen', () => {
  const { w } = makeWorld();
  w.handleChat({ id: 'z', name: 'evil\u0007name\nthat is way too long for a nametag' }, '!build house', T0);
  const name = w.state.builders.z.name;
  assert.ok(!/[\u0000-\u001f]/.test(name));
  assert.ok(name.length <= 25);
});
