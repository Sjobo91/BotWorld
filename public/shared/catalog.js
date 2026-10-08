// What chat can build, paint and wear. Shared by the server (the rules) and
// the page (the looks), so the two can never disagree about an item.

// zone: where the item likes to stand. inner = near the landing ship,
// outer = towards the edge of the land, coast = right on the edge, any = no preference.
export const ITEMS = {
  house: { label: 'House', emoji: '🏠', buildSec: 20, maxLevel: 4, zone: 'any' },
  tower: { label: 'Tower', emoji: '🏰', buildSec: 30, maxLevel: 3, zone: 'any' },
  shop: { label: 'Shop', emoji: '🏪', buildSec: 25, maxLevel: 1, zone: 'inner' },
  farm: { label: 'Farm', emoji: '🌾', buildSec: 20, maxLevel: 1, zone: 'outer' },
  windmill: { label: 'Windmill', emoji: '🌬️', buildSec: 30, maxLevel: 1, zone: 'outer' },
  lighthouse: { label: 'Lighthouse', emoji: '🗼', buildSec: 35, maxLevel: 1, zone: 'coast' },
  fountain: { label: 'Fountain', emoji: '⛲', buildSec: 20, maxLevel: 1, zone: 'inner' },
  park: { label: 'Park', emoji: '🌳', buildSec: 15, maxLevel: 1, zone: 'any' },
  garden: { label: 'Garden', emoji: '🌷', buildSec: 15, maxLevel: 1, zone: 'any' },
  statue: { label: 'Statue', emoji: '🗿', buildSec: 25, maxLevel: 1, zone: 'inner' },
  campfire: { label: 'Campfire', emoji: '🔥', buildSec: 10, maxLevel: 1, zone: 'outer' },
};

export const ITEM_ALIASES = {
  home: 'house', hut: 'house', cabin: 'house', cottage: 'house',
  castle: 'tower', keep: 'tower',
  store: 'shop', cafe: 'shop', coffee: 'shop', market: 'shop', bakery: 'shop',
  field: 'farm', crops: 'farm', barn: 'farm',
  mill: 'windmill',
  light: 'lighthouse',
  tree: 'park', trees: 'park', forest: 'park', woods: 'park',
  flower: 'garden', flowers: 'garden', tulip: 'garden', tulips: 'garden',
  monument: 'statue',
  fire: 'campfire', bonfire: 'campfire',
};

export const COLORS = {
  red: '#e0473f',
  orange: '#ef8a3a',
  yellow: '#f2c230',
  green: '#47ad6b',
  teal: '#2bb3b3',
  blue: '#3b7ddd',
  purple: '#8f6ad6',
  pink: '#e5608a',
  white: '#f4f5f7',
  black: '#2a2e36',
  brown: '#9a6a43',
  gray: '#9aa3ad',
};
export const COLOR_ALIASES = { grey: 'gray', violet: 'purple', cyan: 'teal', gold: 'yellow', lime: 'green' };

export const HATS = {
  none: 'No hat',
  cap: 'Cap',
  beanie: 'Beanie',
  chef: 'Chef hat',
  hardhat: 'Hard hat',
  tophat: 'Top hat',
  propeller: 'Propeller cap',
  headphones: 'Headphones',
  flowers: 'Flower crown',
};
export const HAT_ALIASES = { helmet: 'hardhat', 'hard-hat': 'hardhat', top: 'tophat', 'top-hat': 'tophat', crown: 'flowers', flower: 'flowers', beret: 'beanie', off: 'none', remove: 'none' };

export const PALETTE = Object.values(COLORS).filter((c) => c !== COLORS.white && c !== COLORS.black);

function lookup(word, table, aliases) {
  if (!word) return null;
  const w = String(word).toLowerCase();
  if (Object.hasOwn(table, w)) return w;
  if (Object.hasOwn(aliases, w)) return aliases[w];
  // Plurals: "houses", "towers", "farms".
  if (w.endsWith('es') && Object.hasOwn(table, w.slice(0, -2))) return w.slice(0, -2);
  if (w.endsWith('s') && Object.hasOwn(table, w.slice(0, -1))) return w.slice(0, -1);
  return null;
}
export const resolveItem = (word) => lookup(word, ITEMS, ITEM_ALIASES);
export const resolveColor = (word) => lookup(word, COLORS, COLOR_ALIASES);
export const resolveHat = (word) => lookup(word, HATS, HAT_ALIASES);

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
