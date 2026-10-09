import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from '../server/commands.js';

test('plain chat is not a command', () => {
  assert.equal(parseCommand('hello chat'), null);
  assert.equal(parseCommand('build a house'), null);
  assert.equal(parseCommand('!unknowncommand'), null);
});

test('build understands items, colors, filler words and "near"', () => {
  assert.deepEqual(parseCommand('!build house'), { type: 'build', item: 'house', color: null, near: null, dir: null, raw: '' });
  assert.deepEqual(parseCommand('!build a red hut'), { type: 'build', item: 'hut', color: 'red', near: null, dir: null, raw: '' });
  assert.equal(parseCommand('!build outpost north').dir, 'north');
  assert.equal(parseCommand('!build outpost ne').dir, 'northeast');
  assert.equal(parseCommand('!BUILD Woodcutter BLUE').color, 'blue');
  assert.equal(parseCommand('!b castle').item, 'tower');
  assert.equal(parseCommand('!build some factories please').item, 'factory');
  assert.equal(parseCommand('!build huts').item, 'hut');
  assert.equal(parseCommand('!build grey statue!!').color, 'gray');
  const near = parseCommand('!build a house next to the fountain');
  assert.equal(near.item, 'house');
  assert.equal(near.near, 'fountain');
});

test('wonders are not built by hand: !build pyramid hauls to the wonder', () => {
  assert.deepEqual(parseCommand('!build pyramid'), { type: 'help', target: 'wonder' });
  assert.deepEqual(parseCommand('!build the pyramids'), { type: 'help', target: 'wonder' });
  // Two words, even when the second is a building of its own.
  assert.deepEqual(parseCommand('!build eiffel tower'), { type: 'help', target: 'wonder' });
  assert.deepEqual(parseCommand('!build big ben'), { type: 'help', target: 'wonder' });
  assert.equal(parseCommand('!build tower').item, 'tower');
});

test('build with an unknown item keeps what it did not understand', () => {
  const c = parseCommand('!build a spaceship');
  assert.equal(c.item, null);
  assert.equal(c.raw, 'spaceship');
});

test('work, repair and vote', () => {
  assert.deepEqual(parseCommand('!work'), { type: 'work', target: null, raw: '' });
  assert.equal(parseCommand('!work wood').target, 'wood');
  assert.equal(parseCommand('!work logs').target, 'wood');
  assert.equal(parseCommand('!work wonder').target, 'wonder');
  assert.equal(parseCommand('!work banana').target, null);
  assert.deepEqual(parseCommand('!repair'), { type: 'repair' });
  assert.deepEqual(parseCommand('!vote 2'), { type: 'vote', option: 2 });
  assert.deepEqual(parseCommand('!vote 9'), { type: 'vote', option: null });
  assert.deepEqual(parseCommand('!1'), { type: 'vote', option: 1 });
});

test('gathering by hand', () => {
  assert.deepEqual(parseCommand('!wood'), { type: 'work', target: 'wood' });
  assert.equal(parseCommand('!chop').target, 'wood');
  assert.equal(parseCommand('!stone').target, 'stone');
  assert.equal(parseCommand('!mine').target, 'stone');
  assert.equal(parseCommand('!mine coal').target, 'coal');
  assert.equal(parseCommand('!dig iron').target, 'iron');
  assert.equal(parseCommand('!berries').target, 'food');
  assert.deepEqual(parseCommand('!fish'), { type: 'work', target: 'food', how: 'fish' });
  assert.equal(parseCommand('!work fish').how, 'fish');
  assert.equal(parseCommand('!coal').target, 'coal');
});

