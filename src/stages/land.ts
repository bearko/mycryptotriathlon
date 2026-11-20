// LAND: fifty teams, one road. Run to the goal on the right; only the first thirty go on to the sea.
// Three guardians bar the way: each runner has to land their own share of blows before the gate lets them by.
// Gear lies along the road, and everyone wants it.

import { sample, sfx } from '../core/audio';
import { cat, type EnemyArt, type Hero } from '../core/catalog';
import { input, pressItem, takeItemPress } from '../core/input';
import { clamp, dist2, hash2, mixColor, TAU } from '../core/util';
import { earn } from '../game/meta';
import { rollItem, xpNeed } from '../game/run';
import { itemImg, type Item } from '../game/roster';
import { Arena, makeRunner, type Enemy, type Runner } from './arena';
import type { Host } from './stage';

const H = 1000;
const TOP = 70;
const BOTTOM = 930;
/** Panels in one row of chests, how long a taken one stays away, and how far before a gate the run turns into free movement. */
const CHEST_ROW = 6;
const CHEST_BACK = 5;
const FREE_ZONE = 560;
/** From the last guardian to the goal line: places can still change here. */
const LAST_RUN = 900;
export const FIELD = 50;
export const QUOTA = 30;
/** Rivals' cruising speed: the slowest and how much faster the best are. */
const PACE_MIN = 232;
const PACE_SPAN = 74;

interface Gate { x: number; boss: Enemy | null; art: EnemyArt; need: number; size: number; tier: number; first: boolean; passed: number }
interface Decor { x: number; y: number; kind: number; s: number }
interface Pad { x: number; y: number }
interface Chest { x: number; y: number; taken: boolean; t: number; back: number }
interface Roller { x: number; y: number; life: number; owner: Runner; rot: number }
interface Trap { x: number; y: number; owner: Runner; t: number }

const GROUND: [number, number, number][] = [[58, 122, 74], [156, 132, 78], [74, 62, 112]];
const ROAD: [number, number, number][] = [[196, 176, 124], [206, 180, 130], [120, 108, 150]];

export class LandStage extends Arena {
  private len: number;
  private gates: Gate[];
  private decor: Decor[] = [];
  private pads: Pad[] = [];
  private chests: Chest[] = [];
  private freeMove = false;
  private rollers: Roller[] = [];
  private traps: Trap[] = [];
  private spawnT = 1.2;
  private pattern: CanvasPattern | null = null;
  private passed = 0;
  private place = FIELD;
  private rankT = 0;
  private chatT = 4;
  private lead = '';
  private told = new Set<string>();
  private kos = 0;
  /** Debug: when each rival crossed the line. */
  finishTimes: number[] = [];

  constructor(host: Host) {
    super(host, 0, 11);
    this.koMode = true;
    this.showDone = true;
    const st = this.st;
    this.len = Math.round(10500 * st.course);
    const L = this.len;
    const en = cat.enemies;
    this.gates = [
      { x: Math.round(L / 3), boss: null, art: en.ghost[0], need: 1000, size: 112, tier: 0, first: true, passed: 0 },
      { x: Math.round((L * 2) / 3), boss: null, art: en.ghost[1], need: 3200, size: 124, tier: 1, first: true, passed: 0 },
      { x: L - LAST_RUN, boss: null, art: en.landBoss[0], need: 2000, size: 176, tier: 2, first: true, passed: 0 },
    ];
    const h = this.hero;
    h.x = 150;
    h.y = H / 2;

    // the other forty-nine teams
    const rng = this.rng;
    const mine = new Set(this.run.heroes.map((x) => x.id));
    const pool: Hero[] = cat.heroes.filter((x) => !mine.has(x.id));
    for (let i = 0; i < FIELD - 1; i++) {
      const art = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      const r = makeRunner(art, false);
      const skill = i / (FIELD - 2);
      // the field is uneven on purpose: a pack in the middle, and a few teams far out in front
      r.pace = (PACE_MIN + PACE_SPAN * skill + 40 * skill ** 3 + (Math.random() - 0.5) * 10) * (1 + st.rival);
      r.dps = 140 + 240 * skill + 330 * skill ** 3;
      r.mood = Math.random();
      r.maxHp = r.hp = 150;
      r.x = 70 + Math.random() * 190;
      r.y = TOP + 40 + ((i * 37) % (BOTTOM - TOP - 80));
      r.laneY = r.y;
      r.think = Math.random();
      this.rivals.push(r);
    }

    // referees: one before each gate (where the crowd bunches up) and a few along the open road
    const spots: number[] = [];
    for (const gt of this.gates) spots.push(gt.x - 300);
    for (let x = 1500; x < L - 600; x += 1700) if (!this.gates.some((gt) => Math.abs(gt.x - 300 - x) < 700)) spots.push(x);
    spots.forEach((x, i) => {
      this.refs.push({ x, y: H / 2, r: 230, homeY: H / 2 + (i % 2 ? 130 : -130), t: i * 2.1, alert: 0 });
    });

    // treasure-chest panels: a row right across the road, so nobody can miss it. Step on one for a helper item;
    // a panel that has been taken comes back after a few seconds
    const n = Math.round(7 * st.chests * st.course);
    for (let i = 0; i < n; i++) {
      const x = 800 + ((L - 1600) / n) * i;
      if (this.gates.some((gt) => x > gt.x - 700 && x < gt.x + 200)) continue;
      for (let k = 0; k < CHEST_ROW; k++) {
        this.chests.push({ x, y: TOP + ((BOTTOM - TOP) * (k + 0.5)) / CHEST_ROW, taken: false, t: k * 0.4, back: 0 });
      }
    }
    // things the skill tree adds to the course
    if (st.pads) {
      for (let x = 700; x < L - 400; x += 760 + rng() * 300) {
        if (this.gates.some((gt) => Math.abs(gt.x - x) < 260)) continue;
        this.pads.push({ x, y: TOP + 90 + rng() * (BOTTOM - TOP - 180) });
      }
    }
    for (let i = 0; i < 400; i++) {
      const y = TOP + rng() * (BOTTOM - TOP);
      if (Math.abs(y - H / 2) < 130 && rng() < 0.8) continue;
      this.decor.push({ x: rng() * (L + 400), y, kind: Math.floor(rng() * 4), s: 0.7 + rng() * 0.9 });
    }
    this.decor.sort((a, b) => a.x - b.x);

    const tile = document.createElement('canvas');
    tile.width = tile.height = 128;
    const tg = tile.getContext('2d')!;
    for (let i = 0; i < 260; i++) {
      const v = hash2(i, 7);
      tg.fillStyle = v < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.06)';
      const s = 2 + Math.floor(hash2(i, 9) * 3) * 2;
      tg.fillRect(Math.floor(hash2(i, 1) * 64) * 2, Math.floor(hash2(i, 2) * 64) * 2, s, 2);
    }
    this.pattern = this.g.createPattern(tile, 'repeat');

