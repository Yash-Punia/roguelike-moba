/** A press that holds until the next command sample reads it, so a tap between ticks is never lost or doubled. */
export function createLatch() {
  let pressed = false;
  return {
    press() {
      pressed = true;
    },
    /** True once per press. */
    take(): boolean {
      const p = pressed;
      pressed = false;
      return p;
    },
  };
}

/**
 * Hold-to-cast (TDD §8, D-113): `down` starts a hold, and `fire` runs only if it lasts
 * `holdMs()` without an `up`. A hold of 0 fires at once, so the button stays a plain tap.
 */
export function createHold(holdMs: () => number, fire: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const up = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return {
    /** Returns whether a hold started (false: it fired at once). */
    down(): boolean {
      up();
      const ms = holdMs();
      if (ms <= 0) {
        fire();
        return false;
      }
      timer = setTimeout(() => {
        timer = undefined;
        fire();
      }, ms);
      return true;
    },
    up,
  };
}

export type InputKind = 'keyboard' | 'pointer';

/** Which kind of input a DOM event counts as, for key hints (TDD §10); undefined for others. */
export function inputKindOf(eventType: string): InputKind | undefined {
  if (eventType === 'keydown') return 'keyboard';
  if (eventType === 'pointerdown' || eventType === 'touchstart') return 'pointer';
  return undefined;
}
