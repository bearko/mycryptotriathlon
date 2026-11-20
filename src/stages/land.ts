// LAND: run to the goal on the right. Gear lies along the road; pick it up, let it fight, and break
// through two checkpoints and the last guardian as fast as possible.

import { sample, sfx } from '../core/audio';
import { cat, type EnemyArt } from '../core/catalog';
import { input } from '../core/input';
import { clamp, dist2, hash2, mixColor, TAU } from '../core/util';
import { rollExt, xpNeed } from '../game/run';
import { Arena, type Enemy } from './arena';
import type { Host } from './stage';

const LEN = 10500;
const H = 1000;
const TOP = 70;
const BOTTOM = 930;
const GOAL = LEN;

interface Gate { x: number; open: boolean; boss: Enemy | null; called: boolean; art: EnemyArt; hp: number; size: number; tier: number }
interface Decor { x: number; y: number; kind: number; s: number }

const GROUND: [number, number, number][] = [[58, 122, 74], [156, 132, 78], [74, 62, 112]];
const ROAD: [number, number, number][] = [[196, 176, 124], [206, 180, 130], [120, 108, 150]];

export class LandStage extends Arena {
  private gates: Gate[];
  private decor: Decor[] = [];
  private spawnT = 1.2;
  private pattern: CanvasPattern | null = null;
  private said = false;

  constructor(host: Host) {
    super(host, 0, 11);
    const en = cat.enemies;
    this.gates = [
      { x: 3500, open: false, boss: null, called: false, art: en.ghost[0], hp: 620, size: 112, tier: 0 },
      { x: 7000, open: false, boss: null, called: false, art: en.ghost[1], hp: 1350, size: 124, tier: 1 },
      { x: GOAL - 110, open: false, boss: null, called: false, art: en.landBoss[0], hp: 2700, size: 176, tier: 2 },
    ];
    this.hero.x = 170;
    this.hero.y = H / 2;
    this.hero.flip = true;

    // gear on the road: off the centre line, so taking it is a choice
    const rng = this.rng;
    for (let i = 0; i < 17; i++) {
      const x = 340 + i * 600 + (rng() - 0.5) * 160;
      if (this.gates.some((gt) => Math.abs(gt.x - x) < 200)) continue;
      const side = rng() < 0.5 ? -1 : 1;
      const y = H / 2 + side * (110 + rng() * 260);
      this.pickups.push({ x, y, ext: rollExt(this.run, rng, (x / LEN) * 0.5), t: rng() * 6, taken: false });
    }
    for (let i = 0; i < 400; i++) {
      const y = TOP + rng() * (BOTTOM - TOP);
      if (Math.abs(y - H / 2) < 130 && rng() < 0.8) continue;
      this.decor.push({ x: rng() * (LEN + 400), y, kind: Math.floor(rng() * 4), s: 0.7 + rng() * 0.9 });
    }
    this.decor.sort((a, b) => a.x - b.x);

    // a speckle tile laid over the flat ground colour
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

    host.hud.slots(this.run.slots);
    host.hud.objective('エクステンションを拾って、ゴールまで駆け抜けろ');
    this.follow(1);
  }

  private follow(k: number): void {
    const h = this.hero;
    const tx = clamp(h.x - this.vw * 0.38, 0, LEN + 260 - this.vw);
    const ty = clamp(h.y - this.vh / 2, 0, H - this.vh);
    this.camX += (tx - this.camX) * k;
    this.camY += (ty - this.camY) * k;
  }

  private nextGate(): Gate | undefined {
    return this.gates.find((g) => !g.open);
  }

  protected moveBody(b: { x: number; y: number; r: number }, dx: number, dy: number): void {
    b.x += dx;
    b.y = clamp(b.y + dy, TOP + b.r, BOTTOM - b.r);
    if (b === this.hero) {
      const gate = this.nextGate();
      const max = gate ? gate.x - 26 : GOAL + 200;
      b.x = clamp(b.x, 30, max);
    } else {
      b.x = clamp(b.x, -200, LEN + 300);
    }
  }

