// Plays BotWorld for months of pretend time in a few seconds, to see how
// long each era takes for a given chat. Use it after changing numbers in
// public/shared/catalog.js or the pace in botworld.config.json.
//
//   npm run balance                       5 regular viewers
//   npm run balance -- --viewers=30       a busy channel
//   npm run balance -- --viewers=2 --days=120 --eraDays=9
//
// It can also make a ready-grown island to look at:
//   npm run balance -- --untilEra=3 --save=data-preview
//   npm start -- --data=data-preview
import { World, freshState } from '../server/world.js';
import { Store } from '../server/store.js';
import { ITEMS, ERAS, itemsOfEra } from '../public/shared/catalog.js';
import { unlockedResources } from '../server/economy.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const VIEWERS = Number(args.viewers || 5);
const DAYS = Number(args.days || 90);
const HOURS_ONLINE = Number(args.hours || 1.5); // per viewer per day
const ACT_EVERY_MIN = Number(args.every || 1); // a command about every minute while online
const STEP = 15e3;
const SEED = Number(args.seed || 7);

let seed = SEED;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
Math.random = rnd;
const pick = (a) => a[Math.floor(rnd() * a.length)];

const T0 = Date.UTC(2026, 9, 1, 8);
const world = new World(freshState(T0, SEED), { pace: args.eraDays ? { eraDays: Number(args.eraDays) } : undefined });
const log = [];
world.on((e) => {
  if (e.type === 'era') log.push({ day: (now - T0) / 864e5, era: e.era });
  if (e.type === 'finale') log.push({ day: (now - T0) / 864e5, era: 'finale' });
});

const viewers = Array.from({ length: VIEWERS }, (_, i) => ({ id: 'v' + i, name: 'viewer' + i, start: rnd() * 24 }));
let now = T0;

function online(v, t) {
  const hour = ((t - T0) / 3600e3) % 24;
  const end = (v.start + HOURS_ONLINE) % 24;
  return v.start < end ? hour >= v.start && hour < end : hour >= v.start || hour < end;
}

function choose(v) {
  const s = world.state;
  const say = (text) => world.handleChat({ id: v.id, name: v.name }, text, now);
  if (!world.homeOf(v.id)) return say('!home');
  if (s.vote && rnd() < 0.7) return say('!vote ' + (1 + Math.floor(rnd() * 3)));
  if (world.builds.some((b) => b.damaged && !b.repairBy) && rnd() < 0.5) return say('!repair');
  const job = s.jobs[v.id];
  // Busy bots: chat sometimes lines up more, often just watches.
  if (job && job.kind !== 'gather' && (rnd() < 0.6 || (s.queues[v.id] || []).length >= 2)) return null;
  const econ = world.econ || {};
  const plan = econ.plan || [];
  const r = rnd();
  // Most of chat does what the "next step" box on screen says.
  if (r < 0.6 && plan.length) {
    const i = rnd() < 0.55 ? 0 : rnd() < 0.6 ? 1 : Math.floor(rnd() * plan.length);
    return say(plan[Math.min(i, plan.length - 1)].cmd);
  }
  if (r < 0.7) return say('!explore');
  if (r < 0.74) return say('!upgrade tools');
  if (r < 0.77) return say('!upgrade ' + pick(itemsOfEra(s.era).filter((k) => ITEMS[k].kind === 'producer') || ['woodcutter']));
  if (r < 0.8) return say('!upgrade');
  if (r < 0.92) {
    const era = s.era;
    if ((econ.population || 0) >= (econ.popCap || 0) - 2 && (econ.popCap || 0) < (econ.popGoal || 25) * 1.3) return say('!build house');
    if ((econ.happy || 50) < 60 && rnd() < 0.5) return say('!build ' + pick(Object.keys(ITEMS).filter((k) => ITEMS[k].kind === 'decor' && ITEMS[k].era <= era)));
    if (econ.power && econ.power.demand > econ.power.supply) return say('!build ' + pick(Object.keys(ITEMS).filter((k) => ITEMS[k].kind === 'power' && ITEMS[k].era <= era)));
    const pool = rnd() < 0.6 ? itemsOfEra(era) : world.buildable ? world.buildable() : itemsOfEra(era);
    return say('!build ' + pick(pool));
  }
  if (r < 0.96) return say('!help');
  return say(pick(['!me', '!dance', '!hat cap', '!work', '!wood 3', '!stone 2', '!food']));
}

const nextAct = new Map(viewers.map((v) => [v.id, T0 + rnd() * ACT_EVERY_MIN * 60e3]));
const end = T0 + DAYS * 864e5;
let lastDay = -1;
const daily = [];
const UNTIL_ERA = args.untilEra != null ? Number(args.untilEra) : Infinity;
for (; now < end && !world.state.finished && world.state.era < UNTIL_ERA; now += STEP) {
  for (const v of viewers) {
    if (now >= nextAct.get(v.id)) {
      nextAct.set(v.id, now + (0.5 + rnd()) * ACT_EVERY_MIN * 60e3);
      if (online(v, now)) choose(v);
    }
  }
  world.tick(now);
  const day = Math.floor((now - T0) / 864e5);
  if (day !== lastDay && day % 5 === 0 && world.econ) {
    lastDay = day;
    const e = world.econ;
    daily.push({
      day,
      era: ERAS[world.state.era].name,
      builds: world.builds.filter((b) => b.built).length,
      explored: Math.round((100 * e.explored.n) / e.explored.total) + '%',
      pop: e.population + '/' + e.popCap,
      happy: e.happy,
      knowledge: Math.round((100 * e.knowledge) / e.knowledgeNeed) + '%',
      wonder: e.wonder ? Math.round(e.wonder.progress * 100) + '%' : '-',
      power: e.power.supply + '/' + e.power.demand,
      stock: unlockedResources(world.state.era).map((r) => r + ':' + e.stock[r]).join(' '),
    });
  }
}

console.log('BotWorld balance: ' + VIEWERS + ' viewers, ' + HOURS_ONLINE + ' h online a day each, a command every ~' + ACT_EVERY_MIN + ' min, eraDays ' + world.pace.eraDays);
console.table(daily);
for (const l of log) console.log('day ' + l.day.toFixed(1) + ': ' + (l.era === 'finale' ? 'FINALE, the Fusion Spire is lit' : 'entered the ' + ERAS[l.era].name));
if (!world.state.finished) console.log('after ' + DAYS + ' days: still in the ' + ERAS[world.state.era].name);
const byItem = {};
for (const b of world.builds) if (b.built) byItem[b.item] = (byItem[b.item] || 0) + 1;
console.log('built:', JSON.stringify(byItem));

// Save the grown island with every time moved so that the end of the run is now.
if (args.save) {
  const shift = Date.now() - now;
  const TIMES = new Set(['createdAt', 'eraStartedAt', 'finishedAt', 'nextVoteAt', 'nextAutoEventAt', 'requestedAt', 'startedAt', 'doneAt', 'firstSeen', 'lastSeen', 'until', 'endsAt', 'at']);
  const move = (o) => {
    if (Array.isArray(o)) return o.forEach(move);
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      if (TIMES.has(k) && typeof v === 'number') o[k] = v + shift;
      else if (v && typeof v === 'object') move(v);
    }
  };
  move(world.state);
  new Store(args.save).save(world.state, Date.now());
  console.log('saved to ' + args.save + ' (' + ERAS[world.state.era].name + ', ' + world.builds.length + ' builds). Run: npm start -- --data=' + args.save);
}
