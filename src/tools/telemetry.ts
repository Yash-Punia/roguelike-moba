import { TICK_HZ } from '../data/schema';
import type { SimEvent } from '../sim/events';
import { Kind, Team, type EntitySnapshot, type Snapshot } from '../sim/sim';

/**
 * Match telemetry (TDD §11, D-115): one JSON record per match, built from sim events and
 * snapshots, exported from the Results screen. Reads only; keeps no event (they are pooled),
 * copying what it needs. Per-tick work touches preallocated per-champion counters.
 */

type TeamName = 'blue' | 'red' | 'neutral';
const TEAM_NAMES: readonly TeamName[] = ['blue', 'red', 'neutral'];
const KIND_NAMES = ['champion', 'subBase', 'hq', 'minion', 'summon', 'neutral'] as const;
type KindName = (typeof KIND_NAMES)[number];
/** Metres moved in one tick that count as a teleport (respawn), not movement; as the renderer's snap. */
const TELEPORT_DISTANCE = 5;
const TICKS_PER_MINUTE = 60 * TICK_HZ;
const FRAME_GAP_MS = 500;

/** Who the match is and where it runs; filled by the app. */
export interface TelemetryMeta {
  version: string;
  configHash: string;
  seed: number;
  query: string;
  map: string;
  lanes: number;
  teamSize: number;
  difficulty: string;
  champion: string;
  team: TeamName;
  /** The local player's champion entity, to mark the human row. */
  localEntity: number;
  startedAt: string;
}

export interface TelemetryDevice {
  userAgent: string;
  coarsePointer: boolean;
  pixelRatio: number;
  screen: { width: number; height: number };
}

interface ChampTrack {
  id: number;
  distance: number;
  stillTicks: number;
  aliveTicks: number;
  px: number;
  py: number;
  /** Level at the end of each full minute. */
  levels: number[];
}

const teamName = (t: Team): TeamName => TEAM_NAMES[t] ?? 'neutral';
const kindName = (k: Kind): KindName => KIND_NAMES[k] ?? 'champion';
const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;

function find(snap: Snapshot, id: number): EntitySnapshot | undefined {
  for (let i = 0; i < snap.entities.length; i++) if (snap.entities[i]!.id === id) return snap.entities[i];
  return undefined;
}

