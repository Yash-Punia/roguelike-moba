import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyColourBlind, COLOUR_BLIND_RED, palette } from '../src/render/palette';
import { createModel, partsOf, teamColour } from '../src/render/models';
import { Tracers } from '../src/render/tracers';
import { Kind, Team } from '../src/sim/sim';

// Its own file: applyColourBlind changes the palette for the rest of the module's life.
const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const distance = (a: number, b: number) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]!));

describe('colour-blind mode (D-114)', () => {
  it('uses an orange that stays clear of blue, the flames and the neutral hazard yellow', () => {
    for (const other of [palette.blue, palette.fire, palette.hazard, palette.muzzle]) expect(distance(COLOUR_BLIND_RED, other)).toBeGreaterThan(60);
  });

  it('turns the red team orange wherever it is read after the switch', () => {
    applyColourBlind();
    expect(palette.red).toBe(COLOUR_BLIND_RED);
    expect(teamColour(Team.Red)).toBe(COLOUR_BLIND_RED);
    expect(teamColour(Team.Blue)).toBe(palette.blue);
    const orange = new THREE.Color(COLOUR_BLIND_RED);
    expect(new Tracers(() => 0).colours[Team.Red].r).toBeGreaterThan(orange.r - 1e-6); // lightened from orange
    const helmet = partsOf(createModel(Kind.Minion, 'mgSoldier', Team.Red)).cap!.children.find((c) => c instanceof THREE.Mesh) as THREE.Mesh;
    const c = helmet.geometry.attributes.color!;
    let found = false;
    for (let i = 0; i < c.count && !found; i++) found = Math.abs(c.getX(i) - orange.r) < 1e-6 && Math.abs(c.getY(i) - orange.g) < 1e-6;
    expect(found).toBe(true);
  });
});
