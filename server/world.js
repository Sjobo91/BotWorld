// The rules of BotWorld. The server owns the world: what gets built where,
// what it costs, what the town produces, which land is explored, when an era
// ends, and what every viewer's bot is doing. The page only animates it.
//
// Every viewer has one home of their own (!home). Everything else is a town
// project: someone starts it (!build farm), everyone helps (!help), and the
// more bots help, the faster it rises. Around the town lies a big world in
// fog, explored by scouts (!explore), with forests, hills, ore and ruins.
import { ITEMS, ERAS, EVENTS, HATS, PALETTE, RESOURCES, HOME_LEVELS, BUILD_LEVELS, TOOLS, toolsOf, hashStr, houseFor, itemsOfEra, levelFor, titleFor, xpForLevel, evolvedItem, wondersOf, otherWonder, theName, TheName, whatItDoes, resolveItem, resolveResource, resolveWonder } from '../public/shared/catalog.js';
import { WONDER_RING, hexDist, hexKey, isWonderPlot, ringTiles, wonderTile } from '../public/shared/hex.js';
import * as M from '../public/shared/terrain.js';
import { parseCommand } from './commands.js';
import * as E from './economy.js';
import { Rival, freshRival, raceProgress } from './rival.js';
import * as G from './guild.js';

export const DEFAULT_LIMITS = {
  maxProjects: 3,
  maxHelpers: 8,
  maxQueue: 30,
  hatCooldownSec: 10,
  danceCooldownSec: 30,
  noticeCooldownSec: 20,
  helpCooldownSec: 30,
  meCooldownSec: 30,
  // Every job is short, so chat can keep typing and see progress. Jobs typed
  // while a bot is busy wait in line, up to queueMax.
  queueMax: 5,
  shiftSec: 40,
  workShiftSec: 60,
  repairSec: 20,
  // An AI town on the far side of the world that races chat (false: off).
  rival: true,
  rivalDifficulty: 1,
  // Merchant Guild orders both towns race to fill (needs the rival).
  contracts: true,
  contractEveryMin: 75,
  contractMin: 30,
  deliverSec: 30,
  voteEveryMin: 60,
  voteSec: 180,
  // Which wonder BotWorld builds: chat votes when an era comes into sight.
  wonderVoteSec: 300,
  autoEventEveryMin: 150,
};
// eraDays: how long an era takes at base speed. Schools and labs can make
// knowledge up to 1.5x faster, and helpers speed up the wonder. 2 days an
// era make a season of about two weeks; 9.5 one of about two months.
export const DEFAULT_PACE = { eraDays: 2 };

const ECON_STEP_SEC = 5;
// How long a building that stood idle for want of an input counts as idle:
// it gets a little now and then, so one economy step can miss it.
const IDLE_MEMORY_MS = 3 * 60e3;
const WALK_BASE_SEC = 3;
const WALK_SEC_PER_RING = 1.5;
// Bot-seconds of work a town project needs per second of its build time:
// a hut (20 s) takes one bot 2 minutes, four bots half a minute.
export const LABOR = 6;
// Townsfolk always lend a hand, so projects finish even when chat is asleep.
export const TOWN_CREW = 0.2;
const HOME_BUILD_SEC = 25;
const HOME_COST = 0.5;
const WONDER_HELPERS = 8;
const DAY = 864e5;
// Commands that keep a bot busy for a while (and so can wait in line).
const JOB_COMMANDS = new Set(['work', 'help', 'explore', 'repair', 'deliver']);
const EMPTY = new Set();
const URGENT = new Set(['wonder', 'hungry', 'power', 'build']);
// Each town's home ground, where the other may not build: no race can
// leave a town without its first forests, hills and ore.
export const HOME_GROUND = 13;
const STARTER_HATS = Object.keys(HATS).filter((h) => h !== 'none' && HATS[h].level === 1);
const NEAR2 = [];
for (let dq = -2; dq <= 2; dq++) for (let dr = -2; dr <= 2; dr++) if ((dq || dr) && hexDist(dq, dr) <= 2) NEAR2.push([dq, dr]);

export const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
export function weekKey(ms) {
  const d = new Date(ms);
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return dayKey(monday);
}
const res = (r) => (r === 'power' ? '⚡ power' : RESOURCES[r].emoji + ' ' + RESOURCES[r].label.toLowerCase());
const label = (item) => ITEMS[item].label.toLowerCase();
const scaleCost = (cost, f) => Object.fromEntries(Object.entries(cost).map(([r, n]) => [r, Math.max(1, Math.ceil(n * f))]));
const withArticle = (s) => (/^[aeiou]/i.test(s) ? 'an ' : 'a ') + s;
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const rndPick = (id) => (hashStr(id + ':' + Math.floor(Date.now() / 60e3)) % 1000) / 1000;
const isProducerLike = (it) => ['producer', 'power', 'storage'].includes(it.kind);

export function freshState(now, seed) {
  return {
    version: 4,
    createdAt: now,
    seq: 0,
    builds: [],
    builders: {},
    era: 0,
    eraStartedAt: now,
    eraHistory: [{ era: 0, at: now }],
    knowledge: 0,
    stock: { ...E.START_STOCK },
    population: 0,
    jobs: {},
    vote: null,
    event: null,
    nextVoteAt: now + 20 * 60e3,
    nextAutoEventAt: now + 90 * 60e3,
    finished: false,
    mapSeed: seed != null ? seed : hashStr('botworld:' + now) % 1e9,
    explored: '',
    cleared: [],
    found: [],
    queues: {},
    contract: null,
    contracts: G.freshContracts(),
    nextContractAt: now + 45 * 60e3,
    // The wonder chat chose for each era (the rival builds the other one).
    picks: {},
  };
}

// Older saves are brought up to date in place.
const V1_ITEMS = { house: 'hut', shop: 'market', tower: 'tower', farm: 'farm', windmill: 'windmill', lighthouse: 'lighthouse', fountain: 'fountain', park: 'park', garden: 'garden', statue: 'statue', campfire: 'campfire' };
export function migrate(state, now) {
  const s = state;
  if (s.version === 1) {
    for (const b of s.builds) {
      b.item = V1_ITEMS[b.item] || 'hut';
      b.level = ITEMS[b.item].maxLevel ? Math.min(b.level || 1, ITEMS[b.item].maxLevel) : 1;
      b.built = b.status === 'done' || !!b.upgradeTo;
      delete b.upgradeTo;
      b.cost = {};
      if (b.status !== 'done') { b.status = 'done'; b.doneAt = now; b.built = true; }
    }
    s.version = 2;
  }
  if (s.version === 2) {
    // Before the big world: every viewer keeps their first house as their
    // home, everything else becomes a town building, and the land under
    // every building is cleared so it stands on grass.
    s.mapSeed = s.mapSeed != null ? s.mapSeed : hashStr('botworld:' + s.createdAt) % 1e9;
    s.cleared = [...new Set(s.builds.map((b) => hexKey(b.q, b.r)))];
    const hasHome = new Set();
    for (const b of [...s.builds].sort((a, c) => a.id - c.id)) {
      if (b.wonder) continue;
      const house = ITEMS[b.item]?.kind === 'house';
      if (house && b.ownerId && !hasHome.has(b.ownerId) && b.built) {
        hasHome.add(b.ownerId);
        b.home = true;
        b.level = Math.min(HOME_LEVELS, b.level || 1);
        continue;
      }
      b.project = true;
      b.founderId = b.ownerId || null;
      b.ownerId = null;
      b.helpers = {};
      b.work = (ITEMS[b.item].buildSec || 20) * LABOR;
      if (b.status === 'building' && !b.built) { b.progress = 0; b.startedAt = now; }
      else b.progress = b.status === 'done' ? b.work : 0;
    }
    s.explored = '';
    s.found = [];
    s.version = 3;
  }
  if (s.version === 3) migrateV3(s);
  const fresh = freshState(now, s.mapSeed);
  for (const k of Object.keys(fresh)) if (s[k] === undefined) s[k] = fresh[k];
  for (const r of Object.keys(E.START_STOCK)) if (typeof s.stock[r] !== 'number') s.stock[r] = 0;
  return s;
}

// Version 4 brought the eras of history: the Village became Ancient Egypt,
// the Roman Empire came in between, and every era got two wonders to choose
// from. Old eras, buildings and wonders move to their new places.
const V3_ERA = [0, 1, 3, 4, 5, 6];
const V3_ITEMS = { cottage: 'mudhouse', barn: 'granary', stonecircle: 'stonehenge', greathall: 'pyramid', cathedral: 'notredame', clocktower: 'bigben', skyline: 'empirestate' };
function migrateV3(s) {
  const era = (e) => V3_ERA[Math.max(0, Math.min(V3_ERA.length - 1, e || 0))];
  const fix = (list, townEra) => {
    for (const b of list) {
      for (const o of [b, b.upgrade]) {
        if (!o) continue;
        o.item = V3_ITEMS[o.item] || o.item;
        // Windmills come with the Middle Ages now: before that, a canal.
        if (o.item === 'windmill' && townEra < ITEMS.windmill.era) o.item = 'canal';
      }
    }
  };
  s.era = era(s.era);
  s.eraHistory = (s.eraHistory || []).map((h) => ({ ...h, era: era(h.era) }));
  fix(s.builds, s.era);
  s.picks = {};
  for (const b of s.builds) {
    if (!b.wonder) continue;
    const e = ITEMS[b.item].era;
    [b.q, b.r] = wonderTile(e);
    s.picks[e] = b.item;
  }
  if (s.vote && s.vote.kind !== 'wonder') s.vote = null;
  const rv = s.rival;
  if (rv) {
    rv.era = era(rv.era);
    rv.history = (rv.history || []).map((h) => ({ ...h, era: era(h.era) }));
    rv.eraFirst = Object.fromEntries(Object.entries(rv.eraFirst || {}).map(([e, who]) => [era(Number(e)), who]));
    fix(rv.builds, rv.era);
    for (const b of rv.builds) {
      if (!b.wonder) continue;
      const e = ITEMS[b.item].era;
      if (s.picks[e]) b.item = otherWonder(s.picks[e]);
      else s.picks[e] = otherWonder(b.item);
    }
  }
  s.version = 4;
}

export function cleanName(name) {
  const s = String(name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 25);
  return s || 'someone';
}

export class World {
  constructor(state, { limits, pace, geo } = {}) {
    const now = Date.now();
    this.state = migrate(state, state.createdAt || now);
    this.limits = { ...DEFAULT_LIMITS, ...(limits || {}) };
    this.pace = { ...DEFAULT_PACE, ...(pace || {}) };
    this.geo = geo || {};
    this.cooldowns = new Map();
    this.listeners = new Set();
    this.dirty = false;
    this.progress = new Map();
    this.fuel = new Map();
    this.stalled = {};
    this.starved = {}; // buildings idle of late, by id: the inputs they wait for and when
    this.rates = {};
    this.handMade = {}; // goods gathered by hand since the last economy step
    this.happy = 50;
    this.lastHappy = 0;
    this.lastEcon = 0;
    this.lastBuildTick = 0;
    this.econ = null;
    this.wonderShort = [];
    this.recent = new Map();
    this.map = M.makeMap(this.state.mapSeed, this.state.cleared);
    this.bits = M.decodeBits(this.state.explored, this.map);
    this.known = (t) => M.isExplored(this.bits, t.i);
    if (!this.state.explored) {
      M.reveal(this.map, this.bits, 0, 0, M.START_RADIUS);
      for (const b of this.builds) M.reveal(this.map, this.bits, b.q, b.r, 2);
      this.saveBits();
    }
    this.relocateWonderRing();
    for (const b of this.builds) if (!b.wonder && b.rich == null) this.placeStats(b);
    this.ensureWonder(this.state.eraStartedAt);
    this.rivalDifficulty = Number(this.limits.rivalDifficulty) || 1;
    if (this.limits.rival) {
      if (!this.state.rival) {
        // A rival for an older world starts in the same era, with some goods.
        const now0 = this.state.createdAt || now;
        this.state.rival = freshRival(this.map, now0, this.state.era);
        if (this.state.era > 0) for (const r of E.unlockedResources(this.state.era)) this.state.rival.stock[r] = 80;
      }
      this.rival = new Rival(this, this.state.rival);
    } else this.rival = null;
  }

  // --- The race against the rival ---------------------------------------------------------
  raceProgress() {
    const s = this.state;
    return raceProgress(s.era, s.finished, s.knowledge / this.knowledgeNeed(), this.currentWonder(), s.population);
  }
  // The town's land: tiles within two steps of its buildings, and its home
  // ground (the middle out to 13 tiles, where its first coal and iron lie).
  ownLand() {
    if (this.ownCache && this.ownCache.n === this.builds.length) return this.ownCache.set;
    const set = new Set();
    for (const b of this.builds) {
      const t = M.tileAt(this.map, b.q, b.r);
      if (t) for (const n of M.tilesWithin(this.map, t, 2)) set.add(n.i);
    }
    for (const t of this.map.tiles) if (t.d <= HOME_GROUND) set.add(t.i);
    this.ownCache = { n: this.builds.length, set };
    return set;
  }
  rivalLand() {
    return this.rival ? this.rival.land() : EMPTY;
  }
  allTaken() {
    const set = new Set(this.builds.map((b) => hexKey(b.q, b.r)));
    if (this.rival) for (const b of this.rival.builds) set.add(hexKey(b.q, b.r));
    return set;
  }
  // Newly seen land with the rival's buildings on it: chat has met them.
  checkMet(tiles) {
    if (!this.rival || this.rival.s.met || !tiles.length) return;
    const land = this.rival.land();
    if (!tiles.some((t) => land.has(t.i))) return;
    this.rival.s.met = true;
    this.emit({ type: 'notice', kind: 'rival', text: 'Scouts found ' + this.rival.s.name + ', the rival town! Who reaches the Future first?' });
    this.emit({ type: 'rival', rival: this.rival.summary(), met: true });
  }

