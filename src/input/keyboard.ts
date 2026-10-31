import { keyVector, type Vec } from './command-builder';

const UP = ['KeyW', 'ArrowUp'];
const DOWN = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const MOVE_KEYS = new Set([...UP, ...DOWN, ...LEFT, ...RIGHT]);

export function createKeyboard() {
  const down = new Set<string>();

  addEventListener('keydown', (e) => {
    if (!MOVE_KEYS.has(e.code)) return;
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
  };
}
