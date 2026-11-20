// The gear that fights on its own, and the gear that makes it stronger: ten weapons and eleven boosts,
// five tiers each. Shapes and numbers follow the sister title of the MyCrypto series (its level-up picks),
// so a player of one feels at home in the other. Art and names come from the extension ids.

import { cat } from '../core/catalog';

export type Arch =
  | 'radial' | 'orbit' | 'bigHoming' | 'dropTarget' | 'stack' | 'beam' | 'diagonal' | 'randomRadial' | 'placeBomb' | 'orbitClose'
  | 'hpMaxUp' | 'regen' | 'speedUp' | 'cdDown' | 'dmgTakenDown' | 'dmgUp' | 'bulletCount' | 'attackRangeUp' | 'pickupRangeUp' | 'pierceUp' | 'ceGainUp';

export interface Tier {
  bullets?: number; dmg?: number; cd?: number; range?: number; speed?: number; spread?: number; orbitR?: number;
  size?: number; pierce?: number; aoeR?: number; aoe?: number; dirs?: number; dur?: number; len?: number; thick?: number;
  fuse?: number; radius?: number; mag?: number;
}
export interface Def {
  id: string; weapon: boolean; arch: Arch; series: string; color: string; icons: number[];
  skill: string; desc: (t: Tier) => string; tiers: Tier[];
  /** Available from the first run, or opened in the skill tree (the Stats key that opens it). */
  key?: string;
}

const W = (id: string, arch: Arch, series: string, color: string, base: number, skill: string, desc: (t: Tier) => string, tiers: Tier[], key?: string): Def => ({
  id, weapon: true, arch, series, color, icons: [1, 2, 3, 4, 5].map((r) => r * 1000 + base), skill, desc, tiers, key,
});
const B = (id: string, arch: Arch, series: string, color: string, base: number, skill: string, desc: (t: Tier) => string, mags: number[], key?: string): Def => ({
  id, weapon: false, arch, series, color, icons: [1, 2, 3, 4, 5].map((r) => r * 1000 + base), skill, desc, tiers: mags.map((mag) => ({ mag })), key,
});
const sec = (ms?: number) => ((ms ?? 0) / 1000).toFixed(1);
const pct = (m?: number) => `${Math.round(Math.abs((m ?? 1) - 1) * 100)}%`;

