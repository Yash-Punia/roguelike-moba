import * as THREE from 'three';
import type { LobSnapshot, ZoneSnapshot } from '../sim/sim';
import { palette } from './palette';
import type { Decals, Particles } from './particles';
import { discGeo, ringGeo } from './telegraphs';

// Presentation only: timings and sizes of the effects (not gameplay numbers).
const POOL_FADE_TICKS = 15;

type HeightAt = (x: number, y: number) => number;

const basic = (color: number, opacity: number) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });

const grenadeGeo = new THREE.SphereGeometry(0.13, 8, 6).scale(1, 1.3, 1);
const grenadeMat = new THREE.MeshLambertMaterial({ color: palette.olive, flatShading: true });
// Lead Storm: bright streaks flying down the strip (the strip itself is a telegraph, D-078).
const streakGeo = new THREE.BoxGeometry(0.8, 0.04, 0.04);
const streakMat = new THREE.MeshBasicMaterial({ color: palette.muzzle, toneMapped: false });
const STREAKS = 12;
/** Streak passes down the strip per second, and the gun height they fly from. */
const STREAK_RATE = 2.2;
const GUN_HEIGHT = 0.9;

// Gamma's flamethrower: the flames start this far ahead of the body and this high (m).
const NOZZLE = { x: 1.3, y: 0.95 };
/** Scorch left at the flame's tip: this far along its range, this wide (m). */
const SCORCH_REACH = 0.8;
const SCORCH_RADIUS = 0.55;
const TAU = Math.PI * 2;
// Gamma's Heat Wave: a pulsing gold ring with a faint gold floor.
const waveRingMat = basic(palette.brass, 0.85);
const waveFillMat = basic(palette.brass, 0.12);

interface Flames {
  on: boolean;
  range: number;
  half: number;
  x: number;
  y: number;
  angle: number;
  /** Particles owed, as a fraction carried between frames. */
  owed: number;
  /** Render clock (ms) of the next scorch mark. */
  scorchAt: number;
}

interface Storm {
  group: THREE.Group;
  streaks: THREE.Mesh[];
  length: number;
  width: number;
}

interface Lob {
  grenade: THREE.Mesh;
  snap: Omit<LobSnapshot, 'id' | 'team'>;
}
interface Pool {
  x: number;
  y: number;
  radius: number;
  elapsed: number;
  total: number;
  owed: number;
}

/**
 * Ultimate effects (GDD §11): the Frag Grenade on its arc (its landing telegraph is drawn by
 * `Telegraphs`, D-078), the emitters for fire pools and Gamma's flames (particles and scorch,
 * D-104), Lead Storm and Heat Wave. Reads lob and zone snapshots; never writes sim state.
 */
export class UltFx {
  readonly group = new THREE.Group();
  private readonly lobs = new Map<number, Lob>();
  private readonly pools = new Map<number, Pool>();
  private readonly storms = new Map<number, Storm>();
  private readonly flames = new Map<number, Flames>();
  private readonly waves = new Map<number, THREE.Group>();
  private readonly seen = new Set<number>();
  private last: number | undefined;

  constructor(private readonly heightAt: HeightAt, private readonly particles: Particles, private readonly decals: Decals) {}

  /** `shown`: fog of war; a grenade shows only if its landing spot is seen, a fire pool if its centre is. */
  capture(lobs: readonly LobSnapshot[], zones: readonly ZoneSnapshot[], shown?: (x: number, y: number) => boolean) {
    this.seen.clear();
    for (const l of lobs) {
      if (shown && !shown(l.x1, l.y1)) continue;
      this.seen.add(l.id);
      let fx = this.lobs.get(l.id);
      if (!fx) {
        const grenade = new THREE.Mesh(grenadeGeo, grenadeMat);
        grenade.castShadow = true;
        this.group.add(grenade);
        fx = { grenade, snap: { ...l } };
        this.lobs.set(l.id, fx);
      }
      Object.assign(fx.snap, l);
    }
    for (const [id, fx] of this.lobs) {
      if (this.seen.has(id)) continue;
      this.group.remove(fx.grenade);
      this.lobs.delete(id);
    }

    this.seen.clear();
    for (const z of zones) {
      if (shown && !shown(z.x, z.y)) continue;
      this.seen.add(z.id);
      let pool = this.pools.get(z.id);
      if (!pool) pool = this.addPool(z);
      pool.elapsed = z.elapsed;
      pool.total = z.total;
    }
    for (const id of this.pools.keys()) {
      if (!this.seen.has(id)) this.pools.delete(id);
    }
  }

  /**
   * Beta's Lead Storm for champion `id` (GDD §11): a tracer stream down the strip while firing
   * (`channel` 2); removed at 0. The strip itself is a telegraph (D-078).
   */
  storm(id: number, channel: 0 | 1 | 2, length: number, width: number) {
    let st = this.storms.get(id);
    if (channel === 0) {
      if (st) this.group.remove(st.group);
      this.storms.delete(id);
      return;
    }
    if (!st) {
      const group = new THREE.Group();
      const streaks: THREE.Mesh[] = [];
      for (let k = 0; k < STREAKS; k++) streaks.push(new THREE.Mesh(streakGeo, streakMat));
      group.add(...streaks);
      this.group.add(group);
      this.storms.set(id, (st = { group, streaks, length, width }));
    }
    for (const s of st.streaks) s.visible = channel === 2;
  }

