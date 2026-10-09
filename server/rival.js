// The rival: an AI town on the far side of the world. It plays by the same
// rules as chat (the same buildings, goods, land, wonders and eras) and races
// chat to the Future. Land is shared: whoever builds near a forest or a coal
// deposit first keeps it, so both towns spread out over the whole map.
//
// It plays like a small, steady chat of a few regulars: a crew of AI bots
// gathers and builds, and about once an hour it starts something new (some
// 20 buildings a day). Its speed leans a little towards keeping the race
// close, so a busy chat can pull ahead and a sleeping chat is not left
// hopelessly behind.
import { ITEMS, ERAS, RESOURCES, BUILD_LEVELS, hashStr, houseFor, evolvedItem, itemsOfEra, otherWonder, wondersOf } from '../public/shared/catalog.js';
import { hexDist, hexKey } from '../public/shared/hex.js';
import * as M from '../public/shared/terrain.js';
import * as E from './economy.js';

export const RIVAL_NAME = 'Cogsworth';
const ID0 = 1_000_000;
const STEP_SEC = 5;
const LABOR = 6;
const RAW = ['wood', 'stone', 'food', 'marble', 'coal', 'iron'];

// A home on the far side: land away from the sea, about 27 tiles out, with
// forest, hills and berries around it.
export function pickOrigin(map) {
  const away = map.seaAngle + Math.PI;
  let best = null;
  let bestScore = -Infinity;
  for (const t of map.tiles) {
    if (t.d < 24 || t.d > 31 || !['grass', 'meadow'].includes(t.t)) continue;
    const off = Math.abs(Math.atan2(Math.sin(M.angleOf(t) - away), Math.cos(M.angleOf(t) - away)));
    if (off > 0.9) continue;
    let score = -off * 4;
    const kinds = new Set();
    for (const n of M.tilesWithin(map, t, 6)) {
      if (!M.walkable(n)) score -= 0.4;
      if (['forest', 'hills', 'meadow'].includes(n.t)) { kinds.add(n.t); score += 0.2; }
      if (TERRAIN_WATER.has(n.t)) score += 0.05;
    }
    score += kinds.size * 3;
    // Coal and iron of its own, a little way out, like the town has.
    const ores = new Set(M.tilesWithin(map, t, 10).filter((n) => n.f === 'coal' || n.f === 'iron').map((n) => n.f));
    score += ores.size * 6;
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return best || map.tiles.reduce((a, t) => (t.d > a.d && M.walkable(t) ? t : a), map.tiles[0]);
}
const TERRAIN_WATER = new Set(['deep', 'water', 'river']);

export function freshRival(map, now, era = 0) {
  const o = pickOrigin(map);
  return {
    name: RIVAL_NAME,
    origin: { q: o.q, r: o.r },
    seq: ID0,
    builds: [],
    stock: { ...E.START_STOCK },
    era,
    eraStartedAt: now,
    knowledge: 0,
    population: 0,
    explored: '',
    crew: 3,
    nextThink: now + 2 * 60e3,
    history: [{ era, at: now }],
    finished: false,
    finishedAt: null,
    met: false,
    lastStep: 0,
    eraFirst: {},
  };
}

export class Rival {
  constructor(world, state) {
    this.w = world;
    this.s = state;
    this.map = world.map;
    this.bits = M.decodeBits(state.explored, this.map);
    if (!state.explored) {
      M.reveal(this.map, this.bits, state.origin.q, state.origin.r, M.START_RADIUS);
      this.saveBits();
    }
    this.known = (t) => M.isExplored(this.bits, t.i);
    this.progress = new Map();
    this.fuel = new Map();
    this.happy = 50;
    this.lastHappy = 0;
    this.landCache = null;
    this.view = null;
  }

  get builds() {
    return this.s.builds;
  }
  saveBits() {
    this.s.explored = M.encodeBits(this.bits);
  }
  distTo(t) {
    return hexDist(t.q - this.s.origin.q, t.r - this.s.origin.r);
  }
  stores() {
    return [this.s.origin].concat(this.builds.filter((b) => E.isUp(b) && ITEMS[b.item].kind === 'storage'));
  }
  // Tiles within two steps of a rival building: chat cannot build or gather
  // there (and the rival keeps out of the town's land the same way).
  land() {
    if (this.landCache && this.landCache.n === this.builds.length) return this.landCache.set;
    const set = new Set();
    for (const b of this.builds) {
      const t = M.tileAt(this.map, b.q, b.r);
      if (t) for (const n of M.tilesWithin(this.map, t, 2)) set.add(n.i);
    }
    // Its home ground: 10 tiles round its square.
    const o = M.tileAt(this.map, this.s.origin.q, this.s.origin.r);
    if (o) for (const n of M.tilesWithin(this.map, o, 10)) set.add(n.i);
    this.landCache = { n: this.builds.length, set };
    return set;
  }
  invalidate() {
    this.landCache = null;
  }

  // How hard the rival plays: leaning towards a close race. Half an era
  // behind chat it plays 40% faster, half an era ahead 35% slower.
  speed() {
    const gap = this.w.raceProgress().total - this.raceProgress().total;
    const lean = Math.max(-0.35, Math.min(0.45, 0.8 * gap));
    return Math.max(0.4, (this.w.rivalDifficulty || 1) * (1 + lean));
  }
  // How far along the road to the Future: the era, plus how far the slowest
  // of knowledge, the wonder and people is towards the next one.
  raceProgress() {
    const s = this.s;
    return raceProgress(s.era, s.finished, s.knowledge / this.w.knowledgeNeed(), this.currentWonder(), s.population);
  }
  summary() {
    const s = this.s;
    const w = this.currentWonder();
    return {
      name: s.name,
      era: s.era,
      population: Math.floor(s.population),
      builds: this.builds.filter((b) => b.built && !b.wonder).length,
      outposts: this.builds.filter((b) => b.item === 'outpost' && b.built).length,
      knowledge: Math.round((100 * s.knowledge) / this.w.knowledgeNeed()),
      wonder: w ? Math.round(E.wonderProgress(w) * 100) : 100,
      wonderItem: w ? w.item : null,
      wonderPending: !!w?.pending,
      progress: this.raceProgress(),
      finished: s.finished,
      met: s.met,
      origin: s.origin,
    };
  }

  currentWonder() {
    const era = this.s.era;
    return this.builds.find((b) => b.wonder && ITEMS[b.item].era === era) || null;
  }
  // It builds the wonder chat did not choose; until chat has voted, just a
  // wonder (both need the same goods).
  ensureWonder(now) {
    if (this.currentWonder()) return;
    const old = this.builds.find((b) => b.wonder);
    if (old) {
      // The rival's square holds one wonder: the new era's replaces the last.
      this.builds.splice(this.builds.indexOf(old), 1);
      this.w.emit({ type: 'remove', id: old.id });
    }
    const pick = this.w.state.picks?.[this.s.era];
    const w = { id: ++this.s.seq, item: pick ? otherWonder(pick) : wondersOf(this.s.era)[1], wonder: true, rival: true, color: null, level: 1, q: this.s.origin.q, r: this.s.origin.r, status: 'building', startedAt: now, walkSec: 0, buildSec: 0, delivered: {}, built: false, cost: {} };
    if (!pick) w.pending = true;
    this.builds.push(w);
    this.invalidate();
    this.changed(w);
  }
  pickWonder(era, key) {
    const w = this.builds.find((b) => b.wonder && ITEMS[b.item].era === era);
    if (!w) return;
    w.item = key;
    delete w.pending;
    this.changed(w);
  }
  changed(b) {
    this.w.dirty = true;
    this.w.emit({ type: 'build', build: b });
  }

  tick(now) {
    const s = this.s;
    if (!s.lastStep) s.lastStep = now;
    const dt = (now - s.lastStep) / 1000;
    if (dt < STEP_SEC) return;
    s.lastStep = now;
    this.ensureWonder(now);
    const sp = this.speed();
    this.step(now, Math.min(dt, 60), sp);
    this.grow(now, Math.min(dt, 60), sp);
    if (now >= s.nextThink) {
      s.nextThink = now + ((45 + (hashStr('t' + now) % 30)) * 60e3) / sp;
      this.think(now);
    }
  }

  // One economy step: the same rules as the town.
  step(now, dt, sp) {
    const s = this.s;
    const builds = this.builds;
    const cap = E.capacity(builds);
    const popCap = E.popCapacity(builds);
    const jobs = E.jobsNeeded(builds);
    const employment = jobs > 0 ? Math.min(1, s.population / jobs) : 1;
    const pw = E.power(builds, now, this.fuel, this.w.geo);
    if (now - this.lastHappy > 30e3) {
      this.happy = E.happiness(builds, { foodShort: (s.stock.food || 0) < 0.5 && s.population > 1, powerRatio: pw.ratio });
      this.lastHappy = now;
    }
    const stores = this.stores();
    const out = E.produce(builds, s.stock, {
      employment,
      happyFactor: 0.6 + (0.8 * this.happy) / 100,
      global: 1,
      powerRatio: pw.ratio,
      helpers: () => 0,
      boosts: {},
      reach: (b) => reachOf(b, stores),
      progress: this.progress,
      fuel: this.fuel,
      cap,
    }, dt);
    this.stalled = out.stalled;
    this.powerRatio = pw.ratio;
    // The crew gathers by hand what the town has least of.
    const raw = RAW.filter((r) => RESOURCES[r].era <= s.era && (r !== 'coal' && r !== 'iron' ? true : this.knowsOre(r)));
    if (raw.length) {
      const r = raw.reduce((a, b) => ((s.stock[b] || 0) < (s.stock[a] || 0) ? b : a));
      const load = 2 + (5 * Math.min(s.era, ERAS.length - 1)) / (ERAS.length - 1);
      s.stock[r] = Math.min(cap, (s.stock[r] || 0) + ((s.crew * 0.5 * load) / 40) * dt * sp);
    }
    const eat = (s.population * E.foodPerPop(s.era) * dt) / 60;
    const ate = Math.min(s.stock.food || 0, eat);
    s.stock.food = (s.stock.food || 0) - ate;
    const fed = ate >= eat - 1e-9;
    if (fed && this.happy >= E.MOVE_IN_HAPPINESS && s.population < popCap) s.population += Math.max(0.05 * dt, (popCap - s.population) * Math.min(1, dt / 120));
    else if (!fed) s.population -= s.population * 0.02 * (dt / 60);
    s.population = Math.max(0, Math.min(popCap, s.population));
    s.crew = Math.min(12, 3 + Math.floor(s.population / 10));
    const w = this.currentWonder();
    if (w && w.status !== 'done') {
      const fraction = ((1 + 0.6 * Math.min(4, s.crew / 3)) * dt * sp) / 60 / (this.w.pace.eraDays * 1440 * 0.85);
      E.deliverToWonder(w, s.stock, { fraction, cap });
      if (E.wonderProgress(w) >= 0.9999) {
        // Nobody voted all this time: chance decides for both towns.
        if (w.pending) this.w.autoPick(s.era, now);
        w.status = 'done';
        w.built = true;
        w.doneAt = now;
        this.changed(w);
      }
    }
    if (!s.finished) s.knowledge = Math.min(this.w.knowledgeNeed(), s.knowledge + ((1 + E.knowledgeBoost(builds)) * dt * Math.min(1.3, sp)) / 60);
    for (const r of Object.keys(s.stock)) s.stock[r] = Math.max(0, Math.min(cap, s.stock[r]));
    this.checkEra(now);
  }

  knowsOre(r) {
    return this.map.tiles.some((t) => t.f === r && this.known(t) && !this.w.ownLand().has(t.i));
  }

  checkEra(now) {
    const s = this.s;
    if (s.finished) return;
    const w = this.currentWonder();
    if (!w || w.status !== 'done' || s.knowledge < this.w.knowledgeNeed() || s.population < ERAS[s.era].popGoal) return;
    if (s.era >= ERAS.length - 1) {
      s.finished = true;
      s.finishedAt = now;
      this.w.emit({ type: 'notice', kind: 'rival', text: s.name + ' finished their ' + ITEMS[w.item].label + ' and won the race to the Future! The town carries on.' });
      return;
    }
    s.era++;
    s.eraStartedAt = now;
    s.knowledge = 0;
    s.history.push({ era: s.era, at: now });
    const first = this.w.state.era < s.era;
    if (first) s.eraFirst[s.era] = 'rival';
    // Every building turns into its new-era version.
    for (const b of this.builds) {
      if (b.wonder || !b.built) continue;
      const to = ITEMS[b.item].kind === 'house' ? houseFor(s.era) : evolvedItem(b.item, s.era);
      if (to !== b.item) { b.item = to; this.changed(b); }
    }
    this.ensureWonder(now);
    this.w.emit({ type: 'notice', kind: 'rival', text: s.name + ' entered ' + ERAS[s.era].the + (first ? ' first! Chat, catch up!' : '.') });
    this.w.emit({ type: 'rival', rival: this.summary() });
  }

  // Building projects: the crew works on at most two at a time.
  grow(now, dt, sp) {
    const active = this.builds.filter((b) => !b.wonder && b.status === 'building');
    if (!active.length) return;
    const rate = ((0.25 + (0.15 * this.s.crew) / active.length) * sp);
    for (const b of active) {
      b.progress = Math.min(b.work, (b.progress || 0) + dt * rate);
      b.rate = Math.round(rate * 100) / 100;
      b.progressAt = now;
      if (b.progress >= b.work - 1e-6) this.finish(b, now);
    }
  }
  finish(b, now) {
    if (b.upgrade) {
      b.item = b.upgrade.item;
      b.level = b.upgrade.level;
      delete b.upgrade;
    }
    b.status = 'done';
    b.built = true;
    b.doneAt = now;
    b.progress = b.work;
    delete b.rate;
    const t = M.tileAt(this.map, b.q, b.r);
    if (t) {
      M.reveal(this.map, this.bits, b.q, b.r, ITEMS[b.item].reveal || 2);
      this.saveBits();
    }
    this.invalidate();
    this.changed(b);
  }

  // What to build next, the way a sensible chat would: first whatever makes
  // the goods the wonder and this era's buildings need, then food, homes,
  // storage, power, knowledge and happiness, then outposts and new things.
  think(now) {
    const s = this.s;
    this.scout();
    const active = this.builds.filter((b) => !b.wonder && b.status === 'building');
    if (active.length >= 2) return;
    const cap = E.capacity(this.builds);
    const popCap = E.popCapacity(this.builds);
    const wants = [];
    // A want is a building, or a building for one good (a mine for iron).
    const add = (want, need = false) => {
      const w = typeof want === 'string' ? { item: want } : want;
      if (w && ITEMS[w.item] && ITEMS[w.item].era <= s.era && !wants.some((x) => x.item === w.item && x.res === w.res)) wants.push({ ...w, need });
    };
    // A maker of a good it needs may take the place of old buildings.
    const maker = (r) => {
      const k = E.makersOf(r, s.era).find((item) => this.plot(item, true, r) || this.spareFor(item, r, true));
      return k ? { item: k, res: r } : null;
    };
    // Power first: buildings without it make nothing.
    const pw = E.power(this.builds, now, this.fuel, this.w.geo);
    if (pw.demand > pw.supply * 0.98) add(this.powerMaker(), true);
    const w = this.currentWonder();
    const needed = new Set(Object.keys(w && w.status !== 'done' ? ITEMS[w.item].needs : {}));
    for (const k of itemsOfEra(s.era)) for (const r of Object.keys(ITEMS[k].cost)) needed.add(r);
    for (const r of needed) if (RESOURCES[r] && RESOURCES[r].era <= s.era && !this.makes(r)) add(maker(r), true);
    if ((s.stock.food || 0) < cap * 0.2) add(maker('food'), true);
    if (s.population >= popCap - 1 && popCap < ERAS[s.era].popGoal * 1.25) add(houseFor(s.era), true);
    // More makers of a scarce good, but only while the ones it has are
    // working (not waiting for power or inputs) and not too many already.
    for (const r of E.unlockedResources(s.era)) if ((s.stock[r] || 0) < cap * 0.12 && this.canUseMore(r, pw)) add(maker(r), true);
    // Knowledge makes every era shorter: campfires, then schools and labs,
    // until they give all they can.
    if (E.knowledgeBoost(this.builds) < 0.5) add(Object.keys(ITEMS).filter((k) => ITEMS[k].knowledge && ITEMS[k].era <= s.era).sort((a, b) => ITEMS[b].knowledge - ITEMS[a].knowledge)[0]);
    if (this.happy < 60) add(Object.keys(ITEMS).filter((k) => ITEMS[k].kind === 'decor' && ITEMS[k].era <= s.era).sort((a, b) => ITEMS[b].era - ITEMS[a].era)[0]);
    // A store when goods overflow (not too many), an outpost now and then.
    const full = Object.values(s.stock).filter((n) => n >= cap * 0.85).length;
    const stores = this.builds.filter((b) => ITEMS[b.item].kind === 'storage' && b.item !== 'outpost').length;
    if (full >= 2 && stores < 2 + s.era * 2) add(Object.keys(ITEMS).filter((k) => ITEMS[k].kind === 'storage' && ITEMS[k].era <= s.era && k !== 'outpost').sort((a, b) => ITEMS[b].era - ITEMS[a].era)[0]);
    // Outposts reach out over the map, a couple more every era.
    const outposts = this.builds.filter((b) => b.item === 'outpost').length;
    const roomOut = outposts < 2 + s.era * 2;
    if (roomOut && this.builds.length > 8 + outposts * 12) add('outpost');
    const fresh = itemsOfEra(s.era).filter((k) => ITEMS[k].kind !== 'house' && !this.builds.some((b) => b.item === k));
    add(fresh[hashStr('f' + now) % Math.max(1, fresh.length)]);
    for (const w of wants) if (this.start(w.item, now, w.res, w.need)) return;
    if (this.upgradeOne(now)) return;
    // Nothing urgent: keep growing like a busy chat does. More homes, another
    // producer of what is shortest, something pretty, or an outpost.
    // Decor only while people are not content: a town of campfires is no town.
    const low = E.unlockedResources(s.era).reduce((a, r) => ((s.stock[r] || 0) < (s.stock[a] || 0) ? r : a), 'wood');
    const decor = Object.keys(ITEMS).filter((k) => ITEMS[k].kind === 'decor' && ITEMS[k].era <= s.era && ITEMS[k].era >= s.era - 1);
    const asWant = (x) => (typeof x === 'string' ? { item: x } : x);
    const lowMaker = this.canUseMore(low, pw) ? maker(low) : null;
    const more = [lowMaker, popCap < ERAS[s.era].popGoal * 1.8 ? houseFor(s.era) : null, this.happy < 80 ? decor[hashStr('d' + now) % decor.length] : null, roomOut ? 'outpost' : lowMaker].map(asWant);
    const k = hashStr('m' + now) % more.length;
    for (let i = 0; i < more.length; i++) {
      const w = more[(k + i) % more.length];
      if (w && this.start(w.item, now, w.res)) return;
    }
  }

  // A power plant it can keep going: no coal plant without coal.
  powerMaker() {
    const s = this.s;
    return E.powerMakers(this.builds, s.era).find((k) => {
      const inp = ITEMS[k].recipe?.in || {};
      const fed = Object.keys(inp).every((r) => this.makes(r) || (s.stock[r] || 0) > 30 || (RAW.includes(r) && this.knowsOre(r)));
      return fed && (this.plot(k, true) || this.spareFor(k, null, true));
    }) || null;
  }

  canUseMore(r, pw) {
    const makers = this.builds.filter((b) => !b.wonder && ITEMS[b.item].recipe?.out?.[r]);
    if (makers.length >= 4 + this.s.era * 2) return false;
    if (makers.some((b) => this.stalled?.[b.id])) return false;
    if (makers.some((b) => ITEMS[b.item].power < 0) && pw.ratio < 0.95) return false;
    return true;
  }

  // Is there a building that makes this good?
  makes(r) {
    return this.builds.some((b) => !b.wonder && ITEMS[b.item].recipe?.out?.[r] && (!b.ores || b.ores.includes(r)));
  }

  // A rival scout looks a little further, mostly towards the middle of the
  // world (where the town is).
  scout() {
    const front = M.frontier(this.map, this.bits).filter((t) => M.walkable(t));
    if (!front.length) return;
    const pick = front.reduce((a, t) => (this.distTo(t) * 0.6 + t.d < this.distTo(a) * 0.6 + a.d ? t : a), front[0]);
    M.reveal(this.map, this.bits, pick.q, pick.r, M.SCOUT_RADIUS);
    this.saveBits();
  }

  start(item, now, res = null, need = false) {
    const s = this.s;
    const it = ITEMS[item];
    if (!it || it.kind === 'wonder') return false;
    if (Object.entries(it.cost).some(([r, n]) => (s.stock[r] || 0) < n)) return false;
    let t = this.plot(item, false, res);
    const spare = t ? null : this.spareFor(item, res, need);
    if (spare) t = M.tileAt(this.map, spare.q, spare.r);
    if (!t) return false;
    if (spare) {
      this.builds.splice(this.builds.indexOf(spare), 1);
      this.progress.delete(spare.id);
      this.w.emit({ type: 'remove', id: spare.id });
    }
    for (const [r, n] of Object.entries(it.cost)) s.stock[r] -= n;
    const b = { id: ++s.seq, item, rival: true, project: true, color: null, level: 1, q: t.q, r: t.r, status: 'building', startedAt: now, walkSec: 0, buildSec: it.buildSec, work: it.buildSec * LABOR, progress: 0, progressAt: now, built: false, cost: { ...it.cost } };
    b.rich = Math.round(M.richness(this.map, item, t) * 100) / 100;
    if (M.siteOf(item).ore) b.ores = M.oresNear(this.map, t);
    this.builds.push(b);
    this.invalidate();
    this.changed(b);
    return true;
  }

  upgradeOne(now) {
    const s = this.s;
    const b = this.builds.filter((x) => x.built && x.status === 'done' && !x.wonder && ITEMS[x.item].recipe && (x.level || 1) < BUILD_LEVELS).sort((x, y) => (x.level || 1) - (y.level || 1))[0];
    if (!b) return false;
    const level = b.level || 1;
    const cost = Object.fromEntries(Object.entries(ITEMS[b.item].cost).map(([r, n]) => [r, Math.ceil(n * 0.75 * (level + 1))]));
    if (Object.entries(cost).some(([r, n]) => (s.stock[r] || 0) < n)) return false;
    for (const [r, n] of Object.entries(cost)) s.stock[r] -= n;
    Object.assign(b, { status: 'building', upgrade: { item: b.item, level: level + 1 }, work: Math.round(ITEMS[b.item].buildSec * LABOR * 0.5 * level), progress: 0, progressAt: now });
    this.changed(b);
    return true;
  }

  // A full rival makes room the way the town does (see E.spareScorer).
  spareFor(item, res = null, need = false) {
    const it = ITEMS[item];
    if (it.zone === 'far') return null;
    const town = this.w.ownLand();
    const spare = E.spareScorer(this.builds, this.s.stock, E.capacity(this.builds), it, { need, happy: this.happy });
    const ore = M.siteOf(item).ore && (res === 'coal' || res === 'iron') ? res : null;
    let best = null;
    let bestScore = Infinity;
    for (const b of this.builds) {
      if (b.item === item) continue;
      const sc = spare(b);
      if (sc == null || sc >= bestScore) continue;
      const t = M.tileAt(this.map, b.q, b.r);
      if (!t || !M.siteOk(this.map, item, t, (n) => this.known(n) && !town.has(n.i))) continue;
      if (ore && !M.oresNear(this.map, t).includes(ore)) continue;
      bestScore = sc;
      best = b;
    }
    return best;
  }

  // Where the rival builds: its own known land, never on the town's land.
  // res: the good it is for (a mine for iron sits next to iron).
  plot(item, quick, res = null) {
    const it = ITEMS[item];
    const taken = this.w.allTaken();
    const town = this.w.ownLand();
    const stores = this.stores();
    const site = M.siteOf(item);
    const prod = ['producer', 'power'].includes(it.kind) || !!site.near || !!site.ore;
    let best = null;
    let bestScore = Infinity;
    for (const t of this.map.tiles) {
      if (!this.known(t) || town.has(t.i) || taken.has(hexKey(t.q, t.r))) continue;
      const d = this.distTo(t);
      if (d < 1) continue;
      if (!M.siteOk(this.map, item, t, (n) => this.known(n) && !town.has(n.i))) continue;
      if (site.ore && (res === 'coal' || res === 'iron') && !M.oresNear(this.map, t).includes(res)) continue;
      let sc;
      if (it.zone === 'far') {
        let ds = Infinity;
        for (const st of stores) ds = Math.min(ds, hexDist(st.q - t.q, st.r - t.r));
        if (ds < 6) continue;
        let value = 0;
        for (const n of M.tilesWithin(this.map, t, 3)) {
          if (!this.known(n)) value += 0.2;
          else if (['forest', 'hills', 'meadow'].includes(n.t)) value += 0.6;
          if (n.f === 'coal' || n.f === 'iron') value += 3;
        }
        // Rivals push towards the middle of the world, where the town is.
        sc = -value + ds * 0.4 + t.d * 0.08;
      } else if (prod) {
        let ds = Infinity;
        for (const st of stores) ds = Math.min(ds, hexDist(st.q - t.q, st.r - t.r));
        sc = d * 0.3 - M.richness(this.map, item, t) * 5 + 0.8 * Math.max(0, ds - 4);
      } else sc = d * (it.zone === 'inner' ? 1.4 : 1);
      if (quick) return t;
      sc += ((hashStr(item + ':' + t.i) % 1000) / 1000) * 1.2;
      if (sc < bestScore) { bestScore = sc; best = t; }
    }
    return best;
  }
}

// How far a town is towards its next era. The next era only starts when
// people, the wonder and knowledge are all there, so the slowest of the
// three counts (a crowd of new homes in the first minutes is no lead).
export function raceProgress(era, finished, knowledge, wonder, population) {
  const r3 = (x) => Math.round(x * 1000) / 1000;
  if (finished) return { era, frac: 1, total: era + 1, parts: { people: 1, wonder: 1, knowledge: 1 } };
  const parts = {
    people: r3(Math.min(1, population / ERAS[era].popGoal)),
    wonder: r3(wonder ? (wonder.status === 'done' ? 1 : E.wonderProgress(wonder)) : 0),
    knowledge: r3(Math.min(1, knowledge)),
  };
  const frac = Math.min(parts.people, parts.wonder, parts.knowledge);
  return { era, frac, total: r3(era + frac), parts };
}

function reachOf(t, stores) {
  let d = Infinity;
  for (const s of stores) d = Math.min(d, hexDist(s.q - t.q, s.r - t.r));
  return d <= 4 ? 1 : Math.max(0.4, 1 - 0.1 * (d - 4));
}
