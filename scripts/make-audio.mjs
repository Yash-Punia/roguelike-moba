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

/** Equal-tempered pitch of MIDI note `n` (Hz). */
const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);

/** A brass note: two detuned saws through a low-pass that opens with the attack, with a late vibrato. */
function brass(f, s, { attack = 0.03, decay = 0.6, bright = 3200, hold = 1 } = {}) {
  const vib = (t) => f * (1 + (t > 0.2 ? 0.006 * Math.sin(2 * Math.PI * 5.5 * t) : 0));
  const tone = mix(s, [osc(s, vib, 'saw'), 0.5], [osc(s, (t) => vib(t) * 1.004, 'saw'), 0.5]);
  filter(tone, 'lp', (t) => 500 + (bright - 500) * Math.min(1, t / (attack * 3)) * (0.7 + 0.3 * Math.exp(-t / 0.3)), 1.1);
  for (let i = 0; i < tone.length; i++) {
    const t = i / SR;
    tone[i] *= (t < attack ? t / attack : 1) * (t < hold ? 1 : Math.exp(-(t - hold) / decay));
  }
  return tone;
}

/** A struck bell: a sine with an inharmonic partial, both ringing out. */
const bell = (f, s, decay = 0.5) => mix(s, [env(osc(s, f), 0.002, decay), 1], [env(osc(s, f * 2.76), 0.002, decay * 0.4), 0.35], [env(osc(s, f * 5.4), 0.001, decay * 0.15), 0.15]);

/** Two low-pass passes: far-off sound loses its top end steeply. */
const muffle = (x, cutoff) => filter(filter(x, 'lp', cutoff, 0.6), 'lp', cutoff, 0.6);

