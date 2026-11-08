import { describe, expect, it } from 'vitest';
import { parseConfig, rawConfig } from '../src/data/load';
import { defaultChoices, laneIds, matchUrl, withMap, type Choices } from '../src/ui/menus';

const full: Choices = { champ: 'beta', team: 'red', lanes: 3, lane: 'centre', size: 4, difficulty: 'hard', seed: '77' };
const query = (c: Choices) => Object.fromEntries(new URLSearchParams(matchUrl(c)));

describe('match setup (D-091)', () => {
  it('writes every choice into the URL the match reads', () => {
    expect(query(full)).toEqual({ champ: 'beta', team: 'red', lanes: '3', lane: 'centre', size: '4', difficulty: 'hard', seed: '77' });
  });

  it('leaves out an Auto lane and an empty or non-numeric seed', () => {
    expect(query({ ...full, lane: 'auto', seed: '' })).toEqual({ champ: 'beta', team: 'red', lanes: '3', size: '4', difficulty: 'hard' });
    expect(query({ ...full, seed: ' abc ' }).seed).toBeUndefined();
    expect(query({ ...full, seed: ' 12 ' }).seed).toBe('12');
  });

  it('never sends a lane the map does not have', () => {
    expect(query({ ...full, lanes: 2 }).lane).toBeUndefined();
  });

  it('sends a lane back to Auto only when the new map lacks it', () => {
    expect(withMap(full, 2)).toMatchObject({ lanes: 2, lane: 'auto' });
    expect(withMap({ ...full, lane: 'left' }, 2)).toMatchObject({ lanes: 2, lane: 'left' });
  });

  it('offers each map’s own lanes', () => {
    expect(laneIds(3)).toEqual(['left', 'centre', 'right']);
    expect(laneIds(2)).toEqual(['left', 'right']);
  });

  it('defaults to the first champion and the shipped match settings', () => {
    expect(defaultChoices()).toMatchObject({ champ: 'alpha', team: 'blue', lane: 'auto', size: rawConfig.match.teamSize, difficulty: 'normal', seed: '' });
  });

  it('gives every champion a title and role for its card', () => {
    for (const c of parseConfig(rawConfig).champions) {
      expect(c.title, c.id).toBeTruthy();
      expect(c.role, c.id).toBeTruthy();
    }
  });
});
