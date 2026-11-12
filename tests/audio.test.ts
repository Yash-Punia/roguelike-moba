import { describe, expect, it } from 'vitest';
import { parseConfig, rawConfig } from '../src/data/load';
import type { AudioConfig } from '../src/data/schema';
import { AudioDirector, type Sink } from '../src/audio/director';
import spriteJson from '../assets/audio/sfx.json';
import { Kind, Team, type EntitySnapshot, type Snapshot } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/events';

const sprite = spriteJson as unknown as Record<string, number[]>;
const base = parseConfig(rawConfig).audio;
/** Numbers the tests rely on, pinned so retuning audio.json can't break them. */
const pinned = (over: Partial<AudioConfig> = {}): AudioConfig => ({
  ...base,
  masterVolume: 1,
  sfxVolume: 1,
  gains: {},
  cullDistance: 20,
  panDistance: 10,
  maxVoices: 24,
  limitWindow: 0.1,
  defaultLimit: 100,
  limits: {},
  ...over,
});

const SEEN = 1 << Team.Blue;
/** The local player's champion. */
const LOCAL = 50;
const ent = (id: number, modelId: string, x = 0, y = 0, over: Partial<EntitySnapshot> = {}) =>
  ({ id, kind: Kind.Minion, modelId, team: Team.Red, x, y, hp: 100, firing: false, channel: 0, visibleMask: SEEN, ...over }) as EntitySnapshot;
const snap = (...entities: EntitySnapshot[]) => ({ entities }) as unknown as Snapshot;
const shot = (id: number): SimEvent => ({ type: 'shot', id, target: 99 });

function rig(cfg = pinned(), sees = () => true) {
  const played: { name: string; volume: number; pan: number }[] = [];
  const loops = new Map<number, string>();
  const sink: Sink = {
    play: (name, volume, pan) => played.push({ name, volume, pan }),
    loop: (key, name) => loops.set(key, name),
    stopLoop: (key) => loops.delete(key),
  };
  const director = new AudioDirector(cfg, sprite, sink, Team.Blue, sees, LOCAL);
  return { director, played, loops };
}

