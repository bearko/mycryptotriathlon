import { describe, expect, it } from 'vitest';
import { cat } from '../src/core/catalog';
import { makeRng } from '../src/core/util';
import { BASE, computeStats, costOf, NODE, SKILLS } from '../src/game/meta';
import { buildSea } from '../src/stages/sea';

describe('skill tree', () => {
  it('every node hangs off nodes that exist, and no two share a square', () => {
    const seen = new Set<string>();
    for (const n of SKILLS) {
      for (const r of n.requires) expect(NODE.has(r), `${n.id} requires ${r}`).toBe(true);
      const key = `${n.x},${n.y}`;
      expect(seen.has(key), `two nodes at ${key}`).toBe(false);
      seen.add(key);
      expect(n.max).toBeGreaterThan(0);
      expect(n.icon, `${n.id} icon`).toBeTruthy();
    }
  });
  it('every node can be reached from the root', () => {
    const open = new Set(['root']);
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of SKILLS) {
        if (!open.has(n.id) && n.requires.some((r) => open.has(r))) {
          open.add(n.id);
          grew = true;
        }
      }
    }
    expect(SKILLS.filter((n) => !open.has(n.id)).map((n) => n.id)).toEqual([]);
  });
  it('costs rise with the level, and levels add up into stats', () => {
    const atk = NODE.get('atk')!;
    expect(costOf(atk, 3)).toBeGreaterThan(costOf(atk, 0));
    const s = computeStats({ root: 1, atk: 5, speed: 4, wBook: 1, hard: 1, ce: 2 });
    expect(s.dmg).toBeCloseTo(1.4);
    expect(s.speed).toBeCloseTo(1.1);
    expect(s.wBook).toBe(1);
    expect(s.enemyHp).toBeCloseTo(1.3);
    expect(s.ce).toBeCloseTo(1.45);
    expect(computeStats({ root: 1 })).toEqual(BASE);
  });
});

describe('catalog', () => {
  it('has heroes with passive skills the races can act on', () => {
    expect(cat.heroes.length).toBeGreaterThan(150);
    const withPassive = cat.heroes.filter((h) => h.passive);
    expect(withPassive.length).toBeGreaterThan(150);
    expect(withPassive.some((h) => h.passive!.trig === 'death' && h.passive!.fx.some((f) => f.t === 'revive'))).toBe(true);
  });
});

describe('sea', () => {
  it('can be swum from the surface to the treasure once the gates are open', () => {
    const m = buildSea(makeRng(20261120 + 23));
    const W = 30;
    const H = m.solid.length / W;
    const seen = new Uint8Array(m.solid.length);
    const queue = [1 * W + 15];
    seen[queue[0]] = 1;
    while (queue.length) {
      const c = queue.pop()!;
      const x = c % W;
      const y = Math.floor(c / W);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (seen[n] || m.solid[n]) continue;
        seen[n] = 1;
        queue.push(n);
      }
    }
    for (const d of m.digs) {
      const tx = Math.floor(d.x / 48);
      const ty = Math.floor((d.y - 20) / 48);
      expect(seen[ty * W + tx], `${d.kind} at ${tx},${ty}`).toBe(1);
    }
  });
});

describe('gear', () => {
  it('every weapon, boost and helper item has art and five tiers', async () => {
    const { ROSTER, ITEMS, iconOf, itemImg } = await import('../src/game/roster');
    for (const d of ROSTER) {
      expect(d.tiers.length).toBe(5);
      for (let lv = 1; lv <= 5; lv++) expect(iconOf(d, lv), `${d.id} Lv${lv}`).toMatch(/Extensions\/\d+\.png$/);
      if (d.key) expect(d.key in BASE, `${d.id} key ${d.key}`).toBe(true);
    }
    for (const i of ITEMS) {
      expect(itemImg(i), i.id).toContain(String(i.icon));
      if (i.key) expect(i.key in BASE, `${i.id} key ${i.key}`).toBe(true);
    }
  });
  it('the back of the field draws the strong items', async () => {
    const { rollItem } = await import('../src/game/run');
    const all = { ...BASE, iTrap: 1, iDecoy: 1, iMirror: 1, iBolt: 1, iDragon: 1 };
    const count = (back: number) => {
      let n = 0;
      for (let i = 0; i < 2000; i++) if (['bolt', 'dragon'].includes(rollItem(back, all).id)) n++;
      return n;
    };
    expect(count(1)).toBeGreaterThan(count(0) * 3);
  });
});
