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

export type InputKind = 'keyboard' | 'pointer';

/** Which kind of input a DOM event counts as, for key hints (TDD §10); undefined for others. */
export function inputKindOf(eventType: string): InputKind | undefined {
  if (eventType === 'keydown') return 'keyboard';
  if (eventType === 'pointerdown' || eventType === 'touchstart') return 'pointer';
  return undefined;
}
