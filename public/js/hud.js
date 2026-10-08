// Everything drawn in HTML on top of the world: the title and clock, goods
// in storage, the era and its goals, what the village needs, votes and
// events, the build queue, the weekly leaderboard, the ticker, !me cards
// and the big banners for wonders, new eras and the finale.
// Viewer names and text only ever go in as text, never as HTML.
import { ITEMS, ERAS, RESOURCES, EVENTS, itemsOfEra } from '../shared/catalog.js';

const DAY = 864e5;
const $ = (id) => document.getElementById(id);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function code(text) {
  return el('code', null, text);
}
export function fmt(n) {
  const a = Math.abs(n);
  if (a < 1000) return String(Math.round(n));
  if (a < 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  if (a < 1e6) return Math.round(n / 1000) + 'k';
  return (n / 1e6).toFixed(1) + 'M';
}
export function fmtRate(r) {
  if (!r || Math.abs(r) < 0.05) return '';
  const a = Math.abs(r);
  return (r > 0 ? '+' : '−') + (a < 10 ? a.toFixed(1).replace(/\.0$/, '') : fmt(a)) + '/min';
}
export function fmtDuration(min) {
  if (!Number.isFinite(min)) return '';
  if (min >= 2 * 1440) return Math.round(min / 1440) + ' days';
  if (min >= 1440) return '1 day';
  if (min >= 120) return Math.round(min / 60) + ' hours';
  if (min >= 60) return '1 hour';
  return Math.max(1, Math.round(min)) + ' min';
}
const clockOf = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};
// Same as the server: weeks start on Monday, in UTC.
export function weekKey(ms) {
  const d = new Date(ms);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7))).toISOString().slice(0, 10);
}
const resEm = (r) => (r === 'power' ? '⚡' : RESOURCES[r] ? RESOURCES[r].emoji : '');
const resLabel = (r) => (r === 'power' ? 'power' : RESOURCES[r] ? RESOURCES[r].label.toLowerCase() : r);

