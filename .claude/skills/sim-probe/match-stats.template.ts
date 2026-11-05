// Copy to tests/tmp-match-stats.test.ts, edit, run with --silent=false, delete before committing.
import { it } from 'vitest';
import { maps, parseConfig, rawConfig } from '../src/data/load';
import { createBot } from '../src/sim/bots/bot';
import { Squad } from '../src/sim/bots/squad';
import { matchSlots } from '../src/sim/match-setup';
import { createSim, Team, type Command } from '../src/sim/sim';

const SEEDS = 10;
const TEAM_SIZE = 3;

it('match stats', () => {
  for (const lanes of [3, 2] as const) {
    const rows: string[] = [];
    const ends: number[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const config = parseConfig({ ...rawConfig, map: maps[lanes] });
      const slots = matchSlots(config, { teamSize: TEAM_SIZE, localTeam: Team.Blue });
      const sim = createSim(config, seed, slots);
      const squads = [new Squad(), new Squad()];
      const bots = slots.map((s, pl) => ({
        bot: createBot(pl, s.team, () => config, () => sim.lanes, sim.rng.ai, s.lane, squads[s.team], () => sim.grid),
        e: sim.entityOf(pl)!,
      }));
      let snap = sim.snapshot();
      // Counters: edit to what you are measuring.
      const clears = [0, 0];
      let firstClear = 0;
      while (sim.match.phase !== 'ended' && sim.tick < 13 * 60 * 30) {
        const commands: Command[] = bots.map((b) => ({ ...b.bot.command(snap, sim.tick, b.e) }));
        for (const ev of sim.step(commands).events) {
          if (ev.type === 'campCleared' && ev.team !== undefined) {
            clears[ev.team]!++;
            firstClear ||= sim.tick;
          }
        }
        snap = sim.snapshot();
      }
      const minutes = sim.tick / 1800;
      ends.push(minutes);
      const levels = snap.entities.filter((e) => e.kind === 0).map((e) => e.level).join(',');
      rows.push(`seed ${seed}: ${minutes.toFixed(2)} min, winner ${sim.match.winner}, clears B${clears[0]} R${clears[1]}, first ${(firstClear / 30).toFixed(0)} s, levels ${levels}`);
    }
    ends.sort((a, b) => a - b);
    console.log(`lanes ${lanes}: median ${ends[Math.floor(ends.length / 2)]!.toFixed(2)} min, range ${ends[0]!.toFixed(2)}–${ends.at(-1)!.toFixed(2)}\n${rows.join('\n')}`);
  }
}, 600_000);