  protected tick(dt: number): void {
    const h = this.hero;
    const hud = this.host.hud;
    if (input.aPressed) this.dash();
    this.follow(1 - Math.pow(0.001, dt));

    const prog = clamp(h.x / LEN, 0, 1);
    const gate = this.nextGate();

    // the checkpoint guardians
    if (gate && !gate.called && h.x > gate.x - 560) {
      gate.called = true;
      gate.boss = this.spawn({ url: gate.art.img, name: gate.art.name }, gate.x - 120, H / 2, {
        hp: gate.hp, size: gate.size, r: gate.size * 0.3, speed: 70 + gate.tier * 8, dmg: 14 + gate.tier * 3,
        ai: 'boss', boss: true, xp: 30 + gate.tier * 20, tier: gate.tier, timer: 1.4,
      });
      this.bossRef = gate.boss;
      sfx('warn');
      hud.banner('WARNING', `${gate.art.name} が立ちふさがる`, 'warn');
      hud.objective(gate.tier === 2 ? '最後の番人を倒せ！' : '関門の番人を倒せ！');
    }

    // the crowd: mostly ahead of the runner, sometimes from behind
    this.spawnT -= dt;
    const fighting = !!(gate && gate.boss && !gate.boss.dead);
    if (this.spawnT <= 0 && this.enemies.length < 105) {
      this.spawnT = (fighting ? 1.7 : 1.0) - prog * 0.42;
      const n = Math.round((fighting ? 2 : 3) + prog * 3.4);
      const behind = this.rng() < 0.22;
      const baseX = behind ? this.camX - 70 : this.camX + this.vw + 70;
      const limit = gate ? gate.x - 80 : LEN;
      const cy = clamp(h.y + (this.rng() - 0.5) * 520, TOP + 40, BOTTOM - 40);
      for (let i = 0; i < n; i++) {
        const x = Math.min(baseX + (this.rng() - 0.5) * 120, limit + (behind ? 0 : this.rng() * 30));
        if (!behind && x < this.camX + this.vw - 40 && !fighting) continue;
        this.mob(x, clamp(cy + (this.rng() - 0.5) * 220, TOP + 30, BOTTOM - 30), prog);
      }
    }

    if (h.x >= GOAL) {
      this.finished = true;
      sample('clear', 0.7);
    }

    hud.gauge(clamp(h.hp / h.maxHp, 0, 1), `${Math.max(0, Math.ceil(h.hp))}`);
    hud.sub(1 - h.dashCd / 1.4);
    hud.progress(prog, [3500 / LEN, 7000 / LEN]);
    hud.level(this.run.level, this.run.xp / xpNeed(this.run.level));
    const b = this.bossRef;
    hud.boss(b && !b.dead ? b.name : null, b ? b.hp / b.maxHp : 0);
    if (!this.said && this.time > 0.5) this.said = true;
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
        hp: 240 * hpMul * 0.5, size: 88, r: 26, speed: 82, dmg: 13, ai: 'burst', elite: true, xp: 12, tier, timer: 2,
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
    const h = this.hero;
    const dx = h.x - e.x;
    const dy = h.y - e.y;
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
        if (e.tier >= 1) {
          for (let i = -1; i <= 1; i++) this.fire(e.x, e.y, Math.atan2(dy, dx) + i * 0.22, 260, e.dmg, '#ffb35c', 9);
          if (this.enemies.length < 90) {
            for (let i = 0; i < 2 + e.tier; i++) {
              const a = this.rng() * TAU;
              this.mob(e.x + Math.cos(a) * 90, e.y + Math.sin(a) * 90, 0.3 + e.tier * 0.3);
            }
          }
        }
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
    const gate = this.nextGate();
    if (gate) e.x = clamp(e.x, gate.x - 760, gate.x - 60);
  }

  protected killed(e: Enemy): void {
    const gate = this.gates.find((g) => g.boss === e);
    if (!gate) {
      // elites sometimes carry gear
      if (e.elite && this.rng() < 0.5) {
        this.pickups.push({ x: e.x, y: e.y, ext: rollExt(this.run, this.rng, 0.6), t: 0, taken: false });
      }
      return;
    }
    gate.open = true;
    this.bossRef = null;
    this.ebullets.length = 0;
    const h = this.hero;
    h.hp = Math.min(h.maxHp, h.hp + h.maxHp * 0.35);
    sfx('gate');
    sample('heal', 0.5);
    if (gate.tier < 2) {
      this.pickups.push({ x: e.x, y: e.y, ext: rollExt(this.run, this.rng, 0.8), t: 0, taken: false });
      this.host.hud.banner('関門突破！', '', 'good');
      this.host.hud.objective('エクステンションを拾って、ゴールまで駆け抜けろ');
    } else {
      // the way is clear: sweep the stragglers so the last sprint is clean
      for (const o of this.enemies) if (!o.dead && o !== e) o.hp = 0, (o.dead = true), this.puff(o.x, o.y, '#fff', 5);
      this.host.hud.banner('GOAL へ！', '', 'good');
      this.host.hud.objective('ゴールラインへ！');
    }
  }

  protected onDown(): void {
    this.host.hud.banner('ダウン！', '', 'warn');
  }

  // ------------------------------------------------------------------ drawing
  private groundAt(x: number, table: [number, number, number][]): string {
    const t = x / 3500;
    const i = clamp(Math.floor(t), 0, 2);
    const f = t - i;
    // blend across the last 300px of each section
    const k = i < 2 ? clamp((f - 0.9) / 0.1, 0, 1) : 0;
    return mixColor(table[i], table[Math.min(2, i + 1)], k);
  }

