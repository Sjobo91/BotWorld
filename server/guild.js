// The Merchant Guild: every hour or so, while chat is around, it posts an
// order (say 240 bricks) that both towns race to fill. Every !deliver is one
// trip of a bot to the Guild's wagon that fills a good part of the order (a
// twentieth per crate the bot carries, so better tools haul more), the
// townsfolk carry a little on their own, and the rival's porters keep a
// steady pace on their side. The first town to fill the order, or whichever
// is further along when time runs out, wins: the Guild pays one and a half
// times the goods' worth in what that town has least of, and its scholars
// share some knowledge. The loser gets its crates back.
import { RESOURCES, toolsOf } from '../public/shared/catalog.js';
import * as E from './economy.js';

export const PAY = 1.5;
export const KNOWLEDGE_MIN = 30;
// The share of an order each crate on a bot's trip fills (2 to 8 crates).
export const CRATE_SHARE = 0.025;
// Shares per minute: the townsfolk on their own, and the rival's porters
// (half of RIVAL_SHARE with a small crew, all of it with a full one, times
// the rival's lean towards a close race).
export const BASE_SHARE = 0.015;
export const RIVAL_SHARE = 0.025;
const SHOW_RESULT_SEC = 90;
const HISTORY = 20;

// What a good is worth in Guild money: newer goods are worth more.
export const worth = (r) => 1 + RESOURCES[r].era;

export function freshContracts() {
  return { n: 0, town: 0, rival: 0, history: [] };
}

// A new order: a good both towns know (newer goods more often, never the
// same as last time), about a tenth of the town's storage.
export function newContract(w, now) {
  const s = w.state;
  const era = Math.min(s.era, w.rival.s.era);
  const last = s.contracts.history[s.contracts.history.length - 1]?.res;
  let goods = E.unlockedResources(era);
  if (goods.length > 1) goods = goods.filter((r) => r !== last);
  const weights = goods.map((r) => 1 + RESOURCES[r].era);
  let k = Math.random() * weights.reduce((a, b) => a + b, 0);
  let res = goods[goods.length - 1];
  for (let i = 0; i < goods.length; i++) {
    k -= weights[i];
    if (k < 0) { res = goods[i]; break; }
  }
  const cap = E.capacity(w.builds);
  const amount = Math.max(20, Math.round((cap * 0.1) / worth(res) / 5) * 5);
  s.contracts.n++;
  return { id: s.contracts.n, res, amount, startedAt: now, endsAt: now + w.limits.contractMin * 60e3, town: 0, rival: 0, haulers: {}, winner: null, endedAt: null, paid: null };
}

// One economy step (dt seconds): post, deliver, settle.
export function stepContract(w, now, dt) {
  const s = w.state;
  if (!w.rival || !w.limits.contracts) return;
  let c = s.contract;
  if (c?.winner) {
    if (now >= c.endedAt + SHOW_RESULT_SEC * 1000) s.contract = null;
    return;
  }
  if (!c) {
    if (now < s.nextContractAt) return;
    // Only while chat is around: an order nobody sees is no race.
    let active = 0;
    for (const t of w.recent.values()) if (now - t < 15 * 60e3) active++;
    if (!active || w.builds.filter((b) => b.built && !b.home && !b.wonder).length < 5) {
      s.nextContractAt = now + 10 * 60e3;
      return;
    }
    c = s.contract = newContract(w, now);
    w.emit({ type: 'notice', kind: 'guild', text: 'The Merchant Guild wants ' + c.amount + ' ' + RESOURCES[c.res].label.toLowerCase() + '! First town to deliver gets paid: !deliver', contract: view(w) });
    w.dirty = true;
    return;
  }
  if (dt <= 0) return;
  c.town += take(s.stock, c.res, Math.min(c.amount - c.town, (c.amount * BASE_SHARE * dt) / 60));
  const rv = w.rival;
  const crew = Math.min(1, (rv.s.crew || 3) / 6);
  const rivalShare = BASE_SHARE + RIVAL_SHARE * crew * rv.speed();
  c.rival += take(rv.s.stock, c.res, Math.min(c.amount - c.rival, (c.amount * rivalShare * dt) / 60));
  check(w, now);
}

// A bot is back from the wagon: its crates count.
export function tripDone(w, uid, job, now) {
  const s = w.state;
  const c = s.contract;
  if (!c || c.winner || c.res !== job.res) return 0;
  const want = c.amount * CRATE_SHARE * toolsOf(s.builders[uid]).load;
  const n = take(s.stock, c.res, Math.min(c.amount - c.town, want));
  c.town += n;
  check(w, now);
  return n;
}

