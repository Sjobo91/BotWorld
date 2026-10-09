// Everything chat can build, use and wear, era by era. Shared by the server
// (the rules) and the page (the looks), so the two never disagree.
//
// The island starts with sticks and stones and, over a couple of weeks,
// works its way through the history of the world to a glowing future city:
//   Stone Age > Ancient Egypt > Roman Empire > Middle Ages >
//   Industrial Revolution > Modern Age > Future
// Each era unlocks new buildings and resources. To leave an era the town
// needs enough people, the era's wonder finished, and enough knowledge (which
// grows with time, a little faster with campfires, schools and labs).
//
// Every era has two famous wonders from different parts of the world. Chat
// votes for the one BotWorld builds, and the rival town builds the other.

// from: the building that makes it, where: what that building needs.
export const RESOURCES = {
  wood: { label: 'Wood', emoji: '🪵', era: 0, from: 'woodcutter', where: 'next to a forest' },
  stone: { label: 'Stone', emoji: '🪨', era: 0, from: 'quarry', where: 'next to rocky hills' },
  food: { label: 'Food', emoji: '🍞', era: 0, from: 'gatherer', where: 'berry meadows, or a fisher by the water' },
  bricks: { label: 'Bricks', emoji: '🧱', era: 1, from: 'kiln', where: 'bakes stone and wood' },
  marble: { label: 'Marble', emoji: '⚪', era: 2, from: 'marblequarry', where: 'next to rocky hills, best by mountains' },
  coal: { label: 'Coal', emoji: '⚫', era: 3, from: 'mine', where: 'on a coal deposit in the hills' },
  iron: { label: 'Iron', emoji: '⛓️', era: 3, from: 'mine', where: 'on an iron deposit in the hills' },
  steel: { label: 'Steel', emoji: '🔩', era: 4, from: 'steelmill', where: 'melts iron with coal' },
  parts: { label: 'Parts', emoji: '⚙️', era: 4, from: 'factory', where: 'makes steel into parts, needs power' },
  chips: { label: 'Chips', emoji: '💾', era: 5, from: 'chipfab', where: 'makes parts into chips, needs power' },
};

// the: the era's name in a sentence ("in Ancient Egypt", "in the Middle Ages").
// look: how the island itself changes (paths, street lights, the air, bots).
// wonders: the two chat chooses from (the rival builds the other one).
export const ERAS = [
  {
    key: 'stone', name: 'Stone Age', the: 'the Stone Age', emoji: '🪨', tagline: 'Sticks and stones', house: 'hut', wonders: ['stonehenge', 'moai'], popGoal: 25,
    look: { path: '#c4a57e', lamp: 'torch', haze: 0, bot: '#c9a27c', boat: 'canoe' },
  },
  {
    key: 'egypt', name: 'Ancient Egypt', the: 'Ancient Egypt', emoji: '🐪', tagline: 'Bricks on the Nile', house: 'mudhouse', wonders: ['pyramid', 'ziggurat'], popGoal: 60,
    look: { path: '#dcc48e', lamp: 'torch', haze: 0, bot: '#d9b25e', boat: 'felucca' },
  },
  {
    key: 'rome', name: 'Roman Empire', the: 'the Roman Empire', emoji: '🏛️', tagline: 'Marble, roads and arches', house: 'villa', wonders: ['colosseum', 'greatwall'], popGoal: 110,
    look: { path: '#cfc8ba', lamp: 'lantern', haze: 0, bot: '#c97a63', boat: 'galley' },
  },
  {
    key: 'medieval', name: 'Middle Ages', the: 'the Middle Ages', emoji: '🏰', tagline: 'Castles, coal and iron', house: 'townhouse', wonders: ['notredame', 'angkorwat'], popGoal: 180,
    look: { path: '#aaa49a', lamp: 'lantern', haze: 0.05, bot: '#a7adb5', boat: 'sail' },
  },
  {
    key: 'industrial', name: 'Industrial Revolution', the: 'the Industrial Revolution', emoji: '🏭', tagline: 'Steam and steel', house: 'apartments', wonders: ['eiffel', 'bigben'], popGoal: 320,
    look: { path: '#8e8379', lamp: 'gas', haze: 0.35, bot: '#c49a52', boat: 'steam' },
  },
  {
    key: 'modern', name: 'Modern Age', the: 'the Modern Age', emoji: '🏙️', tagline: 'Power for everyone', house: 'skyscraper', wonders: ['empirestate', 'operahouse'], popGoal: 600,
    look: { path: '#5b5f66', lamp: 'electric', haze: 0.15, bot: '#f8f9fb', boat: 'motor' },
  },
  {
    key: 'future', name: 'Future', the: 'the Future', emoji: '✨', tagline: 'A bright tomorrow', house: 'arcology', wonders: ['spire', 'elevator'], popGoal: 1200,
    look: { path: '#dfe7ef', lamp: 'neon', haze: 0, bot: '#e9f4ff', boat: 'hover' },
  },
];

