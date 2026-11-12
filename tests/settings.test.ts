import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../src/ui/settings';
import { parseConfig, rawConfig } from '../src/data/load';
import { addTrauma, decayTrauma, shakeOffset } from '../src/render/camera';
import { Particles } from '../src/render/particles';

const config = parseConfig(rawConfig);
const cam = { ...config.camera, shakeAmplitude: 0.4, shakeDecay: 2, shakeFalloff: 20, shakePerRadius: 0.1, shakeFrequency: 15 };

describe('reduced effects and camera shake (D-112)', () => {
  it('bigger and nearer blasts shake more; far ones not at all; trauma caps at 1', () => {
    expect(addTrauma(0, 4, 0, cam)).toBeCloseTo(0.4);
    expect(addTrauma(0, 2, 0, cam)).toBeCloseTo(0.2);
    expect(addTrauma(0, 4, 10, cam)).toBeCloseTo(0.2);
    expect(addTrauma(0, 4, 25, cam)).toBe(0);
    expect(addTrauma(0.9, 9, 0, cam)).toBe(1);
  });

  it('decays to rest, and the offset grows with trauma squared', () => {
    expect(decayTrauma(0.5, 0.1, cam)).toBeCloseTo(0.3);
    expect(decayTrauma(0.5, 1, cam)).toBe(0);
    const out = { x: 0, z: 0 };
    expect(shakeOffset(0, 0.3, cam, out)).toEqual({ x: 0, z: 0 });
    let peak = 0;
    for (let t = 0; t < 2; t += 0.01) peak = Math.max(peak, Math.abs(shakeOffset(1, t, cam, out).x));
    expect(peak).toBeGreaterThan(0.3);
    expect(peak).toBeLessThanOrEqual(0.4);
    let half = 0;
    for (let t = 0; t < 2; t += 0.01) half = Math.max(half, Math.abs(shakeOffset(0.5, t, cam, out).x));
    expect(half).toBeCloseTo(peak / 4, 2);
  });

  it('reduced effects halve the particle counts but keep single bursts', () => {
    const vfx = { ...config.vfx, density: 1, presets: { many: [{ ...config.vfx.presets['death']![0]!, count: 10, life: 1 }], one: [{ ...config.vfx.presets['death']![0]!, count: 1, life: 1 }] } };
    const p = new Particles(() => 0, vfx);
    p.update(0);
    p.setReduced(true);
    p.emit('many', 0, 0);
    p.emit('one', 0, 0);
    p.update(16);
    expect(p.live).toBe(6);
  });
});

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
};

describe('settings (D-111)', () => {
  it('fall back to the defaults when nothing is saved, storage is missing or it throws', () => {
    expect(loadSettings(memory())).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadSettings(broken)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(DEFAULT_SETTINGS, broken)).not.toThrow();
  });

  it('round-trip, and ignore garbage, wrong types and out-of-range values', () => {
    const store = memory();
    saveSettings({ ...DEFAULT_SETTINGS, leftHanded: true, masterVolume: 40 }, store);
    expect(loadSettings(store)).toEqual({ ...DEFAULT_SETTINGS, leftHanded: true, masterVolume: 40 });
    store.setItem('warfront.settings.v1', '{not json');
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
    store.setItem('warfront.settings.v1', JSON.stringify({ showFps: 'yes', effectsVolume: 250, joystickOpacity: -5, unknown: 1 }));
    expect(loadSettings(store)).toEqual({ ...DEFAULT_SETTINGS, effectsVolume: 100, joystickOpacity: 0 });
  });
});
