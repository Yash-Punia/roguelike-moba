import { parseConfig, rawConfig } from '../data/load';
import { createSim, Team } from '../sim/sim';
import { startLoop } from './loop';

const config = parseConfig(rawConfig);
const sim = createSim(config, config.match.defaultSeed, [{ team: Team.Blue, championId: 'alpha' }]);

startLoop({
  step: () => sim.step([]),
  draw: () => {},
});