describe('audio director (D-106)', () => {
  it('maps a shot by model id, structure kind and numbered variant; a cone shot is silent', () => {
    const { director, played } = rig();
    director.capture(snap(ent(1, 'alpha'), ent(2, 'mgSoldier'), ent(3, 'pillbox', 0, 0, { kind: Kind.SubBase }), ent(4, 'deserter2'), ent(5, 'gamma')));
    director.onEvents([shot(1), shot(2), shot(3), shot(4), { type: 'shot', id: 5, target: 0 }], 0);
    expect(played.map((p) => p.name)).toEqual(['revolver', 'mg', 'hmg', 'rifle']);
  });

  it('rate-limits each sound within its window', () => {
    const { director, played } = rig(pinned({ limits: { mg: 6 } }));
    director.capture(snap(ent(1, 'mgSoldier')));
    director.onEvents(Array.from({ length: 10 }, () => shot(1)), 0);
    expect(played).toHaveLength(6);
    director.onEvents(Array.from({ length: 10 }, () => shot(1)), 50);
    expect(played).toHaveLength(6); // still inside the 100 ms window
    director.onEvents(Array.from({ length: 10 }, () => shot(1)), 150);
    expect(played).toHaveLength(12);
  });

  it('never plays more than maxVoices at once', () => {
    const { director, played } = rig(pinned({ maxVoices: 5 }));
    director.capture(snap(ent(1, 'alpha')));
    director.onEvents(Array.from({ length: 20 }, () => shot(1)), 0);
    expect(played).toHaveLength(5);
    director.onEvents([shot(1)], 100); // the revolver rings for over 0.5 s
    expect(played).toHaveLength(5);
    director.onEvents([shot(1)], 1000);
    expect(played).toHaveLength(6);
  });

  it('culls far sources, fades with distance and pans by the side offset', () => {
    const { director, played } = rig();
    director.setListener(0, 0);
    director.capture(snap(ent(1, 'alpha', 0, 25), ent(2, 'alpha', 5, 0), ent(3, 'alpha', -10, 0)));
    director.onEvents([shot(1), shot(2), shot(3)], 0);
    expect(played).toHaveLength(2);
    expect(played[0]!.volume).toBeCloseTo(0.75);
    expect(played[0]!.pan).toBeCloseTo(0.5);
    expect(played[1]!.volume).toBeCloseTo(0.5);
    expect(played[1]!.pan).toBeCloseTo(-1);
  });

  it('under fog, unseen sources make no sound', () => {
    const { director, played, loops } = rig(pinned(), () => false);
    director.capture(snap(ent(1, 'alpha', 0, 0, { visibleMask: 0 }), ent(2, 'gamma', 0, 0, { visibleMask: 0, firing: true })));
    director.onEvents([shot(1), { type: 'explosion', owner: 1, team: Team.Red, x: 0, y: 0, radius: 3 }, { type: 'death', id: 9, team: Team.Red, killer: 0, x: 0, y: 0 }], 0);
    expect(played).toHaveLength(0);
    expect(loops.size).toBe(0);
  });

  it('holds a loop while its unit fires or channels, and stops it when the unit stops, dies or leaves', () => {
    const { director, loops } = rig();
    director.capture(snap(ent(1, 'gamma', 0, 0, { firing: true }), ent(2, 'beta', 2, 0, { channel: 2 }), ent(3, 'beta', 3, 0, { channel: 1 })));
    expect([...loops]).toEqual([[1, 'flameLoop'], [2, 'stormLoop']]);
    director.capture(snap(ent(1, 'gamma', 0, 0, { firing: true, hp: 0 }), ent(2, 'beta', 2, 0, { channel: 2 })));
    expect([...loops.keys()]).toEqual([2]);
    director.capture(snap());
    expect(loops.size).toBe(0);
  });

  it('plays the local cues only for the local champion, centred, even with the voice cap full', () => {
    const { director, played } = rig(pinned({ maxVoices: 2 }));
    director.capture(snap(ent(1, 'alpha'), ent(LOCAL, 'beta', 30, 30, { team: Team.Blue }), ent(3, 'gamma', 0, 0, { team: Team.Blue })));
    director.onEvents([shot(1), shot(1)], 0); // fills the cap
    const cues: SimEvent[] = [
      { type: 'levelUp', id: LOCAL, level: 2 },
      { type: 'levelUp', id: 3, level: 2 },
      { type: 'draftOffered', id: LOCAL, cards: [] },
      { type: 'powerPicked', id: 3, power: 'x', auto: false },
      { type: 'respawn', id: LOCAL, x: 0, y: 0 },
      { type: 'ultCast', id: 1, target: LOCAL, x: 0, y: 0 }, // an enemy, at you
      { type: 'ultCast', id: 3, target: LOCAL, x: 0, y: 0 }, // an ally's doesn't count
      { type: 'phaseChanged', phase: 'suddenDeath' },
    ];
    director.onEvents(cues, 1);
    expect(played.slice(2).map((p) => p.name)).toEqual(['levelUp', 'cardDeal', 'respawn', 'ultSiren', 'suddenDeath']);
    expect(played.slice(2).every((p) => p.pan === 0 && p.volume === 1)).toBe(true);
  });

  it('chimes once each time the Ultimate fills', () => {
    const { director, played } = rig();
    const me = (ultCharge: number) => snap(ent(LOCAL, 'alpha', 0, 0, { team: Team.Blue, ultCharge }));
    for (const c of [40, 99, 100, 100, 0, 100]) director.capture(me(c));
    expect(played.filter((p) => p.name === 'ultReady')).toHaveLength(2);
  });

  it('plays victory or defeat from the viewer\'s side', () => {
    const won = rig();
    won.director.onEvents([{ type: 'matchOver', winner: Team.Blue, reason: 'hq', tick: 1 }], 0);
    const lost = rig();
    lost.director.onEvents([{ type: 'matchOver', winner: Team.Red, reason: 'hq', tick: 1 }], 0);
    expect([won.played[0]?.name, lost.played[0]?.name]).toEqual(['victory', 'defeat']);
  });

  it('goes quiet when the match is over', () => {
    const { director, played, loops } = rig();
    director.capture(snap(ent(1, 'gamma', 0, 0, { firing: true }), ent(2, 'alpha')));
    director.onEvents([{ type: 'matchOver', winner: Team.Blue, reason: 'hq', tick: 1 }], 0);
    expect(loops.size).toBe(0);
    director.capture(snap(ent(1, 'gamma', 0, 0, { firing: true }), ent(2, 'alpha')));
    director.onEvents([shot(2)], 10);
    expect(loops.size).toBe(0);
    expect(played.map((p) => p.name)).toEqual(['victory']);
  });

  it('every sound audio.json or the director names is in the sprite', () => {
    const names = new Set([
      ...Object.values(base.shots),
      ...Object.values(base.firingLoops),
      ...Object.values(base.channelLoops),
      ...Object.keys(base.gains),
      ...Object.keys(base.limits),
      ...['explosion', 'knockout', 'collapse'],
      ...['levelUp', 'ultReady', 'ultSiren', 'cardDeal', 'cardPick', 'respawn', 'suddenDeath', 'victory', 'defeat'],
    ]);
    for (const name of names) expect(sprite, name).toHaveProperty(name);
  });
});
