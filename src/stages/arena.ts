// Shared 2D action core for the land and sea races: the hero, enemies, the gear that fights on its own,
// pickups, particles and drawing. Each race adds its own course and rules on top.

import { greyOf, img, ready, whiteOf } from '../core/assets';
import { sample, sfx } from '../core/audio';
import { cat, traitsOf, type Hero, type Traits } from '../core/catalog';
import { earn, stats, type Stats } from '../game/meta';
import { input } from '../core/input';
import { clamp, dist2, TAU, type Rng, makeRng } from '../core/util';
import { addXp, boostsOf, DOWN_PENALTY, levelMul, type Boosts, type Run } from '../game/run';
import type { Item } from '../game/roster';
import { Arsenal } from './weapons';
import type { Host, Stage, StageResult } from './stage';

export interface Enemy {
  x: number; y: number; vx: number; vy: number; r: number;
  hp: number; maxHp: number; speed: number; dmg: number;
  url: string; size: number; name: string;
  ai: string; state: number; timer: number; t: number;
  flash: number; slow: number; orbitCd: number; kx: number; ky: number;
  xp: number; boss: boolean; elite: boolean; dead: boolean; face: number;
  /** Free for the race to use (home position, phase, ...). */
  ax: number; ay: number; tier: number; asleep: boolean;
  /** Who it is after, and when it next looks around. */
  tg: Runner | null; tgT: number; stun: number;
}
/** Anyone in the race: the player's hero and the rivals share this shape. */
export interface Runner {
  x: number; y: number; vx: number; vy: number; r: number; hp: number; maxHp: number;
  fx: number; fy: number; flip: boolean; inv: number; dashT: number; dashCd: number; speed: number; regen: number;
  moving: boolean; bob: number;
  art: Hero; me: boolean; name: string;
  /** Knocked out (seconds left), stopped by the referee (seconds left), foul points so far. */
  ko: number; frozen: number; fouls: number;
  slow: number; buffSpd: number; buffDmg: number; buffAmt: number; decoy: number; boost: number;
  done: boolean; place: number;
  pUsed: boolean; pCd: number; pTick: number;
  /** Rivals: how fast they like to run, how hard their gear hits, how rough they play. */
  pace: number; dps: number; mood: number; laneY: number; think: number; atk: number; quota: number;
  strikeT: number; near: boolean; gate: number;
  /** Helper items: reflecting, riding the dragon, and (rivals) the item in hand and when they will use it. */
  mirror: number; dragon: number; item: Item | null; itemT: number;
}
/** A referee standing on the course. Fouls only count inside the circle they can see. */
export interface Referee { x: number; y: number; r: number; homeY: number; t: number; alert: number; sway?: number }
export function makeRunner(art: Hero, me: boolean): Runner {
  return {
    x: 0, y: 0, vx: 0, vy: 0, r: 15, hp: 100, maxHp: 100, fx: 1, fy: 0, flip: true, inv: 0, dashT: 0, dashCd: 0,
    speed: 190, regen: 0, moving: false, bob: Math.random() * 6, art, me, name: art.name,
    ko: 0, frozen: 0, fouls: 0, slow: 0, buffSpd: 0, buffDmg: 0, buffAmt: 0, decoy: 0, boost: 0, done: false, place: 0,
    pUsed: false, pCd: 2, pTick: 6 + Math.random() * 6,
    pace: 180, dps: 20, mood: 0, laneY: 500, think: 0, atk: 0, quota: 0, strikeT: 0, near: true, gate: 0, mirror: 0, dragon: 0, item: null, itemT: 0,
  };
}
export interface EBullet { x: number; y: number; vx: number; vy: number; r: number; dmg: number; life: number; color: string }
interface Gem { x: number; y: number; v: number; t: number }
interface Part { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; g: number }
interface Float { x: number; y: number; text: string; color: string; t: number; big: boolean }
interface Arc { x: number; y: number; ang: number; r: number; t: number; color: string }
interface Ring { x: number; y: number; r: number; max: number; t: number; color: string }

export const VH = 540;

export abstract class Arena implements Stage {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  vw = 960;
  scale = 1;
  camX = 0;
  camY = 0;
  time = 0;
  finished = false;
  result?: StageResult;
  run: Run;
  heroArt: Hero;
  traits: Traits;
  rng: Rng;
  hero: Runner;
  rivals: Runner[] = [];
  refs: Referee[] = [];
  st: Stats;
  /** The place is settled; the hero runs on while the player looks at it. The clock has stopped. */
  outro = false;
  /** Draw the rivals who have already finished (they run on past the line). */
  showDone = false;
  /** Races with rivals: going down means a few seconds out cold, not a time penalty. */
  koMode = false;
  strikeCd = 0;
  private started = false;
  enemies: Enemy[] = [];
  arsenal = new Arsenal();
  boosts: Boosts;
  /** True while the player is choosing a level-up card: the whole race holds still. */
  picking = false;
  ebullets: EBullet[] = [];
  gems: Gem[] = [];
  parts: Part[] = [];
  floats: Float[] = [];
  arcs: Arc[] = [];
  rings: Ring[] = [];
  shake = 0;
  hitstop = 0;
  /** Draw a soft shadow under sprites (land) or not (sea). */
  shadows = true;
  bossRef: Enemy | null = null;
  private onResize = () => this.resize();

  constructor(protected host: Host, heroIndex: number, seedSalt: number) {
    this.run = host.run;
    this.heroArt = this.run.heroes[heroIndex];
    this.traits = traitsOf(this.heroArt);
    this.st = stats();
    this.boosts = boostsOf(this.run);
    this.hero = makeRunner(this.heroArt, true);
    this.rng = makeRng(host.seed + seedSalt);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'game-canvas';
    host.mount.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d', { alpha: false })!;
    this.resize();
    window.addEventListener('resize', this.onResize);
    const h = this.hero;
    h.maxHp = this.fullHp();
    h.hp = h.maxHp;
    h.speed = 160 * (0.86 + 0.14 * this.traits.agi) * this.st.speed;
    h.regen = this.boosts.regen + this.st.regen;
    img(this.heroArt.img);
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.scale = this.canvas.height / VH;
    this.vw = this.canvas.width / this.scale;
    // very tall windows (portrait phones): keep a sane field of view
    if (this.vw < 560) {
      this.scale = this.canvas.width / 560;
      this.vw = 560;
    }
  }
  get vh(): number {
    return this.canvas.height / this.scale;
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.canvas.remove();
  }

