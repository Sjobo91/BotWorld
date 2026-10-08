// Connects the page to the server's event stream and hands every change to
// the 3D world and the HUD.
//   /             watch and test (orbit with the mouse, type test commands)
//   /?stream=1    the broadcast view for OBS: 1920x1080, camera directs itself
// Extra options: &sound=1 (start with sound), &quality=low (no shadows, for
// weak or GPU-less machines), &time=21:30 (pretend it is that time, for testing).
import { ITEMS, ERAS, EVENTS, RESOURCES, TOOLS } from '../shared/catalog.js';
import { GATHER } from '../shared/terrain.js';
import { createWorld } from './world3d.js';
import { createHud } from './hud.js';

const params = new URLSearchParams(location.search);
const stream = params.get('stream') === '1';
document.documentElement.dataset.stream = stream ? '1' : '0';
const $ = (id) => document.getElementById(id);

const state = {
  builds: new Map(),
  builders: new Map(),
  jobs: new Map(),
  queues: new Map(),
  offset: 0,
  createdAt: Date.now(),
  era: 0,
  eraStartedAt: Date.now(),
  eraHistory: [],
  finished: false,
  finishedAt: null,
  econ: null,
  vote: null,
  event: null,
  connected: false,
};
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
  onTimelapse: hud.timelapse,
  createdAt: () => state.createdAt,
});
if (stream && params.get('sound') === '1') setSound(true);
window.botworld = world;
// For testing from the browser console: botworldEvent({ type: 'era', era: 1, at: Date.now() })
window.botworldEvent = (ev) => handle(ev);
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

const resText = (bag) => Object.entries(bag || {}).map(([r, n]) => (RESOURCES[r] ? RESOURCES[r].emoji : r) + ' ' + n).join(', ');

