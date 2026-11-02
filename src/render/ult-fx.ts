import * as THREE from 'three';
import type { LobSnapshot, ZoneSnapshot } from '../sim/sim';
import { palette } from './palette';

// Presentation only: timings and sizes of the effects (not gameplay numbers).
const FLASH_MS = 280;
const SMOKE_MS = 900;
const FLAMES = 11;
const POOL_FADE_TICKS = 15;

type HeightAt = (x: number, y: number) => number;

const basic = (color: number, opacity: number) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });

// Danger red is for telegraphs only (SG-01, GDD §11).
const telegraphFillMat = basic(palette.danger, 0.22);
const telegraphRingMat = basic(palette.danger, 0.85);
const discGeo = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
const ringGeo = new THREE.RingGeometry(0.93, 1, 48).rotateX(-Math.PI / 2);
const grenadeGeo = new THREE.SphereGeometry(0.13, 8, 6).scale(1, 1.3, 1);
const grenadeMat = new THREE.MeshLambertMaterial({ color: palette.olive, flatShading: true });
const scorchMat = basic(palette.scorched, 0.85);
const flameGeo = new THREE.ConeGeometry(0.32, 1.05, 5).translate(0, 0.52, 0);
const flameOuterMat = new THREE.MeshBasicMaterial({ color: palette.fire });
const flameInnerMat = new THREE.MeshBasicMaterial({ color: palette.muzzle });
const flashGeo = new THREE.IcosahedronGeometry(1, 1);
const smokeGeo = new THREE.BoxGeometry(0.7, 0.7, 0.7);

interface Lob {
  telegraph: THREE.Group;
  grenade: THREE.Mesh;
  snap: Omit<LobSnapshot, 'id' | 'team'>;
}
interface Pool {
  group: THREE.Group;
  flames: THREE.Mesh[];
  phase: number[];
  elapsed: number;
  total: number;
}
interface Blast {
  flash: THREE.Mesh | undefined;
  smoke: THREE.Mesh[];
  born: number;
  radius: number;
}

/**
 * Frag Grenade effects (GDD §11 "Alpha's Frag Grenade"): a red landing telegraph for the
 * whole flight, the grenade on its arc, an explosion flash with smoke, and the fire pool
 * as scorched ground with flickering flame cones. Reads lob and zone snapshots and
 * explosion events; never writes sim state.
 */
export class UltFx {
  readonly group = new THREE.Group();
  private readonly lobs = new Map<number, Lob>();
  private readonly pools = new Map<number, Pool>();
  private blasts: Blast[] = [];
  private readonly seen = new Set<number>();

  constructor(private readonly heightAt: HeightAt) {}

  capture(lobs: readonly LobSnapshot[], zones: readonly ZoneSnapshot[]) {
    this.seen.clear();
    for (const l of lobs) {
      this.seen.add(l.id);
      let fx = this.lobs.get(l.id);
      if (!fx) {
        const telegraph = new THREE.Group();
        telegraph.add(new THREE.Mesh(discGeo, telegraphFillMat), new THREE.Mesh(ringGeo, telegraphRingMat));
        telegraph.scale.set(l.radius, 1, l.radius);
        telegraph.position.set(l.x1, this.heightAt(l.x1, l.y1) + 0.05, -l.y1);
        telegraph.renderOrder = 5;
        const grenade = new THREE.Mesh(grenadeGeo, grenadeMat);
        grenade.castShadow = true;
        this.group.add(telegraph, grenade);
        fx = { telegraph, grenade, snap: { ...l } };
        this.lobs.set(l.id, fx);
      }
      Object.assign(fx.snap, l);
    }
    for (const [id, fx] of this.lobs) {
      if (this.seen.has(id)) continue;
      this.group.remove(fx.telegraph, fx.grenade);
      this.lobs.delete(id);
    }

    this.seen.clear();
    for (const z of zones) {
      this.seen.add(z.id);
      let pool = this.pools.get(z.id);
      if (!pool) pool = this.addPool(z);
      pool.elapsed = z.elapsed;
      pool.total = z.total;
    }
    for (const [id, pool] of this.pools) {
      if (this.seen.has(id)) continue;
      this.group.remove(pool.group);
      this.pools.delete(id);
    }
  }

