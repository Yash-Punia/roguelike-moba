const REASON = { hq: '', timeout: 'Time-out · ', surrender: 'Surrendered · ' } as const;

/**
 * Minimal end-of-match banner (D-038) until the M4 Results screen: VICTORY, DEFEAT or DRAW, how
 * it ended (time-out, surrender, D-068), the match time, the local champion's level and K/D/A, and
 * "Play again" (reloads the page).
 */
export function showEndBanner(frame: HTMLElement, result: 'won' | 'lost' | 'draw', reason: keyof typeof REASON, matchSeconds: number, level: number, kills: number, deaths: number, assists = 0) {
  const el = document.createElement('div');
  el.className = `end-banner ${result}`;
  const title = document.createElement('div');
  title.className = 'end-title';
  title.textContent = result === 'won' ? 'VICTORY' : result === 'lost' ? 'DEFEAT' : 'DRAW';
  const m = Math.floor(matchSeconds / 60);
  const s = Math.floor(matchSeconds % 60);
  const line = document.createElement('div');
  line.className = 'end-line';
  line.textContent = `${REASON[reason]}${m}:${String(s).padStart(2, '0')} · Level ${level} · K/D/A ${kills}/${deaths}/${assists}`;
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
