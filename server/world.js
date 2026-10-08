// The rules of BotWorld. The server owns the world: it decides what gets
// built where and when it is finished. The page only animates what it hears.
import { ITEMS, HATS, PALETTE, hashStr } from '../public/shared/catalog.js';
import { MAX_RING, hexDist, hexKey, landRingFor, neighbors, ringTiles } from '../public/shared/hex.js';
import { parseCommand } from './commands.js';

export const DEFAULT_LIMITS = {
  maxBuildsPerUser: 8,
  maxQueue: 30,
  maxConcurrentBuilds: 6,
  hatCooldownSec: 10,
  danceCooldownSec: 30,
  noticeCooldownSec: 20,
  helpCooldownSec: 30,
};

// A bot needs a moment to walk from the landing pad to its plot.
const WALK_BASE_SEC = 3;
const WALK_SEC_PER_RING = 2;
const UPGRADE_FACTOR = 0.6;
const HAT_CHOICES = Object.keys(HATS).filter((h) => h !== 'none');

export function freshState(now) {
  return { version: 1, createdAt: now, seq: 0, builds: [], builders: {} };
}

export function cleanName(name) {
  const s = String(name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 25);
  return s || 'someone';
}

export class World {
  constructor(state, { limits } = {}) {
    this.state = state;
    this.limits = { ...DEFAULT_LIMITS, ...(limits || {}) };
    this.cooldowns = new Map();
    this.listeners = new Set();
    this.dirty = false;
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

  landRing() {
    const maxBuilt = this.builds.reduce((m, b) => Math.max(m, hexDist(b.q, b.r)), 0);
    return landRingFor(maxBuilt);
  }

  snapshot(now) {
    return {
      serverNow: now,
      createdAt: this.state.createdAt,
      builds: this.builds,
      builders: Object.values(this.state.builders),
      landRing: this.landRing(),
    };
  }

  // One chat line in, at most one command applied. Returns null when the line
  // was not a command, else { ok, message } (the message is what the bot
  // would answer; the page shows the important ones as notices).
  handleChat(user, text, now) {
    const cmd = parseCommand(text);
    if (!cmd) return null;
    return this.apply(cmd, user, now);
  }

  apply(cmd, user, now) {
    const u = { ...user, id: String(user.id || user.name || ''), name: cleanName(user.name) };
    if (!u.id) return { ok: false, message: 'Unknown user.' };
    switch (cmd.type) {
      case 'build': return this.build(cmd, u, now);
      case 'upgrade': return this.upgrade(u, now);
      case 'hat': return this.hat(cmd, u, now);
      case 'dance': return this.dance(u, now);
      case 'help': return this.help(now);
      case 'remove': return this.remove(cmd, u);
      default: return { ok: false, message: 'Unknown command.' };
    }
  }

  // --- Commands --------------------------------------------------------------
  build(cmd, u, now) {
    if (!cmd.item) {
      return this.refuse(u, now, 'Try !build house. You can build: ' + Object.keys(ITEMS).join(', ') + '.');
    }
    const busy = this.pendingOf(u.id);
    if (busy) return this.refuse(u, now, 'Your bot is still busy with your ' + ITEMS[busy.item].label.toLowerCase() + ' (#' + busy.id + ').');
    const mine = this.builds.filter((b) => b.ownerId === u.id).length;
    if (mine >= this.limits.maxBuildsPerUser) {
      return this.refuse(u, now, 'You have built ' + mine + ' things already! Use !upgrade to make them grander.');
    }
    if (this.builds.filter((b) => b.status === 'queued').length >= this.limits.maxQueue) {
      return this.refuse(u, now, 'The builders are swamped. Try again in a minute!');
    }
    const plot = this.choosePlot(cmd.item, u.id, this.state.seq + 1);
    if (!plot) return this.refuse(u, now, 'The island is full!');
    this.touchBuilder(u, now);
    const id = ++this.state.seq;
    const b = {
      id,
      item: cmd.item,
      color: cmd.color || null,
      level: 1,
      q: plot[0],
      r: plot[1],
      ownerId: u.id,
      status: 'queued',
      requestedAt: now,
      startedAt: null,
      walkSec: WALK_BASE_SEC + hexDist(plot[0], plot[1]) * WALK_SEC_PER_RING,
      buildSec: ITEMS[cmd.item].buildSec,
      doneAt: null,
    };
    this.builds.push(b);
    this.changed({ type: 'build', build: b });
    this.tick(now);
    const what = (b.color ? b.color + ' ' : '') + ITEMS[b.item].label.toLowerCase();
    return { ok: true, message: u.name + ' is building a ' + what + ' (#' + id + ').', build: b };
  }

  upgrade(u, now) {
    const busy = this.pendingOf(u.id);
    if (busy) return this.refuse(u, now, 'Your bot is still busy with #' + busy.id + '.');
    const mine = this.builds.filter((b) => b.ownerId === u.id);
    if (!mine.length) return this.refuse(u, now, 'Build something first: !build house');
    const target = mine
      .filter((b) => b.status === 'done' && b.level < ITEMS[b.item].maxLevel)
      .sort((a, b) => b.doneAt - a.doneAt)[0];
    if (!target) return this.refuse(u, now, 'Nothing left to upgrade. Houses and towers can grow the tallest!');
    this.touchBuilder(u, now);
    Object.assign(target, {
      status: 'queued',
      upgradeTo: target.level + 1,
      requestedAt: now,
      startedAt: null,
      buildSec: Math.round(ITEMS[target.item].buildSec * UPGRADE_FACTOR),
    });
    this.changed({ type: 'build', build: target });
    this.tick(now);
    return { ok: true, message: u.name + ' is upgrading #' + target.id + ' to level ' + target.upgradeTo + '.', build: target };
  }

  hat(cmd, u, now) {
    const builder = this.state.builders[u.id];
    if (!builder) return this.refuse(u, now, 'Build something first to get a bot: !build house');
    if (!cmd.hat) return this.refuse(u, now, 'Hats: ' + Object.keys(HATS).join(', ') + '.');
    if (this.onCooldown('hat:' + u.id, this.limits.hatCooldownSec, now)) return { ok: false, message: 'Hold on, still trying on the last hat.' };
    this.touchBuilder(u, now);
    builder.hat = cmd.hat;
    this.changed({ type: 'builder', builder });
    return { ok: true, message: u.name + ' now wears: ' + HATS[cmd.hat] + '.' };
  }

  dance(u, now) {
    if (!this.state.builders[u.id]) return this.refuse(u, now, 'Build something first to get a bot: !build house');
    if (this.onCooldown('dance:' + u.id, this.limits.danceCooldownSec, now)) return { ok: false, message: 'Your bot needs a breather.' };
    this.touchBuilder(u, now);
    this.emit({ type: 'dance', userId: u.id });
    return { ok: true, message: u.name + ' is dancing!' };
  }

  help(now) {
    if (this.onCooldown('help', this.limits.helpCooldownSec, now)) return { ok: false, message: '' };
    const text = 'Build with !build house · !build red tower · !upgrade · !hat tophat · !dance';
    this.emit({ type: 'notice', kind: 'help', text });
    return { ok: true, message: text };
  }

  remove(cmd, u) {
    if (!u.mod && !u.broadcaster) return { ok: false, message: '' };
    const i = this.builds.findIndex((b) => b.id === cmd.id);
    if (i < 0) return { ok: false, message: 'No build #' + cmd.id + '.' };
    this.builds.splice(i, 1);
    this.changed({ type: 'remove', id: cmd.id });
    return { ok: true, message: 'Removed #' + cmd.id + '.' };
  }

  // --- Time ------------------------------------------------------------------
  // Finishes what is done and starts what fits. Safe to call any time; after a
  // restart it also catches up on builds that finished while we were away.
  tick(now) {
    for (const b of this.builds) {
      if (b.status !== 'building') continue;
      if (now < b.startedAt + (b.walkSec + b.buildSec) * 1000) continue;
      if (b.upgradeTo) {
        b.level = b.upgradeTo;
        delete b.upgradeTo;
      }
      b.status = 'done';
      b.doneAt = now;
      this.changed({ type: 'build', build: b });
    }
    let running = this.builds.filter((b) => b.status === 'building').length;
    const queued = this.builds.filter((b) => b.status === 'queued').sort((a, b) => a.requestedAt - b.requestedAt || a.id - b.id);
    for (const b of queued) {
      if (running >= this.limits.maxConcurrentBuilds) break;
      b.status = 'building';
      b.startedAt = now;
      running++;
      this.changed({ type: 'build', build: b });
    }
  }

  // --- Helpers ---------------------------------------------------------------
  pendingOf(userId) {
    return this.builds.find((b) => b.ownerId === userId && b.status !== 'done') || null;
  }

  touchBuilder(u, now) {
    let b = this.state.builders[u.id];
    const fresh = !b;
    if (fresh) {
      const h = hashStr(u.id);
      b = {
        id: u.id,
        name: u.name,
        color: /^#[0-9a-f]{6}$/i.test(u.color || '') ? u.color.toLowerCase() : PALETTE[h % PALETTE.length],
        hat: HAT_CHOICES[(h >>> 8) % HAT_CHOICES.length],
        firstSeen: now,
        lastSeen: now,
      };
      this.state.builders[u.id] = b;
    }
    b.name = u.name;
    b.lastSeen = now;
    this.dirty = true;
    this.emit({ type: 'builder', builder: b, joined: fresh });
    return b;
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

  // Where should this go? Close to the middle for most things, at the edge
  // for farms and lighthouses, and next to the builder's own plots so every
  // viewer grows a little neighbourhood.
  choosePlot(item, ownerId, salt) {
    const taken = new Set([hexKey(0, 0), ...this.builds.map((b) => hexKey(b.q, b.r))]);
    const own = new Set(this.builds.filter((b) => b.ownerId === ownerId).map((b) => hexKey(b.q, b.r)));
    let land = this.landRing();
    let candidates = [];
    for (;;) {
      candidates = [];
      for (let n = 1; n <= land; n++) for (const t of ringTiles(n)) if (!taken.has(hexKey(t[0], t[1]))) candidates.push(t);
      if (candidates.length || land >= MAX_RING) break;
      land++;
    }
    if (!candidates.length) return null;
    const zone = ITEMS[item].zone;
    // The edge is the outermost ring that already has buildings. Edge items
    // fill it up; only when it is full does the island grow another ring.
    const edge = Math.max(2, ...this.builds.map((b) => hexDist(b.q, b.r)));
    let best = null;
    let bestScore = Infinity;
    for (const [q, r] of candidates) {
      const ring = hexDist(q, r);
      let s;
      if (zone === 'inner') s = ring * 3;
      else if (zone === 'outer') s = Math.abs(edge - ring) * 2.5;
      else if (zone === 'coast') s = Math.abs(edge - ring) * 6;
      else s = ring * 1.5;
      for (const [nq, nr] of neighbors(q, r)) {
        const k = hexKey(nq, nr);
        if (own.has(k)) s -= 2.5;
        else if (taken.has(k)) s -= 0.4;
      }
      s += ((hashStr(salt + ':' + q + ',' + r) % 1000) / 1000) * 1.5;
      if (s < bestScore) { bestScore = s; best = [q, r]; }
    }
    return best;
  }
}

