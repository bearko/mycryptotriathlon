// The ten weapons, by the way they behave. The hero never aims: the gear picks its own targets.
// (The boosts are folded into the numbers through `Boosts`.)

import { img, ready } from '../core/assets';
import { sfx } from '../core/audio';
import { clamp, dist2, TAU } from '../core/util';
import { levelMul, type Boosts, type Slot } from '../game/run';
import { iconOf, type Tier } from '../game/roster';
import type { Arena, Enemy } from './arena';

/** The numbers of the sister title are for a smaller field and tougher crowds: scaled to this one. */
const DMG = 0.5;
const REACH = 1.35;
const FAST = 1.7;
const MAGIC = new Set(['book', 'broom', 'parrot', 'laser', 'snowman']);

interface Proj {
  x: number; y: number; vx: number; vy: number; r: number; dmg: number; pierce: number; life: number;
  icon: string | null; size: number; spin: number; rot: number; color: string; hit: Set<Enemy>;
  homing: number; kb: number; line: boolean;
}
interface Beam { ang: number; len: number; thick: number; t: number; dur: number; dmg: number; color: string; next: Map<Enemy, number> }
interface Bomb { x: number; y: number; t: number; fuse: number; radius: number; dmg: number; icon: string; color: string }
interface Drop { x: number; y: number; t: number; target: Enemy | null; dmg: number; aoeR: number; aoe: number; icon: string; color: string }
interface WState { cd: number; ang: number }

export class Arsenal {
  projs: Proj[] = [];
  beams: Beam[] = [];
  bombs: Bomb[] = [];
  drops: Drop[] = [];
  private st = new Map<string, WState>();

  /** A straight shot from outside the gear (the harpoon). */
  shoot(x: number, y: number, vx: number, vy: number, dmg: number, pierce: number, life: number): void {
    this.projs.push({ x, y, vx, vy, r: 9, dmg, pierce, life, icon: null, size: 0, spin: 0, rot: 0, color: '#e9f6ff', hit: new Set(), homing: 0, kb: 160, line: true });
  }

  private push(a: Arena, s: Slot, t: Tier, ang: number, speed: number, dmg: number, b: Boosts, o: Partial<Proj> = {}, ox = 0, oy = 0): void {
    const h = a.hero;
    const range = (t.range ?? 360) * REACH * b.range;
    this.projs.push({
      x: h.x + ox, y: h.y + oy, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, r: 9 + s.lv, dmg,
      pierce: (t.pierce ?? 0) + b.pierce, life: range / speed, icon: iconOf(s.def, s.lv), size: 26 + s.lv * 3, spin: 0, rot: ang,
      color: s.def.color, hit: new Set(), homing: 0, kb: 50, line: false, ...o,
    });
  }

