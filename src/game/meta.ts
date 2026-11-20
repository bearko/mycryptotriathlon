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
  strike: number; bump: number; foulLimit: number; freeze: number;
  ce: number; xp: number; gum: number; magnet: number; reroll: number; options: number;
  startLv: number; startExtra: number; maxLv: number; wSlots: number; bSlots: number; awake: number;
  // gear opened in the tree (0 / 1)
  wBook: number; wBroom: number; wShuriken: number; wParrot: number; wLaser: number; wSnow: number;
  bRamen: number; bHorse: number; bShield: number; bOriflamme: number; bSpecimen: number; bGunbai: number; bGyoku: number; bCrown: number;
  // helper items
  iTrap: number; iDecoy: number; iMirror: number; iBolt: number; iDragon: number; itemPower: number; itemSlots: number; chests: number;
  enemyHp: number; enemyCount: number; course: number; rival: number;
  // the sea: digging speed, how fast the tank empties, what a vent gives back, the harpoon
  dig: number; o2: number; vent: number; harpoon: number;
}
export const BASE: Stats = {
  dmg: 1, speed: 1, hp: 1, regen: 0, cd: 1, crit: 0.04,
  dashCd: 1, dashHit: 0, rocket: 0, draft: 0, pads: 0, padPower: 1,
  guard: 1, ko: 1, revive: 0.4, grit: 0, passive: 1,
  strike: 1, bump: 1, foulLimit: 5, freeze: 1,
  ce: 1, xp: 1, gum: 1, magnet: 1, reroll: 0, options: 3,
  startLv: 1, startExtra: 0, maxLv: 3, wSlots: 3, bSlots: 3, awake: 0,
  wBook: 0, wBroom: 0, wShuriken: 0, wParrot: 0, wLaser: 0, wSnow: 0,
  bRamen: 0, bHorse: 0, bShield: 0, bOriflamme: 0, bSpecimen: 0, bGunbai: 0, bGyoku: 0, bCrown: 0,
  iTrap: 0, iDecoy: 0, iMirror: 0, iBolt: 0, iDragon: 0, itemPower: 1, itemSlots: 2, chests: 1,
  enemyHp: 1, enemyCount: 1, course: 1, rival: 0,
  dig: 1, o2: 1, vent: 1, harpoon: 1,
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

const art = (id: number) => cat.extArt[String(id)]?.img ?? cat.exts[0].img;
const foe = (key: string, i = 0) => cat.enemies[key][i].img;
type N = Omit<SkillNode, 'growth' | 'max' | 'baseCost'> & { max?: number; baseCost: number; growth?: number };
const node = (n: N): SkillNode => ({ max: 1, growth: 1, ...n });
/** A node that opens a piece of gear or a helper item: one level, gold frame. */
const open = (id: string, branch: Branch, name: string, what: string, icon: number, x: number, y: number, cost: number, requires: string[], key: Key, currency?: Currency): SkillNode =>
  node({ id, branch, name, desc: what, icon: art(icon), x, y, baseCost: cost, requires, effects: [set(key, 1)], flavor: 'new', currency });

export const SKILLS: SkillNode[] = [
  node({ id: 'root', branch: 'root', name: 'エントリー', desc: 'トライアスロンへの参加登録。ここから五勢力の鍛錬が広がる', icon: cat.chars.chrisCheer, x: 0, y: 0, baseCost: 0, requires: [], effects: [] }),

  // 朱雀: the gear that fights, and how hard it hits (up)
  node({ id: 'atk', branch: 'suzaku', name: '鍛錬', desc: 'エクステンションの威力 +8%', icon: art(2001), x: 0, y: -1, max: 10, baseCost: 12, growth: 1.45, requires: ['root'], effects: [mul('dmg', 0.08)] }),
  node({ id: 'startLv', branch: 'suzaku', name: '愛用の品', desc: '最初に持っているエクステンションの Lv +1', icon: art(1001), x: -1, y: -2, max: 2, baseCost: 60, growth: 4, requires: ['atk'], effects: [add('startLv', 1)] }),
  node({ id: 'cd', branch: 'suzaku', name: '早業', desc: 'エクステンションの攻撃間隔 -4%', icon: art(2006), x: 1, y: -2, max: 8, baseCost: 30, growth: 1.55, requires: ['atk'], effects: [pow('cd', 0.96)] }),
  open('wBook', 'suzaku', 'ブックの解禁', 'まわりを回って守る「ブック」が、レベルアップの候補に出るようになる', 3008, 0, -2, 50, ['atk'], 'wBook'),
  open('wShuriken', 'suzaku', '手裏剣の解禁', '近い敵へ 3 連で飛ぶ「手裏剣」が候補に出るようになる', 3124, 0, -3, 120, ['wBook'], 'wShuriken'),
  open('wBroom', 'suzaku', 'ホーキの解禁', 'ゆっくり追いかけて貫く大きな「ホーキ」が候補に出るようになる', 3080, -1, -3, 220, ['wShuriken'], 'wBroom'),
  open('wParrot', 'suzaku', 'パロットの解禁', '敵の頭上から舞い降りる「パロット」が候補に出るようになる', 3113, 1, -3, 220, ['wShuriken'], 'wParrot'),
  open('wLaser', 'suzaku', 'レーザーガンの解禁', '敵をまとめて貫く「レーザーガン」が候補に出るようになる', 3130, -1, -4, 380, ['wBroom'], 'wLaser'),
  open('wSnow', 'suzaku', '雪だるまの解禁', '足もとに置いて爆ぜる「雪だるま」が候補に出るようになる', 3126, 1, -4, 380, ['wParrot'], 'wSnow'),
  node({ id: 'tier4', branch: 'suzaku', name: 'インペリアル級', desc: 'エクステンションを Lv4 まで育てられる', icon: art(4001), x: 0, y: -4, baseCost: 350, requires: ['wShuriken'], effects: [set('maxLv', 4)], flavor: 'new' }),
  node({ id: 'tier5', branch: 'suzaku', name: 'MCH級', desc: 'エクステンションを Lv5 まで育てられる', icon: art(5001), x: 0, y: -5, baseCost: 4, requires: ['tier4'], effects: [set('maxLv', 5)], currency: 'medal', flavor: 'new' }),
  node({ id: 'wSlots', branch: 'suzaku', name: '武器の枠', desc: '同時に持てる武器の種類 +1', icon: art(3096), x: 0, y: -6, max: 2, baseCost: 5, growth: 1.6, requires: ['tier5'], effects: [add('wSlots', 1)], currency: 'medal', flavor: 'new' }),
  node({ id: 'crit', branch: 'suzaku', name: '会心', desc: '会心（1.8倍）の確率 +3%', icon: art(3028), x: 2, y: -3, max: 8, baseCost: 80, growth: 1.55, requires: ['cd'], effects: [add('crit', 0.03)] }),
  open('bOriflamme', 'suzaku', 'オリフラムの解禁', '弾の数を増やす「オリフラム」が候補に出るようになる', 3140, 2, -4, 260, ['crit'], 'bOriflamme'),
  open('bGunbai', 'suzaku', 'グンバイの解禁', '弾が敵を貫くようになる「グンバイ」が候補に出るようになる', 3037, 2, -5, 320, ['bOriflamme'], 'bGunbai'),
  open('bSpecimen', 'suzaku', '標本の解禁', '攻撃の届く範囲を広げる「標本」が候補に出るようになる', 3169, -2, -3, 160, ['startLv'], 'bSpecimen'),
  node({ id: 'start2', branch: 'suzaku', name: '二刀流', desc: '最初から、もう 1 つ武器を持って走り出す', icon: art(3082), x: -2, y: -4, baseCost: 400, requires: ['bSpecimen'], effects: [add('startExtra', 1)], flavor: 'new' }),
  node({ id: 'bSlots', branch: 'suzaku', name: '強化の枠', desc: '同時に持てる強化の種類 +1', icon: art(3017), x: -2, y: -5, max: 2, baseCost: 4, growth: 1.6, requires: ['start2'], effects: [add('bSlots', 1)], currency: 'medal', flavor: 'new' }),

  // 青龍: speed (right)
  node({ id: 'speed', branch: 'seiryu', name: '俊足', desc: '走る・泳ぐ速さ +2.5%', icon: art(2031), x: 1, y: 0, max: 10, baseCost: 12, growth: 1.5, requires: ['root'], effects: [mul('speed', 0.025)] }),
  node({ id: 'dash', branch: 'seiryu', name: '身のこなし', desc: 'ダッシュの再使用までの時間 -7%', icon: art(2005), x: 2, y: -1, max: 6, baseCost: 30, growth: 1.6, requires: ['speed'], effects: [pow('dashCd', 0.93)] }),
  node({ id: 'rocket', branch: 'seiryu', name: 'ロケットスタート', desc: 'スタート直後の加速（+40%）が 1.5 秒のびる', icon: art(3121), x: 2, y: 1, max: 4, baseCost: 45, growth: 1.9, requires: ['speed'], effects: [add('rocket', 1.5)] }),
  node({ id: 'draft', branch: 'seiryu', name: 'スリップストリーム', desc: '前を走るヒーローの真後ろにつくと、速さ +5%', icon: art(3120), x: 3, y: 0, max: 5, baseCost: 90, growth: 1.7, requires: ['speed'], effects: [add('draft', 0.05)], flavor: 'new' }),
  node({ id: 'dashHit', branch: 'seiryu', name: '突破', desc: 'ダッシュで触れた敵をはじき飛ばしてダメージを与える', icon: art(3023), x: 3, y: -1, max: 5, baseCost: 110, growth: 1.7, requires: ['dash'], effects: [add('dashHit', 1)], flavor: 'new' }),
  open('bHorse', 'seiryu', 'ホースの解禁', '攻撃の間隔を縮める「ホース」が候補に出るようになる', 3005, 4, -1, 240, ['dashHit'], 'bHorse'),
  node({ id: 'pads', branch: 'seiryu', name: 'ダッシュパネル', desc: 'コースに、踏むと加速するパネルが置かれるようになる', icon: art(3115), x: 4, y: 0, baseCost: 180, requires: ['draft'], effects: [set('pads', 1)], flavor: 'new' }),
  node({ id: 'padPower', branch: 'seiryu', name: 'パネルの整備', desc: 'ダッシュパネルの加速が 20% 長く続く', icon: art(3038), x: 5, y: 0, max: 5, baseCost: 120, growth: 1.6, requires: ['pads'], effects: [mul('padPower', 0.2)] }),
  // …and the sea
  node({ id: 'dig', branch: 'seiryu', name: '発掘の心得', desc: '海で、遺物や秘宝を掘る速さ +15%', icon: art(3109), x: 3, y: 1, max: 5, baseCost: 60, growth: 1.7, requires: ['rocket'], effects: [mul('dig', 0.15)], flavor: 'new' }),
  node({ id: 'o2', branch: 'seiryu', name: '深呼吸', desc: '海で、酸素の減りが 6% おそくなる', icon: art(3044), x: 4, y: 1, max: 5, baseCost: 80, growth: 1.7, requires: ['dig'], effects: [pow('o2', 0.94)] }),
  node({ id: 'vent', branch: 'seiryu', name: '泡の恵み', desc: '海の噴気孔で回復する酸素 +25%', icon: art(3051), x: 5, y: 1, max: 4, baseCost: 90, growth: 1.7, requires: ['o2'], effects: [mul('vent', 0.25)] }),
  node({ id: 'harpoon', branch: 'seiryu', name: '銛の名手', desc: '海で、銛の威力 +20%。撃つ間隔も少し縮む', icon: art(3007), x: 4, y: 2, max: 5, baseCost: 80, growth: 1.7, requires: ['dig'], effects: [mul('harpoon', 0.2)] }),

  // 玄武: staying on your feet (left)
  node({ id: 'hp', branch: 'genbu', name: '頑健', desc: '最大 HP（海では酸素）+8%', icon: art(2004), x: -1, y: 0, max: 10, baseCost: 12, growth: 1.5, requires: ['root'], effects: [mul('hp', 0.08)] }),
  node({ id: 'regen', branch: 'genbu', name: '自然治癒', desc: '毎秒 HP が 0.5 回復する', icon: art(2030), x: -2, y: -1, max: 5, baseCost: 40, growth: 1.7, requires: ['hp'], effects: [add('regen', 0.5)] }),
  node({ id: 'ko', branch: 'genbu', name: '不屈', desc: '気絶している時間 -10%', icon: art(2018), x: -2, y: 1, max: 5, baseCost: 55, growth: 1.7, requires: ['hp'], effects: [pow('ko', 0.9)] }),
  node({ id: 'revive', branch: 'genbu', name: '起死回生', desc: '気絶から立ち上がるときの HP +10%', icon: cat.icons.resurrection, x: -3, y: 1, max: 5, baseCost: 60, growth: 1.6, requires: ['ko'], effects: [add('revive', 0.1)] }),
  node({ id: 'guard', branch: 'genbu', name: '受け身', desc: '受けるダメージ -5%', icon: art(2010), x: -3, y: 0, max: 6, baseCost: 70, growth: 1.6, requires: ['hp'], effects: [pow('guard', 0.95)] }),
  node({ id: 'grit', branch: 'genbu', name: '踏ん張り', desc: '敵に触れたときに足が鈍るのを、30% やわらげる', icon: art(3081), x: -3, y: -1, max: 3, baseCost: 90, growth: 1.8, requires: ['regen'], effects: [add('grit', 0.3)] }),
  node({ id: 'passive', branch: 'genbu', name: '英霊の加護', desc: 'ヒーローのパッシブスキルが発動しやすくなる（+20%）', icon: cat.icons.bufInt, x: -4, y: 0, max: 4, baseCost: 130, growth: 1.8, requires: ['guard'], effects: [mul('passive', 0.2)], flavor: 'new' }),
  open('bRamen', 'genbu', 'ラーメンの解禁', '毎秒 HP が回復する「ラーメン」が候補に出るようになる', 3154, -4, -1, 140, ['grit'], 'bRamen'),
  open('bShield', 'genbu', 'シールドの解禁', '受けるダメージを減らす「シールド」が候補に出るようになる', 3010, -4, 1, 140, ['revive'], 'bShield'),

  // 白虎: jostling, and the helper items from the chest panels (down-left)
  node({ id: 'strike', branch: 'byakko', name: '喧嘩殺法', desc: 'ストライク（直接攻撃）の威力 +25%', icon: art(3164), x: -1, y: 1, max: 5, baseCost: 25, growth: 1.6, requires: ['root'], effects: [mul('strike', 0.25)] }),
  node({ id: 'bump', branch: 'byakko', name: 'ショルダーチャージ', desc: 'ダッシュの体当たりでライバルを押しのける力 +30%（体当たりは反則にならない）', icon: art(3099), x: -1, y: 2, max: 4, baseCost: 40, growth: 1.7, requires: ['strike'], effects: [mul('bump', 0.3)] }),
  node({ id: 'foul', branch: 'byakko', name: '審判の死角', desc: '審判に止められるまでの反則ポイント +1', icon: art(3102), x: -2, y: 2, max: 3, baseCost: 110, growth: 2, requires: ['bump'], effects: [add('foulLimit', 1)] }),
  node({ id: 'freeze', branch: 'byakko', name: '言い逃れ', desc: '反則で止められる時間 -15%', icon: art(3003), x: -2, y: 3, max: 4, baseCost: 80, growth: 1.7, requires: ['foul'], effects: [pow('freeze', 0.85)] }),
  node({ id: 'chests', branch: 'byakko', name: '宝箱パネルの増設', desc: 'コースの宝箱パネル +20%', icon: art(3178), x: -1, y: 3, max: 3, baseCost: 70, growth: 1.9, requires: ['bump'], effects: [mul('chests', 0.2)] }),
  node({ id: 'itemPower', branch: 'byakko', name: 'とっておき', desc: 'お助けエクステンションの効果 +20%', icon: art(3153), x: -1, y: 4, max: 5, baseCost: 90, growth: 1.7, requires: ['chests'], effects: [mul('itemPower', 0.2)] }),
  open('iTrap', 'byakko', 'ネズミ捕りの追加', '宝箱パネルから「ネズミ捕り」が出るようになる。うしろに仕掛けて、踏んだライバルの足を止める', 1179, -2, 4, 90, ['chests'], 'iTrap'),
  open('iMirror', 'byakko', '鏡の追加', '宝箱パネルから「鏡」が出るようになる。しばらく妨害をはね返す', 1105, -3, 4, 150, ['iTrap'], 'iMirror'),
  open('iDecoy', 'byakko', 'こけしの追加', '宝箱パネルから「こけし」が出るようになる。エネミーがまわりのライバルへ向かう', 1127, -1, 5, 180, ['itemPower'], 'iDecoy'),
  open('iBolt', 'byakko', '御札の追加', '宝箱パネルから「御札」が出るようになる。雷で、前を行くライバル全員の足を止める（順位が低いほど出やすい）', 1103, -2, 5, 260, ['iTrap'], 'iBolt'),
  open('iDragon', 'byakko', 'ライドラゴンの追加', '宝箱パネルから「ライドラゴン」が出るようになる。竜に乗って猛スピードで飛ぶ（順位が低いほど出やすい）', 3117, -2, 6, 3, ['iBolt'], 'iDragon', 'medal'),
  node({ id: 'itemSlots', branch: 'byakko', name: '三つ目のポケット', desc: 'お助けエクステンションを 3 つまで持てる', icon: art(3172), x: -3, y: 5, baseCost: 3, requires: ['iMirror'], effects: [set('itemSlots', 3)], currency: 'medal', flavor: 'new' }),

  // 黄竜: prize money and experience (down-right)
  node({ id: 'ce', branch: 'kouryu', name: '賞金アップ', desc: 'レースで得る CE +10%', icon: cat.icons.ce, x: 1, y: 1, max: 10, baseCost: 20, growth: 1.6, requires: ['root'], effects: [mul('ce', 0.1)] }),
  node({ id: 'magnet', branch: 'kouryu', name: '吸い寄せ', desc: '落ちている経験を引き寄せる範囲 +30%', icon: art(2009), x: 1, y: 2, max: 4, baseCost: 35, growth: 1.7, requires: ['ce'], effects: [mul('magnet', 0.3)] }),
  node({ id: 'xp', branch: 'kouryu', name: '場数', desc: 'レース中に得る経験 +10%（レベルアップが早くなる）', icon: art(2008), x: 2, y: 2, max: 8, baseCost: 30, growth: 1.6, requires: ['ce'], effects: [mul('xp', 0.1)] }),
  open('bGyoku', 'kouryu', 'ギョクの解禁', '経験を引き寄せる範囲を広げる「ギョク」が候補に出るようになる', 3098, 1, 3, 120, ['magnet'], 'bGyoku'),
  open('bCrown', 'kouryu', 'クラウンの解禁', '得る経験と GUM を増やす「クラウン」が候補に出るようになる', 3036, 2, 3, 160, ['xp'], 'bCrown'),
  node({ id: 'reroll', branch: 'kouryu', name: '引き直し', desc: 'レベルアップの候補を、1 レースにつき 1 回多く引き直せる', icon: art(3111), x: 3, y: 2, max: 3, baseCost: 100, growth: 2, requires: ['xp'], effects: [add('reroll', 1)], flavor: 'new' }),
  node({ id: 'gum', branch: 'kouryu', name: '商才', desc: 'エネミーが落とす GUM +15%', icon: cat.icons.gum, x: 3, y: 3, max: 6, baseCost: 80, growth: 1.6, requires: ['bCrown'], effects: [mul('gum', 0.15)] }),

  // 試練: make it harder on purpose; the best things are behind these (down)
  node({ id: 'hard', branch: 'trial', name: '強敵の試練', desc: 'エネミーの HP +30%。そのかわり、得る CE +25%', icon: foe('landBoss'), x: 0, y: 2, max: 3, baseCost: 100, growth: 2.2, requires: ['strike', 'ce'], effects: [mul('enemyHp', 0.3), mul('ce', 0.25)], flavor: 'risk' }),
  node({ id: 'long', branch: 'trial', name: '延長戦', desc: 'コースが 12% 長くなる。育つ時間がのび、宝箱パネルも増え、得る CE +15%', icon: foe('ghost', 1), x: 0, y: 3, max: 3, baseCost: 150, growth: 2.2, requires: ['hard'], effects: [mul('course', 0.12), mul('ce', 0.15)], flavor: 'risk' }),
  node({ id: 'horde', branch: 'trial', name: '大群の試練', desc: 'エネミーの数 +25%。そのぶん経験も GUM も多く落ちる', icon: foe('rabbit', 5), x: 0, y: 4, max: 3, baseCost: 200, growth: 2.2, requires: ['long'], effects: [mul('enemyCount', 0.25)], flavor: 'risk' }),
  node({ id: 'rival', branch: 'trial', name: '強豪参戦', desc: 'ライバルの足が 3% 速くなる。そのかわり、得る CE +30%', icon: foe('ghost', 0), x: 1, y: 4, max: 3, baseCost: 220, growth: 2.2, requires: ['long'], effects: [add('rival', 0.03), mul('ce', 0.3)], flavor: 'risk' }),
  node({ id: 'options', branch: 'trial', name: '英雄の遺産', desc: 'レベルアップの候補が 4 枚になる', icon: art(4098), x: 0, y: 5, baseCost: 3, requires: ['horde'], effects: [set('options', 4)], currency: 'medal', flavor: 'new' }),
  node({ id: 'awake', branch: 'trial', name: '覚醒', desc: 'チーム Lv が上がるごとに、威力 +1.5%', icon: art(4100), x: 1, y: 5, max: 3, baseCost: 3, growth: 1.6, requires: ['rival'], effects: [add('awake', 0.015)], currency: 'medal', flavor: 'new' }),
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
  { id: 'sea', name: '深海へ', desc: '海で秘宝を手に入れる（10 位以内）' },
  { id: 'sea1', name: '海の覇者', desc: '海で最初に秘宝を手に入れる' },
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
