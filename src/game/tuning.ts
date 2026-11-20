// The fighter for the sky. Nothing gathered on land or under the sea is carried over as it is:
// every extension is sold for GUM at the hangar door, and the GUM pays for the fighter's ranks
// and for the sky-only weapons (the twin laser comes with the hull).

import { cat, traitsOf } from '../core/catalog';
import { iconOf, nameOf } from './roster';
import type { Run, Slot } from './run';

export type TuneId = 'hp' | 'en' | 'armor' | 'move' | 'aim' | 'arms';
export const TUNE_MAX = 10;
/** GUM to go from rank r to r + 1. */
export const rankCost = (r: number) => 40 + 30 * r;

export interface TuneRow { id: TuneId; name: string; color: string; note: string }
export const TUNE_ROWS: TuneRow[] = [
  { id: 'hp', name: 'HP', color: '#1f8a4c', note: '機体の耐久' },
  { id: 'en', name: 'EN', color: '#a12b3a', note: 'ブーストの回復' },
  { id: 'armor', name: '装甲値', color: '#c79a1e', note: '受けるダメージを減らす' },
  { id: 'move', name: '運動性', color: '#2a5fb8', note: '飛ぶ速さ' },
  { id: 'aim', name: '照準値', color: '#2a5fb8', note: 'ねらいが吸いつく広さ' },
  { id: 'arms', name: '武器', color: '#2a5fb8', note: 'すべての武装の威力' },
];

export type ArmKind = 'spread' | 'missile' | 'bits' | 'pulse' | 'rapid';
export interface SkyArm { id: ArmKind; name: string; img: string; price: number; desc: string }
const art = (id: number) => cat.extArt[String(id)] ?? { name: '???', img: cat.exts[0].img };
const arm = (id: ArmKind, ext: number, price: number, desc: string): SkyArm => ({ id, name: art(ext).name, img: art(ext).img, price, desc });
/** The hull's own gun. Always fitted, never sold. */
export const DEFAULT_ARM = { name: art(1130).name, img: art(1130).img, desc: '標準装備。正面へ 2 連のレーザー' };
export const SKY_ARMS: SkyArm[] = [
  arm('spread', 1035, 220, '扇状にばらまく散弾を足す'),
  arm('missile', 3121, 300, '敵を追いかけるミサイルを撃つ'),
  arm('bits', 1147, 260, '機体のまわりを回る盾。体当たりにも強くなる'),
  arm('pulse', 4123, 340, 'まわりの敵と弾をまとめて吹き飛ばす波動'),
  arm('rapid', 4130, 380, '標準レーザーの連射が速くなる'),
];
/** How many bought weapons fit on the hull beside the laser. */
export const ARM_SLOTS = 2;

export interface Sold { img: string; name: string; lv: number; gum: number }
export interface Tune {
  /** Everything there is to spend: the GUM picked up in the races plus what the extensions sold for. */
  budget: number;
  earned: number;
  sold: Sold[];
  ranks: Record<TuneId, number>;
  arms: ArmKind[];
  /** Seconds spent in the hangar: the clock does not stop for it. */
  time: number;
}

const SELL = [0, 60, 150, 320, 600, 1000];
export const sellValue = (s: Slot) => Math.round(SELL[s.lv] * (s.def.weapon ? 1 : 0.8));

/** Sells every extension the team carries and opens an untouched fighter. */
export function openTune(run: Run): Tune {
  const sold = run.slots.map((s) => ({ img: iconOf(s.def, s.lv), name: nameOf(s.def, s.lv), lv: s.lv, gum: sellValue(s) }));
  const t: Tune = {
    budget: run.gum + sold.reduce((a, s) => a + s.gum, 0), earned: run.gum, sold,
    ranks: { hp: 0, en: 0, armor: 0, move: 0, aim: 0, arms: 0 }, arms: [], time: 0,
  };
  run.tune = t;
  return t;
}

/** GUM that raising a row from one rank to another costs. */
export function rankSpan(from: number, to: number): number {
  let c = 0;
  for (let r = from; r < to; r++) c += rankCost(r);
  return c;
}
export function spent(t: Tune): number {
  let c = 0;
  for (const row of TUNE_ROWS) c += rankSpan(0, t.ranks[row.id]);
  for (const a of t.arms) c += SKY_ARMS.find((x) => x.id === a)!.price;
  return c;
}
export const gumLeft = (t: Tune) => t.budget - spent(t);
/** Share of everything that could be done to the hull, 0..100. */
export const tuneRate = (t: Tune) => Math.round((TUNE_ROWS.reduce((a, r) => a + t.ranks[r.id], 0) / (TUNE_ROWS.length * TUNE_MAX)) * 100);

/** What a row reads at a rank (the number shown on the tuning screen). */
export function rowValue(run: Run, id: TuneId, rank: number): number {
  const tr = traitsOf(run.heroes[2]);
  switch (id) {
    case 'hp': return Math.round(100 * tr.hp + rank * 18);
    case 'en': return 100 + rank * 14;
    case 'armor': return 100 + rank * 30;
    case 'move': return Math.round(100 * (0.9 + 0.1 * tr.agi) + rank * 5);
    case 'aim': return 100 + rank * 10;
    case 'arms': return 100 + rank * 10;
  }
}

export interface FighterStats {
  hp: number;
  /** Boost regained per second, on top of the base. */
  en: number;
  /** Multiplier on damage taken. */
  guard: number;
  engine: number;
  /** Radius of the aim assist. */
  aim: number;
  /** Multiplier on every weapon. */
  power: number;
  laser: number; spread: number; missile: number; bits: number; pulse: number;
}
export function tuneStats(run: Run): FighterStats {
  const t = run.tune ?? openTune(run);
  const r = t.ranks;
  const has = (a: ArmKind) => t.arms.includes(a);
  return {
    hp: rowValue(run, 'hp', r.hp),
    en: r.en * 0.022,
    guard: 1 / (1 + r.armor * 0.075),
    engine: r.move * 7,
    aim: 5.2 + r.aim * 0.55,
    power: 1 + r.arms * 0.1,
    laser: has('rapid') ? 45 : 0,
    spread: has('spread') ? 30 + r.arms * 2 : 0,
    missile: has('missile') ? 30 + r.arms * 3 : 0,
    bits: has('bits') ? 36 + r.arms * 3 : 0,
    pulse: has('pulse') ? 30 + r.arms * 3 : 0,
  };
}

/** Spends the lot sensibly (the "leave it to the crew" button, and the debug bot). */
export function autoTune(run: Run): void {
  const t = run.tune ?? openTune(run);
  for (const a of ['missile', 'spread'] as ArmKind[]) {
    if (t.arms.length >= ARM_SLOTS || t.arms.includes(a)) continue;
    if (gumLeft(t) >= SKY_ARMS.find((x) => x.id === a)!.price + 200) t.arms.push(a);
  }
  const order: TuneId[] = ['arms', 'hp', 'armor', 'move', 'en', 'aim'];
  for (let guard = 0; guard < 200; guard++) {
    // always the cheapest next rank, weapons first when it is a tie
    let best: TuneId | null = null;
    for (const id of order) {
      if (t.ranks[id] >= TUNE_MAX || rankCost(t.ranks[id]) > gumLeft(t)) continue;
      if (!best || t.ranks[id] < t.ranks[best]) best = id;
    }
    if (!best) break;
    t.ranks[best] += 1;
  }
}
