// Soft sounds, all synthesized: wind, birds, crickets, rain, hammers and
// cheers. Browsers only allow sound after a click; OBS allows it right away.
export function createAudio() {
  const a = { ctx: null, master: null, noise: null, rain: null, on: false, timer: null, lastHammer: 0, weather: () => ({ rain: 0, day: 1 }) };

  function noiseBuffer(ctx) {
    const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    return b;
  }

  function start() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    if (!a.ctx) {
      const ctx = new AC();
      a.ctx = ctx;
      a.master = ctx.createGain();
      a.master.gain.value = 0.32;
      a.master.connect(ctx.destination);
      a.noise = noiseBuffer(ctx);
      const wind = ctx.createBufferSource();
      wind.buffer = a.noise;
      wind.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 500;
      const wg = ctx.createGain();
      wg.gain.value = 0.25;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.12;
      const lg = ctx.createGain();
      lg.gain.value = 0.15;
      lfo.connect(lg).connect(wg.gain);
      wind.connect(lp).connect(wg).connect(a.master);
      wind.start();
      lfo.start();
      const rs = ctx.createBufferSource();
      rs.buffer = a.noise;
      rs.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1200;
      a.rain = ctx.createGain();
      a.rain.gain.value = 0;
      rs.connect(hp).connect(a.rain).connect(a.master);
      rs.start();
    }
    a.ctx.resume();
    a.on = true;
    clearInterval(a.timer);
    a.timer = setInterval(ambient, 900);
    return true;
  }

  function stop() {
    a.on = false;
    clearInterval(a.timer);
    if (a.ctx) a.ctx.suspend();
  }

  function tone(freq, dur, type, vol, when, glideTo) {
    const ctx = a.ctx;
    const t0 = ctx.currentTime + (when || 0);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(a.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  function thud(vol, freq) {
    const ctx = a.ctx;
    const src = ctx.createBufferSource();
    src.buffer = a.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq || 900;
    const g = ctx.createGain();
    const t0 = ctx.currentTime;
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
    src.connect(bp).connect(g).connect(a.master);
    src.start(t0, Math.random());
    src.stop(t0 + 0.15);
  }

  function sfx(kind, v = 1) {
    if (!a.on || !a.ctx) return;
    if (kind === 'tap') tone(660, 0.12, 'triangle', 0.25 * v, 0, 990);
    else if (kind === 'boing') tone(220, 0.5, 'sine', 0.3 * v, 0, 90);
    else if (kind === 'chime') { tone(784, 0.5, 'sine', 0.25 * v); tone(1046, 0.6, 'sine', 0.2 * v, 0.18); }
    else if (kind === 'party') [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'triangle', 0.22 * v, i * 0.09));
    else if (kind === 'pop') { thud(0.5 * v, 400); tone(300, 0.4, 'sine', 0.1 * v, 0, 1200); }
    else if (kind === 'whoosh') tone(120, 0.9, 'sawtooth', 0.05 * v, 0, 60);
    else if (kind === 'meow') tone(700, 0.45, 'triangle', 0.18 * v, 0, 420);
    else if (kind === 'hammer') {
      const t = performance.now();
      if (t - a.lastHammer < 220) return;
      a.lastHammer = t;
      thud(0.35 * v, 1400 + Math.random() * 600);
    }
  }

  function ambient() {
    if (!a.on || !a.ctx) return;
    const w = a.weather();
    a.rain.gain.setTargetAtTime(w.rain * 0.5, a.ctx.currentTime, 1.5);
    if (w.day > 0.4 && w.rain < 0.3 && Math.random() < 0.35) {
      const f = 2200 + Math.random() * 1600;
      tone(f, 0.08, 'sine', 0.05, 0, f * 1.3);
      tone(f * 1.1, 0.08, 'sine', 0.04, 0.12, f * 0.9);
    }
    if (w.day < 0.4 && Math.random() < 0.5) {
      for (let i = 0; i < 3; i++) tone(4200, 0.03, 'square', 0.012, i * 0.06);
    }
  }

  return {
    start,
    stop,
    sfx,
    get on() { return a.on; },
    set weather(fn) { a.weather = fn; },
  };
}
