// The rules of BotWorld. The server owns the world: what gets built where,
// what it costs, what the village produces, when an era ends, and what
// every viewer's bot is doing. The page only animates what it hears.
import { ITEMS, ERAS, EVENTS, HATS, PALETTE, RESOURCES, hashStr, houseFor, itemsOfEra, levelFor, titleFor, xpForLevel, buildSlots, evolvedItem } from '../public/shared/catalog.js';
import { MAX_RING, WONDER_RING, hexDist, hexKey, landRingFor, ringTiles, wonderTile } from '../public/shared/hex.js';
import { parseCommand } from './commands.js';
import * as E from './economy.js';

export const DEFAULT_LIMITS = {
  maxBuildsPerUser: 30,
  maxQueue: 30,
  maxConcurrentBuilds: 6,
  hatCooldownSec: 10,
  danceCooldownSec: 30,
  noticeCooldownSec: 20,
  helpCooldownSec: 30,
  meCooldownSec: 30,
  workMinutes: 10,
  repairSec: 20,
  voteEveryMin: 60,
  voteSec: 180,
  autoEventEveryMin: 150,
};
// eraDays: how long an era takes at base speed. Schools and labs can make
// knowledge up to 1.5x faster, and helpers speed up the wonder.
export const DEFAULT_PACE = { eraDays: 9 };

const ECON_STEP_SEC = 5;
const WALK_BASE_SEC = 3;
const WALK_SEC_PER_RING = 2;
const UPGRADE_COST = 0.7;
const UPGRADE_TIME = 0.6;
const WONDER_HELPERS = 8;
const DAY = 864e5;
const STARTER_HATS = Object.keys(HATS).filter((h) => h !== 'none' && HATS[h].level === 1);
const NEAR2 = [];
for (let dq = -2; dq <= 2; dq++) for (let dr = -2; dr <= 2; dr++) if ((dq || dr) && hexDist(dq, dr) <= 2) NEAR2.push([dq, dr]);

export const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
export function weekKey(ms) {
  const d = new Date(ms);
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return dayKey(monday);
}
const res = (r) => RESOURCES[r].emoji + ' ' + RESOURCES[r].label.toLowerCase();
const scaleCost = (cost, f) => Object.fromEntries(Object.entries(cost).map(([r, n]) => [r, Math.max(1, Math.ceil(n * f))]));
const withArticle = (s) => (/^[aeiou]/i.test(s) ? 'an ' : 'a ') + s;
const rndPick = (id) => (hashStr(id + ':' + Math.floor(Date.now() / 60e3)) % 1000) / 1000;

export function freshState(now) {
  return {
    version: 2,
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
  };
}

