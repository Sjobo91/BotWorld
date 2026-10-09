import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookEra, lookErasOf, itemsWithLooks } from '../public/js/eralooks.js';
import { ITEMS, ERAS, evolvedItem } from '../public/shared/catalog.js';

test('old buildings take the look of the era their town has reached', () => {
  // A log cabin until the Industrial Revolution, then a sawmill, a lumber yard and a tree farm.
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((e) => lookEra('woodcutter', e)), [0, 0, 0, 0, 4, 5, 6]);
  // A pharos in Rome, a stone tower in the Middle Ages, the striped one until the Future, then a spire of light.
  assert.deepEqual([2, 3, 4, 5, 6].map((e) => lookEra('lighthouse', e)), [2, 3, 4, 4, 6]);
  // Buildings without later looks keep their own, and so does a building with no era given.
  assert.equal(lookEra('temple', 6), 2);
  assert.equal(lookEra('school', 2), 2);
  assert.equal(lookEra('quarry'), 0);
});

test('every later look comes after the building\'s own era, while the building still stands', () => {
  assert.ok(itemsWithLooks().length >= 10);
  for (const item of itemsWithLooks()) {
    const [own, ...later] = lookErasOf(item);
    assert.equal(own, ITEMS[item].era, item);
    for (const e of later) {
      assert.ok(e > own && e < ERAS.length, item + ' in era ' + e);
      // A building that has turned into something else by then would never show it.
      assert.equal(evolvedItem(item, e), item, item + ' still stands in era ' + e);
    }
  }
});