export function createTelemetry(meta: TelemetryMeta, device: TelemetryDevice) {
  const tracks = new Map<number, ChampTrack>();
  const structureFalls: { tick: number; kind: 'subBase' | 'hq'; team: TeamName; lane: string | null; killer: number }[] = [];
  const offers: { tick: number; champion: number; cards: string[] }[] = [];
  const rerolls: { tick: number; champion: number; cards: string[] }[] = [];
  const picks: { tick: number; champion: number; power: string; auto: boolean }[] = [];
  const deaths: { tick: number; champion: number; x: number; y: number; killer: number; killerKind: KindName | null; killerModel: string | null; killerX: number | null; killerY: number | null }[] = [];
  const ults: { tick: number; champion: number; target: number; targetKind: KindName | null; x: number; y: number }[] = [];
  let match: { winner: TeamName | null; reason: 'hq' | 'timeout' | 'surrender'; endTick: number; seconds: number } | null = null;
  let last: Snapshot | undefined;
  let configEdited = false;
  const inputTicks = { keyboard: 0, pointer: 0 };
  let frames = 0;
  let frameMs = 0;

  /** Call after every sim step with its events and the fresh snapshot (before any early return). */
  function onStep(events: readonly SimEvent[], snap: Snapshot) {
    if (match) return;
    last = snap;
    // The tick these events happened on, as the sim stamps them (`matchOver.tick`); the snapshot is already one on.
    const tick = snap.tick - 1;
    for (const ev of events) {
      switch (ev.type) {
        case 'structureDestroyed': {
          const lane = find(snap, ev.id)?.lane;
          structureFalls.push({ tick, kind: ev.kind, team: teamName(ev.team), lane: lane || null, killer: ev.killer });
          break;
        }
        case 'draftOffered':
          offers.push({ tick, champion: ev.id, cards: [...ev.cards] });
          break;
        case 'draftRerolled':
          rerolls.push({ tick, champion: ev.id, cards: [...ev.cards] });
          break;
        case 'powerPicked':
          picks.push({ tick, champion: ev.id, power: ev.power, auto: ev.auto });
          break;
        case 'death': {
          if (ev.unit !== undefined || find(snap, ev.id)?.kind !== Kind.Champion) break; // champions only
          const k = ev.killer ? find(snap, ev.killer) : undefined;
          deaths.push({
            tick, champion: ev.id, x: round(ev.x), y: round(ev.y), killer: ev.killer,
            killerKind: k ? kindName(k.kind) : null, killerModel: k ? k.modelId : null,
            killerX: k ? round(k.x) : null, killerY: k ? round(k.y) : null,
          });
          break;
        }
        case 'ultCast': {
          const t = ev.target ? find(snap, ev.target) : undefined;
          ults.push({ tick, champion: ev.id, target: ev.target, targetKind: t ? kindName(t.kind) : null, x: round(ev.x), y: round(ev.y) });
          break;
        }
        case 'matchOver':
          match = { winner: ev.winner === undefined ? null : teamName(ev.winner), reason: ev.reason, endTick: ev.tick, seconds: round(ev.tick / TICK_HZ, 1) };
          break;
      }
    }
    const minuteMark = snap.tick > 0 && snap.tick % TICKS_PER_MINUTE === 0;
    for (let i = 0; i < snap.entities.length; i++) {
      const e = snap.entities[i]!;
      if (e.kind !== Kind.Champion) continue;
      let t = tracks.get(e.id);
      if (!t) tracks.set(e.id, (t = { id: e.id, distance: 0, stillTicks: 0, aliveTicks: 0, px: e.x, py: e.y, levels: [] }));
      if (e.hp > 0 && e.respawnTicks === 0) {
        const d = Math.hypot(e.x - t.px, e.y - t.py);
        if (d <= TELEPORT_DISTANCE) t.distance += d;
        if (e.vx === 0 && e.vy === 0) t.stillTicks++;
        t.aliveTicks++;
      }
      t.px = e.x;
      t.py = e.y;
      if (minuteMark) t.levels.push(e.level);
    }
  }

  /** The local player's last input kind, once per tick: how the match was played. */
  function onInput(kind: 'keyboard' | 'pointer') {
    if (!match) inputTicks[kind]++;
  }

  /**
   * One drawn frame, `ms` after the last; only frames while the match runs count towards the
   * average, and a gap over `FRAME_GAP_MS` (a hidden tab, the first frame) is no frame time.
   */
  function onFrame(ms: number, running: boolean) {
    if (!running || match || ms > FRAME_GAP_MS) return;
    frames++;
    frameMs += ms;
  }

  /** The record so far (the whole match once it is over), as plain JSON-safe data. */
  function record() {
    const champions = [];
    if (last) {
      for (const e of last.entities) {
        if (e.kind !== Kind.Champion) continue;
        const t = tracks.get(e.id);
        champions.push({
          id: e.id, champion: e.modelId, team: teamName(e.team), human: e.id === meta.localEntity,
          level: e.level, xp: Math.round(e.xp), kills: e.kills, deaths: e.deaths, assists: e.assists,
          damageDealt: Math.round(e.damageDealt), powers: { ...e.powers },
          distance: round(t?.distance ?? 0, 1), stillSeconds: round((t?.stillTicks ?? 0) / TICK_HZ, 1), aliveSeconds: round((t?.aliveTicks ?? 0) / TICK_HZ, 1),
          levelsByMinute: [...(t?.levels ?? []), e.level],
        });
      }
    }
    const seconds = frameMs / 1000;
    return {
      format: 1,
      meta: { ...meta, configEdited },
      match: match ?? { winner: null, reason: null, endTick: last?.tick ?? 0, seconds: round((last?.tick ?? 0) / TICK_HZ, 1), unfinished: true },
      champions,
      structureFalls,
      draft: { offers, rerolls, picks },
      deaths,
      ultimates: ults,
      device: { ...device, inputTicks: { ...inputTicks }, averageFps: seconds > 0 ? round(frames / seconds, 1) : 0 },
    };
  }

  return {
    onStep,
    onInput,
    onFrame,
    record,
    /** The debug panel changed the config mid-match: the numbers no longer match `configHash`. */
    configEdited: () => (configEdited = true),
  };
}

export type Telemetry = ReturnType<typeof createTelemetry>;
export type TelemetryRecord = ReturnType<Telemetry['record']>;
