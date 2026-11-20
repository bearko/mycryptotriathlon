// What stays between races: CE and medals, the skill tree, and the numbers the tree adds up to.
// A race reads only `Stats`; the tree is data (same shape as the other MyCrypto titles: grid position,
// max level, cost = baseCost * growth^level, "any of requires", a list of effects).

import { cat } from '../core/catalog';

export type Branch = 'root' | 'suzaku' | 'seiryu' | 'genbu' | 'byakko' | 'kouryu' | 'trial';
export const BRANCHES: Record<Branch, { name: string; role: string; color: string }> = {
  root: { name: 'エントリー', role: '出走', color: '#e8d6a8' },
  suzaku: { name: '朱雀', role: '攻め・エクステンション', color: '#ff6b4a' },
  seiryu: { name: '青龍', role: '速さ', color: '#3fb5ff' },
  genbu: { name: '玄武', role: '守り・不屈', color: '#58d6a0' },
  byakko: { name: '白虎', role: '駆け引き・妨害', color: '#e9eef5' },
  kouryu: { name: '黄竜', role: '賞金・補給', color: '#ffd23f' },
  trial: { name: '試練', role: 'あえて険しい道へ', color: '#ff5c9a' },
};

/** Everything a race can ask the tree about. */
export interface Stats {
  dmg: number; speed: number; hp: number; regen: number; cd: number; crit: number;
  dashCd: number; dashHit: number; rocket: number; draft: number; pads: number; padPower: number;
  guard: number; ko: number; revive: number; grit: number; passive: number;
  strike: number; bump: number; foulLimit: number; freeze: number; items: number; itemPower: number;
  ce: number; xp: number; magnet: number; pickups: number; luck: number;
  startLv: number; startExtra: number; slots: number; maxRarity: number; gearLv2: number; awake: number;
  kMagic: number; kOrbit: number; kBeast: number; kAura: number;
  enemyHp: number; enemyCount: number; course: number; rival: number;
}
export const BASE: Stats = {
  dmg: 1, speed: 1, hp: 1, regen: 0, cd: 1, crit: 0.04,
  dashCd: 1, dashHit: 0, rocket: 0, draft: 0, pads: 0, padPower: 1,
  guard: 1, ko: 1, revive: 0.4, grit: 0, passive: 1,
  strike: 1, bump: 1, foulLimit: 5, freeze: 1, items: 0, itemPower: 1,
  ce: 1, xp: 1, magnet: 1, pickups: 1, luck: 0,
  startLv: 1, startExtra: 0, slots: 6, maxRarity: 3, gearLv2: 0, awake: 0,
  kMagic: 0, kOrbit: 0, kBeast: 0, kAura: 0,
  enemyHp: 1, enemyCount: 1, course: 1, rival: 0,
};
type Key = keyof Stats;
type Effect = { k: Key; op: 'add' | 'mul' | 'pow' | 'set'; v: number };
const add = (k: Key, v: number): Effect => ({ k, op: 'add', v });
/** +v per level, as a share of the base (two levels of +10% make +20%). */
const mul = (k: Key, v: number): Effect => ({ k, op: 'mul', v });
/** ×v per level (for things that shrink: cooldowns, stun time). */
const pow = (k: Key, v: number): Effect => ({ k, op: 'pow', v });
const set = (k: Key, v: number): Effect => ({ k, op: 'set', v });

export type Currency = 'ce' | 'medal';
export interface SkillNode {
  id: string; branch: Branch; name: string; desc: string; icon: string;
  x: number; y: number; max: number; baseCost: number; growth: number;
  /** Available once any of these has a level. */
  requires: string[];
  effects: Effect[];
  currency?: Currency;
  /** 'new' adds something to the game (gold frame). 'risk' makes it harder for a reward (red frame). */
  flavor?: 'new' | 'risk';
}

const ext = (series: number, rarity: number) =>
  cat.exts.find((e) => e.series === series && e.rarity === rarity)?.img ?? cat.exts[0].img;