const SOUNDS = {
  // Grim and quick (user, D-110): short tails, darker cracks, no fanfares.
  // Champions: each must still be told apart by ear (GDD §10).
  revolver: (rng) => gunshot(rng, { s: 0.38, crack: 1500, crackDecay: 0.02, body: 800, bodyDecay: 0.07, thump: 110, thumpDecay: 0.07, tail: 0.12, tailFreq: 380, k: 2.3 }),
  smg: (rng) => gunshot(rng, { s: 0.12, crack: 2200, crackDecay: 0.01, body: 1800, bodyDecay: 0.02, thump: 180, thumpDecay: 0.02, k: 1.8 }),
  // Gamma's flamethrower: a breathy roar with a slow flutter and crackle.
  flameLoop: (rng) =>
    seamless((s) => {
      const roar = filter(filter(noise(rng, s), 'lp', 750, 0.6), 'hp', 110);
      const hiss = filter(noise(rng, s), 'bp', 2000, 0.8);
      const out = mix(s, [roar, 1.4], [hiss, 0.2]);
      for (let i = 0; i < out.length; i++) out[i] *= 0.8 + 0.2 * Math.sin((2 * Math.PI * 6 * i) / SR) * Math.sin((2 * Math.PI * 1.3 * i) / SR + 1);
      for (let n = 0; n < s * 25; n++) {
        const at = Math.floor(rng() * out.length);
        for (let i = 0; i < 60 && at + i < out.length; i++) out[at + i] += (rng() - 0.5) * 0.5 * (1 - i / 60);
      }
      return drive(out, 1.6);
    }, 2),
  // Lead Storm: 15 shots a second; exactly one second, so the loop is seamless.
  stormLoop: (rng) => {
    const out = new Float32Array(samples(1));
    for (let n = 0; n < 15; n++) {
      const shot = gunshot(rng, { s: 0.08, crack: 1900 + rng() * 300, crackDecay: 0.009, body: 1500, bodyDecay: 0.018, thump: 160, thumpDecay: 0.02, k: 1.8 });
      const at = samples(n / 15);
      for (let i = 0; i < shot.length; i++) out[(at + i) % out.length] += shot[i] * (0.85 + rng() * 0.15);
    }
    return out;
  },
  // Minions and structures.
  mg: (rng) => gunshot(rng, { s: 0.16, crack: 1300, crackDecay: 0.012, body: 1100, bodyDecay: 0.03, thump: 140, thumpDecay: 0.035, k: 1.8 }),
  hmg: (rng) => gunshot(rng, { s: 0.26, crack: 1000, crackDecay: 0.018, body: 700, bodyDecay: 0.06, thump: 85, thumpDecay: 0.1, k: 2.2 }),
  flak: (rng) => gunshot(rng, { s: 0.4, crack: 900, crackDecay: 0.025, body: 450, bodyDecay: 0.1, thump: 65, thumpDecay: 0.14, tail: 0.15, tailFreq: 260, k: 2.6 }),
  rocket: (rng) =>
    drive(
      mix(
        0.5,
        [env(filter(noise(rng, 0.5), 'bp', sweep(300, 1200, 0.3), 1.2), 0.03, 0.2), 1.3],
        [env(osc(0.5, sweep(85, 42, 0.1)), 0.002, 0.07), 0.9],
        [env(filter(noise(rng, 0.5), 'hp', 1300), 0.001, 0.025), 0.5],
      ),
      2,
    ),
  // Camps and bosses.
  rifle: (rng) => gunshot(rng, { s: 0.3, crack: 1100, crackDecay: 0.018, body: 650, bodyDecay: 0.08, thump: 100, thumpDecay: 0.06, tail: 0.08, tailFreq: 520, k: 2 }),
  sniper: (rng) => gunshot(rng, { s: 0.5, crack: 2600, crackDecay: 0.01, body: 1300, bodyDecay: 0.04, thump: 120, thumpDecay: 0.05, tail: 0.2, tailFreq: 480, k: 2.4 }),
  cannon: (rng) => blast(rng, 0.8, { from: 1200, to: 120, decay: 0.28, sub: 52, crackle: 6 }),
  halftrackGun: (rng) => gunshot(rng, { s: 0.2, crack: 950, crackDecay: 0.016, body: 800, bodyDecay: 0.045, thump: 105, thumpDecay: 0.05, k: 2.2 }),
  turret: (rng) => mix(0.7, [blast(rng, 0.7, { from: 1400, to: 180, decay: 0.24, sub: 70, crackle: 5 }), 1], [env(osc(0.7, 620), 0.002, 0.18), 0.08]),
  // Effects.
  explosion: (rng) => blast(rng, 1, { from: 1800, to: 150, decay: 0.32, sub: 58, crackle: 18 }),
  knockout: (rng) =>
    mix(
      0.3,
      [env(osc(0.3, sweep(120, 55, 0.1)), 0.002, 0.07), 1],
      [env(filter(noise(rng, 0.3), 'lp', 350), 0.002, 0.06), 0.8],
      [env(osc(0.3, 1700), 0.001, 0.04), 0.07, 0.08], // the helmet hits the ground
    ),
  collapse: (rng) => {
    const crashes = [];
    for (let n = 0; n < 4; n++) crashes.push([env(filter(noise(rng, 0.4), 'bp', 400 + rng() * 700, 0.9), 0.003, 0.1), 0.6, 0.05 + n * 0.18 + rng() * 0.08]);
    return drive(mix(1.6, [env(filter(noise(rng, 1.6), 'lp', 240, 0.8), 0.04, 0.6), 1.6], [env(osc(1.6, sweep(42, 30, 1)), 0.04, 0.55), 0.8], ...crashes), 2);
  },
  // The local player's cues (GDD §10): quick, muted, not positional.
  levelUp: () => muffle(mix(0.32, [bell(hz(74), 0.32, 0.09), 0.6], [bell(hz(81), 0.32, 0.1), 0.5, 0.07]), 2600),
  // A rifle bolt worked back and forward, and a low ring: the Ultimate is loaded.
  ultReady: (rng) =>
    mix(
      0.42,
      [env(filter(noise(rng, 0.42), 'bp', 2800, 2), 0.001, 0.012), 0.7],
      [env(filter(noise(rng, 0.42), 'bp', 2200, 2), 0.001, 0.015), 0.8, 0.09],
      [muffle(bell(hz(62), 0.42, 0.14), 1800), 0.5, 0.09],
    ),
  // A short rising wail: an enemy Ultimate is aimed at you.
  ultSiren: () => {
    const s = 0.6;
    const tone = osc(s, (t) => 280 * Math.pow(2.3, Math.min(1, t / 0.45)), 'square');
    filter(tone, 'lp', 1100, 0.8);
    for (let i = 0; i < tone.length; i++) {
      const t = i / SR;
      tone[i] *= Math.min(1, t / 0.03) * (t < 0.45 ? 1 : Math.exp(-(t - 0.45) / 0.05));
    }
    return drive(tone, 1.3);
  },
  cardDeal: (rng) => env(filter(noise(rng, 0.12), 'bp', sweep(1500, 3800, 0.1), 1.4), 0.015, 0.035),
  cardPick: (rng) => mix(0.12, [env(osc(0.12, sweep(180, 90, 0.04)), 0.001, 0.03), 1], [env(filter(noise(rng, 0.12), 'bp', 2000, 1.2), 0.001, 0.012), 0.4]),
  respawn: (rng) => mix(0.35, [env(filter(noise(rng, 0.35), 'hp', 2200), 0.001, 0.015), 0.5], [env(filter(noise(rng, 0.35), 'lp', sweep(2500, 500, 0.3)), 0.015, 0.12), 1]),
  // A far-off air-raid siren winding up.
  suddenDeath: () => {
    const s = 1.3;
    const wail = mix(s, [osc(s, (t) => 210 + 190 * Math.min(1, t / 0.9), 'saw'), 0.5], [osc(s, (t) => 211 + 191 * Math.min(1, t / 0.9)), 0.5]);
    muffle(wail, 800);
    for (let i = 0; i < wail.length; i++) {
      const t = i / SR;
      wail[i] *= Math.min(1, t / 0.35) * (t < 1 ? 1 : Math.exp(-(t - 1) / 0.12));
    }
    return wail;
  },
  // The result: a dark horn with a distant thump, no fanfare.
  victory: (rng) => mix(1, [brass(hz(55), 1, { attack: 0.12, hold: 0.55, decay: 0.2, bright: 900 }), 0.5], [brass(hz(62), 1, { attack: 0.12, hold: 0.55, decay: 0.2, bright: 900 }), 0.4], [muffle(blast(rng, 1, { from: 600, to: 90, decay: 0.3, sub: 45, crackle: 0 }), 500), 0.5]),
  defeat: (rng) => mix(1.1, [brass(hz(52), 0.5, { attack: 0.08, hold: 0.3, decay: 0.15, bright: 700 }), 0.5], [brass(hz(47), 0.7, { attack: 0.08, hold: 0.35, decay: 0.25, bright: 600 }), 0.5, 0.4], [muffle(blast(rng, 1.1, { from: 500, to: 80, decay: 0.35, sub: 40, crackle: 0 }), 400), 0.45, 0.4]),
};