  /** Full life bar for this race (oxygen under the sea). */
  protected fullHp(): number {
    return Math.round((100 * this.traits.hp + this.boosts.hp) * this.st.hp);
  }

  // ------------------------------------------------------------------ hooks for the race
  /** One step of the race's own rules. Called before the shared update. */
  protected abstract tick(dt: number): void;
  protected abstract drawBack(g: CanvasRenderingContext2D): void;
  protected drawFront(_g: CanvasRenderingContext2D): void {}
  /** True when a point is inside rock / outside the course. */
  protected blocked(_x: number, _y: number): boolean {
    return false;
  }
  isBlocked(x: number, y: number): boolean {
    return this.blocked(x, y);
  }
  /** Moves a body, stopping at walls. */
  protected abstract moveBody(b: { x: number; y: number; r: number }, dx: number, dy: number): void;
  protected killed(_e: Enemy): void {}
  protected onDown(): void {}
  protected bossAI(_e: Enemy, _dt: number): void {}
  protected rivalAI(_r: Runner, _dt: number): void {}
  /** Called for every blow that lands on an enemy (`by` is a rival, or null for the player). */
  protected onHit(_e: Enemy, _dmg: number, _by: Runner | null): void {}
  protected onKo(_r: Runner): void {}
  /** One step of the run past the finish line. */
  protected afterglow(_dt: number): void {}
  protected onFoul(_r: Runner): void {}
  protected heroControl(dt: number): void {
    this.walk(dt, 1);
  }

