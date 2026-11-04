import * as THREE from 'three';
import type { Config } from '../data/schema';
import { dronePosition } from '../sim/powers';
import { Kind, type Snapshot, type Team } from '../sim/sim';
import { palette } from './palette';

type HeightAt = (x: number, y: number) => number;

/** Chain lightning stays on screen this long (ms). */
const CHAIN_MS = 150;
/** The drone hovers this high (m). */
const DRONE_LIFT = 1.9;

const droneGeo = new THREE.BoxGeometry(0.34, 0.12, 0.34);
const droneMat = new THREE.MeshLambertMaterial({ color: palette.gunmetal, flatShading: true });
const mineGeo = new THREE.CylinderGeometry(0.22, 0.26, 0.08, 10);
const mineMat = new THREE.MeshLambertMaterial({ color: palette.olive, flatShading: true });
const armedMat = new THREE.MeshLambertMaterial({ color: palette.hazard, flatShading: true });
const chainMat = new THREE.LineBasicMaterial({ color: 0xcfe8ff, transparent: true });

/**
 * Epic power visuals (D-063), presentation only:
 * - an Attack Drone circling each champion that owns one, on the sim's own orbit clock;
 * - Minefield mines, for the viewer's team only (a hazard-yellow top once armed);
 * - Tesla Rounds arcs: a bright line from the struck unit to each one the lightning jumps to.
 */
export class EpicFx {
  readonly group = new THREE.Group();
  private readonly drones = new Map<number, THREE.Mesh>();
  private readonly owners = new Set<number>();
  private mines: THREE.Mesh[] = [];
  private chains: { line: THREE.Line; born: number }[] = [];
  private orbit = 0;
  private tick = 0;

  constructor(private readonly heightAt: HeightAt, config: Config, private readonly viewer: Team) {
    for (const p of config.powers.powers) for (const fx of p.effects) if (fx.type === 'summon' && fx.drone) this.orbit = fx.drone.orbit;
  }

  /** Call after every sim tick. */
  capture(snap: Snapshot) {
    this.tick = snap.tick;
    this.owners.clear();
    for (const e of snap.entities) {
      // A hidden enemy's drone would give it away.
      if (e.kind !== Kind.Champion || !(e.powers['attackDrone'] ?? 0) || e.hp <= 0 || (e.visibleMask & (1 << this.viewer)) === 0) continue;
      this.owners.add(e.id);
      if (!this.drones.has(e.id)) {
        const m = new THREE.Mesh(droneGeo, droneMat);
        m.castShadow = true;
        this.group.add(m);
        this.drones.set(e.id, m);
      }
    }
    for (const [id, m] of this.drones) {
      if (this.owners.has(id)) continue;
      this.group.remove(m);
      this.drones.delete(id);
    }
    let n = 0;
    for (const mine of snap.mines) {
      if (mine.team !== this.viewer) continue;
      let m = this.mines[n];
      if (!m) {
        m = new THREE.Mesh(mineGeo, mineMat);
        this.group.add(m);
        this.mines.push(m);
      }
      m.visible = true;
      m.material = mine.armed ? armedMat : mineMat;
      m.position.set(mine.x, this.heightAt(mine.x, mine.y) + 0.04, -mine.y);
      n++;
    }
    for (let i = n; i < this.mines.length; i++) this.mines[i]!.visible = false;
  }

  /** Lightning from (x0, y0) to (x1, y1), sim metres. */
  chain(x0: number, y0: number, x1: number, y1: number, now: number) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x0, this.heightAt(x0, y0) + 1, -y0),
      new THREE.Vector3((x0 + x1) / 2 + 0.3, Math.max(this.heightAt(x0, y0), this.heightAt(x1, y1)) + 1.4, -(y0 + y1) / 2),
      new THREE.Vector3(x1, this.heightAt(x1, y1) + 1, -y1),
    ]);
    const line = new THREE.Line(geo, chainMat);
    this.group.add(line);
    this.chains.push({ line, born: now });
  }

  /** `at(id)`: a champion's interpolated sim position this frame. */
  update(alpha: number, now: number, at: (id: number) => { x: number; y: number } | undefined) {
    const p = { x: 0, y: 0 };
    for (const [id, m] of this.drones) {
      const o = at(id);
      if (!o) continue;
      dronePosition(o.x, o.y, this.orbit, this.tick - 1 + alpha, p);
      m.position.set(p.x, this.heightAt(o.x, o.y) + DRONE_LIFT, -p.y);
    }
    for (let i = this.chains.length - 1; i >= 0; i--) {
      const c = this.chains[i]!;
      if (now - c.born < CHAIN_MS) continue;
      this.group.remove(c.line);
      c.line.geometry.dispose();
      this.chains.splice(i, 1);
    }
  }
}