export const ROSTER: Def[] = [
  W('blade', 'orbitClose', 'ブレード', '#c4a35a', 1, '高速回転刃', (t) => `すぐそばを高速で回る刃。数 ${t.bullets} ／ 威力 ${t.dmg}`, [
    { bullets: 2, dmg: 25, orbitR: 40 }, { bullets: 3, dmg: 32, orbitR: 42 }, { bullets: 4, dmg: 42, orbitR: 44 },
    { bullets: 5, dmg: 55, orbitR: 46 }, { bullets: 6, dmg: 72, orbitR: 48 }]),
  W('revolver', 'radial', 'リボルバー', '#56ccf2', 29, '弾幕', (t) => `敵のいる方向へ扇状に撃つ。弾数 ${t.bullets} ／ 威力 ${t.dmg} ／ 間隔 ${sec(t.cd)}秒`, [
    { bullets: 1, dmg: 30, cd: 1300, range: 320, speed: 280, spread: 30 }, { bullets: 2, dmg: 38, cd: 1200, range: 340, speed: 300, spread: 35 },
    { bullets: 3, dmg: 48, cd: 1100, range: 360, speed: 320, spread: 40 }, { bullets: 4, dmg: 60, cd: 1000, range: 380, speed: 340, spread: 45 },
    { bullets: 6, dmg: 75, cd: 900, range: 400, speed: 360, spread: 50 }]),
  W('knife', 'diagonal', 'ナイフ', '#d4d4dc', 48, '四方刃', (t) => `ななめ 4 方向へナイフ。数 ${t.bullets} ／ 威力 ${t.dmg} ／ 間隔 ${sec(t.cd)}秒`, [
    { bullets: 4, dmg: 30, cd: 900, range: 320, speed: 360 }, { bullets: 6, dmg: 40, cd: 880, range: 340, speed: 380 },
    { bullets: 8, dmg: 52, cd: 860, range: 360, speed: 400 }, { bullets: 10, dmg: 68, cd: 840, range: 380, speed: 420 },
    { bullets: 12, dmg: 90, cd: 820, range: 400, speed: 440 }]),
  W('mallet', 'randomRadial', 'マレット', '#e76060', 73, '打ち下ろし', (t) => `でたらめな方向へ槌を投げる。数 ${t.bullets} ／ 威力 ${t.dmg} ／ 間隔 ${sec(t.cd)}秒`, [
    { bullets: 2, dmg: 30, cd: 1200, range: 360, speed: 320 }, { bullets: 3, dmg: 40, cd: 1150, range: 380, speed: 340 },
    { bullets: 4, dmg: 52, cd: 1100, range: 400, speed: 360 }, { bullets: 5, dmg: 68, cd: 1050, range: 420, speed: 380 },
    { bullets: 7, dmg: 90, cd: 1000, range: 440, speed: 400 }]),
  W('book', 'orbit', 'ブック', '#bb86fc', 8, '守護書', (t) => `まわりを回って守る本。数 ${t.bullets} ／ 威力 ${t.dmg} ／ 半径 ${t.orbitR}`, [
    { bullets: 1, dmg: 18, orbitR: 70 }, { bullets: 2, dmg: 24, orbitR: 75 }, { bullets: 3, dmg: 32, orbitR: 80 },
    { bullets: 4, dmg: 42, orbitR: 85 }, { bullets: 5, dmg: 54, orbitR: 90 }], 'wBook'),
  W('broom', 'bigHoming', 'ホーキ', '#ff7a59', 80, 'ひと掃き', (t) => `ゆっくり追いかける大きなホーキ。数 ${t.bullets} ／ 威力 ${t.dmg} ／ 貫通 ${t.pierce}`, [
    { bullets: 1, dmg: 60, cd: 2400, range: 600, speed: 90, size: 14, pierce: 1 }, { bullets: 1, dmg: 80, cd: 2300, range: 620, speed: 100, size: 17, pierce: 2 },
    { bullets: 2, dmg: 105, cd: 2200, range: 640, speed: 110, size: 20, pierce: 3 }, { bullets: 2, dmg: 140, cd: 2100, range: 660, speed: 120, size: 23, pierce: 4 },
    { bullets: 3, dmg: 185, cd: 2000, range: 680, speed: 130, size: 26, pierce: 5 }], 'wBroom'),
  W('shuriken', 'stack', '手裏剣', '#5ecf8a', 124, '連手裏剣', (t) => `いちばん近い敵へ 3 連 × ${t.dirs} 方向。威力 ${t.dmg} ／ 間隔 ${sec(t.cd)}秒`, [
    { bullets: 3, dirs: 1, dmg: 15, cd: 1100, range: 360, speed: 380 }, { bullets: 3, dirs: 2, dmg: 19, cd: 1050, range: 380, speed: 400 },
    { bullets: 3, dirs: 3, dmg: 24, cd: 1000, range: 400, speed: 420 }, { bullets: 3, dirs: 4, dmg: 32, cd: 950, range: 420, speed: 440 },
    { bullets: 3, dirs: 8, dmg: 40, cd: 900, range: 440, speed: 460 }], 'wShuriken'),
  W('parrot', 'dropTarget', 'パロット', '#d4d4dc', 113, '急降下', (t) => `敵の頭上から舞い降りて、まわりも巻きこむ。数 ${t.bullets} ／ 威力 ${t.dmg}`, [
    { bullets: 1, dmg: 25, cd: 1500, range: 600, aoeR: 60, aoe: 0.7 }, { bullets: 2, dmg: 32, cd: 1400, range: 600, aoeR: 65, aoe: 0.7 },
    { bullets: 3, dmg: 40, cd: 1300, range: 600, aoeR: 70, aoe: 0.75 }, { bullets: 4, dmg: 50, cd: 1200, range: 600, aoeR: 75, aoe: 0.75 },
    { bullets: 5, dmg: 65, cd: 1100, range: 600, aoeR: 85, aoe: 0.8 }], 'wParrot'),
  W('laser', 'beam', 'レーザーガン', '#f0c14b', 130, 'レーザー', (t) => `近い敵の方向へ貫くレーザー。本数 ${t.bullets} ／ 威力 ${t.dmg}/秒 ／ 間隔 ${sec(t.cd)}秒`, [
    { bullets: 1, dmg: 35, cd: 2000, range: 600, dur: 600, len: 600, thick: 6 }, { bullets: 1, dmg: 48, cd: 1900, range: 620, dur: 700, len: 640, thick: 7 },
    { bullets: 2, dmg: 60, cd: 1800, range: 640, dur: 800, len: 680, thick: 8 }, { bullets: 2, dmg: 80, cd: 1700, range: 660, dur: 900, len: 720, thick: 9 },
    { bullets: 3, dmg: 105, cd: 1600, range: 700, dur: 1000, len: 780, thick: 10 }], 'wLaser'),
  W('snowman', 'placeBomb', '雪だるま', '#a8e0ff', 126, '置きみやげ', (t) => `足もとに置いて、少しして爆ぜる。数 ${t.bullets} ／ 威力 ${t.dmg} ／ 範囲 ${t.radius}`, [
    { bullets: 1, dmg: 35, cd: 1800, fuse: 1000, radius: 60 }, { bullets: 2, dmg: 45, cd: 1700, fuse: 1000, radius: 65 },
    { bullets: 3, dmg: 58, cd: 1600, fuse: 1000, radius: 70 }, { bullets: 4, dmg: 75, cd: 1500, fuse: 1000, radius: 75 },
    { bullets: 5, dmg: 95, cd: 1400, fuse: 1000, radius: 80 }], 'wSnow'),

  B('armor', 'hpMaxUp', 'アーマー', '#aaaaaa', 4, '鋼の体', (t) => `最大 HP +${t.mag}`, [20, 40, 70, 110, 160]),
  B('boots', 'speedUp', 'ブーツ', '#5ecf8a', 31, '韋駄天', (t) => `走る速さ +${pct(t.mag)}`, [1.05, 1.1, 1.16, 1.23, 1.32]),
  B('apple', 'dmgUp', 'りんご', '#e76060', 159, '力の実', (t) => `威力 +${pct(t.mag)}`, [1.1, 1.2, 1.32, 1.46, 1.6]),
  B('ramen', 'regen', 'ラーメン', '#9be7c4', 154, '滋養', (t) => `毎秒 HP +${t.mag}`, [0.6, 1.2, 2, 3, 4], 'bRamen'),
  B('horse', 'cdDown', 'ホース', '#f0c14b', 5, '加速', (t) => `攻撃の間隔 -${pct(t.mag)}`, [0.85, 0.7, 0.55, 0.4, 0.3], 'bHorse'),
  B('shield', 'dmgTakenDown', 'シールド', '#56ccf2', 10, '鉄壁', (t) => `受けるダメージ -${pct(t.mag)}`, [0.92, 0.85, 0.78, 0.7, 0.6], 'bShield'),
  B('oriflamme', 'bulletCount', 'オリフラム', '#bb86fc', 140, '旗印', (t) => `弾の数 +${t.mag}`, [1, 1, 2, 2, 3], 'bOriflamme'),
  B('specimen', 'attackRangeUp', '標本', '#9be7c4', 169, '拡張視野', (t) => `攻撃の届く範囲 +${pct(t.mag)}`, [1.1, 1.2, 1.32, 1.46, 1.6], 'bSpecimen'),
  B('gunbai', 'pierceUp', 'グンバイ', '#f0c14b', 37, '貫通の采配', (t) => `弾が貫く数 +${t.mag}`, [1, 2, 3, 4, 5], 'bGunbai'),
  B('gyoku', 'pickupRangeUp', 'ギョク', '#fdcb6e', 98, '招集', (t) => `CE を引き寄せる範囲 +${pct(t.mag)}`, [1.4, 1.8, 2.3, 2.9, 3.6], 'bGyoku'),
  B('crown', 'ceGainUp', 'クラウン', '#f0c14b', 36, 'マジェスティ', (t) => `倒した敵から得る経験と GUM +${pct(t.mag)}`, [1.15, 1.3, 1.5, 1.75, 2.0], 'bCrown'),
];
export const DEF = new Map(ROSTER.map((d) => [d.id, d]));