  /** An explosion event at sim (x, y): a fire flash plus smoke. */
  explode(x: number, y: number, radius: number, now: number) {
    const flash = new THREE.Mesh(flashGeo, basic(palette.fire, 0.9));
    flash.position.set(x, this.heightAt(x, y) + 0.4, -y);
    this.group.add(flash);
    this.puffs(x, y, radius, palette.smoke, 5, now, flash);
  }

  /** A ring of rising, fading puffs at sim (x, y): knock-out dust, respawn smoke. */
  smoke(x: number, y: number, radius: number, colour: number, count: number, now: number) {
    this.puffs(x, y, radius, colour, count, now, undefined);
  }

  private puffs(x: number, y: number, radius: number, colour: number, count: number, now: number, flash: THREE.Mesh | undefined) {
    const h = this.heightAt(x, y);
    const smoke: THREE.Mesh[] = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const puff = new THREE.Mesh(smokeGeo, basic(colour, 0.8));
      puff.position.set(x + Math.cos(a) * radius * 0.35, h + 0.4, -y + Math.sin(a) * radius * 0.35);
      puff.rotation.set(a, a * 0.7, 0);
      smoke.push(puff);
    }
    this.group.add(...smoke);
    this.blasts.push({ flash, smoke, born: now, radius });
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
      // The ring tightens as the grenade comes down.
      const ring = fx.telegraph.children[1]!;
      ring.scale.setScalar(1 + (1 - t) * 0.25);
    }

    for (const pool of this.pools.values()) {
      const left = pool.total - pool.elapsed;
      const fade = Math.min(1, Math.max(0, left / POOL_FADE_TICKS));
      for (let i = 0; i < pool.flames.length; i++) {
        const f = pool.flames[i]!;
        const flicker = 0.75 + 0.25 * Math.sin(now * 0.018 + pool.phase[i]!) + 0.12 * Math.sin(now * 0.041 + pool.phase[i]! * 2);
        f.scale.set(fade, flicker * fade, fade);
      }
    }

    const keep: Blast[] = [];
    for (const b of this.blasts) {
      const age = now - b.born;
      const tf = age / FLASH_MS;
      const ts = age / SMOKE_MS;
      if (!b.flash) {
        // smoke only
      } else if (tf < 1) {
        b.flash.scale.setScalar(b.radius * (0.3 + 0.7 * Math.sqrt(tf)));
        (b.flash.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - tf);
      } else {
        b.flash.visible = false;
      }
      for (const puff of b.smoke) {
        puff.scale.setScalar(0.6 + ts * 1.4);
        puff.position.y += 0.012;
        (puff.material as THREE.MeshBasicMaterial).opacity = 0.8 * Math.max(0, 1 - ts);
      }
      if (ts < 1) {
        keep.push(b);
      } else {
        if (b.flash) {
          this.group.remove(b.flash);
          (b.flash.material as THREE.Material).dispose();
        }
        this.group.remove(...b.smoke);
        for (const puff of b.smoke) (puff.material as THREE.Material).dispose();
      }
    }
    this.blasts = keep;
  }

  private addPool(z: ZoneSnapshot): Pool {
    const group = new THREE.Group();
    const h = this.heightAt(z.x, z.y);
    group.position.set(z.x, h, -z.y);
    const scorch = new THREE.Mesh(discGeo, scorchMat);
    scorch.scale.set(z.radius, 1, z.radius);
    scorch.position.y = 0.03;
    scorch.receiveShadow = true;
    group.add(scorch);
    const flames: THREE.Mesh[] = [];
    const phase: number[] = [];
    for (let i = 0; i < FLAMES; i++) {
      // A golden-angle scatter: even cover, a different look for every pool.
      const a = i * 2.39996 + z.id;
      const r = z.radius * 0.85 * Math.sqrt((i + 0.5) / FLAMES);
      const inner = i % 3 === 0;
      const f = new THREE.Mesh(flameGeo, inner ? flameInnerMat : flameOuterMat);
      f.position.set(Math.cos(a) * r, 0.03, Math.sin(a) * r);
      f.rotation.y = a;
      if (inner) f.position.y += 0.02;
      flames.push(f);
      phase.push(a * 3.7);
      group.add(f);
    }
    this.group.add(group);
    const pool: Pool = { group, flames, phase, elapsed: z.elapsed, total: z.total };
    this.pools.set(z.id, pool);
    return pool;
  }
}
