import './style.css';
import { parseConfig, rawConfig } from '../data/load';
import { createCameraRig } from '../render/camera';
import { createScene } from '../render/scene';
import { createInput } from '../input';
import { createSim, Team, type PlayerSetup } from '../sim/sim';
import { TICK_HZ } from '../data/schema';
import { startLoop } from './loop';
import { createBot } from '../sim/bots/bot';
import { showEndBanner } from './end-banner';
import { mountHud } from '../ui/hud';
import { mountUltGauge } from '../ui/ult-button';
import { hud, updateHud } from '../ui/store';

const params = new URLSearchParams(location.search);
const localTeam = params.get('team') === 'red' ? Team.Red : Team.Blue;
const debug = import.meta.env.DEV || params.has('debug');

// Lanes are straight segments between the spec's control points (D-027); `?curved` draws the spec's Catmull-Rom curves instead.
const raw = structuredClone(rawConfig);
if (params.has('curved')) raw.map.splineSamples = 16;
// `?nowaves`: no minion waves, for clean duels (also switchable live: F1 → waves.json → enabled).
if (params.has('nowaves')) raw.waves.enabled = false;
let config = parseConfig(raw);
const players: PlayerSetup[] = [{ team: localTeam, championId: 'alpha' }];
const enemy = localTeam === Team.Blue ? Team.Red : Team.Blue;
// The opponent (D-042): a bot Alpha by default; `?nobot` plays alone. `?dummy` replaces it
// with an idle, unarmed Alpha in front of your Sub-base, and `?dummy=armed` fires back.
const withBot = !params.has('dummy') && !params.has('nobot');
if (params.has('dummy')) {
  const spawnAt = { x: 0, y: localTeam === Team.Blue ? -50 : 50 };
  players.push({ team: enemy, championId: 'alpha', spawnAt, unarmed: params.get('dummy') !== 'armed' });
} else if (withBot) {
  players.push({ team: enemy, championId: 'alpha' });
}
// A fresh seed per page load, so every match plays differently; `?seed=N` replays one (D-043).
const seed = params.has('seed') ? Number(params.get('seed')) >>> 0 : (Math.random() * 0x7fffffff) >>> 0;
console.info(`Warfront match seed ${seed} (replay with ?seed=${seed})`);
const sim = createSim(config, seed, players);
const bot = withBot ? createBot(1, enemy, () => config, () => sim.lanes, sim.rng.ai) : undefined;
const botEntity = sim.entityOf(1);
let lastSnap = sim.snapshot();

const container = document.getElementById('frame')!;

const view = createScene(container, config, localTeam);
mountHud(container, (slot) => input.pickCard(slot));
const input = createInput(container, () => config.input, 0, localTeam);
// The Ultimate button: a 22 mm gauge (GDD §3).
const ultGauge = mountUltGauge(container, 22 * config.input.pxPerMm, input.pressUlt);
const rig = createCameraRig(view.camera, localTeam);
view.capture(sim.snapshot());
const localEntity = sim.entityOf(0);
const stats = { simMs: 0 };
let lastFrame = performance.now();
// While knocked out the camera follows the killer (D-034); otherwise the local champion.
let cameraFocus = localEntity;
// Minimal respawn countdown until the M4 respawn overlay.
const banner = document.createElement('div');
banner.className = 'respawn-banner';
container.appendChild(banner);
let bannerSeconds = -1;
// The HQ falls: 1 s of slow motion on the effects (the sim is already frozen), then the banner.
const SLOW_MOTION_MS = 1000;
const SLOW_MOTION_SCALE = 0.25;
let ended = false;

function endMatch(winner: Team) {
  ended = true;
  ultGauge.hide();
  banner.classList.remove('show');
  view.setTimeScale(SLOW_MOTION_SCALE);
  setTimeout(() => {
    view.setTimeScale(1);
    const me = sim.snapshot().entities.find((e) => e.id === localEntity);
    showEndBanner(container, winner === localTeam, sim.match.endTick / TICK_HZ, me?.level ?? 1, me?.kills ?? 0, me?.deaths ?? 0);
  }, SLOW_MOTION_MS);
}

const loop = startLoop({
  step: () => {
    const t0 = debug ? performance.now() : 0;
    // The bot answers the previous snapshot (TDD §4), like a player reacting to what they saw.
    const commands = [input.sample(sim.tick)];
    if (bot && botEntity !== undefined) commands.push(bot.command(lastSnap, sim.tick, botEntity));
    const { events } = sim.step(commands);
    if (debug) stats.simMs = performance.now() - t0;
    // Events first: a minion knocked out this tick is already gone from the snapshot, and its
    // model must reach the knock-out before capture drops it.
    view.addEvents(events);
    const snap = sim.snapshot();
    lastSnap = snap;
    view.capture(snap);
    // HUD at 10 Hz (TDD §10): every third tick, and on the tick the match ends.
    if (snap.tick % 3 === 0 || snap.match.phase === 'ended' || events.some((e) => e.type === 'draftOffered' || e.type === 'powerPicked')) {
      updateHud(snap, localEntity, localTeam, config.powers);
      hud.keyHints.value = input.lastInput === 'keyboard';
    }
    if (ended) return;
    for (const ev of events) {
      if (ev.type === 'structureDestroyed' && ev.kind === 'hq') cameraFocus = ev.id; // watch it fall
      if (ev.type === 'matchOver') endMatch(ev.winner);
    }
    if (ended) return;
    const me = snap.entities.find((e) => e.id === localEntity);
    if (!me) return;
    ultGauge.set(me.ultCharge, me.ultTargetable);
    ultGauge.keyHint(input.lastInput === 'keyboard');
    const down = me.respawnTicks > 0;
    cameraFocus = down && me.killer !== 0 && snap.entities.some((e) => e.id === me.killer) ? me.killer : localEntity;
    const seconds = down ? Math.ceil(me.respawnTicks / TICK_HZ) : 0;
    if (seconds !== bannerSeconds) {
      bannerSeconds = seconds;
      banner.textContent = down ? `REDEPLOYING IN ${seconds}` : '';
      banner.classList.toggle('show', down);
    }
  },
  draw: (alpha) => {
    const now = performance.now();
    const dt = Math.min((now - lastFrame) / 1000, 0.1);
    lastFrame = now;
    view.update(alpha, localEntity, cameraFocus);
    rig.update(view.focus, config.camera, dt);
    view.render();
  },
});

if (debug) {
  Object.assign(window, { warfront: { sim, view, loop, bot, get config() { return config; } } });
  import('../tools/debug-panel').then(({ createDebugPanel }) =>
    createDebugPanel({
      raw,
      apply: (next) => {
        if (JSON.stringify(next.map) !== JSON.stringify(config.map)) view.setMap(next.map);
        config = next;
        sim.setConfig(next);
      },
      loop,
      stats,
      frame: container,
      sim,
      localEntity,
      bot,
      seed,
    }),
  );
}
