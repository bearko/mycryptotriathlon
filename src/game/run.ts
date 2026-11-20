// State of one attempt: three heroes in relay, the gear they carry (it is the baton), experience and GUM.
// Gear is gained by levelling up: each level offers a few cards, and one is taken.

import { type Hero, traitsOf } from '../core/catalog';
import { makeRng, type Rng } from '../core/util';
import { stats, type Stats } from './meta';
import { DEF, ITEMS, MAX_LV, ROSTER, type Def, type Item } from './roster';
import type { Tune } from './tuning';

export const STAGES = ['land', 'sea', 'sky'] as const;
export type StageId = (typeof STAGES)[number];
export const STAGE_NAME: Record<StageId, string> = { land: '陸', sea: '海', sky: '空' };
export const STAGE_EN: Record<StageId, string> = { land: 'LAND', sea: 'SEA', sky: 'SKY' };

/** Seconds added to the clock when a hero goes down in a race without rivals (sea / sky for now). */
export const DOWN_PENALTY = 8;
/** The course is the same for everyone, so routes can be learned. */
export const COURSE_SEED = 20261120;

export interface Slot { def: Def; lv: number }

export interface Run {
  heroes: [Hero, Hero, Hero];
  slots: Slot[];
  /** The fighter built in the hangar before the sky (null until then). */
  tune: Tune | null;
  level: number;
  xp: number;
  gum: number;
  /** Level-ups waiting for a card to be picked. */
  pending: number;
  rerolls: number;
  /** Helper items from the chest panels, oldest first. */
  items: Item[];
  splits: number[];
  downs: number;
  kills: number;
  rng: Rng;
}

export const xpNeed = (level: number) => Math.round(5 * Math.pow(1.3, level - 1));
/** Damage bonus from the team level and the skill tree. */
export const levelMul = (level: number) => (1 + (level - 1) * stats().awake) * stats().dmg;

export const isOpen = (d: Def, st: Stats = stats()) => !d.key || (st as unknown as Record<string, number>)[d.key] > 0;
export const maxLvOf = (st: Stats = stats()) => Math.min(MAX_LV, st.maxLv);

export function newRun(heroes: [Hero, Hero, Hero], seed = COURSE_SEED): Run {
  const st = stats();
  const run: Run = {
    heroes, slots: [], tune: null, level: 1, xp: 0, gum: 0, pending: 0, rerolls: st.reroll, items: [],
    splits: [], downs: 0, kills: 0, rng: makeRng(seed),
  };
  // The first runner starts with one weapon that suits them.
  const t = traitsOf(heroes[0]);
  const first = t.phy >= t.int && t.phy >= t.agi ? 'blade' : t.agi >= t.int ? 'knife' : 'revolver';
  run.slots.push({ def: DEF.get(first)!, lv: Math.min(maxLvOf(st), st.startLv) });
  for (let i = 0; i < st.startExtra; i++) {
    const more = ROSTER.filter((d) => d.weapon && isOpen(d, st) && !run.slots.some((s) => s.def === d));
    if (more.length) run.slots.push({ def: more[Math.floor(Math.random() * more.length)], lv: 1 });
  }
  return run;
}

/** What can still be offered: gear already carried that can grow, and new gear while there is room for its kind. */
export function eligible(run: Run, st: Stats = stats()): Def[] {
  const max = maxLvOf(st);
  const weapons = run.slots.filter((s) => s.def.weapon).length;
  const boosts = run.slots.length - weapons;
  return ROSTER.filter((d) => {
    const own = run.slots.find((s) => s.def === d);
    if (own) return own.lv < max;
    if (!isOpen(d, st)) return false;
    return d.weapon ? weapons < st.wSlots : boosts < st.bSlots;
  });
}

/** Cards for one level-up: a weapon first when one is possible, then anything, no repeats. */
export function drawCards(run: Run, exclude: Set<string> = new Set(), rnd: () => number = Math.random): Def[] {
  const st = stats();
  const pool = eligible(run, st);
  const fresh = pool.filter((d) => !exclude.has(d.id));
  const src = fresh.length >= Math.min(st.options, pool.length) ? fresh : pool;
  const out: Def[] = [];
  const weapons = src.filter((d) => d.weapon);
  if (weapons.length) out.push(weapons[Math.floor(rnd() * weapons.length)]);
  const rest = src.filter((d) => !out.includes(d)).sort(() => rnd() - 0.5);
  while (out.length < st.options && rest.length) out.push(rest.pop()!);
  return out.sort(() => rnd() - 0.5);
}

/** Takes a card: new gear at Lv1, or one more level for gear already carried. */
export function takeCard(run: Run, d: Def): Slot {
  let slot = run.slots.find((s) => s.def === d);
  if (slot) slot.lv = Math.min(maxLvOf(), slot.lv + 1);
  else {
    slot = { def: d, lv: 1 };
    run.slots.push(slot);
  }
  return slot;
}

/** Adds experience. Level-ups are queued in `run.pending`. Returns how many levels were gained. */
export function addXp(run: Run, n: number): number {
  run.xp += n;
  let ups = 0;
  while (run.xp >= xpNeed(run.level)) {
    run.xp -= xpNeed(run.level);
    run.level += 1;
    run.pending += 1;
    ups++;
  }
  return ups;
}

export interface Boosts {
  hp: number; regen: number; speed: number; cd: number; taken: number; dmg: number; bullets: number; range: number;
  pickup: number; pierce: number; gain: number;
}
/** Everything the carried boosts add up to. */
export function boostsOf(run: Run): Boosts {
  const b: Boosts = { hp: 0, regen: 0, speed: 1, cd: 1, taken: 1, dmg: 1, bullets: 0, range: 1, pickup: 1, pierce: 0, gain: 1 };
  for (const s of run.slots) {
    if (s.def.weapon) continue;
    const m = s.def.tiers[s.lv - 1].mag ?? 0;
    switch (s.def.arch) {
      case 'hpMaxUp': b.hp += m; break;
      case 'regen': b.regen += m; break;
      case 'speedUp': b.speed *= m; break;
      case 'cdDown': b.cd *= m; break;
      case 'dmgTakenDown': b.taken *= m; break;
      case 'dmgUp': b.dmg *= m; break;
      case 'bulletCount': b.bullets += m; break;
      case 'attackRangeUp': b.range *= m; break;
      case 'pickupRangeUp': b.pickup *= m; break;
      case 'pierceUp': b.pierce += m; break;
      case 'ceGainUp': b.gain *= m; break;
    }
  }
  return b;
}

// ---------------------------------------------------------------- helper items
/** Rolls a helper item. `back` is 0 for the leader and 1 for last place: the further back, the stronger the draw. */
export function rollItem(back: number, st: Stats = stats(), rnd: () => number = Math.random): Item {
  const pool = ITEMS.filter((i) => !i.key || (st as unknown as Record<string, number>)[i.key] > 0);
  const w = pool.map((i) => i.weight * Math.max(0.05, 1 + i.back * (back * 2 - 1) * 1.6));
  let r = rnd() * w.reduce((a, c) => a + c, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= w[i];
    if (r <= 0) return pool[i];
  }
  return pool[0];
}

export const totalTime = (run: Run) => run.splits.reduce((a, b) => a + b, 0);