test('repeat counts, upgrades and !stop', () => {
  assert.deepEqual(parseCommand('!wood 3'), { type: 'work', target: 'wood', times: 3 });
  assert.equal(parseCommand('!stone x2').times, 2);
  assert.equal(parseCommand('!help 3').times, 3);
  assert.equal(parseCommand('!help #12').id, 12);
  assert.equal(parseCommand('!help #12 2').times, 2);
  assert.deepEqual(parseCommand('!upgrade'), { type: 'upgrade' });
  assert.deepEqual(parseCommand('!upgrade tools'), { type: 'upgrade', what: 'tools' });
  assert.deepEqual(parseCommand('!tools'), { type: 'upgrade', what: 'tools' });
  assert.deepEqual(parseCommand('!upgrade woodcutter'), { type: 'upgrade', item: 'woodcutter' });
  assert.deepEqual(parseCommand('!upgrade #12'), { type: 'upgrade', id: 12 });
  assert.deepEqual(parseCommand('!upgrade the house'), { type: 'upgrade' });
  assert.deepEqual(parseCommand('!stop'), { type: 'stop' });
});

test('other commands', () => {
  assert.deepEqual(parseCommand('!upgrade'), { type: 'upgrade' });
  assert.deepEqual(parseCommand('!hat tophat'), { type: 'hat', hat: 'tophat', raw: 'tophat' });
  assert.equal(parseCommand('!hat helmet').hat, 'hardhat');
  assert.equal(parseCommand('!hat sombrero').hat, null);
  assert.deepEqual(parseCommand('!dance'), { type: 'dance' });
  assert.deepEqual(parseCommand('!me'), { type: 'me' });
  assert.deepEqual(parseCommand('!help'), { type: 'help', id: null });
  assert.deepEqual(parseCommand('!help #4'), { type: 'help', id: 4 });
  assert.deepEqual(parseCommand('!help wonder'), { type: 'help', target: 'wonder' });
  // Nobody builds a wonder alone: !build wonder (or its name) hauls to it.
  assert.deepEqual(parseCommand('!build wonder'), { type: 'help', target: 'wonder' });
  assert.deepEqual(parseCommand('!build the colosseum'), { type: 'help', target: 'wonder' });
  assert.deepEqual(parseCommand('!build great pyramid 3'), { type: 'help', target: 'wonder', times: 3 });
  assert.deepEqual(parseCommand('!help the colosseum'), { type: 'help', target: 'wonder' });
  assert.equal(parseCommand('!build hut near the wonder').item, 'hut');
  assert.deepEqual(parseCommand('!commands'), { type: 'commands' });
  assert.deepEqual(parseCommand('!home'), { type: 'home' });
  assert.deepEqual(parseCommand('!explore'), { type: 'explore', dir: null, raw: '' });
  assert.deepEqual(parseCommand('!explore NW'), { type: 'explore', dir: 'northwest', raw: 'nw' });
  assert.equal(parseCommand('!scout the south').dir, 'south');
  assert.equal(parseCommand('!explore moon').dir, null);
  assert.deepEqual(parseCommand('!demolish #7'), { type: 'demolish', id: 7 });
  assert.deepEqual(parseCommand('!remove #12'), { type: 'remove', id: 12 });
  assert.deepEqual(parseCommand('!remove x'), { type: 'remove', id: null });
  assert.deepEqual(parseCommand('!event storm'), { type: 'event', key: 'storm' });
  assert.deepEqual(parseCommand('!event tallTrees'), { type: 'event', key: 'tallTrees' });
});

test('very long lines are ignored', () => {
  assert.equal(parseCommand('!build ' + 'house '.repeat(60)), null);
});

test('!vote start is its own command', () => {
  assert.deepEqual(parseCommand('!vote start'), { type: 'vote', option: null, start: true });
  assert.deepEqual(parseCommand('!vote 2'), { type: 'vote', option: 2 });
});

test('!deliver hauls for a Merchant Guild order, and can be lined up', () => {
  assert.deepEqual(parseCommand('!deliver'), { type: 'deliver' });
  assert.deepEqual(parseCommand('!deliver 3'), { type: 'deliver', times: 3 });
  assert.equal(parseCommand('!trade').type, 'deliver');
  assert.equal(parseCommand('!haul x2').times, 2);
  assert.deepEqual(parseCommand('!deliver start'), { type: 'deliver', start: true });
});
