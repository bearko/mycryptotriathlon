import raw from '../generated/catalog.json';
import { clamp } from './util';

export type Kind = 'slash' | 'shot' | 'magic' | 'orbit' | 'beast' | 'aura' | 'armor';
export interface Hero {
  id: number; name: string; rarity: number; faction: string;
  hp: number; phy: number; int: number; agi: number; passive: string; img: string;
}
export interface Ext {
  id: number; name: string; series: number; seriesName: string; rarity: number;
  kind: Kind; magic: boolean; img: string;
}
export interface EnemyArt { id: number; name: string; img: string }

export const cat = raw as unknown as {
  heroes: Hero[];
  exts: Ext[];
  enemies: Record<string, EnemyArt[]>;
  bg: Record<string, string>;
  fx: Record<string, string>;
  icons: Record<string, string>;
  chars: Record<string, string>;
  bgm: Record<string, string>;
  se: Record<string, string>;
};

export const RARITY_NAME = ['', 'コモン', 'アンコモン', 'レア', 'エピック', 'レジェンダリー'];
export const RARITY_COLOR = ['#fff', '#6fb7ff', '#6fe08a', '#ffd84d', '#ff9a3d', '#ff5a5a'];
export const KIND_LABEL: Record<Kind, string> = {
  slash: '斬撃', shot: '射撃', magic: '魔法', orbit: '周回', beast: '突進', aura: '波動', armor: '防具',
};
export const KIND_COLOR: Record<Kind, string> = {
  slash: '#ff7a6b', shot: '#ffd166', magic: '#7aa8ff', orbit: '#7fe3d2', beast: '#c79bff', aura: '#ff9ad5', armor: '#b9c2cc',
};
/** What the part does once it is bolted onto the fighter in the sky race. */
export const KIND_SKY: Record<Kind, string> = {
  slash: '拡散ショット', shot: '連射レーザー', magic: '誘導ミサイル', orbit: 'シールドビット',
  beast: 'ブースター', aura: 'パルス波', armor: '装甲',
};

/** Medians of max-level stats per rarity (from the asset database). Used to read a hero's "shape". */
const MEDIAN: Record<number, [number, number, number, number]> = {
  1: [222, 67, 69, 88], 2: [255, 68, 90, 94], 3: [303, 84, 86, 106], 4: [363, 106, 96, 120], 5: [453, 124, 140, 131],
};

export interface Traits {
  /** Each is around 1.0 (0.72 .. 1.4). What matters is the shape of the hero, not the rarity. */
  hp: number; phy: number; int: number; agi: number;
  /** Stars 1..5 for each race. */
  land: number; sea: number; sky: number;
}
const traitCache = new Map<number, Traits>();
export function traitsOf(h: Hero): Traits {
  const hit = traitCache.get(h.id);
  if (hit) return hit;
  const m = MEDIAN[h.rarity] ?? MEDIAN[3];
  const r = [h.hp / m[0], h.phy / m[1], h.int / m[2], h.agi / m[3]];
  const avg = (r[0] + r[1] + r[2] + r[3]) / 4;
  const bonus = 1 + (h.rarity - 1) * 0.015;
  const f = r.map((v) => clamp((v / avg) * bonus, 0.72, 1.4));
  const star = (v: number) => clamp(Math.round(1 + (v - 0.72) / 0.68 * 4), 1, 5);
  const t: Traits = {
    hp: f[0], phy: f[1], int: f[2], agi: f[3],
    land: star(Math.max(f[1], f[2]) * 0.8 + f[0] * 0.2),
    sea: star(f[0] * 0.75 + f[3] * 0.25),
    sky: star(f[3] * 0.8 + Math.max(f[1], f[2]) * 0.2),
  };
  traitCache.set(h.id, t);
  return t;
}

export const heroById = new Map(cat.heroes.map((h) => [h.id, h]));
export const extById = new Map(cat.exts.map((e) => [e.id, e]));
