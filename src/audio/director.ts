import type { AudioConfig } from '../data/schema';
import type { SimEvent } from '../sim/events';
import { Kind, type EntitySnapshot, type Snapshot, type Team } from '../sim/sim';

/** A Howler sprite map: name → [offset ms, duration ms, loop?]. */
export type Sprite = Readonly<Record<string, readonly (number | boolean)[]>>;

/** The background: a distant battle, its closer Sudden Death variant, or none (D-110). */
export type Track = 'battle' | 'sudden' | null;

/** Where sounds go: Howler in the game, a recorder in tests. Volumes 0–1, pan −1 (left) to 1. */
export interface Sink {
  /** Fades to `track` over `fadeMs`, starting it where the old one is (same tempo), or sets its volume if it is already playing. */
  music(track: Track, volume: number, fadeMs: number): void;
  play(name: string, volume: number, pan: number): void;
  /** Starts the loop for `key` if it isn't playing, and sets its volume and pan. */
  loop(key: number, name: string, volume: number, pan: number): void;
  stopLoop(key: number): void;
}

/** Plays and loops past these are dropped; the live count is always far below. */
const MAX_TRACKED = 64;
/** Music crossfades and fade-outs (presentation, ms). */
const MUSIC_FADE_MS = 2000;

/**
 * Turns sim events and snapshots into sounds (TDD §9, D-106). Pure: no Howler, no clock of its
 * own. Positional sounds pan and fade with distance from the camera's focus and are culled past
 * `cullDistance`; under fog, a source the viewer can't see makes no sound. At most `maxVoices`
 * play at once, and each sound is rate-limited, so a team fight isn't a wall of noise.
 *
 * The local player's cues (level-up, Ultimate ready, the siren, draft, respawn, Sudden Death,
 * the result) aren't positional and always play, past the voice cap if they must.
 *
 * Call order per tick, as `match.ts` does for the scene: `onEvents` (against last tick's
 * entities: a unit knocked out this tick is already gone from the new snapshot), then `capture`.
 */
export class AudioDirector {
  private readonly entities = new Map<number, EntitySnapshot>();
  /** Loops playing now: entity id → sound name. */
  private readonly loops = new Map<number, string>();
  private readonly seenLoops = new Set<number>();
  /** When each playing one-shot ends (ms); a fixed ring. */
  private readonly ends = new Float64Array(MAX_TRACKED);
  private nextEnd = 0;
  /** Recent play times per sound (ms), a ring each, for the rate limits. */
  private readonly recent = new Map<string, { times: Float64Array; next: number }>();
  private listenerX = 0;
  private listenerY = 0;
  private now = 0;
  private over = false;
  /** The local champion's Ultimate charge at the last capture, for the ready chime. */
  private lastCharge = -1;
  private track: Track = null;
  /** The player's volume sliders (D-111), 0–1, on top of the `audio.json` mix. */
  private user = { master: 1, effects: 1, background: 1 };

  constructor(
    private cfg: AudioConfig,
    private readonly sprite: Sprite,
    private readonly sink: Sink,
    private readonly viewer: Team,
    private readonly sees: (x: number, y: number) => boolean,
    /** The local player's champion. */
    private readonly local: number,
  ) {}

  setConfig(cfg: AudioConfig) {
    this.cfg = cfg;
    if (this.track) this.sink.music(this.track, this.musicVolume(), 0);
  }

  /** The player's settings: master, effects and background, each 0–1. */
  setUserVolumes(master: number, effects: number, background: number) {
    this.user = { master, effects, background };
    if (this.track) this.sink.music(this.track, this.musicVolume(), 0);
  }

  private musicVolume() {
    return this.cfg.masterVolume * this.cfg.musicVolume * this.user.master * this.user.background;
  }

  /** Master × effects, from the data and the player. */
  private effectsVolume() {
    return this.cfg.masterVolume * this.cfg.sfxVolume * this.user.master * this.user.effects;
  }

  private setTrack(track: Track, fadeMs: number) {
    this.track = track;
    this.sink.music(track, this.musicVolume(), fadeMs);
  }

  /** The camera's focus (sim metres): what positional sounds are heard from. */
  setListener(x: number, y: number) {
    this.listenerX = x;
    this.listenerY = y;
  }

