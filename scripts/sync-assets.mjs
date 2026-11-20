#!/usr/bin/env node
// Builds the game catalog from the My Crypto Heroes asset database
// (https://github.com/bearko/mycryptoheroes) and copies only the files the game uses.
//
//   node scripts/sync-assets.mjs
//
// Source directory: $MCH_ASSETS_DIR, else vendor/mycryptoheroes (git submodule).
// Outputs: public/mch/** (copied assets) and src/generated/catalog.json.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, process.env.MCH_ASSETS_DIR ?? 'vendor/mycryptoheroes');
const outPublic = join(root, 'public', 'mch');
const outCatalog = join(root, 'src', 'generated', 'catalog.json');

if (!existsSync(join(src, 'Data'))) {
  console.error(`[sync-assets] asset database not found at ${src}`);
  console.error('Run `git submodule update --init` or set MCH_ASSETS_DIR.');
  process.exit(1);
}

const readJson = (p) => JSON.parse(readFileSync(join(src, p), 'utf8'));
let copied = 0;
/** Copies a file from the asset DB and returns its URL path relative to the site root. */
function use(relPath) {
  const from = join(src, relPath);
  if (!existsSync(from)) throw new Error(`missing asset: ${relPath}`);
  const to = join(outPublic, relPath);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  copied += 1;
  return `mch/${relPath}`;
}

rmSync(outPublic, { recursive: true, force: true });

const RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];

// ---------------------------------------------------------------- heroes
// Originals only (replicas and collaboration entries are left out).
/**
 * Reads a hero's passive skill into something the races can act on.
 * The wording of the original is kept (shown in the cut-in); only the trigger and the kind of effect are mapped.
 */
function parsePassive(p) {
  const d = p?.description?.ja;
  if (!p || !d) return null;
  const c = d.condition ?? '';
  const num = (re) => Number((c.match(re) ?? [])[1] ?? 0);
  let trig = 'tick';
  let pct = 0;
  if (/死亡した後/.test(c)) trig = 'death';
  else if (/バトル開始時/.test(c)) trig = 'start';
  else if (/HP(合計)?が\d+%(未満|以下)/.test(c)) { trig = 'hp'; pct = num(/HP(?:合計)?が(\d+)%/); }
  else if (/自身がActive Skillでダメージを受けた後/.test(c)) trig = 'hurt';
  else if (/自身がActive Skillを使用した後/.test(c)) trig = 'skill';
  const fx = [];
  for (const e of d.effects ?? []) {
    const t = e.description ?? '';
    const v = ((e.min_rate ?? 0) + (e.max_rate ?? e.min_rate ?? 0)) / 2;
    const foe = /^([^に を]*)敵/.test(t);
    let m;
    if (/復活/.test(t)) fx.push({ t: 'revive', v });
    else if (/ダメージ/.test(t) && foe) fx.push({ t: 'dmg', v, all: /敵全体/.test(t) });
    else if (/回復/.test(t)) fx.push({ t: 'heal', v });
    else if (/睡眠|気絶|混乱|恐怖/.test(t) && foe) fx.push({ t: 'sleep', v: e.success_rate ?? 50 });
    else if (/バリア/.test(t)) fx.push({ t: 'barrier', v });
    else if (/デコイ/.test(t)) fx.push({ t: 'decoy', v });
    else if ((m = t.match(/の(PHY|INT|AGI)[^のを]*を.*(アップ|ダウン)/))) {
      const up = m[2] === 'アップ';
      if (foe && !up) fx.push({ t: 'debuff', stat: m[1].toLowerCase(), v });
      else if (!foe && up) fx.push({ t: 'buff', stat: m[1].toLowerCase(), v });
    }
  }
  if (!fx.length) return null;
  return {
    name: p.name.ja, trig, pct, rate: d.trigger_rate ?? 100, once: /回だけ/.test(c),
    text: (d.text ?? '').replace('{triggerRate}', String(d.trigger_rate ?? 100)).replace(/\{successRate\}/g, '50'),
    fx,
  };
}

const heroes = readJson('Data/Heroes/heroes.json')
  .filter((h) => h.category === 'original' && RARITIES.includes(h.rarity?.name))
  .filter((h) => existsSync(join(src, h.image_file_path)))
  .map((h) => ({
    id: h.id,
    name: h.name.ja,
    rarity: h.rarity.id,
    faction: h.faction?.name?.ja ?? '',
    hp: h.max_level_stats.hp,
    phy: h.max_level_stats.phy,
    int: h.max_level_stats.int,
    agi: h.max_level_stats.agi,
    passive: parsePassive(h.passive),
    img: use(h.image_file_path),
  }));

// ---------------------------------------------------------------- extensions
// Each series is one "kind" of gear. The kind decides how it fights in each race.
const KIND_SERIES = {
  // swings in front of the hero
  slash: [1, 6, 11, 14, 15, 28, 34, 48, 51, 56, 73, 82, 97, 99, 100, 152, 161, 164, 171, 183],
  // shoots the nearest enemy
  shot: [2, 13, 29, 35, 49, 74, 124, 130, 153, 187, 188, 192],
  // homing magic
  magic: [3, 8, 16, 50, 57, 79, 80, 103, 104, 150, 158, 173, 174, 178],
  // circles around the hero
  orbit: [9, 10, 17, 75, 98, 102, 105, 111, 143, 147, 156],
  // a creature / vehicle that charges through
  beast: [5, 19, 20, 21, 22, 23, 24, 25, 26, 27, 86, 87, 88, 89, 90, 91, 92, 93, 94, 113, 115, 116, 117, 119,
    120, 121, 123, 125, 131, 132, 133, 134, 135, 136, 137, 139, 148, 149, 185, 186, 189, 194],
  // a pulse around the hero (music, food and drink)
  aura: [30, 32, 37, 39, 40, 41, 42, 43, 44, 45, 46, 55, 58, 64, 65, 66, 67, 68, 69, 70, 71, 72, 129, 151, 154,
    157, 165, 176],
  // worn: toughness and speed
  armor: [4, 18, 31, 36, 59, 61, 81, 95, 96, 110, 141, 193],
};
const kindOf = new Map();
for (const [kind, ids] of Object.entries(KIND_SERIES)) for (const id of ids) kindOf.set(id, kind);

