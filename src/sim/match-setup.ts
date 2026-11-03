import type { ChampionConfig, Config } from '../data/schema';
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
 * lane faces an equal number. You play `localChampion` (the first champion if unknown); bots
 * cycle through the roster (duplicates allowed, D-009). Slot 0 of each team keeps the first lane;
 * among the bots, one with a lane preference (Beta: a side lane, TDD §7) picks first (D-049).
 */
export function matchSlots(config: Config, opts: { teamSize: number; localTeam: Team.Blue | Team.Red; localLane?: string; localChampion?: string }): Slot[] {
  const lanes = spreadLanes(config.map.lanes.map((l) => l.id), opts.teamSize, opts.localLane);
  const enemy = opts.localTeam === Team.Blue ? Team.Red : Team.Blue;
  const roster = config.champions;
  const local = roster.find((c) => c.id === opts.localChampion) ?? roster[0]!;
  const team = (side: Team.Blue | Team.Red, first: ChampionConfig): Slot[] => {
    const champs = [first];
    for (let i = 1; i < opts.teamSize; i++) champs.push(roster[i % roster.length]!);
    const free = lanes.slice(1);
    const lane = new Array<string>(champs.length);
    lane[0] = lanes[0]!;
    const take = (i: number, fits: (id: string) => boolean) => {
      const k = free.findIndex(fits);
      if (k >= 0) lane[i] = free.splice(k, 1)[0]!;
    };
    for (let i = 1; i < champs.length; i++) {
      const pref = champs[i]!.lanePreference;
      if (pref) take(i, (id) => (pref === 'centre') === (id === 'centre'));
    }
    for (let i = 1; i < champs.length; i++) if (lane[i] === undefined) take(i, () => true);
    return champs.map((c, i) => ({ team: side, championId: c.id, lane: lane[i] ?? '' }));
  };
  const ours = team(opts.localTeam, local);
  const theirs = team(enemy, roster[0]!);
  return [ours[0]!, theirs[0]!, ...ours.slice(1), ...theirs.slice(1)];
}
