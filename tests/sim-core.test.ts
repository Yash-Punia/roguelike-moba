import { describe, expect, it } from 'vitest';
import { Store, World } from '../src/sim/ecs';
import { createStreams, mulberry32 } from '../src/sim/rng';

describe('rng', () => {
  it('is reproducible for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('keeps named streams independent', () => {
    const s1 = createStreams(7);
    const s2 = createStreams(7);
    s1.ai(); // extra call on one stream...
    expect(s1.draft()).toBe(s2.draft()); // ...does not shift another
    expect(s1.draft()).not.toBe(s1.spread());
  });
});

describe('ecs', () => {
  it('iterates in ascending id order after out-of-order adds and removals', () => {
    const s = new Store<string>();
    s.add(5, 'e');
    s.add(2, 'b');
    s.add(9, 'i');
    s.add(1, 'a');
    s.remove(2);
    s.add(3, 'c');
    expect(s.ids).toEqual([1, 3, 5, 9]);
    expect(s.data).toEqual(['a', 'c', 'e', 'i']);
    expect(s.get(5)).toBe('e');
    expect(s.has(2)).toBe(false);
  });

  it('destroys an entity in every store and never reuses ids', () => {
    const w = new World();
    const a = w.store<number>();
    const b = w.store<number>();
    const e = w.create();
    a.add(e, 1);
    b.add(e, 2);
    w.destroy(e);
    expect(a.has(e) || b.has(e)).toBe(false);
    expect(w.create()).toBeGreaterThan(e);
  });
});
