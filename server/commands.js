// Turns a chat line into a command. Anything that isn't one of ours returns
// null, so normal chatting is never answered or punished.
import { resolveColor, resolveHat, resolveItem } from '../public/shared/catalog.js';

const FILLER = new Set(['a', 'an', 'the', 'some', 'me', 'my', 'please', 'pls', 'plz', 'new', 'big', 'small', 'little', 'tiny', 'huge', 'nice', 'cute', 'of', 'with', 'and']);

function words(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}#\s-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

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
    case 'hat':
      return { type: 'hat', hat: resolveHat(args[0]), raw: args[0] || '' };
    case 'dance':
    case 'party':
      return { type: 'dance' };
    case 'help':
    case 'commands':
    case 'botworld':
      return { type: 'help' };
    case 'remove': {
      const id = Number(String(args[0] || '').replace(/^#/, ''));
      return { type: 'remove', id: Number.isInteger(id) && id > 0 ? id : null };
    }
    default:
      return null;
  }
}

function parseBuild(args) {
  let item = null;
  let color = null;
  const unknown = [];
  for (const w of args) {
    if (FILLER.has(w)) continue;
    const asItem = !item && resolveItem(w);
    if (asItem) { item = asItem; continue; }
    const asColor = !color && resolveColor(w);
    if (asColor) { color = asColor; continue; }
    unknown.push(w);
  }
  return { type: 'build', item, color, raw: unknown.join(' ') };
}
