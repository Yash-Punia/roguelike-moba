import { z } from 'zod';
import { ConfigSchema, type Config, type RawConfig } from './schema';
import match from '../../data/match.json';
import champions from '../../data/champions.json';
import map from '../../data/map-3lane.json';
import map2 from '../../data/map-2lane.json';
import structures from '../../data/structures.json';
import units from '../../data/units.json';
import waves from '../../data/waves.json';
import progression from '../../data/progression.json';
import powers from '../../data/powers.json';
import bots from '../../data/bots.json';
import combat from '../../data/combat.json';
import camera from '../../data/camera.json';
import input from '../../data/input.json';

/** The map for each lane count (D-069): 3 = The Front, 2 = The Bridgehead. */
export const maps = { 2: map2, 3: map } as unknown as Record<2 | 3, RawConfig['map']>;
export const mapFiles = { 2: 'map-2lane.json', 3: 'map-3lane.json' } as const;

export const rawConfig: RawConfig = { match, champions, map, structures, units, waves, progression, powers, bots, combat, camera, input } as unknown as RawConfig; // JSON number arrays widen to number[]; the schema checks the tuples

/** Source file of each config section, for exporting edits back to `/data`. */
export const configFiles: Record<keyof RawConfig, string> = {
  match: 'match.json',
  champions: 'champions.json',
  map: 'map-3lane.json',
  structures: 'structures.json',
  units: 'units.json',
  waves: 'waves.json',
  progression: 'progression.json',
  powers: 'powers.json',
  bots: 'bots.json',
  combat: 'combat.json',
  camera: 'camera.json',
  input: 'input.json',
};

/** Validates and converts raw JSON config. Throws a readable error on any bad value. */
export function parseConfig(raw: unknown): Config {
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) throw new Error(`Invalid config:\n${z.prettifyError(result.error)}`);
  return result.data;
}
