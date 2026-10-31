import { z } from 'zod';
import { ConfigSchema, type Config, type RawConfig } from './schema';
import match from '../../data/match.json';
import champions from '../../data/champions.json';
import map from '../../data/map-3lane.json';
import camera from '../../data/camera.json';
import input from '../../data/input.json';

export const rawConfig: RawConfig = { match, champions, map, camera, input } as RawConfig;

/** Validates and converts raw JSON config. Throws a readable error on any bad value. */
export function parseConfig(raw: unknown): Config {
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) throw new Error(`Invalid config:\n${z.prettifyError(result.error)}`);
  return result.data;
}
