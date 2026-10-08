// The village economy, one step at a time. Pure functions over the saved
// state, so the same code runs live, in tests and in the balance simulator.
//
// Every few seconds:
//   people move in while there are homes, food and some happiness
//   every producer works through its recipe (60 seconds a cycle at full speed)
//     speed = jobs filled x happiness x power x helping bots x events x boosts
//   residents eat, power plants burn coal, the era's wonder takes deliveries
//   and knowledge grows (faster with campfires, schools and labs)
import { ITEMS, RESOURCES } from '../public/shared/catalog.js';
import { daylight } from '../public/shared/sun.js';
import { hexBetween } from '../public/shared/hex.js';

export const BASE_CAP = 100;
export const FOOD_PER_POP_MIN = 0.05;
// Later eras farm and store food better, so each resident needs less.
export const foodPerPop = (era) => FOOD_PER_POP_MIN * [1, 0.9, 0.8, 0.65, 0.5, 0.4][Math.min(5, era)];
export const START_STOCK = { wood: 40, stone: 25, food: 30 };
export const RESERVE = 0.2; // wonders leave this share of storage for normal builds
export const MAX_HELPERS = 3; // bots that can help at one building
export const WONDER_SPEED_PER_HELPER = 0.6;
export const MOVE_IN_HAPPINESS = 30; // below this nobody moves in

export const itemOf = (b) => ITEMS[b.item];
// Built at least once and not broken. Houses keep their people while being upgraded.
export const isUp = (b) => !!b.built && !b.damaged;

export function capacity(builds) {
  let extra = 0;
  for (const b of builds) if (isUp(b) && itemOf(b)?.kind === 'storage') extra += itemOf(b).storage;
  return BASE_CAP + extra;
}

export function comfortOf(b) {
  const it = itemOf(b);
  if (!it || !it.comfort || !isUp(b)) return 0;
  return it.kind === 'wonder' ? it.comfort : it.comfort * (b.level || 1);
}

export function popCapacity(builds) {
  let n = 0;
  for (const b of builds) if (isUp(b) && itemOf(b)?.kind === 'house') n += itemOf(b).pop;
  return n;
}

export function jobsNeeded(builds) {
  let n = 0;
  for (const b of builds) if (isUp(b) && itemOf(b)?.workers) n += itemOf(b).workers;
  return n;
}

export function power(builds, now, fuel, geo = {}) {
  let supply = 0;
  let demand = 0;
  for (const b of builds) {
    if (!isUp(b)) continue;
    const it = itemOf(b);
    if (!it?.power) continue;
    if (it.power > 0) {
      let p = it.power;
      if (it.solar) p *= daylight(now, geo.lat, geo.lon);
      if (it.recipe?.in && fuel.get(b.id) === false) p = 0;
      supply += p;
    } else demand -= it.power;
  }
  return { supply, demand, ratio: demand > 0 ? Math.min(1, supply / demand) : 1 };
}

// 0 to 100. Every home wants comfort (parks, statues, markets) for its
// people, and counts what stands within two plots fully and the rest of the
// island at a quarter. A bare home is 40%. No food, or no power for homes
// that need it, hurts.
export function happiness(builds, { foodShort, powerRatio, bonus = 0 }) {
  const houses = builds.filter((b) => isUp(b) && itemOf(b)?.kind === 'house');
  const decor = builds.filter((b) => comfortOf(b) > 0);
  let h = 50;
  if (houses.length) {
    const total = decor.reduce((s, d) => s + comfortOf(d), 0);
    const shared = (0.25 * total) / houses.length;
    let sum = 0;
    let weight = 0;
    for (const house of houses) {
      const it = itemOf(house);
      let local = 0;
      for (const d of decor) if (hexBetween(house, d) <= 2) local += comfortOf(d);
      let v = 40 + 60 * Math.min(1, (local + shared) / (it.pop * 2));
      if (it.power < 0 && powerRatio < 1) v -= 25 * (1 - powerRatio);
      sum += v * it.pop;
      weight += it.pop;
    }
    h = sum / weight;
  }
  if (foodShort) h -= 25;
  return Math.max(0, Math.min(100, h + bonus));
}

// Windmills make the farms around them faster.
function adjacencyBoost(b, builds) {
  let boost = 1;
  for (const o of builds) {
    const ot = itemOf(o);
    if (!ot?.boost || ot.boost.item !== b.item || !isUp(o)) continue;
    if (hexBetween(b, o) <= ot.boost.radius) boost += ot.boost.by;
  }
  return Math.min(2, boost);
}

