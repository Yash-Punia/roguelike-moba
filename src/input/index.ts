import type { Config } from '../data/schema';
import type { PlayerId, Team } from '../sim/sim';
import { buildCommand } from './command-builder';
import { createKeyboard } from './keyboard';
import { createJoystick } from './pointer-joystick';
import { createUltButton } from './ult-button';

/** Local player input: samples keyboard and joystick once per tick into a Command. */
export function createInput(frame: HTMLElement, getConfig: () => Config['input'], player: PlayerId, team: Team) {
  const keyboard = createKeyboard();
  const joystick = createJoystick(frame, getConfig);
  const ultButton = createUltButton(frame);

  return {
    sample(tick: number) {
      const stick = joystick.vector();
      const move = stick.x !== 0 || stick.y !== 0 ? stick : keyboard.vector();
      // Read both latches every tick so neither carries a stale press.
      const keyUlt = keyboard.takeUlt();
      const buttonUlt = ultButton.takeUlt();
      return buildCommand(tick, player, move, team, keyUlt || buttonUlt);
    },
    /** The temporary Ultimate button, for the app to show charge on. */
    ultButton,
  };
}
