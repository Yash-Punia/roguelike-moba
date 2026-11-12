import type { LanePath } from '../data/map-geometry';
import { TICK_HZ, type Config } from '../data/schema';
import type { Entity } from '../sim/ecs';
import type { SimEvent } from '../sim/events';
import { Kind, Team, type EntitySnapshot, type Snapshot } from '../sim/sim';
import { sideOf } from './announcer';

export type PingKind = 'attack' | 'defend' | 'danger';
export interface Ping {
  kind: PingKind;
  x: number;
  y: number;
  /** Sim tick it disappears. */
  until: number;
}
type Bounds = Config['map']['bounds'];
type Point = { x: number; y: number };

/** UI timing, not gameplay: how long a ping lasts (ticks), the press that opens the picker, and how long the picker waits (ms). */
const PING_TICKS = 4 * TICK_HZ;
const LONG_PRESS_MS = 350;
const PICKER_MS = 3000;

const SURFACE: Record<string, string> = { grass: '#4a5230', dirt: '#6b5a44', trench: '#3a2e24', arena: '#57493a', crater: '#4a3b2e' };
const GROUND = '#22241c';
const LANE = '#9a8160';
const OURS = '#2f6bd6';
const THEIRS = '#d23c32';
const BRASS = '#d8a64a';
const RUBBLE = '#5c5a54';
const ALARM = '#ff4a3d';
const PING_COLOUR: Record<PingKind, string> = { attack: '#ee857d', defend: '#7fa8ee', danger: '#ffd24a' };

/** World (sim metres) → minimap pixels. The Red HQ is up for a Blue viewer; a Red viewer's map turns round, like its camera. */
export function toMinimap(x: number, y: number, b: Bounds, w: number, h: number, flip: boolean): Point {
  const px = ((x - b.minX) / (b.maxX - b.minX)) * w;
  const py = (1 - (y - b.minY) / (b.maxY - b.minY)) * h;
  return flip ? { x: w - px, y: h - py } : { x: px, y: py };
}

/** Minimap pixels → world. */
export function fromMinimap(px: number, py: number, b: Bounds, w: number, h: number, flip: boolean): Point {
  const fx = (flip ? w - px : px) / w;
  const fy = (flip ? h - py : py) / h;
  return { x: b.minX + fx * (b.maxX - b.minX), y: b.minY + (1 - fy) * (b.maxY - b.minY) };
}

/** A unit the viewer may see: its own team's always, an enemy's only if its team has sight of it (D-010). */
export function showsOnMinimap(e: EntitySnapshot, localTeam: Team): boolean {
  return e.hp > 0 && (e.team === localTeam || (e.visibleMask & (1 << localTeam)) !== 0);
}

export const livePings = (pings: readonly Ping[], tick: number) => pings.filter((p) => p.until > tick);

function drawPingShape(c: CanvasRenderingContext2D, kind: PingKind, x: number, y: number, r: number) {
  c.strokeStyle = c.fillStyle = PING_COLOUR[kind];
  c.lineWidth = Math.max(1.5, r / 3);
  c.beginPath();
  if (kind === 'attack') {
    c.moveTo(x - r, y - r);
    c.lineTo(x + r, y + r);
    c.moveTo(x + r, y - r);
    c.lineTo(x - r, y + r);
    c.stroke();
  } else if (kind === 'defend') {
    c.moveTo(x - r, y - r * 0.8);
    c.lineTo(x + r, y - r * 0.8);
    c.lineTo(x + r, y + r * 0.1);
    c.lineTo(x, y + r);
    c.lineTo(x - r, y + r * 0.1);
    c.closePath();
    c.stroke();
  } else {
    c.moveTo(x, y - r);
    c.lineTo(x + r, y + r * 0.8);
    c.lineTo(x - r, y + r * 0.8);
    c.closePath();
    c.fill();
  }
}

/**
 * The minimap (TDD §10, D-090): a canvas strip, redrawn at 10 Hz, so no draw calls on the 3D
 * side. Pings are local to this viewer, not sim state: bots don't react to them. Long-press
 * picks a ping; Alt + click pings Attack, Alt + Shift + click Danger (TDD §8).
 */
