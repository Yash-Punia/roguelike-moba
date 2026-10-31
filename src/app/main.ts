import './style.css';
import { parseConfig, rawConfig } from '../data/load';
import { createCameraRig } from '../render/camera';
import { createScene } from '../render/scene';
import { createSim, Team } from '../sim/sim';
import { startLoop } from './loop';

const params = new URLSearchParams(location.search);
const localTeam = params.get('team') === 'red' ? Team.Red : Team.Blue;

const config = parseConfig(rawConfig);
const sim = createSim(config, config.match.defaultSeed, [{ team: localTeam, championId: 'alpha' }]);

const container = document.getElementById('frame')!;

const view = createScene(container, config);
const rig = createCameraRig(view.camera, localTeam);
view.capture(sim.snapshot());
const localEntity = sim.entityOf(0);
let lastFrame = performance.now();

startLoop({
  step: () => {
    sim.step([]);
    view.capture(sim.snapshot());
  },
  draw: (alpha) => {
    const now = performance.now();
    const dt = Math.min((now - lastFrame) / 1000, 0.1);
    lastFrame = now;
    view.update(alpha, localEntity);
    rig.update(view.focus, config.camera, dt);
    view.render();
  },
});
