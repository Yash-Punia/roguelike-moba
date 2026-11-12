import { Howl, Howler } from 'howler';
import webm from '../../assets/audio/sfx.webm?url';
import mp3 from '../../assets/audio/sfx.mp3?url';
import spriteJson from '../../assets/audio/sfx.json';
import type { Sink, Sprite } from './director';

export const sprite = spriteJson as unknown as Sprite;

/**
 * Plays the director's sounds through Howler (D-106): one sprite file, Opus-in-WebM with an MP3
 * fallback. Plays before the file has loaded are dropped rather than queued, so a fight during
 * loading doesn't burst out at once. Howler unlocks audio on the first touch or click.
 */
export function createHowlerSink() {
  const howl = new Howl({
    src: [webm, mp3],
    format: ['webm', 'mp3'], // the URLs are hashed, but keep their extension
    sprite: sprite as unknown as Record<string, [number, number] | [number, number, boolean]>,
  });
  /** Loop key → Howler sound id. */
  const loops = new Map<number, number>();
  const ready = () => howl.state() === 'loaded';
  let hold = false;
  const applyMute = () => Howler.mute(hold || document.hidden);
  // The sim stops while the tab is hidden; so does the frame loop that would mute it.
  document.addEventListener('visibilitychange', applyMute);

  const sink: Sink & { setHeld(held: boolean): void } = {
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
