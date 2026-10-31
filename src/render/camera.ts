import type { PerspectiveCamera } from 'three';
import type { Config } from '../data/schema';
import { Team } from '../sim/sim';

type CameraConfig = Config['camera'];
interface Focus {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * Fixed-angle follow camera (GDD §3, TDD §9). Never rotates or zooms in play.
 * Distance is solved every frame so the view is exactly `viewWidth` metres wide at the
 * player, with the player framed `playerFramePct` up from the bottom. A Red player's
 * camera sits on the Red side looking towards −y, so their own HQ is at the bottom.
 */
export function createCameraRig(camera: PerspectiveCamera, team: Team) {
  const forward = team === Team.Red ? -1 : 1; // sim y direction the camera looks along
  const target = { x: 0, y: 0, ready: false };
  camera.rotation.order = 'YXZ';

  function update(focus: Focus, cfg: CameraConfig, dtSec: number) {
    if (camera.fov !== cfg.fovDeg) {
      camera.fov = cfg.fovDeg;
      camera.updateProjectionMatrix();
    }

    // Look ahead in the move direction, then smooth (exponential = critically damped, first order).
    const speed = Math.hypot(focus.vx, focus.vy);
    const ax = speed > 0.1 ? (focus.vx / speed) * cfg.lookAhead : 0;
    const ay = speed > 0.1 ? (focus.vy / speed) * cfg.lookAhead : 0;
    const k = target.ready ? 1 - Math.exp(-dtSec / cfg.followSeconds) : 1;
    target.x += (focus.x + ax - target.x) * k;
    target.y += (focus.y + ay - target.y) * k;
    target.ready = true;

    // Player at NDC y = 2·frame − 1; the ray to it sits `phi` below the view axis.
    const pitch = (cfg.pitchDeg * Math.PI) / 180;
    const tanHalf = Math.tan((cfg.fovDeg * Math.PI) / 360);
    const phi = Math.atan((1 - 2 * cfg.playerFramePct) * tanHalf);
    const rayDown = pitch + phi;
    const depth = cfg.viewWidth / (2 * tanHalf * camera.aspect); // view-axis depth with the wanted width
    const height = (depth * Math.sin(rayDown)) / Math.cos(phi);
    const back = height / Math.tan(rayDown);

    camera.position.set(target.x, height, -(target.y - back * forward));
    camera.rotation.set(-pitch, forward === 1 ? 0 : Math.PI, 0);
  }

  return { update };
}
