/**
 * Minimal end-of-match banner (D-038) until the M4 Results screen: VICTORY or DEFEAT, the
 * match time, the local champion's level and K/D, and "Play again" (reloads the page).
 */
export function showEndBanner(frame: HTMLElement, won: boolean, matchSeconds: number, level: number, kills: number, deaths: number) {
  const el = document.createElement('div');
  el.className = `end-banner ${won ? 'won' : 'lost'}`;
  const title = document.createElement('div');
  title.className = 'end-title';
  title.textContent = won ? 'VICTORY' : 'DEFEAT';
  const m = Math.floor(matchSeconds / 60);
  const s = Math.floor(matchSeconds % 60);
  const line = document.createElement('div');
  line.className = 'end-line';
  line.textContent = `${m}:${String(s).padStart(2, '0')} · Level ${level} · K/D ${kills}/${deaths}`;
  const again = document.createElement('button');
  again.type = 'button';
  again.className = 'end-again';
  again.textContent = 'Play again';
  again.addEventListener('click', () => location.reload());
  el.append(title, line, again);
  // Keep presses from reaching the joystick underneath.
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  frame.appendChild(el);
  return el;
}
