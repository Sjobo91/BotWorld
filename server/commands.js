// Turns a chat line into a command. Anything that isn't one of ours returns
// null, so normal chatting is never answered or punished.
import { resolveColor, resolveHat, resolveItem, resolveResource, EVENTS } from '../public/shared/catalog.js';
import { DIRECTIONS, DIRECTION_ALIASES } from '../public/shared/terrain.js';

const FILLER = new Set(['a', 'an', 'the', 'some', 'me', 'my', 'please', 'pls', 'plz', 'new', 'big', 'small', 'little', 'tiny', 'huge', 'nice', 'cute', 'of', 'with', 'and', 'to', 'at', 'on', 'for']);
const NEAR = new Set(['near', 'next', 'by', 'beside', 'besides', 'around']);

function words(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}#\s-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}
const idArg = (w) => {
  const id = Number(String(w || '').replace(/^#/, ''));
  return Number.isInteger(id) && id > 0 ? id : null;
};

export function parseCommand(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (!t.startsWith('!') || t.length > 200) return null;
  const [cmd, ...args] = words(t.slice(1));
  switch (cmd) {
    case 'build':
    case 'b':
    case 'make':
    case 'place':
      return parseBuild(args);
    case 'upgrade':
    case 'up':
      return { type: 'upgrade' };
    case 'home':
    case 'myhome':
    case 'house':
      return { type: 'home' };
    case 'help':
    case 'join':
    case 'assist':
    case 'helpbuild': {
      // !help, !help #12, !help wonder
      const w = args.find((a) => !FILLER.has(a));
      if (w === 'wonder') return { type: 'help', target: 'wonder' };
      return { type: 'help', id: idArg(w) };
    }
    case 'work':
    case 'gather':
    case 'job': {
      const w = args[0] || '';
      if (w === 'fish' || w === 'fishing') return { type: 'work', target: 'food', how: 'fish', raw: w };
      return { type: 'work', target: w ? resolveResource(w) : null, raw: w };
    }
    // Gathering by hand: the bot goes out to the right land itself.
    case 'wood':
    case 'chop':
    case 'cut':
    case 'lumber':
    case 'logs':
      return { type: 'work', target: 'wood' };
    case 'stone':
    case 'stones':
    case 'rock':
    case 'rocks':
      return { type: 'work', target: 'stone' };
    case 'mine':
    case 'dig': {
      // !mine is stone, !mine coal and !mine iron dig ore.
      const r = args.length ? resolveResource(args[0]) : null;
      return { type: 'work', target: r === 'coal' || r === 'iron' ? r : 'stone' };
    }
    case 'food':
    case 'berries':
    case 'berry':
    case 'pick':
    case 'forage':
      return { type: 'work', target: 'food' };
    case 'fish':
    case 'fishing':
      return { type: 'work', target: 'food', how: 'fish' };
    case 'coal':
      return { type: 'work', target: 'coal' };
    case 'iron':
      return { type: 'work', target: 'iron' };
    case 'explore':
    case 'scout':
    case 'discover': {
      const w = args.find((a) => !FILLER.has(a)) || '';
      const dir = Object.hasOwn(DIRECTIONS, w) ? w : DIRECTION_ALIASES[w] || null;
      return { type: 'explore', dir, raw: w };
    }
    case 'repair':
    case 'fix':
      return { type: 'repair' };
    case 'vote':
    case 'v': {
      if (args[0] === 'start' || args[0] === 'now') return { type: 'vote', option: null, start: true };
      const n = Number(args[0]);
      return { type: 'vote', option: Number.isInteger(n) && n >= 1 && n <= 3 ? n : null };
    }
    case '1':
    case '2':
    case '3':
      return { type: 'vote', option: Number(cmd) };
    case 'hat':
      return { type: 'hat', hat: resolveHat(args[0]), raw: args[0] || '' };
    case 'dance':
    case 'party':
      return { type: 'dance' };
    case 'me':
    case 'stats':
    case 'level':
    case 'profile':
      return { type: 'me' };
    case 'commands':
    case 'botworld':
    case 'how':
    case 'info':
      return { type: 'commands' };
    case 'demolish':
    case 'destroy':
      return { type: 'demolish', id: idArg(args[0]) };
    case 'remove':
      return { type: 'remove', id: idArg(args[0]) };
    case 'event': {
      const key = Object.keys(EVENTS).find((k) => k.toLowerCase() === String(args[0] || '').replace(/[^a-z]/g, ''));
      return { type: 'event', key: key || null };
    }
    default:
      return null;
  }
}

function parseBuild(args) {
  let item = null;
  let color = null;
  let near = null;
  const unknown = [];
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    if (NEAR.has(w)) {
      // "near the fountain", "next to a farm"
      let j = i + 1;
      while (j < args.length && FILLER.has(args[j])) j++;
      const target = resolveItem(args[j]);
      if (target) { near = target; i = j; continue; }
    }
    if (FILLER.has(w)) continue;
    const asItem = !item && resolveItem(w);
    if (asItem) { item = asItem; continue; }
    const asColor = !color && resolveColor(w);
    if (asColor) { color = asColor; continue; }
    unknown.push(w);
  }
  return { type: 'build', item, color, near, raw: unknown.join(' ') };
}
