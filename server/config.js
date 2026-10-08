// Settings come from botworld.config.json (optional), then environment
// variables, then command line flags such as --channel=name or --simulate.
import fs from 'node:fs';
import path from 'node:path';

const DEFAULTS = {
  channel: '',
  port: 3000,
  host: '',
  simulate: false,
  dataDir: 'data',
  limits: {},
  // eraDays: days one era takes at base speed (6 eras, about 2 months in all).
  pace: { eraDays: 9 },
  // Where the island is, for sunrise, sunset and solar panels.
  geo: { lat: 52.2, lon: 5.1 },
  // A newspaper headline every everyMin minutes. ai: 'auto' lets Claude write
  // them when ANTHROPIC_API_KEY is set, true/false forces it on or off.
  gazette: { everyMin: 30, ai: 'auto', model: 'claude-opus-5-5' },
};

export function loadConfig(argv = process.argv.slice(2), env = process.env, root = process.cwd()) {
  const cfg = structuredClone(DEFAULTS);
  const file = path.join(root, 'botworld.config.json');
  if (fs.existsSync(file)) {
    try {
      Object.assign(cfg, JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (err) {
      console.warn('[config] ignoring botworld.config.json:', err.message);
    }
  }
  if (env.TWITCH_CHANNEL) cfg.channel = env.TWITCH_CHANNEL;
  if (env.PORT) cfg.port = Number(env.PORT);
  if (env.HOST) cfg.host = env.HOST;
  if (env.BOTWORLD_DATA) cfg.dataDir = env.BOTWORLD_DATA;
  if (env.BOTWORLD_SIMULATE === '1') cfg.simulate = true;
  if (env.BOTWORLD_ERA_DAYS) cfg.pace.eraDays = Number(env.BOTWORLD_ERA_DAYS);
  for (const arg of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!m) continue;
    const [, key, value] = m;
    if (key === 'channel') cfg.channel = value || '';
    else if (key === 'port') cfg.port = Number(value);
    else if (key === 'data') cfg.dataDir = value;
    else if (key === 'simulate') cfg.simulate = value !== 'false';
    else if (key === 'era-days') cfg.pace.eraDays = Number(value);
  }
  cfg.channel = String(cfg.channel || '').replace(/^#/, '').toLowerCase().trim();
  if (cfg.channel === 'your_twitch_channel') cfg.channel = '';
  cfg.pace = { ...DEFAULTS.pace, ...(cfg.pace || {}) };
  if (!(cfg.pace.eraDays > 0)) cfg.pace.eraDays = DEFAULTS.pace.eraDays;
  cfg.geo = { ...DEFAULTS.geo, ...(cfg.geo || {}) };
  cfg.gazette = { ...DEFAULTS.gazette, ...(cfg.gazette || {}) };
  cfg.dataDir = path.resolve(root, cfg.dataDir);
  return cfg;
}