function check(w, now) {
  const c = w.state.contract;
  if (!c || c.winner) return;
  const full = (x) => x >= c.amount - 1e-6;
  if (full(c.town) || full(c.rival)) settle(w, now, full(c.town) && (!full(c.rival) || c.town >= c.rival) ? 'town' : 'rival');
  else if (now >= c.endsAt) settle(w, now, c.town > c.rival + 1e-6 ? 'town' : c.rival > c.town + 1e-6 ? 'rival' : 'none');
}

function take(stock, r, n) {
  const x = Math.max(0, Math.min(stock[r] || 0, n));
  stock[r] = (stock[r] || 0) - x;
  return x;
}

// The Guild pays in the two goods a town has least of (not the one it sold).
function pay(stock, cap, goods, sold, value) {
  const out = {};
  const pick = goods.filter((r) => r !== sold).sort((a, b) => (stock[a] || 0) - (stock[b] || 0)).slice(0, 2);
  for (const r of pick) {
    const n = Math.floor(Math.min(value / pick.length / worth(r), cap - (stock[r] || 0)));
    if (n > 0) { stock[r] = (stock[r] || 0) + n; out[r] = n; }
  }
  return out;
}

export function settle(w, now, winner) {
  const s = w.state;
  const c = s.contract;
  const rv = w.rival;
  c.winner = winner;
  c.endedAt = now;
  const cap = E.capacity(w.builds);
  const rcap = E.capacity(rv.builds);
  // The loser's crates come back.
  if (winner !== 'town') s.stock[c.res] = Math.min(cap, (s.stock[c.res] || 0) + c.town);
  if (winner !== 'rival') rv.s.stock[c.res] = Math.min(rcap, (rv.s.stock[c.res] || 0) + c.rival);
  if (winner === 'town') {
    c.paid = pay(s.stock, cap, E.unlockedResources(s.era), c.res, worth(c.res) * c.town * PAY);
    if (!s.finished) s.knowledge = Math.min(w.knowledgeNeed(), s.knowledge + KNOWLEDGE_MIN);
    for (const uid of Object.keys(c.haulers)) w.grant(uid, 8, now);
  } else if (winner === 'rival') {
    c.paid = pay(rv.s.stock, rcap, E.unlockedResources(rv.s.era), c.res, worth(c.res) * c.rival * PAY);
    if (!rv.s.finished) rv.s.knowledge = Math.min(w.knowledgeNeed(), rv.s.knowledge + KNOWLEDGE_MIN);
  }
  if (winner !== 'none') s.contracts[winner]++;
  s.contracts.history.push({ id: c.id, res: c.res, amount: c.amount, winner, at: now, town: Math.round(c.town), rival: Math.round(c.rival) });
  if (s.contracts.history.length > HISTORY) s.contracts.history.shift();
  s.nextContractAt = now + w.limits.contractEveryMin * 60e3 * (0.7 + Math.random() * 0.6);
  for (const [uid, j] of Object.entries(s.jobs)) if (j.kind === 'deliver') w.endJob(uid, false, now);
  const what = c.amount + ' ' + RESOURCES[c.res].label.toLowerCase();
  const paid = Object.entries(c.paid || {}).map(([r, n]) => n + ' ' + RESOURCES[r].label.toLowerCase()).join(' and ');
  const text = winner === 'town'
    ? 'BotWorld filled the Guild\'s order of ' + what + ' before ' + rv.s.name + '! Paid' + (paid ? ': ' + paid + ', and' : ' with') + ' ' + KNOWLEDGE_MIN + ' minutes of knowledge.'
    : winner === 'rival'
      ? rv.s.name + ' filled the Guild\'s order of ' + what + ' first. Our crates come back. Next time: !deliver'
      : 'Nobody filled the Guild\'s order of ' + what + ' in time.';
  w.emit({ type: 'notice', kind: 'guild', result: winner, text, contract: view(w) });
  w.dirty = true;
}

// What the screen shows.
export function view(w) {
  const s = w.state;
  const c = s.contract;
  const tally = { town: s.contracts.town, rival: s.contracts.rival };
  if (!c || !w.rival) return { open: null, tally, nextAt: s.nextContractAt };
  let haulers = 0;
  for (const j of Object.values(s.jobs)) if (j.kind === 'deliver') haulers++;
  return {
    open: { id: c.id, res: c.res, amount: c.amount, endsAt: c.endsAt, town: Math.floor(c.town), rival: Math.floor(c.rival), haulers, winner: c.winner, paid: c.paid, rivalName: w.rival.s.name },
    tally,
    nextAt: s.nextContractAt,
  };
}
