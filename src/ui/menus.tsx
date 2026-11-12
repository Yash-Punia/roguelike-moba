import { render } from 'preact';
import { useSignal } from '@preact/signals';
import { maps, rawConfig } from '../data/load';
import type { Difficulty } from '../data/schema';
import { Segments } from './segments';
import { SettingsScreen } from './settings-screen';

type Lanes = 2 | 3;

/** What the match-setup screen picks (TDD §10). */
export interface Choices {
  champ: string;
  team: 'blue' | 'red';
  lanes: Lanes;
  /** A lane id on that map, or 'auto'. */
  lane: string;
  size: number;
  difficulty: Difficulty;
  /** Digits, or '' for a random match. */
  seed: string;
}

const MAP_NAMES: Record<Lanes, string> = { 3: 'The Front', 2: 'The Bridgehead' };
const SIZES = [2, 3, 4, 5];
const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];
const title = (s: string) => s[0]!.toUpperCase() + s.slice(1);

export const laneIds = (lanes: Lanes) => (maps[lanes].lanes ?? []).map((l) => l.id);

export function defaultChoices(): Choices {
  return { champ: rawConfig.champions[0]!.id, team: 'blue', lanes: rawConfig.match.lanes === 2 ? 2 : 3, lane: 'auto', size: rawConfig.match.teamSize, difficulty: 'normal', seed: '' };
}

/** A new map: a lane that map doesn't have goes back to Auto. */
export function withMap(c: Choices, lanes: Lanes): Choices {
  return { ...c, lanes, lane: laneIds(lanes).includes(c.lane) ? c.lane : 'auto' };
}

/** The query string that starts this match (D-091): a match is configured by its URL, so each is a fresh page load. */
export function matchUrl(c: Choices): string {
  const q = new URLSearchParams({ champ: c.champ, team: c.team, lanes: String(c.lanes), size: String(c.size), difficulty: c.difficulty });
  if (laneIds(c.lanes).includes(c.lane)) q.set('lane', c.lane);
  const seed = c.seed.trim();
  if (/^\d+$/.test(seed)) q.set('seed', seed);
  return `?${q}`;
}

function Title({ onPlay, onSettings }: { onPlay: () => void; onSettings: () => void }) {
  return (
    <div class="menu menu-title">
      <div class="menu-hazard" />
      <h1>WARFRONT</h1>
      <p>Hold the line. Break theirs.</p>
      <div class="menu-hazard" />
      <div class="menu-actions">
        <button type="button" class="menu-primary" onClick={onPlay}>
          Play
        </button>
        <button type="button" class="menu-secondary" onClick={() => (location.search = 'quick')}>
          Quick match
        </button>
        <button type="button" class="menu-secondary" onClick={onSettings}>
          Settings
        </button>
      </div>
    </div>
  );
}

function Setup({ onBack }: { onBack: () => void }) {
  const choices = useSignal(defaultChoices());
  const c = choices.value;
  const set = (next: Partial<Choices>) => (choices.value = { ...c, ...next });
  return (
    <div class="menu menu-setup">
      <h2>Match setup</h2>
      <fieldset class="menu-field">
        <legend>Champion</legend>
        <div class="menu-champions">
          {rawConfig.champions.map((ch) => (
            <button type="button" key={ch.id} class={ch.id === c.champ ? 'on' : ''} aria-pressed={ch.id === c.champ} onClick={() => set({ champ: ch.id })}>
              <strong>{ch.name}</strong>
              <span>{ch.title}</span>
              <em>{ch.role}</em>
            </button>
          ))}
        </div>
      </fieldset>
      <Segments label="Team" value={c.team} onPick={(team) => set({ team })} options={[{ value: 'blue', text: 'Blue' }, { value: 'red', text: 'Red' }]} />
      <Segments<Lanes> label="Map" value={c.lanes} onPick={(lanes) => (choices.value = withMap(c, lanes))} options={[3, 2].map((n) => ({ value: n as Lanes, text: MAP_NAMES[n as Lanes] }))} />
      <Segments label="Lane" value={c.lane} onPick={(lane) => set({ lane })} options={[{ value: 'auto', text: 'Auto' }, ...laneIds(c.lanes).map((id) => ({ value: id, text: title(id) }))]} />
      <Segments label="Team size" value={c.size} onPick={(size) => set({ size })} options={SIZES.map((n) => ({ value: n, text: `${n}v${n}` }))} />
      <Segments label="Bot difficulty" value={c.difficulty} onPick={(difficulty) => set({ difficulty })} options={DIFFICULTIES.map((d) => ({ value: d, text: title(d) }))} />
      <label class="menu-field menu-seed">
        <span>Seed (optional)</span>
        <input type="text" inputMode="numeric" placeholder="Random" value={c.seed} onInput={(e) => set({ seed: e.currentTarget.value })} />
      </label>
      <div class="menu-actions">
        <button type="button" class="menu-primary" onClick={() => (location.search = matchUrl(c))}>
          Deploy
        </button>
        <button type="button" class="menu-secondary" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

function Menus() {
  const screen = useSignal<'title' | 'setup' | 'settings'>('title');
  const back = () => (screen.value = 'title');
  if (screen.value === 'setup') return <Setup onBack={back} />;
  if (screen.value === 'settings') return <SettingsScreen onBack={back} />;
  return <Title onPlay={() => (screen.value = 'setup')} onSettings={() => (screen.value = 'settings')} />;
}

/** The title and match-setup screens (TDD §10), shown on a bare URL. */
export function mountMenus(frame: HTMLElement) {
  render(<Menus />, frame);
}
