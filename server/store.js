// Keeps the world on disk. Writes go to a temp file first and are then
// renamed over the real one, so a crash or power cut never leaves a half
// written world behind. Once a day a dated backup is kept as well.
import fs from 'node:fs';
import path from 'node:path';
import { freshState } from './world.js';

export class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'world.json');
    this.backupDir = path.join(dir, 'backups');
    this.lastBackupDay = '';
  }

  load(now) {
    fs.mkdirSync(this.dir, { recursive: true });
    try {
      const state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (state && [1, 2, 3, 4].includes(state.version) && Array.isArray(state.builds) && state.builders) return state;
      console.warn('[store] world.json has an unknown shape, starting fresh (old file kept as world.bad.json)');
      fs.copyFileSync(this.file, path.join(this.dir, 'world.bad.json'));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn('[store] could not read world.json:', err.message);
        try { fs.copyFileSync(this.file, path.join(this.dir, 'world.bad.json')); } catch {}
      }
    }
    return freshState(now);
  }

  save(state, now) {
    const json = JSON.stringify(state);
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, json);
    fs.renameSync(tmp, this.file);
    const day = new Date(now).toISOString().slice(0, 10);
    if (day !== this.lastBackupDay) {
      this.lastBackupDay = day;
      fs.mkdirSync(this.backupDir, { recursive: true });
      fs.writeFileSync(path.join(this.backupDir, 'world-' + day + '.json'), json);
    }
  }
}
