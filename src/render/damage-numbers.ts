import type { PerspectiveCamera } from 'three';
import { Vector3 } from 'three';
import { palette } from './palette';

// Presentation only (not gameplay numbers): how long a number lives and how far it rises.
const POOL = 48;
const LIFE_MS = 800;
const RISE_M = 1;
const CRIT_SCALE = 1.4;
/** Small sideways offsets so numbers from rapid hits don't stack on top of each other. */
const JITTER = [0, -0.35, 0.35, -0.17, 0.17];

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
export const damageColours = {
  /** Damage to the local player's team. */
  ally: '#ffffff',
  /** Damage to enemies. */
  enemy: hex(palette.hazard),
  absorbed: '#b8b4aa',
  /** Level-up callouts. */
  level: hex(palette.brass),
};

interface Floater {
  el: HTMLDivElement;
  /** World position (three space) at spawn. */
  x: number;
  y: number;
  z: number;
  born: number;
  scale: number;
  live: boolean;
}

/**
 * Floating damage numbers (GDD §10), pulled forward from the HUD feature (D-031). A pool of
 * absolutely positioned DOM labels over the canvas, projected from world space every frame.
 * Each rises and fades; the oldest is reused when the pool is full.
 */
export class DamageNumbers {
  private readonly floaters: Floater[] = [];
  private next = 0;
  private jitter = 0;
  private readonly v = new Vector3();

  constructor(container: HTMLElement) {
    const layer = document.createElement('div');
    layer.className = 'damage-numbers';
    container.appendChild(layer);
    for (let i = 0; i < POOL; i++) {
      const el = document.createElement('div');
      el.className = 'damage-number';
      el.style.display = 'none';
      layer.appendChild(el);
      this.floaters.push({ el, x: 0, y: 0, z: 0, born: 0, scale: 1, live: false });
    }
  }

  /** Shows `text` at three-space (x, y, z). */
  spawn(x: number, y: number, z: number, text: string, colour: string, critical: boolean, now: number) {
    const f = this.floaters[this.next]!;
    this.next = (this.next + 1) % POOL;
    const dx = JITTER[this.jitter++ % JITTER.length]!;
    Object.assign(f, { x: x + dx, y, z, born: now, scale: critical ? CRIT_SCALE : 1, live: true });
    f.el.textContent = text;
    f.el.style.color = colour;
    f.el.style.display = '';
  }

  /** Positions every live number; call after the camera has moved this frame. */
  update(camera: PerspectiveCamera, width: number, height: number, now: number) {
    for (const f of this.floaters) {
      if (!f.live) continue;
      const t = (now - f.born) / LIFE_MS;
      if (t >= 1) {
        f.live = false;
        f.el.style.display = 'none';
        continue;
      }
      this.v.set(f.x, f.y + RISE_M * (1 - (1 - t) * (1 - t)), f.z).project(camera);
      const sx = (this.v.x * 0.5 + 0.5) * width;
      const sy = (-this.v.y * 0.5 + 0.5) * height;
      const pop = t < 0.12 ? 1 + (0.12 - t) * 3 : 1; // a brief pop on spawn
      f.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -50%) scale(${(f.scale * pop).toFixed(3)})`;
      f.el.style.opacity = t < 0.6 ? '1' : ((1 - t) / 0.4).toFixed(3);
    }
  }
}