export function createHud(state, now, opts) {
  const nameOf = (id) => (state.builders.get(id) || {}).name || 'someone';
  let shownEra = -1;

  // --- How to play: the buildings of this era and what they cost ------------------------
  function renderHowto() {
    const items = $('items');
    items.textContent = '';
    const keys = itemsOfEra(state.era);
    const want = new Set((state.econ?.needs || []).map((n) => n.item));
    for (const key of keys) {
      const it = ITEMS[key];
      const li = el('li', 'item' + (want.has(key) ? ' wanted' : ''));
      const cost = el('span', 'cost');
      for (const [r, n] of Object.entries(it.cost)) cost.append(el('span', null, resEm(r) + n));
      li.append(el('span', 'em', it.emoji), el('span', 'key', key), cost);
      items.append(li);
    }
    $('devText').placeholder = '!build ' + ERAS[state.era].house;
    const quick = $('quick');
    quick.textContent = '';
    const cmds = ['!build house', '!build ' + keys[1], '!build ' + keys[2], '!work', '!work wonder', '!upgrade', '!vote 1', '!repair', '!me', '!dance'];
    for (const c of cmds) {
      const b = el('button', 'devbtn', c);
      b.type = 'button';
      b.dataset.cmd = c;
      quick.append(b);
    }
  }

  // --- Goods in storage ------------------------------------------------------------------
  function renderRes() {
    const ul = $('res');
    ul.textContent = '';
    const econ = state.econ;
    if (!econ) return;
    const cap = econ.cap || 1;
    for (const [r, n] of Object.entries(econ.stock)) {
      const li = el('li', 'rchip');
      li.title = RESOURCES[r].label;
      const rate = econ.rates?.[r] || 0;
      const top = el('span', 'r-top');
      top.append(el('span', 'em', RESOURCES[r].emoji), el('b', null, fmt(n)));
      const sub = el('small', 'r-rate' + (rate < -0.05 ? ' neg' : ''), fmtRate(rate) || RESOURCES[r].label.toLowerCase());
      const bar = el('span', 'bar');
      const fill = el('span');
      fill.style.width = Math.round(Math.min(1, n / cap) * 100) + '%';
      if (n >= cap * 0.98) li.classList.add('full');
      if (n < cap * 0.05) li.classList.add('low');
      bar.append(fill);
      li.append(top, sub, bar);
      ul.append(li);
    }
    const li = el('li', 'rchip cap');
    const top = el('span', 'r-top');
    top.append(el('span', 'em', '📦'), el('b', null, fmt(cap)));
    li.append(top, el('small', 'r-rate', 'storage'));
    ul.append(li);
  }

  // --- The era, its goals and what the village needs -----------------------------------------
  function goal(icon, label, value, frac, extra, done) {
    const li = el('li', 'goal' + (done ? ' done' : ''));
    const head = el('span', 'g-head');
    head.append(el('span', 'em', done ? '✅' : icon), el('span', 'g-label', label), el('b', null, value));
    const bar = el('span', 'bar');
    const fill = el('span');
    fill.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
    bar.append(fill);
    li.append(head, bar);
    if (extra) li.append(el('small', 'g-extra', extra));
    return li;
  }
  function renderEra() {
    const e = ERAS[state.era];
    const econ = state.econ;
    $('eraEmoji').textContent = e.emoji;
    $('eraName').textContent = e.name;
    const eraDay = Math.floor((now() - state.eraStartedAt) / DAY) + 1;
    $('eraTag').textContent = e.tagline + ' · era ' + (state.era + 1) + ' of ' + ERAS.length + ' · day ' + eraDay;
    const next = ERAS[state.era + 1];
    const nx = $('eraNext');
    nx.textContent = '';
    if (state.finished) nx.append(el('b', null, '✨ BotWorld made it to the Future!'));
    else if (next) nx.append('To reach the ', el('b', null, next.emoji + ' ' + next.name), ':');
    else nx.append('For the grand finale:');
    const goals = $('goals');
    goals.textContent = '';
    const town = $('town');
    town.textContent = '';
    const needs = $('needs');
    needs.textContent = '';
    if (!econ) return;
    if (!state.finished) {
      goals.append(goal('👥', 'People', fmt(econ.population) + ' / ' + fmt(econ.popGoal), econ.population / econ.popGoal, econ.popCap < econ.popGoal ? 'homes for ' + fmt(econ.popCap) + ': !build house' : '', econ.population >= econ.popGoal));
      const w = econ.wonder;
      if (w) {
        const it = ITEMS[w.item];
        const short = w.short && w.short.length ? 'waiting for ' + w.short.map((r) => resEm(r) + ' ' + resLabel(r)).join(', ') : '!work wonder to help haul';
        goals.append(goal(it.emoji, it.label, Math.floor(w.progress * 100) + '%', w.progress, w.progress >= 1 ? '' : short, w.progress >= 1));
      }
      const k = econ.knowledge / econ.knowledgeNeed;
      const left = (econ.knowledgeNeed - econ.knowledge) / Math.max(0.01, econ.knowledgeRate);
      const extra = k >= 1 ? '' : 'about ' + fmtDuration(left) + ' to go' + (econ.knowledgeRate > 1.001 ? ' (' + Math.round((econ.knowledgeRate - 1) * 100) + '% faster)' : '');
      goals.append(goal('📚', 'Knowledge', Math.floor(k * 100) + '%', k, extra, k >= 1));
    }
    const chip = (em, text, title, warn) => {
      const li = el('li', 'tchip' + (warn ? ' warn' : ''));
      li.title = title;
      li.append(el('span', 'em', em), el('b', null, text));
      town.append(li);
    };
    chip('🏠', fmt(econ.population) + '/' + fmt(econ.popCap), 'People and room in homes', econ.popCap > 0 && econ.population >= econ.popCap);
    chip(econ.happy >= 70 ? '😊' : econ.happy >= 45 ? '🙂' : '😟', econ.happy + '%', 'Happiness', econ.happy < 45);
    if (econ.jobs > 0) chip('🔨', econ.employment + '%', 'Jobs filled', econ.employment < 70);
    if (econ.power && (econ.power.supply || econ.power.demand)) chip('⚡', fmt(econ.power.supply) + '/' + fmt(econ.power.demand), 'Power made and needed', econ.power.demand > econ.power.supply);
    for (const n of econ.needs || []) {
      const li = el('li', 'need');
      const it = ITEMS[n.item];
      const why = {
        power: 'More power!',
        hungry: 'People are hungry!',
        wonder: 'The wonder needs ' + resLabel(n.res),
        build: 'Builds wait for ' + resLabel(n.res),
        low: 'Low on ' + resLabel(n.res),
      }[n.why] || 'Needs ' + resLabel(n.res);
      li.append(el('span', 'em', resEm(n.res)), el('span', 'n-why', why), code('!build ' + n.item));
      if (it) li.title = it.label;
      needs.append(li);
    }
  }

  // --- Votes and events ---------------------------------------------------------------------
  function renderVote() {
    const v = state.vote;
    const box = $('vote');
    box.hidden = !v;
    if (!v) return;
    const list = $('voteList');
    list.textContent = '';
    const total = v.counts.reduce((a, b) => a + b, 0) || 1;
    const best = Math.max(...v.counts);
    v.options.forEach((key, i) => {
      const ev = EVENTS[key];
      const li = el('li', 'vopt' + (best > 0 && v.counts[i] === best ? ' lead' : ''));
      const main = el('span', 'v-main');
      main.append(el('b', null, ev.emoji + ' ' + ev.label), el('small', null, ev.text));
      const bar = el('span', 'bar');
      const fill = el('span');
      fill.style.width = Math.round((v.counts[i] / total) * 100) + '%';
      bar.append(fill);
      li.append(code('!' + (i + 1)), main, el('span', 'v-count', String(v.counts[i])), bar);
      list.append(li);
    });
  }
  function renderEvent() {
    const e = state.event;
    const bar = $('eventBar');
    const live = e && now() < e.endsAt;
    bar.hidden = !live;
    if (!live) return;
    const ev = EVENTS[e.key];
    $('eventEmoji').textContent = ev.emoji;
    $('eventName').textContent = ev.label;
    $('eventText').textContent = ev.text;
    bar.dataset.chaos = ev.chaos ? '1' : '0';
  }
  function renderTimers() {
    if (state.vote) $('voteTime').textContent = clockOf(state.vote.endsAt - now()) + ' left';
    if (state.event) {
      const left = state.event.endsAt - now();
      if (left <= 0) $('eventBar').hidden = true;
      else $('eventTime').textContent = clockOf(left);
    }
  }

  // --- The build queue ---------------------------------------------------------------------
  function renderQueue() {
    const list = $('queueList');
    const active = [...state.builds.values()].filter((b) => b.status !== 'done' && !b.wonder);
    const building = active.filter((b) => b.status === 'building').sort((a, b) => a.startedAt - b.startedAt);
    const queued = active.filter((b) => b.status === 'queued').sort((a, b) => a.requestedAt - b.requestedAt);
    const rows = building.concat(queued);
    const max = 4;
    list.textContent = '';
    for (const b of rows.slice(0, max)) {
      const item = ITEMS[b.item] || { label: b.item, emoji: '📦' };
      const to = b.upgrade ? ITEMS[b.upgrade.item] : null;
      const li = el('li', 'row' + (b.status === 'queued' ? ' queued' : ''));
      const main = el('span', 'row-main');
      let title = (b.color ? b.color + ' ' : '') + item.label.toLowerCase();
      if (to && to !== item) title = item.label.toLowerCase() + ' → ' + to.label.toLowerCase();
      else if (b.upgrade) title += ' → level ' + b.upgrade.level;
      main.append(el('b', null, title), el('small', null, (b.evolving ? 'rebuilding itself' : nameOf(b.ownerId)) + ' · #' + b.id));
      const bar = el('span', 'bar');
      if (b.status === 'building') {
        const fill = el('span');
        const total = (b.walkSec + b.buildSec) * 1000;
        fill.style.width = Math.round(Math.max(0, Math.min(1, (now() - b.startedAt) / total)) * 100) + '%';
        bar.append(fill);
      } else {
        bar.classList.add('wait');
        bar.textContent = b.waitingFor && b.waitingFor.length ? 'needs ' + b.waitingFor.map(resEm).join('') : 'next up';
      }
      li.append(el('span', 'em', (to || item).emoji), main, bar);
      list.append(li);
    }
    if (rows.length > max) list.append(el('li', 'more', '+' + (rows.length - max) + ' more waiting'));
    $('queueEmpty').hidden = rows.length > 0;
  }

  // --- Top builders this week ------------------------------------------------------------------
  function renderLeaders() {
    const wk = weekKey(now());
    const top = [...state.builders.values()]
      .filter((b) => b.weekKey === wk && b.weekXp > 0)
      .sort((a, b) => b.weekXp - a.weekXp || a.name.localeCompare(b.name))
      .slice(0, 5);
    const list = $('leadList');
    list.textContent = '';
    $('leaders').hidden = !top.length;
    top.forEach((b, i) => {
      const li = el('li', 'lead');
      const dot = el('i');
      dot.style.background = b.color;
      li.append(el('span', 'l-rank', ['🥇', '🥈', '🥉', '4', '5'][i]), dot, el('span', 'l-name', b.name), el('b', null, fmt(b.weekXp) + ' xp'));
      list.append(li);
    });
  }

  function renderStats() {
    $('emptyCta').hidden = state.builds.size > 1 || !state.connected || state.era > 0;
  }

  function renderClock() {
    const day = Math.floor((now() - state.createdAt) / DAY) + 1;
    const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(opts.clock ? opts.clock() : Date.now());
    const narrow = !opts.stream && innerWidth < 900;
    $('subtitleText').textContent = state.connected ? 'Day ' + day + (narrow ? '' : ' · ' + ERAS[state.era].name + ' · built by chat') + ' · ' + time : 'Reconnecting…';
    $('subtitle').dataset.live = state.connected ? '1' : '0';
  }

  // --- The ticker: what just happened ---------------------------------------------------------
  function toast(kind, icon, name, text) {
    const box = $('ticker');
    const t = el('div', 'toast');
    t.dataset.kind = kind;
    const body = el('span', 'msg');
    if (name) body.append(el('b', null, name));
    body.append(document.createTextNode(text));
    t.append(el('span', 'em', icon), body);
    box.prepend(t);
    const max = opts.stream ? 5 : 4;
    while (box.children.length > max) box.lastChild.remove();
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 700);
    }, kind === 'warn' || kind === 'job' ? 8000 : 14000);
  }

  // --- !me: a viewer's card -------------------------------------------------------------------
  let meTimer = 0;
  function showMe(c) {
    const box = $('meCard');
    box.textContent = '';
    const head = el('div', 'me-head');
    const dot = el('i', 'me-dot');
    dot.style.background = c.color;
    const who = el('div', 'me-who');
    who.append(el('b', null, c.name), el('small', null, 'Level ' + c.level + ' ' + c.title));
    head.append(dot, who);
    const span = Math.max(1, c.xpTo - c.xpFrom);
    const bar = el('span', 'bar');
    const fill = el('span');
    fill.style.width = Math.round(Math.max(0, Math.min(1, (c.xp - c.xpFrom) / span)) * 100) + '%';
    bar.append(fill);
    const facts = el('ul', 'me-facts');
    const fact = (em, text) => {
      const li = el('li');
      li.append(el('span', 'em', em), document.createTextNode(text));
      facts.append(li);
    };
    fact('⭐', fmt(c.xp) + ' xp, ' + fmt(c.xpTo - c.xp) + ' to level ' + (c.level + 1));
    fact('🏠', c.buildings + ' of ' + c.slots + ' building slots');
    fact('🔥', c.streak + (c.streak === 1 ? ' day' : ' days') + ' in a row');
    if (c.rank) fact('🏆', '#' + c.rank + ' this week');
    if (c.job) {
      const at = state.builds.get(c.job.buildId);
      fact('⚒️', (c.job.kind === 'wonder' ? 'Hauling to the ' : c.job.kind === 'repair' ? 'Repairing the ' : 'Working at the ') + (at && ITEMS[at.item] ? ITEMS[at.item].label.toLowerCase() : 'island'));
    }
    box.append(head, bar, facts);
    box.hidden = false;
    box.classList.remove('out');
    clearTimeout(meTimer);
    meTimer = setTimeout(() => {
      box.classList.add('out');
      meTimer = setTimeout(() => { box.hidden = true; }, 600);
    }, 9000);
  }

  // --- Banners: a wonder done, a new era, the finale -----------------------------------------
  const banners = [];
  let bannerOn = false;
  function banner(b) {
    banners.push(b);
    if (!bannerOn) nextBanner();
  }
  function nextBanner() {
    const b = banners.shift();
    const box = $('banner');
    if (!b) {
      bannerOn = false;
      box.hidden = true;
      return;
    }
    bannerOn = true;
    box.textContent = '';
    box.dataset.kind = b.kind;
    box.append(el('div', 'em b-emoji', b.emoji), el('h2', null, b.title));
    if (b.text) box.append(el('p', null, b.text));
    if (b.items && b.items.length) {
      const ul = el('ul', 'b-items');
      for (const k of b.items) ul.append(el('li', null, ITEMS[k].emoji + ' ' + k));
      box.append(ul);
    }
    if (b.foot) box.append(el('p', 'b-foot', b.foot));
    box.hidden = false;
    box.classList.remove('out');
    setTimeout(() => {
      box.classList.add('out');
      setTimeout(nextBanner, 700);
    }, b.ms || 12000);
  }
  function eraBanner(era, evolved) {
    const e = ERAS[era];
    banner({
      kind: 'era',
      emoji: e.emoji,
      title: 'Welcome to the ' + e.name + '!',
      text: e.tagline + '. New buildings to try:',
      items: itemsOfEra(era),
      foot: evolved ? evolved + ' old buildings are rebuilding themselves for the new era.' : 'Type !build house for a brand new ' + ITEMS[e.house].label.toLowerCase() + '.',
      ms: 16000,
    });
  }
  function wonderBanner(item) {
    const it = ITEMS[item];
    if (!it) return;
    banner({ kind: 'wonder', emoji: it.emoji, title: 'The ' + it.label + ' is complete!', text: 'Thank you, haulers. The wonder of the ' + ERAS[it.era].name + ' stands.', ms: 9000 });
  }
  function finaleBanner() {
    const days = Math.max(1, Math.round(((state.finishedAt || now()) - state.createdAt) / DAY));
    banner({ kind: 'finale', emoji: '✨', title: 'The Fusion Spire is lit!', text: 'From sticks and stones to a city of light in ' + days + ' days. Thank you, chat!', foot: 'Keep building: the Future is yours.', ms: 30000 });
  }

  // --- Timelapse ------------------------------------------------------------------------------
  function timelapse(info) {
    const box = $('lapse');
    if (!info) { box.hidden = true; return; }
    box.hidden = false;
    const day = Math.floor((info.at - state.createdAt) / DAY) + 1;
    let era = 0;
    for (const h of state.eraHistory || []) if (h.at <= info.at) era = h.era;
    $('lapseText').textContent = 'Day ' + day + ' · ' + ERAS[era].emoji + ' ' + ERAS[era].name;
    $('lapseFill').style.width = Math.round(info.k * 100) + '%';
  }

  // --- The Gazette: a headline now and then ----------------------------------------------------
  let gzTimer = 0;
  function gazette(item) {
    if (!item || !item.text) return;
    const box = $('gazette');
    $('gazetteText').textContent = item.text;
    box.hidden = false;
    box.classList.remove('out');
    clearTimeout(gzTimer);
    gzTimer = setTimeout(() => box.classList.add('out'), 90e3);
  }

  // Parts of the screen the HUD covers, for the camera and the labels.
  function rectOf(id) {
    const e = $(id);
    if (!e || e.hidden || e.offsetParent === null) return null;
    return e.getBoundingClientRect();
  }
  function insets() {
    const app = $('app').getBoundingClientRect();
    const side = rectOf('side');
    const howto = rectOf('howto');
    const res = rectOf('res');
    const title = rectOf('title');
    const top = Math.max(title ? title.bottom : 0, res ? res.bottom : 0) - app.top;
    return {
      left: howto && howto.width < app.width * 0.4 ? howto.width * 0.4 : 0,
      right: side && side.width < app.width * 0.4 ? app.right - side.left : 0,
      top: Math.max(0, Math.min(app.height * 0.2, top)),
      bottom: opts.stream ? 0 : Math.max(0, app.bottom - (rectOf('devbar')?.top ?? app.bottom)),
    };
  }
  function blocked() {
    const app = $('app').getBoundingClientRect();
    const out = [];
    for (const id of ['title', 'res', 'centerTop', 'era', 'queue', 'leaders', 'howto', 'ticker', 'devbar', 'emptyCta', 'meCard', 'banner', 'lapse', 'gazette']) {
      const r = rectOf(id);
      if (r && r.height > 0) out.push({ l: r.left - app.left, r: r.right - app.left, t: r.top - app.top, b: r.bottom - app.top });
    }
    return out;
  }

  function render() {
    if (shownEra !== state.era) {
      shownEra = state.era;
      renderHowto();
    }
    renderStats();
    renderRes();
    renderEra();
    renderVote();
    renderEvent();
    renderQueue();
    renderLeaders();
    renderClock();
    renderTimers();
  }

  setInterval(renderQueue, 500);
  setInterval(() => { renderClock(); renderTimers(); }, 1000);
  setInterval(renderLeaders, 30e3);
  return {
    render,
    renderEcon() { renderRes(); renderEra(); if (state.econ?.needs) renderHowtoNeeds(); },
    toast,
    showMe,
    eraBanner,
    wonderBanner,
    finaleBanner,
    timelapse,
    gazette,
    insets,
    blocked,
  };

  // Highlight the buildings the village needs right now in the how-to card.
  function renderHowtoNeeds() {
    const want = new Set((state.econ?.needs || []).map((n) => n.item));
    const keys = itemsOfEra(state.era);
    $('items').querySelectorAll('.item').forEach((li, i) => li.classList.toggle('wanted', want.has(keys[i])));
  }
}
