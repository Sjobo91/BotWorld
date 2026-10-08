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
  for (const arg of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!m) continue;
    const [, key, value] = m;
    if (key === 'channel') cfg.channel = value || '';
    else if (key === 'port') cfg.port = Number(value);
    else if (key === 'data') cfg.dataDir = value;
    else if (key === 'simulate') cfg.simulate = value !== 'false';
  }
  cfg.channel = String(cfg.channel || '').replace(/^#/, '').toLowerCase().trim();
  if (cfg.channel === 'your_twitch_channel') cfg.channel = '';
  cfg.dataDir = path.resolve(root, cfg.dataDir);
  return cfg;
}
