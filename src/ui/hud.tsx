import { render } from 'preact';
import { useSignal } from '@preact/signals';
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
        {hud.suddenDeath.value && <div class="hud-sudden-death">SUDDEN DEATH</div>}
        <button
          type="button"
          class="hud-score"
          aria-label="Scoreboard"
          onPointerDown={(e) => {
            e.stopPropagation(); // never spawn the joystick under it
            e.preventDefault();
            hud.boardOpen.value = !hud.boardOpen.value;
          }}
        >
          <span class="ours">{ours}</span> · <span class="theirs">{theirs}</span>
        </button>
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

/** Surrender (GDD §2), from 5:00 until the M4 pause menu takes it: the first tap asks, a second within 3 s concedes. */
function SurrenderButton({ onSurrender }: { onSurrender: () => void }) {
  const confirming = useSignal(false);
  if (!hud.canSurrender.value || hud.ended.value) return null;
  return (
    <button
      type="button"
      class={`hud-surrender${confirming.value ? ' confirm' : ''}`}
      onPointerDown={(e) => {
        e.stopPropagation(); // never spawn the joystick under it
        e.preventDefault();
        if (confirming.value) {
          onSurrender();
          return;
        }
        confirming.value = true;
        setTimeout(() => (confirming.value = false), 3000);
      }}
    >
      {confirming.value ? 'Confirm?' : 'Surrender'}
    </button>
  );
}

/** Who killed whom, with a headline for the big moments (D-088). */
function KillBanner() {
  const k = hud.kill.value;
  if (!k || hud.ended.value || hud.boardOpen.value) return null;
  return (
    <div key={k.id} class="hud-kill" role="status">
      {k.headline && <div class="hud-kill-headline">{k.headline}</div>}
      <div class="hud-kill-line">
        {k.parts.map((p) => (
          <span class={p.side}>{p.text}</span>
        ))}
      </div>
    </div>
  );
}

/** One short banner at a time, for match events (TDD §10). */
function Notice() {
  const n = hud.notice.value;
  if (!n || hud.ended.value || hud.boardOpen.value) return null;
  return (
    <div key={n.id} class={`hud-notice ${n.tone}`} role="status">
      {n.text}
    </div>
  );
}

/** The countdown while knocked out, and who did it; a team-coloured badge stands in for a portrait. */
function RespawnOverlay() {
  const r = hud.respawn.value;
  if (!r || hud.ended.value) return null;
  return (
    <div class="hud-respawn">
      <div class="hud-respawn-label">REDEPLOYING IN</div>
      <div class="hud-respawn-seconds">{r.seconds}</div>
      {r.killerName && (
        <div class={`hud-respawn-killer ${r.killerSide}`}>
          <i />
          {r.killerName}
        </div>
      )}
    </div>
  );
}

/** All champions (TDD §10): hold Tab, or tap the score. No power icons exist yet, so powers are a count per rarity. */
function Scoreboard() {
  if (!hud.boardOpen.value || hud.ended.value) return null;
  return (
    <div class="hud-board">
      <table>
        <thead>
          <tr>
            <th>Champion</th>
            <th>Lv</th>
            <th>K</th>
            <th>D</th>
            <th>A</th>
            <th>Powers</th>
          </tr>
        </thead>
        <tbody>
          {hud.board.value.map((r) => (
            <tr key={r.id} class={`${r.side}${r.me ? ' me' : ''}${r.down ? ' down' : ''}`}>
              <td>{r.name}</td>
              <td>{r.level}</td>
              <td>{r.kills}</td>
              <td>{r.deaths}</td>
              <td>{r.assists}</td>
              <td class="hud-board-powers">
                <span class="common">{r.powers.common}</span>
                <span class="rare">{r.powers.rare}</span>
                <span class="epic">{r.powers.epic}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Hud({ onPick, onReroll, onSurrender }: { onPick: (slot: 0 | 1 | 2) => void; onReroll: () => void; onSurrender: () => void }) {
  return (
    <>
      <TopStrip />
      <KillBanner />
      <Notice />
      <RespawnOverlay />
      <Scoreboard />
      <SurrenderButton onSurrender={onSurrender} />
      <Vitals />
      <DraftTray onPick={onPick} onReroll={onReroll} />
    </>
  );
}

/** Mounts the HUD layer over the canvas (TDD §10). Only the draft cards and the buttons take pointer input. */
export function mountHud(frame: HTMLElement, onPick: (slot: 0 | 1 | 2) => void, onReroll: () => void = () => {}, onSurrender: () => void = () => {}) {
  const layer = document.createElement('div');
  layer.className = 'hud';
  frame.appendChild(layer);
  addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    e.preventDefault(); // Tab shows the scoreboard, not the browser's focus ring
    hud.boardOpen.value = true;
  });
  addEventListener('keyup', (e) => {
    if (e.key === 'Tab') hud.boardOpen.value = false;
  });
  render(<Hud onPick={onPick} onReroll={onReroll} onSurrender={onSurrender} />, layer);
  return layer;
}
