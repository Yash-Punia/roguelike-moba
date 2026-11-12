// Renders every game sound from code into Howler sprite files (D-106): a tiny DSP in plain JS,
// then ffmpeg encodes Opus-in-WebM and an MP3 fallback (TDD §9). Run with `npm run audio`
// (needs ffmpeg on PATH). Seeded, so the same code gives the same files. The outputs in
// assets/audio/ are committed, so building the game never needs ffmpeg.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SR = 48000;
const OUT = 'assets/audio';
const LEAD_MS = 100;
const GAP_MS = 150;
const PEAK = 0.89; // −1 dB

// ---------------------------------------------------------------- signal building blocks

/** Seeded uniform [0, 1). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const samples = (s) => Math.round(s * SR);

/** White noise, `s` seconds. */
function noise(rng, s) {
  const out = new Float32Array(samples(s));
  for (let i = 0; i < out.length; i++) out[i] = rng() * 2 - 1;
  return out;
}

/** An oscillator whose frequency may change over time: `freq(t)` in Hz, `shape` sine | saw | square. */
function osc(s, freq, shape = 'sine') {
  const out = new Float32Array(samples(s));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const f = typeof freq === 'function' ? freq(i / SR) : freq;
    phase = (phase + f / SR) % 1;
    out[i] = shape === 'sine' ? Math.sin(phase * 2 * Math.PI) : shape === 'saw' ? phase * 2 - 1 : phase < 0.5 ? 1 : -1;
  }
  return out;
}

/** Exponential sweep from `a` to `b` Hz over `s` seconds, then held. */
const sweep = (a, b, s) => (t) => a * Math.pow(b / a, Math.min(1, t / s));

/** Multiplies by an envelope: linear attack, exponential decay (time constant `decay`). */
function env(x, attack, decay, delay = 0) {
  for (let i = 0; i < x.length; i++) {
    const t = i / SR - delay;
    x[i] *= t < 0 ? 0 : t < attack ? t / attack : Math.exp(-(t - attack) / decay);
  }
  return x;
}

/** RBJ biquad, in place. `freq` may be a function of time (coefficients refresh every 32 samples). */
function filter(x, type, freq, q = 0.707) {
  let b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const coeffs = (f) => {
    const w = (2 * Math.PI * Math.min(f, SR * 0.45)) / SR;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    if (type === 'lp') { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2; }
    else if (type === 'hp') { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2; }
    else { b0 = alpha; b1 = 0; b2 = -alpha; } // band-pass, 0 dB peak
    a1 = (-2 * cos) / a0; a2 = (1 - alpha) / a0;
    b0 /= a0; b1 /= a0; b2 /= a0;
  };
  for (let i = 0; i < x.length; i++) {
    if (i % 32 === 0) coeffs(typeof freq === 'function' ? freq(i / SR) : freq);
    const y = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y;
    x[i] = y;
  }
  return x;
}

/** Soft clip with gain `k`. */
function drive(x, k) {
  const norm = Math.tanh(k);
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * k) / norm;
  return x;
}

/** Sums layers (each `[signal, gain]`, or `[signal, gain, offsetSeconds]`) into `s` seconds. */
function mix(s, ...layers) {
  const out = new Float32Array(samples(s));
  for (const [x, g, at = 0] of layers) {
    const o = samples(at);
    for (let i = 0; i < x.length && i + o < out.length; i++) out[i + o] += x[i] * g;
  }
  return out;
}

/** A short fade at both ends, so no sound starts or stops with a click. */
function edges(x, inMs = 1, outMs = 15) {
  const a = samples(inMs / 1000);
  const b = samples(outMs / 1000);
  for (let i = 0; i < a && i < x.length; i++) x[i] *= i / a;
  for (let i = 0; i < b && i < x.length; i++) x[x.length - 1 - i] *= i / b;
  return x;
}

/** Makes a loop seamless: renders `extra` seconds past the loop and crossfades them into its start. */
function seamless(make, s, extra = 0.12) {
  const full = make(s + extra);
  const n = samples(s);
  const fade = samples(extra);
  const out = full.slice(0, n);
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    out[i] = out[i] * k + full[n + i] * (1 - k);
  }
  return out;
}

// ---------------------------------------------------------------- the sounds

/** A gunshot: a bright crack, a body and a low thump; the numbers set its character. */
function gunshot(rng, { s, crack, crackDecay, body, bodyDecay, thump, thumpDecay, tail = 0, tailFreq = 500, k = 2 }) {
  return drive(
    mix(
      s,
      [env(filter(noise(rng, s), 'hp', crack), 0.0005, crackDecay), 1],
      [env(filter(noise(rng, s), 'bp', body, 0.9), 0.001, bodyDecay), 0.9],
      [env(osc(s, sweep(thump, thump / 2, 0.08)), 0.001, thumpDecay), 0.8],
      [env(filter(noise(rng, s), 'bp', tailFreq, 0.7), 0.01, tail || 0.001), tail ? 0.35 : 0],
    ),
    k,
  );
}

