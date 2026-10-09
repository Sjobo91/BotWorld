import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { loadConfig } from '../server/config.js';

const root = os.tmpdir();

test('the pace, location and gazette have sensible defaults', () => {
  const cfg = loadConfig([], {}, root);
  assert.equal(cfg.pace.eraDays, 2);
  assert.deepEqual(cfg.geo, { lat: 52.2, lon: 5.1 });
  assert.equal(cfg.gazette.ai, 'auto');
});

test('era length can be set from the command line or the environment', () => {
  assert.equal(loadConfig(['--era-days=12'], {}, root).pace.eraDays, 12);
  assert.equal(loadConfig([], { BOTWORLD_ERA_DAYS: '4' }, root).pace.eraDays, 4);
  assert.equal(loadConfig(['--era-days=nope'], {}, root).pace.eraDays, 2);
});