  step(a: Arena, dt: number, armed: boolean): void {
    const h = a.hero;
    const b = a.boosts;
    const run = a.run;
    let fired = false;
    if (armed) {
      for (const s of run.slots) {
        if (!s.def.weapon) continue;
        const t = s.def.tiers[s.lv - 1];
        let w = this.st.get(s.def.id);
        if (!w) {
          w = { cd: 0.2 + Math.random() * 0.3, ang: Math.random() * TAU };
          this.st.set(s.def.id, w);
        }
        const mul = (MAGIC.has(s.def.id) ? a.traits.int : a.traits.phy) * levelMul(run.level) * b.dmg * (h.buffDmg > 0 ? 1 + h.buffAmt : 1);
        const dmg = (t.dmg ?? 10) * DMG * mul;
        const n = (t.bullets ?? 1) + b.bullets;
        const arch = s.def.arch;

        if (arch === 'orbit' || arch === 'orbitClose') {
          w.ang += dt * (arch === 'orbit' ? 2.1 : 4.6);
          const R = (t.orbitR ?? 60) * 1.2 * (arch === 'orbit' ? b.range : 1);
          for (let i = 0; i < n; i++) {
            const an = w.ang + (i / n) * TAU;
            const ox = h.x + Math.cos(an) * R;
            const oy = h.y + Math.sin(an) * R;
            for (const e of a.enemies) {
              if (e.dead || e.asleep || e.orbitCd > 0) continue;
              if (dist2(ox, oy, e.x, e.y) < (e.r + 15 + s.lv * 2) ** 2) {
                e.orbitCd = 0.25;
                a.hitEnemy(e, dmg, (e.x - h.x) * 0.6, (e.y - h.y) * 0.6);
              }
            }
            if (arch === 'orbit') for (const eb of a.ebullets) if (dist2(ox, oy, eb.x, eb.y) < 20 * 20) eb.life = 0;
          }
          continue;
        }

        w.cd -= dt;
        if (w.cd > 0) continue;
        const cd = ((t.cd ?? 1000) / 1000) * b.cd * a.st.cd / (0.85 + 0.15 * a.traits.agi);
        const range = (t.range ?? 360) * REACH * b.range;
        const speed = (t.speed ?? 300) * FAST;
        const near = a.nearest(h.x, h.y, range);

        if (arch === 'radial') {
          if (!near) { w.cd = 0.12; continue; }
          const base = Math.atan2(near.y - h.y, near.x - h.x);
          const spread = ((t.spread ?? 30) * Math.PI) / 180;
          for (let i = 0; i < n; i++) {
            const k = n <= 1 ? 0.5 : i / (n - 1);
            this.push(a, s, t, base - spread / 2 + spread * k, speed, dmg, b, { icon: null, r: 7, size: 0 });
          }
          sfx('shot', 0.07);
        } else if (arch === 'diagonal') {
          if (!a.nearest(h.x, h.y, range * 1.2)) { w.cd = 0.15; continue; }
          for (let i = 0; i < n; i++) {
            const ang = Math.PI / 4 + (i % 4) * (Math.PI / 2);
            const lane = Math.floor(i / 4);
            const off = (lane % 2 ? 1 : -1) * Math.ceil(lane / 2) * 16;
            this.push(a, s, t, ang, speed, dmg, b, {}, -Math.sin(ang) * off, Math.cos(ang) * off);
          }
          sfx('slash', 0.09);
        } else if (arch === 'randomRadial') {
          if (!a.nearest(h.x, h.y, range * 1.2)) { w.cd = 0.15; continue; }
          for (let i = 0; i < n; i++) this.push(a, s, t, Math.random() * TAU, speed, dmg, b, { spin: 9, pierce: 1 + b.pierce, r: 12 + s.lv, size: 30 + s.lv * 3, kb: 110 });
          sfx('beast', 0.2);
        } else if (arch === 'stack') {
          if (!near) { w.cd = 0.12; continue; }
          const base = Math.atan2(near.y - h.y, near.x - h.x);
          const dirs = (t.dirs ?? 1) + Math.floor(b.bullets / 2);
          for (let d = 0; d < dirs; d++) {
            const ang = base + (d / dirs) * TAU;
            for (let k = 0; k < 3; k++) this.push(a, s, t, ang, speed, dmg, b, { spin: 14, r: 8, size: 22 + s.lv * 2 }, -Math.cos(ang) * k * 20, -Math.sin(ang) * k * 20);
          }
          sfx('shot', 0.07);
        } else if (arch === 'bigHoming') {
          if (!near) { w.cd = 0.15; continue; }
          for (let i = 0; i < n; i++) {
            const ang = Math.atan2(near.y - h.y, near.x - h.x) + (i - (n - 1) / 2) * 0.7;
            const size = (t.size ?? 14) * 3;
            this.push(a, s, t, ang, speed, dmg, b, { homing: 3.2, life: 4.5, r: size * 0.45, size, kb: 120 });
          }
          sfx('magic', 0.12);
        } else if (arch === 'dropTarget') {
          const cands = a.enemies.filter((e) => !e.dead && !e.asleep && dist2(e.x, e.y, h.x, h.y) < range * range);
          if (!cands.length) { w.cd = 0.15; continue; }
          for (let i = 0; i < n; i++) {
            const e = cands[Math.floor(Math.random() * cands.length)];
            this.drops.push({ x: e.x, y: e.y, t: -i * 0.08, target: e, dmg, aoeR: (t.aoeR ?? 60) * 1.25 * b.range, aoe: t.aoe ?? 0.7, icon: iconOf(s.def, s.lv), color: s.def.color });
          }
          sfx('magic', 0.12);
        } else if (arch === 'beam') {
          if (!near) { w.cd = 0.15; continue; }
          const base = Math.atan2(near.y - h.y, near.x - h.x);
          for (let i = 0; i < n; i++) {
            this.beams.push({ ang: base + (i ? (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.5 : 0), len: (t.len ?? 600) * b.range, thick: (t.thick ?? 6) * 2.4, t: 0, dur: (t.dur ?? 600) / 1000, dmg, color: s.def.color, next: new Map() });
          }
          sfx('laser', 0.1);
        } else if (arch === 'placeBomb') {
          if (!a.nearest(h.x, h.y, 420)) { w.cd = 0.2; continue; }
          for (let i = 0; i < n; i++) {
            const an = Math.random() * TAU;
            const d = i ? 40 + Math.random() * 50 : 0;
            this.bombs.push({ x: h.x + Math.cos(an) * d, y: h.y + Math.sin(an) * d, t: 0, fuse: (t.fuse ?? 1000) / 1000, radius: (t.radius ?? 60) * 1.5 * b.range, dmg, icon: iconOf(s.def, s.lv), color: s.def.color });
          }
        }
        w.cd = cd;
        fired = true;
      }
    }
    // "after using an active skill": the gear going off is this game's active skill
    if (fired) a.passive(h, 'skill');

    for (const p of this.projs) {
      p.life -= dt;
      if (p.homing > 0) {
        const t = a.nearest(p.x, p.y, 520);
        if (t && !p.hit.has(t)) {
          const want = Math.atan2(t.y - p.y, t.x - p.x);
          const cur = Math.atan2(p.vy, p.vx);
          let da = want - cur;
          da = Math.atan2(Math.sin(da), Math.cos(da));
          const na = cur + clamp(da, -p.homing * dt, p.homing * dt);
          const sp = Math.hypot(p.vx, p.vy);
          p.vx = Math.cos(na) * sp;
          p.vy = Math.sin(na) * sp;
        }
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot = p.spin ? p.rot + p.spin * dt : Math.atan2(p.vy, p.vx);
      if (p.homing <= 0 && a.isBlocked(p.x, p.y)) {
        p.life = 0;
        a.puff(p.x, p.y, p.color, 3);
        continue;
      }
      for (const e of a.enemies) {
        if (e.dead || e.asleep || p.hit.has(e)) continue;
        if (dist2(p.x, p.y, e.x, e.y) < (p.r + e.r) ** 2) {
          p.hit.add(e);
          const sp = Math.hypot(p.vx, p.vy) || 1;
          a.hitEnemy(e, p.dmg, (p.vx / sp) * p.kb, (p.vy / sp) * p.kb);
          if (p.pierce-- <= 0) {
            p.life = 0;
            break;
          }
        }
      }
    }
    this.projs = this.projs.filter((p) => p.life > 0);

    for (const bm of this.beams) {
      bm.t += dt;
      const cx = Math.cos(bm.ang);
      const cy = Math.sin(bm.ang);
      for (const e of a.enemies) {
        if (e.dead || e.asleep) continue;
        const dx = e.x - h.x;
        const dy = e.y - h.y;
        const along = dx * cx + dy * cy;
        if (along < 0 || along > bm.len) continue;
        if (Math.abs(dx * cy - dy * cx) > bm.thick + e.r) continue;
        if ((bm.next.get(e) ?? 0) > bm.t) continue;
        bm.next.set(e, bm.t + 0.25);
        a.hitEnemy(e, bm.dmg * 0.25, cx * 20, cy * 20);
      }
    }
    this.beams = this.beams.filter((bm) => bm.t < bm.dur);

    for (const bo of this.bombs) {
      bo.t += dt;
      if (bo.t >= bo.fuse) {
        a.blast(bo.x, bo.y, bo.radius, bo.dmg, bo.color);
        sfx('kill', 0.08);
      }
    }
    this.bombs = this.bombs.filter((bo) => bo.t < bo.fuse);

    for (const d of this.drops) {
      d.t += dt;
      if (d.target && !d.target.dead) {
        d.x = d.target.x;
        d.y = d.target.y;
      }
      if (d.t >= 0.45) {
        if (d.target && !d.target.dead) a.hitEnemy(d.target, d.dmg, 0, 0);
        a.blast(d.x, d.y, d.aoeR, d.dmg * d.aoe, d.color);
      }
    }
    this.drops = this.drops.filter((d) => d.t < 0.45);
  }

  private icon(g: CanvasRenderingContext2D, url: string, x: number, y: number, size: number, rot: number): void {
    const im = img(url);
    if (!ready(im)) return;
    g.save();
    g.translate(Math.round(x), Math.round(y));
    g.rotate(rot);
    g.drawImage(im, -size / 2, -size / 2, size, size);
    g.restore();
  }

  draw(a: Arena, g: CanvasRenderingContext2D): void {
    const h = a.hero;
    // orbiting gear
    for (const s of a.run.slots) {
      const arch = s.def.arch;
      if (arch !== 'orbit' && arch !== 'orbitClose') continue;
      const w = this.st.get(s.def.id);
      if (!w) continue;
      const t = s.def.tiers[s.lv - 1];
      const n = (t.bullets ?? 1) + a.boosts.bullets;
      const R = (t.orbitR ?? 60) * 1.2 * (arch === 'orbit' ? a.boosts.range : 1);
      const url = iconOf(s.def, s.lv);
      if (arch === 'orbitClose') {
        g.strokeStyle = `${s.def.color}55`;
        g.lineWidth = 10;
        g.beginPath();
        g.arc(h.x, h.y, R, w.ang, w.ang + 1.1);
        g.stroke();
      }
      for (let i = 0; i < n; i++) {
        const an = w.ang + (i / n) * TAU;
        this.icon(g, url, h.x + Math.cos(an) * R, h.y + Math.sin(an) * R, 30 + s.lv * 3, arch === 'orbitClose' ? an + Math.PI * 0.75 : 0);
      }
    }
    for (const bo of this.bombs) {
      const k = bo.t / bo.fuse;
      g.strokeStyle = bo.color;
      g.globalAlpha = 0.25 + k * 0.5;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(bo.x, bo.y, bo.radius * k, 0, TAU);
      g.stroke();
      g.globalAlpha = 1;
      this.icon(g, bo.icon, bo.x, bo.y - Math.abs(Math.sin(bo.t * 12)) * 4, 40, 0);
    }
    for (const bm of this.beams) {
      const k = bm.t / bm.dur;
      const w = bm.thick * (k < 0.15 ? k / 0.15 : k > 0.8 ? (1 - k) / 0.2 : 1);
      g.save();
      g.translate(h.x, h.y);
      g.rotate(bm.ang);
      g.fillStyle = bm.color;
      g.globalAlpha = 0.45;
      g.fillRect(10, -w, bm.len, w * 2);
      g.globalAlpha = 1;
      g.fillStyle = '#ffffff';
      g.fillRect(10, -w * 0.4, bm.len, w * 0.8);
      g.restore();
    }
    for (const p of this.projs) {
      if (p.line) {
        g.strokeStyle = 'rgba(255,255,255,0.35)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(h.x, h.y);
        g.lineTo(p.x, p.y);
        g.stroke();
      }
      if (p.icon) {
        this.icon(g, p.icon, p.x, p.y, p.size, p.spin ? p.rot : p.rot + Math.PI * 0.75);
      } else {
        const sp = Math.hypot(p.vx, p.vy) || 1;
        g.strokeStyle = p.color;
        g.lineWidth = 6;
        g.beginPath();
        g.moveTo(p.x - (p.vx / sp) * 18, p.y - (p.vy / sp) * 18);
        g.lineTo(p.x, p.y);
        g.stroke();
        g.strokeStyle = '#fff';
        g.lineWidth = 2.5;
        g.beginPath();
        g.moveTo(p.x - (p.vx / sp) * 9, p.y - (p.vy / sp) * 9);
        g.lineTo(p.x, p.y);
        g.stroke();
      }
    }
    for (const d of this.drops) {
      if (d.t < 0) continue;
      const k = d.t / 0.45;
      g.strokeStyle = d.color;
      g.globalAlpha = 0.5;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(d.x, d.y, d.aoeR * (1 - k * 0.5), 0, TAU);
      g.stroke();
      g.globalAlpha = 1;
      this.icon(g, d.icon, d.x, d.y - (1 - k) * 220, 40, 0);
    }
  }
}
