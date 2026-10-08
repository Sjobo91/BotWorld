// Pretend viewers, for trying BotWorld without a live chat (npm run demo).
// They play roughly like real chat: get a home, follow the "next step" box,
// help build, explore the fog, vote, repair after storms and goof around.
import { COLORS, HATS, itemsOfEra, levelFor } from '../public/shared/catalog.js';

const NAMES = [
  'pixel_pete', 'mapleMoose', 'luna_builds', 'sir_hammer', 'coffeebean42', 'turbo_tess', 'quietfox',
  'brickbybrick', 'Nova_Gamer', 'grandma_byte', 'wobblytoast', 'captain_kelp', 'dot_matrix', 'sunnyside_up',
];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function line(world, name) {
  const s = world ? world.state : { era: 0, builders: {}, jobs: {} };
  const econ = world ? world.econ : null;
  const era = s.era || 0;
  const id = 'sim:' + name.toLowerCase();
  const me = s.builders[id];
  if (world && !world.homeOf(id) && Math.random() < 0.7) return pick(['!home', '!build house']);
  if (s.vote && Math.random() < 0.5) return pick(['!vote ', '!']) + (1 + Math.floor(Math.random() * 3));
  if (world && world.builds.some((b) => b.damaged && !b.repairBy) && Math.random() < 0.4) return '!repair';
  const r = Math.random();
  // Most pretend viewers follow the "next step" box, like real chat would.
  if (r < 0.45 && econ && econ.plan && econ.plan.length) return pick(econ.plan.slice(0, 2)).cmd;
  if (r < 0.6) return '!help';
  if (r < 0.7) return '!explore' + pick(['', '', ' north', ' east', ' south', ' west']);
  if (r < 0.78) {
    const item = pick(itemsOfEra(era));
    const color = Math.random() < 0.3 ? pick(Object.keys(COLORS)) + ' ' : '';
    return pick(['!build ', '!b ']) + color + item;
  }
  if (r < 0.82) return pick(['!wood', '!stone', '!food', '!chop', '!mine', '!fish', '!work']);
  if (r < 0.85) return '!upgrade';
  if (r < 0.89) {
    const level = me ? levelFor(me.xp || 0) : 1;
    return '!hat ' + pick(Object.keys(HATS).filter((h) => HATS[h].level <= level));
  }
  if (r < 0.92) return '!dance';
  if (r < 0.95) return '!me';
  if (r < 0.96) return '!build spaceship';
  return pick(['hi chat', 'this is so cozy', 'LUL', 'what is in the fog?', 'gg', 'look at the little bots', 'more farms pls']);
}

export function startSimulator(onChat, world, { minMs = 3000, maxMs = 9000 } = {}) {
  let timer = null;
  const next = () => {
    timer = setTimeout(() => {
      const name = pick(NAMES);
      onChat({ id: 'sim:' + name.toLowerCase(), name, color: '' }, line(world, name));
      next();
    }, minMs + Math.random() * (maxMs - minMs));
  };
  next();
  console.log('[sim] pretend viewers are chatting');
  return () => clearTimeout(timer);
}
