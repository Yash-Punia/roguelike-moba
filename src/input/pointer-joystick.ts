import type { Config } from '../data/schema';
import { shapeStick, type Vec } from './command-builder';

type InputConfig = Config['input'];

/**
 * Floating joystick (GDD §3, TDD §8): spawns under the pointer anywhere in the zone of the
 * frame (the whole screen, D-098); HUD controls stop their own pointerdowns from reaching it.
 * Works for touch, mouse and pen via Pointer Events.
 * It owns one pointerId, so another finger can use the rest of the screen.
 */
export function createJoystick(frame: HTMLElement, getConfig: () => InputConfig) {
  const base = document.createElement('div');
  const knob = document.createElement('div');
  base.className = 'stick-base';
  knob.className = 'stick-knob';
  base.appendChild(knob);
  frame.appendChild(base);

  let pointerId: number | null = null;
  let ox = 0;
  let oy = 0;
  let dx = 0;
  let dy = 0;

  frame.addEventListener('pointerdown', (e) => {
    if (pointerId !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const cfg = getConfig();
    const r = frame.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    if (fx > cfg.zoneWidthPct || fy < 1 - cfg.zoneHeightPct) return;
    pointerId = e.pointerId;
    frame.setPointerCapture(e.pointerId);
    ox = e.clientX - r.left;
    oy = e.clientY - r.top;
    dx = dy = 0;
    const size = cfg.ringRadiusPx * 2;
    Object.assign(base.style, {
      display: 'block',
      width: `${size}px`,
      height: `${size}px`,
      left: `${ox - cfg.ringRadiusPx}px`,
      top: `${oy - cfg.ringRadiusPx}px`,
    });
    moveKnob(cfg);
  });

  frame.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId) return;
    const r = frame.getBoundingClientRect();
    dx = e.clientX - r.left - ox;
    dy = e.clientY - r.top - oy;
    moveKnob(getConfig());
  });

  const release = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    dx = dy = 0;
    base.style.display = 'none';
  };
  frame.addEventListener('pointerup', release);
  frame.addEventListener('pointercancel', release);

  function moveKnob(cfg: InputConfig) {
    const d = Math.hypot(dx, dy);
    const k = d > cfg.ringRadiusPx ? cfg.ringRadiusPx / d : 1;
    knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
  }

  return {
    vector(): Vec {
      if (pointerId === null) return { x: 0, y: 0 };
      const cfg = getConfig();
      return shapeStick(dx, dy, cfg.deadZoneMm * cfg.pxPerMm, cfg.ringRadiusPx * cfg.fullSpeedPct);
    },
  };
}