/** A blast: low-passed noise sweeping down, a sub thump, sparse crackle. */
function blast(rng, s, { from = 2400, to = 180, decay = 0.45, sub = 60, crackle = 30 } = {}) {
  const crackles = new Float32Array(samples(s));
  for (let n = 0; n < crackle; n++) {
    const at = samples(0.02 + rng() * s * 0.6);
    const len = samples(0.004);
    for (let i = 0; i < len && at + i < crackles.length; i++) crackles[at + i] += (rng() * 2 - 1) * (1 - i / len) * Math.exp(-at / SR / 0.3);
  }
  return drive(
    mix(
      s,
      [env(filter(noise(rng, s), 'lp', sweep(from, to, s * 0.6), 0.8), 0.004, decay), 1.2],
      [env(osc(s, sweep(sub, sub / 2.4, 0.4)), 0.003, decay * 1.2), 1],
      [filter(crackles, 'hp', 1500), 0.5],
    ),
    2.5,
  );
}

const SOUNDS = {
  // Champions: each must be told apart by ear (GDD §10).
  revolver: (rng) => gunshot(rng, { s: 0.55, crack: 1800, crackDecay: 0.025, body: 900, bodyDecay: 0.09, thump: 120, thumpDecay: 0.09, tail: 0.25, tailFreq: 420, k: 2.5 }),
  smg: (rng) => gunshot(rng, { s: 0.16, crack: 2600, crackDecay: 0.012, body: 2100, bodyDecay: 0.025, thump: 200, thumpDecay: 0.025, k: 1.8 }),
  // Gamma's flamethrower: a breathy roar with a slow flutter and crackle.
  flameLoop: (rng) =>
    seamless((s) => {
      const roar = filter(filter(noise(rng, s), 'lp', 900, 0.6), 'hp', 120);
      const hiss = filter(noise(rng, s), 'bp', 2400, 0.8);
      const out = mix(s, [roar, 1.4], [hiss, 0.25]);
      for (let i = 0; i < out.length; i++) out[i] *= 0.8 + 0.2 * Math.sin((2 * Math.PI * 6 * i) / SR) * Math.sin((2 * Math.PI * 1.3 * i) / SR + 1);
      for (let n = 0; n < s * 25; n++) {
        const at = Math.floor(rng() * out.length);
        for (let i = 0; i < 60 && at + i < out.length; i++) out[at + i] += (rng() - 0.5) * 0.6 * (1 - i / 60);
      }
      return drive(out, 1.6);
    }, 2),
  // Lead Storm: 15 shots a second; exactly one second, so the loop is seamless.
  stormLoop: (rng) => {
    const out = new Float32Array(samples(1));
    for (let n = 0; n < 15; n++) {
      const shot = gunshot(rng, { s: 0.09, crack: 2300 + rng() * 400, crackDecay: 0.01, body: 1700, bodyDecay: 0.02, thump: 170, thumpDecay: 0.02, k: 1.8 });
      const at = samples(n / 15);
      for (let i = 0; i < shot.length; i++) out[(at + i) % out.length] += shot[i] * (0.85 + rng() * 0.15);
    }
    return out;
  },
  // Minions and structures.
  mg: (rng) => gunshot(rng, { s: 0.2, crack: 1500, crackDecay: 0.015, body: 1300, bodyDecay: 0.04, thump: 150, thumpDecay: 0.04, k: 1.8 }),
  hmg: (rng) => gunshot(rng, { s: 0.32, crack: 1200, crackDecay: 0.02, body: 800, bodyDecay: 0.07, thump: 90, thumpDecay: 0.12, k: 2.2 }),
  flak: (rng) => gunshot(rng, { s: 0.55, crack: 1000, crackDecay: 0.03, body: 500, bodyDecay: 0.14, thump: 70, thumpDecay: 0.2, tail: 0.3, tailFreq: 300, k: 2.8 }),
  rocket: (rng) =>
    drive(
      mix(
        0.8,
        [env(filter(noise(rng, 0.8), 'bp', sweep(350, 1600, 0.5), 1.2), 0.04, 0.35), 1.3],
        [env(osc(0.8, sweep(90, 45, 0.1)), 0.002, 0.08), 0.9],
        [env(filter(noise(rng, 0.8), 'hp', 1500), 0.001, 0.03), 0.6],
      ),
      2,
    ),
  // Camps and bosses.
  rifle: (rng) => gunshot(rng, { s: 0.38, crack: 1300, crackDecay: 0.02, body: 700, bodyDecay: 0.1, thump: 110, thumpDecay: 0.07, tail: 0.15, tailFreq: 600, k: 2 }),
  sniper: (rng) => gunshot(rng, { s: 0.8, crack: 3200, crackDecay: 0.012, body: 1500, bodyDecay: 0.05, thump: 130, thumpDecay: 0.06, tail: 0.45, tailFreq: 520, k: 2.6 }),
  cannon: (rng) => blast(rng, 1.1, { from: 1600, to: 140, decay: 0.38, sub: 55, crackle: 10 }),
  halftrackGun: (rng) => gunshot(rng, { s: 0.24, crack: 1100, crackDecay: 0.018, body: 900, bodyDecay: 0.05, thump: 110, thumpDecay: 0.06, k: 2.2 }),
  turret: (rng) =>
    mix(1, [blast(rng, 1, { from: 1800, to: 200, decay: 0.32, sub: 75, crackle: 8 }), 1], [env(osc(1, 620), 0.002, 0.3), 0.12], [env(osc(1, 931), 0.002, 0.22), 0.08]),
  // Effects.
  explosion: (rng) => blast(rng, 1.5, {}),
  knockout: (rng) =>
    mix(
      0.4,
      [env(osc(0.4, sweep(130, 60, 0.1)), 0.002, 0.08), 1],
      [env(filter(noise(rng, 0.4), 'lp', 400), 0.002, 0.07), 0.8],
      [env(osc(0.4, 1850), 0.001, 0.05), 0.15, 0.09], // the helmet hits the ground
      [env(osc(0.4, 2390), 0.001, 0.03), 0.08, 0.09],
    ),
  collapse: (rng) => {
    const crashes = [];
    for (let n = 0; n < 6; n++) crashes.push([env(filter(noise(rng, 0.6), 'bp', 500 + rng() * 900, 0.9), 0.003, 0.12), 0.7, 0.1 + n * 0.25 + rng() * 0.1]);
    return drive(mix(2.6, [env(filter(noise(rng, 2.6), 'lp', 260, 0.8), 0.05, 1.0), 1.6], [env(osc(2.6, sweep(45, 30, 1.5)), 0.05, 0.9), 0.8], ...crashes), 2);
  },
};