  // The plots of the wonders are for wonders: anything standing there (from
  // an old save, or where the Future's wonder will rise) moves out, or makes
  // way when there is no room left.
  relocateWonderRing(now = Date.now()) {
    for (const b of [...this.builds]) {
      if (b.wonder || !isWonderPlot(b.q, b.r, this.state.era)) continue;
      let plot = this.choosePlot(b.item, { home: b.home, salt: b.id });
      // A full town: it takes the place of something the town can spare,
      // as a new building would (a home always may, so nobody loses theirs).
      const spare = plot ? null : this.spareFor(b.item, !!b.home);
      if (spare) {
        plot = M.tileAt(this.map, spare.q, spare.r);
        this.makeWay(spare, b.item, now);
      }
      if (plot) {
        b.q = plot.q;
        b.r = plot.r;
        if (!b.home) this.placeStats(b);
        this.changed({ type: 'build', build: b });
      } else {
        this.removeBuild(b.id, now);
        this.emit({ type: 'notice', kind: 'clear', text: 'The ' + label(b.item) + ' (#' + b.id + ') makes way for the wonder of ' + ERAS[this.state.era].the + '.' });
      }
    }
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(event) {
    for (const fn of this.listeners) fn(event);
  }
  changed(event) {
    this.dirty = true;
    this.emit(event);
  }
  get builds() {
    return this.state.builds;
  }
  get era() {
    return this.state.era;
  }
  saveBits() {
    this.state.explored = M.encodeBits(this.bits);
    this.dirty = true;
  }
  tileOf(b) {
    return M.tileAt(this.map, b.q, b.r);
  }
  // How good a spot is for what stands on it, remembered on the building.
  placeStats(b) {
    const t = this.tileOf(b);
    if (!t) return;
    b.rich = Math.round(M.richness(this.map, b.item, t) * 100) / 100;
    if (M.siteOf(b.item).ore) b.ores = M.oresNear(this.map, t);
  }
  knowledgeNeed() {
    return this.pace.eraDays * 1440;
  }
  currentWonder() {
    const era = this.state.era;
    return this.builds.find((b) => b.wonder && ITEMS[b.item].era === era) || null;
  }
  // "the Great Pyramid", "Stonehenge", or just "the wonder" while chat has
  // not chosen yet.
  wonderTitle(w) {
    return w.pending ? 'the wonder' : theName(w.item);
  }
  homeOf(userId) {
    return this.builds.find((b) => b.home && b.ownerId === userId) || null;
  }
  // Town projects that are not finished yet (not the wonder, not homes).
  projects() {
    return this.builds.filter((b) => b.project && b.status !== 'done' && !b.evolving);
  }

  snapshot(now) {
    if (!this.econ) this.economy(now, 0);
    return {
      serverNow: now,
      createdAt: this.state.createdAt,
      era: this.state.era,
      eraStartedAt: this.state.eraStartedAt,
      eraHistory: this.state.eraHistory,
      finished: this.state.finished,
      finishedAt: this.state.finishedAt || null,
      builds: this.builds,
      builders: Object.values(this.state.builders),
      map: { seed: this.state.mapSeed, cleared: this.state.cleared },
      explored: this.state.explored,
      found: this.state.found,
      econ: this.econ,
      vote: this.voteView(),
      event: this.state.event,
      jobs: this.state.jobs,
      queues: Object.fromEntries(Object.entries(this.state.queues || {}).map(([uid, q]) => [uid, q.length])),
      rival: this.rival ? this.rival.summary() : null,
      rivalBuilds: this.rival ? this.rival.builds : [],
      leaders: this.leaders(now),
    };
  }

  // One chat line in, at most one command applied. Returns null when the line
  // was not a command, else { ok, message }.
  handleChat(user, text, now) {
    const cmd = parseCommand(text);
    if (!cmd) return null;
    return this.apply(cmd, user, now);
  }

  apply(cmd, user, now, fromQueue = false) {
    const u = { ...user, id: String(user.id || user.name || ''), name: cleanName(user.name) };
    if (!u.id) return { ok: false, message: 'Unknown user.' };
    this.recent.set(u.id, now);
    if (JOB_COMMANDS.has(cmd.type) && !fromQueue) {
      // Typed while the bot is busy: it waits in line. "!wood 3" lines up three.
      const times = Math.max(1, Math.min(this.limits.queueMax, cmd.times || 1));
      const job = this.state.jobs[u.id];
      if (job && job.kind !== 'gather') return this.enqueue(cmd, u, now, times);
      const res = this.run(cmd, u, now);
      if (res?.ok && times > 1) this.enqueue(cmd, u, now, times - 1);
      return res;
    }
    return this.run(cmd, u, now);
  }

  run(cmd, u, now) {
    switch (cmd.type) {
      case 'build': return cmd.item === 'house' && !this.homeOf(u.id) ? this.home(cmd, u, now) : this.build(cmd, u, now);
      case 'home': return this.home(cmd, u, now);
      case 'help': return this.help(cmd, u, now);
      case 'upgrade':
        if (cmd.what === 'tools') return this.upgradeTools(u, now);
        if (cmd.id || cmd.item) return this.upgradeBuilding(cmd, u, now);
        if (cmd.raw) return this.refuse(u, now, 'Try !upgrade for your home, !upgrade tools for your bot, or !upgrade woodcutter (or #12) for a town building.');
        return this.upgrade(u, now);
      case 'stop': return this.stop(u, now);
      case 'work': return this.work(cmd, u, now);
      case 'explore': return this.explore(cmd, u, now);
      case 'repair': return this.repair(u, now);
      case 'deliver': return cmd.start ? this.startOrder(u, now) : this.deliver(u, now);
      case 'vote': return this.vote(cmd, u, now);
      case 'hat': return this.hat(cmd, u, now);
      case 'dance': return this.dance(u, now);
      case 'me': return this.me(u, now);
      case 'commands': return this.commands(now);
      case 'info': return this.info(cmd, u, now);
      case 'demolish': return this.refuse(u, now, 'Town buildings belong to everyone. Mods can !remove #id.');
      case 'remove': return this.remove(cmd, u);
      case 'event': return this.forceEvent(cmd, u, now);
      default: return { ok: false, message: 'Unknown command.' };
    }
  }

  enqueue(cmd, u, now, n) {
    const q = (this.state.queues[u.id] ||= []);
    const room = this.limits.queueMax - q.length;
    if (room <= 0) return this.refuse(u, now, 'Your bot has ' + q.length + ' jobs lined up already. !stop clears them.');
    const add = Math.min(n, room);
    const { times, ...one } = cmd;
    for (let i = 0; i < add; i++) q.push({ ...one });
    this.dirty = true;
    this.emit({ type: 'queue', userId: u.id, n: q.length });
    return { ok: true, queued: true, message: u.name + ' lined up ' + (add === 1 ? 'one more job' : add + ' more jobs') + ' (' + q.length + ' waiting).' };
  }

  // The bot finished a job: start the next one in line that can run.
  runQueue(uid, now) {
    const q = this.state.queues[uid];
    if (!q?.length) return;
    const name = this.state.builders[uid]?.name || uid;
    while (q.length && !this.state.jobs[uid]) {
      const res = this.apply(q.shift(), { id: uid, name }, now, true);
      if (res?.ok) break;
    }
    if (!q.length) delete this.state.queues[uid];
    this.dirty = true;
    this.emit({ type: 'queue', userId: uid, n: q.length });
  }

  stop(u, now) {
    const had = (this.state.queues[u.id] || []).length;
    delete this.state.queues[u.id];
    if (this.state.jobs[u.id]) this.endJob(u.id, false, now, false);
    this.emit({ type: 'queue', userId: u.id, n: 0 });
    return { ok: true, message: u.name + "'s bot stops" + (had ? ' and forgets ' + had + (had === 1 ? ' job' : ' jobs') : '') + '.' };
  }

  // --- Homes: one per viewer ----------------------------------------------------------
  home(cmd, u, now) {
    const s = this.state;
    const mine = this.homeOf(u.id);
    if (mine) return this.refuse(u, now, 'You already have a home (#' + mine.id + '). Make it bigger with !upgrade, or help the town: !help');
    if (this.builds.filter((b) => b.home && b.status === 'queued').length >= this.limits.maxQueue) return this.refuse(u, now, 'So many new homes at once! Try again in a minute.');
    const item = houseFor(s.era);
    let plot = this.choosePlot(item, { home: true, ownerId: u.id, salt: s.seq + 1 });
    const spare = plot ? null : this.spareFor(item, true);
    if (spare) plot = M.tileAt(this.map, spare.q, spare.r);
    if (!plot) return this.refuse(u, now, 'No free land for a home right now. Type !explore to find more!');
    this.touchBuilder(u, now);
    if (spare) this.makeWay(spare, item, now);
    const b = {
      id: ++s.seq,
      item,
      home: true,
      color: cmd.color || null,
      level: 1,
      q: plot.q,
      r: plot.r,
      ownerId: u.id,
      status: 'queued',
      requestedAt: now,
      startedAt: null,
      walkSec: WALK_BASE_SEC + plot.d * WALK_SEC_PER_RING,
      buildSec: HOME_BUILD_SEC,
      doneAt: null,
      cost: scaleCost(ITEMS[item].cost, HOME_COST),
      built: false,
    };
    this.builds.push(b);
    this.changed({ type: 'build', build: b });
    this.tick(now);
    const wait = b.status === 'queued' ? this.missingText(b.cost) : '';
    return { ok: true, message: u.name + ' is building their own home (#' + b.id + ')' + (wait ? ', waiting for ' + wait : '') + '. Welcome to BotWorld!', build: b };
  }

  upgrade(u, now) {
    const home = this.homeOf(u.id);
    if (!home) return this.refuse(u, now, 'You have no home yet. Type !home to build one!');
    if (home.status !== 'done') return this.refuse(u, now, 'Your home (#' + home.id + ') is still being built.');
    if ((home.level || 1) >= HOME_LEVELS) return this.refuse(u, now, 'Your home is as big as it gets in ' + ERAS[this.state.era].the + '. A new era makes it grow again!');
    const cost = scaleCost(ITEMS[home.item].cost, 0.4 * (home.level || 1));
    const tooBig = this.tooBigForStorage(cost);
    if (tooBig) return this.refuse(u, now, tooBig);
    this.touchBuilder(u, now);
    Object.assign(home, { status: 'queued', upgrade: { item: home.item, level: (home.level || 1) + 1 }, cost, requestedAt: now, startedAt: null, buildSec: 20 });
    this.changed({ type: 'build', build: home });
    this.tick(now);
    return { ok: true, message: u.name + ' is making their home bigger (level ' + home.upgrade.level + ').', build: home };
  }

  // !upgrade woodcutter, !upgrade #12: a town project that takes a building
  // to its next level. It keeps working while the upgrade is built.
  upgradeBuilding(cmd, u, now) {
    const s = this.state;
    let b = cmd.id ? this.builds.find((x) => x.id === cmd.id) : null;
    if (cmd.id && !b) return this.refuse(u, now, 'There is no building #' + cmd.id + '.');
    if (b?.home) return b.ownerId === u.id ? this.upgrade(u, now) : this.refuse(u, now, '#' + b.id + ' is someone\'s own home. Upgrade your own with !upgrade');
    if (!b) {
      const want = (x) => x.item === cmd.item || x.item === evolvedItem(cmd.item, s.era);
      const all = this.builds.filter((x) => !x.home && !x.wonder && x.built && want(x));
      if (!all.length) return this.refuse(u, now, 'The town has no ' + label(evolvedItem(cmd.item, s.era)) + ' yet. Start one: !build ' + cmd.item);
      const ready = all.filter((x) => x.status === 'done' && (x.level || 1) < BUILD_LEVELS);
      if (!ready.length) return this.refuse(u, now, all.some((x) => x.status !== 'done') ? 'That one is being built or upgraded right now. Help it: !help' : 'Every ' + label(all[0].item) + ' is at the top level already!');
      b = ready.sort((x, y) => (x.level || 1) - (y.level || 1) || (y.rich || 1) - (x.rich || 1) || x.id - y.id)[0];
    }
    const it = ITEMS[b.item];
    if (b.wonder) return this.refuse(u, now, 'Wonders are finished as they are.');
    if (b.status !== 'done') return this.refuse(u, now, 'The ' + label(b.item) + ' (#' + b.id + ') is being built right now. Help it: !help');
    const level = b.level || 1;
    if (level >= BUILD_LEVELS) return this.refuse(u, now, 'The ' + label(b.item) + ' (#' + b.id + ') is at the top level already!');
    const active = this.projects();
    if (active.length >= this.limits.maxProjects) return this.refuse(u, now, active.length + ' projects are being built already. Help finish one: !help');
    if (active.some((x) => (x.upgrade ? x.upgradeBy : x.founderId) === u.id)) return this.refuse(u, now, 'You started a project already. Help finish it first: !help');
    const cost = scaleCost(it.cost, 0.75 * (level + 1));
    const tooBig = this.tooBigForStorage(cost);
    if (tooBig) return this.refuse(u, now, tooBig);
    this.touchBuilder(u, now);
    Object.assign(b, {
      project: true,
      status: 'queued',
      upgrade: { item: b.item, level: level + 1 },
      upgradeBy: u.id,
      cost,
      requestedAt: now,
      startedAt: null,
      work: Math.round(it.buildSec * LABOR * 0.5 * level),
      progress: 0,
      crewBefore: b.helpers || {},
      helpers: {},
    });
    this.changed({ type: 'build', build: b });
    const job = s.jobs[u.id];
    if (!job || job.kind === 'gather') this.startJob(u, { buildId: b.id, kind: 'build', until: now + this.limits.shiftSec * 1000 }, now);
    this.tick(now);
    const wait = b.status === 'queued' ? this.missingText(b.cost) : '';
    return { ok: true, message: u.name + ' is upgrading the ' + label(b.item) + ' (#' + b.id + ') to level ' + (level + 1) + (wait ? '. It needs ' + wait : '') + '. Everyone can help: !help', build: b };
  }

  // !upgrade tools: a better tool for your own bot, paid by the town.
  upgradeTools(u, now) {
    const s = this.state;
    const me = s.builders[u.id];
    const tier = me?.tool || 0;
    const next = TOOLS[tier + 1];
    if (!next) return this.refuse(u, now, 'Your bot has the best tools there are!');
    const level = levelFor(me?.xp || 0);
    if (next.era > s.era) return this.refuse(u, now, next.label + ' come with ' + ERAS[next.era].the + '. Until then: !wood, !stone, !help');
    if (level < next.level) return this.refuse(u, now, next.label + ' need level ' + next.level + ', you are level ' + level + '. Every trip and every !help gives XP.');
    const missing = this.missing(next.cost);
    if (missing.length) return this.refuse(u, now, next.label + ' need ' + this.missingText(next.cost) + ' from the town storage.');
    for (const [r, n] of Object.entries(next.cost)) s.stock[r] -= n;
    const b = this.touchBuilder(u, now);
    b.tool = tier + 1;
    this.grant(u.id, 5, now);
    this.emit({ type: 'tools', userId: u.id, name: b.name, tool: b.tool });
    return { ok: true, message: u.name + "'s bot now has " + next.label.toLowerCase() + ': it carries ' + next.load + ' per trip and builds ' + Math.round((next.build - 1) * 100) + '% faster.' };
  }

  // --- Town projects: started by one, built by all --------------------------------------------
  build(cmd, u, now) {
    const s = this.state;
    if (!cmd.item) return this.refuse(u, now, 'Try !build ' + itemsOfEra(s.era)[1] + '. In ' + ERAS[s.era].the + ' the town can build: ' + itemsOfEra(s.era).join(', ') + '.');
    const item = cmd.item === 'house' ? houseFor(s.era) : cmd.item;
    const it = ITEMS[item];
    if (it.era > s.era) return this.refuse(u, now, it.label + ' arrives in ' + ERAS[it.era].the + '. For now try: ' + itemsOfEra(s.era).slice(0, 5).join(', ') + '.');
    const active = this.projects();
    const urgent = this.urgentRoom(item, active);
    if (active.length >= this.limits.maxProjects && !urgent) {
      return this.refuse(u, now, active.length + ' projects are being built already (' + active.map((b) => '#' + b.id + ' ' + label(b.item)).join(', ') + '). Help finish one: !help');
    }
    const own = active.find((b) => (b.upgrade ? b.upgradeBy : b.founderId) === u.id);
    if (own) return this.refuse(u, now, 'You started the ' + label(own.item) + ' (#' + own.id + '). Help finish it first: !help');
    const tooBig = this.tooBigForStorage(it.cost);
    if (tooBig) return this.refuse(u, now, tooBig);
    let plot = this.choosePlot(item, { near: cmd.near, dir: cmd.dir, ownerId: u.id, salt: s.seq + 1 });
    const spare = plot ? null : this.spareFor(item, this.needed(item, now));
    if (spare) plot = M.tileAt(this.map, spare.q, spare.r);
    if (!plot) {
      const why = M.siteOf(item).why;
      if (this.explored()) return this.refuse(u, now, 'The town is full! ' + (this.happy < E.CONTENT ? 'People want their parks: old buildings only make way for what the town needs now (see the plan).' : 'Nothing left that can make way for ' + withArticle(label(item)) + '.') + ' Or !upgrade a building to get more out of it.');
      return this.refuse(u, now, why ? withArticle(it.label) + ' needs ' + why + ' and the town has not found one yet. Type !explore to search the fog!' : 'No free land left nearby. Type !explore to find more, or !upgrade a building to get more out of it!');
    }
    this.touchBuilder(u, now);
    if (spare) this.makeWay(spare, item, now);
    const b = {
      id: ++s.seq,
      item,
      project: true,
      color: cmd.color || null,
      level: 1,
      q: plot.q,
      r: plot.r,
      ownerId: null,
      founderId: u.id,
      status: 'queued',
      requestedAt: now,
      startedAt: null,
      walkSec: 0,
      buildSec: it.buildSec,
      work: it.buildSec * LABOR,
      progress: 0,
      helpers: {},
      doneAt: null,
      cost: { ...it.cost },
      built: false,
    };
    if (urgent && active.length >= this.limits.maxProjects) b.urgent = true;
    this.placeStats(b);
    this.builds.push(b);
    this.changed({ type: 'build', build: b });
    const job = s.jobs[u.id];
    if (!job || job.kind === 'gather') this.startJob(u, { buildId: b.id, kind: 'build', until: now + this.limits.shiftSec * 1000 }, now);
    this.tick(now);
    const what = (b.color ? b.color + ' ' : '') + label(item);
    const wait = b.status === 'queued' ? this.missingText(b.cost) : '';
    return { ok: true, message: u.name + ' started ' + withArticle(what) + ' (#' + b.id + ')' + (wait ? '. It needs ' + wait : '') + '. Everyone can help: !help', build: b };
  }

  // What the town is stuck on (the wonder, food, power, a waiting project)
  // may always start, one over the limit, so a full list of projects never
  // blocks the way to the next era.
  urgentRoom(item, active = this.projects(), needs = this.econ?.needs || []) {
    if (active.length < this.limits.maxProjects) return true;
    if (active.length > this.limits.maxProjects || active.some((b) => b.urgent)) return false;
    return needs.some((n) => n.item === item && URGENT.has(n.why));
  }

  // The project that needs hands most: one being built, with the fewest helpers.
  pickProject() {
    return this.projects().sort((a, b) => (a.status === 'building' ? 0 : 1) - (b.status === 'building' ? 0 : 1) || this.helpersAt(a.id) - this.helpersAt(b.id) || a.id - b.id)[0] || null;
  }

  help(cmd, u, now) {
    const s = this.state;
    const job = s.jobs[u.id];
    if (job && job.kind === 'explore') return this.refuse(u, now, 'Your bot is out exploring. It is back soon!');
    let target = cmd.id ? this.builds.find((b) => b.id === cmd.id) : null;
    if (cmd.target === 'wonder' || target?.wonder) return this.helpWonder(u, now);
    if (cmd.id && (!target || target.status === 'done')) return this.refuse(u, now, 'There is no project #' + cmd.id + ' to help with. See the projects on screen, or just type !help');
    if (target && target.home) return this.refuse(u, now, '#' + target.id + ' is someone\'s own home. Help a town project instead: !help');
    if (!target) target = this.pickProject();
    if (!target) {
      const w = this.currentWonder();
      if (w && w.status !== 'done') return this.helpWonder(u, now);
      return this.commands(now, u);
    }
    if (target.status === 'queued' && target.waitingFor?.length) {
      const r = target.waitingFor[0];
      if (this.handCmd(r) || this.builds.some((b) => E.isUp(b) && ITEMS[b.item].recipe?.out?.[r])) {
        const res2 = this.work({ type: 'work', target: r }, u, now);
        if (res2.ok) res2.message = 'The ' + label(target.item) + ' is waiting for ' + res(r) + ', so ' + u.name + ' goes to make some.';
        return res2;
      }
    }
    if (job && job.kind === 'build' && job.buildId === target.id) return { ok: false, message: 'Your bot is already helping (#' + target.id + ').' };
    if (this.helpersAt(target.id) >= this.limits.maxHelpers) return this.refuse(u, now, 'The ' + label(target.item) + ' has enough helpers. Try another project or !explore');
    if (job) this.endJob(u.id, false, now, false);
    return this.startJob(u, { buildId: target.id, kind: 'build', until: now + this.limits.shiftSec * 1000 }, now, ITEMS[target.item].label);
  }

  helpWonder(u, now) {
    const w = this.currentWonder();
    if (!w || w.status === 'done') return this.refuse(u, now, 'The wonder is finished! Try !help or !explore.');
    if (this.helpersAt(w.id) >= WONDER_HELPERS) return this.refuse(u, now, 'The wonder has enough haulers right now. Try !help');
    const job = this.state.jobs[u.id];
    if (job && job.kind !== 'gather' && job.kind !== 'build') return this.refuse(u, now, 'Your bot is busy right now (#' + (job.buildId || '…') + ').');
    if (job) this.endJob(u.id, false, now, false);
    return this.startJob(u, { buildId: w.id, kind: 'wonder', until: now + this.limits.shiftSec * 1000 }, now, this.wonderTitle(w));
  }

  // !deliver start (moderators): the Guild posts its next order right away.
  startOrder(u, now) {
    if (!u.mod && !u.broadcaster) return { ok: false, message: '' };
    if (!this.rival || !this.limits.contracts) return { ok: false, message: 'The Merchant Guild does not trade here.' };
    const c = this.state.contract;
    if (c && !c.winner) return { ok: false, message: 'A Guild order is open already.' };
    this.state.contract = null;
    this.state.nextContractAt = now;
    return { ok: true, message: 'The Merchant Guild posts an order in a moment.' };
  }

  // !deliver: one trip with crates to the Merchant Guild's wagon.
  deliver(u, now) {
    const s = this.state;
    const c = s.contract;
    if (!this.rival || !c || c.winner) {
      const mins = Math.max(1, Math.round((s.nextContractAt - now) / 60e3));
      return this.refuse(u, now, this.rival && this.limits.contracts ? 'No Guild order right now. The next one comes in about ' + mins + ' minutes.' : 'The Merchant Guild does not trade here.');
    }
    if ((s.stock[c.res] || 0) < 1) {
      const hand = this.handCmd(c.res);
      return this.refuse(u, now, 'The town has no ' + res(c.res) + ' to deliver. Make some first: ' + (hand || '!work ' + c.res));
    }
    const job = s.jobs[u.id];
    if (job && job.kind !== 'gather') return this.refuse(u, now, 'Your bot is busy right now.');
    if (job) this.endJob(u.id, false, now, false);
    c.haulers[u.id] = (c.haulers[u.id] || 0) + 1;
    return this.startJob(u, { kind: 'deliver', res: c.res, until: now + this.limits.deliverSec * 1000 }, now);
  }

  remove(cmd, u) {
    if (!u.mod && !u.broadcaster) return { ok: false, message: '' };
    const b = this.builds.find((x) => x.id === cmd.id);
    if (!b || b.wonder) return { ok: false, message: 'No build #' + cmd.id + '.' };
    this.removeBuild(b.id);
    return { ok: true, message: 'Removed #' + cmd.id + '.' };
  }

  removeBuild(id, now = Date.now()) {
    const i = this.builds.findIndex((b) => b.id === id);
    if (i < 0) return;
    this.builds.splice(i, 1);
    for (const [uid, job] of Object.entries(this.state.jobs)) if (job.buildId === id) this.endJob(uid, false, now);
    this.progress.delete(id);
    this.changed({ type: 'remove', id });
  }

  // A new era: buildings with a modern version rebuild themselves, and every
  // home becomes the new kind of home.
  evolve(now) {
    const s = this.state;
    let n = 0;
    for (const b of this.builds) {
      if (b.wonder || !b.built || b.status !== 'done') continue;
      const to = b.home ? houseFor(s.era) : evolvedItem(b.item, s.era);
      if (to === b.item) continue;
      Object.assign(b, { status: 'building', upgrade: { item: to, level: b.home ? 1 : b.level || 1 }, cost: {}, requestedAt: now, startedAt: now, walkSec: 0, buildSec: 15 + (n % 6) * 5, evolving: true });
      this.changed({ type: 'build', build: b });
      n++;
    }
    return n;
  }

  // --- Exploring the fog ---------------------------------------------------------------------
  explore(cmd, u, now) {
    const s = this.state;
    if (cmd.raw && !cmd.dir) return this.refuse(u, now, 'Try !explore, or pick a way: !explore north, east, south or west.');
    const job = s.jobs[u.id];
    if (job && job.kind !== 'gather') return this.refuse(u, now, job.kind === 'explore' ? 'Your bot is already out exploring!' : 'Your bot is busy (#' + job.buildId + '). Try again when it is done.');
    const map = this.map;
    const front = M.frontier(map, this.bits).filter((t) => M.walkable(t) || M.neighborsOf(map, t).some((n) => this.known(n) && M.walkable(n)));
    let cands = front;
    if (cmd.dir) {
      const want = M.DIRECTIONS[cmd.dir];
      cands = front.filter((t) => Math.abs(Math.atan2(Math.sin(M.angleOf(t) - want), Math.cos(M.angleOf(t) - want))) < 0.7);
    }
    if (!cands.length) return this.refuse(u, now, cmd.dir ? 'Nothing left to find to the ' + cmd.dir + '. Try another way!' : 'The whole world is explored!');
    const taken = Object.values(s.jobs).filter((j) => j.kind === 'explore');
    const score = (t) => t.d + ((hashStr(u.id + ':' + now + ':' + t.i) % 1000) / 1000) * 4 + (taken.some((j) => hexDist(j.q - t.q, j.r - t.r) <= 3) ? 6 : 0);
    const target = cands.reduce((best, t) => (score(t) < score(best) ? t : best), cands[0]);
    const secs = 12 + 2.5 * target.d;
    this.startJob(u, { kind: 'explore', q: target.q, r: target.r, until: now + secs * 1000 }, now);
    const way = cmd.dir || compass(M.angleOf(target));
    return { ok: true, message: u.name + ' sets off to explore the ' + way + '. Back in about ' + Math.round(secs) + ' seconds!' };
  }

  finishExplore(uid, job, now) {
    const tiles = M.reveal(this.map, this.bits, job.q, job.r, M.SCOUT_RADIUS);
    const found = this.discover(tiles, now);
    this.checkMet(tiles);
    this.saveBits();
    const b = this.state.builders[uid];
    if (b) b.trips = (b.trips || 0) + 1;
    this.grant(uid, 6 + 4 * found.length, now);
    this.changed({ type: 'explore', userId: uid, name: this.nameOf(uid), at: { q: job.q, r: job.r }, tiles: tiles.map((t) => t.i), found });
  }

  // What the newly seen land holds: ore to mine, ruins with goods, old
  // tablets full of knowledge.
  discover(tiles, now) {
    const s = this.state;
    const found = [];
    for (const t of tiles) {
      if (!t.f) continue;
      const key = hexKey(t.q, t.r);
      if (t.f === 'coal' || t.f === 'iron') found.push({ f: t.f, q: t.q, r: t.r });
      else if (!s.found.includes(key)) {
        s.found.push(key);
        if (t.f === 'ruins') found.push({ f: 'ruins', q: t.q, r: t.r, gift: this.gift(0.08) });
        else if (t.f === 'tablet') {
          s.knowledge = Math.min(this.knowledgeNeed(), s.knowledge + 120);
          found.push({ f: 'tablet', q: t.q, r: t.r });
        }
      }
    }
    void now;
    return found;
  }

  revealAround(b) {
    const it = ITEMS[b.item];
    const rad = it.reveal || (b.item === 'lighthouse' || b.item === 'tower' ? 5 : 2);
    const tiles = M.reveal(this.map, this.bits, b.q, b.r, rad);
    if (!tiles.length) return;
    const found = this.discover(tiles, Date.now());
    this.checkMet(tiles);
    this.saveBits();
    this.changed({ type: 'explore', userId: null, name: null, at: { q: b.q, r: b.r }, tiles: tiles.map((t) => t.i), found });
  }

  // --- Jobs: bots helping build, making goods, hauling, repairing, exploring -----------------
  work(cmd, u, now) {
    const s = this.state;
    const job = s.jobs[u.id];
    if (job && job.kind !== 'gather' && job.kind !== 'build' && job.kind !== 'hand') return this.refuse(u, now, job.kind === 'explore' ? 'Your bot is out exploring!' : 'Your bot is already working (#' + job.buildId + ').');
    let target = cmd.target;
    if (!target && cmd.raw) return this.refuse(u, now, 'Try !wood, !stone, !food, or !help to build.');
    if (!target) target = this.suggestWork(u.id);
    if (target === 'wonder') return this.helpWonder(u, now);
    if (!RESOURCES[target]) return this.refuse(u, now, 'Try !wood, !stone, !food, or !help to build.');
    if (M.GATHER[cmd.how || target]) return this.gather(u, cmd.how || target, now);
    const makers = this.builds.filter((b) => E.isUp(b) && ITEMS[b.item].recipe?.out?.[target] && (!b.ores || b.ores.includes(target)));
    if (!makers.length) {
      const who = RESOURCES[target].from;
      if (RESOURCES[target].era > s.era) return this.refuse(u, now, RESOURCES[target].label + ' arrives in ' + ERAS[RESOURCES[target].era].the + '.');
      return this.refuse(u, now, 'Nobody makes ' + res(target) + ' yet. Start ' + withArticle(label(who)) + ': !build ' + who);
    }
    const open = makers.filter((b) => this.helpersAt(b.id) < E.MAX_HELPERS);
    if (!open.length) return this.refuse(u, now, 'Every place that makes ' + res(target) + ' has helpers already. Try !help');
    const least = Math.min(...open.map((b) => this.helpersAt(b.id)));
    const pickFrom = open.filter((b) => this.helpersAt(b.id) === least);
    const b = pickFrom[hashStr(u.id + ':' + now) % pickFrom.length];
    if (job) this.endJob(u.id, false, now, false);
    return this.startJob(u, { buildId: b.id, kind: 'work', res: target, until: now + this.limits.workShiftSec * 1000 }, now, ITEMS[b.item].label);
  }

  // !wood, !stone, !food, !fish, !coal, !iron: the bot walks out to the right
  // land, gathers by hand and brings a load to town every couple of minutes.
  gather(u, kind, now) {
    const s = this.state;
    let spots = this.gatherSpots(kind);
    if (kind === 'food' && !spots.length) { kind = 'fish'; spots = this.gatherSpots(kind); }
    const g = M.GATHER[kind];
    const r = g.res;
    if (RESOURCES[r].era > s.era) return this.refuse(u, now, RESOURCES[r].label + ' arrives in ' + ERAS[RESOURCES[r].era].the + '.');
    if (!spots.length) return this.refuse(u, now, 'Nobody has found ' + g.land + ' yet. Try !explore');
    const t = spots[hashStr(u.id + ':' + Math.floor(now / 1000)) % spots.length];
    if (s.jobs[u.id]) this.endJob(u.id, false, now, false);
    // One trip: out to the land, work, back to the nearest store with the load.
    const out = Math.round(M.walkSec(t, this.dropFor(t)));
    const work = M.HAND_WORK_SEC;
    return this.startJob(u, { kind: 'hand', res: r, pose: g.pose, q: t.q, r: t.r, out, work, until: now + (2 * out + work) * 1000 }, now, g.verb + ' in ' + g.land);
  }

  // Where gatherers take their load: the nearest store, or the landing pad.
  dropFor(t) {
    let best = { q: 0, r: 0 };
    let bd = hexDist(t.q, t.r);
    for (const b of this.stores()) {
      const d = hexDist(b.q - t.q, b.r - t.r);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  // How much of each producer's goods reach town, worked out again only
  // when the stores (or the buildings) change.
  reachMap() {
    const stores = this.stores();
    const key = stores.map((b) => b.id || 0).join(',') + '|' + this.builds.length + '|' + this.state.seq;
    if (this.reachCache?.key === key) return this.reachCache.map;
    const map = new Map();
    for (const b of this.builds) if (ITEMS[b.item].recipe) map.set(b.id, reachOf(b, stores));
    this.reachCache = { key, map };
    return map;
  }

  // The landing pad and every working store (outposts too).
  stores() {
    return [{ q: 0, r: 0 }].concat(this.builds.filter((b) => E.isUp(b) && ITEMS[b.item].kind === 'storage'));
  }

  gatherSpots(kind) {
    const taken = new Set(this.rivalLand());
    for (const b of this.builds) { const t = M.tileAt(this.map, b.q, b.r); if (t) taken.add(t.i); }
    return M.gatherSpots(this.map, kind, this.known, taken);
  }

  // A finished building that makes this good (or power) and can go up a level.
  upgradable(r) {
    return this.builds.find((b) => !b.home && !b.wonder && b.status === 'done' && b.built && (b.level || 1) < BUILD_LEVELS && !this.starved[b.id] && (r === 'power' ? ITEMS[b.item].power > 0 : ITEMS[b.item].recipe?.out?.[r] && (!b.ores || b.ores.includes(r)))) || null;
  }

  // The command that gathers this good by hand, if the town knows where.
  handCmd(r) {
    if (!M.GATHER[r] || RESOURCES[r].era > this.state.era) return null;
    if (this.gatherSpots(r).length || (r === 'food' && this.gatherSpots('fish').length)) return '!' + r;
    return null;
  }

  handDeliver(uid, job, now) {
    const s = this.state;
    const me = s.builders[uid];
    const ev = this.activeEvent(now);
    const n = toolsOf(me).load * (ev?.boost?.[job.res] || 1);
    const add = Math.max(0, Math.min(n, E.capacity(this.builds) - (s.stock[job.res] || 0)));
    s.stock[job.res] = (s.stock[job.res] || 0) + add;
    this.handMade[job.res] = (this.handMade[job.res] || 0) + add;
    if (me) me.gathered = (me.gathered || 0) + add;
    this.dirty = true;
    this.emit({ type: 'gathered', userId: uid, res: job.res, n: add, full: add < n });
  }

  suggestWork(userId) {
    const mine = this.builds.find((b) => (b.founderId === userId || b.ownerId === userId) && b.status === 'queued' && b.waitingFor?.length);
    if (mine) return mine.waitingFor[0];
    const any = this.projects().find((b) => b.waitingFor?.length);
    if (any) return any.waitingFor[0];
    const w = this.currentWonder();
    const cap = this.econ ? this.econ.cap : E.BASE_CAP;
    const short = (this.wonderShort || []).find((r) => this.builds.some((b) => E.isUp(b) && ITEMS[b.item].recipe?.out?.[r]));
    if (short && rndPick(userId) < 0.6) return short;
    if (w && w.status !== 'done' && this.helpersAt(w.id) < WONDER_HELPERS) return 'wonder';
    const makeable = E.unlockedResources(this.state.era).filter((r) => this.handCmd(r) || this.builds.some((b) => E.isUp(b) && ITEMS[b.item].recipe?.out?.[r]));
    makeable.sort((a, b) => (this.state.stock[a] || 0) / cap - (this.state.stock[b] || 0) / cap);
    return makeable[0] || 'wood';
  }

  startJob(u, job, now, where) {
    this.touchBuilder(u, now);
    job.startedAt = now;
    this.state.jobs[u.id] = job;
    this.changed({ type: 'job', userId: u.id, job });
    if (job.kind === 'explore') return { ok: true, message: u.name + ' sets off to explore.' };
    if (job.kind === 'deliver') return { ok: true, message: u.name + ' hauls ' + toolsOf(this.state.builders[u.id]).load + ' crates of ' + res(job.res) + ' to the Guild wagon.' };
    if (job.kind === 'hand') return { ok: true, message: u.name + ' goes out to ' + where + ' and brings back ' + toolsOf(this.state.builders[u.id]).load + ' ' + res(job.res) + ' in about ' + Math.round((job.until - now) / 1000) + ' seconds.' };
    if (job.kind === 'wonder') return { ok: true, message: u.name + ' is hauling goods to ' + where + ' (#' + job.buildId + ').' };
    const verb = { repair: 'is repairing the', build: 'is helping build the' }[job.kind] || 'is helping at the';
    return { ok: true, message: u.name + ' ' + verb + ' ' + (where || 'town') + ' (#' + job.buildId + ').' };
  }

  // next: start the next job in line (not when the bot is switched to
  // another job right away).
  endJob(userId, finished, now, next = true) {
    const job = this.state.jobs[userId];
    if (!job) return;
    delete this.state.jobs[userId];
    const b = job.buildId ? this.builds.find((x) => x.id === job.buildId) : null;
    if (finished) {
      if (job.kind === 'repair' && b) {
        b.damaged = false;
        delete b.repairBy;
        this.changed({ type: 'build', build: b });
        this.emit({ type: 'notice', kind: 'repair', user: this.nameOf(userId), text: 'repaired the ' + label(b.item) + ' (#' + b.id + ')' });
      }
      this.grant(userId, { work: 3, hand: 2, wonder: 3, repair: 10, gather: 2, build: 2, deliver: 3 }[job.kind] || 0, now);
    } else if (job.kind === 'repair' && b) delete b.repairBy;
    this.changed({ type: 'job', userId, job: null });
    if (next && now != null) this.runQueue(userId, now);
  }

  helpersAt(buildId) {
    let n = 0;
    for (const j of Object.values(this.state.jobs)) if (j.buildId === buildId) n++;
    return n;
  }

  repair(u, now) {
    const s = this.state;
    const job = s.jobs[u.id];
    if (job && job.kind !== 'gather' && job.kind !== 'build') return this.refuse(u, now, 'Your bot is busy right now.');
    const broken = this.builds.filter((b) => b.damaged && !b.repairBy).sort((a, b) => a.id - b.id);
    if (!broken.length) return this.refuse(u, now, 'Nothing is broken right now!');
    const b = broken[0];
    if (job) this.endJob(u.id, false, now, false);
    b.repairBy = u.id;
    this.changed({ type: 'build', build: b });
    return this.startJob(u, { buildId: b.id, kind: 'repair', until: now + this.limits.repairSec * 1000 }, now, label(b.item));
  }

  // A viewer whose build waits for goods sends their bot to help make them.
  autoGather(b, now) {
    const s = this.state;
    const uid = b.home ? b.ownerId : b.founderId;
    if (!uid || !s.builders[uid] || (s.jobs[uid] && s.jobs[uid].kind !== 'build') || !b.waitingFor?.length) return;
    if (s.jobs[uid] && s.jobs[uid].buildId !== b.id) return;
    for (const r of b.waitingFor) {
      const maker = this.builds.find((x) => E.isUp(x) && ITEMS[x.item].recipe?.out?.[r] && this.helpersAt(x.id) < E.MAX_HELPERS);
      if (maker) {
        s.jobs[uid] = { buildId: maker.id, kind: 'gather', res: r, until: now + 30 * 60e3, startedAt: now, forBuild: b.id };
        this.changed({ type: 'job', userId: uid, job: s.jobs[uid] });
        return;
      }
    }
  }

  // --- Votes and events --------------------------------------------------------------
  vote(cmd, u, now) {
    const v = this.state.vote;
    // Mods can start a vote right away with !vote start (a wonder to choose
    // comes first).
    if (cmd.start) {
      if (!u.mod && !u.broadcaster) return { ok: false, message: '' };
      if (v) return { ok: false, message: 'A vote is already running.' };
      const due = this.wonderPickDue();
      if (due != null) {
        this.startWonderVote(due, now);
        return { ok: true, message: 'Wonder vote started: !1 or !2.' };
      }
      if (this.state.event) { this.state.event = null; this.changed({ type: 'event', event: null }); }
      this.startVote(now);
      return { ok: true, message: 'Vote started: !1, !2 or !3.' };
    }
    if (!v) {
      const mins = Math.max(1, Math.round((this.state.nextVoteAt - now) / 60e3));
      return this.refuse(u, now, 'No vote right now. The next one starts in about ' + mins + ' min.');
    }
    const n = v.options.length;
    if (!cmd.option || cmd.option > n) return this.refuse(u, now, n === 2 ? 'Vote with !vote 1 or !vote 2.' : 'Vote with !vote 1, !vote 2 or !vote 3.');
    const first = v.votes[u.id] == null;
    v.votes[u.id] = cmd.option - 1;
    if (first && this.state.builders[u.id]) this.grant(u.id, 1, now);
    this.changed({ type: 'vote', vote: this.voteView() });
    const key = v.options[cmd.option - 1];
    return { ok: true, message: u.name + ' voted for ' + (v.kind === 'wonder' ? theName(key) : EVENTS[key].label) + '.' };
  }

  voteView() {
    const v = this.state.vote;
    if (!v) return null;
    const counts = v.options.map(() => 0);
    for (const i of Object.values(v.votes)) counts[i]++;
    const view = { kind: v.kind || 'event', options: v.options, counts, endsAt: v.endsAt };
    if (v.kind === 'wonder') Object.assign(view, { era: v.era, rival: this.rival ? this.rival.s.name : null });
    return view;
  }

  // --- Which wonder: chat chooses, the rival builds the other ----------------------------
  // The first era, from the town's own up to the furthest town, whose wonder
  // chat has not chosen yet. Eras behind the town are done (a save from
  // before the eras of history skipped the Roman Empire: no vote for it).
  wonderPickDue() {
    const s = this.state;
    const top = Math.max(s.era, this.rival ? this.rival.s.era : 0);
    for (let e = s.era; e <= top; e++) if (!s.picks[e]) return e;
    return null;
  }

  startWonderVote(era, now) {
    const [a, b] = wondersOf(era);
    this.state.vote = { kind: 'wonder', era, options: [a, b], votes: {}, startedAt: now, endsAt: now + this.limits.wonderVoteSec * 1000 };
    const ahead = this.rival && this.rival.s.era >= era && this.state.era < era ? this.rival.s.name + ' reached ' + ERAS[era].the + '! ' : '';
    const from = (k) => (ITEMS[k].place ? ' (' + ITEMS[k].place + ')' : '');
    const text = ahead + 'Which wonder will BotWorld build in ' + ERAS[era].the + '? !vote 1 ' + TheName(a) + from(a) + ' or !vote 2 ' + TheName(b) + from(b) + (this.rival ? '. ' + this.rival.s.name + ' builds the other one.' : '.');
    this.emit({ type: 'notice', kind: 'wondervote', text });
    this.changed({ type: 'vote', vote: this.voteView() });
  }

  // Chat chose (or, with nobody voting, chance did): the town builds key,
  // the rival the other one.
  pickWonder(era, key, now, how = 'vote') {
    const s = this.state;
    if (s.picks[era]) return;
    s.picks[era] = key;
    const w = this.builds.find((b) => b.wonder && ITEMS[b.item].era === era);
    if (w) {
      w.item = key;
      delete w.pending;
      this.changed({ type: 'build', build: w });
    }
    const other = otherWonder(key);
    if (this.rival) this.rival.pickWonder(era, other);
    if (s.vote?.kind === 'wonder' && s.vote.era === era) {
      s.vote = null;
      this.changed({ type: 'vote', vote: null });
    }
    const theirs = this.rival ? ' ' + this.rival.s.name + ' builds ' + theName(other) + '.' : '';
    const text = how === 'vote'
      ? 'Chat chose ' + theName(key) + ' for ' + ERAS[era].the + '!' + theirs
      : 'BotWorld builds ' + theName(key) + ' in ' + ERAS[era].the + '.' + theirs;
    this.emit({ type: 'notice', kind: 'wonderpick', era, item: key, other, how, text });
    this.dirty = true;
  }

  // A wonder finished before chat had chosen: the votes cast so far decide,
  // or chance when nobody voted.
  autoPick(era, now) {
    if (this.state.picks[era]) return;
    const v = this.state.vote;
    if (v?.kind === 'wonder' && v.era === era) return this.resolveWonderVote(this.voteView(), now);
    const options = wondersOf(era);
    this.pickWonder(era, options[Math.floor(Math.random() * options.length)], now, 'auto');
  }

  eligibleEvents() {
    return Object.keys(EVENTS).filter((k) => (EVENTS[k].minEra || 0) <= this.state.era);
  }

  startVote(now) {
    const pool = this.eligibleEvents();
    const calm = pool.filter((k) => !EVENTS[k].chaos).sort(() => Math.random() - 0.5);
    const wild = pool.filter((k) => EVENTS[k].chaos).sort(() => Math.random() - 0.5);
    const options = Math.random() < 0.6 && wild.length ? [calm[0], calm[1], wild[0]] : calm.slice(0, 3);
    this.state.vote = { kind: 'event', options: options.sort(() => Math.random() - 0.5), votes: {}, startedAt: now, endsAt: now + this.limits.voteSec * 1000 };
    this.changed({ type: 'vote', vote: this.voteView() });
  }

  resolveVote(now) {
    const view = this.voteView();
    if (view.kind === 'wonder') return this.resolveWonderVote(view, now);
    this.state.vote = null;
    this.state.nextVoteAt = now + this.limits.voteEveryMin * 60e3;
    const best = Math.max(...view.counts);
    if (best === 0) {
      this.changed({ type: 'vote', vote: null, winner: null });
      return;
    }
    const top = view.options.filter((_, i) => view.counts[i] === best);
    const winner = top[Math.floor(Math.random() * top.length)];
    this.changed({ type: 'vote', vote: null, winner });
    this.startEvent(winner, now);
  }

  resolveWonderVote(view, now) {
    const s = this.state;
    s.vote = null;
    // Events wait a little after a wonder vote, so the two never pile up.
    s.nextVoteAt = Math.max(s.nextVoteAt, now + 15 * 60e3);
    const best = Math.max(...view.counts);
    const top = view.options.filter((_, i) => view.counts[i] === best);
    const winner = top[Math.floor(Math.random() * top.length)];
    this.changed({ type: 'vote', vote: null, winner, kind: 'wonder' });
    this.pickWonder(view.era, winner, now, best > 0 ? 'vote' : 'auto');
  }

  forceEvent(cmd, u, now) {
    if (!u.mod && !u.broadcaster) return { ok: false, message: '' };
    if (!cmd.key) return { ok: false, message: 'Events: ' + Object.keys(EVENTS).join(', ') };
    if (this.state.vote && this.state.vote.kind !== 'wonder') { this.state.vote = null; this.changed({ type: 'vote', vote: null, winner: null }); }
    this.startEvent(cmd.key, now);
    return { ok: true, message: 'Started ' + EVENTS[cmd.key].label + '.' };
  }

  startEvent(key, now) {
    const ev = EVENTS[key];
    const s = this.state;
    s.event = { key, startedAt: now, endsAt: now + ev.mins * 60e3 };
    const extra = {};
    if (ev.gift) extra.gift = this.gift(0.1);
    if (ev.knowledgeMin) s.knowledge = Math.min(this.knowledgeNeed(), s.knowledge + ev.knowledgeMin);
    if (ev.damage) extra.damaged = this.damage(ev.damage, ev.damageKind);
    this.changed({ type: 'event', event: s.event, ...extra });
  }

  // A fair gift of the two goods the town has least of.
  gift(share) {
    const s = this.state;
    const cap = E.capacity(this.builds);
    const out = {};
    const rs = E.unlockedResources(s.era).sort((a, b) => (s.stock[a] || 0) - (s.stock[b] || 0)).slice(0, 2);
    for (const r of rs) {
      const n = Math.max(0, Math.min(Math.round(cap * share), 30 + 30 * s.era, cap - (s.stock[r] || 0)));
      if (n > 0) { s.stock[r] = (s.stock[r] || 0) + n; out[r] = n; }
    }
    return out;
  }

  damage(n, kind) {
    const pool = this.builds.filter((b) => b.built && b.status === 'done' && !b.wonder && !b.damaged && (!kind || ITEMS[b.item].kind === kind));
    const hit = [];
    for (let i = 0; i < n && pool.length; i++) {
      const b = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      b.damaged = true;
      hit.push(b.id);
      this.changed({ type: 'build', build: b });
    }
    return hit;
  }

  updateVotes(now) {
    const s = this.state;
    if (s.vote && now >= s.vote.endsAt) this.resolveVote(now);
    if (s.event && now >= s.event.endsAt) {
      s.event = null;
      this.changed({ type: 'event', event: null });
    }
    // A wonder to choose comes before any event vote, as soon as someone
    // is around to vote.
    const due = this.wonderPickDue();
    if (due != null && !s.vote) {
      for (const t of this.recent.values()) {
        if (now - t < 30 * 60e3) { this.startWonderVote(due, now); break; }
      }
    }
    if (!s.vote && !s.event && due == null && now >= s.nextVoteAt) {
      let active = 0;
      for (const t of this.recent.values()) if (now - t < 30 * 60e3) active++;
      if (active >= 2) this.startVote(now);
      else s.nextVoteAt = now + 10 * 60e3;
    }
    if (!s.vote && !s.event && now >= s.nextAutoEventAt) {
      s.nextAutoEventAt = now + this.limits.autoEventEveryMin * 60e3 * (0.7 + Math.random() * 0.6);
      const seen = Object.values(s.builders).some((b) => now - b.lastSeen < DAY);
      if (seen) {
        const calm = this.eligibleEvents().filter((k) => !EVENTS[k].chaos);
        this.startEvent(calm[Math.floor(Math.random() * calm.length)], now);
      }
    }
  }

  activeEvent(now) {
    const e = this.state.event;
    return e && now < e.endsAt ? EVENTS[e.key] : null;
  }

  // --- Small commands --------------------------------------------------------------------
  hat(cmd, u, now) {
    if (!cmd.hat) return this.refuse(u, now, 'Hats: ' + Object.keys(HATS).join(', ') + '.');
    const builder = this.touchBuilder(u, now);
    const level = levelFor(builder.xp || 0);
    if (HATS[cmd.hat].level > level) return this.refuse(u, now, 'The ' + HATS[cmd.hat].label.toLowerCase() + ' unlocks at level ' + HATS[cmd.hat].level + '. You are level ' + level + '.');
    if (this.onCooldown('hat:' + u.id, this.limits.hatCooldownSec, now)) return { ok: false, message: 'Hold on, still trying on the last hat.' };
    builder.hat = cmd.hat;
    this.emit({ type: 'builder', builder, joined: false });
    return { ok: true, message: u.name + ' now wears: ' + HATS[cmd.hat].label + '.' };
  }

  dance(u, now) {
    if (this.onCooldown('dance:' + u.id, this.limits.danceCooldownSec, now)) return { ok: false, message: 'Your bot needs a breather.' };
    this.touchBuilder(u, now);
    this.emit({ type: 'dance', userId: u.id });
    return { ok: true, message: u.name + ' is dancing!' };
  }

  me(u, now) {
    if (this.onCooldown('me:' + u.id, this.limits.meCooldownSec, now)) return { ok: false, message: '' };
    this.touchBuilder(u, now);
    const card = this.card(u.id, now);
    this.emit({ type: 'me', card });
    const home = card.home ? 'home #' + card.home.id : 'no home yet (!home)';
    return { ok: true, message: u.name + ': level ' + card.level + ' ' + card.title + ', ' + home + ', helped build ' + card.built + (card.built === 1 ? ' building.' : ' buildings.') };
  }

  card(id, now) {
    const b = this.state.builders[id];
    const xp = b.xp || 0;
    const level = levelFor(xp);
    const ranked = this.leaders(now, 1000);
    const rank = ranked.findIndex((x) => x.id === id) + 1;
    const home = this.homeOf(id);
    return {
      id,
      name: b.name,
      color: b.color,
      hat: b.hat,
      level,
      title: titleFor(level),
      xp,
      xpFrom: xpForLevel(level),
      xpTo: xpForLevel(level + 1),
      streak: b.streak || 1,
      home: home ? { id: home.id, item: home.item, level: home.level || 1, q: home.q, r: home.r } : null,
      built: this.builds.filter((x) => x.project && x.built && x.helpers && x.helpers[id]).length,
      founded: this.builds.filter((x) => x.project && x.founderId === id).length,
      trips: b.trips || 0,
      gathered: Math.floor(b.gathered || 0),
      tool: b.tool || 0,
      queued: (this.state.queues[id] || []).length,
      rank: rank || null,
      job: this.state.jobs[id] || null,
    };
  }

  commands(now, u) {
    const text = '!home your own house · !wood !stone !food one trip (!wood 3 for three) · !build ' + itemsOfEra(this.state.era)[1] + ' start a project · !help build it · !upgrade tools · !explore · !me';
    if (this.onCooldown('help', this.limits.helpCooldownSec, now)) return { ok: true, message: text };
    this.emit({ type: 'notice', kind: 'help', text });
    void u;
    return { ok: true, message: text };
  }

  // !info totem: what a building, wonder or good is for, on screen for all.
  info(cmd, u, now) {
    const s = this.state;
    const words = cmd.words || [];
    if (!words.length) return this.commands(now, u);
    const joined = words.join('');
    const list = (bag) => {
      const parts = Object.entries(bag || {}).map(([r, n]) => n + ' ' + RESOURCES[r].label.toLowerCase());
      return parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0] || 'nothing';
    };
    let text = null;
    const w = this.currentWonder();
    const wonder = joined === 'wonder' || joined === 'wonders' ? (w && !w.pending ? w.item : 'pending') : resolveWonder(joined) || words.map(resolveWonder).find(Boolean);
    const resource = resolveResource(joined);
    if (wonder === 'pending') {
      const [a, b] = wondersOf(s.era);
      text = '🏛️ The wonder of ' + ERAS[s.era].the + ': chat chooses ' + theName(a) + ' or ' + theName(b) + '. It needs ' + list(ITEMS[a].needs) + '. Haul with !help wonder.';
    } else if (wonder) {
      const it = ITEMS[wonder];
      const who = s.picks[it.era] === wonder ? 'BotWorld builds it.' : s.picks[it.era] ? (this.rival ? this.rival.s.name + ' builds it.' : '') : 'Chat chooses between it and ' + theName(otherWonder(wonder)) + '.';
      text = it.emoji + ' ' + TheName(wonder) + (it.place ? ' (' + it.place + ')' : '') + ': a wonder of ' + ERAS[it.era].the + '. It needs ' + list(it.needs) + '. ' + who;
    } else if (resource && resource !== 'wonder') {
      const r = RESOURCES[resource];
      const maker = ITEMS[r.from];
      text = r.emoji + ' ' + r.label + ': ' + withArticle(maker.label.toLowerCase()) + ' makes it (' + r.where + ')' + (M.GATHER[resource] ? ', or gather it by hand with !' + resource : ', and !work ' + resource + ' helps there') + '.' + (r.era > s.era ? ' Comes with ' + ERAS[r.era].the + '.' : '');
    } else {
      let key = resolveItem(joined) || words.map(resolveItem).find(Boolean);
      if (key === 'house') key = houseFor(s.era);
      if (key) {
        const it = ITEMS[key];
        const site = M.siteOf(key).why;
        text = it.emoji + ' ' + it.label + ': ' + whatItDoes(key).replace(/^./, (c) => c.toLowerCase()) + '. Costs ' + list(it.cost) + '.' + (site ? ' Needs ' + site + ' nearby.' : '') + (it.era > s.era ? ' Comes with ' + ERAS[it.era].the + '.' : ' !build ' + key);
      }
    }
    if (!text) return this.refuse(u, now, 'Not sure what "' + words.join(' ') + '" is. Try !info totem, !info marble or !info wonder.');
    if (!this.onCooldown('info:' + u.id, 8, now)) this.emit({ type: 'notice', kind: 'info', user: u.name, text });
    return { ok: true, message: text };
  }

  leaders(now, n = 5) {
    const wk = weekKey(now);
    return Object.values(this.state.builders)
      .map((b) => ({ id: b.id, name: b.name, color: b.color, level: levelFor(b.xp || 0), weekXp: b.weekKey === wk ? b.weekXp || 0 : 0 }))
      .filter((b) => b.weekXp > 0)
      .sort((a, b) => b.weekXp - a.weekXp || a.name.localeCompare(b.name))
      .slice(0, n);
  }

  // --- Time ------------------------------------------------------------------------------
  tick(now) {
    this.updateBuilds(now);
    this.updateJobs(now);
    if (this.rival) this.rival.tick(now);
    if (!this.lastEcon) this.lastEcon = now;
    const dt = (now - this.lastEcon) / 1000;
    if (dt >= ECON_STEP_SEC) {
      this.lastEcon = now;
      this.economy(now, Math.min(dt, 60));
    }
    this.updateVotes(now);
  }

  updateBuilds(now) {
    const dt = this.lastBuildTick ? Math.min(60, Math.max(0, (now - this.lastBuildTick) / 1000)) : 0;
    this.lastBuildTick = now;
    const speed = this.activeEvent(now)?.buildSpeed || 1;
    for (const b of this.builds) {
      if (b.status !== 'building' || b.wonder) continue;
      if (b.project && !b.evolving) {
        // Town projects (and upgrades) grow with every helping bot; better
        // tools build faster.
        let rate = TOWN_CREW;
        for (const [uid, j] of Object.entries(this.state.jobs)) {
          if (j.buildId !== b.id || j.kind !== 'build') continue;
          rate += toolsOf(this.state.builders[uid]).build;
          b.helpers[uid] = (b.helpers[uid] || 0) + dt;
          const bd = this.state.builders[uid];
          if (bd) bd.helpedSec = (bd.helpedSec || 0) + dt;
        }
        rate *= speed;
        b.progress = Math.min(b.work, (b.progress || 0) + dt * rate);
        b.rate = Math.round(rate * 100) / 100;
        b.progressAt = now;
        if (b.progress >= b.work - 1e-6) this.finishProject(b, now);
        continue;
      }
      if (now < b.startedAt + (b.walkSec + b.buildSec / speed) * 1000) continue;
      this.finishBuild(b, now);
    }
    const queued = this.builds.filter((b) => b.status === 'queued').sort((a, b) => a.requestedAt - b.requestedAt || a.id - b.id);
    // A build that has waited long gets first claim on what it is missing.
    const reserved = new Set();
    for (const b of queued) {
      const missing = this.missing(b.cost);
      const blocked = Object.keys(b.cost).some((r) => reserved.has(r));
      if (missing.length || blocked) {
        const before = (b.waitingFor || []).join();
        b.waitingFor = missing.length ? missing : Object.keys(b.cost).filter((r) => reserved.has(r));
        if (before !== b.waitingFor.join()) this.changed({ type: 'build', build: b });
        if (missing.length && now - b.requestedAt > 5 * 60e3) for (const r of missing) reserved.add(r);
        this.autoGather(b, now);
        continue;
      }
      for (const [r, n] of Object.entries(b.cost)) this.state.stock[r] -= n;
      b.status = 'building';
      b.startedAt = now;
      b.progressAt = now;
      delete b.waitingFor;
      const uid = b.home ? b.ownerId : b.founderId;
      const job = uid && this.state.jobs[uid];
      if (job && job.kind === 'gather' && job.forBuild === b.id) {
        this.endJob(uid, true, now, !b.project);
        if (b.project) this.state.jobs[uid] = { buildId: b.id, kind: 'build', until: now + this.limits.shiftSec * 1000, startedAt: now };
        if (b.project) this.changed({ type: 'job', userId: uid, job: this.state.jobs[uid] });
      }
      this.changed({ type: 'build', build: b });
    }
  }

  // Homes, upgrades and buildings changing with the era: timed, by their owner.
  finishBuild(b, now) {
    if (b.upgrade) {
      b.item = b.upgrade.item;
      b.level = b.upgrade.level;
      delete b.upgrade;
      if (b.evolving) delete b.evolving;
      else if (b.ownerId) this.grant(b.ownerId, 8 + 4 * ITEMS[b.item].era, now);
      this.placeStats(b);
    } else if (b.ownerId) {
      this.grant(b.ownerId, 10 + 5 * ITEMS[b.item].era, now);
    }
    const fresh = !b.built;
    b.status = 'done';
    b.doneAt = now;
    b.built = true;
    if (b.project) b.progress = b.work;
    this.changed({ type: 'build', build: b });
    if (fresh) this.revealAround(b);
  }

  finishProject(b, now) {
    if (b.upgrade) return this.finishUpgrade(b, now);
    b.status = 'done';
    b.doneAt = now;
    b.built = true;
    b.progress = b.work;
    delete b.rate;
    const era = ITEMS[b.item].era;
    if (b.founderId) this.grant(b.founderId, 10 + 5 * era, now);
    for (const [uid, sec] of Object.entries(b.helpers || {})) this.grant(uid, Math.max(2, Math.round(sec / 10)), now);
    for (const [uid, j] of Object.entries(this.state.jobs)) if (j.buildId === b.id && j.kind === 'build') this.endJob(uid, true, now);
    b.crew = Object.entries(b.helpers || {}).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([uid]) => uid);
    this.changed({ type: 'build', build: b });
    const names = b.crew.map((uid) => this.nameOf(uid));
    const more = Object.keys(b.helpers || {}).length - names.length;
    const who = names.length ? ' Built by ' + names.join(', ') + (more > 0 ? ' and ' + more + ' more' : '') + '.' : ' Built by the townsfolk.';
    this.emit({ type: 'notice', kind: 'project', text: 'The ' + label(b.item) + ' (#' + b.id + ') is finished!' + who });
    this.revealAround(b);
  }

  // A town building reached its next level.
  finishUpgrade(b, now) {
    b.item = b.upgrade.item;
    b.level = b.upgrade.level;
    delete b.upgrade;
    b.status = 'done';
    b.doneAt = now;
    b.progress = b.work;
    delete b.rate;
    if (b.upgradeBy) this.grant(b.upgradeBy, 8 + 4 * ITEMS[b.item].era, now);
    const crew = b.helpers || {};
    for (const [uid, sec] of Object.entries(crew)) this.grant(uid, Math.max(2, Math.round(sec / 10)), now);
    for (const [uid, j] of Object.entries(this.state.jobs)) if (j.buildId === b.id && j.kind === 'build') this.endJob(uid, true, now);
    // Keep who built it first, add who upgraded it.
    const all = { ...(b.crewBefore || {}) };
    for (const [uid, sec] of Object.entries(crew)) all[uid] = (all[uid] || 0) + sec;
    b.helpers = all;
    delete b.crewBefore;
    delete b.upgradeBy;
    this.placeStats(b);
    this.changed({ type: 'build', build: b });
    this.emit({ type: 'notice', kind: 'project', text: 'The ' + label(b.item) + ' (#' + b.id + ') is now level ' + b.level + '! It makes ' + Math.round(50 * (b.level - 1)) + '% more.' });
  }

  updateJobs(now) {
    for (const [uid, job] of Object.entries(this.state.jobs)) {
      if (job.kind === 'explore') {
        if (now >= job.until) {
          delete this.state.jobs[uid];
          this.finishExplore(uid, job, now);
          this.changed({ type: 'job', userId: uid, job: null });
          this.runQueue(uid, now);
        }
        continue;
      }
      if (job.kind === 'hand') {
        if (now >= job.until) {
          this.handDeliver(uid, job, now);
          this.endJob(uid, true, now);
        }
        continue;
      }
      if (job.kind === 'deliver') {
        const c = this.state.contract;
        if (!c || c.winner) this.endJob(uid, false, now);
        else if (now >= job.until) {
          G.tripDone(this, uid, job, now);
          if (this.state.jobs[uid] === job) this.endJob(uid, true, now);
        }
        continue;
      }
      const b = this.builds.find((x) => x.id === job.buildId);
      if (!b || (job.kind === 'wonder' && b.status === 'done') || (job.kind === 'build' && b.status === 'done')) { this.endJob(uid, !!b, now); continue; }
      if (job.kind === 'gather') {
        const waiting = this.builds.find((x) => x.id === job.forBuild && x.status === 'queued');
        if (!waiting || now >= job.until) this.endJob(uid, !!waiting, now);
        continue;
      }
      if (now >= job.until) this.endJob(uid, true, now);
    }
  }

  economy(now, dt) {
    const s = this.state;
    const builds = this.builds;
    const cap = E.capacity(builds);
    const popCap = E.popCapacity(builds);
    const jobs = E.jobsNeeded(builds);
    const employment = jobs > 0 ? Math.min(1, s.population / jobs) : 1;
    const pw = E.power(builds, now, this.fuel, this.geo);
    const ev = this.activeEvent(now);
    if (now - this.lastHappy > 30e3 || dt === 0) {
      this.happy = E.happiness(builds, { foodShort: (s.stock.food || 0) < 0.5 && s.population > 1, powerRatio: pw.ratio, bonus: ev?.happy || 0 });
      this.lastHappy = now;
    }
    const robots = Math.min(2, builds.filter((b) => E.isUp(b) && ITEMS[b.item].global).length);
    const helpers = new Map();
    for (const j of Object.values(s.jobs)) if (j.buildId) helpers.set(j.buildId, (helpers.get(j.buildId) || 0) + 1);
    const out = E.produce(builds, s.stock, {
      employment,
      happyFactor: 0.6 + (0.8 * this.happy) / 100,
      global: 1 + 0.25 * robots,
      powerRatio: pw.ratio,
      helpers: (id) => helpers.get(id) || 0,
      boosts: ev?.boost || {},
      reach: ((m) => (b) => m.get(b.id) ?? 1)(this.reachMap()),
      progress: this.progress,
      fuel: this.fuel,
      cap,
    }, dt);
    const eat = (s.population * E.foodPerPop(s.era) * dt) / 60;
    const ate = Math.min(s.stock.food || 0, eat);
    s.stock.food = (s.stock.food || 0) - ate;
    out.used.food = (out.used.food || 0) + ate;
    const fed = ate >= eat - 1e-9;
    if (fed && this.happy >= E.MOVE_IN_HAPPINESS && s.population < popCap) s.population += Math.max(0.05 * dt, (popCap - s.population) * Math.min(1, dt / 120));
    else if (!fed) s.population -= s.population * 0.02 * (dt / 60);
    s.population = Math.max(0, Math.min(popCap, s.population));
    const w = this.currentWonder();
    if (w && w.status !== 'done' && dt > 0) {
      const drones = Math.min(2, builds.filter((b) => E.isUp(b) && ITEMS[b.item].wonderBoost).length);
      const speed = 1 + E.WONDER_SPEED_PER_HELPER * Math.min(WONDER_HELPERS, helpers.get(w.id) || 0) + 0.5 * drones;
      const fraction = (speed * dt) / 60 / (this.pace.eraDays * 1440 * 0.85);
      this.wonderShort = E.deliverToWonder(w, s.stock, { fraction, cap });
      if (E.wonderProgress(w) >= 0.9999) {
        if (w.pending) this.autoPick(s.era, now);
        w.status = 'done';
        w.built = true;
        w.doneAt = now;
        this.changed({ type: 'build', build: w });
        this.emit({ type: 'notice', kind: 'wonder', item: w.item, text: TheName(w.item) + ' is complete!' });
      }
    }
    if (!s.finished) s.knowledge = Math.min(this.knowledgeNeed(), s.knowledge + ((1 + E.knowledgeBoost(builds)) * dt) / 60);
    if (dt > 0) G.stepContract(this, now, dt);
    for (const r of Object.keys(s.stock)) s.stock[r] = Math.max(0, Math.min(cap, s.stock[r]));
    if (dt > 0) {
      for (const r of E.unlockedResources(s.era)) {
        const inst = (((out.made[r] || 0) + (this.handMade[r] || 0) - (out.used[r] || 0)) * 60) / dt;
        this.rates[r] = this.rates[r] == null ? inst : this.rates[r] * 0.9 + inst * 0.1;
      }
      this.handMade = {};
    }
    this.stalled = out.stalled;
    for (const [id, goods] of Object.entries(out.starved)) this.starved[id] = { goods, at: now };
    for (const [id, st] of Object.entries(this.starved)) if (now - st.at > IDLE_MEMORY_MS) delete this.starved[id];
    const needs = this.needs(cap, pw);
    const explored = M.exploredCount(this.map, this.bits);
    this.econ = {
      era: s.era,
      stock: Object.fromEntries(E.unlockedResources(s.era).map((r) => [r, Math.floor(s.stock[r] || 0)])),
      rates: Object.fromEntries(Object.entries(this.rates).map(([r, v]) => [r, Math.round(v * 10) / 10])),
      cap,
      population: Math.floor(s.population),
      popCap,
      popGoal: ERAS[s.era].popGoal,
      jobs,
      employment: Math.round(employment * 100),
      happy: Math.round(this.happy),
      power: { supply: Math.round(pw.supply), demand: Math.round(pw.demand) },
      knowledge: Math.floor(s.knowledge),
      knowledgeNeed: this.knowledgeNeed(),
      knowledgeRate: Math.round((1 + E.knowledgeBoost(builds)) * 100) / 100,
      wonder: w ? { id: w.id, item: w.item, pending: !!w.pending, progress: Math.round(E.wonderProgress(w) * 1000) / 1000, short: w.status === 'done' ? [] : this.wonderShort, helpers: helpers.get(w.id) || 0 } : null,
      stalled: out.stalled,
      needs,
      projects: this.projects().map((b) => ({ id: b.id, item: b.item, status: b.status, progress: Math.round((b.progress / b.work) * 1000) / 1000, helpers: this.helpersAt(b.id), waitingFor: b.waitingFor || [], founder: this.nameOf(b.upgrade ? b.upgradeBy : b.founderId), level: b.upgrade ? b.upgrade.level : null })),
      maxProjects: this.limits.maxProjects,
      plan: this.plan(needs, w, popCap),
      explored: { n: explored, total: this.map.total },
      race: this.rival ? { you: this.raceProgress(), rival: this.rival.summary() } : null,
      guild: this.rival && this.limits.contracts ? G.view(this) : null,
    };
    if (dt > 0) {
      this.dirty = true;
      // Projects grow every second; the page fills in between from their rate.
      for (const b of this.projects()) if (b.status === 'building') this.emit({ type: 'build', build: b });
      this.emit({ type: 'economy', econ: this.econ });
      if (out.pops.length) this.emit({ type: 'produce', pops: out.pops });
      this.checkEra(now);
    }
  }

  // Is there a known, free spot for this building (or one it can take over)?
  // For a mine that should dig one ore (res), a spot by that ore.
  hasSite(item, res = null) {
    const ore = M.siteOf(item).ore && (res === 'coal' || res === 'iron') ? res : null;
    return !!this.choosePlot(item, { quick: true, ore }) || !!this.spareFor(item, true, ore);
  }

  // What buildings of a kind stand idle for (steel mills waiting for coal):
  // the input most of the idle ones miss, or null when none is idle.
  idleFor(is) {
    const miss = {};
    for (const b of this.builds) {
      const goods = this.starved[b.id]?.goods;
      if (goods && is(b)) for (const r of goods) miss[r] = (miss[r] || 0) + 1;
    }
    return Object.keys(miss).sort((a, b) => miss[b] - miss[a])[0] || null;
  }

  // What the town needs now (the plan shows it): only that may take the
  // place of old buildings when the town is full.
  needed(item, now = Date.now()) {
    if (!this.econ) this.economy(now, 0);
    const e = this.econ;
    const it = ITEMS[item];
    if (e.needs.some((n) => (n.res === 'power' ? it.power > 0 : !!it.recipe?.out?.[n.res]))) return true;
    return it.kind === 'house' && e.population >= e.popCap - 1 && e.popCap < ERAS[this.state.era].popGoal * 1.5;
  }

  // Has every reachable bit of fog been explored?
  explored() {
    return !M.frontier(this.map, this.bits).some((t) => M.walkable(t) || M.neighborsOf(this.map, t).some((n) => this.known(n) && M.walkable(n)));
  }

  // What the town is short of right now, with the building that helps
  // most and whether there is a spot for it. Shown on stream.
  needs(cap, pw) {
    const s = this.state;
    const out = [];
    const powerShort = pw.demand > pw.supply * 1.02;
    // A building that uses power makes nothing while power is short.
    const runs = (k) => !(powerShort && ITEMS[k].power < 0);
    const add = (r, why, depth = 0) => {
      if (out.some((n) => n.res === r)) return;
      // The best maker that has a known spot, one that works right now if
      // there is one; else the best one (and a hint to explore).
      const makers = r === 'power' ? E.powerMakers(this.builds, s.era) : E.makersOf(r, s.era);
      if (!makers.length) return;
      const order = makers.filter(runs).concat(makers.filter((k) => !runs(k)));
      const found = order.find((k) => this.hasSite(k, r));
      const item = found || order[0];
      // Another one would stand idle like the ones the town has (coal plants
      // and steel mills without coal, factories without power): what they
      // wait for is what the town needs. Food stays, though: people eat
      // every minute, and chat can always pick some by hand.
      const wait = this.idleFor((b) => b.item === item) || (runs(item) ? null : 'power');
      if (wait && r !== 'food' && depth < 3) return add(wait, why, depth + 1);
      const where = (M.siteOf(item).ore && M.GATHER[r]?.land) || M.siteOf(item).why || null;
      out.push({ res: r, why, item, site: !!found, where });
    };
    if (powerShort) add('power', 'power');
    const food = s.stock.food || 0;
    if (food < cap * 0.15 && (this.rates.food || 0) <= 0.5) add('food', 'hungry');
    for (const r of this.wonderShort || []) add(r, 'wonder');
    for (const b of this.builds) if (b.status === 'queued') for (const r of b.waitingFor || []) add(r, 'build');
    for (const r of E.unlockedResources(s.era)) if ((s.stock[r] || 0) < cap * 0.08 && RESOURCES[r].era >= s.era - 1) add(r, 'low');
    return out.slice(0, 3);
  }

  // The next steps for chat, most useful first: help what is being built,
  // fetch what a project waits for, start what the town needs, explore.
  plan(needs, w, popCap) {
    const s = this.state;
    const steps = [];
    const add = (st) => { if (!steps.some((x) => x.cmd === st.cmd)) steps.push(st); };
    const projects = this.projects();
    const many = projects.length > 1;
    for (const p of [...projects].sort((a, b) => b.progress / b.work - a.progress / a.work)) {
      const name = ITEMS[p.item].label;
      if (p.status === 'building') add({ kind: 'help', id: p.id, item: p.item, text: 'Help build the ' + name, cmd: many ? '!help #' + p.id : '!help' });
      else if (p.waitingFor?.length) {
        const want = p.waitingFor[0];
        // Its makers stand idle for an input (steel mills without coal): fetch that.
        const idle = this.idleFor((b) => !!ITEMS[b.item].recipe?.out?.[want]);
        const r = idle && RESOURCES[idle] ? idle : want;
        const text = 'The ' + name + ' needs ' + RESOURCES[want].label.toLowerCase() + (r !== want ? ', made with ' + RESOURCES[r].label.toLowerCase() : '');
        const hand = this.handCmd(r);
        const made = this.builds.some((b) => E.isUp(b) && ITEMS[b.item].recipe?.out?.[r] && (!b.ores || b.ores.includes(r)));
        if (hand) add({ kind: 'gather', id: p.id, item: p.item, res: r, text, cmd: hand });
        else if (made) add({ kind: 'gather', id: p.id, item: p.item, res: r, text, cmd: '!work ' + r });
        else add({ kind: 'build', item: RESOURCES[r].from, res: r, text: 'Nobody makes ' + RESOURCES[r].label.toLowerCase() + ' yet', cmd: '!build ' + RESOURCES[r].from });
      }
    }
    const c = s.contract;
    if (c && !c.winner && this.rival) {
      const what = RESOURCES[c.res].label.toLowerCase();
      const hand = this.handCmd(c.res);
      if ((s.stock[c.res] || 0) >= 1) add({ kind: 'deliver', res: c.res, urgent: true, text: 'Guild order: deliver ' + what + ' before ' + this.rival.s.name, cmd: '!deliver' });
      else add({ kind: 'gather', res: c.res, urgent: true, text: 'The Guild wants ' + what + ', make some', cmd: hand || '!work ' + c.res });
    }
    const room = projects.length < this.limits.maxProjects;
    for (const n of needs) {
      const what = n.res === 'power' ? 'power' : RESOURCES[n.res].label.toLowerCase();
      const hand = n.res !== 'power' && this.handCmd(n.res);
      if (hand) add({ kind: 'gather', res: n.res, urgent: URGENT.has(n.why), text: 'The town needs ' + what + ', gather some', cmd: hand });
      const canStart = room || (n.site && this.urgentRoom(n.item, projects, needs));
      if (!canStart) continue;
      if (n.site) add({ kind: 'build', item: n.item, res: n.res, urgent: URGENT.has(n.why), text: (hand ? cap1(withArticle(label(n.item))) + ' makes ' + what + ' all day' : (n.why === 'wonder' ? 'The wonder needs ' : 'The town needs ') + what), cmd: '!build ' + n.item });
      else if (!hand) add({ kind: 'explore', item: n.item, res: n.res, text: 'Find ' + (n.where || 'more land') + ' for ' + what, cmd: '!explore' });
      const up = this.upgradable(n.res);
      if (up) add({ kind: 'upgrade', item: up.item, res: n.res, text: 'Upgrade the ' + label(up.item) + ' for more ' + what, cmd: '!upgrade ' + up.item });
    }
    if (room) {
      const reach = this.reachMap();
      const far = this.builds.filter((b) => E.isUp(b) && ITEMS[b.item].recipe && (reach.get(b.id) ?? 1) < 0.75);
      if (far.length) add({ kind: 'build', item: 'outpost', text: far.length + (far.length === 1 ? ' producer is' : ' producers are') + ' far from a store: build an outpost', cmd: '!build outpost' });
    }
    if (w && w.status !== 'done') add({ kind: 'wonder', item: w.item, pending: !!w.pending, text: 'Haul goods to ' + this.wonderTitle(w), cmd: '!help wonder' });
    if (room && s.population >= popCap - 1 && popCap < ERAS[s.era].popGoal) add({ kind: 'build', item: houseFor(s.era), text: 'More homes, so more people move in', cmd: '!build ' + houseFor(s.era) });
    add({ kind: 'explore', text: 'Explore the fog, there is more to find', cmd: '!explore' });
    // What the town is stuck on goes near the top, ahead of more !help; a
    // Guild order runs against the clock, so it goes first.
    const urgent = steps.filter((st) => st.urgent).slice(0, 2);
    const rest = steps.filter((st) => !urgent.includes(st));
    const lead = rest[0]?.kind === 'help' || rest[0]?.kind === 'gather' ? rest.slice(0, 1) : [];
    const order = lead.concat(urgent, rest.slice(lead.length));
    const guild = order.find((st) => st.kind === 'deliver' || (st.urgent && c && st.res === c.res));
    return (guild ? [guild].concat(order.filter((st) => st !== guild)) : order).slice(0, 4);
  }

  checkEra(now) {
    const s = this.state;
    if (s.finished) return;
    const w = this.currentWonder();
    if (!w || w.status !== 'done' || s.knowledge < this.knowledgeNeed() || s.population < ERAS[s.era].popGoal) return;
    if (s.era >= ERAS.length - 1) {
      s.finished = true;
      s.finishedAt = now;
      this.changed({ type: 'finale', at: now, item: w.item });
      return;
    }
    s.era++;
    s.eraStartedAt = now;
    s.knowledge = 0;
    s.eraHistory = (s.eraHistory || []).concat([{ era: s.era, at: now }]);
    this.ensureWonder(now);
    const evolved = this.evolve(now);
    this.changed({ type: 'era', era: s.era, at: now, evolved });
    if (this.rival && this.rival.s.era < s.era) {
      this.rival.s.eraFirst[s.era] = 'town';
      this.emit({ type: 'notice', kind: 'rival', text: 'BotWorld reached ' + ERAS[s.era].the + ' before ' + this.rival.s.name + '!' });
    }
  }

  // The era's wonder rises on its plot as soon as the era starts. Until chat
  // has chosen which one, it is just a wonder: both need the same goods.
  ensureWonder(now) {
    const s = this.state;
    let w = this.currentWonder();
    if (w) return w;
    this.relocateWonderRing(now);
    const [q, r] = wonderTile(s.era);
    const pick = s.picks[s.era];
    w = { id: ++s.seq, item: pick || wondersOf(s.era)[0], wonder: true, color: null, level: 1, q, r, ownerId: null, status: 'building', requestedAt: now, startedAt: now, walkSec: 0, buildSec: 0, doneAt: null, cost: {}, delivered: {}, built: false };
    if (!pick) w.pending = true;
    this.builds.push(w);
    this.changed({ type: 'build', build: w });
    return w;
  }

  // --- Helpers ------------------------------------------------------------------------------
  nameOf(userId) {
    return (this.state.builders[userId] || {}).name || 'someone';
  }
  missing(cost) {
    return Object.keys(cost || {}).filter((r) => (this.state.stock[r] || 0) < cost[r]);
  }
  missingText(cost) {
    return this.missing(cost).map((r) => Math.ceil(cost[r] - (this.state.stock[r] || 0)) + ' ' + res(r)).join(' and ');
  }
  tooBigForStorage(cost) {
    const cap = E.capacity(this.builds);
    const r = Object.keys(cost).find((k) => cost[k] > cap);
    if (!r) return null;
    const storage = Object.keys(ITEMS).filter((k) => ITEMS[k].kind === 'storage' && ITEMS[k].era <= this.state.era).pop();
    return 'That needs ' + cost[r] + ' ' + res(r) + ' but storage holds ' + cap + '. Build ' + withArticle(label(storage)) + ' first!';
  }

  touchBuilder(u, now) {
    const s = this.state;
    let b = s.builders[u.id];
    const fresh = !b;
    if (fresh) {
      const h = hashStr(u.id);
      b = {
        id: u.id,
        name: u.name,
        color: /^#[0-9a-f]{6}$/i.test(u.color || '') ? u.color.toLowerCase() : PALETTE[h % PALETTE.length],
        hat: STARTER_HATS[(h >>> 8) % STARTER_HATS.length],
        firstSeen: now,
        lastSeen: now,
        xp: 0,
        builds: 0,
        streak: 0,
        lastDay: '',
      };
      s.builders[u.id] = b;
    }
    b.name = u.name;
    b.lastSeen = now;
    this.dirty = true;
    this.emit({ type: 'builder', builder: b, joined: fresh });
    const today = dayKey(now);
    if (b.lastDay !== today) {
      b.streak = b.lastDay === dayKey(now - DAY) ? (b.streak || 0) + 1 : 1;
      b.lastDay = today;
      this.grant(u.id, 5 + Math.min(10, b.streak - 1), now);
    }
    return b;
  }

  grant(userId, n, now) {
    const b = this.state.builders[userId];
    if (!b || !(n > 0)) return;
    const before = levelFor(b.xp || 0);
    b.xp = (b.xp || 0) + n;
    const wk = weekKey(now);
    if (b.weekKey !== wk) { b.weekKey = wk; b.weekXp = 0; }
    b.weekXp += n;
    this.dirty = true;
    const after = levelFor(b.xp);
    if (after > before) this.emit({ type: 'level', userId, name: b.name, level: after, title: titleFor(after) });
    this.emit({ type: 'builder', builder: b, joined: false });
  }

  refuse(u, now, message) {
    // Each viewer gets at most one on-screen notice per cooldown, so a
    // spammer cannot flood the stream with error messages.
    if (!this.onCooldown('notice:' + u.id, this.limits.noticeCooldownSec, now)) {
      this.emit({ type: 'notice', kind: 'warn', user: u.name, text: message });
    }
    return { ok: false, message };
  }

  onCooldown(key, sec, now) {
    const until = this.cooldowns.get(key) || 0;
    if (now < until) return true;
    this.cooldowns.set(key, now + sec * 1000);
    return false;
  }

  // Where should this go? Explored land only, on the right ground. Homes
  // cluster near the middle, producers go where the forest, hills or ore are
  // richest, parks and statues near homes.
  choosePlot(item, { home = false, ownerId = null, near = null, salt = 0, quick = false, dir = null, ore = null } = {}) {
    const at = new Map(this.builds.map((b) => [hexKey(b.q, b.r), b]));
    const it = ITEMS[item];
    if (it.zone === 'far') return this.outpostPlot(at, dir, salt, quick);
    const site = M.siteOf(item);
    const prod = isProducerLike(it) || !!site.near || !!site.ore;
    const stores = prod && it.kind !== 'storage' ? this.stores() : null;
    // A new mine goes for the ore no mine digs yet, or the one the town is
    // short of (ore: only a spot by that ore will do).
    const lacking = site.ore ? ['coal', 'iron'].filter((r) => r === ore || !this.builds.some((b) => E.isUp(b) && b.ores?.includes(r)) || this.econ?.needs?.some((n) => n.res === r)) : [];
    let best = null;
    let bestScore = Infinity;
    const theirs = this.rivalLand();
    const taken = this.rival ? this.allTaken() : null;
    const mine = theirs.size ? (n) => this.known(n) && !theirs.has(n.i) : this.known;
    const era = this.state.era;
    for (const t of this.map.tiles) {
      if (isWonderPlot(t.q, t.r, era) || !this.known(t) || theirs.has(t.i)) continue;
      const key = hexKey(t.q, t.r);
      if (at.has(key) || (taken && taken.has(key)) || !M.siteOk(this.map, item, t, mine)) continue;
      if (ore && site.ore && !M.oresNear(this.map, t).includes(ore)) continue;
      if (quick) return t;
      let s;
      if (prod) {
        s = t.d * 0.35 - M.richness(this.map, item, t) * 5;
        // Producers like to be near a store, so their goods reach town.
        if (stores) s += 0.8 * Math.max(0, storeDist(t, stores) - REACH);
        if (lacking.length && M.oresNear(this.map, t).some((r) => lacking.includes(r))) s -= 4;
      } else if (it.zone === 'inner') s = t.d * 1.6;
      else s = t.d;
      for (const [dq, dr] of NEAR2) {
        const o = at.get(hexKey(t.q + dq, t.r + dr));
        if (!o) continue;
        const d = hexDist(dq, dr);
        const ot = ITEMS[o.item];
        if (home && o.home) s -= d === 1 ? 1.2 : 0.4;
        if ((home || it.kind === 'house') && ot.comfort) s -= 0.6;
        if (ot.kind === 'house' && it.comfort) s -= 0.6;
        if (prod && ot.kind === 'house' && d === 1) s += 0.8;
        if (ownerId && o.ownerId === ownerId) s -= 0.5;
        if (near && (o.item === near || (near === 'house' && ot.kind === 'house'))) s -= d === 1 ? 4 : 2;
      }
      s += ((hashStr(salt + ':' + key) % 1000) / 1000) * 1.2;
      if (s < bestScore) { bestScore = s; best = t; }
    }
    return best;
  }

  // The town is full: a building it can spare makes way for a new one (see
  // E.spareScorer). Decor gives way while people are content, or to what
  // the town needs (need), which may also replace a spare producer of goods
  // the stores are full of. Homes, stores, power, knowledge, food and
  // wonders stay.
  spareFor(item, need = false, ore = null) {
    const it = ITEMS[item];
    if (it.zone === 'far') return null;
    const theirs = this.rivalLand();
    const mine = theirs.size ? (n) => this.known(n) && !theirs.has(n.i) : this.known;
    const spare = E.spareScorer(this.builds, this.state.stock, E.capacity(this.builds), it, { need, happy: this.happy });
    let best = null;
    let bestScore = Infinity;
    for (const b of this.builds) {
      if (b.home || b.item === item) continue;
      const sc = spare(b);
      if (sc == null || sc >= bestScore) continue;
      const t = M.tileAt(this.map, b.q, b.r);
      if (!t || isWonderPlot(t.q, t.r, this.state.era) || theirs.has(t.i) || !M.siteOk(this.map, item, t, mine)) continue;
      if (ore && !M.oresNear(this.map, t).includes(ore)) continue;
      bestScore = sc;
      best = b;
    }
    return best;
  }

  makeWay(old, item, now) {
    this.removeBuild(old.id, now);
    this.emit({ type: 'notice', kind: 'clear', text: 'The town is full: the old ' + label(old.item) + ' (#' + old.id + ') makes way for ' + withArticle(label(item)) + '.' });
  }

  // An outpost goes out to rich land where no store is near yet, a few
  // steps further each time, the way chat asks ("!build outpost north").
  outpostPlot(at, dir, salt, quick) {
    const stores = this.stores();
    const want = dir ? M.DIRECTIONS[dir] : null;
    let best = null;
    let bestScore = Infinity;
    const theirs = this.rivalLand();
    for (const t of this.map.tiles) {
      if (t.d <= WONDER_RING + 2 || !this.known(t) || at.has(hexKey(t.q, t.r)) || theirs.has(t.i)) continue;
      if (!M.siteOk(this.map, 'outpost', t, this.known)) continue;
      const ds = storeDist(t, stores);
      if (ds < 6) continue;
      if (want != null) {
        const off = Math.atan2(Math.sin(M.angleOf(t) - want), Math.cos(M.angleOf(t) - want));
        if (Math.abs(off) > 0.8) continue;
      }
      if (quick) return t;
      let value = 0;
      for (const n of M.tilesWithin(this.map, t, 3)) {
        if (!this.known(n)) { value += 0.15; continue; }
        if (n.t === 'forest' || n.t === 'hills' || n.t === 'meadow') value += 0.6;
        if (n.f === 'coal' || n.f === 'iron') value += 3;
        if (at.has(hexKey(n.q, n.r))) value -= 0.5;
      }
      const s = -value + ds * 0.4 + ((hashStr(salt + ':o' + t.i) % 1000) / 1000) * 1.5;
      if (s < bestScore) { bestScore = s; best = t; }
    }
    return best;
  }
}

// Producers more than REACH tiles from a store lose a tenth per extra tile
// (down to 40%): their goods have a long way to town.
const REACH = 4;
function storeDist(t, stores) {
  let d = Infinity;
  for (const s of stores) d = Math.min(d, hexDist(s.q - t.q, s.r - t.r));
  return d;
}
export function reachOf(t, stores) {
  const d = storeDist(t, stores);
  return d <= REACH ? 1 : Math.max(0.4, 1 - 0.1 * (d - REACH));
}

function compass(a) {
  const names = ['east', 'southeast', 'south', 'southwest', 'west', 'northwest', 'north', 'northeast'];
  const k = Math.round(((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
  return names[k];
}
void ringTiles;