  /** A tick's events; `now` is the wall clock (ms) the voice cap and rate limits run on. */
  onEvents(events: readonly SimEvent[], now: number) {
    this.now = now;
    if (this.over) return;
    for (const ev of events) {
      if (ev.type === 'shot') {
        if (ev.target === 0) continue; // a cone weapon: its sound is the firing loop
        const e = this.entities.get(ev.id);
        const name = e && this.shotSound(e);
        if (name && this.heard(e)) this.at(name, e.x, e.y);
      } else if (ev.type === 'explosion') {
        if (this.sees(ev.x, ev.y)) this.at('explosion', ev.x, ev.y, Math.min(1.3, Math.max(0.4, ev.radius / this.cfg.explosionFullRadius)));
      } else if (ev.type === 'death') {
        if (this.sees(ev.x, ev.y)) this.at('knockout', ev.x, ev.y);
      } else if (ev.type === 'structureDestroyed') {
        // An HQ decides the match: heard wherever the camera is (it cuts there only afterwards).
        if (ev.kind === 'hq') this.cue('collapse');
        else this.at('collapse', ev.x, ev.y);
      } else if (ev.type === 'levelUp') {
        if (ev.id === this.local) this.cue('levelUp');
      } else if (ev.type === 'ultCast') {
        const caster = this.entities.get(ev.id);
        if (ev.target === this.local && caster && caster.team !== this.viewer) this.cue('ultSiren');
      } else if (ev.type === 'draftOffered') {
        if (ev.id === this.local) this.cue('cardDeal');
      } else if (ev.type === 'powerPicked') {
        if (ev.id === this.local) this.cue('cardPick');
      } else if (ev.type === 'respawn') {
        if (ev.id === this.local) this.cue('respawn');
      } else if (ev.type === 'phaseChanged') {
        if (ev.phase === 'suddenDeath') {
          this.cue('suddenDeath');
          this.setTrack('sudden', MUSIC_FADE_MS); // the battle closes in (GDD §10: intensifying)
        }
      } else if (ev.type === 'matchOver') {
        this.cue(ev.winner === this.viewer ? 'victory' : 'defeat'); // a draw sounds like a loss
        this.setTrack(null, MUSIC_FADE_MS);
        this.over = true;
        for (const key of this.loops.keys()) this.sink.stopLoop(key);
        this.loops.clear();
      }
    }
  }

  /** Stores this tick's entities and starts, moves or stops the loops they hold. */
  capture(snap: Snapshot) {
    this.entities.clear();
    for (const e of snap.entities) this.entities.set(e.id, e);
    if (this.over) return;
    if (!this.track) this.setTrack(snap.match.phase === 'suddenDeath' ? 'sudden' : 'battle', 0);
    const me = this.entities.get(this.local);
    if (me) {
      if (this.lastCharge >= 0 && this.lastCharge < 100 && me.ultCharge >= 100) this.cue('ultReady');
      this.lastCharge = me.ultCharge;
    }
    this.seenLoops.clear();
    for (const e of snap.entities) {
      const name = (e.firing && this.cfg.firingLoops[e.modelId]) || (e.channel === 2 && this.cfg.channelLoops[e.modelId]) || undefined;
      if (!name || e.hp <= 0 || !this.heard(e)) continue;
      const volume = this.volume(name, e.x, e.y);
      if (volume <= 0) continue;
      this.seenLoops.add(e.id);
      this.loops.set(e.id, name);
      this.sink.loop(e.id, name, volume, this.pan(e.x));
    }
    for (const key of this.loops.keys()) {
      if (this.seenLoops.has(key)) continue;
      this.sink.stopLoop(key);
      this.loops.delete(key);
    }
  }

  private shotSound(e: EntitySnapshot): string | undefined {
    const { shots } = this.cfg;
    if (e.kind === Kind.SubBase) return shots['subBase'];
    if (e.kind === Kind.HQ) return shots['hq'];
    return shots[e.modelId] ?? shots[e.modelId.replace(/\d+$/, '')];
  }

  /** Fog of war (D-010): only what the viewer's team can see is heard. */
  private heard(e: EntitySnapshot) {
    return (e.visibleMask & (1 << this.viewer)) !== 0;
  }

  /** A positional one-shot at sim (x, y); `scale` multiplies its volume. */
  private at(name: string, x: number, y: number, scale = 1) {
    const volume = this.volume(name, x, y) * scale;
    if (volume <= 0 || !this.admit(name)) return;
    this.sink.play(name, Math.min(1, volume), this.pan(x));
  }

  /** A local cue: centred, full volume, never dropped for the voice cap. */
  private cue(name: string) {
    if (!this.admit(name, true)) return;
    this.sink.play(name, Math.min(1, this.effectsVolume() * (this.cfg.gains[name] ?? 1)), 0);
  }

  private volume(name: string, x: number, y: number) {
    const d = Math.hypot(x - this.listenerX, y - this.listenerY);
    if (d >= this.cfg.cullDistance) return 0;
    return this.effectsVolume() * (this.cfg.gains[name] ?? 1) * (1 - d / this.cfg.cullDistance);
  }

  private pan(x: number) {
    return Math.max(-1, Math.min(1, (x - this.listenerX) / this.cfg.panDistance));
  }

  /** The voice cap (unless `priority`) and the sound's rate limit; records the play when it passes. */
  private admit(name: string, priority = false) {
    if (!priority) {
      let live = this.loops.size;
      for (let i = 0; i < MAX_TRACKED; i++) if (this.ends[i]! > this.now) live++;
      if (live >= Math.min(this.cfg.maxVoices, MAX_TRACKED)) return false;
    }
    const limit = this.cfg.limits[name] ?? this.cfg.defaultLimit;
    let r = this.recent.get(name);
    if (!r || r.times.length !== limit) this.recent.set(name, (r = { times: new Float64Array(limit).fill(-Infinity), next: 0 }));
    // The oldest of the last `limit` plays must have left the window.
    if (this.now - r.times[r.next]! < this.cfg.limitWindow * 1000) return false;
    r.times[r.next] = this.now;
    r.next = (r.next + 1) % limit;
    const span = this.sprite[name];
    this.ends[this.nextEnd] = this.now + (span ? Number(span[1]) : 0);
    this.nextEnd = (this.nextEnd + 1) % MAX_TRACKED;
    return true;
  }
}
