// Connects the page to the server's event stream and hands every change to
// the 3D world and the HUD.
//   /             watch and test (orbit with the mouse, type test commands)
//   /?stream=1    the broadcast view for OBS: 1920x1080, camera directs itself
// Extra options: &sound=1 (start with sound), &quality=low (no shadows, for
// weak or GPU-less machines), &time=21:30 (pretend it is that time, for testing).
import { ITEMS } from '../shared/catalog.js';
import { createWorld } from './world3d.js';
import { createHud } from './hud.js';

const params = new URLSearchParams(location.search);
const stream = params.get('stream') === '1';
document.documentElement.dataset.stream = stream ? '1' : '0';
const $ = (id) => document.getElementById(id);

const state = { builds: new Map(), builders: new Map(), offset: 0, createdAt: Date.now(), connected: false };
const now = () => Date.now() + state.offset;
const clock = fakeClock(params.get('time'));
const hud = createHud(state, now, { stream, clock });
hud.render();
const world = await createWorld($('stage'), $('overlay'), {
  stream,
  now,
  clock,
  quality: params.get('quality') || 'high',
  lat: params.get('lat'),
  lon: params.get('lon'),
  insets: hud.insets,
  blocked: hud.blocked,
  onFirstTap: () => setSound(true),
});
if (stream && params.get('sound') === '1') setSound(true);
window.botworld = world;
connect();

function fakeClock(spec) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(spec || '');
  if (!m) return null;
  const d = new Date();
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  const shift = d.getTime() - Date.now();
  return () => Date.now() + shift;
}

function connect() {
  const es = new EventSource('/events');
  es.onmessage = (m) => {
    try {
      handle(JSON.parse(m.data));
    } catch (err) {
      console.error('BotWorld: bad event', err);
    }
  };
  es.onerror = () => {
    state.connected = false;
    hud.render();
  };
}

function handle(ev) {
  switch (ev.type) {
    case 'snapshot':
      state.offset = ev.serverNow - Date.now();
      state.createdAt = ev.createdAt;
      state.builds = new Map(ev.builds.map((b) => [b.id, b]));
      state.builders = new Map(ev.builders.map((b) => [b.id, b]));
      state.connected = true;
      world?.load(ev.builds, ev.builders);
      showDevbar(ev.mode);
      break;
    case 'build': {
      const prev = state.builds.get(ev.build.id);
      state.builds.set(ev.build.id, ev.build);
      world?.updateBuild(ev.build);
      announce(ev.build, prev);
      break;
    }
    case 'remove':
      state.builds.delete(ev.id);
      world?.removeBuild(ev.id);
      break;
    case 'builder':
      state.builders.set(ev.builder.id, ev.builder);
      world?.updateBuilder(ev.builder, ev.joined);
      if (ev.joined) hud.toast('join', '🛬', ev.builder.name, ' landed on BotWorld!');
      break;
    case 'dance':
      world?.dance(ev.userId);
      hud.toast('dance', '💃', (state.builders.get(ev.userId) || {}).name || 'someone', ' is dancing!');
      break;
    case 'notice':
      if (ev.kind === 'help') hud.toast('help', '💡', '', ev.text);
      else hud.toast('warn', '💬', ev.user ? '@' + ev.user + ' ' : '', ev.text);
      break;
    default:
      break;
  }
  hud.render();
}

function describe(b) {
  return (b.color ? b.color + ' ' : '') + (ITEMS[b.item] ? ITEMS[b.item].label.toLowerCase() : b.item);
}
function withArticle(text) {
  return (/^[aeiou]/i.test(text) ? 'an ' : 'a ') + text;
}
function announce(b, prev) {
  const who = (state.builders.get(b.ownerId) || {}).name || 'someone';
  const em = ITEMS[b.item] ? ITEMS[b.item].emoji : '📦';
  if (!prev && b.status === 'queued') hud.toast('build', '🔨', who, ' is building ' + withArticle(describe(b)) + ' (#' + b.id + ')');
  else if (prev && prev.status === 'done' && b.upgradeTo) hud.toast('upgrade', '⬆️', who, ' is upgrading their ' + describe(b) + ' (#' + b.id + ')');
  else if (prev && prev.status !== 'done' && b.status === 'done') {
    if (prev.upgradeTo) hud.toast('done', em, who, "'s " + describe(b) + ' reached level ' + b.level + '!');
    else hud.toast('done', em, who, ' finished ' + withArticle(describe(b)) + '!');
  }
}

function setSound(on) {
  const ok = world ? world.setSound(on) : false;
  const btn = $('soundBtn');
  if (btn) {
    btn.setAttribute('aria-pressed', String(!!ok));
    btn.textContent = ok ? '🔊 Sound on' : '🔈 Sound off';
  }
}

// The test bar: type commands as any name, from the computer running BotWorld.
function showDevbar(mode) {
  if (stream) return;
  const bar = $('devbar');
  bar.hidden = false;
  $('devMode').textContent = mode && mode.channel ? 'Reading chat of #' + mode.channel + (mode.twitch === 'connected' ? '' : ' (' + mode.twitch + ')') : mode && mode.simulate ? 'Demo mode: pretend viewers are chatting' : 'Not connected to Twitch yet';
  world?.relayout();
}
$('devbar').addEventListener('submit', (e) => {
  e.preventDefault();
  send($('devText').value);
});
for (const b of document.querySelectorAll('[data-cmd]')) b.addEventListener('click', () => send(b.dataset.cmd));
$('soundBtn').addEventListener('click', () => setSound(!(world && world.soundOn)));
async function send(text) {
  if (!text.trim()) return;
  const out = $('devResult');
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user: $('devUser').value || 'tester', text, mod: $('devMod').checked }),
    });
    const body = await res.json();
    out.textContent = res.status === 403 ? 'Test chat only works on the computer that runs BotWorld.' : body.message || body.error || 'OK';
  } catch {
    out.textContent = 'The BotWorld server is not answering.';
  }
  $('devText').value = '';
}

// A stream runs for days: start fresh every night at 4:00 to keep memory tidy.
const openedAt = Date.now();
if (stream) {
  setInterval(() => {
    const d = new Date();
    if (d.getHours() === 4 && d.getMinutes() === 0 && Date.now() - openedAt > 3600e3) location.reload();
  }, 30e3);
}