function handle(ev) {
  switch (ev.type) {
    case 'snapshot':
      state.offset = ev.serverNow - Date.now();
      state.createdAt = ev.createdAt;
      state.era = ev.era || 0;
      state.eraStartedAt = ev.eraStartedAt || ev.createdAt;
      state.eraHistory = ev.eraHistory || [];
      state.finished = !!ev.finished;
      state.finishedAt = ev.finishedAt || null;
      state.econ = ev.econ || null;
      state.vote = ev.vote || null;
      state.event = ev.event || null;
      state.builds = new Map(ev.builds.map((b) => [b.id, b]));
      state.builders = new Map(ev.builders.map((b) => [b.id, b]));
      state.jobs = new Map(Object.entries(ev.jobs || {}));
      state.connected = true;
      state.queues = new Map(Object.entries(ev.queues || {}));
      world?.load(ev.builds, ev.builders, { jobs: ev.jobs, queues: ev.queues, econ: ev.econ, era: ev.era, finished: ev.finished, event: ev.event, geo: ev.mode?.geo, map: ev.map, explored: ev.explored });
      showDevbar(ev.mode);
      if (ev.gazette && Date.now() - ev.gazette.at < 40 * 60e3) hud.gazette(ev.gazette);
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
    case 'builder': {
      // Every bit of XP shows over the bot: chat sees itself make progress.
      const before = state.builders.get(ev.builder.id);
      const gain = before ? (ev.builder.xp || 0) - (before.xp || 0) : 0;
      state.builders.set(ev.builder.id, ev.builder);
      world?.updateBuilder(ev.builder, ev.joined);
      if (gain > 0) world?.xp(ev.builder.id, gain);
      if (ev.joined) hud.toast('join', '🛬', ev.builder.name, ' landed on BotWorld!');
      return;
    }
    case 'queue':
      if (ev.n) state.queues.set(ev.userId, ev.n);
      else state.queues.delete(ev.userId);
      world?.setQueue(ev.userId, ev.n);
      return;
    case 'gathered':
      world?.gathered(ev);
      if (ev.full && Date.now() - (fullAt.get(ev.res) || 0) > 60e3) {
        fullAt.set(ev.res, Date.now());
        hud.toast('help', '📦', '', 'Storage is full of ' + (RESOURCES[ev.res]?.label.toLowerCase() || ev.res) + '. Build a store, or spend it on a project!');
      }
      return;
    case 'tools': {
      const t = TOOLS[ev.tool];
      world?.toolsChanged(ev.userId);
      if (t) hud.toast('level', '🛠️', ev.name, ' got ' + t.label.toLowerCase() + ': ' + t.load + ' per trip!');
      return;
    }
    case 'job':
      if (ev.job) state.jobs.set(ev.userId, ev.job);
      else state.jobs.delete(ev.userId);
      world?.setJob(ev.userId, ev.job);
      announceJob(ev.userId, ev.job);
      return;
    case 'economy':
      state.econ = ev.econ;
      world?.setEconomy(ev.econ);
      hud.renderEcon();
      return;
    case 'produce':
      world?.produce(ev.pops);
      return;
    case 'vote':
      state.vote = ev.vote;
      if (ev.winner && EVENTS[ev.winner]) hud.toast('vote', '🗳️', 'Chat chose ', EVENTS[ev.winner].emoji + ' ' + EVENTS[ev.winner].label + '!');
      break;
    case 'event':
      state.event = ev.event;
      world?.setEvent(ev.event);
      if (ev.event && EVENTS[ev.event.key]) {
        const e = EVENTS[ev.event.key];
        let text = e.text + '.';
        if (ev.gift && Object.keys(ev.gift).length) text = 'brought gifts: ' + resText(ev.gift) + '.';
        if (ev.damaged && ev.damaged.length) text = 'damaged ' + ev.damaged.length + (ev.damaged.length === 1 ? ' building' : ' buildings') + '! Type !repair to fix.';
        hud.toast('event', e.emoji, e.label + ' ', text.startsWith('brought') || text.startsWith('damaged') ? text : '· ' + text);
      }
      break;
    case 'level':
      hud.toast('level', '⭐', ev.name, ' reached level ' + ev.level + ': ' + ev.title + '!');
      world?.dance(ev.userId);
      return;
    case 'me':
      hud.showMe(ev.card);
      world?.highlight(ev.card.id);
      return;
    case 'explore':
      world?.explore(ev);
      announceExplore(ev);
      return;
    case 'era':
      state.era = ev.era;
      state.eraStartedAt = ev.at;
      state.eraHistory = state.eraHistory.concat([{ era: ev.era, at: ev.at }]);
      world?.eraChanged(ev.era);
      hud.eraBanner(ev.era, ev.evolved);
      hud.toast('era', ERAS[ev.era].emoji, 'BotWorld', ' entered the ' + ERAS[ev.era].name + '!');
      break;
    case 'finale':
      state.finished = true;
      state.finishedAt = ev.at;
      world?.finale();
      hud.finaleBanner();
      break;
    case 'gazette':
      hud.gazette(ev.item);
      return;
    case 'dance':
      world?.dance(ev.userId);
      hud.toast('dance', '💃', (state.builders.get(ev.userId) || {}).name || 'someone', ' is dancing!');
      return;
    case 'notice':
      if (ev.kind === 'help') hud.toast('help', '💡', '', ev.text);
      else if (ev.kind === 'project') hud.toast('done', '🎉', '', ev.text);
      else if (ev.kind === 'repair') hud.toast('done', '🔧', ev.user || 'someone', ' ' + ev.text + '!');
      else if (ev.kind === 'wonder') {
        const w = state.econ?.wonder;
        hud.wonderBanner(w ? w.item : ERAS[state.era].wonder);
        hud.toast('done', '🏛️', '', ev.text);
      } else hud.toast('warn', '💬', ev.user ? '@' + ev.user + ' ' : '', ev.text);
      return;
    default:
      return;
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
  if (b.wonder) return;
  const who = (state.builders.get(b.ownerId || b.founderId) || {}).name || 'someone';
  const em = ITEMS[b.item] ? ITEMS[b.item].emoji : '📦';
  if (!prev && b.home) {
    hud.toast('build', '🏡', who, ' is building their own home (#' + b.id + ')');
  } else if (!prev && b.project) {
    hud.toast('build', '🔨', who, ' started ' + withArticle(describe(b)) + ' (#' + b.id + '). Help build it: !help');
  } else if (!prev && b.status === 'queued') {
    const wait = b.waitingFor && b.waitingFor.length ? ', waiting for ' + b.waitingFor.map((r) => RESOURCES[r].emoji + ' ' + RESOURCES[r].label.toLowerCase()).join(' and ') : '';
    hud.toast('build', '🔨', who, ' is building ' + withArticle(describe(b)) + ' (#' + b.id + ')' + wait);
  } else if (prev && prev.project && prev.status !== 'done' && b.status === 'done') {
    return; // the server's notice names everyone who helped
  } else if (prev && prev.status === 'done' && b.upgrade && !b.evolving) {
    const to = ITEMS[b.upgrade.item];
    hud.toast('upgrade', '⬆️', who, to && b.upgrade.item !== b.item ? ' is turning their ' + describe(b) + ' into ' + withArticle(to.label.toLowerCase()) + ' (#' + b.id + ')' : ' is upgrading their ' + describe(b) + ' (#' + b.id + ')');
  } else if (prev && prev.status !== 'done' && b.status === 'done' && !prev.evolving) {
    if (prev.upgrade && prev.item !== b.item) hud.toast('done', em, who, "'s home is now " + withArticle(describe(b)) + '!');
    else if (prev.upgrade && b.home) hud.toast('done', em, who, "'s home grew to level " + b.level + '!');
    else if (b.home) hud.toast('done', '🏡', who, ' moved into their new home!');
    else if (prev.upgrade) hud.toast('done', em, who, "'s " + describe(b) + ' reached level ' + b.level + '!');
    else hud.toast('done', em, who, ' finished ' + withArticle(describe(b)) + '!');
  }
}
const fullAt = new Map();
const HAND_ICON = { chop: '🪓', mine: '⛏️', pick: '🫐', fish: '🎣' };
// Jobs are short and come often: tell each viewer's news at most every 90 s.
const lastJobToast = new Map();
function announceJob(userId, job) {
  if (!job || job.kind === 'gather') return;
  const key = userId + ':' + job.kind + ':' + (job.res || job.buildId || '');
  if (Date.now() - (lastJobToast.get(key) || 0) < 90e3) return;
  lastJobToast.set(key, Date.now());
  if (lastJobToast.size > 500) lastJobToast.clear();
  const who = (state.builders.get(userId) || {}).name || 'someone';
  if (job.kind === 'hand') {
    const g = Object.values(GATHER).find((x) => x.pose === job.pose && x.res === job.res);
    hud.toast('job', HAND_ICON[job.pose] || '🧺', who, ' went out to ' + (g ? g.verb + ' in ' + g.land : 'gather') + '.');
    return;
  }
  const at = state.builds.get(job.buildId);
  const label = at && ITEMS[at.item] ? ITEMS[at.item].label.toLowerCase() : 'island';
  if (job.kind === 'explore') { hud.toast('job', '🧭', who, ' set off to explore the fog.'); return; }
  if (job.kind === 'build') { hud.toast('job', '🔨', who, ' is helping build the ' + label + '.'); return; }
  if (job.kind === 'wonder') hud.toast('job', '📦', who, ' is hauling goods to the ' + label + '.');
  else if (job.kind === 'repair') hud.toast('job', '🔧', who, ' is repairing the ' + label + '.');
  else hud.toast('job', '⚒️', who, ' is helping at the ' + label + (job.res && RESOURCES[job.res] ? ' (' + RESOURCES[job.res].emoji + ')' : '') + '.');
}

const FOUND = { coal: ['⚫', 'found coal in the hills'], iron: ['⛓️', 'found iron in the hills'], ruins: ['🏚️', 'found ancient ruins'], tablet: ['📜', 'found an old stone tablet (+2 hours of knowledge)'] };
function announceExplore(ev) {
  if (!ev.userId) return;
  const n = (ev.tiles || []).length;
  if (!(ev.found || []).length) {
    if (n) hud.toast('explore', '🧭', ev.name, ' explored ' + n + ' new tiles of land.');
    return;
  }
  for (const f of ev.found.slice(0, 2)) {
    const [em, text] = FOUND[f.f] || ['✨', 'found something'];
    const gift = f.gift && Object.keys(f.gift).length ? ': ' + resText(f.gift) : '';
    hud.toast('found', em, ev.name, ' ' + text + gift + '!');
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
$('quick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cmd]');
  if (b) send(b.dataset.cmd);
});
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

// Leaving the stream view: press Esc, or the button that shows up when the
// mouse moves (OBS never moves the mouse, so it never shows on stream).
if (stream) {
  const exit = $('exitStream');
  let hide = 0;
  const leave = () => { location.href = '/' + location.search.replace(/([?&])stream=1&?/, '$1').replace(/[?&]$/, ''); };
  exit.addEventListener('click', leave);
  addEventListener('keydown', (e) => { if (e.key === 'Escape') leave(); });
  addEventListener('mousemove', () => {
    exit.hidden = false;
    clearTimeout(hide);
    hide = setTimeout(() => { exit.hidden = true; }, 2500);
  });
}

// A stream runs for days: start fresh every night at 4:00 to keep memory tidy.
const openedAt = Date.now();
if (stream) {
  setInterval(() => {
    const d = new Date();
    if (d.getHours() === 4 && d.getMinutes() === 0 && Date.now() - openedAt > 3600e3) location.reload();
  }, 30e3);
}
