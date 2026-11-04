import { keyVector, type Vec } from './command-builder';

const UP = ['KeyW', 'ArrowUp'];
const DOWN = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const MOVE_KEYS = new Set([...UP, ...DOWN, ...LEFT, ...RIGHT]);
const ULT_KEYS = new Set(['Space', 'KeyE']);
/** Draft cards 1–3 (TDD §8 control map). */
const PICK_KEYS: Record<string, 0 | 1 | 2> = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 };

export function createKeyboard() {
  const down = new Set<string>();
  let ultPressed = false;
  let pick: -1 | 0 | 1 | 2 = -1;
  let reroll = false;

  addEventListener('keydown', (e) => {
    if (ULT_KEYS.has(e.code) && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault(); // Space would scroll or click a focused button
      if (!e.repeat) ultPressed = true;
      return;
    }
    if (e.code === 'KeyR' && !(e.target instanceof HTMLInputElement)) {
      if (!e.repeat) reroll = true; // draft reroll (TDD §8 control map)
      return;
    }
    const slot = PICK_KEYS[e.code];
    if (slot !== undefined && !(e.target instanceof HTMLInputElement)) {
      if (!e.repeat) pick = slot;
      return;
    }
    if (!MOVE_KEYS.has(e.code) || e.target instanceof HTMLInputElement) return;
    down.add(e.code);
    e.preventDefault(); // arrow keys would scroll
  });
  addEventListener('keyup', (e) => down.delete(e.code));
  addEventListener('blur', () => down.clear()); // no stuck keys after alt-tab

  const any = (codes: string[]) => codes.some((c) => down.has(c));

  return {
    vector(): Vec {
      return keyVector(any(UP), any(DOWN), any(LEFT), any(RIGHT));
    },
    /** A draft card key (1–3) pressed since the last read, or −1. */
    takePick(): -1 | 0 | 1 | 2 {
      const p = pick;
      pick = -1;
      return p;
    },
    /** True once per R press (latched until read): reroll the live draft offer. */
    takeReroll(): boolean {
      const r = reroll;
      reroll = false;
      return r;
    },
    /** True once per Space/E press (latched until read). */
    takeUlt(): boolean {
      const p = ultPressed;
      ultPressed = false;
      return p;
    },
  };
}
