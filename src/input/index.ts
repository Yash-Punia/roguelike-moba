import type { Config } from '../data/schema';
import type { PlayerId, Team } from '../sim/sim';
import { buildCommand } from './command-builder';
import { createKeyboard } from './keyboard';
import { createJoystick } from './pointer-joystick';
import { createLatch, inputKindOf, type InputKind } from './ult-latch';

/** Local player input: samples keyboard and joystick once per tick into a Command. */
export function createInput(frame: HTMLElement, getConfig: () => Config['input'], player: PlayerId, team: Team) {
  const keyboard = createKeyboard();
  const joystick = createJoystick(frame, getConfig);
  const ult = createLatch();
  // The last kind of input used, for key hints on the HUD (TDD §10).
  let lastInput: InputKind = 'pointer';
  for (const type of ['keydown', 'pointerdown']) {
    addEventListener(type, (e) => (lastInput = inputKindOf(e.type) ?? lastInput), { capture: true });
  }

  return {
    sample(tick: number) {
      const stick = joystick.vector();
      const move = stick.x !== 0 || stick.y !== 0 ? stick : keyboard.vector();
      // Read both latches every tick so neither carries a stale press.
      const keyUlt = keyboard.takeUlt();
      const buttonUlt = ult.take();
      return buildCommand(tick, player, move, team, keyUlt || buttonUlt);
    },
    /** The on-screen Ultimate button was pressed (HUD gauge). */
    pressUlt: ult.press,
    get lastInput(): InputKind {
      return lastInput;
    },
  };
}
