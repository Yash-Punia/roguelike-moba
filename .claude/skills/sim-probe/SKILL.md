---
name: sim-probe
description: Measure or debug sim behaviour headlessly with throwaway Vitest probes - all-bot match stats over many seeds (match length, camp clears, levels, stuck bots), or a tick-by-tick trace of one scenario. Use to tune numbers, compare before and after a change, or find why units or bots misbehave.
---

# Probe the sim headlessly

The sim is deterministic and DOM-free, so the fastest way to see what it does is a throwaway Vitest file. Nothing like this is committed: name it `tests/tmp-*.test.ts` and delete it before shipping.

## Run

```bash
npx vitest run tests/tmp-probe.test.ts --silent=false 2>&1 | grep -E "^(lanes|seed|T |EV )" | cut -c1-250
```

- `--silent=false` is required: the project's Vitest config hides `console.log`.
- `grep` for the prefixes you print, so the reporter noise goes away.
- Give long runs a timeout argument on `it` (`600_000`), and the Bash call a long timeout.

## All-bot match stats

Copy [match-stats.template.ts](match-stats.template.ts) to `tests/tmp-match-stats.test.ts` and edit the counters. It runs all-bot 3v3s on both maps for N seeds, with the same setup as `src/app/main.ts` (squads, `sim.grid`, bots answering the previous snapshot), and prints per-seed lines and the median match length.

- **Before and after:** run it, change the code or `/data`, and run it again with the same seeds.
- **Baseline without a feature:** change the bot call (e.g. pass `undefined` instead of `squads[s.team]` to turn off camp farming).
- **Pacing guard:** `tests/pacing.test.ts` only checks that matches end inside 12 minutes. Report the median and range in the DECISIONS entry (D-066 and D-075 have examples).

## One scenario, traced

Build it with `arena(units, tweak)` from `tests/helpers.ts`:
- open test map, Blue Alpha at the origin as `a.shooter`, pinned combat numbers;
- `tweak` edits the config before the sim is created (e.g. `c.map.camps = [...]`, `c.combat.fog.enabled = true`);
- `a.move(id, x, y)` teleports; `a.hp(id, value?)` reads or sets HP.

Then step it and print on state changes:

```ts
let last = -1;
for (let i = 0; i < 400; i++) {
  a.sim.step([]);
  const c = a.sim.camps[0]!;
  if (c.state !== last) {
    last = c.state;
    console.log('T', a.sim.tick, c.state, c.attackers.join(','));
  }
}
```

- Arena champions respawn, so stop a duel at the first `death` event without a `unit` field (a champion), not when one is at 0 HP.
- Grid and flow-field problems: dump an ASCII map around the spot (`#` blocked, `+` inside the wall margin, letters for field cost) from `sim.grid` and `new Nav(grid, clearance)`.
- Bots read `sim.snapshot()`; `snapshot.camps`, `squads[t].plans` and `bot.mode` show what they think.

## Keep

When a probe finds a rule worth keeping, turn it into a real test in the right `tests/*.test.ts` with pinned numbers (the `pinNeutrals` style in `tests/camps.test.ts`), or with the shipped data when the point is the balance itself.
