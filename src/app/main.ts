import { parseConfig, rawConfig } from '../data/load';
import { createScene } from '../render/scene';
import { createSim, Team } from '../sim/sim';
import { startLoop } from './loop';

const config = parseConfig(rawConfig);
const sim = createSim(config, config.match.defaultSeed, [{ team: Team.Blue, championId: 'alpha' }]);

const container = document.createElement('div');
container.style.cssText = 'position:fixed;inset:0';
document.body.style.margin = '0';
document.body.appendChild(container);

const view = createScene(container, config);
view.capture(sim.snapshot());
const localEntity = sim.entityOf(0);

startLoop({
  step: () => {
    sim.step([]);
    view.capture(sim.snapshot());
  },
  draw: (alpha) => {
    view.update(alpha, localEntity);
    // Temporary fixed follow camera; replaced by render/camera.ts.
    const { x, y } = view.focus;
    view.camera.position.set(x, 30, -y + 17);
    view.camera.lookAt(x, 0, -y);
    view.render();
  },
});
