// Shared 2D action core for the land and sea races: the hero, enemies, the gear that fights on its own,
// pickups, particles and drawing. Each race adds its own course and rules on top.

import { img, ready, whiteOf } from '../core/assets';
import { sample, sfx } from '../core/audio';
import { cat, KIND_COLOR, RARITY_COLOR, traitsOf, type Ext, type Hero, type Traits } from '../core/catalog';
import { input } from '../core/input';
import { clamp, dist2, TAU, type Rng, makeRng } from '../core/util';
import {
  addXp, armorHp, armorRegen, DOWN_PENALTY, heroMul, levelMul, slotPower, takeExt, type Run, type Slot,
} from '../game/run';
import type { Host, Stage } from './stage';

export interface Enemy {
  x: number; y: number; vx: number; vy: number; r: number;
  hp: number; maxHp: number; speed: number; dmg: number;
  url: string; size: number; name: string;
  ai: string; state: number; timer: number; t: number;
  flash: number; slow: number; orbitCd: number; kx: number; ky: number;
  xp: number; boss: boolean; elite: boolean; dead: boolean; face: number;
  /** Free for the race to use (home position, phase, ...). */
  ax: number; ay: number; tier: number; asleep: boolean;
}
export interface Shot {
  x: number; y: number; vx: number; vy: number; r: number; dmg: number; pierce: number; life: number;
  type: 'bullet' | 'orb' | 'beast' | 'harpoon';
  url?: string; color: string; hit: Set<Enemy>; target: Enemy | null; blast: number; kb: number; ox: number; oy: number;
}
export interface EBullet { x: number; y: number; vx: number; vy: number; r: number; dmg: number; life: number; color: string }
export interface Pickup { x: number; y: number; ext: Ext; t: number; taken: boolean }
interface Gem { x: number; y: number; v: number; t: number }
interface Part { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; g: number }
interface Float { x: number; y: number; text: string; color: string; t: number; big: boolean }
interface Arc { x: number; y: number; ang: number; r: number; t: number; color: string }
interface Ring { x: number; y: number; r: number; max: number; t: number; color: string }
interface WState { cd: number; ang: number }

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
  run: Run;
  heroArt: Hero;
  traits: Traits;
  rng: Rng;
  hero = {
    x: 0, y: 0, vx: 0, vy: 0, r: 15, hp: 100, maxHp: 100, fx: 1, fy: 0, flip: false,
    inv: 0, dashT: 0, dashCd: 0, speed: 230, regen: 0, moving: false, bob: 0,
  };
  enemies: Enemy[] = [];
  shots: Shot[] = [];
  ebullets: EBullet[] = [];
  pickups: Pickup[] = [];
  gems: Gem[] = [];
  parts: Part[] = [];
  floats: Float[] = [];
  arcs: Arc[] = [];
  rings: Ring[] = [];
  wstate = new Map<number, WState>();
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
    h.speed = 230 * (0.86 + 0.14 * this.traits.agi);
    h.regen = armorRegen(this.run);
    img(this.heroArt.img);
    for (const s of this.run.slots) img(s.ext.img);
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
    return Math.round(100 * this.traits.hp + armorHp(this.run));
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
  /** Moves a body, stopping at walls. */
  protected abstract moveBody(b: { x: number; y: number; r: number }, dx: number, dy: number): void;
  protected killed(_e: Enemy): void {}
  protected onDown(): void {}
  protected bossAI(_e: Enemy, _dt: number): void {}
  protected heroControl(dt: number): void {
    this.walk(dt, 1);
  }

  // ------------------------------------------------------------------ update
  update(dt: number): void {
    if (this.finished) return;
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      return;
    }
    this.time += dt;
    const h = this.hero;
    h.inv = Math.max(0, h.inv - dt);
    h.dashCd = Math.max(0, h.dashCd - dt);
    if (h.regen > 0 && h.hp > 0) h.hp = Math.min(h.maxHp, h.hp + h.regen * dt);
    this.heroControl(dt);
    this.tick(dt);
    if (this.finished) return;
    this.weapons(dt);
    this.stepShots(dt);
    this.stepEnemies(dt);
    this.stepBullets(dt);
    this.stepLoot(dt);
    this.stepFx(dt);
    this.shake = Math.max(0, this.shake - dt * 30);
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
    let sp = h.speed;
    if (h.dashT > 0) {
      h.dashT -= dt;
      sp *= 2.9;
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

  protected dash(): boolean {
    const h = this.hero;
    if (h.dashCd > 0 || h.dashT > 0) return false;
    h.dashT = 0.2;
    h.dashCd = 1.4;
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

  private dmgOf(s: Slot): number {
    return slotPower(s) * heroMul(this.traits, s.ext) * levelMul(this.run.level);
  }

  private weapons(dt: number): void {
    const h = this.hero;
    const cdMul = 1 / (0.82 + 0.18 * this.traits.agi);
    for (const s of this.run.slots) {
      const k = s.ext.kind;
      if (k === 'armor') continue;
      let w = this.wstate.get(s.ext.series);
      if (!w) {
        w = { cd: 0.3 + Math.random() * 0.4, ang: Math.random() * TAU };
        this.wstate.set(s.ext.series, w);
      }
      const dmg = this.dmgOf(s);
      const color = KIND_COLOR[k];
      if (k === 'orbit') {
        w.ang += dt * 3.3;
        const n = 1 + Math.floor((s.lv + 1) / 2);
        const R = 74 + s.lv * 4;
        for (let i = 0; i < n; i++) {
          const a = w.ang + (i / n) * TAU;
          const ox = h.x + Math.cos(a) * R;
          const oy = h.y + Math.sin(a) * R;
          for (const e of this.enemies) {
            if (e.dead || e.asleep || e.orbitCd > 0) continue;
            if (dist2(ox, oy, e.x, e.y) < (e.r + 16) ** 2) {
              e.orbitCd = 0.4;
              this.hitEnemy(e, dmg * 0.75, (e.x - h.x) * 0.5, (e.y - h.y) * 0.5);
            }
          }
          for (const b of this.ebullets) if (dist2(ox, oy, b.x, b.y) < 20 * 20) b.life = 0;
        }
        continue;
      }
      w.cd -= dt;
      if (w.cd > 0) continue;
      if (k === 'slash') {
        const R = 92 + s.lv * 8;
        const t = this.nearest(h.x, h.y, R + 40);
        if (!t) {
          w.cd = 0.12;
          continue;
        }
        const ang = Math.atan2(t.y - h.y, t.x - h.x);
        for (const e of this.enemies) {
          if (e.dead || e.asleep) continue;
          const d = Math.hypot(e.x - h.x, e.y - h.y);
          if (d > R + e.r) continue;
          let da = Math.atan2(e.y - h.y, e.x - h.x) - ang;
          da = Math.atan2(Math.sin(da), Math.cos(da));
          if (Math.abs(da) < 1.15 || d < e.r + 24) this.hitEnemy(e, dmg * 1.6, Math.cos(ang) * 90, Math.sin(ang) * 90);
        }
        this.arcs.push({ x: h.x, y: h.y, ang, r: R, t: 0, color });
        sfx('slash', 0.08);
        w.cd = 0.85 * cdMul;
      } else if (k === 'shot') {
        const t = this.nearest(h.x, h.y, 540);
        if (!t) {
          w.cd = 0.12;
          continue;
        }
        const n = 1 + (s.lv >= 3 ? 1 : 0) + (s.lv >= 5 ? 1 : 0);
        const base = Math.atan2(t.y - h.y, t.x - h.x);
        for (let i = 0; i < n; i++) {
          const a = base + (i - (n - 1) / 2) * 0.14;
          this.shots.push({
            x: h.x, y: h.y, vx: Math.cos(a) * 740, vy: Math.sin(a) * 740, r: 7, dmg, pierce: Math.floor(s.lv / 2),
            life: 0.75, type: 'bullet', color, hit: new Set(), target: null, blast: 0, kb: 40, ox: h.x, oy: h.y,
          });
        }
        sfx('shot', 0.07);
        w.cd = 0.5 * cdMul;
      } else if (k === 'magic') {
        const t = this.nearest(h.x, h.y, 600);
        if (!t) {
          w.cd = 0.12;
          continue;
        }
        const n = 1 + (s.lv >= 4 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const a = Math.atan2(t.y - h.y, t.x - h.x) + (i ? 0.6 : 0) + (Math.random() - 0.5) * 0.3;
          this.shots.push({
            x: h.x, y: h.y, vx: Math.cos(a) * 390, vy: Math.sin(a) * 390, r: 10, dmg: dmg * 1.25, pierce: 0,
            life: 2, type: 'orb', color, hit: new Set(), target: t, blast: 50 + s.lv * 6, kb: 30, ox: h.x, oy: h.y,
          });
        }
        sfx('magic', 0.1);
        w.cd = 1.05 * cdMul;
      } else if (k === 'beast') {
        const t = this.nearest(h.x, h.y, 520);
        if (!t) {
          w.cd = 0.2;
          continue;
        }
        const a = Math.atan2(t.y - h.y, t.x - h.x);
        this.shots.push({
          x: h.x - Math.cos(a) * 30, y: h.y - Math.sin(a) * 30, vx: Math.cos(a) * 640, vy: Math.sin(a) * 640, r: 30,
          dmg: dmg * 2.2, pierce: 99, life: 1.1, type: 'beast', url: s.ext.img, color, hit: new Set(), target: null,
          blast: 0, kb: 220, ox: h.x, oy: h.y,
        });
        sfx('beast', 0.15);
        w.cd = (2.7 - s.lv * 0.22) * cdMul;
      } else if (k === 'aura') {
        const R = 118 + s.lv * 13;
        let any = false;
        for (const e of this.enemies) {
          if (e.dead || e.asleep) continue;
          if (dist2(h.x, h.y, e.x, e.y) < (R + e.r) ** 2) {
            any = true;
            this.hitEnemy(e, dmg * 0.9, 0, 0);
            e.slow = 1.2;
          }
        }
        for (const b of this.ebullets) if (dist2(h.x, h.y, b.x, b.y) < R * R) b.life = 0;
        if (!any) {
          w.cd = 0.25;
          continue;
        }
        this.rings.push({ x: h.x, y: h.y, r: 10, max: R, t: 0, color });
        sfx('aura', 0.12);
        w.cd = 1.7 * cdMul;
      }
    }
  }

  private stepShots(dt: number): void {
    const view = this.vw * 0.75 + 200;
    for (const s of this.shots) {
      s.life -= dt;
      if (s.type === 'orb' && s.target) {
        if (s.target.dead) s.target = this.nearest(s.x, s.y, 400);
        if (s.target) {
          const a = Math.atan2(s.target.y - s.y, s.target.x - s.x);
          const sp = Math.hypot(s.vx, s.vy) + 500 * dt;
          const cur = Math.atan2(s.vy, s.vx);
          let da = a - cur;
          da = Math.atan2(Math.sin(da), Math.cos(da));
          const na = cur + clamp(da, -7 * dt, 7 * dt);
          s.vx = Math.cos(na) * sp;
          s.vy = Math.sin(na) * sp;
        }
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.type !== 'beast' && this.blocked(s.x, s.y)) {
        s.life = 0;
        this.puff(s.x, s.y, s.color, 3);
        continue;
      }
      if (Math.abs(s.x - this.hero.x) > view + 300) s.life = 0;
      for (const e of this.enemies) {
        if (e.dead || e.asleep || s.hit.has(e)) continue;
        if (dist2(s.x, s.y, e.x, e.y) < (s.r + e.r) ** 2) {
          s.hit.add(e);
          const sp = Math.hypot(s.vx, s.vy) || 1;
          if (s.blast > 0) {
            this.blast(s.x, s.y, s.blast, s.dmg, s.color);
            s.life = 0;
            break;
          }
          this.hitEnemy(e, s.dmg, (s.vx / sp) * s.kb, (s.vy / sp) * s.kb);
          if (s.pierce-- <= 0) {
            s.life = 0;
            break;
          }
        }
      }
    }
    this.shots = this.shots.filter((s) => s.life > 0);
  }

  blast(x: number, y: number, r: number, dmg: number, color: string): void {
    for (const e of this.enemies) {
      if (e.dead || e.asleep) continue;
      if (dist2(x, y, e.x, e.y) < (r + e.r) ** 2) this.hitEnemy(e, dmg, (e.x - x) * 0.8, (e.y - y) * 0.8);
    }
    this.rings.push({ x, y, r: 6, max: r, t: 0, color });
    this.puff(x, y, color, 8);
  }

  hitEnemy(e: Enemy, dmg: number, kx: number, ky: number): void {
    if (e.dead) return;
    const crit = Math.random() < 0.08;
    const d = Math.max(1, Math.round(dmg * (crit ? 1.8 : 1) * (0.9 + Math.random() * 0.2)));
    e.hp -= d;
    e.flash = 0.1;
    const res = e.boss ? 0.05 : e.elite ? 0.3 : 1;
    e.kx += kx * res;
    e.ky += ky * res;
    if (this.floats.length < 60) {
      this.floats.push({
        x: e.x + (Math.random() - 0.5) * 20, y: e.y - e.size * 0.4, text: String(d),
        color: crit ? '#ffe45c' : '#ffffff', t: 0, big: crit,
      });
    }
    sfx('hit', 0.05);
    if (e.hp <= 0) this.kill(e);
  }

  private kill(e: Enemy): void {
    e.dead = true;
    this.run.kills += 1;
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

  hurtHero(dmg: number, fromX?: number, fromY?: number): void {
    const h = this.hero;
    if (h.inv > 0 || this.finished) return;
    h.hp -= dmg;
    h.inv = 0.7;
    this.shake = Math.max(this.shake, 8);
    sfx('hurt');
    this.host.hud.hurt();
    if (fromX !== undefined && fromY !== undefined) {
      const a = Math.atan2(h.y - fromY, h.x - fromX);
      h.vx += Math.cos(a) * 260;
      h.vy += Math.sin(a) * 260;
    }
    if (h.hp <= 0) this.down();
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
      boss: false, elite: false, dead: false, face: 1, ax: x, ay: y, tier: 0, asleep: false, ...o,
    };
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
      const dx = h.x - e.x;
      const dy = h.y - e.y;
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
      if (d < e.r + h.r - 2) this.hurtHero(e.dmg, e.x, e.y);
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
      else if (dist2(b.x, b.y, h.x, h.y) < (b.r + h.r - 4) ** 2) {
        b.life = 0;
        this.hurtHero(b.dmg, b.x - b.vx, b.y - b.vy);
      }
    }
    this.ebullets = this.ebullets.filter((b) => b.life > 0);
  }

  private stepLoot(dt: number): void {
    const h = this.hero;
    for (const g of this.gems) {
      g.t += dt;
      const d2 = dist2(g.x, g.y, h.x, h.y);
      if (d2 < 130 * 130 || g.t > 6) {
        const d = Math.sqrt(d2) || 1;
        const sp = 520 + g.t * 200;
        g.x += ((h.x - g.x) / d) * sp * dt;
        g.y += ((h.y - g.y) / d) * sp * dt;
      }
      if (d2 < 24 * 24) {
        g.v = -g.v;
        sfx('gem', 0.03);
        if (addXp(this.run, -g.v)) this.levelUp();
      }
    }
    this.gems = this.gems.filter((g) => g.v > 0);
    for (const p of this.pickups) {
      p.t += dt;
      if (!p.taken && dist2(p.x, p.y, h.x, h.y) < 40 * 40) {
        p.taken = true;
        this.gain(p.ext, p.x, p.y);
      }
    }
    this.pickups = this.pickups.filter((p) => !p.taken);
  }

  protected levelUp(): void {
    const h = this.hero;
    h.hp = Math.min(h.maxHp, h.hp + h.maxHp * 0.12);
    sfx('levelup');
    this.floats.push({ x: h.x, y: h.y - 50, text: `LEVEL ${this.run.level}`, color: '#7dffb0', t: 0, big: true });
    this.rings.push({ x: h.x, y: h.y, r: 10, max: 90, t: 0, color: '#7dffb0' });
  }

  /** Takes a piece of gear and tells the player what it became. */
  gain(ext: Ext, x: number, y: number): void {
    const res = takeExt(this.run, ext);
    img(res.slot.ext.img);
    const h = this.hero;
    const extra = this.fullHp() - h.maxHp;
    if (extra > 0) {
      h.maxHp += extra;
      h.hp += extra;
    }
    h.regen = armorRegen(this.run);
    sfx('pickup');
    sample('buff', 0.35);
    const label = res.kind === 'new' ? 'GET!' : res.kind === 'up' ? `Lv${res.slot.lv}` : 'MAX';
    this.floats.push({ x, y: y - 30, text: `${res.slot.ext.seriesName} ${label}`, color: RARITY_COLOR[ext.rarity], t: 0, big: true });
    this.rings.push({ x, y, r: 6, max: 60, t: 0, color: RARITY_COLOR[ext.rarity] });
    this.host.hud.slots(this.run.slots, res.slot);
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
  sprite(g: CanvasRenderingContext2D, url: string, x: number, y: number, size: number, flip: boolean, flash = false): void {
    const im = img(url);
    if (!ready(im)) return;
    const src: CanvasImageSource = flash ? whiteOf(url) ?? im : im;
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

    // loot
    const ce = img(cat.icons.ce);
    for (const gm of this.gems) {
      if (!seen(gm.x, gm.y)) continue;
      if (ready(ce)) g.drawImage(ce, gm.x - 9, gm.y - 9, 18, 18);
    }
    for (const p of this.pickups) {
      if (!seen(p.x, p.y)) continue;
      const bob = Math.sin(p.t * 4) * 4;
      g.globalAlpha = 0.28 + Math.sin(p.t * 6) * 0.08;
      g.fillStyle = RARITY_COLOR[p.ext.rarity];
      g.beginPath();
      g.arc(p.x, p.y + 4, 30, 0, TAU);
      g.fill();
      g.globalAlpha = 1;
      g.strokeStyle = KIND_COLOR[p.ext.kind];
      g.lineWidth = 3;
      g.beginPath();
      g.arc(p.x, p.y + 4, 30, p.t * 2, p.t * 2 + 4.4);
      g.stroke();
      this.sprite(g, p.ext.img, p.x, p.y + bob, 48, false);
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

    // the hero
    const blink = h.inv > 0 && Math.floor(this.time * 20) % 2 === 0;
    if (this.shadows) {
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.beginPath();
      g.ellipse(h.x, h.y + 26, 20, 7, 0, 0, TAU);
      g.fill();
    }
    this.drawHero(g, blink);

    // orbiting gear
    for (const s of this.run.slots) {
      if (s.ext.kind !== 'orbit') continue;
      const w = this.wstate.get(s.ext.series);
      if (!w) continue;
      const n = 1 + Math.floor((s.lv + 1) / 2);
      const R = 74 + s.lv * 4;
      for (let i = 0; i < n; i++) {
        const a = w.ang + (i / n) * TAU;
        this.sprite(g, s.ext.img, h.x + Math.cos(a) * R, h.y + Math.sin(a) * R, 34, false);
      }
    }

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

    // the player's shots
    for (const s of this.shots) {
      if (s.type === 'beast' && s.url) {
        g.globalAlpha = 0.35;
        this.sprite(g, s.url, s.x - s.vx * 0.04, s.y - s.vy * 0.04, 64, s.vx > 0);
        g.globalAlpha = 1;
        this.sprite(g, s.url, s.x, s.y, 72, s.vx > 0);
      } else if (s.type === 'harpoon') {
        g.strokeStyle = 'rgba(255,255,255,0.35)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(h.x, h.y);
        g.lineTo(s.x, s.y);
        g.stroke();
        const sp = Math.hypot(s.vx, s.vy) || 1;
        g.strokeStyle = '#e9f6ff';
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(s.x - (s.vx / sp) * 26, s.y - (s.vy / sp) * 26);
        g.lineTo(s.x, s.y);
        g.stroke();
      } else if (s.type === 'orb') {
        g.fillStyle = s.color;
        g.globalAlpha = 0.35;
        g.beginPath();
        g.arc(s.x, s.y, s.r + 6, 0, TAU);
        g.fill();
        g.globalAlpha = 1;
        g.beginPath();
        g.arc(s.x, s.y, s.r, 0, TAU);
        g.fill();
        g.fillStyle = '#fff';
        g.beginPath();
        g.arc(s.x, s.y, s.r * 0.45, 0, TAU);
        g.fill();
      } else {
        const sp = Math.hypot(s.vx, s.vy) || 1;
        g.strokeStyle = s.color;
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(s.x - (s.vx / sp) * 18, s.y - (s.vy / sp) * 18);
        g.lineTo(s.x, s.y);
        g.stroke();
        g.strokeStyle = '#fff';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(s.x - (s.vx / sp) * 8, s.y - (s.vy / sp) * 8);
        g.lineTo(s.x, s.y);
        g.stroke();
      }
    }

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
    const bob = h.moving ? Math.abs(Math.sin(h.bob)) * -4 : 0;
    this.sprite(g, this.heroArt.img, h.x, h.y + bob, 64, h.flip);
    g.globalAlpha = 1;
  }

  /** Screen-space extras (darkness, arrows). Drawn after the world, in view coordinates. */
  protected drawOverlay(_g: CanvasRenderingContext2D): void {}
}
