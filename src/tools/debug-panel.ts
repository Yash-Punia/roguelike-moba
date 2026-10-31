import GUI from 'lil-gui';
import { configFiles, parseConfig } from '../data/load';
import type { Config, RawConfig } from '../data/schema';

export interface DebugHooks {
  raw: RawConfig;
  apply(config: Config): void;
  loop: { paused: boolean; timeScale: number };
  stats: { simMs: number };
  frame: HTMLElement;
}

/**
 * Dev tuning panel (TDD §11). Every value in the raw JSON configs is editable; each edit is
 * re-validated and applied to the running match. F1 or a three-finger tap toggles it.
 */
export function createDebugPanel({ raw, apply, loop, stats, frame }: DebugHooks) {
  const gui = new GUI({ title: 'Warfront debug' });
  gui.hide();
  let visible = false;
  const toggle = () => {
    visible = !visible;
    gui.show(visible);
  };
  addEventListener('keydown', (e) => {
    if (e.code !== 'F1') return;
    e.preventDefault();
    toggle();
  });
  addEventListener('touchstart', (e) => {
    if (e.touches.length === 3) toggle();
  });

  const match = gui.addFolder('Match');
  match.add(loop, 'paused');
  match.add(loop, 'timeScale', 0.25, 4, 0.25);

  const edits = structuredClone(raw);
  const onChange = () => {
    try {
      apply(parseConfig(edits));
    } catch (err) {
      console.error(err);
    }
  };
  for (const key of Object.keys(edits) as (keyof RawConfig)[]) {
    const folder = gui.addFolder(configFiles[key]).close();
    addFields(folder, edits[key] as Record<string, unknown>, onChange);
    folder.add({ export: () => download(configFiles[key], edits[key]) }, 'export').name(`Export ${configFiles[key]}`);
  }

  createFpsOverlay(frame, stats);
}

function addFields(folder: GUI, obj: Record<string, unknown>, onChange: () => void) {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
      folder.add(obj, k).onFinishChange(onChange);
    } else if (v && typeof v === 'object') {
      const label = (v as { id?: string }).id ?? k;
      addFields(folder.addFolder(label).close(), v as Record<string, unknown>, onChange);
    }
  }
}

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

function createFpsOverlay(frame: HTMLElement, stats: { simMs: number }) {
  const el = document.createElement('div');
  el.className = 'perf-overlay';
  frame.appendChild(el);
  let frames = 0;
  let worst = 0;
  let last = performance.now();
  let windowStart = last;
  const tick = (now: number) => {
    frames++;
    worst = Math.max(worst, now - last);
    last = now;
    if (now - windowStart >= 500) {
      const fps = (frames * 1000) / (now - windowStart);
      el.textContent = `${fps.toFixed(0)} fps · worst ${worst.toFixed(1)} ms · sim ${stats.simMs.toFixed(2)} ms`;
      frames = 0;
      worst = 0;
      windowStart = now;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
