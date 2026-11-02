import './style.css';
import { parseConfig, rawConfig } from '../data/load';
import { createCameraRig } from '../render/camera';
import { createScene } from '../render/scene';
import { createInput } from '../input';
import { createSim, Team, type PlayerSetup } from '../sim/sim';
import { TICK_HZ } from '../data/schema';
import { startLoop } from './loop';

const params = new URLSearchParams(location.search);
const localTeam = params.get('team') === 'red' ? Team.Red : Team.Blue;
const debug = import.meta.env.DEV || params.has('debug');

// Lanes are straight segments between the spec's control points (D-027); `?curved` draws the spec's Catmull-Rom curves instead.
const raw = structuredClone(rawConfig);
if (params.has('curved')) raw.map.splineSamples = 16;
let config = parseConfig(raw);
const players: PlayerSetup[] = [{ team: localTeam, championId: 'alpha' }];
// `?dummy`: an idle, unarmed enemy Alpha in front of your Sub-base to test combat against;
// `?dummy=armed` fires back. Until the bot (M2 feature 16).
if (params.has('dummy')) {
  const enemy = localTeam === Team.Blue ? Team.Red : Team.Blue;
  const spawnAt = { x: 0, y: localTeam === Team.Blue ? -50 : 50 };
  players.push({ team: enemy, championId: 'alpha', spawnAt, unarmed: params.get('dummy') !== 'armed' });
}
const sim = createSim(config, config.match.defaultSeed, players);

const container = document.getElementById('frame')!;

const view = createScene(container, config);
const input = createInput(container, () => config.input, 0, localTeam);
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

const loop = startLoop({
  step: () => {
    const t0 = debug ? performance.now() : 0;
    const { events } = sim.step([input.sample(sim.tick)]);
    if (debug) stats.simMs = performance.now() - t0;
    const snap = sim.snapshot();
    view.capture(snap);
    view.addEvents(events);
    const me = snap.entities.find((e) => e.id === localEntity);
    if (!me) return;
    input.ultButton.show(me.ultCharge, me.ultTargetable);
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
  Object.assign(window, { warfront: { sim, view, loop, get config() { return config; } } });
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
    }),
  );
}
