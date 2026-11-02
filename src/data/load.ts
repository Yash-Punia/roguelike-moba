import { z } from 'zod';
import { ConfigSchema, type Config, type RawConfig } from './schema';
import match from '../../data/match.json';
import champions from '../../data/champions.json';
import map from '../../data/map-3lane.json';
import structures from '../../data/structures.json';
import units from '../../data/units.json';
import waves from '../../data/waves.json';
import combat from '../../data/combat.json';
import camera from '../../data/camera.json';
import input from '../../data/input.json';

export const rawConfig: RawConfig = { match, champions, map, structures, units, waves, combat, camera, input } as RawConfig;

/** Source file of each config section, for exporting edits back to `/data`. */
export const configFiles: Record<keyof RawConfig, string> = {
  match: 'match.json',
  champions: 'champions.json',
  map: 'map-3lane.json',
  structures: 'structures.json',
  units: 'units.json',
  waves: 'waves.json',
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