  protected drawBack(g: CanvasRenderingContext2D): void {
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
    // road edges and centre dashes
    g.fillStyle = 'rgba(0,0,0,0.14)';
    g.fillRect(this.camX - 20, H / 2 - 109, this.vw + 40, 4);
    g.fillRect(this.camX - 20, H / 2 + 105, this.vw + 40, 4);
    g.fillStyle = 'rgba(255,255,255,0.4)';
    for (let x = Math.floor(this.camX / 120) * 120; x < x1; x += 120) g.fillRect(x, H / 2 - 3, 60, 6);

    // distance boards
    g.font = '20px DotGothic16, sans-serif';
    g.textAlign = 'center';
    for (let x = Math.ceil(this.camX / 1000) * 1000; x < x1; x += 1000) {
      if (x <= 0 || x >= GOAL) continue;
      g.fillStyle = 'rgba(20,20,30,0.75)';
      g.fillRect(x - 44, H / 2 - 160, 88, 32);
      g.fillStyle = '#ffe9a8';
      g.fillText(`${Math.round((GOAL - x) / 3.5)}m`, x, H / 2 - 137);
    }

    // hedges at the edge of the course
    g.fillStyle = '#1f3d2b';
    g.fillRect(this.camX - 20, 0, this.vw + 40, TOP - 14);
    g.fillRect(this.camX - 20, BOTTOM + 14, this.vw + 40, H - BOTTOM);
    g.fillStyle = '#2f5a3c';
    for (let x = Math.floor(this.camX / 44) * 44; x < x1; x += 44) {
      g.beginPath();
      g.arc(x + 22, TOP - 16, 24, 0, TAU);
      g.arc(x + 22, BOTTOM + 18, 24, 0, TAU);
      g.fill();
    }

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

    // start / goal lines
    this.checker(g, 110);
    this.checker(g, GOAL);
    g.fillStyle = '#ffe45c';
    g.font = '28px "Dela Gothic One", DotGothic16, sans-serif';
    g.fillText('GOAL', GOAL + 12, TOP + 40);

    // gates
    for (const gt of this.gates) {
      if (gt.x < this.camX - 100 || gt.x > x1) continue;
      for (const y of [TOP - 6, BOTTOM + 6]) {
        g.fillStyle = '#3a3550';
        g.fillRect(gt.x - 16, y - 36, 32, 72);
        g.fillStyle = gt.open ? '#6dffa0' : '#ff5c7a';
        g.fillRect(gt.x - 8, y - 10, 16, 16);
      }
      if (!gt.open) {
        const t = this.time;
        g.globalAlpha = 0.25;
        g.fillStyle = '#ff5c7a';
        g.fillRect(gt.x - 10, TOP, 20, BOTTOM - TOP);
        g.globalAlpha = 0.9;
        for (let y = TOP + ((t * 160) % 40); y < BOTTOM; y += 40) g.fillRect(gt.x - 3, y, 6, 22);
        g.globalAlpha = 1;
      }
    }
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
    // arrows to gear that is just off the screen, so a detour is a decision and not a surprise
    const h = this.hero;
    for (const p of this.pickups) {
      const sx = p.x - this.camX;
      const sy = p.y - this.camY;
      if (sx > 0 && sx < this.vw && sy > 0 && sy < this.vh) continue;
      if (p.x < h.x - 200 || p.x > h.x + this.vw) continue;
      const ax = clamp(sx, 26, this.vw - 26);
      const ay = clamp(sy, 70, this.vh - 26);
      g.globalAlpha = 0.85;
      this.sprite(g, p.ext.img, ax, ay, 28, false);
      g.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------------------ debug bot
  botStep(): { x: number; y: number; a: boolean; b: boolean } {
    const h = this.hero;
    let x = 1;
    let y = 0;
    const b = this.bossRef && !this.bossRef.dead ? this.bossRef : null;
    if (b) {
      // circle the guardian at a safe distance
      const dx = h.x - b.x;
      const dy = h.y - b.y;
      const d = Math.hypot(dx, dy) || 1;
      const k = d < 210 ? 1 : d > 290 ? -1 : 0;
      x = (dx / d) * k - (dy / d);
      y = (dy / d) * k + (dx / d);
      if (h.y < TOP + 80) y = 1;
      if (h.y > BOTTOM - 80) y = -1;
    } else {
      let best = null as null | { x: number; y: number };
      let bd = 520 * 520;
      for (const p of this.pickups) {
        if (p.x < h.x - 60) continue;
        const d = dist2(p.x, p.y, h.x, h.y);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      if (best) {
        x = best.x - h.x;
        y = best.y - h.y;
      } else {
        y = (H / 2 - h.y) / 200;
      }
    }
    // step away from the closest threat
    for (const e of this.enemies) {
      if (e.dead || e === b) continue;
      const d2 = dist2(e.x, e.y, h.x, h.y);
      if (d2 < 80 * 80) {
        const d = Math.sqrt(d2) || 1;
        x += ((h.x - e.x) / d) * 1.4;
        y += ((h.y - e.y) / d) * 1.4;
      }
    }
    const l = Math.hypot(x, y) || 1;
    return { x: x / l, y: y / l, a: !b && this.hero.dashCd <= 0 && Math.random() < 0.05, b: false };
  }
}
