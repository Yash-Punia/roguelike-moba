import { TICK_HZ } from '../data/schema';

const TICK_MS = 1000 / TICK_HZ;
const MAX_STEPS_PER_FRAME = 5;

export interface LoopHooks {
  /** Advance the sim exactly one tick. */
  step(): void;
  /** Draw with alpha in [0, 1) between the last two ticks. */
  draw(alpha: number): void;
}

/** Fixed-tick loop with render interpolation (TDD §4). */
export function startLoop(hooks: LoopHooks) {
  const state = { paused: false, timeScale: 1 };
  let acc = 0;
  let last = performance.now();

  // Offline build: pause while the tab is hidden.
  document.addEventListener('visibilitychange', () => {
    state.paused = document.hidden;
    last = performance.now();
  });

  function frame(now: number) {
    if (!state.paused) {
      acc += Math.min(now - last, 250) * state.timeScale; // clamp after tab switches
      let steps = 0;
      while (acc >= TICK_MS && steps < MAX_STEPS_PER_FRAME) {
        hooks.step();
        acc -= TICK_MS;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) acc %= TICK_MS; // spiral-of-death guard: drop the backlog
    }
    last = now;
    hooks.draw(acc / TICK_MS);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return state;
}