// Older saves (from before eras) are brought up to date in place.
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
  const fresh = freshState(now);
  for (const k of Object.keys(fresh)) if (s[k] === undefined) s[k] = fresh[k];
  for (const r of Object.keys(E.START_STOCK)) if (typeof s.stock[r] !== 'number') s.stock[r] = 0;
  return s;
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
    this.rates = {};
    this.happy = 50;
    this.lastHappy = 0;
    this.lastEcon = 0;
    this.econ = null;
    this.wonderShort = [];
    this.recent = new Map();
    this.relocateWonderRing(this.state.eraStartedAt);
    this.ensureWonder(this.state.eraStartedAt);
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

  landRing() {
    const maxBuilt = this.builds.reduce((m, b) => Math.max(m, hexDist(b.q, b.r)), 0);
    return landRingFor(maxBuilt);
  }
  knowledgeNeed() {
    return this.pace.eraDays * 1440;
  }
  currentWonder() {
    const key = ERAS[this.state.era].wonder;
    return this.builds.find((b) => b.wonder && b.item === key) || null;
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
      landRing: this.landRing(),
      econ: this.econ,
      vote: this.voteView(),
      event: this.state.event,
      jobs: this.state.jobs,
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

  apply(cmd, user, now) {
    const u = { ...user, id: String(user.id || user.name || ''), name: cleanName(user.name) };
    if (!u.id) return { ok: false, message: 'Unknown user.' };
    this.recent.set(u.id, now);
    switch (cmd.type) {
      case 'build': return this.build(cmd, u, now);
      case 'upgrade': return this.upgrade(u, now);
      case 'work': return this.work(cmd, u, now);
      case 'repair': return this.repair(u, now);
      case 'vote': return this.vote(cmd, u, now);
      case 'hat': return this.hat(cmd, u, now);
      case 'dance': return this.dance(u, now);
      case 'me': return this.me(u, now);
      case 'help': return this.help(now);
      case 'demolish': return this.demolish(cmd, u, now);
      case 'remove': return this.remove(cmd, u);
      case 'event': return this.forceEvent(cmd, u, now);
      default: return { ok: false, message: 'Unknown command.' };
    }
  }

  // --- Building -----------------------------------------------------------------
  buildable() {
    const out = [];
    for (let e = this.state.era; e >= 0; e--) for (const k of itemsOfEra(e)) out.push(k);
    return out;
  }

  build(cmd, u, now) {
    const s = this.state;
    if (!cmd.item) return this.refuse(u, now, 'Try !build house. In the ' + ERAS[s.era].name + ' you can build: ' + itemsOfEra(s.era).join(', ') + '.');
    const item = cmd.item === 'house' ? houseFor(s.era) : cmd.item;
    const it = ITEMS[item];
    if (it.era > s.era) return this.refuse(u, now, it.label + ' arrives in the ' + ERAS[it.era].name + '. For now try: ' + itemsOfEra(s.era).slice(0, 5).join(', ') + '.');
    const busy = this.pendingOf(u.id);
    if (busy) return this.refuse(u, now, 'Your bot is still busy with #' + busy.id + ' (' + ITEMS[busy.upgrade ? busy.upgrade.item : busy.item].label.toLowerCase() + ').');
    const mine = this.builds.filter((b) => b.ownerId === u.id).length;
    const slots = this.slotsOf(u.id);
    if (mine >= slots) return this.refuse(u, now, 'You have ' + mine + ' buildings, your limit at your level. Level up (!work, !upgrade) for more, or !demolish an old one.');
    if (this.builds.filter((b) => b.status === 'queued').length >= this.limits.maxQueue) return this.refuse(u, now, 'The builders are swamped. Try again in a minute!');
    const tooBig = this.tooBigForStorage(it.cost);
    if (tooBig) return this.refuse(u, now, tooBig);
    let plot = this.choosePlot(item, u.id, s.seq + 1, cmd.near);
    let replaced = null;
    if (!plot) {
      // A full island reuses plots of viewers who have not been around for a week.
      replaced = this.recyclable(now);
      if (!replaced) {
        const mine2 = this.builds.filter((b) => b.ownerId === u.id && b.status === 'done' && !b.wonder).sort((a, b) => ITEMS[a.item].era - ITEMS[b.item].era || a.id - b.id)[0];
        return this.refuse(u, now, 'The island is full!' + (mine2 ? ' !demolish #' + mine2.id + ' (your ' + ITEMS[mine2.item].label.toLowerCase() + ') to make room, or !upgrade.' : ' Try !upgrade.'));
      }
      plot = [replaced.q, replaced.r];
      this.removeBuild(replaced.id);
    }
    this.touchBuilder(u, now);
    const b = {
      id: ++s.seq,
      item,
      color: cmd.color || null,
      level: 1,
      q: plot[0],
      r: plot[1],
      ownerId: u.id,
      status: 'queued',
      requestedAt: now,
      startedAt: null,
      walkSec: WALK_BASE_SEC + hexDist(plot[0], plot[1]) * WALK_SEC_PER_RING,
      buildSec: it.buildSec,
      doneAt: null,
      cost: { ...it.cost },
      built: false,
    };
    this.builds.push(b);
    this.changed({ type: 'build', build: b });
    this.tick(now);
    const what = (b.color ? b.color + ' ' : '') + it.label.toLowerCase();
    const wait = b.status === 'queued' ? this.missingText(b.cost) : '';
    const over = replaced ? ' where an abandoned ' + ITEMS[replaced.item].label.toLowerCase() + ' stood' : '';
    return { ok: true, message: u.name + ' is building ' + withArticle(what) + over + ' (#' + b.id + ')' + (wait ? ', waiting for ' + wait : '') + '.', build: b };
  }

  upgrade(u, now) {
    const s = this.state;
    const busy = this.pendingOf(u.id);
    if (busy) return this.refuse(u, now, 'Your bot is still busy with #' + busy.id + '.');
    const mine = this.builds.filter((b) => b.ownerId === u.id && b.status === 'done');
    if (!mine.length) return this.refuse(u, now, 'Build something first: !build house');
    const newHouse = houseFor(s.era);
    let target = mine.filter((b) => ITEMS[b.item].kind === 'house' && b.item !== newHouse).sort((a, b) => ITEMS[a.item].era - ITEMS[b.item].era || a.id - b.id)[0];
    let upgrade;
    let cost;
    if (target) {
      upgrade = { item: newHouse, level: 1 };
      cost = scaleCost(ITEMS[newHouse].cost, UPGRADE_COST);
    } else {
      target = mine.filter((b) => ITEMS[b.item].maxLevel && b.level < ITEMS[b.item].maxLevel).sort((a, b) => b.doneAt - a.doneAt)[0];
      if (!target) return this.refuse(u, now, 'Your homes are already the newest kind. A new era brings new homes to upgrade to!');
      upgrade = { item: target.item, level: target.level + 1 };
      cost = scaleCost(ITEMS[target.item].cost, 0.6 * target.level);
    }
    const tooBig = this.tooBigForStorage(cost);
    if (tooBig) return this.refuse(u, now, tooBig);
    this.touchBuilder(u, now);
    Object.assign(target, {
      status: 'queued',
      upgrade,
      cost,
      requestedAt: now,
      startedAt: null,
      buildSec: Math.round(ITEMS[upgrade.item].buildSec * UPGRADE_TIME),
    });
    this.changed({ type: 'build', build: target });
    this.tick(now);
    return { ok: true, message: u.name + ' is upgrading #' + target.id + ' to ' + withArticle(ITEMS[upgrade.item].label.toLowerCase()) + (upgrade.level > 1 ? ' (level ' + upgrade.level + ')' : '') + '.', build: target };
  }

  demolish(cmd, u, now) {
    const b = this.builds.find((x) => x.id === cmd.id);
    if (!b || b.ownerId !== u.id) return this.refuse(u, now, 'You can only !demolish your own buildings, like !demolish #12.');
    if (b.status === 'building') return this.refuse(u, now, 'Wait until #' + b.id + ' is finished.');
    this.removeBuild(b.id);
    return { ok: true, message: 'Demolished #' + b.id + '. The plot is free again.' };
  }

  remove(cmd, u) {
    if (!u.mod && !u.broadcaster) return { ok: false, message: '' };
    const b = this.builds.find((x) => x.id === cmd.id);
    if (!b || b.wonder) return { ok: false, message: 'No build #' + cmd.id + '.' };
    this.removeBuild(b.id);
    return { ok: true, message: 'Removed #' + cmd.id + '.' };
  }

  removeBuild(id) {
    const i = this.builds.findIndex((b) => b.id === id);
    if (i < 0) return;
    this.builds.splice(i, 1);
    for (const [uid, job] of Object.entries(this.state.jobs)) if (job.buildId === id) this.endJob(uid, false);
    this.progress.delete(id);
    this.changed({ type: 'remove', id });
  }

  // The oldest building whose owner has been gone for a week, oldest era first.
  recyclable(now) {
    const gone = (b) => !b.ownerId || !this.state.builders[b.ownerId] || now - this.state.builders[b.ownerId].lastSeen > 7 * DAY;
    return this.builds.filter((b) => !b.wonder && b.status === 'done' && gone(b)).sort((a, b) => ITEMS[a.item].era - ITEMS[b.item].era || a.id - b.id)[0] || null;
  }

  // A new era: old buildings with a modern version rebuild themselves.
  evolve(now) {
    const s = this.state;
    let n = 0;
    for (const b of this.builds) {
      if (b.wonder || !b.built || b.status !== 'done') continue;
      const to = evolvedItem(b.item, s.era);
      if (to === b.item) continue;
      Object.assign(b, { status: 'building', upgrade: { item: to, level: 1 }, cost: {}, requestedAt: now, startedAt: now, walkSec: 0, buildSec: 15 + (n % 6) * 5, evolving: true });
      this.changed({ type: 'build', build: b });
      n++;
    }
    return n;
  }

  // --- Jobs: bots helping at producers, the wonder, or with repairs ---------------
  work(cmd, u, now) {
    const s = this.state;
    if (!s.builders[u.id]) return this.refuse(u, now, 'Build something first to get a bot: !build house');
    const job = s.jobs[u.id];
    if (job && job.kind !== 'gather') return this.refuse(u, now, 'Your bot is already working (#' + job.buildId + ').');
    const own = this.pendingOf(u.id);
    if (own && own.status === 'building') return this.refuse(u, now, 'Your bot is busy building #' + own.id + '.');
    let target = cmd.target;
    if (!target && cmd.raw) return this.refuse(u, now, 'Try !work wood, !work stone, !work food or !work wonder.');
    if (!target) target = this.suggestWork(u.id);
    if (target === 'wonder') {
      const w = this.currentWonder();
      if (!w || w.status === 'done') return this.refuse(u, now, 'The wonder is finished! Try !work wood or !work stone.');
      if (this.helpersAt(w.id) >= WONDER_HELPERS) return this.refuse(u, now, 'The wonder has enough helpers right now. Try !work wood.');
      return this.startJob(u, { buildId: w.id, kind: 'wonder', until: now + this.limits.workMinutes * 60e3 }, now, ITEMS[w.item].label);
    }
    if (!RESOURCES[target]) return this.refuse(u, now, 'Try !work wood, !work stone, !work food or !work wonder.');
    const makers = this.builds.filter((b) => E.isUp(b) && ITEMS[b.item].recipe?.out?.[target]);
    if (!makers.length) {
      const who = Object.keys(ITEMS).find((k) => ITEMS[k].recipe?.out?.[target] && ITEMS[k].era <= s.era);
      if (!who) return this.refuse(u, now, RESOURCES[target].label + ' arrives in the ' + ERAS[RESOURCES[target].era].name + '.');
      return this.refuse(u, now, 'Nobody makes ' + res(target) + ' yet. Build ' + withArticle(ITEMS[who].label.toLowerCase()) + ' first!');
    }
    const open = makers.filter((b) => this.helpersAt(b.id) < E.MAX_HELPERS);
    if (!open.length) return this.refuse(u, now, 'Every place that makes ' + res(target) + ' has helpers already. Try another job!');
    const least = Math.min(...open.map((b) => this.helpersAt(b.id)));
    const pickFrom = open.filter((b) => this.helpersAt(b.id) === least);
    const b = pickFrom[hashStr(u.id + ':' + now) % pickFrom.length];
    if (job) this.endJob(u.id, false);
    return this.startJob(u, { buildId: b.id, kind: 'work', res: target, until: now + this.limits.workMinutes * 60e3 }, now, ITEMS[b.item].label);
  }

  suggestWork(userId) {
    const waiting = this.builds.find((b) => b.ownerId === userId && b.status === 'queued' && b.waitingFor?.length);
    if (waiting) return waiting.waitingFor[0];
    const w = this.currentWonder();
    const cap = this.econ ? this.econ.cap : E.BASE_CAP;
    // The wonder is waiting for something: go make that.
    const short = (this.wonderShort || []).find((r) => this.builds.some((b) => E.isUp(b) && ITEMS[b.item].recipe?.out?.[r]));
    if (short && rndPick(userId) < 0.6) return short;
    if (w && w.status !== 'done' && this.helpersAt(w.id) < WONDER_HELPERS) return 'wonder';
    const makeable = E.unlockedResources(this.state.era).filter((r) => this.builds.some((b) => E.isUp(b) && ITEMS[b.item].recipe?.out?.[r]));
    makeable.sort((a, b) => (this.state.stock[a] || 0) / cap - (this.state.stock[b] || 0) / cap);
    return makeable[0] || 'wood';
  }

  startJob(u, job, now, where) {
    this.touchBuilder(u, now);
    job.startedAt = now;
    this.state.jobs[u.id] = job;
    this.changed({ type: 'job', userId: u.id, job });
    const verb = job.kind === 'wonder' ? 'is hauling goods to the' : job.kind === 'repair' ? 'is repairing the' : 'is helping at the';
    return { ok: true, message: u.name + ' ' + verb + ' ' + where + ' (#' + job.buildId + ').' };
  }

  endJob(userId, finished, now) {
    const job = this.state.jobs[userId];
    if (!job) return;
    delete this.state.jobs[userId];
    const b = this.builds.find((x) => x.id === job.buildId);
    if (finished) {
      if (job.kind === 'repair' && b) {
        b.damaged = false;
        delete b.repairBy;
        this.changed({ type: 'build', build: b });
        this.emit({ type: 'notice', kind: 'repair', user: this.nameOf(userId), text: 'repaired the ' + ITEMS[b.item].label.toLowerCase() + ' (#' + b.id + ')' });
      }
      this.grant(userId, { work: 6, wonder: 8, repair: 12, gather: 3 }[job.kind] || 0, now);
    } else if (job.kind === 'repair' && b) delete b.repairBy;
    this.changed({ type: 'job', userId, job: null });
  }

  helpersAt(buildId) {
    let n = 0;
    for (const j of Object.values(this.state.jobs)) if (j.buildId === buildId) n++;
    return n;
  }

  repair(u, now) {
    const s = this.state;
    if (!s.builders[u.id]) return this.refuse(u, now, 'Build something first to get a bot: !build house');
    const job = s.jobs[u.id];
    if (job && job.kind !== 'gather') return this.refuse(u, now, 'Your bot is already busy (#' + job.buildId + ').');
    const own = this.pendingOf(u.id);
    if (own && own.status === 'building') return this.refuse(u, now, 'Your bot is busy building #' + own.id + '.');
    const broken = this.builds.filter((b) => b.damaged && !b.repairBy).sort((a, b) => a.id - b.id);
    if (!broken.length) return this.refuse(u, now, 'Nothing is broken right now!');
    const b = broken[0];
    if (job) this.endJob(u.id, false);
    b.repairBy = u.id;
    this.changed({ type: 'build', build: b });
    return this.startJob(u, { buildId: b.id, kind: 'repair', until: now + this.limits.repairSec * 1000 }, now, ITEMS[b.item].label.toLowerCase());
  }

  // A viewer whose build waits for goods sends their bot to help make them.
  autoGather(b, now) {
    const s = this.state;
    if (!b.ownerId || s.jobs[b.ownerId] || !b.waitingFor?.length) return;
    for (const r of b.waitingFor) {
      const maker = this.builds.find((x) => E.isUp(x) && ITEMS[x.item].recipe?.out?.[r] && this.helpersAt(x.id) < E.MAX_HELPERS);
      if (maker) {
        s.jobs[b.ownerId] = { buildId: maker.id, kind: 'gather', res: r, until: now + 30 * 60e3, startedAt: now, forBuild: b.id };
        this.changed({ type: 'job', userId: b.ownerId, job: s.jobs[b.ownerId] });
        return;
      }
    }
  }

  // --- Votes and events --------------------------------------------------------------
  vote(cmd, u, now) {
    const v = this.state.vote;
    // Mods can start a vote right away with !vote start.
    if (cmd.start) {
      if (!u.mod && !u.broadcaster) return { ok: false, message: '' };
      if (v) return { ok: false, message: 'A vote is already running.' };
      if (this.state.event) { this.state.event = null; this.changed({ type: 'event', event: null }); }
      this.startVote(now);
      return { ok: true, message: 'Vote started: !1, !2 or !3.' };
    }
    if (!v) {
      const mins = Math.max(1, Math.round((this.state.nextVoteAt - now) / 60e3));
      return this.refuse(u, now, 'No vote right now. The next one starts in about ' + mins + ' min.');
    }
    if (!cmd.option) return this.refuse(u, now, 'Vote with !vote 1, !vote 2 or !vote 3.');
    const first = v.votes[u.id] == null;
    v.votes[u.id] = cmd.option - 1;
    if (first && this.state.builders[u.id]) this.grant(u.id, 1, now);
    this.changed({ type: 'vote', vote: this.voteView() });
    return { ok: true, message: u.name + ' voted for ' + EVENTS[v.options[cmd.option - 1]].label + '.' };
  }

  voteView() {
    const v = this.state.vote;
    if (!v) return null;
    const counts = v.options.map(() => 0);
    for (const i of Object.values(v.votes)) counts[i]++;
    return { options: v.options, counts, endsAt: v.endsAt };
  }

  eligibleEvents() {
    return Object.keys(EVENTS).filter((k) => (EVENTS[k].minEra || 0) <= this.state.era);
  }

  startVote(now) {
    const pool = this.eligibleEvents();
    const calm = pool.filter((k) => !EVENTS[k].chaos).sort(() => Math.random() - 0.5);
    const wild = pool.filter((k) => EVENTS[k].chaos).sort(() => Math.random() - 0.5);
    const options = Math.random() < 0.6 && wild.length ? [calm[0], calm[1], wild[0]] : calm.slice(0, 3);
    this.state.vote = { options: options.sort(() => Math.random() - 0.5), votes: {}, startedAt: now, endsAt: now + this.limits.voteSec * 1000 };
    this.changed({ type: 'vote', vote: this.voteView() });
  }

  resolveVote(now) {
    const view = this.voteView();
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

  forceEvent(cmd, u, now) {
    if (!u.mod && !u.broadcaster) return { ok: false, message: '' };
    if (!cmd.key) return { ok: false, message: 'Events: ' + Object.keys(EVENTS).join(', ') };
    if (this.state.vote) { this.state.vote = null; this.changed({ type: 'vote', vote: null, winner: null }); }
    this.startEvent(cmd.key, now);
    return { ok: true, message: 'Started ' + EVENTS[cmd.key].label + '.' };
  }

  startEvent(key, now) {
    const ev = EVENTS[key];
    const s = this.state;
    s.event = { key, startedAt: now, endsAt: now + ev.mins * 60e3 };
    const extra = {};
    if (ev.gift) extra.gift = this.merchantGift();
    if (ev.knowledgeMin) s.knowledge = Math.min(this.knowledgeNeed(), s.knowledge + ev.knowledgeMin);
    if (ev.damage) extra.damaged = this.damage(ev.damage, ev.damageKind);
    this.changed({ type: 'event', event: s.event, ...extra });
  }

  merchantGift() {
    const s = this.state;
    const cap = E.capacity(this.builds);
    const gift = {};
    const rs = E.unlockedResources(s.era).sort((a, b) => (s.stock[a] || 0) - (s.stock[b] || 0)).slice(0, 2);
    for (const r of rs) {
      const n = Math.max(0, Math.min(Math.round(cap * 0.1), 30 + 30 * s.era, cap - (s.stock[r] || 0)));
      if (n > 0) { s.stock[r] = (s.stock[r] || 0) + n; gift[r] = n; }
    }
    return gift;
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
    if (!s.vote && !s.event && now >= s.nextVoteAt) {
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
    const builder = this.state.builders[u.id];
    if (!builder) return this.refuse(u, now, 'Build something first to get a bot: !build house');
    if (!cmd.hat) return this.refuse(u, now, 'Hats: ' + Object.keys(HATS).join(', ') + '.');
    const level = levelFor(builder.xp || 0);
    if (HATS[cmd.hat].level > level) return this.refuse(u, now, 'The ' + HATS[cmd.hat].label.toLowerCase() + ' unlocks at level ' + HATS[cmd.hat].level + '. You are level ' + level + '.');
    if (this.onCooldown('hat:' + u.id, this.limits.hatCooldownSec, now)) return { ok: false, message: 'Hold on, still trying on the last hat.' };
    builder.hat = cmd.hat;
    this.touchBuilder(u, now);
    return { ok: true, message: u.name + ' now wears: ' + HATS[cmd.hat].label + '.' };
  }

  dance(u, now) {
    if (!this.state.builders[u.id]) return this.refuse(u, now, 'Build something first to get a bot: !build house');
    if (this.onCooldown('dance:' + u.id, this.limits.danceCooldownSec, now)) return { ok: false, message: 'Your bot needs a breather.' };
    this.touchBuilder(u, now);
    this.emit({ type: 'dance', userId: u.id });
    return { ok: true, message: u.name + ' is dancing!' };
  }

  me(u, now) {
    if (!this.state.builders[u.id]) return this.refuse(u, now, 'Build something first to get a bot: !build house');
    if (this.onCooldown('me:' + u.id, this.limits.meCooldownSec, now)) return { ok: false, message: '' };
    this.touchBuilder(u, now);
    const card = this.card(u.id, now);
    this.emit({ type: 'me', card });
    return { ok: true, message: u.name + ': level ' + card.level + ' ' + card.title + ', ' + card.buildings + (card.buildings === 1 ? ' building.' : ' buildings.') };
  }

  card(id, now) {
    const b = this.state.builders[id];
    const xp = b.xp || 0;
    const level = levelFor(xp);
    const ranked = this.leaders(now, 1000);
    const rank = ranked.findIndex((x) => x.id === id) + 1;
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
      buildings: this.builds.filter((x) => x.ownerId === id && x.built).length,
      slots: this.slotsOf(id),
      rank: rank || null,
      job: this.state.jobs[id] || null,
    };
  }

  help(now) {
    if (this.onCooldown('help', this.limits.helpCooldownSec, now)) return { ok: false, message: '' };
    const text = '!build house · !build ' + itemsOfEra(this.state.era)[1] + ' · !work wood · !work wonder · !upgrade · !vote 1 · !me';
    this.emit({ type: 'notice', kind: 'help', text });
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
    if (!this.lastEcon) this.lastEcon = now;
    const dt = (now - this.lastEcon) / 1000;
    if (dt >= ECON_STEP_SEC) {
      this.lastEcon = now;
      this.economy(now, Math.min(dt, 60));
    }
    this.updateVotes(now);
  }

  updateBuilds(now) {
    for (const b of this.builds) {
      if (b.status !== 'building' || b.wonder) continue;
      if (now < b.startedAt + (b.walkSec + b.buildSec) * 1000) continue;
      this.finishBuild(b, now);
    }
    let running = this.builds.filter((b) => b.status === 'building' && !b.wonder && !b.evolving).length;
    const queued = this.builds.filter((b) => b.status === 'queued').sort((a, b) => a.requestedAt - b.requestedAt || a.id - b.id);
    // A build that has waited long gets first claim on what it is missing.
    const reserved = new Set();
    for (const b of queued) {
      if (running >= this.limits.maxConcurrentBuilds) break;
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
      delete b.waitingFor;
      if (this.activeEvent(now)?.buildSpeed) b.buildSec = Math.ceil(b.buildSec / this.activeEvent(now).buildSpeed);
      const job = this.state.jobs[b.ownerId];
      if (job && job.kind === 'gather') this.endJob(b.ownerId, true, now);
      running++;
      this.changed({ type: 'build', build: b });
    }
  }

  finishBuild(b, now) {
    const builder = this.state.builders[b.ownerId];
    if (b.upgrade) {
      b.item = b.upgrade.item;
      b.level = b.upgrade.level;
      delete b.upgrade;
      if (b.evolving) delete b.evolving;
      else this.grant(b.ownerId, 8 + 4 * ITEMS[b.item].era, now);
    } else {
      this.grant(b.ownerId, 10 + 5 * ITEMS[b.item].era, now);
      if (builder) builder.builds = (builder.builds || 0) + 1;
    }
    b.status = 'done';
    b.doneAt = now;
    b.built = true;
    this.changed({ type: 'build', build: b });
  }

  updateJobs(now) {
    for (const [uid, job] of Object.entries(this.state.jobs)) {
      const b = this.builds.find((x) => x.id === job.buildId);
      if (!b || (job.kind === 'wonder' && b.status === 'done')) { this.endJob(uid, !!b, now); continue; }
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
    for (const j of Object.values(s.jobs)) helpers.set(j.buildId, (helpers.get(j.buildId) || 0) + 1);
    const out = E.produce(builds, s.stock, {
      employment,
      happyFactor: 0.6 + (0.8 * this.happy) / 100,
      global: 1 + 0.25 * robots,
      powerRatio: pw.ratio,
      helpers: (id) => helpers.get(id) || 0,
      boosts: ev?.boost || {},
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
        w.status = 'done';
        w.built = true;
        w.doneAt = now;
        this.changed({ type: 'build', build: w });
        this.emit({ type: 'notice', kind: 'wonder', text: 'The ' + ITEMS[w.item].label + ' is complete!' });
      }
    }
    if (!s.finished) s.knowledge = Math.min(this.knowledgeNeed(), s.knowledge + ((1 + E.knowledgeBoost(builds)) * dt) / 60);
    for (const r of Object.keys(s.stock)) s.stock[r] = Math.max(0, Math.min(cap, s.stock[r]));
    if (dt > 0) {
      for (const r of E.unlockedResources(s.era)) {
        const inst = (((out.made[r] || 0) - (out.used[r] || 0)) * 60) / dt;
        this.rates[r] = this.rates[r] == null ? inst : this.rates[r] * 0.9 + inst * 0.1;
      }
    }
    this.stalled = out.stalled;
    const needs = this.needs(cap, pw);
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
      wonder: w ? { id: w.id, item: w.item, progress: Math.round(E.wonderProgress(w) * 1000) / 1000, short: w.status === 'done' ? [] : this.wonderShort } : null,
      stalled: out.stalled,
      needs,
    };
    if (dt > 0) {
      this.dirty = true;
      this.emit({ type: 'economy', econ: this.econ });
      if (out.pops.length) this.emit({ type: 'produce', pops: out.pops });
      this.checkEra(now);
    }
  }

  // What the village is short of right now, with the building that helps
  // most. Shown on stream so chat knows what to do next.
  needs(cap, pw) {
    const s = this.state;
    const out = [];
    const add = (r, why) => {
      if (out.some((n) => n.res === r)) return;
      const item = E.bestMaker(r, s.era);
      if (item) out.push({ res: r, why, item });
    };
    if (pw.demand > pw.supply * 1.02) add('power', 'power');
    const food = s.stock.food || 0;
    if (food < cap * 0.15 && (this.rates.food || 0) <= 0.5) add('food', 'hungry');
    for (const r of this.wonderShort || []) add(r, 'wonder');
    for (const b of this.builds) if (b.status === 'queued') for (const r of b.waitingFor || []) add(r, 'build');
    for (const r of E.unlockedResources(s.era)) if ((s.stock[r] || 0) < cap * 0.08 && RESOURCES[r].era >= s.era - 1) add(r, 'low');
    return out.slice(0, 3);
  }

  checkEra(now) {
    const s = this.state;
    if (s.finished) return;
    const w = this.currentWonder();
    if (!w || w.status !== 'done' || s.knowledge < this.knowledgeNeed() || s.population < ERAS[s.era].popGoal) return;
    if (s.era >= ERAS.length - 1) {
      s.finished = true;
      s.finishedAt = now;
      this.changed({ type: 'finale', at: now });
      return;
    }
    s.era++;
    s.eraStartedAt = now;
    s.knowledge = 0;
    s.eraHistory = (s.eraHistory || []).concat([{ era: s.era, at: now }]);
    this.ensureWonder(now);
    const evolved = this.evolve(now);
    this.changed({ type: 'era', era: s.era, at: now, evolved });
  }

  ensureWonder(now) {
    const s = this.state;
    const key = ERAS[s.era].wonder;
    let w = this.builds.find((b) => b.wonder && b.item === key);
    if (w) return w;
    const [q, r] = wonderTile(s.era);
    w = { id: ++s.seq, item: key, wonder: true, color: null, level: 1, q, r, ownerId: null, status: 'building', requestedAt: now, startedAt: now, walkSec: 0, buildSec: 0, doneAt: null, cost: {}, delivered: {}, built: false };
    this.builds.push(w);
    this.changed({ type: 'build', build: w });
    return w;
  }

  // Ring 1 is for wonders; anything an old save left there moves out.
  relocateWonderRing(now) {
    for (const b of this.builds) {
      if (b.wonder || hexDist(b.q, b.r) !== WONDER_RING) continue;
      const plot = this.choosePlot(b.item, b.ownerId, b.id);
      if (plot) { b.q = plot[0]; b.r = plot[1]; this.dirty = true; }
    }
    void now;
  }

  // --- Helpers ------------------------------------------------------------------------------
  pendingOf(userId) {
    return this.builds.find((b) => b.ownerId === userId && b.status !== 'done') || null;
  }
  slotsOf(userId) {
    const b = this.state.builders[userId];
    return Math.min(this.limits.maxBuildsPerUser, buildSlots(levelFor(b ? b.xp || 0 : 0), this.state.era));
  }
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
    return 'That needs ' + cost[r] + ' ' + res(r) + ' but storage holds ' + cap + '. Build ' + withArticle(ITEMS[storage].label.toLowerCase()) + ' first!';
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

  // Where should this go? Homes near parks and markets, producers out at
  // the edge away from homes, lighthouses and harbors on the coast, and every
  // viewer's builds next to each other so each viewer grows a neighborhood.
  choosePlot(item, ownerId, salt, near) {
    const at = new Map(this.builds.map((b) => [hexKey(b.q, b.r), b]));
    const taken = new Set([hexKey(0, 0), ...ringTiles(WONDER_RING).map(([q, r]) => hexKey(q, r)), ...at.keys()]);
    let land = this.landRing();
    let candidates = [];
    for (;;) {
      candidates = [];
      for (let n = WONDER_RING + 1; n <= land; n++) for (const t of ringTiles(n)) if (!taken.has(hexKey(t[0], t[1]))) candidates.push(t);
      if (candidates.length || land >= MAX_RING) break;
      land++;
    }
    if (!candidates.length) return null;
    const it = ITEMS[item];
    const zone = it.zone;
    const kind = it.kind;
    const edge = Math.max(WONDER_RING + 1, ...this.builds.filter((b) => !b.wonder).map((b) => hexDist(b.q, b.r)));
    const outskirts = kind === 'producer' || kind === 'power' || kind === 'storage';
    let best = null;
    let bestScore = Infinity;
    for (const [q, r] of candidates) {
      const ring = hexDist(q, r);
      let s;
      if (zone === 'inner') s = ring * 3;
      else if (zone === 'outer') s = Math.abs(edge - ring) * 2.5;
      else if (zone === 'coast') s = Math.abs(edge - ring) * 6;
      else s = ring * 1.5;
      for (const [dq, dr] of NEAR2) {
        const o = at.get(hexKey(q + dq, r + dr));
        if (!o) continue;
        const d = hexDist(dq, dr);
        const ok = ITEMS[o.item];
        if (o.ownerId && o.ownerId === ownerId) s -= d === 1 ? 2.5 : 0.8;
        else if (d === 1) s -= 0.4;
        if (kind === 'house' && ok.comfort) s -= 0.6;
        if (ok.kind === 'house' && it.comfort) s -= 0.6;
        if (outskirts && ok.kind === 'house' && d === 1) s += 0.5;
        if (near && (o.item === near || (near === 'house' && ok.kind === 'house'))) s -= d === 1 ? 4 : 2;
      }
      s += ((hashStr(salt + ':' + q + ',' + r) % 1000) / 1000) * 1.5;
      if (s < bestScore) { bestScore = s; best = [q, r]; }
    }
    return best;
  }
}