// kind: house (people live here), producer (makes resources), power (makes
// electricity), decor (makes people happy), storage (more room for goods),
// knowledge (era progress), special (a unique effect), wonder (the era goal).
// recipe: what one work cycle (60 seconds at full speed) uses and makes.
// power: + makes electricity, - needs it. comfort: happiness for the people
// living around it. zone: where it likes to stand (inner, any, outer, coast).
// evolve: what it turns into by itself once that building's era arrives.
// The two wonders of an era need the same goods, so a vote only decides
// what rises, never how hard the race is.
const W = [
  { stone: 500, wood: 250, food: 150 },
  { stone: 1000, bricks: 600, food: 400 },
  { stone: 1400, bricks: 1000, marble: 600 },
  { stone: 2200, marble: 900, iron: 600 },
  { bricks: 2500, steel: 1800, parts: 500 },
  { steel: 5000, parts: 2000, chips: 600 },
  { steel: 9000, parts: 3000, chips: 3000 },
];
export const ITEMS = {
  // --- Stone Age -------------------------------------------------------------
  hut: { era: 0, label: 'Hut', emoji: '🛖', kind: 'house', cost: { wood: 12, stone: 6 }, buildSec: 20, zone: 'any', pop: 6, evolve: 'mudhouse' },
  woodcutter: { era: 0, label: 'Woodcutter', emoji: '🪓', kind: 'producer', cost: { stone: 4 }, buildSec: 20, zone: 'outer', workers: 2, recipe: { out: { wood: 2 } } },
  quarry: { era: 0, label: 'Quarry', emoji: '⛏️', kind: 'producer', cost: { wood: 6 }, buildSec: 25, zone: 'outer', workers: 2, recipe: { out: { stone: 2 } } },
  gatherer: { era: 0, label: 'Gatherer', emoji: '🫐', kind: 'producer', cost: { wood: 4 }, buildSec: 15, zone: 'any', workers: 1, recipe: { out: { food: 2 } }, evolve: 'farm' },
  fisher: { era: 0, label: 'Fishing hut', emoji: '🎣', kind: 'producer', cost: { wood: 10 }, buildSec: 20, zone: 'coast', workers: 1, recipe: { out: { food: 3 } }, evolve: 'harbor' },
  campfire: { era: 0, label: 'Campfire', emoji: '🔥', kind: 'decor', cost: { wood: 5 }, buildSec: 10, zone: 'any', comfort: 6, knowledge: 0.05 },
  stockpile: { era: 0, label: 'Stockpile', emoji: '📦', kind: 'storage', cost: { wood: 12 }, buildSec: 15, zone: 'inner', storage: 60, evolve: 'granary' },
  // Outposts take the town out into the world: a store far from the middle,
  // so producers out there work at full speed and gatherers walk less.
  outpost: { era: 0, label: 'Outpost', emoji: '⛺', kind: 'storage', cost: { wood: 20, stone: 8 }, buildSec: 30, zone: 'far', storage: 20, reveal: 4 },
  totem: { era: 0, label: 'Totem', emoji: '🪶', kind: 'decor', cost: { wood: 6, stone: 14 }, buildSec: 25, zone: 'inner', comfort: 14, evolve: 'obelisk' },
  // --- Ancient Egypt ---------------------------------------------------------
  mudhouse: { era: 1, label: 'Mud brick house', emoji: '🏠', kind: 'house', cost: { wood: 10, bricks: 10 }, buildSec: 25, zone: 'any', pop: 9, evolve: 'villa' },
  farm: { era: 1, label: 'Farm', emoji: '🌾', kind: 'producer', cost: { wood: 14, stone: 6 }, buildSec: 25, zone: 'outer', workers: 2, recipe: { out: { food: 5 } }, evolve: 'greenhouse' },
  // A shaduf lifts river water into the fields: the farms around it grow more.
  canal: { era: 1, label: 'Irrigation canal', emoji: '💧', kind: 'special', cost: { wood: 12, stone: 12 }, buildSec: 25, zone: 'outer', workers: 1, boost: { item: 'farm', by: 0.5, radius: 2 }, evolve: 'windmill' },
  kiln: { era: 1, label: 'Brick kiln', emoji: '🧱', kind: 'producer', cost: { stone: 14, wood: 8 }, buildSec: 25, zone: 'outer', workers: 2, recipe: { in: { stone: 2, wood: 1 }, out: { bricks: 2 } } },
  well: { era: 1, label: 'Well', emoji: '🪣', kind: 'decor', cost: { stone: 15 }, buildSec: 20, zone: 'inner', comfort: 10, evolve: 'fountain' },
  market: { era: 1, label: 'Market', emoji: '🏪', kind: 'decor', cost: { wood: 16, bricks: 10 }, buildSec: 30, zone: 'inner', workers: 2, comfort: 20 },
  garden: { era: 1, label: 'Garden', emoji: '🌷', kind: 'decor', cost: { wood: 6 }, buildSec: 15, zone: 'any', comfort: 7 },
  park: { era: 1, label: 'Park', emoji: '🌳', kind: 'decor', cost: { wood: 8, stone: 4 }, buildSec: 15, zone: 'any', comfort: 10 },
  granary: { era: 1, label: 'Granary', emoji: '🏺', kind: 'storage', cost: { wood: 20, bricks: 10 }, buildSec: 25, zone: 'outer', storage: 150, evolve: 'warehouse' },
  obelisk: { era: 1, label: 'Obelisk', emoji: '🗼', kind: 'decor', cost: { stone: 30, bricks: 8 }, buildSec: 30, zone: 'inner', comfort: 18, evolve: 'statue' },
  // --- Roman Empire ----------------------------------------------------------
  villa: { era: 2, label: 'Villa', emoji: '🏡', kind: 'house', cost: { bricks: 16, marble: 8, wood: 6 }, buildSec: 30, zone: 'any', pop: 13, evolve: 'townhouse' },
  marblequarry: { era: 2, label: 'Marble quarry', emoji: '⛰️', kind: 'producer', cost: { wood: 20, bricks: 12 }, buildSec: 30, zone: 'outer', workers: 3, recipe: { out: { marble: 2 } } },
  temple: { era: 2, label: 'Temple', emoji: '🏛️', kind: 'decor', cost: { marble: 30, stone: 16 }, buildSec: 35, zone: 'inner', comfort: 26 },
  school: { era: 2, label: 'School', emoji: '🏫', kind: 'knowledge', cost: { bricks: 20, marble: 6, wood: 10 }, buildSec: 30, zone: 'inner', workers: 2, comfort: 5, knowledge: 0.1, evolve: 'university' },
  lighthouse: { era: 2, label: 'Lighthouse', emoji: '🗼', kind: 'decor', cost: { stone: 40, bricks: 12 }, buildSec: 35, zone: 'coast', comfort: 15 },
  fountain: { era: 2, label: 'Fountain', emoji: '⛲', kind: 'decor', cost: { stone: 24, marble: 10 }, buildSec: 25, zone: 'inner', comfort: 18 },
  statue: { era: 2, label: 'Statue', emoji: '🗽', kind: 'decor', cost: { marble: 30, stone: 10 }, buildSec: 30, zone: 'inner', comfort: 25, evolve: 'holopark' },
  // --- Middle Ages -----------------------------------------------------------
  townhouse: { era: 3, label: 'Townhouse', emoji: '🏘️', kind: 'house', cost: { bricks: 22, stone: 14, iron: 3 }, buildSec: 30, zone: 'any', pop: 16, evolve: 'apartments' },
  mine: { era: 3, label: 'Mine', emoji: '⚒️', kind: 'producer', cost: { wood: 30, stone: 20 }, buildSec: 30, zone: 'outer', workers: 3, recipe: { out: { coal: 2, iron: 1 } } },
  tower: { era: 3, label: 'Castle tower', emoji: '🏰', kind: 'decor', cost: { stone: 40, iron: 4 }, buildSec: 35, zone: 'any', comfort: 20, maxLevel: 3 },
  windmill: { era: 3, label: 'Windmill', emoji: '🌬️', kind: 'special', cost: { wood: 24, stone: 12 }, buildSec: 30, zone: 'outer', workers: 1, boost: { item: 'farm', by: 0.5, radius: 2 } },
  harbor: { era: 3, label: 'Harbor', emoji: '⚓', kind: 'producer', cost: { wood: 40, iron: 6 }, buildSec: 35, zone: 'coast', workers: 3, recipe: { out: { food: 8 } } },
  university: { era: 3, label: 'University', emoji: '🎓', kind: 'knowledge', cost: { stone: 36, bricks: 20, iron: 6 }, buildSec: 40, zone: 'inner', workers: 3, comfort: 6, knowledge: 0.12, evolve: 'lab' },
  // --- Industrial Revolution -------------------------------------------------
  apartments: { era: 4, label: 'Apartment block', emoji: '🏢', kind: 'house', cost: { bricks: 45, steel: 10 }, buildSec: 40, zone: 'any', pop: 32, evolve: 'skyscraper' },
  steelmill: { era: 4, label: 'Steel mill', emoji: '🏭', kind: 'producer', cost: { bricks: 50, iron: 30 }, buildSec: 45, zone: 'outer', workers: 4, recipe: { in: { iron: 2, coal: 2 }, out: { steel: 2 } } },
  coalplant: { era: 4, label: 'Coal plant', emoji: '🔥', kind: 'power', cost: { bricks: 40, steel: 10 }, buildSec: 45, zone: 'outer', workers: 3, recipe: { in: { coal: 2 } }, power: 20, evolve: 'fusion' },
  factory: { era: 4, label: 'Factory', emoji: '⚙️', kind: 'producer', cost: { bricks: 60, steel: 30 }, buildSec: 50, zone: 'outer', workers: 5, power: -8, recipe: { in: { steel: 2 }, out: { parts: 2 } } },
  warehouse: { era: 4, label: 'Warehouse', emoji: '🏬', kind: 'storage', cost: { bricks: 40, steel: 10 }, buildSec: 35, zone: 'outer', storage: 400 },
  station: { era: 4, label: 'Train station', emoji: '🚉', kind: 'special', cost: { steel: 60, bricks: 40 }, buildSec: 50, zone: 'coast', comfort: 30, train: true },
  watertower: { era: 4, label: 'Water tower', emoji: '💧', kind: 'decor', cost: { steel: 20 }, buildSec: 30, zone: 'any', comfort: 15 },
  // --- Modern Age ------------------------------------------------------------
  skyscraper: { era: 5, label: 'Skyscraper', emoji: '🏙️', kind: 'house', cost: { steel: 70, parts: 24 }, buildSec: 60, zone: 'inner', pop: 64, power: -6, evolve: 'arcology' },
  turbine: { era: 5, label: 'Wind turbine', emoji: '🌀', kind: 'power', cost: { steel: 30, parts: 10 }, buildSec: 40, zone: 'coast', power: 15, wind: true },
  solar: { era: 5, label: 'Solar farm', emoji: '☀️', kind: 'power', cost: { steel: 20, parts: 16 }, buildSec: 40, zone: 'outer', power: 20, solar: true },
  chipfab: { era: 5, label: 'Chip factory', emoji: '💾', kind: 'producer', cost: { steel: 60, parts: 40 }, buildSec: 60, zone: 'outer', workers: 6, power: -15, recipe: { in: { parts: 2 }, out: { chips: 1 } } },
  lab: { era: 5, label: 'Research lab', emoji: '🔬', kind: 'knowledge', cost: { steel: 40, chips: 10 }, buildSec: 50, zone: 'inner', workers: 3, power: -6, knowledge: 0.15 },
  stadium: { era: 5, label: 'Stadium', emoji: '⚽', kind: 'decor', cost: { steel: 120, parts: 40 }, buildSec: 70, zone: 'any', comfort: 80, power: -5 },
  greenhouse: { era: 5, label: 'Greenhouse', emoji: '🌱', kind: 'producer', cost: { steel: 30, parts: 10 }, buildSec: 40, zone: 'outer', workers: 2, power: -4, recipe: { out: { food: 20 } }, evolve: 'vertifarm' },
  // --- Future ----------------------------------------------------------------
  arcology: { era: 6, label: 'Arcology', emoji: '🌐', kind: 'house', cost: { steel: 130, chips: 45 }, buildSec: 90, zone: 'inner', pop: 140, power: -10 },
  fusion: { era: 6, label: 'Fusion reactor', emoji: '⚛️', kind: 'power', cost: { steel: 200, chips: 80 }, buildSec: 90, zone: 'outer', workers: 4, power: 120 },
  robofactory: { era: 6, label: 'Robot factory', emoji: '🤖', kind: 'special', cost: { steel: 150, chips: 60 }, buildSec: 80, zone: 'outer', workers: 2, power: -20, global: 0.25 },
  vertifarm: { era: 6, label: 'Vertical farm', emoji: '🥬', kind: 'producer', cost: { steel: 80, chips: 20 }, buildSec: 60, zone: 'any', workers: 2, power: -10, recipe: { out: { food: 60 } } },
  maglev: { era: 6, label: 'Maglev', emoji: '🚄', kind: 'special', cost: { steel: 300, chips: 100 }, buildSec: 90, zone: 'coast', comfort: 60, train: true },
  holopark: { era: 6, label: 'Holo park', emoji: '🌈', kind: 'decor', cost: { steel: 20, chips: 20 }, buildSec: 40, zone: 'any', comfort: 60, power: -4 },
  droneport: { era: 6, label: 'Drone port', emoji: '🛸', kind: 'special', cost: { steel: 120, chips: 60 }, buildSec: 70, zone: 'any', workers: 2, power: -10, wonderBoost: 0.5 },
  // --- Wonders: two per era, from different parts of the world. Chat picks
  // one, the rival builds the other, on the ring around the landing pad.
  stonehenge: { era: 0, label: 'Stonehenge', emoji: '🪨', place: 'Britain', kind: 'wonder', needs: W[0], comfort: 30, noThe: true },
  moai: { era: 0, label: 'Moai', emoji: '🗿', place: 'Easter Island', kind: 'wonder', needs: W[0], comfort: 30 },
  pyramid: { era: 1, label: 'Great Pyramid', emoji: '🔺', place: 'Egypt', kind: 'wonder', needs: W[1], comfort: 50 },
  ziggurat: { era: 1, label: 'Ziggurat of Ur', emoji: '🪜', place: 'Sumer', kind: 'wonder', needs: W[1], comfort: 50 },
  colosseum: { era: 2, label: 'Colosseum', emoji: '🏟️', place: 'Rome', kind: 'wonder', needs: W[2], comfort: 70 },
  greatwall: { era: 2, label: 'Great Wall', emoji: '🐉', place: 'China', kind: 'wonder', needs: W[2], comfort: 70 },
  notredame: { era: 3, label: 'Notre Dame', emoji: '⛪', place: 'Paris', kind: 'wonder', needs: W[3], comfort: 100, noThe: true },
  angkorwat: { era: 3, label: 'Angkor Wat', emoji: '🛕', place: 'Cambodia', kind: 'wonder', needs: W[3], comfort: 100, noThe: true },
  eiffel: { era: 4, label: 'Eiffel Tower', emoji: '🗼', place: 'Paris', kind: 'wonder', needs: W[4], comfort: 140 },
  bigben: { era: 4, label: 'Big Ben', emoji: '🕰️', place: 'London', kind: 'wonder', needs: W[4], comfort: 140, noThe: true },
  empirestate: { era: 5, label: 'Empire State Building', emoji: '🌆', place: 'New York', kind: 'wonder', needs: W[5], comfort: 200 },
  operahouse: { era: 5, label: 'Sydney Opera House', emoji: '🎭', place: 'Sydney', kind: 'wonder', needs: W[5], comfort: 200 },
  // The last wonder ends the race: finale is what the stream says then.
  spire: { era: 6, label: 'Fusion Spire', emoji: '💠', kind: 'wonder', needs: W[6], comfort: 400, finale: 'The Fusion Spire is lit!' },
  elevator: { era: 6, label: 'Space Elevator', emoji: '🚀', kind: 'wonder', needs: W[6], comfort: 400, finale: 'The Space Elevator reaches the stars!' },
};

