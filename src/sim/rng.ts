/** Returns a float in [0, 1). */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Independent named streams, so a new random call in one system never shifts another. */
export function createStreams(seed: number) {
  const stream = (name: string) => mulberry32(fnv1a(`${seed}:${name}`));
  return { draft: stream('draft'), ai: stream('ai'), spread: stream('spread'), crit: stream('crit') };
}

export type Streams = ReturnType<typeof createStreams>;
