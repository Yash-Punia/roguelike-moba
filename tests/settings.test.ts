import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../src/ui/settings';

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
