import { keyVector, type Vec } from './command-builder';

const UP = ['KeyW', 'ArrowUp'];
const DOWN = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const MOVE_KEYS = new Set([...UP, ...DOWN, ...LEFT, ...RIGHT]);
const ULT_KEYS = new Set(['Space', 'KeyE']);

export function createKeyboard() {
  const down = new Set<string>();
  let ultPressed = false;

  addEventListener('keydown', (e) => {
    if (ULT_KEYS.has(e.code) && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault(); // Space would scroll or click a focused button
      if (!e.repeat) ultPressed = true;
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
    /** True once per Space/E press (latched until read). */
    takeUlt(): boolean {
      const p = ultPressed;
      ultPressed = false;
      return p;
    },
  };
}
