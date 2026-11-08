import { Vector3, type DirectionalLight, type PerspectiveCamera } from 'three';
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

/** Beyond the view's ground footprint: raised ground and tall props near the screen edge still receive shadows (m). */
const SHADOW_MARGIN = 5;
const NDC_CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
const WORLD_UP = new Vector3(0, 1, 0);
const corner = new Vector3();
const toSun = new Vector3();
const lightX = new Vector3();
const lightY = new Vector3();

/**
 * Fits the sun's shadow box to what the camera sees (D-099): centred on the view's footprint on
 * the ground, in the axes the shadow camera will use. Only casters that can reach the screen are
 * drawn in the shadow pass, whichever way the camera faces and whatever the frame's shape.
 */
export function fitShadowBox(sun: DirectionalLight, sunOffset: Vector3, camera: PerspectiveCamera) {
  camera.updateMatrixWorld();
  toSun.copy(sunOffset).normalize();
  lightX.crossVectors(WORLD_UP, toSun).normalize();
  lightY.crossVectors(toSun, lightX);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of NDC_CORNERS) {
    corner.set(x, y, 0.5).unproject(camera).sub(camera.position);
    corner.multiplyScalar(-camera.position.y / corner.y).add(camera.position); // where this corner's ray meets y = 0
    const u = corner.dot(lightX);
    const v = corner.dot(lightY);
    minX = Math.min(minX, u);
    maxX = Math.max(maxX, u);
    minY = Math.min(minY, v);
    maxY = Math.max(maxY, v);
  }
  sun.target.position.copy(lightX).multiplyScalar((minX + maxX) / 2).addScaledVector(lightY, (minY + maxY) / 2);
  sun.position.copy(sun.target.position).add(sunOffset);
  const box = sun.shadow.camera;
  const halfX = (maxX - minX) / 2 + SHADOW_MARGIN;
  const halfY = (maxY - minY) / 2 + SHADOW_MARGIN;
  if (Math.abs(box.right - halfX) + Math.abs(box.top - halfY) < 1e-3) return;
  Object.assign(box, { left: -halfX, right: halfX, top: halfY, bottom: -halfY });
  box.updateProjectionMatrix();
}
