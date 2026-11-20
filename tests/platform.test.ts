import { describe, expect, it } from 'vitest';
import { FEATS } from '../src/game/meta';
import { chatVisible, openChat, startPlatform, step, STEPS, submitRun, trophy, TROPHIES } from '../src/core/platform';

describe('shared platform window', () => {
  it('never throws when the SDK is not there', () => {
    expect(() => {
      startPlatform();
      step('start');
      step('start');
      trophy('gate1');
      trophy('not-a-medal');
      submitRun({ cleared: 0 });
      chatVisible(false);
      openChat();
    }).not.toThrow();
  });

  it('keeps the funnel steps in order, inside 0..99, ending in done', () => {
    const list = Object.entries(STEPS);
    const nums = list.map(([, n]) => n);
    expect(new Set(nums).size).toBe(nums.length);
    expect([...nums].sort((a, b) => a - b)).toEqual(nums);
    for (const [id, n] of list) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(99);
      expect(id).toMatch(/^[a-z0-9_-]{1,40}$/);
    }
    expect(list[0]).toEqual(['start', 0]);
    expect(list[list.length - 1][0]).toBe('done');
  });

  it('only offers medals that exist in the game as achievements', () => {
    const ids = new Set(FEATS.map((f) => f.id));
    for (const t of TROPHIES) expect(ids.has(t)).toBe(true);
    expect(new Set(TROPHIES).size).toBe(TROPHIES.length);
  });
});