    // the guardians are there from the start; they wake when a runner comes close
    for (const gt of this.gates) {
      gt.boss = this.spawn({ url: gt.art.img, name: gt.art.name }, gt.x - 130, H / 2, {
        hp: 1e9, size: gt.size, r: gt.size * 0.3, speed: 66 + gt.tier * 8, dmg: 13 + gt.tier * 3,
        ai: 'boss', boss: true, xp: 0, tier: gt.tier, timer: 1.4, asleep: true,
      });
    }

    host.hud.slots(this.run.slots);
    host.items(this.run);
    host.hud.fouls(0, st.foulLimit);
    host.hud.objective('自動で前へ走る。上下に動いて、30位以内でゴールせよ！');
    host.hud.say(`さあ始まりました、マイクリプト・トライアスロン！ ${FIELD}組が一斉にスタート！`, 3);
    host.hud.say(`通過できるのは上位${QUOTA}組だけ。関門の番人をどう抜けるかが鍵ですね`, 2, 'ain');
    this.follow(1);
  }

  private follow(k: number): void {
    const h = this.hero;
    const tx = this.outro ? h.x - this.vw * 0.38 : clamp(h.x - this.vw * 0.38, 0, this.len + 260 - this.vw);
    const ty = clamp(h.y - this.vh / 2, 0, H - this.vh);
    this.camX += (tx - this.camX) * k;
    this.camY += (ty - this.camY) * k;
  }

  protected moveBody(b: { x: number; y: number; r: number }, dx: number, dy: number): void {
    b.x += dx;
    b.y = clamp(b.y + dy, TOP + b.r, BOTTOM - b.r);
    const gi = (b as Runner).gate;
    if (gi !== undefined) {
      const gate = this.gates[gi];
      b.x = clamp(b.x, 30, gate ? gate.x - 26 : this.len + 200);
    } else {
      b.x = clamp(b.x, -200, this.len + 300);
    }
  }

  /** A runner has paid their dues at the gate in front of them. */
  private pass(r: Runner): void {
    const gate = this.gates[r.gate];
    if (!gate) return;
    r.gate += 1;
    r.quota = 0;
    gate.passed += 1;
    const hud = this.host.hud;
    const which = gate.tier === 2 ? '最後の番人' : gate.tier === 0 ? '第一関門' : '第二関門';
    if (gate.first) {
      gate.first = false;
      hud.say(`${which}を最初に抜けたのは ${r.name}！`, 2);
    }
    if (r.me) {
      const h = this.hero;
      h.hp = Math.min(h.maxHp, h.hp + h.maxHp * 0.3);
      h.inv = Math.max(h.inv, 1.2);
      h.boost = Math.max(h.boost, 1.2);
      sfx('gate');
      sample('heal', 0.5);
      hud.banner(gate.tier === 2 ? 'ゴールラインへ！' : '関門突破！', gate.tier === 2 ? '順位が決まるのはゴールライン。最後まで走り抜け！' : `${gate.passed}番目に通過`, 'good');
      hud.objective(gate.tier === 2 ? 'ゴールラインを越えるまで順位は決まらない！' : '30位以内でゴールせよ！');
      if (gate.tier === 2) hud.say(`${this.heroArt.name}が最後の番人を突破！ ゴールラインまでの直線勝負です！`, 3);
      earn(['gate1', 'gate2', 'gate3'][gate.tier]);
      this.grant(1);
    }
  }

  protected onHit(e: Enemy, dmg: number, by: Runner | null): void {
    if (!e.boss) return;
    e.hp = e.maxHp;
    const r = by ?? this.hero;
    const gate = this.gates[r.gate];
    if (!gate || gate.boss !== e) return;
    r.quota += dmg;
    if (r.quota >= gate.need) this.pass(r);
  }

  /** The hero runs forward on their own. The player steers up and down (and can ease off by holding back). */
  protected heroControl(dt: number): void {
    const h = this.hero;
    const my = input.move.y;
    const gate = this.gates[h.gate];
    // in front of a guardian the run stops: move freely to get at it (or away from it)
    const free = !!gate && h.x > gate.x - FREE_ZONE;
    if (free !== this.freeMove) {
      this.freeMove = free;
      if (free) this.host.hud.say('番人の前では自由に動ける！ 近づいて攻撃を当てろ！', 1, 'ain');
    }
    const ease = free ? input.move.x : input.move.x < -0.4 ? 0.5 : 1;
    h.moving = !free || Math.abs(input.move.x) + Math.abs(my) > 0.1;
    if (h.moving) h.bob += dt * 11;
    if (!free) h.flip = true;
    else if (Math.abs(input.move.x) > 0.2) h.flip = input.move.x > 0;
    let sp = h.speed * this.boosts.speed * (h.slow > 0 ? 0.6 + 0.4 * Math.min(1, this.st.grit) : 1) * (h.buffSpd > 0 ? 1.25 : 1) * (h.boost > 0 ? 1.4 : 1) * (h.dragon > 0 ? 2.1 : 1);
    if (this.st.draft > 0 && this.drafting()) sp *= 1 + this.st.draft;
    if (free) {
      const m = Math.hypot(input.move.x, my);
      if (m > 0.2) {
        h.fx = input.move.x / m;
        h.fy = my / m;
      }
    } else {
      h.fx = 1;
      h.fy = 0;
    }
    if (h.dashT > 0) {
      h.dashT -= dt;
      h.vx = h.fx * sp * 2.5;
      if (free) h.vy = h.fy * sp * 2.5;
      if (Math.random() < 0.7) this.puff(h.x - 14, h.y + 10, '#ffffff', 1);
    } else {
      h.vx += (sp * ease - h.vx) * Math.min(1, dt * 10);
    }
    h.vy += (my * sp * 1.15 - h.vy) * Math.min(1, dt * 14);
    this.moveBody(h, h.vx * dt, h.vy * dt);
  }

  protected tick(dt: number): void {
    const h = this.hero;
    const hud = this.host.hud;
    const L = this.len;
    if (input.aPressed && h.ko <= 0 && h.frozen <= 0) this.dash();
    if (input.bPressed) this.strike();
    this.follow(1 - Math.pow(0.001, dt));
    const prog = clamp(h.x / L, 0, 1);

    // a dash through the crowd of monsters knocks them aside (skill tree)
    if (h.dashT > 0 && this.st.dashHit > 0) {
      for (const e of this.enemies) {
        if (e.dead || e.asleep || e.boss || e.orbitCd > 0) continue;
        if (dist2(e.x, e.y, h.x, h.y) < (e.r + 26) ** 2) {
          e.orbitCd = 0.3;
          this.hitEnemy(e, 14 * this.st.dashHit, h.fx * 300, h.fy * 300);
        }
      }
    }

    // dash panels and item boxes
    for (const p of this.pads) {
      if (h.ko <= 0 && Math.abs(p.x - h.x) < 46 && Math.abs(p.y - h.y) < 34 && h.boost < 0.5) {
        h.boost = 1.5 * this.st.padPower;
        sfx('boost');
      }
    }
    const back = (this.place - 1) / (FIELD - 1);
    for (const c of this.chests) {
      c.t += dt;
      if (c.taken) {
        c.back += dt;
        if (c.back >= CHEST_BACK) {
          c.taken = false;
          c.back = 0;
        }
      }
      if (c.taken || h.ko > 0 || Math.abs(c.x - h.x) > 40 || Math.abs(c.y - h.y) > 44) continue;
      if (this.run.items.length >= this.st.itemSlots) continue;
      c.taken = true;
      const it = rollItem(back, this.st);
      this.run.items.push(it);
      this.host.items(this.run);
      sample('chest', 0.7);
      this.floats.push({ x: h.x, y: h.y - 50, text: `${it.name} GET!`, color: '#ffe45c', t: 0, big: true });
      hud.say(`${this.heroArt.name}、宝箱から「${it.name}」を手に入れた！`, 1, 'ain');
    }
    const press = takeItemPress();
    if (press >= 0 && press < this.run.items.length && h.ko <= 0 && h.frozen <= 0) {
      const it = this.run.items.splice(press, 1)[0];
      this.host.items(this.run);
      this.useItem(h, it);
    }
    this.stepItems(dt);

    // the crowd of monsters: mostly ahead of the player, sometimes from behind
    this.spawnT -= dt;
    const gate = this.gates[h.gate];
    const fighting = !!gate && h.x > gate.x - 500;
    if (this.spawnT <= 0 && this.enemies.length < 110) {
      this.spawnT = (fighting ? 1.6 : 1.0) - prog * 0.4;
      const n = Math.round(((fighting ? 2 : 3) + prog * 3.4) * this.st.enemyCount);
      const behind = this.rng() < 0.22;
      const baseX = behind ? this.camX - 70 : this.camX + this.vw + 70;
      const limit = gate ? gate.x - 80 : L;
      const cy = clamp(h.y + (this.rng() - 0.5) * 520, TOP + 40, BOTTOM - 40);
      for (let i = 0; i < n; i++) {
        const x = Math.min(baseX + (this.rng() - 0.5) * 120, limit + (behind ? 0 : this.rng() * 30));
        if (!behind && x < this.camX + this.vw - 40 && !fighting) continue;
        this.mob(x, clamp(cy + (this.rng() - 0.5) * 220, TOP + 30, BOTTOM - 30), prog);
      }
    }

    // the rivals: who has finished, and where the player stands
    for (const r of this.rivals) {
      if (r.done) {
        // over the line: they run on down the road
        r.x += r.pace * 0.8 * dt;
        r.bob += dt * 11;
        r.moving = true;
        r.flip = true;
        continue;
      }
      if (r.x >= L) {
        r.done = true;
        this.passed += 1;
        r.place = this.passed;
        this.finishTimes.push(Math.round(this.time * 10) / 10);
        if (this.passed === 1) hud.say(`ゴーーール！ 1位で駆け抜けたのは ${r.name}！`, 3);
        else if (this.passed <= 3) hud.say(`${this.passed}位は ${r.name}！`, 2);
        const left = QUOTA - this.passed;
        if (left === 10 || left === 5 || left === 3 || left === 1) hud.say(`通過の枠は、残り${left}つ！`, 3, 'ain');
      }
    }
    this.rankT -= dt;
    if (this.rankT <= 0) {
      this.rankT = 0.25;
      let ahead = 0;
      let leader: Runner | null = null;
      for (const r of this.rivals) {
        if (r.done || r.x > h.x) ahead++;
        if (!r.done && (!leader || r.x > leader.x)) leader = r;
      }
      const was = this.place;
      this.place = ahead + 1;
      if (this.time > 3) {
        if (was > QUOTA && this.place <= QUOTA) hud.say(`${this.heroArt.name}、通過圏内の${this.place}位に浮上！`, 2);
        else if (was <= QUOTA && this.place > QUOTA) hud.say(`${this.heroArt.name}、通過圏外に後退…！`, 2, 'ain');
        if (this.place === 1 && was > 1) hud.say(`${this.heroArt.name}がトップに立った！`, 3);
      }
      if (leader && leader.x > h.x && leader.name !== this.lead && !this.passed) {
        if (this.lead && this.time > 5) hud.say(`先頭が入れ替わった！ 現在のトップは ${leader.name}！`, 1);
        this.lead = leader.name;
      }
      hud.rank(this.place, FIELD, this.passed, QUOTA);
      const dots: number[] = [];
      for (const r of this.rivals) dots.push(r.done ? 1 : r.x / L);
      hud.dots(dots, prog);
    }
    this.chatT -= dt;
    if (this.chatT <= 0) {
      this.chatT = 7 + Math.random() * 4;
      const lines = [
        `${this.heroArt.name}は現在${this.place}位。${this.place <= QUOTA ? 'この位置を守りたい！' : 'まだ巻き返せます！'}`,
        'エクステンションの取り合いが激しくなってきました',
        'エネミーを引きつけたまま集団に飛びこむのも、立派な作戦ですよ',
        `チームLvは${this.run.level}。じわじわ火力が上がっています`,
      ];
      hud.say(lines[Math.floor(Math.random() * lines.length)], 1, Math.random() < 0.5 ? 'ain' : 'chris');
    }

    // the end of the race, one way or the other
    if (h.x >= L) {
      const place = this.passed + 1;
      this.passed += 1;
      this.place = place;
      this.outro = true;
      for (const e of this.enemies) {
        if (!e.dead && !e.boss) this.puff(e.x, e.y, '#ffffff', 3);
        e.dead = true;
      }
      this.ebullets.length = 0;
      h.ko = h.frozen = 0;
      hud.rank(place, FIELD, this.passed, QUOTA);
      hud.boss(null);
      hud.objective('');
      hud.say(`ゴーーール！ ${this.heroArt.name}、${place}位でフィニッシュ！`, 3);
      this.result = { place, field: FIELD, quota: QUOTA, qualified: place <= QUOTA, progress: 1, gates: 3 };
      earn('goal');
      if (place <= QUOTA) earn('land30');
      if (place <= 10) earn('land10');
      if (place === 1) earn('land1');
      if (this.run.downs === 0) earn('noko');
      sample('clear', 0.7);
    } else if (this.passed >= QUOTA) {
      this.finished = true;
      this.result = { place: this.place, field: FIELD, quota: QUOTA, qualified: false, progress: prog, gates: h.gate };
      sample('lose', 0.6);
    }
    if (this.run.kills >= 100) earn('kill100');
    if (this.run.kills >= 300) earn('kill300');
    if (this.run.level >= 8) earn('lv8');

    hud.gauge(clamp(h.hp / h.maxHp, 0, 1), h.ko > 0 ? `気絶 ${h.ko.toFixed(1)}` : h.frozen > 0 ? `反則 ${h.frozen.toFixed(1)}` : `${Math.max(0, Math.ceil(h.hp))}`);
    hud.sub(1 - h.dashCd / (1.4 * this.st.dashCd));
    hud.progress(prog, this.gates.map((g) => g.x / L));
    hud.level(this.run.level, this.run.xp / xpNeed(this.run.level));
    hud.gum(this.run.gum);
    const near = gate && h.x > gate.x - 620 ? gate : null;
    hud.boss(near ? `${near.art.name}に あと ${Math.max(0, Math.ceil(near.need - h.quota))} ダメージで通過` : null, near ? 1 - h.quota / near.need : 0);
    if (near && !this.told.has(`g${near.tier}`)) {
      this.told.add(`g${near.tier}`);
      sfx('warn');
      hud.banner('関門', `${near.art.name}に ${near.need} ダメージを与えて通過せよ`, 'warn');
      hud.objective('番人を攻撃して通行証を勝ち取れ！（ストライクも有効）');
    }
  }

  /** Past the line: the hero jogs on down the road, and the teams behind keep coming in. */
  protected afterglow(dt: number): void {
    const h = this.hero;
    const L = this.len;
    h.x += h.speed * 0.9 * dt;
    h.y += (H / 2 - h.y) * Math.min(1, dt * 0.8);
    h.vx = h.vy = 0;
    h.moving = true;
    h.flip = true;
    h.bob += dt * 11;
    h.inv = 0;
    if (Math.random() < dt * 14) this.puff(h.x - 40 + Math.random() * 80, h.y - 60 - Math.random() * 60, ['#ffe45c', '#ff7a9c', '#7dffb0', '#37c8f2'][Math.floor(Math.random() * 4)], 2, 160);
    for (const r of this.rivals) {
      if (r.done) {
        r.x += r.pace * 0.8 * dt;
        r.bob += dt * 11;
        continue;
      }
      if (r.ko > 0) {
        r.ko = Math.max(0, r.ko - dt);
        continue;
      }
      this.rivalAI(r, dt);
      if (r.x >= L) {
        r.done = true;
        r.flip = true;
        this.passed += 1;
        r.place = this.passed;
        this.host.hud.rank(this.place, FIELD, Math.min(this.passed, QUOTA), QUOTA);
      }
    }
    this.follow(1 - Math.pow(0.001, dt));
  }

  /** Is this runner shielded by a mirror? (Says so when it matters.) */
  private reflects(o: Runner, what: string): boolean {
    if (o.mirror <= 0) return false;
    if (o.me || o.near) this.host.hud.say(`${o.name}の鏡が${what}をはね返した！`, 2, 'ain');
    return true;
  }
  /** Knocks a runner off their stride for a moment (an item's doing: never a foul). */
  private trip(o: Runner, stun: number, slow: number): void {
    if (o.inv > 0 && o.dragon > 0) return;
    o.ko = Math.max(o.ko, stun);
    o.slow = Math.max(o.slow, slow);
    o.vx = o.vy = 0;
    this.puff(o.x, o.y, '#ffe45c', 8);
    if (o.me) {
      this.shake = Math.max(this.shake, 8);
      sfx('hurt');
      this.host.hud.hurt();
    }
  }

  private useItem(r: Runner, it: Item): void {
    const hud = this.host.hud;
    const pw = r.me ? this.st.itemPower : 1;
    const loud = r.me ? 2 : 1;
    if (r.me) {
      sample('buff', 0.6);
      this.rings.push({ x: r.x, y: r.y, r: 10, max: 120, t: 0, color: '#ffe45c' });
    }
    switch (it.id) {
      case 'pegasus':
        r.boost = Math.max(r.boost, 3.4 * pw);
        r.inv = Math.max(r.inv, 2.6 * pw);
        if (r.me || r.near) hud.say(`${r.name}、ペガサスで一気に加速！`, loud);
        break;
      case 'panjan':
        this.rollers.push({ x: r.x + 40, y: r.y, life: 2.4 * pw, owner: r, rot: 0 });
        if (r.me || r.near) hud.say(`${r.name}がパンジャンドラムを転がした！ 前のヒーローは要注意！`, loud);
        break;
      case 'goblet':
        r.hp = Math.min(r.maxHp, r.hp + r.maxHp * 0.6 * pw);
        if (r.me) sample('heal', 0.6);
        break;
      case 'trap':
        this.traps.push({ x: r.x - 46, y: r.y, owner: r, t: 0 });
        if (r.me) hud.say(`${r.name}、うしろにネズミ捕りを仕掛けた！`, loud, 'ain');
        break;
      case 'decoy':
        r.decoy = 6 * pw;
        if (r.me || r.near) hud.say(`${r.name}、こけしを身代わりに！ エネミーがまわりのヒーローへ向かう！`, loud, 'ain');
        break;
      case 'mirror':
        r.mirror = 8 * pw;
        if (r.me || r.near) hud.say(`${r.name}、鏡をかまえた。妨害ははね返されます`, loud, 'ain');
        break;
      case 'bolt': {
        let n = 0;
        for (const o of [this.hero, ...this.rivals]) {
          if (o === r || o.done || o.ko > 0 || o.x < r.x || o.x > r.x + 1600) continue;
          if (this.reflects(o, '雷')) continue;
          this.trip(o, 0.5, 2.4 * pw);
          n++;
        }
        sfx('boom');
        this.shake = Math.max(this.shake, 8);
        hud.say(`${r.name}の御札から雷！ 前を行く${n}組の足が止まった！`, 2);
        break;
      }
      case 'dragon':
        r.dragon = 3.6 * pw;
        r.inv = Math.max(r.inv, r.dragon);
        hud.say(`${r.name}がライドラゴンに乗った！ 猛スピードで追い上げる！`, 2);
        break;
    }
  }

  /** Things left on the course by helper items. */
  private stepItems(dt: number): void {
    const all = [this.hero, ...this.rivals];
    for (const ro of this.rollers) {
      ro.life -= dt;
      ro.x += 640 * dt;
      ro.rot += dt * 14;
      for (const e of this.enemies) {
        if (!e.dead && !e.asleep && !e.boss && dist2(e.x, e.y, ro.x, ro.y) < (e.r + 26) ** 2) this.hitEnemy(e, 60, 200, 0, ro.owner.me ? null : ro.owner);
      }
      for (const o of all) {
        if (o === ro.owner || o.done || o.ko > 0 || !o.near || dist2(o.x, o.y, ro.x, ro.y) > 34 * 34) continue;
        ro.life = 0;
        if (this.reflects(o, 'パンジャンドラム')) break;
        this.trip(o, 1.3, 1.5);
        if (o.me || ro.owner.me) this.host.hud.say(`パンジャンドラムが${o.name}を直撃！`, 2);
        break;
      }
      const gate = this.gates.find((g) => g.x > ro.x - 700);
      if (gate && ro.x > gate.x - 30 && ro.owner.gate <= gate.tier) ro.life = 0;
    }
    this.rollers = this.rollers.filter((r) => r.life > 0);
    for (const t of this.traps) {
      t.t += dt;
      for (const o of all) {
        if (o === t.owner || o.done || o.ko > 0 || !o.near || dist2(o.x, o.y, t.x, t.y) > 30 * 30) continue;
        t.t = 99;
        if (this.reflects(o, 'ネズミ捕り')) break;
        this.trip(o, 0.7, 2.6);
        if (o.me || t.owner.me) this.host.hud.say(`${o.name}がネズミ捕りにかかった！`, 2);
        break;
      }
    }
    this.traps = this.traps.filter((t) => t.t < 40);
  }

  // ------------------------------------------------------------------ rivals
  protected rivalAI(r: Runner, dt: number): void {
    const L = this.len;
    const gate = this.gates[r.gate];
    const view = this.vw;
    r.near = r.x > this.camX - 500 && r.x < this.camX + view + 500;
    r.strikeT = Math.max(0, r.strikeT - dt);
    r.think -= dt;
    const atGate = !!gate && r.x > gate.x - 190;
    const sp = r.pace * (r.slow > 0 ? 0.6 : 1) * (r.buffSpd > 0 ? 1.25 : 1) * (r.boost > 0 ? 1.4 : 1) * (r.dragon > 0 ? 2.1 : 1);

    if (!r.near) {
      // far from the camera: no monsters are simulated there, so trouble is rolled instead
      if (r.think <= 0) {
        r.think = 2;
        r.atk = 0.85 + Math.random() * 0.15;
        if (Math.random() < 0.03 * (1.25 - (r.pace - PACE_MIN) / PACE_SPAN)) this.hurtRunner(r, 999);
        r.dps += 0.5;
      }
      if (atGate) {
        r.quota += r.dps * 0.85 * dt;
        if (gate && r.quota >= gate.need) this.pass(r);
      } else {
        r.x = Math.min(r.x + sp * Math.min(1, Math.max(0.85, r.atk)) * dt, gate ? gate.x - 26 : L + 60);
      }
      r.moving = true;
      r.bob += dt * 11;
      return;
    }

    let vx = sp;
    let vy = (r.laneY - r.y) * 1.2;
    if (r.think <= 0) {
      r.think = 0.4 + Math.random() * 0.3;
      r.dps += 0.12;
      if (Math.random() < 0.12) r.laneY = clamp(r.laneY + (Math.random() - 0.5) * 320, TOP + 50, BOTTOM - 50);
      // rough players take a swing at whoever is beside them, and the referee is watching them too
      const seen = this.watching(r.x, r.y);
      if (r.mood > 0.6 && r.strikeT <= 0 && Math.random() < (seen ? 0.04 : 0.3)) {
        for (const o of [this.hero, ...this.rivals]) {
          if (o === r || o.done || o.ko > 0 || dist2(o.x, o.y, r.x, r.y) > 46 * 46) continue;
          r.strikeT = 2.5;
          this.arcs.push({ x: r.x, y: r.y, ang: Math.atan2(o.y - r.y, o.x - r.x), r: 60, t: 0, color: '#ff8fa3' });
          this.hurtRunner(o, 13, r.x, r.y, r);
          if (seen) {
            seen.alert = 1;
            if (o.me) this.host.hud.say(`${r.name}が${o.name}に直接攻撃！ 審判が見ています、反則ポイント！`, 2);
            this.foul(r, 1);
          } else if (o.me) this.host.hud.say(`${r.name}が審判の死角で${o.name}を攻撃！`, 2);
          break;
        }
      }
    }
    // chest panels within reach
    let want: { x: number; y: number } | null = null;
    let wd = 260 * 260;
    for (const c of this.chests) {
      if (c.taken || c.x < r.x - 20) continue;
      const d = dist2(c.x, c.y, r.x, r.y);
      if (d < 36 * 36) {
        if (!r.item) {
          c.taken = true;
          let ahead = 0;
          for (const o of this.rivals) if (o.done || o.x > r.x) ahead++;
          r.item = rollItem(ahead / (FIELD - 1), this.st);
          r.itemT = 0.6 + Math.random() * 2.2;
        }
      } else if (d < wd && !r.item && r.mood > 0.3) {
        wd = d;
        want = c;
      }
    }
    if (r.item) {
      r.itemT -= dt;
      if (r.itemT <= 0) {
        const it = r.item;
        r.item = null;
        this.useItem(r, it);
      }
    }
    for (const p of this.pads) {
      if (Math.abs(p.x - r.x) < 46 && Math.abs(p.y - r.y) < 34 && r.boost < 0.5) r.boost = 1.5;
    }
    if (want) {
      const d = Math.sqrt(wd) || 1;
      vx = ((want.x - r.x) / d) * sp;
      vy = ((want.y - r.y) / d) * sp;
    }
    if (atGate && gate && gate.boss) {
      // circle the guardian and keep hitting it (their share of blows adds up steadily, seen or unseen)
      const b = gate.boss;
      r.quota += r.dps * 0.85 * dt;
      if (r.quota >= gate.need) {
        this.pass(r);
        return;
      }
      const dx = r.x - b.x;
      const dy = r.y - b.y;
      const d = Math.hypot(dx, dy) || 1;
      const k = d < 90 ? 1 : d > 130 ? -1 : 0;
      const dir = r.mood > 0.5 ? 1 : -1;
      vx = ((dx / d) * k - (dy / d) * dir * 0.7) * sp * 0.8;
      vy = ((dy / d) * k + (dx / d) * dir * 0.7) * sp * 0.8;
    }
    // step around monsters
    let hit: Enemy | null = null;
    for (const e of this.enemies) {
      if (e.dead || e.asleep) continue;
      const d2 = dist2(e.x, e.y, r.x, r.y);
      if (d2 < (105 + e.r) ** 2 && (!hit || e.boss)) hit = e;
      if (!e.boss && d2 < 64 * 64) {
        const d = Math.sqrt(d2) || 1;
        vy += ((r.y - e.y) / d) * 120;
      }
    }
    r.atk -= dt;
    if (hit && r.atk <= 0) {
      r.atk = 0.5;
      const dmg = r.dps * 0.5 * (r.buffDmg > 0 ? 1 + r.buffAmt : 1);
      if (!hit.boss) this.hitEnemy(hit, dmg, (hit.x - r.x) * 0.6, (hit.y - r.y) * 0.6, r);
      else hit.flash = 0.06;
      if (this.arcs.length < 24) this.arcs.push({ x: r.x, y: r.y, ang: Math.atan2(hit.y - r.y, hit.x - r.x), r: 64, t: 0, color: '#c9d2ff' });
      this.passive(r, 'skill');
    }
    r.vx += (vx - r.vx) * Math.min(1, dt * 8);
    r.vy += (vy - r.vy) * Math.min(1, dt * 8);
    this.moveBody(r, r.vx * dt, r.vy * dt);
    r.moving = Math.abs(r.vx) + Math.abs(r.vy) > 20;
    if (Math.abs(r.vx) > 20) r.flip = r.vx > 0;
    r.bob += dt * 11;
  }

  protected onKo(r: Runner): void {
    if (!r.me) {
      this.kos += 1;
      if (this.kos === 10) this.host.hud.say('すでに10組が気絶を経験。荒れたレースになっています', 1, 'ain');
    }
  }

  private mob(x: number, y: number, prog: number): void {
    const en = cat.enemies;
    const tier = clamp(Math.floor(prog * 6), 0, 5);
    const hpMul = 1 + prog * 4.6;
    const seg = prog < 1 / 3 ? 0 : prog < 2 / 3 ? 1 : 2;
    const r = this.rng();
    const art = (list: EnemyArt[]) => {
      const a = list[Math.min(tier, list.length - 1)];
      return { url: a.img, name: a.name };
    };
    if (seg === 2 && r < 0.05) {
      const g = en.ghost[2 + Math.floor(this.rng() * (en.ghost.length - 2))];
      this.spawn({ url: g.img, name: g.name }, x, y, {
        hp: 120 * hpMul, size: 88, r: 26, speed: 82, dmg: 13, ai: 'burst', elite: true, xp: 12, tier, timer: 2,
      });
    } else if (seg >= 1 && r < 0.2) {
      this.spawn(art(en.melissa), x, y, { hp: 17 * hpMul, speed: 84, dmg: 9, ai: 'shoot', xp: 2, tier, timer: 1 + this.rng() * 2 });
    } else if (seg >= 1 && r < 0.42) {
      this.spawn(art(en.bandit), x, y, { hp: 36 * hpMul, speed: 84, dmg: 13, r: 21, size: 72, ai: 'chase', xp: 3, tier });
    } else if (r < 0.7) {
      this.spawn(art(en.rabbit), x, y, { hp: 13 * hpMul, speed: 116, dmg: 10, ai: 'dash', xp: 1, tier });
    } else {
      this.spawn(art(en.chameleon), x, y, { hp: 11 * hpMul, speed: 132, dmg: 9, ai: 'zigzag', xp: 1, tier });
    }
  }

  protected bossAI(e: Enemy, dt: number): void {
    const tg = e.tg ?? this.hero;
    const dx = tg.x - e.x;
    const dy = tg.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    e.timer -= dt;
    if (e.state === 0) {
      this.moveBody(e, (dx / d) * e.speed * dt, (dy / d) * e.speed * dt);
      if (e.timer <= 0) {
        e.state = 1;
        e.timer = 0.55;
      }
    } else if (e.state === 1) {
      e.flash = 0.05;
      if (e.timer <= 0) {
        e.ay += 1;
        const n = 12 + e.tier * 4;
        const off = this.rng() * TAU;
        for (let i = 0; i < n; i++) this.fire(e.x, e.y, off + (i / n) * TAU, 175 + e.tier * 15, e.dmg * 0.8);
        if (e.tier >= 1) for (let i = -1; i <= 1; i++) this.fire(e.x, e.y, Math.atan2(dy, dx) + i * 0.22, 260, e.dmg, '#ffb35c', 9);
        sfx('magic');
        if (e.tier === 2 && e.ay % 2 === 0) {
          e.state = 2;
          e.timer = 0.75;
          e.vx = dx / d;
          e.vy = dy / d;
          sfx('beast');
        } else {
          e.state = 0;
          e.timer = 2.3 - e.tier * 0.25;
        }
      }
    } else {
      this.moveBody(e, e.vx * e.speed * 5.5 * dt, e.vy * e.speed * 5.5 * dt);
      if (Math.random() < 0.5) this.puff(e.x, e.y + e.size * 0.3, '#d9c7a0', 1);
      if (e.timer <= 0) {
        e.state = 0;
        e.timer = 1.7;
      }
    }
    const gate = this.gates[e.tier];
    e.x = clamp(e.x, gate.x - 620, gate.x - 70);
  }

  protected killed(e: Enemy): void {
    // elites are worth a free card
    if (e.elite && this.rng() < 0.35) this.grant(1);
  }

  // ------------------------------------------------------------------ drawing
  private groundAt(x: number, table: [number, number, number][]): string {
    const t = x / (this.len / 3);
    const i = clamp(Math.floor(t), 0, 2);
    const f = t - i;
    const k = i < 2 ? clamp((f - 0.9) / 0.1, 0, 1) : 0;
    return mixColor(table[i], table[Math.min(2, i + 1)], k);
  }

  protected drawBack(g: CanvasRenderingContext2D): void {
    const L = this.len;
    const x0 = Math.floor(this.camX / 200) * 200;
    const x1 = this.camX + this.vw + 200;
    for (let x = x0; x < x1; x += 200) {
      g.fillStyle = this.groundAt(x, GROUND);
      g.fillRect(x, 0, 201, H);
      g.fillStyle = this.groundAt(x, ROAD);
      g.fillRect(x, H / 2 - 105, 201, 210);
    }
    if (this.pattern) {
      g.fillStyle = this.pattern;
      g.fillRect(this.camX - 20, 0, this.vw + 40, H);
    }
    g.fillStyle = 'rgba(0,0,0,0.14)';
    g.fillRect(this.camX - 20, H / 2 - 109, this.vw + 40, 4);
    g.fillRect(this.camX - 20, H / 2 + 105, this.vw + 40, 4);
    g.fillStyle = 'rgba(255,255,255,0.4)';
    for (let x = Math.floor(this.camX / 120) * 120; x < x1; x += 120) g.fillRect(x, H / 2 - 3, 60, 6);

    g.font = '20px DotGothic16, sans-serif';
    g.textAlign = 'center';
    for (let x = Math.ceil(this.camX / 1000) * 1000; x < x1; x += 1000) {
      if (x <= 0 || x >= L) continue;
      g.fillStyle = 'rgba(20,20,30,0.75)';
      g.fillRect(x - 44, H / 2 - 160, 88, 32);
      g.fillStyle = '#ffe9a8';
      g.fillText(`${Math.round((L - x) / 3.5)}m`, x, H / 2 - 137);
    }

    // the stands: a crowd along both edges of the course
    g.fillStyle = '#1f3d2b';
    g.fillRect(this.camX - 20, 0, this.vw + 40, TOP - 14);
    g.fillRect(this.camX - 20, BOTTOM + 14, this.vw + 40, H - BOTTOM);
    const cols = ['#ffb13d', '#37c8f2', '#b693ff', '#ff7a9c', '#7dffb0', '#fff3c0'];
    for (let x = Math.floor(this.camX / 22) * 22; x < x1; x += 22) {
      const i = Math.round(x / 22);
      const hop = Math.abs(Math.sin(this.time * 6 + i * 1.7)) * 5;
      g.fillStyle = cols[((i % 6) + 6) % 6];
      g.fillRect(x + 4, TOP - 34 - hop, 12, 14);
      g.fillRect(x + 4, BOTTOM + 22 - hop * 0.8, 12, 14);
      g.fillStyle = '#f6d7b0';
      g.fillRect(x + 6, TOP - 42 - hop, 8, 8);
      g.fillRect(x + 6, BOTTOM + 14 - hop * 0.8, 8, 8);
    }
    g.fillStyle = '#e9eef5';
    g.fillRect(this.camX - 20, TOP - 18, this.vw + 40, 4);
    g.fillRect(this.camX - 20, BOTTOM + 14, this.vw + 40, 4);

    for (const d of this.decor) {
      if (d.x < this.camX - 60) continue;
      if (d.x > x1) break;
      const s = d.s;
      if (d.kind === 0) {
        g.fillStyle = 'rgba(0,0,0,0.18)';
        g.fillRect(d.x - 12 * s, d.y + 6 * s, 24 * s, 6 * s);
        g.fillStyle = '#8d8f98';
        g.fillRect(d.x - 12 * s, d.y - 8 * s, 24 * s, 16 * s);
        g.fillStyle = '#b4b7c2';
        g.fillRect(d.x - 12 * s, d.y - 8 * s, 16 * s, 6 * s);
      } else if (d.kind === 1) {
        g.fillStyle = 'rgba(0,0,0,0.18)';
        g.fillRect(d.x - 14 * s, d.y + 8 * s, 28 * s, 6 * s);
        g.fillStyle = '#2c6b45';
        g.fillRect(d.x - 14 * s, d.y - 10 * s, 28 * s, 20 * s);
        g.fillStyle = '#3f8a59';
        g.fillRect(d.x - 10 * s, d.y - 14 * s, 18 * s, 10 * s);
      } else if (d.kind === 2) {
        g.fillStyle = '#ffe27a';
        g.fillRect(d.x, d.y, 4, 4);
        g.fillStyle = '#ffffff';
        g.fillRect(d.x + 10, d.y + 6, 4, 4);
        g.fillRect(d.x - 8, d.y + 8, 4, 4);
      } else {
        g.fillStyle = 'rgba(0,0,0,0.1)';
        g.fillRect(d.x - 18 * s, d.y, 36 * s, 4);
        g.fillRect(d.x - 8 * s, d.y + 8, 22 * s, 4);
      }
    }

    // dash panels and item boxes
    for (const p of this.pads) {
      if (p.x < this.camX - 80 || p.x > x1) continue;
      g.fillStyle = 'rgba(55,200,242,0.35)';
      g.fillRect(p.x - 46, p.y - 30, 92, 60);
      g.fillStyle = '#9be9ff';
      for (let i = 0; i < 3; i++) {
        const ox = p.x - 34 + i * 26 + ((this.time * 60) % 26);
        g.beginPath();
        g.moveTo(ox, p.y - 18);
        g.lineTo(ox + 14, p.y);
        g.lineTo(ox, p.y + 18);
        g.lineTo(ox - 6, p.y + 18);
        g.lineTo(ox + 8, p.y);
        g.lineTo(ox - 6, p.y - 18);
        g.fill();
      }
    }
    let rowX = -1;
    for (const c of this.chests) {
      if (c.x < this.camX - 60 || c.x > x1) continue;
      if (c.x !== rowX) {
        rowX = c.x;
        g.fillStyle = 'rgba(255,228,92,0.16)';
        g.fillRect(c.x - 52, TOP, 104, BOTTOM - TOP);
        g.fillStyle = 'rgba(255,228,92,0.55)';
        g.fillRect(c.x - 52, TOP, 4, BOTTOM - TOP);
        g.fillRect(c.x + 48, TOP, 4, BOTTOM - TOP);
      }
      if (c.taken) continue;
      const glow = 0.5 + Math.sin(c.t * 5) * 0.5;
      g.fillStyle = `rgba(255,228,92,${0.18 + glow * 0.14})`;
      g.fillRect(c.x - 40, c.y - 44, 80, 88);
      g.strokeStyle = '#ffe45c';
      g.lineWidth = 3;
      g.strokeRect(c.x - 40, c.y - 44, 80, 88);
      const by = c.y - 4 + Math.sin(c.t * 4) * 3;
      g.fillStyle = '#8a5a2b';
      g.fillRect(c.x - 20, by - 10, 40, 26);
      g.fillStyle = '#b9792f';
      g.fillRect(c.x - 20, by - 16, 40, 12);
      g.fillStyle = '#ffd84d';
      g.fillRect(c.x - 20, by - 6, 40, 4);
      g.fillRect(c.x - 4, by - 9, 8, 10);
    }
    for (const t of this.traps) {
      if (t.x < this.camX - 60 || t.x > x1) continue;
      this.sprite(g, cat.extArt['1179'].img, t.x, t.y + 8, 40, false);
    }
    for (const ro of this.rollers) {
      const im = cat.extArt['1153'].img;
      g.save();
      g.translate(ro.x, ro.y);
      g.rotate(ro.rot);
      this.sprite(g, im, 0, 0, 56, false);
      g.restore();
      this.puff(ro.x - 20, ro.y + 16, '#d9c7a0', 1);
    }

    this.checker(g, 110);
    this.checker(g, L);
    g.fillStyle = '#ffe45c';
    g.font = '28px "Dela Gothic One", DotGothic16, sans-serif';
    g.textAlign = 'left';
    g.fillText('GOAL', L + 12, TOP + 40);

    // gates: closed for the player until their own share of blows has landed
    const mine = this.hero.gate;
    this.gates.forEach((gt, i) => {
      if (gt.x < this.camX - 100 || gt.x > x1) return;
      const open = i < mine;
      for (const y of [TOP - 6, BOTTOM + 6]) {
        g.fillStyle = '#3a3550';
        g.fillRect(gt.x - 16, y - 36, 32, 72);
        g.fillStyle = open ? '#6dffa0' : '#ff5c7a';
        g.fillRect(gt.x - 8, y - 10, 16, 16);
      }
      if (!open) {
        g.globalAlpha = 0.22;
        g.fillStyle = '#ff5c7a';
        g.fillRect(gt.x - 10, TOP, 20, BOTTOM - TOP);
        g.globalAlpha = 0.9;
        for (let y = TOP + ((this.time * 160) % 40); y < BOTTOM; y += 40) g.fillRect(gt.x - 3, y, 6, 22);
        g.globalAlpha = 1;
      }
    });
  }

  private checker(g: CanvasRenderingContext2D, x: number): void {
    for (let y = TOP; y < BOTTOM; y += 16) {
      for (let i = 0; i < 2; i++) {
        g.fillStyle = (Math.floor(y / 16) + i) % 2 ? '#f4f4f4' : '#22222c';
        g.fillRect(x + i * 16 - 16, y, 16, 16);
      }
    }
  }

  protected drawOverlay(g: CanvasRenderingContext2D): void {
    const h = this.hero;
    // what the rivals nearby are holding (so a mirror can be timed)
    for (const r of this.rivals) {
      if (!r.item || r.done || !r.near) continue;
      const sx = r.x - this.camX;
      const sy = r.y - this.camY;
      if (sx < 0 || sx > this.vw || sy < 0 || sy > this.vh) continue;
      this.sprite(g, itemImg(r.item), sx + 22, sy - 30, 22, false);
    }
    if (this.st.draft > 0 && h.ko <= 0 && this.drafting()) {
      g.strokeStyle = 'rgba(155,233,255,0.7)';
      g.lineWidth = 2;
      const hx = h.x - this.camX;
      const hy = h.y - this.camY;
      for (let i = 0; i < 4; i++) {
        const o = ((this.time * 300 + i * 30) % 120) - 60;
        g.beginPath();
        g.moveTo(hx - 70 - o, hy - 18 + i * 12);
        g.lineTo(hx - 40 - o, hy - 18 + i * 12);
        g.stroke();
      }
    }
  }

  // ------------------------------------------------------------------ debug bot
  botStep(): { x: number; y: number; a: boolean; b: boolean } {
    const h = this.hero;
    let x = 1;
    let y = 0;
    let strike = false;
    const gate = this.gates[h.gate];
    const b = gate && gate.boss && h.x > gate.x - 420 ? gate.boss : null;
    if (b) {
      const dx = h.x - b.x;
      const dy = h.y - b.y;
      const d = Math.hypot(dx, dy) || 1;
      const k = d < 95 ? 1 : d > 130 ? -1 : 0;
      x = (dx / d) * k - (dy / d) * 0.6;
      y = (dy / d) * k + (dx / d) * 0.6;
      strike = d < 150 && !this.rivals.some((r) => !r.done && dist2(r.x, r.y, h.x, h.y) < 100 * 100);
    } else {
      let best = null as null | { x: number; y: number };
      let bd = 520 * 520;
      if (this.run.items.length < this.st.itemSlots) {
        for (const c of this.chests) {
          if (c.taken || c.x < h.x + 30) continue;
          const d = dist2(c.x, c.y, h.x, h.y);
          if (d < bd) {
            bd = d;
            best = c;
          }
        }
      }
      y = best ? (best.y - h.y) / 60 : (H / 2 - h.y) / 200;
      x = 0;
    }
    if (this.run.items.length && Math.random() < 0.02) pressItem(0);
    for (const e of this.enemies) {
      if (e.dead || e.boss) continue;
      const d2 = dist2(e.x, e.y, h.x, h.y);
      if (d2 < 80 * 80) {
        const d = Math.sqrt(d2) || 1;
        y += ((h.y - e.y) / d) * 1.2;
      }
    }
    return { x: b ? clamp(x, -1, 1) : 0, y: clamp(y, -1, 1), a: !b && h.dashCd <= 0 && Math.random() < 0.05, b: strike };
  }
}