// ---------------------------------------------------------------- background (user, D-110: a battle in the distance)

/** Both loops are this long, so Sudden Death can take over at the same position. */
const LOOP_S = 32;

/** Adds `x` into `out` at `at` seconds, wrapping round the end, so the loop has no seam. */
function place(out, x, at, gain) {
  const o = samples(at);
  for (let i = 0; i < x.length; i++) out[(o + i) % out.length] += x[i] * gain;
}

/** A gun far away: a burst of `shots` muffled cracks at `rate` per second. */
function distantBurst(rng, shots, rate, cutoff) {
  const out = new Float32Array(samples(shots / rate + 0.3));
  for (let n = 0; n < shots; n++) place(out, gunshot(rng, { s: 0.2, crack: 1300, crackDecay: 0.012, body: 900, bodyDecay: 0.04, thump: 120, thumpDecay: 0.04, k: 1.6 }), n / rate + rng() * 0.015, 0.7 + rng() * 0.3);
  return muffle(out, cutoff);
}

/**
 * A battle somewhere past the map edge, kept low and muffled so the fight in front of you reads
 * first: wind and a low rumble, artillery thudding in, machine guns rattling far off, single
 * rifle cracks. `intensity` (Sudden Death) brings it closer and busier, with a low drone.
 */
function battle(rng, { booms, bursts, cracks, cutoff, drone }) {
  const s = LOOP_S;
  // Wind and rumble; the gusts complete whole cycles in the loop, so it stays seamless.
  const bed = seamless((len) => {
    const rumble = muffle(noise(rng, len), 180);
    const wind = filter(noise(rng, len), 'bp', 420, 0.5);
    for (let i = 0; i < wind.length; i++) wind[i] *= 0.6 + 0.4 * Math.sin((2 * Math.PI * 2 * i) / (s * SR)) * Math.sin((2 * Math.PI * 5 * i) / (s * SR) + 1);
    return mix(len, [rumble, 1.6], [wind, 0.35]);
  }, s, 0.5);
  const out = Float32Array.from(bed);
  const at = (n, k) => (s * (n + 0.2 + rng() * 0.6)) / k; // spread out, never evenly
  for (let n = 0; n < booms; n++) place(out, muffle(blast(rng, 2.2, { from: 900, to: 70, decay: 0.75, sub: 38, crackle: 0 }), cutoff * 0.45), at(n, booms), 0.35 + rng() * 0.5);
  for (let n = 0; n < bursts; n++) place(out, distantBurst(rng, 4 + Math.floor(rng() * 8), 9 + rng() * 3, cutoff), at(n, bursts), 0.12 + rng() * 0.18);
  for (let n = 0; n < cracks; n++) place(out, muffle(gunshot(rng, { s: 0.4, crack: 1500, crackDecay: 0.015, body: 700, bodyDecay: 0.08, thump: 100, thumpDecay: 0.06, tail: 0.25, tailFreq: 450, k: 2 }), cutoff), at(n, cracks), 0.12 + rng() * 0.12);
  if (drone) {
    // A low swell under Sudden Death: two sines a fifth apart, breathing twice a loop.
    for (let i = 0; i < out.length; i++) {
      const t = i / SR;
      out[i] += drone * (0.6 + 0.4 * Math.sin((2 * Math.PI * 2 * t) / s)) * (Math.sin(2 * Math.PI * 41 * t) + 0.5 * Math.sin(2 * Math.PI * 61.5 * t));
    }
  }
  return out;
}