  /** Moves a storm with its caster (interpolated sim position and strip angle) and runs its streaks. */
  private placeStorm(id: number, x: number, y: number, angle: number, now: number) {
    const st = this.storms.get(id);
    if (!st) return;
    st.group.position.set(x, this.heightAt(x, y) + 0.06, -y);
    st.group.rotation.y = angle;
    for (let k = 0; k < st.streaks.length; k++) {
      const t = ((now / 1000) * STREAK_RATE + k / STREAKS) % 1;
      const lateral = (((k * 0.618) % 1) - 0.5) * st.width * 0.85;
      st.streaks[k]!.position.set(0.6 + t * (st.length - 0.6), GUN_HEIGHT * (1 - t) + 0.15, lateral * t);
    }
  }

  /** Shows or hides Gamma's flame cone (GDD §11) for champion `id`; `range` and `angle` are its sector. */
  flame(id: number, on: boolean, range: number, angle: number) {
    let f = this.flames.get(id);
    if (!f) {
      if (!on) return;
      this.flames.set(id, (f = { on, range, half: angle / 2, x: 0, y: 0, angle: 0, owed: 0, scorchAt: 0 }));
    }
    f.on = on;
  }

  /** Shows or hides Gamma's Heat Wave ring (`radius`, GDD §11) for champion `id`. */
  heatWave(id: number, on: boolean, radius: number) {
    let g = this.waves.get(id);
    if (!g) {
      if (!on) return;
      g = new THREE.Group();
      const fill = new THREE.Mesh(discGeo, waveFillMat);
      const ring = new THREE.Mesh(ringGeo, waveRingMat);
      fill.renderOrder = ring.renderOrder = 4;
      g.add(fill, ring);
      g.scale.set(radius, 1, radius);
      this.group.add(g);
      this.waves.set(id, g);
    }
    g.visible = on;
  }

  /**
   * Moves a champion's flames, Heat Wave and Lead Storm with it (interpolated sim position and
   * upper-body angle) and animates them.
   */
  placeChampion(id: number, x: number, y: number, angle: number, now: number) {
    const ground = this.heightAt(x, y);
    const f = this.flames.get(id);
    if (f) {
      f.x = x;
      f.y = y;
      f.angle = angle;
    }
    const w = this.waves.get(id);
    if (w?.visible) {
      w.position.set(x, ground + 0.05, -y);
      waveRingMat.opacity = 0.55 + 0.3 * Math.sin(now * 0.008);
    }
    this.placeStorm(id, x, y, angle, now);
  }

  update(alpha: number, now: number) {
    for (const fx of this.lobs.values()) {
      const { x0, y0, x1, y1, elapsed, total, arcHeight } = fx.snap;
      const t = Math.min(1, (elapsed + alpha) / total);
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      const ground = this.heightAt(x0, y0) + (this.heightAt(x1, y1) - this.heightAt(x0, y0)) * t;
      fx.grenade.position.set(x, ground + 1.2 * (1 - t) + 4 * arcHeight * t * (1 - t), -y);
      fx.grenade.rotation.z = -t * Math.PI * 3;
    }

    const dt = Math.min(0.1, (now - (this.last ?? now)) / 1000);
    this.last = now;
    const { flameRate, poolFlamesPerM2, flameScorchSeconds } = this.particles.vfx;
    for (const pool of this.pools.values()) {
      const fade = Math.min(1, Math.max(0, (pool.total - pool.elapsed) / POOL_FADE_TICKS));
      pool.owed += Math.PI * pool.radius * pool.radius * poolFlamesPerM2 * fade * dt;
      for (; pool.owed >= 1; pool.owed--) {
        const a = Math.random() * TAU;
        const r = pool.radius * 0.85 * Math.sqrt(Math.random());
        this.particles.emit('poolFlame', pool.x + Math.cos(a) * r, pool.y + Math.sin(a) * r);
      }
    }
    for (const f of this.flames.values()) {
      if (!f.on) continue;
      const cos = Math.cos(f.angle);
      const sin = Math.sin(f.angle);
      f.owed += flameRate * dt;
      for (; f.owed >= 1; f.owed--) {
        this.particles.emitAlong('gammaFlame', f.x + cos * NOZZLE.x, f.y + sin * NOZZLE.x, NOZZLE.y, f.angle, f.range - NOZZLE.x + 0.3, f.half * 0.8);
      }
      if (now >= f.scorchAt) {
        f.scorchAt = now + flameScorchSeconds * 1000;
        this.decals.stamp(f.x + cos * f.range * SCORCH_REACH, f.y + sin * f.range * SCORCH_REACH, SCORCH_RADIUS);
      }
    }
  }

  private addPool(z: ZoneSnapshot): Pool {
    this.decals.stamp(z.x, z.y, z.radius); // outlives the fire
    const pool: Pool = { x: z.x, y: z.y, radius: z.radius, elapsed: z.elapsed, total: z.total, owed: 0 };
    this.pools.set(z.id, pool);
    return pool;
  }
}
