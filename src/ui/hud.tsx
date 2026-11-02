import { render } from 'preact';
import { hud, type StructureView } from './store';
import { DraftTray } from './draft-tray';

/** HP per segment on the HUD bar, the same rule as the world bars (GDD §11). */
const SEGMENT_HP = 250;

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Rank chevrons (GDD §11 "Level badge"): one per 3 levels, gold at the max level. */
function Chevrons({ level }: { level: number }) {
  const count = Math.max(1, Math.ceil(level / 3));
  return (
    <svg class={`hud-chevrons${level >= 12 ? ' gold' : ''}`} viewBox={`0 0 20 ${count * 7 + 2}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <polyline points={`2,${i * 7 + 6} 10,${i * 7 + 1} 18,${i * 7 + 6}`} />
      ))}
    </svg>
  );
}

function Structure({ s }: { s: StructureView }) {
  const pips = [0.25, 0.5, 0.75, 1].map((t) => s.hp >= t - 0.125 && !s.destroyed);
  return (
    <div class={`hud-structure ${s.kind}${s.destroyed ? ' destroyed' : ''}${s.shielded ? ' shielded' : ''}`}>
      <div class="hud-structure-icon" />
      <div class="hud-pips">
        {pips.map((on) => (
          <i class={on ? 'on' : ''} />
        ))}
      </div>
    </div>
  );
}

function TopStrip() {
  const { ours, theirs } = hud.score.value;
  return (
    <div class="hud-top">
      <div class="hud-side ours">
        {hud.ours.value.map((s) => (
          <Structure key={s.id} s={s} />
        ))}
      </div>
      <div class="hud-centre">
        <div class="hud-timer">{clock(hud.seconds.value)}</div>
        <div class="hud-score">
          <span class="ours">{ours}</span> · <span class="theirs">{theirs}</span>
        </div>
      </div>
      <div class="hud-side theirs">
        {hud.theirs.value.map((s) => (
          <Structure key={s.id} s={s} />
        ))}
      </div>
    </div>
  );
}

function Vitals() {
  const hp = hud.hp.value;
  const max = hud.maxHp.value;
  const level = hud.level.value;
  const ticks = [];
  for (let at = SEGMENT_HP; at < max; at += SEGMENT_HP) ticks.push(<i style={{ left: `${(at / max) * 100}%` }} />);
  return (
    <div class="hud-vitals">
      <div class="hud-level">
        <Chevrons level={level} />
        <span>{level}</span>
      </div>
      <div class="hud-bars">
        <div class="hud-hp">
          <div class="fill" style={{ width: `${max > 0 ? (hp / max) * 100 : 0}%` }} />
          {ticks}
          <span class="hud-hp-text">
            {hp} / {max}
          </span>
        </div>
        <div class="hud-xp">
          <div class="fill" style={{ width: `${hud.xpFraction.value * 100}%` }} />
        </div>
      </div>
    </div>
  );
}

function Hud({ onPick }: { onPick: (slot: 0 | 1 | 2) => void }) {
  return (
    <>
      <TopStrip />
      <Vitals />
      <DraftTray onPick={onPick} />
    </>
  );
}

/** Mounts the HUD layer over the canvas (TDD §10). Only the draft cards take pointer input. */
export function mountHud(frame: HTMLElement, onPick: (slot: 0 | 1 | 2) => void) {
  const layer = document.createElement('div');
  layer.className = 'hud';
  frame.appendChild(layer);
  render(<Hud onPick={onPick} />, layer);
  return layer;
}