const MUSIC = {
  'ambience-battle': (rng) => battle(rng, { booms: 9, bursts: 6, cracks: 7, cutoff: 1100, drone: 0 }),
  'ambience-sudden': (rng) => battle(rng, { booms: 20, bursts: 13, cracks: 12, cutoff: 1500, drone: 0.05 }),
};
/** Loudness of each loop (RMS, dBFS): well under the effects, Sudden Death a little closer. */
const MUSIC_RMS_DB = { 'ambience-battle': -30, 'ambience-sudden': -26 };

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

/** Scales `x` to an RMS of `db` dBFS, or less if that would clip. */
function toRms(name, x, db) {
  let sum = 0;
  for (let i = 0; i < x.length; i++) {
    if (!Number.isFinite(x[i])) throw new Error(`${name}: non-finite sample at ${i}`);
    sum += x[i] * x[i];
  }
  const rms = Math.sqrt(sum / x.length);
  if (rms < 1e-6) throw new Error(`${name}: silent`);
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  // The target loudness, unless that would clip: then the peak limit wins (and the log shows it).
  const k = Math.min(Math.pow(10, db / 20) / rms, PEAK / peak);
  for (let i = 0; i < x.length; i++) x[i] *= k;
  return rms * k;
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

function encode(name, x, tmp, opus = '64k', mp3 = '96k') {
  const src = join(tmp, `${name}.wav`);
  writeFileSync(src, wav(x));
  // bitexact: no random container ids or version tags, so the same sound gives the same file.
  const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-fflags', '+bitexact', '-flags:a', '+bitexact', ...args], { stdio: 'inherit' });
  ff(['-c:a', 'libopus', '-b:a', opus, `${OUT}/${name}.webm`]);
  ff(['-c:a', 'libmp3lame', '-b:a', mp3, `${OUT}/${name}.mp3`]);
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
  for (const [i, [name, make]] of Object.entries(MUSIC).entries()) {
    const x = make(mulberry32(5000 + i));
    const rms = MUSIC_RMS_DB[name] === undefined ? normalise(name, x) : toRms(name, x, MUSIC_RMS_DB[name]);
    encode(name, x, tmp, '48k', '64k'); // muffled ambience: little top end to spend bits on
    console.log(`${name}: ${(x.length / SR).toFixed(1)} s loop, rms ${(20 * Math.log10(rms)).toFixed(1)} dBFS`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
