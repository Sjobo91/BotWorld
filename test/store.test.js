import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/store.js';
import { loadConfig } from '../server/config.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'botworld-'));

test('a saved world loads back the same, with a dated backup', () => {
  const dir = tmp();
  const store = new Store(dir);
  const state = store.load(1000);
  state.builds.push({ id: 1, item: 'house' });
  store.save(state, Date.UTC(2026, 9, 8));
  assert.deepEqual(new Store(dir).load(0), state);
  assert.ok(fs.existsSync(path.join(dir, 'backups', 'world-2026-10-08.json')));
  assert.ok(!fs.existsSync(path.join(dir, 'world.json.tmp')));
});

test('a broken world file is kept aside and the island starts fresh', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'world.json'), '{ not json');
  const state = new Store(dir).load(5);
  assert.equal(state.builds.length, 0);
  assert.equal(state.createdAt, 5);
  assert.ok(fs.existsSync(path.join(dir, 'world.bad.json')));
});

test('config comes from the file, then env, then flags', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'botworld.config.json'), JSON.stringify({ channel: 'FromFile', port: 4000, limits: { maxQueue: 5 } }));
  let cfg = loadConfig([], {}, root);
  assert.equal(cfg.channel, 'fromfile');
  assert.equal(cfg.port, 4000);
  assert.equal(cfg.limits.maxQueue, 5);
  cfg = loadConfig(['--channel=#FromFlag', '--simulate'], { TWITCH_CHANNEL: 'fromenv', PORT: '5000' }, root);
  assert.equal(cfg.channel, 'fromflag');
  assert.equal(cfg.port, 5000);
  assert.equal(cfg.simulate, true);
  assert.equal(loadConfig(['--channel=your_twitch_channel'], {}, tmp()).channel, '');
});
