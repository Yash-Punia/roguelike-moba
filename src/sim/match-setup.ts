import type { Config } from '../data/schema';
import { Team, type PlayerSetup } from './sim';

/** A champion slot: who plays it and the lane it starts in. */
export type Slot = PlayerSetup & { lane: string };

/**
 * One lane per champion, as evenly as possible (D-009, D-048): `first` (your lane) goes to slot 0,
 * then each slot takes the lane with the fewest champions so far, ties going to the centre and
 * then the map's other lanes in file order. 3 → centre, left, right; 5 → C C L L R.
 */
export function spreadLanes(laneIds: readonly string[], count: number, first?: string): string[] {
  const order = laneIds.includes('centre') ? ['centre', ...laneIds.filter((id) => id !== 'centre')] : [...laneIds];
  if (order.length === 0) return new Array<string>(count).fill('');
  const taken = new Map(order.map((id) => [id, 0]));
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let lane = order[0]!;
    if (i === 0 && first !== undefined && taken.has(first)) lane = first;
    else for (const id of order) if (taken.get(id)! < taken.get(lane)!) lane = id;
    taken.set(lane, taken.get(lane)! + 1);
    out.push(lane);
  }
  return out;
}

/**
 * Every champion slot of a match, indexed by player id (D-048): 0 is you, 1 the enemy in your
 * lane, then your team's other slots, then the enemy's. Both teams spread the same way, so each
 * lane faces an equal number. Champions cycle through the roster (duplicates allowed, D-009).
 */
export function matchSlots(config: Config, opts: { teamSize: number; localTeam: Team.Blue | Team.Red; localLane?: string }): Slot[] {
  const lanes = spreadLanes(config.map.lanes.map((l) => l.id), opts.teamSize, opts.localLane);
  const enemy = opts.localTeam === Team.Blue ? Team.Red : Team.Blue;
  const roster = config.champions;
  const slot = (team: Team.Blue | Team.Red, i: number): Slot => ({ team, championId: roster[i % roster.length]!.id, lane: lanes[i]! });
  const slots = [slot(opts.localTeam, 0), slot(enemy, 0)];
  for (let i = 1; i < opts.teamSize; i++) slots.push(slot(opts.localTeam, i));
  for (let i = 1; i < opts.teamSize; i++) slots.push(slot(enemy, i));
  return slots;
}
