import { hud } from './store';

/**
 * Draft tray (GDD §8, §10): three "field orders" cards slide up above the thumbs on a
 * level-up. Play never pauses; only the cards take taps. The recommended card is highlighted
 * and taken when the timer runs out; "+1" shows another offer waiting; the ⟳ icon spends the
 * match's free reroll (GDD §8 rule 6, §10).
 */
export function DraftTray({ onPick, onReroll }: { onPick: (slot: 0 | 1 | 2) => void; onReroll: () => void }) {
  const d = hud.draft.value;
  if (!d || hud.ended.value) return null;
  return (
    <div class="draft-tray">
      <div class="draft-head">
        <span class="draft-title">FIELD ORDERS</span>
        {d.queued > 0 && <span class="draft-queued">+{d.queued}</span>}
        {d.rerolls > 0 && (
          <button
            type="button"
            class="draft-reroll"
            title="Reroll these cards (once per match)"
            onPointerDown={(e) => {
              e.stopPropagation(); // never spawn the joystick under it
              e.preventDefault();
              onReroll();
            }}
          >
            ⟳{hud.keyHints.value && <span class="draft-key">R</span>}
          </button>
        )}
      </div>
      <div class="draft-timer">
        <div class="fill" style={{ width: `${Math.max(0, (d.secondsLeft / d.totalSeconds) * 100)}%` }} />
      </div>
      <div class="draft-cards">
        {d.cards.map((c, i) => (
          <button
            key={c.id}
            type="button"
            class={`draft-card ${c.rarity}${i === d.recommended ? ' recommended' : ''}`}
            onPointerDown={(e) => {
              e.stopPropagation(); // never spawn the joystick under a card
              e.preventDefault();
              onPick(i as 0 | 1 | 2);
            }}
          >
            {hud.keyHints.value && <span class="draft-key">{i + 1}</span>}
            <span class="draft-name">{c.name}</span>
            <span class="draft-text">{c.text}</span>
            {c.owned > 0 && (
              <span class="draft-owned">
                {c.owned}/{c.cap}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
