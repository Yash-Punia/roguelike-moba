import GUI from 'lil-gui';
import { configFiles, parseConfig } from '../data/load';
import type { Config, RawConfig } from '../data/schema';
import type { Entity } from '../sim/ecs';
import type { Sim } from '../sim/sim';
import { Stat } from '../sim/stats';

export interface DebugHooks {
  raw: RawConfig;
  apply(config: Config): void;
  loop: { paused: boolean; timeScale: number };
  stats: { simMs: number };
  frame: HTMLElement;
  sim: Sim;
  /** The local player's champion, for the modifier cheats. */
  localEntity: Entity | undefined;
}

/**
 * Dev tuning panel (TDD §11). Every value in the raw JSON configs is editable; each edit is
 * re-validated and applied to the running match. F1 or a three-finger tap toggles it.
 */
export function createDebugPanel({ raw, apply, loop, stats, frame, sim, localEntity }: DebugHooks) {
  const gui = new GUI({ title: 'Warfront debug' });
  gui.hide();
  let visible = false;
  const toggle = () => {
    visible = !visible;
    gui.show(visible);
  };
  addEventListener('keydown', (e) => {
    if (e.code !== 'F1') return;
    e.preventDefault();
    toggle();
  });
  addEventListener('touchstart', (e) => {
    if (e.touches.length === 3) toggle();
  });

  const match = gui.addFolder('Match');
  match.add(loop, 'paused');
  match.add(loop, 'timeScale', 0.25, 4, 0.25);

  if (localEntity !== undefined) addChampionCheats(gui, sim, localEntity);
  const waves = gui.addFolder('Waves').close();
  waves.add({ spawn: () => sim.debug.spawnWave() }, 'spawn').name('Spawn wave now');

  const edits = structuredClone(raw);
  const onChange = () => {
    try {
      apply(parseConfig(edits));
    } catch (err) {
      console.error(err);
    }
  };
  for (const key of Object.keys(edits) as (keyof RawConfig)[]) {
    const folder = gui.addFolder(configFiles[key]).close();
    addFields(folder, edits[key] as Record<string, unknown>, onChange);
    folder.add({ export: () => download(configFiles[key], edits[key]) }, 'export').name(`Export ${configFiles[key]}`);
  }

  createFpsOverlay(frame, stats);
}

function addFields(folder: GUI, obj: Record<string, unknown>, onChange: () => void) {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
      folder.add(obj, k).onFinishChange(onChange);
    } else if (v && typeof v === 'object') {
      const label = (v as { id?: string }).id ?? k;
      addFields(folder.addFolder(label).close(), v as Record<string, unknown>, onChange);
    }
  }
}

/**
 * Damage-pipeline modifiers on the local champion (D-031), standing in for powers until the
 * draft exists. Percentages as in the GDD (20 = +20%); they write through `sim.debug`.
 */
function addChampionCheats(gui: GUI, sim: Sim, e: Entity) {
  const folder = gui.addFolder('Local champion').close();
  const mods = { damagePct: 0, damageTakenPct: 0, vsChampionsPct: 0, vsStructuresPct: 0, critChancePct: 0, shield: 300 };
  const pctStat = (key: keyof typeof mods, which: Stat, name: string) =>
    folder.add(mods, key, -90, 200, 1).name(name).onChange((v: number) => sim.debug.setStatPct(e, which, v / 100));
  pctStat('damagePct', Stat.Damage, 'damage %');
  pctStat('damageTakenPct', Stat.DamageTaken, 'damage taken %');
  pctStat('vsChampionsPct', Stat.DamageVsChampions, 'vs champions %');
  pctStat('vsStructuresPct', Stat.DamageVsStructures, 'vs structures %');
  // Crit damage is combat.damage.critMultiplier, in the combat.json folder.
  folder
    .add(mods, 'critChancePct', 0, 100, 1)
    .name('crit chance %')
    .onChange((v: number) => sim.debug.setCritChance(e, v / 100));
  folder.add(mods, 'shield', 0, 1000, 50).name('shield amount');
  folder.add({ give: () => sim.debug.addShield(e, mods.shield) }, 'give').name('Give shield');
  folder.add({ arm: () => sim.debug.armLethalSave(e) }, 'arm').name('Arm lethal save');
  folder.add({ fill: () => sim.debug.fillUltimate(e) }, 'fill').name('Fill Ultimate');
  folder.add({ kill: () => sim.debug.kill(e) }, 'kill').name('Kill me');
  // The `?dummy` enemy is player 1.
  const killDummy = () => {
    const d = sim.entityOf(1);
    if (d !== undefined) sim.debug.kill(d);
  };
  folder.add({ killDummy }, 'killDummy').name('Kill dummy');
}

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

function createFpsOverlay(frame: HTMLElement, stats: { simMs: number }) {
  const el = document.createElement('div');
  el.className = 'perf-overlay';
  frame.appendChild(el);
  let frames = 0;
  let worst = 0;
  let last = performance.now();
  let windowStart = last;
  const tick = (now: number) => {
    frames++;
    worst = Math.max(worst, now - last);
    last = now;
    if (now - windowStart >= 500) {
      const fps = (frames * 1000) / (now - windowStart);
      el.textContent = `${fps.toFixed(0)} fps · worst ${worst.toFixed(1)} ms · sim ${stats.simMs.toFixed(2)} ms`;
      frames = 0;
      worst = 0;
      windowStart = now;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
