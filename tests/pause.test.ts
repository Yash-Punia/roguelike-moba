import { afterEach, describe, expect, it, vi } from 'vitest';
import { startLoop } from '../src/app/loop';

/** A fake browser frame loop: `frames(n)` runs n frames of 34 ms (just over a tick). */
function run() {
  let frame: FrameRequestCallback = () => {};
  let onVisibility = () => {};
  const doc = { hidden: false, addEventListener: (_: string, f: () => void) => (onVisibility = f) };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frame = cb;
    return 0;
  });
  let now = performance.now();
  let steps = 0;
  const loop = startLoop({ step: () => steps++, draw: () => {} });
  const frames = (n: number) => {
    for (let i = 0; i < n; i++) frame((now += 34));
  };
  const setHidden = (hidden: boolean) => {
    doc.hidden = hidden;
    onVisibility();
  };
  return { loop, frames, setHidden, steps: () => steps };
}

afterEach(() => vi.unstubAllGlobals());

describe('the pause menu holds the loop (D-092)', () => {
  it('stops stepping while held, and carries on after', () => {
    const f = run();
    f.frames(5);
    const before = f.steps();
    expect(before).toBeGreaterThan(0);
    f.loop.held = true;
    f.frames(10);
    expect(f.steps()).toBe(before);
    f.loop.held = false;
    f.frames(5);
    expect(f.steps()).toBeGreaterThan(before);
  });

  it('stays held when the player comes back to the tab', () => {
    const f = run();
    f.loop.held = true;
    f.setHidden(true);
    f.setHidden(false);
    expect(f.loop.paused).toBe(false);
    f.frames(10);
    expect(f.steps()).toBe(0);
  });
});
