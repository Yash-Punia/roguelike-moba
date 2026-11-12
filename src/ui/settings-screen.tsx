import { Segments } from './segments';
import { settings, updateSettings, type Settings } from './settings';

type Toggle = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];
type Slider = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];

function OnOff({ label, field, note }: { label: string; field: Toggle; note?: string }) {
  return (
    <Segments
      label={note ? `${label} (${note})` : label}
      value={settings.value[field] ? 'on' : 'off'}
      onPick={(v) => updateSettings({ [field]: v === 'on' })}
      options={[
        { value: 'off', text: 'Off' },
        { value: 'on', text: 'On' },
      ]}
    />
  );
}

function Range({ label, field, min = 0 }: { label: string; field: Slider; min?: number }) {
  const v = settings.value[field];
  return (
    <label class="menu-field menu-slider">
      <span>
        {label} <b>{v}%</b>
      </span>
      <input type="range" min={min} max={100} step={5} value={v} onInput={(e) => updateSettings({ [field]: Number(e.currentTarget.value) })} />
    </label>
  );
}

/**
 * The Settings screen (TDD §10, D-111), from the title and the pause menu. Changes save at once
 * and apply live, except colour-blind mode, which rebuilds every model and so starts with the next match.
 */
export function SettingsScreen({ onBack }: { onBack: () => void }) {
  return (
    <div class="menu menu-settings" onPointerDown={(e) => e.stopPropagation()}>
      <h2>Settings</h2>
      <Range label="Master volume" field="masterVolume" />
      <Range label="Effects volume" field="effectsVolume" />
      <Range label="Background volume" field="backgroundVolume" />
      <OnOff label="Left-handed" field="leftHanded" />
      <OnOff label="Hold to cast Ultimate" field="holdToCast" />
      <Range label="Joystick opacity" field="joystickOpacity" min={20} />
      <OnOff label="Reduced effects" field="reducedEffects" />
      <OnOff label="Colour-blind mode" field="colourBlind" note="next match" />
      <OnOff label="Show FPS" field="showFps" />
      <div class="menu-actions">
        <button type="button" class="menu-secondary" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
