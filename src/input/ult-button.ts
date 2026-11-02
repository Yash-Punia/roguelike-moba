/**
 * Temporary Ultimate button (bottom right) until the HUD's brass gauge (M2 feature 14). A
 * press latches until the next command sample. It stops the press reaching the joystick, so
 * a thumb on the button never spawns the stick.
 */
export function createUltButton(frame: HTMLElement) {
  const el = document.createElement('button');
  el.className = 'ult-button';
  el.type = 'button';
  el.setAttribute('aria-label', 'Ultimate');
  el.textContent = 'ULT';
  frame.appendChild(el);
  let pressed = false;
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    pressed = true;
  });

  return {
    el,
    takeUlt(): boolean {
      const p = pressed;
      pressed = false;
      return p;
    },
    /** Shows charge (0–100) as the ring fill; glows when full with a target, greys without one. */
    show(charge: number, targetable: boolean) {
      el.style.setProperty('--charge', `${Math.floor(charge)}%`);
      el.classList.toggle('ready', charge >= 100 && targetable);
      el.classList.toggle('no-target', !targetable);
    },
  };
}
