import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from '../server/commands.js';

test('plain chat is not a command', () => {
  assert.equal(parseCommand('hello chat'), null);
  assert.equal(parseCommand('build a house'), null);
  assert.equal(parseCommand('!unknowncommand'), null);
});

test('build understands items, colors and filler words', () => {
  assert.deepEqual(parseCommand('!build house'), { type: 'build', item: 'house', color: null, raw: '' });
  assert.deepEqual(parseCommand('!build a red house'), { type: 'build', item: 'house', color: 'red', raw: '' });
  assert.deepEqual(parseCommand('!BUILD Tower BLUE'), { type: 'build', item: 'tower', color: 'blue', raw: '' });
  assert.equal(parseCommand('!b castle').item, 'tower');
  assert.equal(parseCommand('!build some trees please').item, 'park');
  assert.equal(parseCommand('!build houses').item, 'house');
  assert.equal(parseCommand('!build grey statue!!').color, 'gray');
});

test('build with an unknown item keeps what it did not understand', () => {
  const c = parseCommand('!build a spaceship');
  assert.equal(c.type, 'build');
  assert.equal(c.item, null);
  assert.equal(c.raw, 'spaceship');
});

test('other commands', () => {
  assert.deepEqual(parseCommand('!upgrade'), { type: 'upgrade' });
  assert.deepEqual(parseCommand('!hat tophat'), { type: 'hat', hat: 'tophat', raw: 'tophat' });
  assert.equal(parseCommand('!hat helmet').hat, 'hardhat');
  assert.equal(parseCommand('!hat sombrero').hat, null);
  assert.deepEqual(parseCommand('!dance'), { type: 'dance' });
  assert.deepEqual(parseCommand('!help'), { type: 'help' });
  assert.deepEqual(parseCommand('!remove #12'), { type: 'remove', id: 12 });
  assert.deepEqual(parseCommand('!remove x'), { type: 'remove', id: null });
});

test('very long lines are ignored', () => {
  assert.equal(parseCommand('!build ' + 'house '.repeat(60)), null);
});
