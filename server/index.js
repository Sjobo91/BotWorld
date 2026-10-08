// BotWorld server: reads chat, runs the world, saves it, and serves the page
// that draws it. Open http://localhost:3000 to watch, or add
// http://localhost:3000/?stream=1 to OBS as a browser source to go live.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { Store } from './store.js';
import { World } from './world.js';
import { TwitchChat } from './twitch.js';
import { startSimulator } from './simulator.js';
import { Gazette } from './gazette.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const THREE_DIR = path.join(ROOT, 'node_modules', 'three');
const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0/';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const cfg = loadConfig(process.argv.slice(2), process.env, ROOT);
const store = new Store(cfg.dataDir);
const world = new World(store.load(Date.now()), { limits: cfg.limits, pace: cfg.pace, geo: cfg.geo });
const clients = new Set();
let twitch = null;
const startedAt = Date.now();

function broadcast(event) {
  const data = 'data: ' + JSON.stringify(event) + '\n\n';
  for (const res of clients) res.write(data);
}
world.on(broadcast);
const gazette = new Gazette(world, broadcast, { config: cfg.gazette });

function onChat(user, text) {
  try {
    const result = world.handleChat(user, text, Date.now());
    if (result && result.message) console.log('[chat] ' + user.name + ': ' + text + ' -> ' + result.message);
    return result;
  } catch (err) {
    console.error('[chat] failed on "' + text + '":', err);
    return { ok: false, message: 'Something went wrong.' };
  }
}

function mode() {
  return { channel: cfg.channel, simulate: cfg.simulate, twitch: twitch ? twitch.status : 'off', geo: cfg.geo, eraDays: cfg.pace.eraDays };
}

function sendJson(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function sendFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  });
}

// three.js comes from node_modules after `npm install`; without it we point
// the browser at the CDN so the page still works.
function sendThree(res, rel) {
  const local = rel === 'three.module.js' ? path.join(THREE_DIR, 'build', rel) : path.join(THREE_DIR, 'examples', 'jsm', rel.replace(/^addons\//, ''));
  if (!local.startsWith(THREE_DIR)) return sendJson(res, 400, { error: 'bad path' });
  if (fs.existsSync(local)) return sendFile(res, local);
  const remote = rel === 'three.module.js' ? 'build/three.module.js' : 'examples/jsm/' + rel.replace(/^addons\//, '');
  res.writeHead(302, { location: THREE_CDN + remote });
  res.end();
}

const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > limit) { reject(new Error('too large')); req.destroy(); }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  if (p === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write('retry: 2000\n');
    res.write('data: ' + JSON.stringify({ type: 'snapshot', ...world.snapshot(Date.now()), mode: mode(), gazette: gazette.latest }) + '\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (p === '/api/state') return sendJson(res, 200, { ...world.snapshot(Date.now()), mode: mode() });
  if (p === '/health') return sendJson(res, 200, { ok: true, uptimeSec: Math.round((Date.now() - startedAt) / 1000), viewers: clients.size, builds: world.builds.length, era: world.era, ...mode() });
  if (p === '/api/chat' && req.method === 'POST') {
    // Test chat from the page's dev box. Only from this computer, so nobody
    // on the internet can type into your world.
    if (!isLocal(req)) return sendJson(res, 403, { error: 'Only from this computer.' });
    try {
      const body = JSON.parse(await readBody(req));
      const name = String(body.user || 'tester').slice(0, 25);
      const result = onChat({ id: 'local:' + name.toLowerCase(), name, mod: !!body.mod, broadcaster: !!body.mod }, String(body.text || ''));
      return sendJson(res, 200, result || { ok: false, message: 'Not a command. Commands start with !' });
    } catch {
      return sendJson(res, 400, { error: 'Send JSON: { "user": "name", "text": "!build house" }' });
    }
  }
  if (p.startsWith('/vendor/three/')) return sendThree(res, p.slice('/vendor/three/'.length));
  const file = path.join(PUBLIC, p === '/' ? 'index.html' : p);
  if (!file.startsWith(PUBLIC + path.sep)) return sendJson(res, 400, { error: 'bad path' });
  sendFile(res, file);
});

// Heartbeat for the event stream, so proxies and OBS keep it open.
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 15000);

// The clock of the world: finish builds, start queued ones, save when changed.
let lastSave = 0;
function saveNow() {
  try {
    store.save(world.state, Date.now());
    world.dirty = false;
    lastSave = Date.now();
  } catch (err) {
    console.error('[store] save failed:', err.message);
  }
}
setInterval(() => {
  world.tick(Date.now());
  if (world.dirty && Date.now() - lastSave > 2000) saveNow();
}, 1000);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    saveNow();
    process.exit(0);
  });
}

// No host means every address, IPv4 and IPv6, so "localhost" always works.
const listenArgs = cfg.host ? [cfg.port, cfg.host] : [cfg.port];
server.listen(...listenArgs, () => {
  console.log('BotWorld is running: http://localhost:' + cfg.port + '  (stream view: http://localhost:' + cfg.port + '/?stream=1)');
  console.log('World: ' + world.builds.length + ' builds, ' + Object.keys(world.state.builders).length + ' builders, era ' + (world.era + 1) + ' of 6 (' + cfg.pace.eraDays + ' days per era). Saved in ' + store.file);
  if (cfg.channel) {
    twitch = new TwitchChat(cfg.channel, onChat);
    twitch.start();
  } else {
    console.log('No Twitch channel set. Use --channel=yourname or botworld.config.json to read real chat.');
  }
  if (cfg.simulate) startSimulator(onChat, world);
  gazette.start();
});
