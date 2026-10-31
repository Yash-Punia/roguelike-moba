import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { deg, pct, secs } from '../src/data/schema';
import { parseConfig, rawConfig } from '../src/data/load';

describe('config conversion', () => {
  it('converts seconds to ticks at 30 Hz', () => {
    expect(secs().parse(0.15)).toBe(5);
    expect(secs().parse(25)).toBe(750);
  });

  it('converts percentages and degrees', () => {
    expect(pct().parse(15)).toBeCloseTo(0.15);
    expect(deg().parse(180)).toBeCloseTo(Math.PI);
  });

  it('loads the shipped config', () => {
    const config = parseConfig(rawConfig);
    expect(config.camera.playerFramePct).toBeCloseTo(0.4);
    expect(config.champions[0]?.id).toBe('alpha');
  });

  it('fails loudly on a bad value', () => {
    const bad = structuredClone(rawConfig);
    bad.champions[0]!.moveSpeed = -1;
    expect(() => parseConfig(bad)).toThrow(/moveSpeed/);
  });

  it('rejects negative seconds', () => {
    expect(() => z.object({ t: secs() }).parse({ t: -1 })).toThrow();
  });
});