export const MAX_LV = 5;
export const iconOf = (d: Def, lv: number) => cat.extArt[String(d.icons[Math.min(MAX_LV, Math.max(1, lv)) - 1])]?.img ?? cat.exts[0].img;
export const nameOf = (d: Def, lv: number) => cat.extArt[String(d.icons[Math.min(MAX_LV, Math.max(1, lv)) - 1])]?.name ?? d.series;

// ---------------------------------------------------------------- helper items (from the chest panels)
export interface Item {
  id: string; name: string; icon: number; desc: string;
  /** How much more often it turns up at the back of the field (0 = same everywhere, 1 = last places only). */
  back: number; weight: number; key?: string;
}
export const ITEMS: Item[] = [
  { id: 'pegasus', name: 'ペガサス', icon: 3120, desc: '少しのあいだ加速して、何にも当たらない', back: 0.3, weight: 10 },
  { id: 'panjan', name: 'パンジャンドラム', icon: 1153, desc: '前へ転がり、ぶつかったライバルを気絶させる', back: 0.1, weight: 10 },
  { id: 'goblet', name: 'ゴブレット', icon: 1030, desc: 'HP を大きく回復する', back: 0, weight: 7 },
  { id: 'trap', name: 'ネズミ捕り', icon: 1179, desc: 'うしろに仕掛ける。踏んだライバルの足が止まる', back: -0.4, weight: 8, key: 'iTrap' },
  { id: 'decoy', name: 'こけし', icon: 1127, desc: 'しばらくエネミーに狙われない。エネミーはまわりのライバルへ', back: 0.2, weight: 7, key: 'iDecoy' },
  { id: 'mirror', name: '鏡', icon: 1105, desc: 'しばらくのあいだ、妨害をはね返す', back: -0.2, weight: 6, key: 'iMirror' },
  { id: 'bolt', name: '御札', icon: 1103, desc: '雷を呼び、前を行くライバル全員の足を止める', back: 0.8, weight: 7, key: 'iBolt' },
  { id: 'dragon', name: 'ライドラゴン', icon: 3117, desc: '竜に乗って、しばらく猛スピードで飛ぶ', back: 1, weight: 8, key: 'iDragon' },
];
export const ITEM = new Map(ITEMS.map((i) => [i.id, i]));
export const itemImg = (i: Item) => cat.extArt[String(i.icon)]?.img ?? cat.exts[0].img;