  // ------------------------------------------------------------------ update
  update(dt: number): void {
    if (this.finished || this.picking) return;
    if (this.outro) {
      this.afterglow(dt);
      this.stepFx(dt);
      return;
    }
    if (this.run.pending > 0 && this.hero.ko <= 0) {
      // a level-up: everything waits while a card is chosen
      this.picking = true;
      void this.host.pick(this.run).then(() => {
        this.picking = false;
        this.refresh();
      });
      return;
    }
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      return;
    }
    this.time += dt;
    const h = this.hero;
    h.dashCd = Math.max(0, h.dashCd - dt);
    this.strikeCd = Math.max(0, this.strikeCd - dt);
    if (h.regen > 0 && h.hp > 0 && h.ko <= 0) h.hp = Math.min(h.maxHp, h.hp + h.regen * dt);
    if (!this.started) {
      this.started = true;
      h.boost = Math.max(h.boost, this.st.rocket);
      this.passive(h, 'start');
      for (const r of this.rivals) this.passive(r, 'start');
    }
    this.timers(h, dt);
    for (const r of this.rivals) if (!r.done) this.timers(r, dt);
    if (h.ko > 0 || h.frozen > 0) {
      h.vx = h.vy = 0;
      h.moving = false;
    } else {
      this.heroControl(dt);
    }
    for (const r of this.rivals) if (!r.done && r.ko <= 0 && r.frozen <= 0) this.rivalAI(r, dt);
    for (const f of this.refs) {
      f.t += dt;
      f.alert = Math.max(0, f.alert - dt);
      f.y = f.homeY + Math.sin(f.t * 0.5) * (f.sway ?? 150);
    }
    this.crowd();
    this.tick(dt);
    if (this.finished) return;
    this.arsenal.step(this, dt, h.ko <= 0 && h.frozen <= 0);
    this.stepEnemies(dt);
    this.stepBullets(dt);
    this.stepLoot(dt);
    this.stepFx(dt);
    this.shake = Math.max(0, this.shake - dt * 30);
  }

  /** Counts down everything that wears off, and gets the knocked-out back on their feet. */
  private timers(r: Runner, dt: number): void {
    r.inv = Math.max(0, r.inv - dt);
    r.slow = Math.max(0, r.slow - dt);
    r.buffSpd = Math.max(0, r.buffSpd - dt);
    r.buffDmg = Math.max(0, r.buffDmg - dt);
    r.decoy = Math.max(0, r.decoy - dt);
    r.boost = Math.max(0, r.boost - dt);
    r.mirror = Math.max(0, r.mirror - dt);
    if (r.dragon > 0) {
      r.dragon = Math.max(0, r.dragon - dt);
      r.inv = Math.max(r.inv, 0.2);
    }
    r.pCd = Math.max(0, r.pCd - dt);
    if (r.frozen > 0) r.frozen = Math.max(0, r.frozen - dt);
    if (r.ko > 0) {
      r.ko -= dt;
      if (r.ko <= 0) {
        r.ko = 0;
        r.hp = r.maxHp * (r.me ? this.st.revive : 0.5);
        r.inv = 2;
        if (r.me) {
          sample('heal', 0.5);
          this.rings.push({ x: r.x, y: r.y, r: 10, max: 120, t: 0, color: '#7dffb0' });
        }
      }
      return;
    }
    const p = r.art.passive;
    if (!p) return;
    if (p.trig === 'hp' && !r.pUsed && r.hp < r.maxHp * (p.pct / 100)) this.passive(r, 'hp');
    if (p.trig === 'tick') {
      r.pTick -= dt;
      if (r.pTick <= 0) {
        r.pTick = 10;
        this.passive(r, 'tick');
      }
    }
  }

  /** Runners shoulder each other aside instead of standing on one spot. */
  private crowd(): void {
    const all = this.rivals;
    const h = this.hero;
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      if (a.done || !a.near) continue;
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j];
        if (b.done || !b.near) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (Math.abs(dx) > 26 || Math.abs(dy) > 26) continue;
        const d = Math.hypot(dx, dy) || 1;
        if (d < 26) {
          const p = (26 - d) / d * 0.5;
          this.moveBody(a, -dx * p, -dy * p);
          this.moveBody(b, dx * p, dy * p);
        }
      }
      // the player's dash is a legal shoulder charge
      const dx = a.x - h.x;
      const dy = a.y - h.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < 30 && h.ko <= 0) {
        if (h.dashT > 0 && a.ko <= 0) {
          a.vx += h.fx * 520 * this.st.bump + (dx / d) * 160;
          a.vy += h.fy * 520 * this.st.bump + (dy / d) * 160;
          a.slow = Math.max(a.slow, 0.5 * this.st.bump);
          if (a.strikeT <= 0) {
            a.strikeT = 0.4;
            this.puff(a.x, a.y, '#ffffff', 5);
            sfx('hit');
            this.host.hud.say(`${this.heroArt.name}、${a.name}を体当たりで押しのけた！`, 1);
          }
        } else {
          const p = ((30 - d) / d) * 0.5;
          this.moveBody(a, dx * p, dy * p);
        }
      }
    }
  }

  // ------------------------------------------------------------------ passive skills
  /** Tries to fire a runner's passive skill for the given moment. True when it went off. */
  passive(r: Runner, trig: 'start' | 'hp' | 'hurt' | 'skill' | 'death' | 'tick'): boolean {
    const p = r.art.passive;
    if (!p || p.trig !== trig || r.pCd > 0) return false;
    if (p.once && r.pUsed) return false;
    const chance = (p.rate / 100) * (r.me ? this.st.passive : 1) * (trig === 'skill' ? 0.5 : 1);
    r.pCd = trig === 'skill' ? 7 : trig === 'hurt' ? 5 : 4;
    if (Math.random() > chance) return false;
    r.pUsed = true;
    for (const f of p.fx) {
      if (f.t === 'revive') {
        if (r.ko > 0) {
          r.ko = 0;
          r.hp = r.maxHp * clamp(f.v / 100, 0.2, 1);
          r.inv = 2.5;
        }
      } else if (f.t === 'buff') {
        if (f.stat === 'agi') r.buffSpd = 6;
        else {
          r.buffDmg = 9;
          r.buffAmt = clamp(f.v / 100, 0.15, 0.6);
        }
      } else if (f.t === 'heal') {
        r.hp = Math.min(r.maxHp, r.hp + r.maxHp * clamp(f.v / 200, 0.1, 0.5));
      } else if (f.t === 'barrier') {
        r.inv = Math.max(r.inv, 3.5);
      } else if (f.t === 'decoy') {
        r.decoy = 5;
      } else if (f.t === 'dmg') {
        const power = (60 + f.v * 0.6) * (r.me ? levelMul(this.run.level) : 1);
        if (f.all) this.blast(r.x, r.y, 280, power, '#ffe45c');
        else {
          let best: Enemy | null = null;
          for (const e of this.enemies) if (!e.dead && !e.asleep && dist2(e.x, e.y, r.x, r.y) < 520 * 520 && (!best || e.hp > best.hp)) best = e;
          if (best) this.blast(best.x, best.y, 70, power * 3, '#ffe45c');
        }
      } else if (f.t === 'debuff' || f.t === 'sleep') {
        // the original weakens "the enemy side": here that is the monsters nearby, and it trips up rivals too
        for (const e of this.enemies) {
          if (e.dead || e.asleep || dist2(e.x, e.y, r.x, r.y) > 330 * 330) continue;
          if (f.t === 'sleep') e.stun = e.boss ? 0.8 : 2.5;
          else e.slow = 4;
        }
        for (const o of [this.hero, ...this.rivals]) {
          if (o === r || o.done || o.ko > 0 || dist2(o.x, o.y, r.x, r.y) > 260 * 260) continue;
          o.slow = Math.max(o.slow, f.t === 'sleep' ? 1.2 : 1.6);
        }
        this.rings.push({ x: r.x, y: r.y, r: 10, max: 330, t: 0, color: '#b58bff' });
      }
    }
    this.rings.push({ x: r.x, y: r.y, r: 10, max: 110, t: 0, color: '#ffe45c' });
    if (r.me) {
      sample('buff', 0.7);
      sfx('levelup');
      this.host.hud.cutin(r.art.img, p.name, p.text);
      earn('passive');
    }
    if (r.me || r.near) this.host.hud.say(`${r.name}のパッシブ「${p.name}」発動！`, r.me ? 3 : 1, 'ain');
    return true;
  }

  // ------------------------------------------------------------------ the direct attack (and the referee)
  /** A swing at whatever is in front. It hurts rivals too, and that is a foul. */
  protected strike(): void {
    const h = this.hero;
    if (this.strikeCd > 0 || h.ko > 0 || h.frozen > 0) return;
    this.strikeCd = 0.65;
    const R = 86;
    // swing at the nearest monster if one is in reach, otherwise straight ahead
    const near = this.nearest(h.x, h.y, R + 30);
    const ang = near ? Math.atan2(near.y - h.y, near.x - h.x) : Math.atan2(h.fy, h.fx);
    const sx = Math.cos(ang);
    const sy = Math.sin(ang);
    this.arcs.push({ x: h.x, y: h.y, ang, r: R, t: 0, color: '#ffffff' });
    sfx('slash');
    const inArc = (x: number, y: number, r: number) => {
      const d = Math.hypot(x - h.x, y - h.y);
      if (d > R + r) return false;
      let da = Math.atan2(y - h.y, x - h.x) - ang;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      return Math.abs(da) < 1.2 || d < r + 22;
    };
    const dmg = 13 * this.traits.phy * this.st.strike * levelMul(this.run.level);
    for (const e of this.enemies) if (!e.dead && !e.asleep && inArc(e.x, e.y, e.r)) this.hitEnemy(e, dmg, sx * 160, sy * 160);
    let hit = 0;
    for (const r of this.rivals) {
      if (r.done || r.ko > 0 || !inArc(r.x, r.y, r.r)) continue;
      hit++;
      this.hurtRunner(r, 16 * this.st.strike, h.x, h.y, h);
      r.vx += sx * 380;
      r.vy += sy * 380;
      r.slow = Math.max(r.slow, 0.8);
    }
    if (hit) {
      const ref = this.watching(h.x, h.y);
      if (ref) {
        ref.alert = 1;
        this.foul(h, Math.min(2, hit));
      } else {
        this.host.hud.say(`${this.heroArt.name}、審判の死角で一撃！ これはおとがめなし！`, 2);
      }
    }
  }

  /** The referee who can see this spot, if any. */
  watching(x: number, y: number): Referee | null {
    for (const f of this.refs) if (dist2(f.x, f.y, x, y) < f.r * f.r) return f;
    return null;
  }

  /** Adds foul points; too many and the referee stops the runner where they stand. */
  foul(r: Runner, n: number): void {
    r.fouls += n;
    const limit = r.me ? this.st.foulLimit : 5;
    if (r.me) {
      sfx('warn');
      this.host.hud.fouls(r.fouls, limit);
    }
    if (r.fouls >= limit) {
      r.fouls = 0;
      r.frozen = 3 * (r.me ? this.st.freeze : 1);
      r.vx = r.vy = 0;
      if (r.me) {
        this.host.hud.banner('反則！', '審判に止められた', 'warn');
        this.host.hud.fouls(0, limit);
        sample('lose', 0.5);
        earn('foul');
      }
      if (r.me || r.near) this.host.hud.say(`ピピーッ！ ${r.name}に反則！ その場で静止です！`, 3);
      this.onFoul(r);
    }
  }

  /** Damage to anyone in the race. `by` is the runner who did it (for the commentary). */
  hurtRunner(r: Runner, dmg: number, fromX?: number, fromY?: number, by?: Runner): void {
    if (r.me) {
      this.hurtHero(dmg, fromX, fromY, by);
      return;
    }
    if (r.inv > 0 || r.ko > 0 || r.done) return;
    r.hp -= dmg;
    r.inv = 0.45;
    if (fromX !== undefined && fromY !== undefined) {
      const a = Math.atan2(r.y - fromY, r.x - fromX);
      r.vx += Math.cos(a) * 200;
      r.vy += Math.sin(a) * 200;
    }
    this.passive(r, 'hurt');
    if (r.hp <= 0) this.knockOut(r, by);
  }

  private knockOut(r: Runner, by?: Runner): void {
    r.hp = 0;
    r.ko = 3.5 * (r.me ? this.st.ko : 1);
    r.vx = r.vy = 0;
    r.dashT = 0;
    this.puff(r.x, r.y, '#ffffff', 14);
    if (r.me || r.near) {
      this.host.hud.say(by ? `${by.name}の一撃！ ${r.name}が気絶！` : `ああっと！ ${r.name}が気絶！`, r.me ? 3 : 1);
    }
    this.onKo(r);
    this.passive(r, 'death');
  }

  /** Eight-way movement with a little easing. `drag` < 1 gives the floaty feel under water. */
  protected walk(dt: number, snap: number): void {
    const h = this.hero;
    const mx = input.move.x;
    const my = input.move.y;
    h.moving = mx !== 0 || my !== 0;
    if (h.moving) {
      const l = Math.hypot(mx, my) || 1;
      h.fx = mx / l;
      h.fy = my / l;
      if (Math.abs(mx) > 0.2) h.flip = mx > 0;
      h.bob += dt * 11;
    }
    let sp = h.speed * this.boosts.speed * (h.slow > 0 ? 0.6 + 0.4 * Math.min(1, this.st.grit) : 1) * (h.buffSpd > 0 ? 1.25 : 1) * (h.boost > 0 ? 1.4 : 1) * (h.dragon > 0 ? 2.1 : 1);
    if (this.st.draft > 0 && this.drafting()) sp *= 1 + this.st.draft;
    if (h.dashT > 0) {
      h.dashT -= dt;
      sp *= 2.5;
      h.vx = h.fx * sp;
      h.vy = h.fy * sp;
      if (Math.random() < 0.7) this.puff(h.x, h.y + 10, '#ffffff', 1);
    } else {
      const k = 1 - Math.pow(1 - snap, dt * 60);
      h.vx += (mx * sp - h.vx) * k;
      h.vy += (my * sp - h.vy) * k;
    }
    this.moveBody(h, h.vx * dt, h.vy * dt);
  }

  /** True while the hero is tucked in right behind another runner. */
  drafting(): boolean {
    const h = this.hero;
    for (const r of this.rivals) {
      if (r.done || r.ko > 0) continue;
      const dx = r.x - h.x;
      const dy = r.y - h.y;
      const along = dx * h.fx + dy * h.fy;
      if (along > 20 && along < 130 && Math.abs(dx * h.fy - dy * h.fx) < 30) return true;
    }
    return false;
  }

  protected dash(): boolean {
    const h = this.hero;
    if (h.dashCd > 0 || h.dashT > 0) return false;
    h.dashT = 0.2;
    h.dashCd = 1.4 * this.st.dashCd;
    h.inv = Math.max(h.inv, 0.32);
    sfx('dash');
    return true;
  }

  // ------------------------------------------------------------------ gear that fights on its own
  nearest(x: number, y: number, maxR: number): Enemy | null {
    let best: Enemy | null = null;
    let bd = maxR * maxR;
    for (const e of this.enemies) {
      if (e.dead || e.asleep) continue;
      const d = dist2(x, y, e.x, e.y) - e.r * e.r;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  blast(x: number, y: number, r: number, dmg: number, color: string): void {
    for (const e of this.enemies) {
      if (e.dead || e.asleep) continue;
      if (dist2(x, y, e.x, e.y) < (r + e.r) ** 2) this.hitEnemy(e, dmg, (e.x - x) * 0.8, (e.y - y) * 0.8);
    }
    this.rings.push({ x, y, r: 6, max: r, t: 0, color });
    this.puff(x, y, color, 8);
  }

  hitEnemy(e: Enemy, dmg: number, kx: number, ky: number, by: Runner | null = null): void {
    if (e.dead) return;
    const crit = !by && Math.random() < this.st.crit;
    const d = Math.max(1, Math.round(dmg * (crit ? 1.8 : 1) * (0.9 + Math.random() * 0.2)));
    e.hp -= d;
    e.flash = 0.1;
    const res = e.boss ? 0.05 : e.elite ? 0.3 : 1;
    e.kx += kx * res;
    e.ky += ky * res;
    if (!by && this.floats.length < 60) {
      this.floats.push({
        x: e.x + (Math.random() - 0.5) * 20, y: e.y - e.size * 0.4, text: String(d),
        color: crit ? '#ffe45c' : '#ffffff', t: 0, big: crit,
      });
    }
    if (!by) sfx('hit', 0.05);
    this.onHit(e, d, by);
    if (e.hp <= 0) this.kill(e, by);
  }

  private kill(e: Enemy, by: Runner | null): void {
    e.dead = true;
    if (by) {
      // a rival's kill: no loot for the player
      this.puff(e.x, e.y, '#ffffff', 5);
      this.killed(e);
      return;
    }
    this.run.kills += 1;
    this.run.gum += Math.max(1, Math.round((1 + e.xp * 0.7) * this.st.gum * this.boosts.gain));
    this.puff(e.x, e.y, '#ffffff', e.boss ? 40 : e.elite ? 18 : 7);
    this.puff(e.x, e.y, '#ffb35c', e.boss ? 30 : 4);
    if (e.boss || e.elite) {
      sample('blast', 0.6);
      sfx('boom');
      this.shake = e.boss ? 18 : 9;
      this.hitstop = e.boss ? 0.18 : 0.06;
    } else {
      sfx('kill', 0.06);
    }
    const n = e.boss ? 14 : e.elite ? 6 : 1;
    for (let i = 0; i < n; i++) {
      this.gems.push({
        x: e.x + (Math.random() - 0.5) * e.size * 0.8, y: e.y + (Math.random() - 0.5) * e.size * 0.8,
        v: Math.max(1, Math.round(e.xp / n)), t: 0,
      });
    }
    this.killed(e);
  }

  hurtHero(dmg: number, fromX?: number, fromY?: number, by?: Runner): void {
    const h = this.hero;
    if (h.inv > 0 || h.ko > 0 || this.finished) return;
    h.hp -= dmg * this.st.guard * this.boosts.taken;
    h.inv = 0.7;
    this.shake = Math.max(this.shake, 8);
    sfx('hurt');
    this.host.hud.hurt();
    if (fromX !== undefined && fromY !== undefined) {
      const a = Math.atan2(h.y - fromY, h.x - fromX);
      h.vx += Math.cos(a) * 260;
      h.vy += Math.sin(a) * 260;
    }
    this.passive(h, 'hurt');
    if (h.hp <= 0) {
      if (this.koMode) this.faint(by);
      else this.down();
    }
  }

  /** The hero is out cold for a few seconds (races with rivals). */
  protected faint(by?: Runner): void {
    this.run.downs += 1;
    this.shake = 16;
    sfx('down');
    this.host.hud.banner('気絶！', '', 'warn');
    this.knockOut(this.hero, by);
  }

  /** No game over: the hero gets back up, and the clock takes the hit. */
  protected down(): void {
    const h = this.hero;
    this.time += DOWN_PENALTY;
    this.run.downs += 1;
    h.hp = h.maxHp;
    h.inv = 2.6;
    this.ebullets.length = 0;
    for (const e of this.enemies) {
      if (e.dead || e.boss || e.elite) continue;
      if (dist2(e.x, e.y, h.x, h.y) < 320 * 320) {
        const a = Math.atan2(e.y - h.y, e.x - h.x);
        e.kx += Math.cos(a) * 900;
        e.ky += Math.sin(a) * 900;
      }
    }
    this.rings.push({ x: h.x, y: h.y, r: 10, max: 320, t: 0, color: '#ffffff' });
    this.shake = 16;
    sfx('down');
    this.host.hud.penalty(DOWN_PENALTY);
    this.onDown();
  }

  spawn(art: { url: string; name: string }, x: number, y: number, o: Partial<Enemy>): Enemy {
    const e: Enemy = {
      x, y, vx: 0, vy: 0, r: 18, hp: 20, maxHp: 20, speed: 90, dmg: 10, url: art.url, size: 64, name: art.name,
      ai: 'chase', state: 0, timer: 0, t: Math.random() * 10, flash: 0, slow: 0, orbitCd: 0, kx: 0, ky: 0, xp: 1,
      boss: false, elite: false, dead: false, face: 1, ax: x, ay: y, tier: 0, asleep: false, tg: null, tgT: 0, stun: 0, ...o,
    };
    if (!e.boss) e.hp *= this.st.enemyHp;
    e.maxHp = e.hp;
    img(e.url);
    this.enemies.push(e);
    return e;
  }

  fire(x: number, y: number, ang: number, speed: number, dmg: number, color = '#ff6b8b', r = 7): void {
    if (this.ebullets.length > 220) return;
    this.ebullets.push({ x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, r, dmg, life: 5, color });
  }

  private stepEnemies(dt: number): void {
    const h = this.hero;
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (e.asleep) {
        if (dist2(e.x, e.y, h.x, h.y) < 620 * 620) e.asleep = false;
        else continue;
      }
      e.t += dt;
      e.flash = Math.max(0, e.flash - dt);
      e.orbitCd = Math.max(0, e.orbitCd - dt);
      e.slow = Math.max(0, e.slow - dt);
      if (e.stun > 0) {
        e.stun -= dt;
        e.flash = 0;
        continue;
      }
      // look around now and then for the closest runner still on their feet
      e.tgT -= dt;
      if (e.tgT <= 0 || !e.tg || e.tg.ko > 0 || e.tg.done) {
        e.tgT = 0.5 + Math.random() * 0.3;
        let best: Runner = h;
        let bd = h.ko > 0 || h.decoy > 0 ? 1e12 : dist2(h.x, h.y, e.x, e.y);
        if (!e.boss) {
          for (const r of this.rivals) {
            if (r.done || r.ko > 0 || r.decoy > 0 || !r.near) continue;
            const d = dist2(r.x, r.y, e.x, e.y);
            if (d < bd) {
              bd = d;
              best = r;
            }
          }
        }
        e.tg = best;
      }
      const tg = e.tg;
      const dx = tg.x - e.x;
      const dy = tg.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      const ux = dx / d;
      const uy = dy / d;
      const sp = e.speed * (e.slow > 0 ? 0.55 : 1);
      let mx = 0;
      let my = 0;
      switch (e.ai) {
        case 'chase':
          mx = ux * sp;
          my = uy * sp;
          break;
        case 'zigzag': {
          const w = Math.sin(e.t * 5) * 0.8;
          mx = (ux - uy * w) * sp;
          my = (uy + ux * w) * sp;
          break;
        }
        case 'dash':
          // approach, crouch (flash), then lunge in a straight line
          if (e.state === 0) {
            mx = ux * sp;
            my = uy * sp;
            if (d < 230) {
              e.state = 1;
              e.timer = 0.45;
            }
          } else if (e.state === 1) {
            e.timer -= dt;
            e.flash = 0.05;
            if (e.timer <= 0) {
              e.state = 2;
              e.timer = 0.5;
              e.ax = ux;
              e.ay = uy;
            }
          } else if (e.state === 2) {
            e.timer -= dt;
            mx = e.ax * sp * 4.2;
            my = e.ay * sp * 4.2;
            if (e.timer <= 0) {
              e.state = 3;
              e.timer = 0.7;
            }
          } else {
            e.timer -= dt;
            if (e.timer <= 0) e.state = 0;
          }
          break;
        case 'shoot': {
          const want = 250;
          const k = d > want + 30 ? 1 : d < want - 40 ? -0.8 : 0;
          mx = (ux * k - uy * 0.35) * sp;
          my = (uy * k + ux * 0.35) * sp;
          e.timer -= dt;
          if (e.timer <= 0 && d < 520) {
            e.timer = 2.3 - e.tier * 0.15;
            this.fire(e.x, e.y, Math.atan2(dy, dx), 190 + e.tier * 12, e.dmg);
          }
          break;
        }
        case 'burst':
          // elites: keep coming, and throw a ring of shots now and then
          mx = ux * sp;
          my = uy * sp;
          e.timer -= dt;
          if (e.timer <= 0) {
            e.timer = 3;
            const n = 10 + e.tier * 2;
            for (let i = 0; i < n; i++) this.fire(e.x, e.y, (i / n) * TAU + e.t, 170, e.dmg * 0.8);
            sfx('magic');
          }
          break;
        case 'patrol':
          // sea: swim back and forth; charge when the diver is level with it
          if (e.state === 0) {
            mx = e.face * sp * 0.6;
            const bx = e.x;
            this.moveBody(e, mx * dt, 0);
            if (Math.abs(e.x - bx) < Math.abs(mx * dt) * 0.5) e.face *= -1;
            mx = 0;
            if (d < 300 && Math.abs(dy) < 70) {
              e.state = 1;
              e.timer = 0.35;
            }
          } else if (e.state === 1) {
            e.timer -= dt;
            e.flash = 0.05;
            if (e.timer <= 0) {
              e.state = 2;
              e.timer = 0.9;
              e.ax = ux;
              e.ay = uy;
            }
          } else {
            e.timer -= dt;
            mx = e.ax * sp * 3.2;
            my = e.ay * sp * 3.2;
            if (e.timer <= 0) {
              e.state = 0;
              e.face = e.ax >= 0 ? 1 : -1;
            }
          }
          break;
        case 'jelly':
          // sea: drifts, and kicks toward the diver in pulses
          e.timer -= dt;
          if (e.timer <= 0) {
            e.timer = 1.25;
            if (d < 520) {
              e.vx = ux * sp * 2.6;
              e.vy = uy * sp * 2.6;
              if (e.tier >= 2 && d < 420) this.fire(e.x, e.y, Math.atan2(dy, dx), 150, e.dmg * 0.8, '#b58bff');
            }
          }
          e.vx *= Math.pow(0.12, dt);
          e.vy *= Math.pow(0.12, dt);
          mx = e.vx;
          my = e.vy + Math.sin(e.t * 2) * 12;
          break;
        case 'boss':
          this.bossAI(e, dt);
          break;
      }
      mx += e.kx;
      my += e.ky;
      e.kx *= Math.pow(0.002, dt);
      e.ky *= Math.pow(0.002, dt);
      if (mx || my) this.moveBody(e, mx * dt, my * dt);
      if (Math.abs(dx) > 6 && e.ai !== 'patrol') e.face = dx > 0 ? 1 : -1;
      if (d < e.r + tg.r - 2 && tg.ko <= 0) {
        tg.slow = Math.max(tg.slow, 0.3);
        this.hurtRunner(tg, e.dmg, e.x, e.y);
      }
    }
    // keep the crowd from stacking into a single point
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.dead || a.asleep || a.boss) continue;
      for (let j = i + 1; j < Math.min(list.length, i + 14); j++) {
        const b = list[j];
        if (b.dead || b.asleep || b.boss) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const rr = (a.r + b.r) * 0.8;
        const d2 = dx * dx + dy * dy;
        if (d2 < rr * rr && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const p = ((rr - d) / d) * 0.5;
          a.x -= dx * p;
          a.y -= dy * p;
          b.x += dx * p;
          b.y += dy * p;
        }
      }
    }
    if (this.enemies.length > 60 || this.enemies.some((e) => e.dead)) this.enemies = this.enemies.filter((e) => !e.dead);
  }

  private stepBullets(dt: number): void {
    const h = this.hero;
    for (const b of this.ebullets) {
      b.life -= dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (this.blocked(b.x, b.y)) b.life = 0;
      else if (h.ko <= 0 && dist2(b.x, b.y, h.x, h.y) < (b.r + h.r - 4) ** 2) {
        b.life = 0;
        this.hurtHero(b.dmg, b.x - b.vx, b.y - b.vy);
      } else {
        for (const r of this.rivals) {
          if (r.done || !r.near || r.ko > 0) continue;
          if (dist2(b.x, b.y, r.x, r.y) < (b.r + r.r - 4) ** 2) {
            b.life = 0;
            this.hurtRunner(r, b.dmg, b.x - b.vx, b.y - b.vy);
            break;
          }
        }
      }
    }
    this.ebullets = this.ebullets.filter((b) => b.life > 0);
  }

  private stepLoot(dt: number): void {
    const h = this.hero;
    const reach = 130 * this.st.magnet * this.boosts.pickup;
    for (const g of this.gems) {
      g.t += dt;
      const d2 = dist2(g.x, g.y, h.x, h.y);
      if (h.ko <= 0 && (d2 < reach * reach || g.t > 5)) {
        const d = Math.sqrt(d2) || 1;
        const sp = 560 + g.t * 220 + Math.abs(h.vx);
        g.x += ((h.x - g.x) / d) * sp * dt;
        g.y += ((h.y - g.y) / d) * sp * dt;
      }
      if (d2 < 26 * 26) {
        const v = g.v;
        g.v = 0;
        sfx('gem', 0.03);
        if (addXp(this.run, v * this.st.xp * this.boosts.gain)) this.levelUp();
      }
    }
    this.gems = this.gems.filter((g) => g.v > 0);
  }

  protected levelUp(): void {
    const h = this.hero;
    h.hp = Math.min(h.maxHp, h.hp + h.maxHp * 0.1);
    sfx('levelup');
    this.floats.push({ x: h.x, y: h.y - 50, text: `LEVEL ${this.run.level}`, color: '#7dffb0', t: 0, big: true });
    this.rings.push({ x: h.x, y: h.y, r: 10, max: 90, t: 0, color: '#7dffb0' });
  }

  /** Re-reads what the carried boosts add up to (after a card is taken). */
  refresh(): void {
    const h = this.hero;
    this.boosts = boostsOf(this.run);
    const full = this.fullHp();
    if (full > h.maxHp) h.hp += full - h.maxHp;
    h.maxHp = full;
    h.regen = this.st.regen + this.boosts.regen;
    this.host.hud.slots(this.run.slots);
  }

  /** A free card (a treasure chest, a relic): the same pick as a level-up, without the level. */
  grant(n = 1): void {
    this.run.pending += n;
  }


  puff(x: number, y: number, color: string, n: number, g = 0): void {
    if (this.parts.length > 400) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const sp = 40 + Math.random() * 220;
      const life = 0.25 + Math.random() * 0.45;
      this.parts.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, max: life, color, size: 2 + Math.random() * 4, g,
      });
    }
  }

  private stepFx(dt: number): void {
    for (const p of this.parts) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.g * dt;
      p.vx *= Math.pow(0.05, dt);
      p.vy *= Math.pow(0.05, dt);
    }
    this.parts = this.parts.filter((p) => p.life > 0);
    for (const f of this.floats) {
      f.t += dt;
      f.y -= 36 * dt;
    }
    this.floats = this.floats.filter((f) => f.t < (f.big ? 1.1 : 0.6));
    for (const a of this.arcs) a.t += dt;
    this.arcs = this.arcs.filter((a) => a.t < 0.18);
    for (const r of this.rings) r.t += dt;
    this.rings = this.rings.filter((r) => r.t < 0.35);
  }

  // ------------------------------------------------------------------ drawing
  sprite(g: CanvasRenderingContext2D, url: string, x: number, y: number, size: number, flip: boolean, flash = false, grey = false): void {
    const im = img(url);
    if (!ready(im)) return;
    const src: CanvasImageSource = grey ? greyOf(url) ?? im : flash ? whiteOf(url) ?? im : im;
    const hs = size / 2;
    if (flip) {
      g.save();
      g.translate(Math.round(x), Math.round(y));
      g.scale(-1, 1);
      g.drawImage(src, -hs, -hs, size, size);
      g.restore();
    } else {
      g.drawImage(src, Math.round(x - hs), Math.round(y - hs), size, size);
    }
  }

  render(): void {
    const g = this.g;
    const h = this.hero;
    g.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    g.imageSmoothingEnabled = false;
    const sx = this.shake ? (Math.random() - 0.5) * this.shake : 0;
    const sy = this.shake ? (Math.random() - 0.5) * this.shake : 0;
    g.save();
    g.translate(-Math.round(this.camX) + sx, -Math.round(this.camY) + sy);
    this.drawBack(g);

    const x0 = this.camX - 80;
    const x1 = this.camX + this.vw + 80;
    const y0 = this.camY - 80;
    const y1 = this.camY + this.vh + 80;
    const seen = (x: number, y: number) => x > x0 && x < x1 && y > y0 && y < y1;

    // referees and what they can see
    for (const f of this.refs) {
      if (f.x < x0 - f.r || f.x > x1 + f.r) continue;
      const hot = f.alert > 0;
      g.fillStyle = hot ? 'rgba(255,92,122,0.28)' : 'rgba(255,228,92,0.10)';
      g.beginPath();
      g.arc(f.x, f.y, f.r, 0, TAU);
      g.fill();
      g.strokeStyle = hot ? '#ff5c7a' : 'rgba(255,228,92,0.75)';
      g.lineWidth = 3;
      g.setLineDash([14, 10]);
      g.lineDashOffset = -this.time * 30;
      g.beginPath();
      g.arc(f.x, f.y, f.r, 0, TAU);
      g.stroke();
      g.setLineDash([]);
      const im = img(hot ? cat.chars.refAngry : cat.chars.ref);
      if (ready(im)) {
        const hh = 64;
        const ww = (im.naturalWidth / im.naturalHeight) * hh;
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.beginPath();
        g.ellipse(f.x, f.y + hh / 2 - 2, 18, 6, 0, 0, TAU);
        g.fill();
        g.drawImage(im, Math.round(f.x - ww / 2), Math.round(f.y - hh / 2), ww, hh);
      }
      g.fillStyle = hot ? '#ff5c7a' : '#ffe45c';
      g.font = '11px DotGothic16, sans-serif';
      g.textAlign = 'center';
      g.fillText(hot ? 'ピピーッ！' : '審判', f.x, f.y - 38);
    }

    // loot
    const ce = img(cat.icons.ce);
    for (const gm of this.gems) {
      if (!seen(gm.x, gm.y)) continue;
      if (ready(ce)) g.drawImage(ce, gm.x - 9, gm.y - 9, 18, 18);
    }
    // rings & arcs under the bodies
    for (const r of this.rings) {
      const k = r.t / 0.35;
      g.globalAlpha = 1 - k;
      g.strokeStyle = r.color;
      g.lineWidth = 5 * (1 - k) + 1;
      g.beginPath();
      g.arc(r.x, r.y, r.r + (r.max - r.r) * k, 0, TAU);
      g.stroke();
    }
    g.globalAlpha = 1;

    // enemies (sorted by y so they overlap properly on land)
    const list = this.enemies.filter((e) => !e.dead && !e.asleep && seen(e.x, e.y));
    if (this.shadows) list.sort((a, b) => a.y - b.y);
    for (const e of list) {
      if (this.shadows) {
        g.fillStyle = 'rgba(0,0,0,0.28)';
        g.beginPath();
        g.ellipse(e.x, e.y + e.size * 0.42, e.size * 0.3, e.size * 0.1, 0, 0, TAU);
        g.fill();
      }
      const wob = Math.sin(e.t * 9) * 2;
      this.sprite(g, e.url, e.x, e.y + wob, e.size, e.face > 0, e.flash > 0);
      if ((e.elite || e.boss) && e.hp < e.maxHp) {
        const w = e.size * 0.8;
        g.fillStyle = 'rgba(0,0,0,0.6)';
        g.fillRect(e.x - w / 2, e.y - e.size * 0.6, w, 5);
        g.fillStyle = '#ff5c7a';
        g.fillRect(e.x - w / 2, e.y - e.size * 0.6, w * clamp(e.hp / e.maxHp, 0, 1), 5);
      }
    }

    // the rivals
    g.font = '10px DotGothic16, sans-serif';
    g.textAlign = 'center';
    for (const r of this.rivals) {
      if ((r.done && !this.showDone) || !seen(r.x, r.y)) continue;
      g.fillStyle = 'rgba(0,0,0,0.26)';
      g.beginPath();
      g.ellipse(r.x, r.y + 24, 17, 6, 0, 0, TAU);
      g.fill();
      const out = r.ko > 0;
      const bob = out ? 6 : r.moving ? Math.abs(Math.sin(r.bob)) * -4 : 0;
      if (r.inv > 0 && !out && Math.floor(this.time * 20) % 2 === 0) g.globalAlpha = 0.55;
      if (r.buffSpd > 0 || r.boost > 0) {
        g.globalAlpha = 0.3;
        this.sprite(g, r.art.img, r.x - r.vx * 0.06, r.y + bob, 56, r.flip);
        g.globalAlpha = 1;
      }
      this.sprite(g, r.art.img, r.x, r.y + bob, 56, r.flip, false, out);
      g.globalAlpha = 1;
      this.mark(g, r);
      g.fillStyle = 'rgba(0,0,0,0.55)';
      const w = g.measureText(r.name).width + 6;
      g.fillRect(r.x - w / 2, r.y + 30, w, 12);
      g.fillStyle = out ? '#9aa2c7' : '#ffffff';
      g.fillText(r.name, r.x, r.y + 39);
    }

    // the hero
    const blink = h.inv > 0 && h.ko <= 0 && Math.floor(this.time * 20) % 2 === 0;
    if (this.shadows) {
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.beginPath();
      g.ellipse(h.x, h.y + 26, 20, 7, 0, 0, TAU);
      g.fill();
    }
    if (this.rivals.length) {
      g.strokeStyle = '#ffe45c';
      g.lineWidth = 2;
      g.beginPath();
      g.ellipse(h.x, h.y + 26, 24, 9, 0, 0, TAU);
      g.stroke();
      g.fillStyle = '#ffe45c';
      const by = h.y - 46 + Math.sin(this.time * 6) * 3;
      g.beginPath();
      g.moveTo(h.x, by + 8);
      g.lineTo(h.x - 7, by - 2);
      g.lineTo(h.x + 7, by - 2);
      g.fill();
    }
    this.drawHero(g, blink);
    this.mark(g, h);

    this.arsenal.draw(this, g);

    // slashes
    for (const a of this.arcs) {
      const k = a.t / 0.18;
      g.globalAlpha = 1 - k;
      g.strokeStyle = '#ffffff';
      g.lineWidth = 16 * (1 - k) + 2;
      g.beginPath();
      g.arc(a.x, a.y, a.r * (0.7 + k * 0.3), a.ang - 1.1 + k * 0.5, a.ang + 1.1 - (1 - k) * 0.9);
      g.stroke();
      g.strokeStyle = a.color;
      g.lineWidth = 6 * (1 - k) + 1;
      g.beginPath();
      g.arc(a.x, a.y, a.r * (0.7 + k * 0.3) + 8, a.ang - 1.1, a.ang + 1.1);
      g.stroke();
    }
    g.globalAlpha = 1;

    // enemy shots: always the brightest thing on the screen
    for (const b of this.ebullets) {
      g.fillStyle = b.color;
      g.beginPath();
      g.arc(b.x, b.y, b.r + 2.5, 0, TAU);
      g.fill();
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(b.x, b.y, b.r * 0.55, 0, TAU);
      g.fill();
    }

    for (const p of this.parts) {
      g.globalAlpha = clamp(p.life / p.max, 0, 1);
      g.fillStyle = p.color;
      g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    g.globalAlpha = 1;

    this.drawFront(g);

    g.textAlign = 'center';
    for (const f of this.floats) {
      const k = f.t / (f.big ? 1.1 : 0.6);
      g.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      g.font = `${f.big ? 18 : 13}px DotGothic16, sans-serif`;
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(10,10,20,0.85)';
      g.strokeText(f.text, f.x, f.y);
      g.fillStyle = f.color;
      g.fillText(f.text, f.x, f.y);
    }
    g.globalAlpha = 1;
    g.restore();
    this.drawOverlay(g);
  }

  protected drawHero(g: CanvasRenderingContext2D, blink: boolean): void {
    const h = this.hero;
    if (blink) g.globalAlpha = 0.45;
    const out = h.ko > 0;
    const bob = out ? 6 : h.moving ? Math.abs(Math.sin(h.bob)) * -4 : 0;
    if (!out && (h.boost > 0 || h.buffSpd > 0)) {
      g.globalAlpha = 0.3;
      this.sprite(g, this.heroArt.img, h.x - h.vx * 0.07, h.y + bob - h.vy * 0.07, 64, h.flip);
      g.globalAlpha = blink ? 0.45 : 1;
    }
    this.sprite(g, this.heroArt.img, h.x, h.y + bob, 64, h.flip, false, out);
    g.globalAlpha = 1;
  }

  /** Stars over the knocked-out, a whistle over the penalised, a glow on the buffed. */
  private mark(g: CanvasRenderingContext2D, r: Runner): void {
    if (r.ko > 0) {
      g.fillStyle = '#ffe45c';
      for (let i = 0; i < 3; i++) {
        const a = this.time * 5 + (i / 3) * TAU;
        g.fillRect(r.x + Math.cos(a) * 16 - 2, r.y - 30 + Math.sin(a) * 5 - 2, 5, 5);
      }
    } else if (r.frozen > 0) {
      g.fillStyle = '#ff5c7a';
      g.fillRect(r.x - 9, r.y - 48, 18, 14);
      g.fillStyle = '#fff';
      g.font = '10px DotGothic16, sans-serif';
      g.textAlign = 'center';
      g.fillText('反則', r.x, r.y - 37);
      g.strokeStyle = '#ff5c7a';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(r.x, r.y, 26, 0, TAU * (r.frozen / 3));
      g.stroke();
    } else if (r.dragon > 0) {
      this.sprite(g, cat.extArt['3117'].img, r.x, r.y + 22, 72, r.flip);
    } else if (r.mirror > 0) {
      g.strokeStyle = 'rgba(160,230,255,0.9)';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(r.x, r.y, 30, this.time * 4, this.time * 4 + 4.5);
      g.stroke();
    } else if (r.buffDmg > 0) {
      g.strokeStyle = 'rgba(255,120,90,0.8)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(r.x, r.y, 24 + Math.sin(this.time * 10) * 2, 0, TAU);
      g.stroke();
    }
  }

  /** Screen-space extras (darkness, arrows). Drawn after the world, in view coordinates. */
  protected drawOverlay(_g: CanvasRenderingContext2D): void {}
}