const foe = (key: string, i = 0) => cat.enemies[key][i].img;

export const SKILLS: SkillNode[] = [
  { id: 'root', branch: 'root', name: 'エントリー', desc: 'トライアスロンへの参加登録。ここから五勢力の鍛錬が広がる', icon: cat.chars.chrisCheer, x: 0, y: 0, max: 1, baseCost: 0, growth: 1, requires: [], effects: [] },

  // 朱雀: the gear and how hard it hits (up)
  { id: 'atk', branch: 'suzaku', name: '鍛錬', desc: 'エクステンションの威力 +8%', icon: ext(1, 2), x: 0, y: -1, max: 10, baseCost: 12, growth: 1.45, requires: ['root'], effects: [mul('dmg', 0.08)] },
  { id: 'startLv', branch: 'suzaku', name: '愛用の品', desc: '最初に持っているエクステンションの Lv +1', icon: ext(1, 1), x: -1, y: -2, max: 4, baseCost: 35, growth: 2.1, requires: ['atk'], effects: [add('startLv', 1)] },
  { id: 'cd', branch: 'suzaku', name: '早業', desc: 'エクステンションの攻撃間隔 -4%', icon: ext(6, 2), x: 1, y: -2, max: 8, baseCost: 30, growth: 1.55, requires: ['atk'], effects: [pow('cd', 0.96)] },
  { id: 'kMagic', branch: 'suzaku', name: '魔法の解禁', desc: '追いかける魔法弾を撃つ「魔法」のエクステンションが、コースに出るようになる', icon: ext(8, 3), x: 0, y: -2, max: 1, baseCost: 60, growth: 1, requires: ['atk'], effects: [set('kMagic', 1)], flavor: 'new' },
  { id: 'kOrbit', branch: 'suzaku', name: '周回の解禁', desc: 'まわりを回って守る「周回」のエクステンションが出るようになる', icon: ext(10, 3), x: 0, y: -3, max: 1, baseCost: 140, growth: 1, requires: ['kMagic'], effects: [set('kOrbit', 1)], flavor: 'new' },
  { id: 'kBeast', branch: 'suzaku', name: '突進の解禁', desc: '幻獣が敵をなぎ倒す「突進」のエクステンションが出るようになる', icon: ext(22, 3), x: -1, y: -3, max: 1, baseCost: 260, growth: 1, requires: ['kOrbit'], effects: [set('kBeast', 1)], flavor: 'new' },
  { id: 'kAura', branch: 'suzaku', name: '波動の解禁', desc: '周囲をまとめて攻撃し、敵を鈍らせる「波動」のエクステンションが出るようになる', icon: ext(65, 3), x: 1, y: -3, max: 1, baseCost: 260, growth: 1, requires: ['kOrbit'], effects: [set('kAura', 1)], flavor: 'new' },
  { id: 'crit', branch: 'suzaku', name: '会心', desc: '会心（1.8倍）の確率 +3%', icon: ext(28, 3), x: 1, y: -4, max: 8, baseCost: 80, growth: 1.55, requires: ['kAura'], effects: [add('crit', 0.03)] },
  { id: 'start2', branch: 'suzaku', name: '二刀流', desc: '最初から、もう 1 つエクステンションを持って走り出す', icon: ext(82, 3), x: -1, y: -4, max: 2, baseCost: 320, growth: 3, requires: ['kBeast'], effects: [add('startExtra', 1)], flavor: 'new' },
  { id: 'epic', branch: 'suzaku', name: 'インペリアル級', desc: 'エピックのエクステンションがコースに出るようになる', icon: ext(1, 4), x: 0, y: -4, max: 1, baseCost: 450, growth: 1, requires: ['kOrbit'], effects: [set('maxRarity', 4)], flavor: 'new' },
  { id: 'legend', branch: 'suzaku', name: 'MCH級', desc: 'レジェンダリーのエクステンションがコースに出るようになる', icon: ext(1, 5), x: 0, y: -5, max: 1, baseCost: 4, growth: 1, requires: ['epic'], effects: [set('maxRarity', 5)], currency: 'medal', flavor: 'new' },
  { id: 'slot7', branch: 'suzaku', name: '七つ道具', desc: 'エクステンションの枠 +1', icon: ext(96, 3), x: 0, y: -6, max: 2, baseCost: 6, growth: 1.5, requires: ['legend'], effects: [add('slots', 1)], currency: 'medal', flavor: 'new' },

  // 青龍: speed (right)
  { id: 'speed', branch: 'seiryu', name: '俊足', desc: '走る・泳ぐ速さ +2.5%', icon: ext(31, 2), x: 1, y: 0, max: 10, baseCost: 12, growth: 1.5, requires: ['root'], effects: [mul('speed', 0.025)] },
  { id: 'dash', branch: 'seiryu', name: '身のこなし', desc: 'ダッシュの再使用までの時間 -7%', icon: ext(5, 2), x: 2, y: -1, max: 6, baseCost: 30, growth: 1.6, requires: ['speed'], effects: [pow('dashCd', 0.93)] },
  { id: 'rocket', branch: 'seiryu', name: 'ロケットスタート', desc: 'スタート直後の加速（+40%）が 1.5 秒のびる', icon: ext(121, 3), x: 2, y: 1, max: 4, baseCost: 45, growth: 1.9, requires: ['speed'], effects: [add('rocket', 1.5)] },
  { id: 'draft', branch: 'seiryu', name: 'スリップストリーム', desc: '前を走るヒーローの真後ろにつくと、速さ +5%', icon: ext(120, 3), x: 3, y: 0, max: 5, baseCost: 90, growth: 1.7, requires: ['speed'], effects: [add('draft', 0.05)], flavor: 'new' },
  { id: 'dashHit', branch: 'seiryu', name: '突破', desc: 'ダッシュで触れた敵をはじき飛ばしてダメージを与える', icon: ext(23, 3), x: 3, y: -1, max: 5, baseCost: 110, growth: 1.7, requires: ['dash'], effects: [add('dashHit', 1)], flavor: 'new' },
  { id: 'pads', branch: 'seiryu', name: 'ダッシュパネル', desc: 'コースに、踏むと加速するパネルが置かれるようになる', icon: ext(115, 3), x: 4, y: 0, max: 1, baseCost: 180, growth: 1, requires: ['draft'], effects: [set('pads', 1)], flavor: 'new' },
  { id: 'padPower', branch: 'seiryu', name: 'パネルの整備', desc: 'ダッシュパネルの加速が 20% 長く続く', icon: ext(38, 3), x: 5, y: 0, max: 5, baseCost: 120, growth: 1.6, requires: ['pads'], effects: [mul('padPower', 0.2)] },

  // 玄武: staying on your feet (left)
  { id: 'hp', branch: 'genbu', name: '頑健', desc: '最大 HP（海では酸素）+8%', icon: ext(4, 2), x: -1, y: 0, max: 10, baseCost: 12, growth: 1.5, requires: ['root'], effects: [mul('hp', 0.08)] },
  { id: 'regen', branch: 'genbu', name: '自然治癒', desc: '毎秒 HP が 0.5 回復する', icon: ext(30, 2), x: -2, y: -1, max: 5, baseCost: 40, growth: 1.7, requires: ['hp'], effects: [add('regen', 0.5)] },
  { id: 'ko', branch: 'genbu', name: '不屈', desc: '気絶している時間 -10%', icon: ext(18, 2), x: -2, y: 1, max: 5, baseCost: 55, growth: 1.7, requires: ['hp'], effects: [pow('ko', 0.9)] },
  { id: 'revive', branch: 'genbu', name: '起死回生', desc: '気絶から立ち上がるときの HP +10%', icon: cat.icons.resurrection, x: -3, y: 1, max: 5, baseCost: 60, growth: 1.6, requires: ['ko'], effects: [add('revive', 0.1)] },
  { id: 'guard', branch: 'genbu', name: '受け身', desc: '受けるダメージ -5%', icon: ext(10, 2), x: -3, y: 0, max: 6, baseCost: 70, growth: 1.6, requires: ['hp'], effects: [pow('guard', 0.95)] },
  { id: 'grit', branch: 'genbu', name: '踏ん張り', desc: '敵に触れたときに足が鈍るのを、30% やわらげる', icon: ext(81, 3), x: -3, y: -1, max: 3, baseCost: 90, growth: 1.8, requires: ['regen'], effects: [add('grit', 0.3)] },
  { id: 'passive', branch: 'genbu', name: '英霊の加護', desc: 'ヒーローのパッシブスキルが発動しやすくなる（+20%）', icon: cat.icons.bufInt, x: -4, y: 0, max: 4, baseCost: 130, growth: 1.8, requires: ['guard'], effects: [mul('passive', 0.2)], flavor: 'new' },

  // 白虎: jostling (down-left)
  { id: 'strike', branch: 'byakko', name: '喧嘩殺法', desc: 'ストライク（直接攻撃）の威力 +25%', icon: ext(164, 3), x: -1, y: 1, max: 5, baseCost: 25, growth: 1.6, requires: ['root'], effects: [mul('strike', 0.25)] },
  { id: 'bump', branch: 'byakko', name: 'ショルダーチャージ', desc: 'ダッシュの体当たりでライバルを押しのける力 +30%（体当たりは反則にならない）', icon: ext(99, 3), x: -1, y: 2, max: 4, baseCost: 40, growth: 1.7, requires: ['strike'], effects: [mul('bump', 0.3)] },
  { id: 'foul', branch: 'byakko', name: '審判の死角', desc: '審判に止められるまでの反則ポイント +1', icon: ext(102, 3), x: -2, y: 2, max: 3, baseCost: 110, growth: 2, requires: ['bump'], effects: [add('foulLimit', 1)] },
  { id: 'freeze', branch: 'byakko', name: '言い逃れ', desc: '反則で止められる時間 -15%', icon: ext(3, 3), x: -2, y: 3, max: 4, baseCost: 80, growth: 1.7, requires: ['foul'], effects: [pow('freeze', 0.85)] },
  { id: 'items', branch: 'byakko', name: 'アイテムボックス', desc: 'コースにアイテムボックスが置かれるようになる。拾うとその場で発動（加速・雷・おとり）', icon: ext(178, 3), x: -1, y: 3, max: 1, baseCost: 200, growth: 1, requires: ['bump'], effects: [set('items', 1)], flavor: 'new' },
  { id: 'itemPower', branch: 'byakko', name: 'とっておき', desc: 'アイテムの効果 +25%', icon: ext(153, 3), x: -1, y: 4, max: 4, baseCost: 150, growth: 1.7, requires: ['items'], effects: [mul('itemPower', 0.25)] },

  // 黄竜: prize money and supply (down-right)
  { id: 'ce', branch: 'kouryu', name: '賞金アップ', desc: 'レースで得る CE +10%', icon: cat.icons.ce, x: 1, y: 1, max: 10, baseCost: 20, growth: 1.6, requires: ['root'], effects: [mul('ce', 0.1)] },
  { id: 'magnet', branch: 'kouryu', name: '吸い寄せ', desc: '落ちている CE を引き寄せる範囲 +30%', icon: ext(9, 2), x: 1, y: 2, max: 4, baseCost: 35, growth: 1.7, requires: ['ce'], effects: [mul('magnet', 0.3)] },
  { id: 'xp', branch: 'kouryu', name: '場数', desc: 'レース中のチーム Lv の上がりやすさ +10%', icon: ext(8, 2), x: 2, y: 2, max: 8, baseCost: 30, growth: 1.6, requires: ['ce'], effects: [mul('xp', 0.1)] },
  { id: 'pickups', branch: 'kouryu', name: '補給路', desc: 'コースに落ちているエクステンション +12%', icon: ext(47, 3), x: 2, y: 3, max: 5, baseCost: 80, growth: 1.8, requires: ['xp'], effects: [mul('pickups', 0.12)] },
  { id: 'luck', branch: 'kouryu', name: '目利き', desc: 'レアリティの高いエクステンションが出やすくなる', icon: ext(36, 3), x: 3, y: 3, max: 6, baseCost: 90, growth: 1.7, requires: ['pickups'], effects: [add('luck', 0.06)] },

  // 試練: make it harder on purpose; the best things are behind these (down)
  { id: 'hard', branch: 'trial', name: '強敵の試練', desc: 'エネミーの HP +30%。そのかわり、得る CE +25%', icon: foe('landBoss'), x: 0, y: 2, max: 3, baseCost: 100, growth: 2.2, requires: ['strike', 'ce'], effects: [mul('enemyHp', 0.3), mul('ce', 0.25)], flavor: 'risk' },
  { id: 'long', branch: 'trial', name: '延長戦', desc: 'コースが 12% 長くなる。その分、拾えるエクステンションも増え、得る CE +15%', icon: foe('ghost', 1), x: 0, y: 3, max: 3, baseCost: 150, growth: 2.2, requires: ['hard'], effects: [mul('course', 0.12), mul('pickups', 0.12), mul('ce', 0.15)], flavor: 'risk' },
  { id: 'horde', branch: 'trial', name: '大群の試練', desc: 'エネミーの数 +25%。そのかわり、チーム Lv が上がりやすくなる（+25%）', icon: foe('rabbit', 5), x: 0, y: 4, max: 3, baseCost: 200, growth: 2.2, requires: ['long'], effects: [mul('enemyCount', 0.25), mul('xp', 0.25)], flavor: 'risk' },
  { id: 'rival', branch: 'trial', name: '強豪参戦', desc: 'ライバルの足が 3% 速くなる。そのかわり、得る CE +30%', icon: foe('ghost', 0), x: 1, y: 4, max: 3, baseCost: 220, growth: 2.2, requires: ['long'], effects: [add('rival', 0.03), mul('ce', 0.3)], flavor: 'risk' },
  { id: 'relic', branch: 'trial', name: '英雄の遺産', desc: '拾ったエクステンションが 25% の確率で Lv2 として手に入る', icon: ext(98, 4), x: 0, y: 5, max: 3, baseCost: 3, growth: 1.6, requires: ['horde'], effects: [add('gearLv2', 0.25)], currency: 'medal', flavor: 'new' },
  { id: 'awake', branch: 'trial', name: '覚醒', desc: 'チーム Lv が上がるごとの威力の伸び +2%', icon: ext(100, 4), x: 1, y: 5, max: 3, baseCost: 3, growth: 1.6, requires: ['rival'], effects: [add('awake', 0.02)], currency: 'medal', flavor: 'new' },
];
export const NODE = new Map(SKILLS.map((n) => [n.id, n]));

