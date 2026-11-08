import { describe, expect, it } from 'vitest';
import { maps, parseConfig, rawConfig } from '../src/data/load';
import { createBot } from '../src/sim/bots/bot';
import { Squad } from '../src/sim/bots/squad';
import { matchSlots } from '../src/sim/match-setup';
import { createSim, Kind, Team, type Command } from '../src/sim/sim';

/**
 * The Front, 3v3, no waves or camps: only Blue's bots play; Red's champions stand where they
 * are put. `hold` keeps the listed Red champions at full HP so they stay a threat.
 */
function front() {
  const config = parseConfig({ ...rawConfig, map: maps[3] });
  config.waves.enabled = false;
  config.map.camps = [];
  config.bots.hesitation.chance = 0;
  Object.assign(config.bots.defend, { maxDefenders: 2, maxTravel: 60, minHpPct: 0.5, releaseSeconds: 120, margin: 2 });
  Object.assign(config.bots.outnumbered, { radius: 12, margin: 1, desire: 0.92 });
  const slots = matchSlots(config, { teamSize: 3, localTeam: Team.Blue });
  const sim = createSim(config, 1, slots);
  const squad = new Squad();
  const blue = slots.flatMap((s, pl) =>
    s.team === Team.Blue ? [{ pl, home: s.lane, bot: createBot(pl, s.team, () => config, () => sim.lanes, sim.rng.ai, s.lane, squad, () => sim.grid), e: sim.entityOf(pl)! }] : [],
  );
  const red = slots.flatMap((s, pl) => (s.team === Team.Red ? [sim.entityOf(pl)!] : []));
  const hold: number[] = [];
  let snap = sim.snapshot();
  const step = (ticks: number, until?: () => boolean) => {
    for (let i = 0; i < ticks && !(until?.() ?? false); i++) {
      for (const e of hold) sim.stores.healths.get(e)!.hp = 1e5;
      const commands: Command[] = blue.map((b) => ({ ...b.bot.command(snap, sim.tick, b.e) }));
      sim.step(commands);
      snap = sim.snapshot();
    }
  };
  const move = (e: number, x: number, y: number) => Object.assign(sim.stores.transforms.get(e)!, { x, y });
  const at = (e: number) => snap.entities.find((s) => s.id === e)!;
  return { config, sim, squad, blue, red, hold, step, move, at, snap: () => snap };
}

describe('bots defend other lanes (D-083)', () => {
  it('sends the nearest free bot to a Sub-base two enemy champions are at, and home once it is safe', () => {
    const f = front();
    f.step(15 * 30); // into their lanes
    const left = f.blue.find((b) => b.home === 'left')!;
    const sub = f.snap().entities.find((e) => e.kind === Kind.SubBase && e.team === Team.Blue && e.lane === 'left')!;
    // Two Red champions at the Blue left Sub-base; the left bot is already there, so one more is wanted.
    f.move(f.red[0]!, sub.x, sub.y + 6);
    f.move(f.red[1]!, sub.x + 1.5, sub.y + 6);
    f.hold.push(f.red[0]!, f.red[1]!);
    f.step(30, () => f.squad.defences.length > 0);
    expect(f.squad.defences).toHaveLength(1);
    f.step(1); // a bot takes up its new lane on its next command
    const sent = f.blue.filter((b) => b !== left && b.bot.lane === 'left');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.home).toBe('centre'); // nearer than the right lane's bot
    // It walks there through the trenches.
    const reach = f.config.structures.subBase.weapon.range + 2;
    f.step(25 * 30, () => Math.hypot(f.at(sent[0]!.e).x - sub.x, f.at(sent[0]!.e).y - sub.y) <= reach);
    expect(Math.hypot(f.at(sent[0]!.e).x - sub.x, f.at(sent[0]!.e).y - sub.y)).toBeLessThanOrEqual(reach);
    // Threat gone: released home after `releaseSeconds`.
    f.hold.length = 0;
    f.move(f.red[0]!, 0, 70);
    f.move(f.red[1]!, 2, 70);
    f.config.bots.defend.releaseSeconds = 30;
    f.step(3 * 30);
    expect(sent[0]!.bot.lane).toBe('centre');
    expect(f.squad.defences).toHaveLength(0);
  }, 30_000);

  it('ignores the HQ while it is invulnerable', () => {
    const f = front();
    f.step(15 * 30);
    const hq = f.snap().entities.find((e) => e.kind === Kind.HQ && e.team === Team.Blue)!;
    expect(hq.invulnerable).toBe(true);
    f.move(f.red[0]!, hq.x, hq.y + 7);
    f.hold.push(f.red[0]!);
    f.step(2 * 30);
    expect(f.squad.defences).toHaveLength(0);
    expect(f.blue.every((b) => b.bot.lane === b.home)).toBe(true);
  }, 30_000);
});

describe('bots back off when outnumbered (D-083)', () => {
  it.each([
    [2, true],
    [1, false],
  ] as const)('%d enemy champion(s) in reach of a lone bot: backs off %s', (count, backs) => {
    const f = front();
    f.step(15 * 30);
    const mid = f.blue.find((b) => b.home === 'centre')!;
    const me = f.at(mid.e);
    for (let i = 0; i < count; i++) f.move(f.red[i]!, me.x + 1.5 * i, me.y + 7);
    f.step(10);
    expect(mid.bot.desires.backoff >= f.config.bots.outnumbered.desire).toBe(backs);
    if (backs) {
      expect(mid.bot.mode).toBe('backoff');
      expect(mid.bot.desires.trade + mid.bot.desires.allin).toBe(0);
    } else expect(mid.bot.desires.trade + mid.bot.desires.allin).toBeGreaterThan(0);
  }, 30_000);

  it('holds under its own tower against two', () => {
    const f = front();
    f.step(15 * 30);
    const mid = f.blue.find((b) => b.home === 'centre')!;
    const sub = f.snap().entities.find((e) => e.kind === Kind.SubBase && e.team === Team.Blue && e.lane === 'centre')!;
    f.move(mid.e, sub.x, sub.y + 3);
    f.move(f.red[0]!, sub.x, sub.y + 7);
    f.move(f.red[1]!, sub.x + 1.5, sub.y + 7);
    f.step(10);
    expect(mid.bot.desires.backoff).toBeLessThan(f.config.bots.outnumbered.desire);
    expect(mid.bot.mode).toBe('defend');
  }, 30_000);
});
