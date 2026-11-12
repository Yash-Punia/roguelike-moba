import { Howl, Howler } from 'howler';
import webm from '../../assets/audio/sfx.webm?url';
import mp3 from '../../assets/audio/sfx.mp3?url';
import spriteJson from '../../assets/audio/sfx.json';
import battleWebm from '../../assets/audio/ambience-battle.webm?url';
import battleMp3 from '../../assets/audio/ambience-battle.mp3?url';
import suddenWebm from '../../assets/audio/ambience-sudden.webm?url';
import suddenMp3 from '../../assets/audio/ambience-sudden.mp3?url';
import type { Sink, Sprite, Track } from './director';

export const sprite = spriteJson as unknown as Sprite;

/**
 * Plays the director's sounds through Howler (D-106): one sprite file, Opus-in-WebM with an MP3
 * fallback. Plays before the file has loaded, or before the first touch or key press unlocks audio,
 * are dropped rather than queued, so a fight in that time doesn't burst out at once (D-108).
 */
export function createHowlerSink() {
  const howl = new Howl({
    src: [webm, mp3],
    format: ['webm', 'mp3'], // the URLs are hashed, but keep their extension
    sprite: sprite as unknown as Record<string, [number, number] | [number, number, boolean]>,
  });
  /** Loop key → Howler sound id. */
  const loops = new Map<number, number>();
  // The two background loops share a length, so one can take over where the other is.
  const tracks = {
    battle: new Howl({ src: [battleWebm, battleMp3], format: ['webm', 'mp3'], loop: true }),
    sudden: new Howl({ src: [suddenWebm, suddenMp3], format: ['webm', 'mp3'], loop: true }),
  };
  let current: Track = null;
  let currentId = 0;
  // Until the first touch or key press the context is suspended, and Howler would park every play
  // and start them all at once on that tap. Effects and loops wait instead; the background stays queued.
  const ready = () => howl.state() === 'loaded' && Howler.ctx?.state === 'running';
  let hold = false;
  const applyMute = () => Howler.mute(hold || document.hidden);
  // The sim stops while the tab is hidden; so does the frame loop that would mute it.
  document.addEventListener('visibilitychange', applyMute);

  const sink: Sink & { setHeld(held: boolean): void } = {
    music(track, volume, fadeMs) {
      const fade = Math.max(10, fadeMs);
      if (track === current) {
        if (track) tracks[track].volume(volume, currentId);
        return;
      }
      const from = current ? tracks[current] : undefined;
      const fromId = currentId;
      const at = from && from.playing(fromId) ? (from.seek(fromId) as number) : 0;
      if (from) {
        from.fade(from.volume(fromId) as number, 0, fade, fromId);
        setTimeout(() => from.stop(fromId), fade);
      }
      current = track;
      if (!track) return;
      const to = tracks[track];
      currentId = to.play(); // queued until loaded, unlike the effects: the background should start with the match
      to.seek(at, currentId);
      to.volume(0, currentId);
      to.fade(0, volume, fade, currentId);
    },
    play(name, volume, pan) {
      if (!ready()) return;
      const id = howl.play(name);
      howl.volume(volume, id);
      howl.stereo(pan, id);
    },
    loop(key, name, volume, pan) {
      if (!ready()) return;
      let id = loops.get(key);
      if (id === undefined) loops.set(key, (id = howl.play(name)));
      howl.volume(volume, id);
      howl.stereo(pan, id);
    },
    stopLoop(key) {
      const id = loops.get(key);
      if (id === undefined) return;
      howl.stop(id);
      loops.delete(key);
    },
    /** The pause menu or the debug pause: silence everything until play resumes. */
    setHeld(held) {
      if (held === hold) return;
      hold = held;
      applyMute();
    },
  };
  return sink;
}