/** One-time feats. Each is worth a medal; medals open the rarest nodes. */
export interface Feat { id: string; name: string; desc: string }
export const FEATS: Feat[] = [
  { id: 'gate1', name: '第一関門', desc: '陸の第一関門を通過する' },
  { id: 'gate2', name: '第二関門', desc: '陸の第二関門を通過する' },
  { id: 'gate3', name: '最後の番人', desc: '陸の最後の番人を突破する' },
  { id: 'goal', name: '完走', desc: '陸のゴールラインを踏む' },
  { id: 'land30', name: '予選通過', desc: '陸を 30 位以内でゴールする' },
  { id: 'land10', name: '先頭集団', desc: '陸を 10 位以内でゴールする' },
  { id: 'land1', name: '陸の覇者', desc: '陸を 1 位でゴールする' },
  { id: 'kill100', name: '百人斬り', desc: '1 回のレースでエネミーを 100 体倒す' },
  { id: 'kill300', name: '三百人斬り', desc: '1 回のレースでエネミーを 300 体倒す' },
  { id: 'lv8', name: 'チームワーク', desc: 'チーム Lv 8 に届く' },
  { id: 'noko', name: '無傷の走り', desc: '一度も気絶せずに陸を完走する' },
  { id: 'foul', name: 'レッドカード', desc: '反則を取られる' },
  { id: 'passive', name: '英霊の声', desc: 'パッシブスキルを発動させる' },
  { id: 'sea', name: '深海へ', desc: '海をクリアする' },
  { id: 'sky', name: '宇宙へ', desc: '空をクリアする' },
];

