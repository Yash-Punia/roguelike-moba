import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { parseConfig, rawConfig } from '../src/data/load';
import { createCameraRig } from '../src/render/camera';
import { Team } from '../src/sim/sim';

const cfg = parseConfig(rawConfig).camera;

/** Projects a sim-space ground point to NDC. */
function ndc(cam: PerspectiveCamera, x: number, y: number) {
  cam.updateMatrixWorld();
  return new Vector3(x, 0, -y).project(cam);
}

function setup(team: Team, aspect = 9 / 16) {
  const cam = new PerspectiveCamera(cfg.fovDeg, aspect, 1, 300);
  const rig = createCameraRig(cam, team);
  return { cam, rig };
}

describe('camera framing', () => {
  it('frames a still player 40% up and centred', () => {
    const { cam, rig } = setup(Team.Blue);
    rig.update({ x: 0, y: -42, vx: 0, vy: 0 }, cfg, 1 / 60);
    const p = ndc(cam, 0, -42);
    expect(p.x).toBeCloseTo(0, 5);
    expect(p.y).toBeCloseTo(2 * cfg.playerFramePct - 1, 5);
  });

  it('shows exactly viewWidth metres across at the player, on any aspect', () => {
    for (const aspect of [9 / 16, 9 / 19.5, 9 / 21]) {
      const { cam, rig } = setup(Team.Blue, aspect);
      rig.update({ x: 0, y: -42, vx: 0, vy: 0 }, cfg, 1 / 60);
      expect(ndc(cam, cfg.viewWidth / 2, -42).x).toBeCloseTo(1, 5);
    }
  });

  it('puts the enemy side at the top for both teams', () => {
    const blue = setup(Team.Blue);
    blue.rig.update({ x: 0, y: -42, vx: 0, vy: 0 }, cfg, 1 / 60);
    expect(ndc(blue.cam, 0, -38).y).toBeGreaterThan(ndc(blue.cam, 0, -42).y);
    expect(ndc(blue.cam, 3, -42).x).toBeGreaterThan(0);

    const red = setup(Team.Red);
    red.rig.update({ x: 0, y: 42, vx: 0, vy: 0 }, cfg, 1 / 60);
    const p = ndc(red.cam, 0, 42);
    expect(p.y).toBeCloseTo(2 * cfg.playerFramePct - 1, 5);
    expect(ndc(red.cam, 0, 38).y).toBeGreaterThan(p.y);
    expect(ndc(red.cam, -3, 42).x).toBeGreaterThan(0); // Red's screen-right is world -x
  });

  it('keeps a moving player on screen, nudged behind the look-ahead point', () => {
    const { cam, rig } = setup(Team.Blue);
    let y = -42;
    for (let i = 0; i < 120; i++) {
      y += 3.5 / 60;
      rig.update({ x: 0, y, vx: 0, vy: 3.5 }, cfg, 1 / 60);
    }
    const p = ndc(cam, 0, y);
    expect(p.y).toBeLessThan(2 * cfg.playerFramePct - 1);
    expect(p.y).toBeGreaterThan(-0.6);
  });
});
