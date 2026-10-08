// Pretend viewers, for trying BotWorld without a live chat (npm run demo).
// They play roughly like real chat: build what the era offers, follow the
// "needs" hints on screen now and then, help out with !work, vote, repair
// after storms and goof around.
import { ITEMS, COLORS, HATS, itemsOfEra, levelFor } from '../public/shared/catalog.js';

const NAMES = [
  'pixel_pete', 'mapleMoose', 'luna_builds', 'sir_hammer', 'coffeebean42', 'turbo_tess', 'quietfox',
  'brickbybrick', 'Nova_Gamer', 'grandma_byte', 'wobblytoast', 'captain_kelp', 'dot_matrix', 'sunnyside_up',
];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function line(world, name) {
  const s = world ? world.state : { era: 0, builders: {} };
  const econ = world ? world.econ : null;
  const era = s.era || 0;
  const me = s.builders['sim:' + name.toLowerCase()];
  if (s.vote && Math.random() < 0.5) return pick(['!vote ', '!']) + (1 + Math.floor(Math.random() * 3));
  if (world && world.builds.some((b) => b.damaged && !b.repairBy) && Math.random() < 0.4) return '!repair';
  const r = Math.random();
  if (r < 0.5) {
    const need = econ && econ.needs && econ.needs.length && Math.random() < 0.5 ? pick(econ.needs).item : null;
    const pool = itemsOfEra(era).concat(era > 0 && Math.random() < 0.3 ? itemsOfEra(era - 1) : []);
    const item = need || (Math.random() < 0.3 ? 'house' : pick(pool));
    const color = Math.random() < 0.35 && ITEMS[item]?.kind !== 'producer' ? pick(Object.keys(COLORS)) + ' ' : '';
    return pick(['!build ', '!build a ', '!b ']) + color + item;
  }
  if (r < 0.68) return '!work' + pick(['', '', ' wonder', ' wood', ' stone', ' food']);
  if (r < 0.76) return '!upgrade';
  if (r < 0.81) {
    const level = me ? levelFor(me.xp || 0) : 1;
    return '!hat ' + pick(Object.keys(HATS).filter((h) => HATS[h].level <= level));
  }
  if (r < 0.86) return '!dance';
  if (r < 0.89) return '!me';
  if (r < 0.91) return '!build spaceship';
  return pick(['hi chat', 'this is so cozy', 'LUL', 'build a castle!', 'gg', 'look at the little bots', 'more farms pls']);
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