const KEY = 'mct.meta.v1';
export interface Meta {
  ce: number; medal: number; lv: Record<string, number>; feats: string[];
  runs: number; bestPlace: number | null; bestProgress: number; team: number[]; seenIntro: boolean;
}
const blank = (): Meta => ({ ce: 0, medal: 0, lv: { root: 1 }, feats: [], runs: 0, bestPlace: null, bestProgress: 0, team: [], seenIntro: false });
let state: Meta | null = null;
let cache: Stats | null = null;
let testMode = false;

export function meta(): Meta {
  if (state) return state;
  try {
    const txt = localStorage.getItem(KEY);
    state = txt ? { ...blank(), ...JSON.parse(txt) } : blank();
  } catch {
    state = blank();
  }
  state!.lv.root = 1;
  return state!;
}
export function saveMeta(): void {
  cache = null;
  if (testMode) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(meta()));
  } catch {
    /* the game still runs; it just does not remember */
  }
}
/** Debug / tests: start from a given tree. */
export function setMetaForTest(m: Partial<Meta>): void {
  state = { ...blank(), ...m };
  state.lv = { root: 1, ...(m.lv ?? {}) };
  cache = null;
  testMode = true;
}

export const levelOf = (id: string) => meta().lv[id] ?? 0;
export function costOf(n: SkillNode, level = levelOf(n.id)): number {
  return Math.round(n.baseCost * Math.pow(n.growth, level));
}
export const isOpen = (n: SkillNode) => n.requires.length === 0 || n.requires.some((r) => levelOf(r) > 0);
export function canBuy(n: SkillNode): boolean {
  const m = meta();
  if (!isOpen(n) || levelOf(n.id) >= n.max) return false;
  return (n.currency === 'medal' ? m.medal : m.ce) >= costOf(n);
}
export function buy(n: SkillNode): boolean {
  if (!canBuy(n)) return false;
  const m = meta();
  const c = costOf(n);
  if (n.currency === 'medal') m.medal -= c;
  else m.ce -= c;
  m.lv[n.id] = levelOf(n.id) + 1;
  saveMeta();
  return true;
}

export function computeStats(lv: Record<string, number>): Stats {
  const s: Stats = { ...BASE };
  const mulSum: Partial<Record<Key, number>> = {};
  for (const n of SKILLS) {
    const l = lv[n.id] ?? 0;
    if (!l) continue;
    for (const e of n.effects) {
      if (e.op === 'add') s[e.k] += e.v * l;
      else if (e.op === 'mul') mulSum[e.k] = (mulSum[e.k] ?? 0) + e.v * l;
      else if (e.op === 'pow') s[e.k] *= Math.pow(e.v, l);
      else s[e.k] = Math.max(s[e.k], e.v);
    }
  }
  for (const k of Object.keys(mulSum) as Key[]) s[k] *= 1 + (mulSum[k] ?? 0);
  return s;
}
export function stats(): Stats {
  if (!cache) cache = computeStats(meta().lv);
  return cache;
}

/** Marks a feat as done. Returns it when it is new (so it can be announced). */
export function earn(id: string): Feat | null {
  const m = meta();
  if (m.feats.includes(id)) return null;
  const f = FEATS.find((x) => x.id === id);
  if (!f) return null;
  m.feats.push(id);
  m.medal += 1;
  return f;
}
