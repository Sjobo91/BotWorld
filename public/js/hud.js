// Everything drawn in HTML on top of the world: the title and clock, goods
// in storage, the era and its goals, what the village needs, votes and
// events, the build queue, the weekly leaderboard, the ticker, !me cards
// and the big banners for wonders, new eras and the finale.
// Viewer names and text only ever go in as text, never as HTML.
import { ITEMS, ERAS, RESOURCES, EVENTS, TOOLS, itemsOfEra, theName, TheName, whatItDoes, wondersOf } from '../shared/catalog.js';
import { GATHER, angleOf } from '../shared/terrain.js';

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
// 24%, but 0.4% for a bar that has only just started.
const pct = (x) => (x > 0 && x < 0.1 ? (Math.floor(x * 1000) / 10).toFixed(1) : String(Math.floor(x * 100))) + '%';
const resLabel = (r) => (r === 'power' ? 'power' : RESOURCES[r] ? RESOURCES[r].label.toLowerCase() : r);

export function createHud(state, now, opts) {
  const nameOf = (id) => (state.builders.get(id) || {}).name || 'someone';
  let shownEra = -1;
  let shownGuild = false;
  // The how-to card changes with the era, and shows !deliver when the Guild trades.
  function syncHowto() {
    const guild = !!state.econ?.guild;
    if (shownEra === state.era && shownGuild === guild) return;
    shownEra = state.era;
    shownGuild = guild;
    renderHowto();
  }

  // --- How to play: three pages that take turns -----------------------------------------
  // 1. the commands, 2. where every good comes from, 3. this era's buildings.
  const PAGES = [['howPlay', 'Commands'], ['howGoods', 'Goods'], ['howBuild', 'Buildings']];
  let page = 0;
  const tabs = $('howTabs');
  PAGES.forEach(([id, name], i) => {
    const b = el('button', 'how-tab', name);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => { showPage(i); pageTimer = Date.now() + 60e3; });
    tabs.append(b);
  });
  let pageTimer = 0;
  function showPage(i) {
    page = i;
    PAGES.forEach(([id], k) => { $(id).hidden = k !== i; tabs.children[k].setAttribute('aria-selected', String(k === i)); });
  }
  showPage(0);
  setInterval(() => { if (Date.now() > pageTimer) showPage((page + 1) % PAGES.length); }, opts.stream ? 14000 : 20000);

  function renderHowto() {
    const keys = itemsOfEra(state.era);
    const starter = keys.find((k) => ITEMS[k].kind === 'producer') || keys[1];
    const cmds = $('cmds');
    cmds.textContent = '';
    const row = (c, text) => {
      const li = el('li');
      li.append(code(c), el('span', null, text));
      cmds.append(li);
    };
    row('!home', 'get your own home and bot');
    row('!wood !stone !food', 'one trip: chop, mine, pick');
    if (state.era >= RESOURCES.marble.era) row('!marble', 'cut marble in the hills');
    if (state.era >= RESOURCES.coal.era) row('!coal !iron', 'dig ore from a deposit');
    row('!build ' + starter, 'start a town project');
    row('!help', 'build it, more bots go faster');
    row('!upgrade ' + starter, 'make a building stronger');
    row('!upgrade tools', 'better tools, bigger loads');
    row('!explore', 'scout the fog for new land');
    if (state.econ?.guild) row('!deliver', 'haul for a Merchant Guild order');
    row('!info ' + (keys.find((k) => ITEMS[k].kind === 'decor') || starter), 'what a building is for');
    row('!me', 'find your bot · !wood 3 does 3');
    renderSources();
    $('howBuildTitle').textContent = 'Build in ' + ERAS[state.era].the;
    $('howBuildCmd').textContent = '!build ' + starter;
    $('queueCmd').textContent = '!build ' + starter;
    const items = $('items');
    items.textContent = '';
    const want = new Set((state.econ?.needs || []).map((n) => n.item));
    for (const key of keys) {
      const it = ITEMS[key];
      const li = el('li', 'item' + (want.has(key) ? ' wanted' : ''));
      li.title = it.label + ': ' + whatItDoes(key);
      const cost = el('span', 'cost');
      for (const [r, n] of Object.entries(it.cost)) cost.append(el('span', null, resEm(r) + n));
      li.append(el('span', 'em', it.emoji), el('span', 'key', key), cost);
      items.append(li);
    }
    spot = 0;
    renderSpotlight();
    const quick = $('quick');
    quick.textContent = '';
    for (const c of ['!home', '!build ' + starter, '!help', '!wood', '!stone', '!food', '!wood 3', '!explore', '!help wonder', '!upgrade ' + starter, '!upgrade tools', '!upgrade', '!stop', '!vote 1', '!repair', '!me', '!dance']) {
      const b = el('button', 'devbtn', c);
      b.type = 'button';
      b.dataset.cmd = c;
      quick.append(b);
    }
  }
  // Under the buildings, one at a time: what it is for (stream viewers cannot
  // hover over the list).
  let spot = 0;
  function renderSpotlight() {
    const keys = itemsOfEra(state.era);
    const box = $('itemSpot');
    if (!box || !keys.length) return;
    const key = keys[spot % keys.length];
    const it = ITEMS[key];
    box.textContent = '';
    box.append(el('span', 'em', it.emoji), el('b', null, it.label), el('span', null, whatItDoes(key)));
    $('items').querySelectorAll('.item').forEach((li, i) => li.classList.toggle('spot', i === spot % keys.length));
  }
  setInterval(() => { spot++; renderSpotlight(); }, 4000);
  // Every good the town can have yet: how to gather it by hand, and the
  // building that makes it all day.
  function renderSources() {
    const ul = $('sources');
    ul.textContent = '';
    for (const [r, info] of Object.entries(RESOURCES)) {
      if (info.era > state.era) continue;
      const li = el('li');
      const head = el('span', 's-head');
      head.append(el('span', 'em', info.emoji), el('b', null, info.label));
      const how = el('span', 's-how');
      const maker = ITEMS[info.from].emoji + ' ' + ITEMS[info.from].label.toLowerCase();
      const hand = GATHER[r];
      if (hand) {
        how.append(code('!' + r), el('span', null, r === 'food' ? ' berries or ' : ' in ' + hand.land + ' · '));
        if (r === 'food') how.append(code('!fish'), el('span', null, ' · '));
        how.append(el('span', null, maker + ' makes it all day'));
      } else how.append(el('span', null, maker + ', ' + info.where + ' '), code('!work ' + r));
      li.append(head, how);
      ul.append(li);
    }
  }

  // --- The race against the AI town on the far side of the world ------------------------------
  const COMPASS = ['east', 'southeast', 'south', 'southwest', 'west', 'northwest', 'north', 'northeast'];
  function renderRace() {
    const race = state.econ?.race;
    const box = $('race');
    if (!race || !race.rival) { box.hidden = true; return; }
    box.hidden = false;
    const r = race.rival;
    const mine = state.econ?.wonder;
    const wonderEm = (item, pending) => (item && !pending && ITEMS[item] ? ITEMS[item].emoji : '🏛️');
    const rows = [
      { name: 'BotWorld', who: 'chat', color: '#3b7ddd', p: race.you, wem: wonderEm(mine?.item, mine?.pending) },
      { name: r.name, who: 'AI', color: '#d9534f', p: r.progress, wem: wonderEm(r.wonderItem, r.wonderPending) },
    ];
    // Ahead is whoever is further along the road to the Future.
    const lead = race.you.total >= r.progress.total ? 0 : 1;
    const list = $('raceRows');
    list.textContent = '';
    rows.forEach((x, i) => {
      const li = el('li', 'race-row' + (i === lead ? ' ahead' : ''));
      const who = el('span', 'who');
      const dot = el('i');
      dot.style.background = x.color;
      who.append(dot, el('b', null, x.name), el('small', null, ' ' + x.who));
      const era = ERAS[Math.min(ERAS.length - 1, x.p.era)];
      li.append(who, el('span', 'rera', era.emoji + ' ' + era.name + ' ' + pct(x.p.frac)));
      const bar = el('span', 'bar');
      const fill = el('span');
      fill.style.width = Math.round(100 * x.p.frac) + '%';
      fill.style.background = x.color;
      bar.append(fill);
      li.append(bar);
      // The next era needs all three, so the bar shows the slowest one.
      const parts = x.p.parts;
      if (parts && x.p.frac < 1) {
        const row = el('span', 'rparts');
        for (const [em, k, title] of [['👥', 'people', 'People'], [x.wem, 'wonder', 'Wonder'], ['📚', 'knowledge', 'Knowledge']]) {
          const part = el('span', parts[k] <= x.p.frac + 1e-9 ? 'slow' : null, em + ' ' + pct(parts[k]));
          part.title = title;
          row.append(part);
        }
        li.append(row);
      }
      list.append(li);
    });
    const a = angleOf(r.origin);
    const way = COMPASS[Math.round(((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8];
    $('raceNote').textContent = r.finished ? r.name + ' finished ' + (r.wonderItem ? theName(r.wonderItem) : 'their last wonder') + ' first. BotWorld can still finish the race!'
      : r.met ? r.name + ' lies to the ' + way + ' with ' + r.builds + ' buildings. Claim the land between: !build outpost ' + way
      : 'An AI town far to the ' + way + ', past the fog, races BotWorld to the Future. !explore ' + way + ' to find it.';
    renderGuild(r.name);
  }

  // A Merchant Guild order: both towns' bars, time left and who won.
  function renderGuild(rivalName) {
    const g = state.econ?.guild;
    const box = $('guild');
    const tally = $('guildTally');
    const c = g?.open;
    box.hidden = !c;
    const played = g ? g.tally.town + g.tally.rival : 0;
    tally.hidden = !played || !!c;
    if (played) tally.textContent = '📜 Guild orders won: BotWorld ' + g.tally.town + ' · ' + rivalName + ' ' + g.tally.rival;
    if (!c) return;
    box.classList.toggle('won', c.winner === 'town');
    box.classList.toggle('lost', c.winner === 'rival');
    $('guildWhat').textContent = '📜 Guild order: ' + c.amount + ' ' + resEm(c.res) + ' ' + resLabel(c.res);
    $('guildTime').textContent = c.winner ? '' : clockOf(c.endsAt - now()) + ' left';
    const rows = [
      { name: 'BotWorld', color: '#3b7ddd', n: c.town, win: c.winner === 'town' },
      { name: c.rivalName || rivalName, color: '#d9534f', n: c.rival, win: c.winner === 'rival' },
    ];
    const list = $('guildRows');
    list.textContent = '';
    for (const x of rows) {
      const li = el('li', 'race-row' + (x.win ? ' ahead' : ''));
      const who = el('span', 'who');
      const dot = el('i');
      dot.style.background = x.color;
      who.append(dot, el('b', null, x.name));
      li.append(who, el('span', 'rera', x.n + ' / ' + c.amount));
      const bar = el('span', 'bar');
      const fill = el('span');
      fill.style.width = Math.min(100, Math.round((100 * x.n) / c.amount)) + '%';
      fill.style.background = x.color;
      bar.append(fill);
      li.append(bar);
      list.append(li);
    }
    const paid = Object.entries(c.paid || {}).map(([r, n]) => n + ' ' + resEm(r)).join(' + ');
    $('guildNote').textContent = c.winner === 'town' ? '🏆 BotWorld won it!' + (paid ? ' Paid ' + paid + ' and knowledge.' : '')
      : c.winner === 'rival' ? (c.rivalName || rivalName) + ' won this one. The next order comes soon.'
      : c.winner === 'none' ? 'Nobody filled it in time.'
      : (c.haulers ? c.haulers + (c.haulers === 1 ? ' bot hauls' : ' bots haul') + ' crates for BotWorld. ' : '') + 'Type !deliver to haul crates to the Guild wagon. First to fill it gets paid!';
  }

  // --- What to do now: the town's next steps, from the server ---------------------------------
  const STEP_ICON = { help: '🔨', gather: '📦', build: '🎯', explore: '🧭', wonder: '🏛️', upgrade: '⬆️', deliver: '📜' };
  function renderNext() {
    const plan = state.econ?.plan || [];
    const box = $('next');
    box.hidden = !plan.length || !state.connected;
    const list = $('nextList');
    list.textContent = '';
    plan.slice(0, 3).forEach((st, i) => {
      const li = el('li', 'step' + (i === 0 ? ' first' : ''));
      const em = st.kind === 'deliver' ? STEP_ICON.deliver : st.res && RESOURCES[st.res] && st.kind !== 'help' ? RESOURCES[st.res].emoji : st.item && ITEMS[st.item] && st.kind === 'help' ? ITEMS[st.item].emoji : STEP_ICON[st.kind] || '•';
      const text = el('span', 'st-text', st.text);
      if (st.kind === 'help') {
        const p = (state.econ.projects || []).find((x) => x.id === st.id);
        if (p) text.append(el('small', null, ' ' + Math.floor(p.progress * 100) + '%' + (p.helpers ? ' · ' + p.helpers + (p.helpers === 1 ? ' helper' : ' helpers') : '')));
      }
      li.append(el('span', 'em', em), text, code(st.cmd));
      list.append(li);
    });
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
        const short = w.short && w.short.length ? 'waiting for ' + w.short.map((r) => resEm(r) + ' ' + resLabel(r)).join(', ') : '!help wonder to help haul';
        const voting = state.vote?.kind === 'wonder' && state.vote.era === state.era;
        const choose = w.pending ? wondersOf(state.era).map((k) => ITEMS[k].label).join(' or ') + (voting ? '? Vote: !vote 1 or !vote 2' : '? Chat votes soon') : '';
        goals.append(goal(w.pending ? '🏛️' : it.emoji, w.pending ? 'Wonder' : it.label, Math.floor(w.progress * 100) + '%', w.progress, w.progress >= 1 ? '' : choose || short, w.progress >= 1));
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
    if (econ.explored) chip('🧭', Math.max(1, Math.round((100 * econ.explored.n) / econ.explored.total)) + '% explored', 'Land explored so far');
    for (const n of econ.needs || []) {
      const li = el('li', 'need');
      const it = ITEMS[n.item];
      const why = {
        // Coal for idle coal plants, or more power plants.
        power: n.res === 'power' ? 'More power!' : (RESOURCES[n.res]?.label || n.res) + ' for power!',
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
    const wonder = v.kind === 'wonder';
    box.classList.toggle('wonder-vote', wonder);
    $('voteTitle').textContent = wonder ? '🗳️ Which wonder for ' + ERAS[v.era].the + '?' : '🗳️ Chat vote!';
    const note = $('voteNote');
    note.hidden = !wonder;
    if (wonder) note.textContent = (v.rival ? v.rival + ' builds the other one. ' : '') + 'Both need the same goods.';
    const list = $('voteList');
    list.textContent = '';
    const total = v.counts.reduce((a, b) => a + b, 0) || 1;
    const best = Math.max(...v.counts);
    v.options.forEach((key, i) => {
      const ev = wonder ? { emoji: ITEMS[key].emoji, label: ITEMS[key].label, text: ITEMS[key].place ? 'as in ' + ITEMS[key].place : 'a wonder of ' + ERAS[v.era].the } : EVENTS[key];
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
    const c = state.econ?.guild?.open;
    if (c && !c.winner) $('guildTime').textContent = clockOf(c.endsAt - now()) + ' left';
  }

  // --- Being built: town projects first, then homes ----------------------------------------
  function progressOf(b) {
    if (b.project && b.work && !b.evolving) {
      const extra = b.status === 'building' && b.rate && b.progressAt ? (b.rate * Math.max(0, now() - b.progressAt)) / 1000 : 0;
      return Math.max(0, Math.min(1, ((b.progress || 0) + extra) / b.work));
    }
    if (b.status !== 'building') return 0;
    const total = ((b.walkSec || 0) + (b.buildSec || 1)) * 1000;
    return Math.max(0, Math.min(1, (now() - b.startedAt) / total));
  }
  function renderQueue() {
    const list = $('queueList');
    const active = [...state.builds.values()].filter((b) => b.status !== 'done' && !b.wonder);
    const helpersAt = (id) => { let n = 0; for (const j of state.jobs.values()) if (j.buildId === id && j.kind === 'build') n++; return n; };
    const rank = (b) => (b.project && !b.evolving ? 0 : b.home && !b.evolving ? 1 : 2);
    const rows = active.sort((a, b) => rank(a) - rank(b) || (a.status === 'building' ? 0 : 1) - (b.status === 'building' ? 0 : 1) || a.id - b.id);
    const max = 5;
    list.textContent = '';
    const projects = active.filter((b) => b.project && !b.evolving).length;
    $('queueCount').textContent = projects ? projects + ' of ' + (state.econ?.maxProjects || 3) + ' projects' : '';
    for (const b of rows.slice(0, max)) {
      const item = ITEMS[b.item] || { label: b.item, emoji: '📦' };
      const to = b.upgrade ? ITEMS[b.upgrade.item] : null;
      const li = el('li', 'row' + (b.status === 'queued' ? ' queued' : '') + (b.project && !b.evolving ? ' project' : ''));
      const main = el('span', 'row-main');
      let title = (b.color ? b.color + ' ' : '') + item.label.toLowerCase();
      let sub;
      if (b.evolving) { title = item.label.toLowerCase() + ' → ' + (to || item).label.toLowerCase(); sub = 'rebuilding itself'; }
      else if (b.home) { title = nameOf(b.ownerId) + "'s home" + (b.upgrade ? ' → level ' + b.upgrade.level : ''); sub = item.label.toLowerCase() + ' · #' + b.id; }
      else {
        const h = helpersAt(b.id);
        if (b.upgrade) title += ' → level ' + b.upgrade.level;
        sub = '#' + b.id + ' · ' + (h ? h + (h === 1 ? ' helper' : ' helpers') : 'needs helpers') + ' · !help #' + b.id;
      }
      main.append(el('b', null, title), el('small', null, sub));
      const bar = el('span', 'bar');
      if (b.status === 'building') {
        const fill = el('span');
        fill.style.width = Math.round(progressOf(b) * 100) + '%';
        bar.append(fill);
      } else {
        bar.classList.add('wait');
        bar.textContent = b.waitingFor && b.waitingFor.length ? 'needs ' + b.waitingFor.map(resEm).join('') : 'next up';
      }
      li.append(el('span', 'em', (to || item).emoji), main, bar);
      list.append(li);
    }
    if (rows.length > max) list.append(el('li', 'more', '+' + (rows.length - max) + ' more'));
    $('queueEmpty').hidden = rows.length > 0;
    // Nothing going: start what the town needs most, else this era's first producer.
    if (!rows.length) $('queueCmd').textContent = state.econ?.plan?.find((st) => st.kind === 'build')?.cmd || $('howBuildCmd').textContent;
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
    fact('🏡', c.home ? 'Home: ' + ITEMS[c.home.item].label.toLowerCase() + ', level ' + c.home.level : 'No home yet: type !home');
    fact('🔨', 'Helped build ' + c.built + (c.built === 1 ? ' building' : ' buildings') + (c.founded ? ', started ' + c.founded : ''));
    if (c.trips) fact('🧭', c.trips + (c.trips === 1 ? ' trip' : ' trips') + ' into the fog');
    if (c.gathered) fact('🧺', 'Gathered ' + c.gathered + ' goods by hand');
    fact('🔥', c.streak + (c.streak === 1 ? ' day' : ' days') + ' in a row');
    if (c.rank) fact('🏆', '#' + c.rank + ' this week');
    if (c.job?.kind === 'hand') {
      const g = Object.values(GATHER).find((x) => x.pose === c.job.pose && x.res === c.job.res);
      fact('🧺', 'Out to ' + (g ? g.verb + ' in ' + g.land : 'gather'));
    } else if (c.job?.kind === 'explore') fact('🧭', 'Exploring the fog');
    else if (c.job) {
      const at = state.builds.get(c.job.buildId);
      fact('⚒️', (c.job.kind === 'wonder' ? 'Hauling to the ' : c.job.kind === 'repair' ? 'Repairing the ' : 'Working at the ') + (at && ITEMS[at.item] ? ITEMS[at.item].label.toLowerCase() : 'town'));
    }
    const tool = TOOLS[c.tool || 0];
    const next = TOOLS[(c.tool || 0) + 1];
    fact('🛠️', tool.label + ', ' + tool.load + ' per trip' + (next ? ' · next: ' + next.label.toLowerCase() + ' at level ' + next.level : ''));
    if (c.queued) fact('⏳', c.queued + (c.queued === 1 ? ' job' : ' jobs') + ' lined up · !stop clears them');
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
      title: 'Welcome to ' + e.the + '!',
      text: e.tagline + '. New buildings to try:',
      items: itemsOfEra(era),
      foot: evolved ? evolved + ' old buildings are rebuilding themselves for the new era.' : 'Type !build house for a brand new ' + ITEMS[e.house].label.toLowerCase() + '.',
      ms: 16000,
    });
  }
  function wonderBanner(item) {
    const it = ITEMS[item];
    if (!it) return;
    banner({ kind: 'wonder', emoji: it.emoji, title: TheName(item) + ' is complete!', text: 'Thank you, haulers. The wonder of ' + ERAS[it.era].the + ' stands.', ms: 9000 });
  }
  // Chat chose the era's wonder (the rival builds the other).
  function pickBanner(ev) {
    const it = ITEMS[ev.item];
    if (!it) return;
    banner({ kind: 'wonder', emoji: it.emoji, title: 'BotWorld builds ' + theName(ev.item) + '!', text: (ev.how === 'vote' ? 'Chat chose it for ' : 'The wonder of ') + ERAS[ev.era].the + (it.place ? ', as in ' + it.place : '') + '.', foot: ev.other && state.econ?.race?.rival ? state.econ.race.rival.name + ' builds ' + theName(ev.other) + '. Haul with !help wonder' : 'Haul with !help wonder', ms: 10000 });
  }
  function finaleBanner(item) {
    const days = Math.max(1, Math.round(((state.finishedAt || now()) - state.createdAt) / DAY));
    const it = ITEMS[item];
    banner({ kind: 'finale', emoji: it ? it.emoji : '✨', title: it?.finale || 'The last wonder stands!', text: 'From sticks and stones to a city of light in ' + days + ' days. Thank you, chat!', foot: 'Keep building: the Future is yours.', ms: 30000 });
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
    for (const id of ['title', 'res', 'next', 'vote', 'eventBar', 'era', 'queue', 'leaders', 'howto', 'ticker', 'devbar', 'emptyCta', 'meCard', 'banner', 'lapse', 'gazette']) {
      const r = rectOf(id);
      if (r && r.height > 0) out.push({ l: r.left - app.left, r: r.right - app.left, t: r.top - app.top, b: r.bottom - app.top });
    }
    return out;
  }

  function render() {
    syncHowto();
    renderStats();
    renderRes();
    renderEra();
    renderNext();
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
    renderEcon() { syncHowto(); renderRes(); renderEra(); renderNext(); renderRace(); if (state.econ?.needs) renderHowtoNeeds(); },
    toast,
    showMe,
    eraBanner,
    wonderBanner,
    pickBanner,
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
