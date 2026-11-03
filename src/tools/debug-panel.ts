import GUI from 'lil-gui';
import { configFiles, parseConfig } from '../data/load';
import type { Config, RawConfig } from '../data/schema';
import type { Entity } from '../sim/ecs';
import { Team, type Sim } from '../sim/sim';
import { Stat } from '../sim/stats';

export interface DebugHooks {
  raw: RawConfig;
  apply(config: Config): void;
  loop: { paused: boolean; timeScale: number };
  stats: { simMs: number; renderMs: number };
  /** For draw-call and triangle counts on the perf overlay. */
  renderInfo?: { render: { calls: number; triangles: number } };
  frame: HTMLElement;
  sim: Sim;
  /** The local player's champion, for the modifier cheats. */
  localEntity: Entity | undefined;
  /** The bot opponent, if any: its mode, mood and personality are shown read-only. */
  bot?: { readonly goal: string; readonly confidence: number; readonly personality: object; readonly desires: object };
  /** This match's seed (replay with ?seed=N). */
  seed?: number;
}

/**
 * Dev tuning panel (TDD §11). Every value in the raw JSON configs is editable; each edit is
 * re-validated and applied to the running match. F1 or a three-finger tap toggles it.
 */
export function createDebugPanel({ raw, apply, loop, stats, frame, sim, localEntity, bot, seed, renderInfo }: DebugHooks) {
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
  if (seed !== undefined) match.add({ seed }, 'seed').name('seed (?seed=N)').disable();
  // Team size is fixed once a match starts (D-048): picking one reloads with `?size=N`.
  const url = new URL(location.href);
  const size = { teamSize: Number(url.searchParams.get('size')) || raw.match.teamSize };
  match.add(size, 'teamSize', [2, 3, 4, 5]).name('team size (?size=N)').onChange((n: number) => {
    url.searchParams.set('size', String(n));
    location.assign(url);
  });
  if (bot) {
    const botFolder = gui.addFolder('Bot');
    botFolder.add(bot, 'goal').name('mode').disable().listen();
    botFolder.add(bot, 'confidence', -1, 1).name('confidence').disable().listen();
    const desires = botFolder.addFolder('desires').close();
    const d = bot.desires as Record<string, number>;
    for (const k of Object.keys(d)) desires.add(d, k, 0, 1.2).disable().listen();
    const traits = botFolder.addFolder('personality').close();
    for (const [k, v] of Object.entries(bot.personality)) traits.add({ [k]: Math.round((v as number) * 100) / 100 }, k).disable();
  }
  const structuresFolder = gui.addFolder('Structures').close();
  const killEnemySub = () => {
    const local = localEntity === undefined ? undefined : sim.stores.teams.get(localEntity);
    const ids = sim.stores.structures.ids;
    for (let i = 0; i < ids.length; i++) {
      const st = sim.stores.structures.data[i]!;
      if (st.kind === 'subBase' && st.lane === 'centre' && sim.stores.teams.get(ids[i]!) !== local) sim.debug.kill(ids[i]!);
    }
  };
  structuresFolder.add({ killEnemySub }, 'killEnemySub').name('Destroy enemy centre Sub-base');
  const localTeam = localEntity === undefined ? Team.Blue : (sim.stores.teams.get(localEntity) ?? Team.Blue);
  const enemyTeam = localTeam === Team.Blue ? Team.Red : Team.Blue;
  structuresFolder.add({ win: () => sim.debug.destroyHq(enemyTeam) }, 'win').name('Win now (destroy enemy HQ)');
  structuresFolder.add({ lose: () => sim.debug.destroyHq(localTeam) }, 'lose').name('Lose now');
  const shields = { on: true };
  structuresFolder.add(shields, 'on').name('HQ shields').onChange((v: boolean) => sim.debug.setHqShields(v));
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

  createFpsOverlay(frame, stats, renderInfo);
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
  folder.add({ xp: () => sim.debug.giveXp(e, 100) }, 'xp').name('+100 XP');
  folder.add({ up: () => sim.debug.levelUp(e) }, 'up').name('Level up');
  folder.add({ kill: () => sim.debug.kill(e) }, 'kill').name('Kill me');
  // The `?dummy` enemy is player 1.
  const killDummy = () => {
    const d = sim.entityOf(1);
    if (d !== undefined) sim.debug.kill(d);
  };
  folder.add({ killDummy }, 'killDummy').name('Kill enemy (bot or dummy)');
}

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Dev perf overlay (TDD §12 budgets; D-044): fps, worst frame, sim time per tick, render CPU
 * time, and the last frame's draw calls and triangles (mobile budget: ≤ 120 calls, ≤ 150k tris).
 */
function createFpsOverlay(frame: HTMLElement, stats: { simMs: number; renderMs: number }, info?: { render: { calls: number; triangles: number } }) {
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
      const draw = info ? ` · ${info.render.calls} calls · ${(info.render.triangles / 1000).toFixed(0)}k tris` : '';
      el.textContent = `${fps.toFixed(0)} fps · worst ${worst.toFixed(1)} ms · sim ${stats.simMs.toFixed(2)} · render ${stats.renderMs.toFixed(2)} ms${draw}`;
      frames = 0;
      worst = 0;
      windowStart = now;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
