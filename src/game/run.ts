// State of one run: three heroes in relay, the gear they pass on like a baton, and the clock.

import { cat, type Ext, type Hero, type Kind, traitsOf, type Traits } from '../core/catalog';
import { makeRng, pick, type Rng } from '../core/util';

export const STAGES = ['land', 'sea', 'sky'] as const;
export type StageId = (typeof STAGES)[number];
export const STAGE_NAME: Record<StageId, string> = { land: '陸', sea: '海', sky: '空' };
export const STAGE_EN: Record<StageId, string> = { land: 'LAND', sea: 'SEA', sky: 'SKY' };

export const MAX_SLOTS = 6;
export const MAX_LV = 5;
/** Seconds added to the clock when a hero goes down (there is no game over). */
export const DOWN_PENALTY = 8;
/** The course is the same for everyone, so routes can be learned and times compared. */
export const COURSE_SEED = 20261120;

export interface Slot { ext: Ext; lv: number }

export interface Run {
  heroes: [Hero, Hero, Hero];
  slots: Slot[];
  /** Ids of the slots bolted onto the fighter (set in the hangar). */
  fighter: number[];
  level: number;
  xp: number;
  splits: number[];
  downs: number;
  kills: number;
  /** Series that can turn up on this course. */
  pool: Ext[][];
  rng: Rng;
}

export const xpNeed = (level: number) => 10 + level * 12;
/** Damage bonus from the team level. */
export const levelMul = (level: number) => 1 + (level - 1) * 0.05;

/** Picks the series that appear on the course: at least one of every kind, a few doubled up. */
function buildPool(rng: Rng): Ext[][] {
  const byKind = new Map<Kind, Map<number, Ext[]>>();
  for (const e of cat.exts) {
    if (!byKind.has(e.kind)) byKind.set(e.kind, new Map());
    const m = byKind.get(e.kind)!;
    if (!m.has(e.series)) m.set(e.series, []);
    m.get(e.series)!.push(e);
  }
  const pool: Ext[][] = [];
  const kinds: Kind[] = ['slash', 'shot', 'magic', 'orbit', 'beast', 'aura', 'armor'];
  for (const k of kinds) {
    const series = [...byKind.get(k)!.values()].filter((s) => s.length >= 5);
    const first = pick(rng, series);
    pool.push(first);
    if (k === 'slash' || k === 'shot' || k === 'magic') {
      const rest = series.filter((s) => s !== first);
      if (rest.length) pool.push(pick(rng, rest));
    }
  }
  return pool;
}

export function newRun(heroes: [Hero, Hero, Hero], seed = COURSE_SEED): Run {
  const rng = makeRng(seed);
  const run: Run = {
    heroes, slots: [], fighter: [], level: 1, xp: 0, splits: [], downs: 0, kills: 0,
    pool: buildPool(rng), rng,
  };
  // The first runner starts with one plain weapon that suits them.
  const t = traitsOf(heroes[0]);
  const want: Kind = t.int > t.phy ? 'magic' : t.agi > t.phy ? 'shot' : 'slash';
  const series = run.pool.find((s) => s[0].kind === want) ?? run.pool[0];
  const starter = series.find((e) => e.rarity === 1) ?? series[0];
  run.slots.push({ ext: starter, lv: 1 });
  return run;
}

/** Rolls a piece of gear from the course pool. `luck` 0..1 shifts the rarity upward. */
export function rollExt(run: Run, rng: Rng, luck: number): Ext {
  const series = pick(rng, run.pool);
  const r = rng();
  const w = [0.5 - luck * 0.38, 0.3 - luck * 0.1, 0.14 + luck * 0.2, 0.05 + luck * 0.18, 0.01 + luck * 0.1];
  let acc = 0;
  let rarity = 1;
  for (let i = 0; i < 5; i++) {
    acc += w[i];
    if (r < acc) {
      rarity = i + 1;
      break;
    }
    rarity = 5;
  }
  return series.find((e) => e.rarity === rarity) ?? series[series.length - 1];
}

export interface Gain { slot: Slot; kind: 'new' | 'up' | 'max'; }

/**
 * Takes a piece of gear. Same series -> that slot levels up (and takes the better art).
 * A free slot -> it is equipped. Otherwise it is broken down into a level for the weakest matching slot.
 */
export function takeExt(run: Run, ext: Ext): Gain {
  const same = run.slots.find((s) => s.ext.series === ext.series);
  if (same) {
    if (ext.rarity > same.ext.rarity) same.ext = ext;
    if (same.lv < MAX_LV) {
      same.lv += 1;
      return { slot: same, kind: 'up' };
    }
    return { slot: same, kind: 'max' };
  }
  if (run.slots.length < MAX_SLOTS) {
    const slot = { ext, lv: 1 };
    run.slots.push(slot);
    return { slot, kind: 'new' };
  }
  const open = run.slots.filter((s) => s.lv < MAX_LV);
  if (!open.length) return { slot: run.slots[0], kind: 'max' };
  const sameKind = open.filter((s) => s.ext.kind === ext.kind);
  const list = sameKind.length ? sameKind : open;
  const target = list.reduce((a, b) => (b.lv < a.lv ? b : a));
  target.lv += 1;
  return { slot: target, kind: 'up' };
}

/** Adds experience. Returns true when the team level went up. */
export function addXp(run: Run, n: number): boolean {
  run.xp += n;
  let up = false;
  while (run.xp >= xpNeed(run.level)) {
    run.xp -= xpNeed(run.level);
    run.level += 1;
    up = true;
  }
  return up;
}

/** Base damage of a slot before the hero's own strength. */
export function slotPower(s: Slot): number {
  const base = [0, 10, 13, 17, 22, 28][s.ext.rarity];
  return base * (1 + 0.4 * (s.lv - 1));
}

export function heroMul(t: Traits, ext: Ext): number {
  return ext.magic ? t.int : t.phy;
}

/** Bonus HP from worn gear. */
export function armorHp(run: Run): number {
  let hp = 0;
  for (const s of run.slots) if (s.ext.kind === 'armor') hp += 10 * (s.lv + s.ext.rarity);
  return hp;
}
export function armorRegen(run: Run): number {
  let r = 0;
  for (const s of run.slots) if (s.ext.kind === 'armor') r += 0.6 * s.lv;
  return r;
}

/** The four best parts, used when the player does not choose. */
export function autoFighter(run: Run): number[] {
  return [...run.slots]
    .sort((a, b) => slotPower(b) - slotPower(a))
    .slice(0, 4)
    .map((s) => s.ext.id);
}

export interface FighterStats {
  laser: number; spread: number; missile: number; bits: number; engine: number; pulse: number; armor: number;
}
/** What the chosen parts add up to. Each value is "power" (0 = not fitted). */
export function fighterStats(run: Run): FighterStats {
  const st: FighterStats = { laser: 0, spread: 0, missile: 0, bits: 0, engine: 0, pulse: 0, armor: 0 };
  const map: Record<Kind, keyof FighterStats> = {
    shot: 'laser', slash: 'spread', magic: 'missile', orbit: 'bits', beast: 'engine', aura: 'pulse', armor: 'armor',
  };
  for (const id of run.fighter) {
    const s = run.slots.find((x) => x.ext.id === id);
    if (s) st[map[s.ext.kind]] += slotPower(s);
  }
  return st;
}

export const totalTime = (run: Run) => run.splits.reduce((a, b) => a + b, 0);