/** Sounds that loop while their source keeps going (Gamma firing, Lead Storm). */
const LOOPS = new Set(['flameLoop', 'stormLoop']);

// ---------------------------------------------------------------- checks, sprite and encoding

function normalise(name, x) {
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < x.length; i++) {
    if (!Number.isFinite(x[i])) throw new Error(`${name}: non-finite sample at ${i}`);
    peak = Math.max(peak, Math.abs(x[i]));
  }
  if (peak < 1e-4) throw new Error(`${name}: silent`);
  for (let i = 0; i < x.length; i++) {
    x[i] *= PEAK / peak;
    sum += x[i] * x[i];
  }
  return Math.sqrt(sum / x.length);
}

function wav(x) {
  const buf = Buffer.alloc(44 + x.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + x.length * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), 44 + i * 2);
  return buf;
}

function encode(name, x, tmp) {
  const src = join(tmp, `${name}.wav`);
  writeFileSync(src, wav(x));
  const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, ...args], { stdio: 'inherit' });
  ff(['-c:a', 'libopus', '-b:a', '64k', `${OUT}/${name}.webm`]);
  ff(['-c:a', 'libmp3lame', '-b:a', '96k', `${OUT}/${name}.mp3`]);
}

function buildSprite() {
  const names = Object.keys(SOUNDS);
  const rendered = names.map((name, i) => {
    const x = edges(SOUNDS[name](mulberry32(1000 + i)), 1, LOOPS.has(name) ? 0 : 15);
    return { name, x, rms: normalise(name, x) };
  });
  const sprite = {};
  let at = LEAD_MS;
  for (const { name, x } of rendered) {
    const ms = Math.round((x.length / SR) * 1000);
    sprite[name] = LOOPS.has(name) ? [at, ms, true] : [at, ms];
    at += ms + GAP_MS;
  }
  const total = new Float32Array(samples(at / 1000));
  for (const { name, x } of rendered) total.set(x, samples(sprite[name][0] / 1000));
  // No two ranges may touch.
  const ranges = Object.values(sprite).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++) if (ranges[i][0] < ranges[i - 1][0] + ranges[i - 1][1] + GAP_MS / 2) throw new Error('sprite ranges overlap');
  for (const { name, x, rms } of rendered) console.log(`${name.padEnd(14)} ${(x.length / SR).toFixed(2)} s  rms ${(20 * Math.log10(rms)).toFixed(1)} dBFS`);
  return { total, sprite };
}

const tmp = mkdtempSync(join(tmpdir(), 'warfront-audio-'));
try {
  const { total, sprite } = buildSprite();
  encode('sfx', total, tmp);
  writeFileSync(`${OUT}/sfx.json`, JSON.stringify(sprite, null, 2) + '\n');
  console.log(`sfx: ${Object.keys(sprite).length} sounds, ${(total.length / SR).toFixed(1)} s`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
