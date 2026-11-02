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
  let tappedCard: -1 | 0 | 1 | 2 = -1;
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
      const keyPick = keyboard.takePick();
      const pick = tappedCard >= 0 ? tappedCard : keyPick;
      tappedCard = -1;
      return buildCommand(tick, player, move, team, keyUlt || buttonUlt, pick);
    },
    /** A draft card was tapped (HUD tray); sent with the next command. */
    pickCard(slot: 0 | 1 | 2) {
      tappedCard = slot;
    },
    /** The on-screen Ultimate button was pressed (HUD gauge). */
    pressUlt: ult.press,
    get lastInput(): InputKind {
      return lastInput;
    },
  };
}