const exts = readJson('Data/Extensions/extensions.json')
  .filter((e) => e.category !== 'replica' && RARITIES.includes(e.rarity?.name) && kindOf.has(e.series?.id))
  .filter((e) => existsSync(join(src, e.image_file_path)))
  .map((e) => ({
    id: e.id,
    name: e.name.ja,
    series: e.series.id,
    seriesName: e.series.name.ja,
    rarity: e.rarity.id,
    kind: kindOf.get(e.series.id),
    // physical or magical: whichever of PHY / INT is higher
    magic: (e.max_level_stats?.int ?? 0) > (e.max_level_stats?.phy ?? 0),
    img: use(e.image_file_path),
  }));

// ---------------------------------------------------------------- enemies
const enemyNames = new Map();
for (const e of readJson('Data/Enemies/enemies.json')) {
  const file = e.raw?.image;
  if (file && !enemyNames.has(file)) enemyNames.set(file, e.name.ja);
}
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const ENEMY_SETS = {
  // land
  rabbit: range(386, 391),
  chameleon: range(408, 413),
  bandit: range(161, 166),
  melissa: range(131, 136),
  ghost: [450, 461, 451, 445, 456, 481, 486, 436],
  landBoss: [372],
  // sea
  creeper: range(101, 106),
  elk: range(111, 116),
  cascade: range(375, 380),
  yoshka: [171, 172, 370, 371],
  seaBoss: [1190],
  // sky
  bagel: range(181, 186),
  letter: range(397, 402),
  heart: range(121, 126),
  skyMid: [1183],
  skyBoss: [373],
};
const enemies = {};
for (const [key, ids] of Object.entries(ENEMY_SETS)) {
  enemies[key] = ids.map((id) => ({
    id,
    name: enemyNames.get(`${id}.png`) ?? '',
    img: use(`Image/Enemies/${id}.png`),
  }));
}

// ---------------------------------------------------------------- everything else
const catalog = {
  heroes,
  exts,
  enemies,
  bg: {
    title: use('Image/Backgrounds/1046.png'),
    sky: use('Image/Backgrounds/2805.png'),
    space: use('Image/Backgrounds/2605.png'),
  },
  fx: {
    hit: use('Image/Effects/Battle/01_single_damage.png'),
    blast: use('Image/Effects/Battle/02_area_damage.png'),
  },
  icons: {
    ce: use('Image/Icons/ce.png'),
    gum: use('Image/Icons/gum.png'),
    resurrection: use('Image/BattleIcons/StatusEffects/resurrection.png'),
    sleep: use('Image/BattleIcons/StatusEffects/sleep.png'),
    decoy: use('Image/BattleIcons/StatusEffects/decoy.png'),
    bufPhy: use('Image/BattleIcons/Buffs/buf_phy.png'),
    bufInt: use('Image/BattleIcons/Buffs/buf_int.png'),
    bufAgi: use('Image/BattleIcons/Buffs/buf_agi.png'),
    dbfAgi: use('Image/BattleIcons/Buffs/dbf_agi.png'),
  },
  chars: {
    chrisIdle: use('Image/Characters/chris_00_idle.png'),
    chrisCheer: use('Image/Characters/chris_03_cheer.png'),
    chrisGuts: use('Image/Characters/chris_04_guts_pose.png'),
    chrisSad: use('Image/Characters/chris_08_sad.png'),
    ainUp: use('Image/Characters/navi_ain_02_both_arms_up.png'),
    ainPoint: use('Image/Characters/navi_ain_00_pointer_up.png'),
    ainTalk: use('Image/Characters/navi_ain_07_talk.png'),
    ref: use('Image/Characters/maycri_02_eyes_wide.png'),
    refAngry: use('Image/Characters/maycri_03_eyes_thin.png'),
    ainSmile: use('Image/Characters/navi_ain_06_smile.png'),
    chrisTalk: use('Image/Characters/chris_speak_01_talk.png'),
    chrisCry: use('Image/Characters/chris_cry_01_cry.png'),
  },
  bgm: {
    title: use('Audio/BGM/land.mp3'),
    land: use('Audio/BGM/land-battle.mp3'),
    sea: use('Audio/BGM/pve.mp3'),
    sky: use('Audio/BGM/colosseum.mp3'),
  },
  se: {
    hit: use('Audio/SE/Battle/1_single_damage.mp3'),
    blast: use('Audio/SE/Battle/2_area_damage.mp3'),
    heal: use('Audio/SE/Battle/3_heal_resurrection.mp3'),
    buff: use('Audio/SE/Battle/4_buff.mp3'),
    chest: use('Audio/SE/Actions/open_treasure.mp3'),
    win: use('Audio/SE/Jingles/win.mp3'),
    lose: use('Audio/SE/Jingles/lose.mp3'),
    clear: use('Audio/SE/clear.wav'),
  },
};

mkdirSync(dirname(outCatalog), { recursive: true });
writeFileSync(outCatalog, JSON.stringify(catalog));
console.log(
  `[sync-assets] ${heroes.length} heroes, ${exts.length} extensions, ` +
    `${Object.values(enemies).flat().length} enemies, ${copied} files copied`,
);
