import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatFromIrc, parseIrc } from '../server/twitch.js';

// Lines as Twitch sends them (tags requested with CAP REQ twitch.tv/tags).
const PRIVMSG = '@badge-info=;badges=moderator/1,partner/1;color=#1E90FF;display-name=Luna_Builds;emotes=;id=b34ccfc7;mod=1;room-id=1337;subscriber=0;tmi-sent-ts=1507246572675;turbo=0;user-id=12345;user-type=mod :luna_builds!luna_builds@luna_builds.tmi.twitch.tv PRIVMSG #botworld :!build a red house';
const BROADCASTER = '@badges=broadcaster/1;color=;display-name=Sjobo;mod=0;user-id=999 :sjobo!sjobo@sjobo.tmi.twitch.tv PRIVMSG #botworld :!remove #3';
const ACTION = '@badges=;display-name=quietfox;mod=0;user-id=77 :quietfox!quietfox@quietfox.tmi.twitch.tv PRIVMSG #botworld :\u0001ACTION !dance\u0001';

test('parses tags, prefix, command and trailing text', () => {
  const m = parseIrc(PRIVMSG);
  assert.equal(m.command, 'PRIVMSG');
  assert.equal(m.tags['display-name'], 'Luna_Builds');
  assert.equal(m.tags['user-id'], '12345');
  assert.deepEqual(m.params, ['#botworld', '!build a red house']);
});

test('unescapes tag values', () => {
  const m = parseIrc('@system-msg=hello\\sthere\\:x :tmi.twitch.tv USERNOTICE #botworld');
  assert.equal(m.tags['system-msg'], 'hello there;x');
});

test('PING has its token as a parameter', () => {
  const m = parseIrc('PING :tmi.twitch.tv');
  assert.equal(m.command, 'PING');
  assert.deepEqual(m.params, ['tmi.twitch.tv']);
});

test('chat messages become users with moderator flags', () => {
  const c = chatFromIrc(parseIrc(PRIVMSG));
  assert.equal(c.text, '!build a red house');
  assert.deepEqual(c.user, { id: '12345', login: 'luna_builds', name: 'Luna_Builds', color: '#1E90FF', mod: true, broadcaster: false });
  const owner = chatFromIrc(parseIrc(BROADCASTER));
  assert.equal(owner.user.broadcaster, true);
  assert.equal(owner.user.mod, true);
});

test('/me messages keep their text', () => {
  assert.equal(chatFromIrc(parseIrc(ACTION)).text, '!dance');
});

test('non-chat lines are ignored', () => {
  assert.equal(chatFromIrc(parseIrc(':tmi.twitch.tv 001 justinfan123 :Welcome, GLHF!')), null);
});
