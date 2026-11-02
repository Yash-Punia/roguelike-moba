import { parseConfig, rawConfig } from '../src/data/load';
import type { Config, RawConfig } from '../src/data/schema';
import openMap from './fixtures/map-open.json';

/** Shipped config on a fixed open test map (36 × 110 m, all walkable), so tests don't move when the real map does. */
export function fixtureConfig(): Config {
  return parseConfig({ ...rawConfig, map: openMap as RawConfig['map'] });
}