// Words chat may use. "house" means your own home first, then the town's
// homes of the current era.
export const ITEM_ALIASES = {
  house: 'house', home: 'house', homes: 'house', houses: 'house',
  tent: 'hut', cabin: 'hut',
  lumberjack: 'woodcutter', lumber: 'woodcutter', sawmill: 'woodcutter', forest: 'woodcutter',
  stonepit: 'quarry', pit: 'quarry',
  berries: 'gatherer', berry: 'gatherer', forager: 'gatherer',
  fishing: 'fisher', fishinghut: 'fisher', fish: 'fisher', dock: 'fisher', pier: 'fisher',
  fire: 'campfire', bonfire: 'campfire',
  storage: 'stockpile', storehouse: 'stockpile', crates: 'stockpile',
  idol: 'totem', monolith: 'totem',
  mudbrick: 'mudhouse', mudhut: 'mudhouse',
  field: 'farm', crops: 'farm', wheat: 'farm',
  irrigation: 'canal', shaduf: 'canal', ditch: 'canal', waterwheel: 'canal',
  mill: 'windmill',
  bricks: 'kiln', brickworks: 'kiln', oven: 'kiln', brickkiln: 'kiln',
  shop: 'market', store: 'market', cafe: 'market', bakery: 'market',
  flowers: 'garden', flower: 'garden', tulips: 'garden', tree: 'park', trees: 'park',
  shed: 'granary', barn: 'granary', silo: 'granary',
  needle: 'obelisk', pillar: 'obelisk',
  domus: 'villa',
  marble: 'marblequarry', marblepit: 'marblequarry',
  shrine: 'temple', forum: 'temple',
  mines: 'mine', coalmine: 'mine', ironmine: 'mine',
  castle: 'tower', keep: 'tower', castletower: 'tower',
  library: 'school',
  academy: 'university', college: 'university',
  port: 'harbor', harbour: 'harbor', docks: 'harbor',
  light: 'lighthouse',
  monument: 'statue',
  flats: 'apartments', apartment: 'apartments',
  steel: 'steelmill', foundry: 'steelmill', smelter: 'steelmill',
  powerplant: 'coalplant', power: 'coalplant', plant: 'coalplant',
  factories: 'factory', workshop: 'factory',
  depot: 'warehouse',
  train: 'station', trainstation: 'station', railway: 'station',
  water: 'watertower',
  highrise: 'skyscraper',
  windturbine: 'turbine', wind: 'turbine',
  solarpanel: 'solar', solarpanels: 'solar', panels: 'solar',
  chips: 'chipfab', electronics: 'chipfab',
  laboratory: 'lab', research: 'lab',
  arena: 'stadium', football: 'stadium',
  glasshouse: 'greenhouse',
  dome: 'arcology',
  reactor: 'fusion',
  robots: 'robofactory', robot: 'robofactory',
  verticalfarm: 'vertifarm',
  hologram: 'holopark', holo: 'holopark',
  drones: 'droneport', drone: 'droneport',
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

// Hats unlock as your bot levels up.
export const HATS = {
  none: { label: 'No hat', level: 1 },
  cap: { label: 'Cap', level: 1 },
  beanie: { label: 'Beanie', level: 1 },
  hardhat: { label: 'Hard hat', level: 2 },
  chef: { label: 'Chef hat', level: 3 },
  headphones: { label: 'Headphones', level: 4 },
  flowers: { label: 'Flower crown', level: 6 },
  propeller: { label: 'Propeller cap', level: 8 },
  tophat: { label: 'Top hat', level: 10 },
};
export const HAT_ALIASES = { helmet: 'hardhat', 'hard-hat': 'hardhat', top: 'tophat', 'top-hat': 'tophat', crown: 'flowers', flower: 'flowers', beret: 'beanie', off: 'none', remove: 'none' };

// Things that can happen to the island. Chat votes on them every hour.
export const EVENTS = {
  festival: { label: 'Festival', emoji: '🎉', mins: 30, text: 'Everyone is happier', happy: 20 },
  harvest: { label: 'Big Harvest', emoji: '🌾', mins: 30, text: 'Food x2', boost: { food: 2 } },
  tallTrees: { label: 'Tall Trees', emoji: '🌲', mins: 30, text: 'Wood x2', boost: { wood: 2 } },
  richVeins: { label: 'Rich Veins', emoji: '💎', mins: 30, text: 'Stone, marble, coal and iron x2', boost: { stone: 2, marble: 2, coal: 2, iron: 2 } },
  merchant: { label: 'Merchant Ship', emoji: '⛵', mins: 8, text: 'A gift of goods', gift: true },
  meteor: { label: 'Meteor Shower', emoji: '☄️', mins: 15, text: '+3 hours of knowledge', knowledgeMin: 180 },
  builderRush: { label: 'Builder Rush', emoji: '🔨', mins: 20, text: 'Builds go twice as fast', buildSpeed: 2 },
  storm: { label: 'Storm', emoji: '⛈️', mins: 10, text: 'Damages buildings, then !repair', damage: 3, chaos: true },
  blackout: { label: 'Blackout', emoji: '🔌', mins: 10, text: 'A power plant breaks, then !repair', damage: 1, damageKind: 'power', minEra: 4, chaos: true },
};

// Levels: XP needed for level n is 25 * n * (n - 1) / 2.
export const TITLES = [
  [1, 'Newcomer'], [2, 'Helper'], [3, 'Builder'], [5, 'Craftsman'], [8, 'Engineer'], [12, 'Architect'], [16, 'Master Builder'], [20, 'Legend'],
];
export const xpForLevel = (n) => (25 * n * (n - 1)) / 2;
export function levelFor(xp) {
  let n = 1;
  while (xpForLevel(n + 1) <= xp) n++;
  return n;
}
export function titleFor(level) {
  let t = TITLES[0][1];
  for (const [lv, name] of TITLES) if (level >= lv) t = name;
  return t;
}
// Every viewer has one home of their own. It grows with !upgrade (levels 1
// to 3) and turns into the new kind of home whenever a new era starts.
export const HOME_LEVELS = 3;
// Town buildings can be upgraded twice; every level makes 50% more
// (goods, power, storage room, people or knowledge).
export const BUILD_LEVELS = 3;
export const levelMult = (level) => 1 + 0.5 * ((level || 1) - 1);
// Better tools for a viewer's bot (!upgrade tools): a bigger load on every
// trip and faster building. Each needs a viewer level, the era its material
// comes from, and a few goods from the town.
export const TOOLS = [
  { key: 'stone', label: 'Stone tools', level: 1, era: 0, cost: {}, load: 2, build: 1, color: '#9b9a94' },
  { key: 'copper', label: 'Copper tools', level: 3, era: 1, cost: { bricks: 6, wood: 6 }, load: 3, build: 1.25, color: '#c97a3c' },
  { key: 'iron', label: 'Iron tools', level: 6, era: 3, cost: { iron: 8 }, load: 4, build: 1.5, color: '#5a616b' },
  { key: 'steel', label: 'Steel tools', level: 10, era: 4, cost: { steel: 8 }, load: 5, build: 1.75, color: '#cfd6de' },
  { key: 'power', label: 'Power tools', level: 15, era: 5, cost: { parts: 8 }, load: 6, build: 2, color: '#f2b705' },
  { key: 'laser', label: 'Laser tools', level: 20, era: 6, cost: { chips: 6 }, load: 8, build: 2.5, color: '#38e0ff' },
];
export const toolsOf = (builder) => TOOLS[Math.max(0, Math.min(TOOLS.length - 1, builder?.tool || 0))];
export const homePop = (level) => 2 + (level || 1);

export const PALETTE = Object.values(COLORS).filter((c) => c !== COLORS.white && c !== COLORS.black);

function lookup(word, table, aliases) {
  if (!word) return null;
  const w = String(word).toLowerCase();
  if (Object.hasOwn(table, w)) return w;
  if (Object.hasOwn(aliases, w)) return aliases[w];
  // Plurals: "huts", "farms", "factories".
  if (w.endsWith('ies') && Object.hasOwn(table, w.slice(0, -3) + 'y')) return w.slice(0, -3) + 'y';
  if (w.endsWith('es') && Object.hasOwn(table, w.slice(0, -2))) return w.slice(0, -2);
  if (w.endsWith('s') && Object.hasOwn(table, w.slice(0, -1))) return w.slice(0, -1);
  return null;
}
// Resolves to an item name, or 'house' for the generic word (the server then
// picks the house of the current era). Wonders are never built by hand.
export function resolveItem(word) {
  const r = lookup(word, ITEMS, ITEM_ALIASES);
  if (!r) return null;
  if (r !== 'house' && ITEMS[r].kind === 'wonder') return null;
  return r;
}
// "wonder", or a wonder's own name ("pyramid", "eiffel tower"): the whole
// chat builds those together, so !build wonder means !help wonder.
const WONDER_WORDS = new Set(['wonder']);
for (const [k, it] of Object.entries(ITEMS)) {
  if (it.kind === 'wonder') WONDER_WORDS.add(k).add(it.label.toLowerCase().replace(/\s+/g, ''));
}
export function isWonderWord(word) {
  const w = String(word || '').toLowerCase().replace(/\s+/g, '');
  return WONDER_WORDS.has(w) || (w.endsWith('s') && WONDER_WORDS.has(w.slice(0, -1)));
}
// What a building is for, in a few words, worked out from what it does in the
// game so it is never out of date: on the Buildings page, when a project
// starts, and for !info.
export function whatItDoes(key) {
  const it = ITEMS[key];
  if (!it) return '';
  const goods = (bag) => Object.keys(bag || {}).map((r) => RESOURCES[r].label.toLowerCase()).join(' and ');
  const out = [];
  if (it.kind === 'house') out.push('a home for ' + it.pop + ' people');
  else if (it.kind === 'producer') out.push('makes ' + goods(it.recipe.out) + (it.recipe.in ? ' from ' + goods(it.recipe.in) : ''));
  else if (it.kind === 'storage') out.push(it.reveal ? 'a store far out in the world, so producers out there work at full speed' : 'room for ' + it.storage + ' more of every good');
  else if (it.kind === 'decor') out.push('makes the homes around it happier (+' + it.comfort + ')');
  else if (it.kind === 'knowledge') out.push('knowledge comes ' + Math.round(it.knowledge * 100) + '% faster');
  else if (it.kind === 'power') out.push('makes ' + it.power + ' power' + (it.solar ? ' by day' : '') + (it.recipe?.in ? ' from ' + goods(it.recipe.in) : ''));
  else if (it.kind === 'wonder') out.push('a wonder of ' + ERAS[it.era].the + (it.place ? ', from ' + it.place : '') + ': everyone hauls to it');
  if (it.boost) out.push(ITEMS[it.boost.item].label.toLowerCase() + 's around it make ' + Math.round(it.boost.by * 100) + '% more');
  if (it.train) out.push('a train runs round town');
  if (it.global) out.push('every producer works ' + Math.round(it.global * 100) + '% faster');
  if (it.wonderBoost) out.push('the wonder rises ' + Math.round(it.wonderBoost * 100) + '% faster');
  if (it.kind === 'decor' && it.knowledge) out.push('knowledge comes ' + Math.round(it.knowledge * 100) + '% faster');
  if (it.comfort && it.kind !== 'decor' && it.kind !== 'wonder') out.push('people nearby are happier');
  if (it.power < 0) out.push('needs ' + -it.power + ' power');
  const text = out.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
// A wonder named in chat ("pyramid", "great wall", "the moai").
export function resolveWonder(word) {
  const w = String(word || '').toLowerCase().replace(/\s+/g, '');
  for (const [k, it] of Object.entries(ITEMS)) {
    if (it.kind !== 'wonder') continue;
    const name = it.label.toLowerCase().replace(/\s+/g, '');
    if (w === k || w === name || w === k + 's' || w === name + 's') return k;
  }
  return null;
}
// How a sentence names a building: "the Great Pyramid", but "Stonehenge".
export const theName = (key) => (ITEMS[key].noThe ? '' : 'the ') + ITEMS[key].label;
export const TheName = (key) => { const n = theName(key); return n.charAt(0).toUpperCase() + n.slice(1); };
// The two wonders of an era, and the one the other town builds.
export const wondersOf = (era) => ERAS[Math.max(0, Math.min(ERAS.length - 1, era))].wonders;
export const otherWonder = (key) => wondersOf(ITEMS[key].era).find((k) => k !== key);
export const resolveColor = (word) => lookup(word, COLORS, COLOR_ALIASES);
export const resolveHat = (word) => lookup(word, HATS, HAT_ALIASES);
export const resolveResource = (word) => lookup(word, RESOURCES, { wonder: 'wonder', bread: 'food', logs: 'wood', sticks: 'wood', stick: 'wood', rocks: 'stone', rock: 'stone', brick: 'bricks', ore: 'iron', metal: 'iron', part: 'parts', chip: 'chips' });

export const itemsOfEra = (era) => Object.keys(ITEMS).filter((k) => ITEMS[k].era === era && ITEMS[k].kind !== 'wonder');
// The newest building an item has evolved into by this era.
export function evolvedItem(item, era) {
  let it = item;
  for (let i = 0; i < ERAS.length && ITEMS[it]?.evolve && ITEMS[ITEMS[it].evolve].era <= era; i++) it = ITEMS[it].evolve;
  return it;
}
export const houseFor = (era) => ERAS[Math.max(0, Math.min(ERAS.length - 1, era))].house;

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