// Runs every producer for dt seconds. Mutates stock, progress and fuel.
// Returns what was made and used, and which buildings produced something.
export function produce(builds, stock, ctx, dt) {
  const made = {};
  const used = {};
  const pops = [];
  const stalled = {};
  for (const b of builds) {
    if (!isUp(b)) continue;
    const it = itemOf(b);
    if (!it?.recipe) continue;
    let m = ctx.employment * ctx.happyFactor * ctx.global;
    if (it.power < 0) m *= ctx.powerRatio;
    m *= 1 + 0.5 * Math.min(MAX_HELPERS, ctx.helpers(b.id));
    const out = it.recipe.out || {};
    let ev = 1;
    for (const r of Object.keys(out)) ev = Math.max(ev, ctx.boosts[r] || 1);
    m *= ev;
    m *= adjacencyBoost(b, builds);
    let prog = (ctx.progress.get(b.id) || 0) + (dt / 60) * m;
    while (prog >= 1) {
      const inp = it.recipe.in || {};
      const missing = Object.keys(inp).filter((r) => (stock[r] || 0) < inp[r]);
      const outKeys = Object.keys(out);
      const full = outKeys.length > 0 && outKeys.every((r) => (stock[r] || 0) >= ctx.cap);
      if (missing.length || full) {
        stalled[b.id] = missing.length ? 'needs ' + missing.join(', ') : 'storage full';
        if (it.power > 0) ctx.fuel.set(b.id, false);
        prog = Math.min(prog, 1);
        break;
      }
      for (const [r, n] of Object.entries(inp)) { stock[r] -= n; used[r] = (used[r] || 0) + n; }
      const gave = {};
      for (const [r, n] of Object.entries(out)) {
        const add = Math.min(n, Math.max(0, ctx.cap - (stock[r] || 0)));
        if (add > 0) { stock[r] = (stock[r] || 0) + add; made[r] = (made[r] || 0) + add; gave[r] = add; }
      }
      if (it.power > 0) ctx.fuel.set(b.id, true);
      if (Object.keys(gave).length) pops.push({ id: b.id, out: gave });
      prog -= 1;
    }
    ctx.progress.set(b.id, prog);
  }
  return { made, used, pops, stalled };
}

// Moves goods from storage into the wonder, a little at a time, in step with
// its recipe so every resource is needed until the end.
export function deliverToWonder(w, stock, { fraction, cap }) {
  const needs = itemOf(w).needs;
  w.delivered = w.delivered || {};
  const short = [];
  for (const [r, n] of Object.entries(needs)) {
    const have = w.delivered[r] || 0;
    if (have >= n) continue;
    const want = Math.min(n - have, n * fraction);
    const take = Math.min(want, Math.max(0, (stock[r] || 0) - cap * RESERVE));
    if (take < want * 0.5) short.push(r);
    if (take > 0) { stock[r] -= take; w.delivered[r] = have + take; }
  }
  return short;
}
export function wonderProgress(w) {
  const needs = itemOf(w)?.needs || {};
  let total = 0;
  let have = 0;
  for (const [r, n] of Object.entries(needs)) { total += n; have += Math.min(n, (w.delivered || {})[r] || 0); }
  return total ? have / total : 0;
}

export function knowledgeBoost(builds) {
  let k = 0;
  for (const b of builds) if (isUp(b) && itemOf(b)?.knowledge) k += itemOf(b).knowledge;
  return Math.min(0.5, k);
}

export function unlockedResources(era) {
  return Object.keys(RESOURCES).filter((r) => RESOURCES[r].era <= era);
}

// The best building of this era (or earlier) that makes a resource, or
// electricity when res is 'power'.
export function bestMaker(res, era) {
  let best = null;
  for (const [k, it] of Object.entries(ITEMS)) {
    if (it.era > era || it.kind === 'wonder') continue;
    const makes = res === 'power' ? it.power > 0 : !!it.recipe?.out?.[res];
    if (!makes) continue;
    const amount = res === 'power' ? it.power : it.recipe.out[res];
    if (!best || it.era > best.era || (it.era === best.era && amount > best.amount)) best = { key: k, era: it.era, amount };
  }
  return best ? best.key : null;
}
