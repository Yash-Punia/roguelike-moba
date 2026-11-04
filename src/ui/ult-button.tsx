import { render } from 'preact';
import { RING_LENGTH, RING_R, ultGaugeGeometry } from './ult-gauge';

/**
 * The Ultimate button (GDD §3, §11; TDD §10): a round brass pressure gauge at the bottom
 * right. The ring and needle fill clockwise as it charges; it glows and pulses when ready;
 * with no target in range it greys out with a crossed-circle icon. A small "Space" plate
 * shows while the last input was a keyboard.
 *
 * Rendered once with Preact; the per-tick values bypass the store and are written straight
 * into the DOM (TDD §10 "State flow"), so the ring moves smoothly without re-renders.
 */
export function mountUltGauge(frame: HTMLElement, sizePx: number, onPress: () => void) {
  const host = document.createElement('div');
  host.className = 'ult-gauge';
  host.style.setProperty('--gauge-size', `${Math.max(64, Math.round(sizePx))}px`);
  frame.appendChild(host);
  host.addEventListener('pointerdown', (e) => {
    e.stopPropagation(); // never spawn the joystick under the button
    e.preventDefault();
    onPress();
  });

  const ticks = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    return <line x1={50 + Math.sin(a) * 43} y1={50 - Math.cos(a) * 43} x2={50 + Math.sin(a) * 47} y2={50 - Math.cos(a) * 47} />;
  });
  render(
    <>
      <svg viewBox="0 0 100 100" aria-label="Ultimate" role="button">
        <circle class="bezel" cx="50" cy="50" r="48" />
        <circle class="face" cx="50" cy="50" r="44" />
        <g class="ticks">{ticks}</g>
        <circle class="track" cx="50" cy="50" r={RING_R} />
        <circle class="ring" cx="50" cy="50" r={RING_R} stroke-dasharray={RING_LENGTH} stroke-dashoffset={RING_LENGTH} transform="rotate(-90 50 50)" />
        <text class="label" x="50" y="62">ULT</text>
        <text class="charges" x="74" y="84">×2</text>
        <g class="needle">
          <polygon points="48.5,50 51.5,50 50,17" />
          <circle cx="50" cy="50" r="4" />
        </g>
        <g class="no-target-icon">
          <circle cx="76" cy="24" r="10" />
          <line x1="69" y1="31" x2="83" y2="17" />
        </g>
      </svg>
      <div class="key-hint">Space</div>
    </>,
    host,
  );
  const ring = host.querySelector<SVGCircleElement>('.ring')!;
  const needle = host.querySelector<SVGGElement>('.needle')!;
  const charges = host.querySelector<SVGTextElement>('.charges')!;
  let shown = -1;

  return {
    /** Every tick: charge (0–100 per stored charge; Overcharge stores 2, D-063) and whether the Ultimate has a target right now. */
    set(charge: number, targetable: boolean) {
      const c = Math.round(charge * 10) / 10;
      if (c !== shown) {
        shown = c;
        const g = ultGaugeGeometry(c);
        ring.setAttribute('stroke-dashoffset', g.dashOffset.toFixed(2));
        needle.setAttribute('transform', `rotate(${g.needleDeg.toFixed(1)} 50 50)`);
      }
      host.classList.toggle('ready', charge >= 100 && targetable);
      host.classList.toggle('no-target', !targetable);
      charges.style.display = charge >= 200 ? 'inline' : 'none'; // a second charge stored
    },
    /** Shows the "Space" key plate (last input was a keyboard). */
    keyHint(on: boolean) {
      host.classList.toggle('keys', on);
    },
    hide() {
      host.style.display = 'none';
    },
  };
}
