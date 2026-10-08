// Everything drawn in HTML on top of the world: title, counters, the
// "how to build" card, the build queue and the event ticker.
import { ITEMS, COLORS } from '../shared/catalog.js';

const DAY = 864e5;
const $ = (id) => document.getElementById(id);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function createHud(state, now, opts) {
  const nameOf = (id) => (state.builders.get(id) || {}).name || 'someone';

  // The how-to card: every item and every color, so chat knows the words.
  const items = $('items');
  for (const [key, item] of Object.entries(ITEMS)) {
    const li = el('li', 'item');
    li.append(el('span', 'em', item.emoji), el('span', null, key));
    items.append(li);
  }
  const colors = $('colors');
  for (const [name, hex] of Object.entries(COLORS)) {
    const li = el('li');
    const dot = el('i');
    dot.style.background = hex;
    li.append(dot, el('span', null, name));
    colors.append(li);
  }

  function renderStats() {
    let done = 0;
    let busy = 0;
    for (const b of state.builds.values()) {
      if (b.status === 'done') done++;
      else if (b.status === 'building') busy++;
    }
    const ul = $('stats');
    ul.textContent = '';
    const chip = (em, n, label) => {
      const li = el('li', 'chip');
      li.append(el('span', 'em', em), el('b', null, String(n)), el('span', null, label));
      ul.append(li);
    };
    chip('🏠', done, 'built');
    chip('🤖', state.builders.size, state.builders.size === 1 ? 'builder' : 'builders');
    if (busy) chip('🔨', busy, 'building now');
    $('emptyCta').hidden = state.builds.size > 0 || !state.connected;
  }

  function renderQueue() {
    const list = $('queueList');
    const active = [...state.builds.values()].filter((b) => b.status !== 'done');
    const building = active.filter((b) => b.status === 'building').sort((a, b) => a.startedAt - b.startedAt);
    const queued = active.filter((b) => b.status === 'queued').sort((a, b) => a.requestedAt - b.requestedAt);
    const rows = building.concat(queued);
    const max = opts.stream ? 7 : 5;
    list.textContent = '';
    for (const b of rows.slice(0, max)) {
      const item = ITEMS[b.item] || { label: b.item, emoji: '📦' };
      const li = el('li', 'row' + (b.status === 'queued' ? ' queued' : ''));
      const main = el('span', 'row-main');
      const title = (b.color ? b.color + ' ' : '') + item.label.toLowerCase() + (b.upgradeTo ? ' → level ' + b.upgradeTo : '');
      main.append(el('b', null, title), el('small', null, nameOf(b.ownerId) + ' · #' + b.id));
      const bar = el('span', 'bar');
      const fill = el('span');
      if (b.status === 'building') {
        const total = (b.walkSec + b.buildSec) * 1000;
        fill.style.width = Math.round(Math.max(0, Math.min(1, (now() - b.startedAt) / total)) * 100) + '%';
        bar.append(fill);
      } else {
        bar.classList.add('wait');
        bar.textContent = 'next up';
      }
      li.append(el('span', 'em', item.emoji), main, bar);
      list.append(li);
    }
    if (rows.length > max) list.append(el('li', 'more', '+' + (rows.length - max) + ' more waiting'));
    $('queueEmpty').hidden = rows.length > 0;
  }

  function renderClock() {
    const day = Math.floor((now() - state.createdAt) / DAY) + 1;
    const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(opts.clock ? opts.clock() : Date.now());
    $('subtitleText').textContent = state.connected ? 'Day ' + day + ' · built by chat · ' + time : 'Reconnecting…';
    $('subtitle').dataset.live = state.connected ? '1' : '0';
  }

  // The ticker: what just happened. Names are viewer input, so they only
  // ever go in as text, never as HTML.
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
    }, kind === 'warn' ? 8000 : 14000);
  }

  // Parts of the screen the HUD covers, for the camera and the labels.
  function rectOf(id) {
    const e = $(id);
    if (!e || e.hidden || e.offsetParent === null) return null;
    return e.getBoundingClientRect();
  }
  function insets() {
    const app = $('app').getBoundingClientRect();
    const q = rectOf('queue');
    const howto = rectOf('howto');
    const title = rectOf('title');
    return {
      left: howto && howto.width < app.width * 0.5 ? howto.width * 0.45 : 0,
      right: q && q.width < app.width * 0.5 ? app.right - q.left : 0,
      top: title ? Math.min(app.height * 0.2, title.bottom - app.top) : 0,
      bottom: opts.stream ? 0 : Math.max(0, app.bottom - (rectOf('devbar')?.top ?? app.bottom)),
    };
  }
  function blocked() {
    const app = $('app').getBoundingClientRect();
    const out = [];
    for (const id of ['title', 'stats', 'queue', 'howto', 'ticker', 'devbar', 'emptyCta']) {
      const r = rectOf(id);
      if (r && r.height > 0) out.push({ l: r.left - app.left, r: r.right - app.left, t: r.top - app.top, b: r.bottom - app.top });
    }
    return out;
  }

  setInterval(renderQueue, 500);
  setInterval(renderClock, 1000);
  return {
    render() { renderStats(); renderQueue(); renderClock(); },
    toast,
    insets,
    blocked,
  };
}
