import { signal } from '@preact/signals';

/** The player's settings (TDD §10, D-111). Percentages are 0–100. */
export interface Settings {
  /** Mirror the Ultimate button and the vitals for the left thumb (TDD §8). */
  leftHanded: boolean;
  /** The Ultimate fires only after a hold on its button (TDD §8: 300 ms). */
  holdToCast: boolean;
  joystickOpacity: number;
  /** Half the particles and no camera shake (TDD §9). */
  reducedEffects: boolean;
  /** Orange vs Blue and shape markers under units (GDD §10); applies from the next match. */
  colourBlind: boolean;
  masterVolume: number;
  effectsVolume: number;
  backgroundVolume: number;
  showFps: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  leftHanded: false,
  holdToCast: false,
  joystickOpacity: 100,
  reducedEffects: false,
  colourBlind: false,
  masterVolume: 100,
  effectsVolume: 100,
  backgroundVolume: 100,
  showFps: false,
};

const KEY = 'warfront.settings.v1';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** The browser's storage, if this page may use it (private windows and blocked site data throw). */
function browserStorage(): Store | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

/** Saved settings over the defaults; anything missing, of the wrong type or unreadable falls back. */
export function loadSettings(storage: Store | undefined = browserStorage()): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  let saved: unknown;
  try {
    saved = JSON.parse(storage?.getItem(KEY) ?? 'null');
  } catch {
    return out;
  }
  if (!saved || typeof saved !== 'object') return out;
  const record = out as unknown as Record<string, unknown>;
  for (const [key, def] of Object.entries(DEFAULT_SETTINGS)) {
    const v = (saved as Record<string, unknown>)[key];
    if (typeof def === 'boolean' && typeof v === 'boolean') record[key] = v;
    if (typeof def === 'number' && typeof v === 'number' && Number.isFinite(v)) record[key] = Math.max(0, Math.min(100, v));
  }
  return out;
}

export function saveSettings(s: Settings, storage: Store | undefined = browserStorage()) {
  try {
    storage?.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage full or blocked: the settings still hold for this page.
  }
}

/** The live settings: the HUD, input, audio and effects follow it. */
export const settings = signal<Settings>(loadSettings());

export function updateSettings(patch: Partial<Settings>) {
  settings.value = { ...settings.value, ...patch };
  saveSettings(settings.value);
}