export function mountMinimap(layer: HTMLElement, config: Config, getLanes: () => readonly LanePath[], localTeam: Team) {
  const b = config.map.bounds;
  const flip = localTeam === Team.Red;
  // The enemy's colour follows the HUD's, so colour-blind mode turns it orange here too (D-114).
  const theirs = getComputedStyle(layer).getPropertyValue('--hud-red').trim() || THEIRS;
  const canvas = document.createElement('canvas');
  canvas.className = 'hud-minimap';
  layer.appendChild(canvas);
  const c = canvas.getContext('2d')!;
  const ground = document.createElement('canvas');
  const fog = document.createElement('canvas');
  let pings: Ping[] = [];
  let tick = 0;

  const at = (x: number, y: number) => toMinimap(x, y, b, canvas.width, canvas.height, flip);

  function drawGround() {
    const w = (ground.width = canvas.width);
    ground.height = canvas.height;
    const g = ground.getContext('2d')!;
    const perMetre = w / (b.maxX - b.minX);
    g.fillStyle = GROUND;
    g.fillRect(0, 0, w, ground.height);
    g.lineCap = g.lineJoin = 'round';
    const line = (pts: readonly Point[], width: number, colour: string) => {
      g.strokeStyle = colour;
      g.lineWidth = width * perMetre;
      g.beginPath();
      pts.forEach((p, i) => {
        const q = at(p.x, p.y);
        if (i === 0) g.moveTo(q.x, q.y);
        else g.lineTo(q.x, q.y);
      });
      g.stroke();
    };
    for (const s of config.map.walkable) {
      const colour = SURFACE[s.surface] ?? SURFACE.dirt!;
      if (s.shape === 'path') {
        line(s.points, s.width, colour);
        continue;
      }
      const q = at(s.x, s.y);
      g.fillStyle = colour;
      g.beginPath();
      if (s.shape === 'circle') g.arc(q.x, q.y, s.r * perMetre, 0, Math.PI * 2);
      else if (s.shape === 'ellipse') g.ellipse(q.x, q.y, (s.w / 2) * perMetre, (s.h / 2) * perMetre, 0, 0, Math.PI * 2);
      else g.rect(q.x - (s.w / 2) * perMetre, q.y - (s.h / 2) * perMetre, s.w * perMetre, s.h * perMetre);
      g.fill();
    }
    for (const lane of getLanes()) {
      for (const pts of lane.branches) {
        const points: Point[] = [];
        for (let k = 0; k + 1 < pts.length; k += 2) points.push({ x: pts[k]!, y: pts[k + 1]! });
        line(points, 1.6, LANE);
      }
    }
  }

  /** Fits the backing store to the element; the ground is redrawn only when that changes. */
  function fit() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (w === canvas.width && h === canvas.height && ground.width === w) return;
    canvas.width = w;
    canvas.height = h;
    drawGround();
  }

  /** Darkens what the viewer's team can't see, from the sim's vision grid, when fog is on. */
  function drawFog(snap: Snapshot) {
    const v = snap.vision;
    const seen = v.teams[localTeam];
    if (!config.combat.fog.enabled || !seen) return;
    if (fog.width !== v.cols || fog.height !== v.rows) {
      fog.width = v.cols;
      fog.height = v.rows;
    }
    const f = fog.getContext('2d')!;
    const img = f.createImageData(v.cols, v.rows);
    for (let row = 0; row < v.rows; row++) {
      for (let col = 0; col < v.cols; col++) {
        // Row 0 of the grid is the south edge; row 0 of the image is the top.
        img.data[((v.rows - 1 - row) * v.cols + col) * 4 + 3] = seen[row * v.cols + col] ? 0 : 150;
      }
    }
    f.putImageData(img, 0, 0);
    c.save();
    if (flip) {
      c.translate(canvas.width, canvas.height);
      c.rotate(Math.PI);
    }
    c.imageSmoothingEnabled = true;
    c.drawImage(fog, 0, 0, canvas.width, canvas.height);
    c.restore();
  }

  function dot(e: Point, r: number, colour: string, outline?: string) {
    const q = at(e.x, e.y);
    c.fillStyle = colour;
    c.beginPath();
    c.arc(q.x, q.y, r, 0, Math.PI * 2);
    c.fill();
    if (outline) {
      c.strokeStyle = outline;
      c.lineWidth = Math.max(1, r / 3);
      c.stroke();
    }
  }

  function draw(snap: Snapshot, localId: Entity | undefined) {
    tick = snap.tick;
    fit();
    const w = canvas.width;
    const unit = w / 28; // sizes follow the strip's width
    c.drawImage(ground, 0, 0);
    drawFog(snap);
    const colourOf = (e: EntitySnapshot) => (sideOf(e.team, localTeam) === 'ours' ? OURS : theirs);
    for (const e of snap.entities) {
      if (e.kind !== Kind.SubBase && e.kind !== Kind.HQ) continue;
      const s = (e.kind === Kind.HQ ? 2.2 : 1.6) * unit;
      const q = at(e.x, e.y);
      c.fillStyle = e.destroyed ? RUBBLE : colourOf(e);
      c.fillRect(q.x - s, q.y - s, s * 2, s * 2);
      if (e.underAttack && snap.tick % 12 < 6) {
        c.strokeStyle = ALARM;
        c.lineWidth = unit;
        c.strokeRect(q.x - s * 1.6, q.y - s * 1.6, s * 3.2, s * 3.2);
      }
    }
    for (const camp of snap.camps) {
      if (camp.members === 0 || !config.neutrals.camps[camp.kind].boss) continue;
      const q = at(camp.x, camp.y);
      const s = 2 * unit;
      c.fillStyle = BRASS;
      c.beginPath();
      c.moveTo(q.x, q.y - s);
      c.lineTo(q.x + s, q.y);
      c.lineTo(q.x, q.y + s);
      c.lineTo(q.x - s, q.y);
      c.closePath();
      c.fill();
    }
    for (const e of snap.entities) if (e.kind === Kind.Minion && showsOnMinimap(e, localTeam)) dot(e, 0.8 * unit, colourOf(e));
    for (const e of snap.entities) {
      if (e.kind !== Kind.Champion || !showsOnMinimap(e, localTeam)) continue;
      if (e.id === localId) dot(e, 2.2 * unit, colourOf(e), BRASS);
      else dot(e, 1.7 * unit, colourOf(e), '#101010');
    }
    pings = livePings(pings, snap.tick);
    for (const p of pings) {
      const q = at(p.x, p.y);
      drawPingShape(c, p.kind, q.x, q.y, 2.4 * unit);
      const age = 1 - (p.until - snap.tick) / PING_TICKS;
      c.strokeStyle = PING_COLOUR[p.kind];
      c.lineWidth = Math.max(1, unit / 2);
      c.globalAlpha = Math.max(0, 1 - age);
      c.beginPath();
      c.arc(q.x, q.y, (2.4 + 5 * age) * unit, 0, Math.PI * 2);
      c.stroke();
      c.globalAlpha = 1;
    }
  }

  function ping(kind: PingKind, x: number, y: number) {
    pings.push({ kind, x, y, until: tick + PING_TICKS });
  }

  // A long-press opens the three-way picker (GDD §3).
  const picker = document.createElement('div');
  picker.className = 'hud-ping-picker';
  picker.hidden = true;
  layer.appendChild(picker);
  let pressed: Point | undefined;
  let pressTimer = 0;
  let closeTimer = 0;
  const closePicker = () => {
    picker.hidden = true;
    clearTimeout(closeTimer);
  };
  for (const kind of ['attack', 'defend', 'danger'] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = kind;
    button.textContent = kind[0]!.toUpperCase() + kind.slice(1);
    button.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); // never spawn the joystick under it
      e.preventDefault();
      if (pressed) ping(kind, pressed.x, pressed.y);
      closePicker();
    });
    picker.appendChild(button);
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const world = fromMinimap(e.clientX - rect.left, e.clientY - rect.top, b, rect.width, rect.height, flip);
    if (e.altKey) {
      ping(e.shiftKey ? 'danger' : 'attack', world.x, world.y);
      return;
    }
    pressed = world;
    clearTimeout(pressTimer);
    pressTimer = window.setTimeout(() => {
      picker.hidden = false;
      clearTimeout(closeTimer);
      closeTimer = window.setTimeout(closePicker, PICKER_MS);
    }, LONG_PRESS_MS);
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) canvas.addEventListener(type, () => clearTimeout(pressTimer));

  return {
    draw,
    /** Your own structures under attack ping themselves (D-089). */
    onEvents(events: readonly SimEvent[], snap: Snapshot) {
      for (const ev of events) {
        if (ev.type !== 'baseUnderAttack' || sideOf(ev.team, localTeam) !== 'ours') continue;
        const s = snap.entities.find((e) => e.id === ev.id);
        if (s) pings.push({ kind: 'danger', x: s.x, y: s.y, until: snap.tick + PING_TICKS });
      }
    },
  };
}
