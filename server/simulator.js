// Pretend viewers, for trying BotWorld without a live chat (npm run demo).
import { ITEMS, COLORS, HATS } from '../public/shared/catalog.js';

const NAMES = [
  'pixel_pete', 'mapleMoose', 'luna_builds', 'sir_hammer', 'coffeebean42', 'turbo_tess', 'quietfox',
  'brickbybrick', 'Nova_Gamer', 'grandma_byte', 'wobblytoast', 'captain_kelp', 'dot_matrix', 'sunnyside_up',
];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function line() {
  const r = Math.random();
  if (r < 0.62) {
    const item = pick(Object.keys(ITEMS));
    const color = Math.random() < 0.45 ? pick(Object.keys(COLORS)) + ' ' : '';
    return pick(['!build ', '!build a ', '!build ', '!b ']) + color + item;
  }
  if (r < 0.74) return '!upgrade';
  if (r < 0.82) return '!hat ' + pick(Object.keys(HATS));
  if (r < 0.9) return '!dance';
  if (r < 0.95) return '!build spaceship';
  return pick(['hi chat', 'this is so cozy', 'LUL', 'build a castle!', 'gg']);
}

export function startSimulator(onChat, { minMs = 3000, maxMs = 9000 } = {}) {
  let timer = null;
  const next = () => {
    timer = setTimeout(() => {
      const name = pick(NAMES);
      onChat({ id: 'sim:' + name.toLowerCase(), name, color: '' }, line());
      next();
    }, minMs + Math.random() * (maxMs - minMs));
  };
  next();
  console.log('[sim] pretend viewers are chatting');
  return () => clearTimeout(timer);
}
