// SEA: thirty teams dive for the treasure at the bottom; there are only ten of them.
// Each depth is sealed by a gate, and every diver has to dig up that depth's relic for themselves to get through.
// Oxygen is the life bar and it is always running out: an empty tank means a few seconds out cold.

import { sample, sfx } from '../core/audio';
import { cat, type EnemyArt, type Hero } from '../core/catalog';
import { input } from '../core/input';
import { clamp, dist2, hash2, mixColor, rint, TAU } from '../core/util';
import { earn } from '../game/meta';
import { levelMul, xpNeed } from '../game/run';
import { Arena, makeRunner, type Enemy, type Runner } from './arena';
import type { Host } from './stage';

const T = 48;
const W = 30;
const HT = 140;
const GATE_ROWS = [42, 84, 122];
const ROOM_TOP = 123;
const ROOM_BOTTOM = 137;
const DRAIN = [1.3, 1.6, 1.9, 1.6];
const FIELD = 30;
const QUOTA = 10;
/** Rivals: how fast the slowest swims, how much faster the best is, and how quickly they dig. */
const PACE_MIN = 158;
const PACE_SPAN = 64;
const DIG_MIN = 0.6;
const DIG_SPAN = 0.6;

interface Dig {
  x: number; y: number; kind: 'chest' | 'relic' | 'treasure'; zone: number; prog: number; need: number; done: boolean;
  /** The row of the side tunnel that leads to it (relics). */
  row: number;
}
interface Gate { row: number; y: number; x0: number; x1: number; first: boolean }
interface Pt { x: number; y: number; dig: Dig | null }
/** A rival's route: the points still to swim through, and how the digging is going. */
interface Nav { pts: Pt[]; lane: number; dig: number; rate: number; stuck: number; zone: number }
interface Vent { x: number; y: number; cd: number }

const WATER: [number, number, number][] = [[32, 150, 190], [14, 74, 128], [8, 30, 66], [4, 10, 26]];
const ROCK: [number, number, number][] = [[70, 104, 110], [52, 66, 98], [40, 42, 78], [26, 24, 48]];

export function buildSea(rng: () => number) {
  const solid = new Uint8Array(W * HT).fill(1);
  const carve = (x: number, y: number) => {
    if (x >= 1 && x < W - 1 && y >= 0 && y < HT - 1) solid[y * W + x] = 0;
  };
  const path: number[] = [];
  const half: number[] = [];
  let cx = 15;
  let target = 15;
  for (let y = 0; y <= GATE_ROWS[2]; y++) {
    if (y < 3) {
      for (let x = 1; x < W - 1; x++) carve(x, y);
      path[y] = 15;
      half[y] = 12;
      continue;
    }
    if (y % 9 === 5) target = clamp(cx + (rng() < 0.5 ? -1 : 1) * rint(rng, 5, 9), 6, 23);
    if (cx < target) cx++;
    else if (cx > target) cx--;
    const nearGate = GATE_ROWS.some((g) => Math.abs(g - y) <= 1);
    const w = nearGate ? 3 : 3 + (rng() < 0.45 ? 1 : 0);
    for (let x = cx - w; x <= cx + w; x++) carve(x, y);
    path[y] = cx;
    half[y] = w;
  }
  // the last room
  for (let y = ROOM_TOP; y <= ROOM_BOTTOM; y++) {
    for (let x = 4; x <= 25; x++) carve(x, y);
    path[y] = 15;
    half[y] = 10;
  }
  const digs: Dig[] = [];
  const side = (row: number, len: number, roomW: number, roomH: number): { x: number; y: number } => {
    const c = path[row];
    const dir = c < 15 ? 1 : -1;
    const start = c + dir * half[row];
    const end = clamp(start + dir * len, 2 + roomW, W - 3 - roomW);
    for (let x = Math.min(start, end); x <= Math.max(start, end); x++) {
      carve(x, row);
      carve(x, row + 1);
    }
    for (let y = row + 1 - roomH + 1; y <= row + 1; y++) {
      for (let x = end - Math.floor(roomW / 2); x <= end + Math.floor(roomW / 2); x++) carve(x, y);
    }
    return { x: (end + 0.5) * T, y: (row + 2) * T - 6 };
  };
  const zoneTop = [5, GATE_ROWS[0] + 3, GATE_ROWS[1] + 3];
  for (let z = 0; z < 3; z++) {
    const top = zoneTop[z];
    const span = GATE_ROWS[z] - 4 - top;
    const relicRow = top + Math.floor(span * (0.52 + rng() * 0.2));
    const p = side(relicRow, 8, 5, 4);
    digs.push({ ...p, kind: 'relic', zone: z, prog: 0, need: 2.4, done: false, row: relicRow });
    for (const f of [0.12 + rng() * 0.1, 0.84 + rng() * 0.1]) {
      const row = top + Math.floor(span * f);
      if (Math.abs(row - relicRow) < 5) continue;
      const c = side(row, 5, 3, 3);
      digs.push({ ...c, kind: 'chest', zone: z, prog: 0, need: 0.8, done: false, row });
    }
  }
  // ten treasures on the floor of the last room: first come, first served
  for (let i = 0; i < QUOTA; i++) {
    digs.push({ x: (5.5 + i * 2.1) * T, y: (ROOM_BOTTOM + 1) * T - 6, kind: 'treasure', zone: 3, prog: 0, need: 2.2, done: false, row: ROOM_BOTTOM });
  }
  const gates: Gate[] = GATE_ROWS.map((row) => ({
    row, y: row * T, first: true, x0: (path[row] - half[row]) * T, x1: (path[row] + half[row] + 1) * T,
  }));
  return { solid, path, half, digs, gates };
}

export class SeaStage extends Arena {
  private solid: Uint8Array;
  private path: number[];
  private half: number[];
  private digs: Dig[];
  private gates: Gate[];
  private vents: Vent[] = [];
  private harpoonCd = 0;
  private digT = 0;
  private dark: HTMLCanvasElement;
  private boss: Enemy | null = null;
  private bossCalled = false;
  private relics: Dig[];
  private treasures: Dig[];
  private endY: number;
  private nav = new Map<Runner, Nav>();
  private passed = 0;
  private place = FIELD;
  private rankT = 0;
  private chatT = 6;
  private wasOut = false;
  /** Debug: when each rival took a treasure. */
  finishTimes: number[] = [];
  private bubbleT = 0;
  private botPath: number[] = [];
  private botT = 0;

  constructor(host: Host) {
    super(host, 1, 23);
    this.shadows = false;
    const m = buildSea(this.rng);
    this.solid = m.solid;
    this.path = m.path;
    this.half = m.half;
    this.digs = m.digs;
    this.gates = m.gates;
    this.relics = m.digs.filter((d) => d.kind === 'relic');
    this.treasures = m.digs.filter((d) => d.kind === 'treasure');
    this.endY = this.treasures[0].y;
    this.koMode = true;
    this.dark = document.createElement('canvas');

    const h = this.hero;
    h.x = 15 * T;
    h.y = 1.4 * T;
    h.regen *= 0.35;
    h.speed *= 0.92;
    h.r = 14;
    h.fy = 1;
    h.fx = 0;

    // the other twenty-nine teams
    const mine = new Set(this.run.heroes.map((x) => x.id));
    const pool: Hero[] = cat.heroes.filter((x) => !mine.has(x.id));
    for (let i = 0; i < FIELD - 1; i++) {
      const art = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      const r = makeRunner(art, false);
      const skill = i / (FIELD - 2);
      r.pace = (PACE_MIN + PACE_SPAN * skill + 16 * skill ** 3 + (Math.random() - 0.5) * 6) * (1 + this.st.rival);
      r.dps = 50 + 110 * skill;
      r.mood = Math.random();
      r.maxHp = r.hp = 150;
      r.r = 14;
      r.x = (4 + ((i * 7) % 22) + Math.random()) * T;
      r.y = (0.8 + Math.random() * 1.4) * T;
      r.think = Math.random();
      this.nav.set(r, { pts: [], lane: (Math.random() - 0.5) * 2, dig: 0, rate: DIG_MIN + DIG_SPAN * skill, stuck: 0, zone: -1 });
      this.rivals.push(r);
    }
    // referees: one watching each relic, one over the treasures
    for (const d of this.relics) this.refs.push({ x: d.x, y: d.y - 60, r: 190, homeY: d.y - 60, t: d.zone * 2, alert: 0, sway: 14 });
    this.refs.push({ x: 15 * T, y: (ROOM_BOTTOM - 2) * T, r: 260, homeY: (ROOM_BOTTOM - 2) * T, t: 1, alert: 0, sway: 30 });

    const rng = this.rng;
    const en = cat.enemies;
    const art = (list: EnemyArt[], tier: number) => {
      const a = list[Math.min(tier, list.length - 1)];
      return { url: a.img, name: a.name };
    };
    // residents of the shaft
    for (let y = 8; y < GATE_ROWS[2] - 2; y += 2 + Math.floor(rng() * 2)) {
      if (GATE_ROWS.some((g) => Math.abs(g - y) < 3)) continue;
      const z = y < GATE_ROWS[0] ? 0 : y < GATE_ROWS[1] ? 1 : 2;
      const x = (this.path[y] + (rng() - 0.5) * (this.half[y] * 2 - 2) + 0.5) * T;
      const tier = z * 2 + (rng() < 0.5 ? 1 : 0);
      const hp = [28, 62, 115][z];
      const r = rng();
      if (r < 0.45) {
        this.spawn(art(en.creeper, tier), x, y * T, { hp, speed: 105 + z * 10, dmg: 8 + z * 2, ai: 'patrol', xp: 2 + z, tier, asleep: true, face: rng() < 0.5 ? 1 : -1 });
      } else if (r < 0.8 || z === 0) {
        this.spawn(art(en.elk, tier), x, y * T, { hp: hp * 0.9, speed: 70 + z * 8, dmg: 7 + z * 2, ai: 'jelly', xp: 2 + z, tier, asleep: true, timer: rng() });
      } else {
        this.spawn(art(en.cascade, tier), x, y * T, { hp: hp * 1.1, speed: 95 + z * 6, dmg: 9 + z * 2, ai: 'dash', xp: 3 + z, tier, asleep: true });
      }
    }
    // guards of the relics
    for (const d of this.digs) {
      if (d.kind !== 'relic') continue;
      if (d.zone === 0) {
        for (let i = 0; i < 2; i++) this.spawn(art(en.creeper, 1), d.x + (i ? 50 : -50), d.y - 60, { hp: 26, speed: 100, dmg: 8, ai: 'chase', xp: 3, tier: 1, asleep: true });
      } else {
        const y = en.yoshka[d.zone - 1];
        this.spawn({ url: y.img, name: y.name }, d.x, d.y - 70, {
          hp: d.zone === 1 ? 900 : 1700, size: 92, r: 28, speed: 62, dmg: 12 + d.zone * 2, ai: 'burst', elite: true, xp: 14, tier: d.zone, asleep: true, timer: 1.5,
        });
      }
    }
    // air vents on the edge of the shaft
    for (let y = 16; y < GATE_ROWS[2]; y += 15) {
      const left = (y / 15) % 2 < 1;
      const x = (this.path[y] + (left ? -this.half[y] : this.half[y]) + 0.5) * T;
      this.vents.push({ x, y: y * T + 20, cd: 0 });
    }
    this.vents.push({ x: 6 * T, y: ROOM_BOTTOM * T + 20, cd: 0 }, { x: 24 * T, y: ROOM_BOTTOM * T + 20, cd: 0 });

    // the lord of the deep cannot be beaten: it guards the treasures until they are all gone
    const lord = cat.enemies.seaBoss[0];
    this.boss = this.spawn({ url: lord.img, name: lord.name }, 15 * T, (ROOM_BOTTOM - 5) * T, {
      hp: 1e9, size: 190, r: 54, speed: 60, dmg: 13, ai: 'boss', boss: true, xp: 0, tier: 3, timer: 1.6, asleep: true,
    });

    host.hud.slots(this.run.slots);
    host.hud.fouls(0, this.st.foulLimit);
    host.hud.objective('矢印の先の遺物を掘り出して、門を抜けろ');
    host.hud.say(`第2種目は海！ ${FIELD}組が一斉に潜ります。秘宝は${QUOTA}個、早い者勝ち！`, 3);
    host.hud.say('門は、自分で遺物を掘り出した人しか通れません。酸素にも気をつけて', 2, 'ain');
    this.follow(1);
  }

  protected fullHp(): number {
    return Math.round((64 * this.traits.hp + this.boosts.hp * 0.3) * this.st.hp);
  }

  private follow(k: number): void {
    const h = this.hero;
    const maxX = W * T - this.vw;
    const tx = maxX > 0 ? clamp(h.x - this.vw / 2, 0, maxX) : maxX / 2;
    const ty = clamp(h.y - this.vh * 0.45, 0, HT * T - this.vh);
    this.camX += (tx - this.camX) * k;
    this.camY += (ty - this.camY) * k;
  }

  private isSolid(tx: number, ty: number): boolean {
    if (ty < 0) return false;
    if (tx < 0 || tx >= W || ty >= HT) return true;
    return this.solid[ty * W + tx] === 1;
  }
  protected blocked(x: number, y: number): boolean {
    return this.isSolid(Math.floor(x / T), Math.floor(y / T));
  }
  private boxHit(x: number, y: number, hr: number): boolean {
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        if (this.blocked(x + i * hr, y + j * hr)) return true;
      }
    }
    return false;
  }

  protected moveBody(b: { x: number; y: number; r: number }, dx: number, dy: number): void {
    const hr = Math.min(b.r * 0.8, T * 0.95);
    const py = b.y;
    // small steps so nothing tunnels through a wall
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (T * 0.4)));
    for (let s = 0; s < steps; s++) {
      const nx = b.x + dx / steps;
      if (!this.boxHit(nx, b.y, hr)) b.x = nx;
      const ny = b.y + dy / steps;
      if (!this.boxHit(b.x, ny, hr)) b.y = ny;
    }
    if (b.y < 26) b.y = 26;
    // a diver is stopped only by the gate they have no relic for; the creatures of a depth never leave it
    const gi = (b as Runner).gate;
    for (let i = gi === undefined ? 0 : gi; i < this.gates.length; i++) {
      const gate = this.gates[i];
      if (py <= gate.y && b.y > gate.y - b.r - 4) b.y = gate.y - b.r - 4;
      else if (py > gate.y && b.y < gate.y + b.r + 4) b.y = gate.y + b.r + 4;
      if (gi !== undefined) break;
    }
  }

  private zoneOf(y: number): number {
    const row = y / T;
    return row < GATE_ROWS[0] ? 0 : row < GATE_ROWS[1] ? 1 : row < GATE_ROWS[2] ? 2 : 3;
  }

  /** What the sonar points at. */
  private goal(): { x: number; y: number; label: string } {
    const h = this.hero;
    const relic = this.relics[h.gate];
    if (relic) return { x: relic.x, y: relic.y, label: '遺物' };
    let best = this.treasures[0];
    let bd = 1e12;
    for (const d of this.treasures) {
      const dd = dist2(d.x, d.y, h.x, h.y);
      if (!d.done && dd < bd) {
        bd = dd;
        best = d;
      }
    }
    return { x: best.x, y: best.y, label: '秘宝' };
  }

  protected heroControl(dt: number): void {
    this.walk(dt, 0.14);
  }

  protected tick(dt: number): void {
    const h = this.hero;
    const hud = this.host.hud;
    const zone = this.zoneOf(h.y);
    this.follow(1 - Math.pow(0.0015, dt));

    // oxygen
    if (h.ko <= 0) {
      if (this.wasOut) h.hp = Math.max(h.hp, h.maxHp * 0.6);
      h.hp -= DRAIN[zone] * this.st.o2 * dt;
      if (h.hp <= 0) {
        this.host.hud.say(`${this.heroArt.name}、酸素が切れた！`, 3);
        this.faint();
      }
    }
    this.wasOut = h.ko > 0;
    if (h.hp < h.maxHp * 0.25 && Math.floor(this.time * 2) !== Math.floor((this.time - dt) * 2)) sfx('count');

    // harpoon
    this.harpoonCd = Math.max(0, this.harpoonCd - dt);
    const reload = 0.55 * Math.pow(0.95, this.st.harpoon - 1);
    if (input.a && this.harpoonCd <= 0 && h.ko <= 0 && h.frozen <= 0) {
      let ax = h.fx;
      let ay = h.fy;
      if (input.pointer.aim && !this.host.bot) {
        const dpr = this.canvas.width / window.innerWidth;
        const wx = this.camX + (input.pointer.x * dpr) / this.scale;
        const wy = this.camY + (input.pointer.y * dpr) / this.scale;
        ax = wx - h.x;
        ay = wy - h.y;
      } else {
        const t = this.nearest(h.x, h.y, 400);
        if (t) {
          ax = t.x - h.x;
          ay = t.y - h.y;
        }
      }
      const l = Math.hypot(ax, ay) || 1;
      this.arsenal.shoot(h.x, h.y, (ax / l) * 900, (ay / l) * 900, 30 * this.traits.phy * levelMul(this.run.level) * this.st.harpoon, 1, 0.5);
      this.harpoonCd = reload;
      sfx('harpoon');
    }

    // a harpoon that finds a rival is a direct attack: it breaks their digging, and the referee may be watching
    for (const p of this.arsenal.projs) {
      if (!p.line || p.life <= 0) continue;
      for (const r of this.rivals) {
        if (r.done || r.ko > 0 || r.inv > 0 || !r.near || dist2(r.x, r.y, p.x, p.y) > (r.r + 10) ** 2) continue;
        p.life = 0;
        this.hurtRunner(r, 18 * this.st.strike, h.x, h.y, h);
        const ref = this.watching(r.x, r.y);
        if (ref) {
          ref.alert = 1;
          this.foul(h, 1);
        } else hud.say(`${this.heroArt.name}の銛が${r.name}に命中！ 審判は見ていません！`, 2);
        break;
      }
    }

    // digging happens by itself while the diver stays close
    let digging: Dig | null = null;
    if (h.ko <= 0 && h.frozen <= 0) {
      for (const d of this.digs) {
        if (d.done) continue;
        if (d.kind === 'relic' && d.zone !== h.gate) continue;
        if (dist2(d.x, d.y - 14, h.x, h.y) < 62 * 62) {
          digging = d;
          break;
        }
      }
    }
    if (digging) {
      if (h.inv > 0.45) digging.prog = Math.max(0, digging.prog - dt * 2);
      else digging.prog += dt * this.st.dig;
      this.digT -= dt;
      if (this.digT <= 0) {
        this.digT = 0.16;
        sfx('dig', 0.1);
        this.puff(digging.x + (Math.random() - 0.5) * 30, digging.y, '#d9c7a0', 2, 120);
      }
      if (digging.prog >= digging.need) this.dug(digging);
    }
    if (this.finished) return;
    for (const d of this.digs) if (d !== digging && !d.done) d.prog = Math.max(0, d.prog - dt * 0.5);

    // air vents
    for (const v of this.vents) {
      v.cd = Math.max(0, v.cd - dt);
      if (v.cd <= 0 && dist2(v.x, v.y - 30, h.x, h.y) < 50 * 50 && h.hp < h.maxHp - 1) {
        v.cd = 7;
        h.hp = Math.min(h.maxHp, h.hp + 30 * this.st.vent);
        sfx('bubble');
        sample('heal', 0.4);
        this.floats.push({ x: h.x, y: h.y - 40, text: `O₂ +${Math.round(30 * this.st.vent)}`, color: '#9be9ff', t: 0, big: true });
      }
    }

    // the last room
    if (!this.bossCalled && h.y > (ROOM_TOP + 1) * T) {
      this.bossCalled = true;
      sfx('warn');
      hud.banner('最深部', `深海の主をかわして、秘宝を掘り出せ（残り ${QUOTA - this.passed}）`, 'warn');
      hud.objective('秘宝を掘り出せ！ 主は倒せない');
      hud.say(`${this.heroArt.name}が最深部に到達！ 秘宝は残り${QUOTA - this.passed}個！`, 3);
    }

    // who is where
    const score = (r: Runner) => r.gate * 1e6 + r.y;
    this.rankT -= dt;
    if (this.rankT <= 0) {
      this.rankT = 0.25;
      let ahead = 0;
      const mine = score(h);
      for (const r of this.rivals) if (r.done || score(r) > mine) ahead++;
      const was = this.place;
      this.place = ahead + 1;
      if (this.time > 4) {
        if (was > QUOTA && this.place <= QUOTA) hud.say(`${this.heroArt.name}、通過圏内の${this.place}位に浮上！`, 2);
        else if (was <= QUOTA && this.place > QUOTA) hud.say(`${this.heroArt.name}、通過圏外に後退…！`, 2, 'ain');
      }
      hud.rank(this.place, FIELD, this.passed, QUOTA);
      const dots: number[] = [];
      for (const r of this.rivals) dots.push(r.done ? 1 : clamp(r.y / this.endY, 0, 1));
      hud.dots(dots, clamp(h.y / this.endY, 0, 1));
    }
    this.chatT -= dt;
    if (this.chatT <= 0) {
      this.chatT = 8 + Math.random() * 4;
      const lines = [
        `${this.heroArt.name}は現在${this.place}位。${this.place <= QUOTA ? 'このまま秘宝まで！' : 'まだ巻き返せます！'}`,
        '掘っている最中に攻撃を受けると、発掘はやり直しです',
        '噴気孔の泡で酸素を補給できますよ',
        '遺物のそばには審判がいます。銛の向きにはご注意を',
      ];
      hud.say(lines[Math.floor(Math.random() * lines.length)], 1, Math.random() < 0.5 ? 'ain' : 'chris');
    }
    if (this.passed >= QUOTA) {
      this.finished = true;
      this.result = { place: this.place, field: FIELD, quota: QUOTA, qualified: false, progress: clamp(h.y / this.endY, 0, 0.99), gates: h.gate };
      sample('lose', 0.6);
      return;
    }

    // bubbles from the diver
    this.bubbleT -= dt;
    if (this.bubbleT <= 0) {
      this.bubbleT = 0.35;
      this.parts.push({ x: h.x + (h.flip ? 8 : -8), y: h.y - 22, vx: (Math.random() - 0.5) * 20, vy: -60, life: 1.2, max: 1.2, color: 'rgba(220,245,255,0.8)', size: 3 + Math.random() * 3, g: -40 });
    }

    hud.gauge(clamp(h.hp / h.maxHp, 0, 1), h.ko > 0 ? `気絶 ${h.ko.toFixed(1)}` : h.frozen > 0 ? `反則 ${h.frozen.toFixed(1)}` : `O₂ ${Math.max(0, Math.ceil(h.hp))}`);
    hud.sub(1 - this.harpoonCd / reload);
    hud.progress(clamp(h.y / this.endY, 0, 1), this.gates.map((g) => g.y / this.endY));
    hud.level(this.run.level, this.run.xp / xpNeed(this.run.level));
    hud.gum(this.run.gum);
    hud.boss(this.bossCalled ? `秘宝 残り ${QUOTA - this.passed} / ${QUOTA}` : null, 1 - this.passed / QUOTA);
  }

  private dug(d: Dig): void {
    d.done = d.kind !== 'relic';
    d.prog = 0;
    const h = this.hero;
    const hud = this.host.hud;
    sample('chest', 0.7);
    this.puff(d.x, d.y - 10, '#ffe45c', 16);
    if (d.kind === 'chest') {
      this.grant(1);
      h.hp = Math.min(h.maxHp, h.hp + 15);
    } else if (d.kind === 'relic') {
      const gate = this.gates[d.zone];
      h.gate = d.zone + 1;
      h.hp = h.maxHp;
      sfx('gate');
      this.grant(1);
      this.through(h, gate);
      hud.banner('遺物を手に入れた！', 'O₂ 全回復・門を通れる', 'good');
      hud.objective(d.zone === 2 ? '最深部へ！ 秘宝は早い者勝ち' : '門を抜けて、さらに深くへ');
      this.shake = 10;
    } else {
      this.passed += 1;
      const place = this.passed;
      this.finished = true;
      this.result = { place, field: FIELD, quota: QUOTA, qualified: true, progress: 1, gates: 3 };
      earn('sea');
      if (place === 1) earn('sea1');
      sample('clear', 0.7);
    }
  }

  /** Someone has earned their way through a gate. */
  private through(r: Runner, gate: Gate): void {
    if (!gate.first) return;
    gate.first = false;
    const which = ['浅瀬の門', '中層の門', '深層の門'][this.gates.indexOf(gate)];
    this.host.hud.say(`${which}を最初に抜けるのは ${r.name}！`, 2);
  }

  // ------------------------------------------------------------------ rivals
  /** Lays out where a rival swims next: down the shaft to their relic, or to a treasure that is still there. */
  private plan(r: Runner, n: Nav): void {
    n.pts = [];
    n.zone = r.gate;
    n.dig = 0;
    const row0 = clamp(Math.floor(r.y / T), 0, ROOM_BOTTOM);
    const lane = (y: number) => (this.path[y] + 0.5 + n.lane * Math.max(0, this.half[y] - 1.5)) * T;
    const back = (this.path[row0] + 0.5) * T;
    if (Math.abs(r.x - back) > (this.half[row0] - 0.5) * T) n.pts.push({ x: back, y: r.y, dig: null });
    const relic = this.relics[r.gate];
    if (relic) {
      for (let y = row0 + 1; y <= relic.row; y += 2) n.pts.push({ x: lane(y), y: (y + 0.5) * T, dig: null });
      n.pts.push({ x: (this.path[relic.row + 1] + 0.5) * T, y: (relic.row + 1) * T, dig: null });
      n.pts.push({ x: relic.x, y: (relic.row + 1.5) * T, dig: relic });
    } else {
      for (let y = row0 + 1; y <= ROOM_TOP + 1; y += 2) n.pts.push({ x: lane(y), y: (y + 0.5) * T, dig: null });
      const free = this.treasures.filter((d) => !d.done);
      const d = free[Math.floor(Math.random() * free.length)];
      if (d) n.pts.push({ x: d.x, y: (ROOM_BOTTOM + 0.5) * T, dig: d });
    }
  }

  protected rivalAI(r: Runner, dt: number): void {
    const n = this.nav.get(r)!;
    r.near = r.y > this.camY - 420 && r.y < this.camY + this.vh + 420;
    r.strikeT = Math.max(0, r.strikeT - dt);
    r.think -= dt;
    if (!n.pts.length || n.zone !== r.gate) this.plan(r, n);
    const pt = n.pts[0];
    if (!pt) return;
    if (pt.dig && pt.dig.done) {
      // someone else got to that treasure first
      n.pts = [];
      return;
    }
    const sp = r.pace * (r.slow > 0 ? 0.6 : 1) * (r.buffSpd > 0 ? 1.25 : 1);
    const dx = pt.x - r.x;
    const dy = pt.y - r.y;
    const d = Math.hypot(dx, dy) || 1;

    if (r.think <= 0) {
      r.think = r.near ? 0.5 : 2;
      // out of sight nothing is simulated around them, so trouble (a monster, an empty tank) is rolled instead
      const weak = 1.3 - (r.pace - PACE_MIN) / PACE_SPAN;
      if (Math.random() < (r.near ? 0.004 : 0.045) * weak) {
        if (r.near) this.host.hud.say(`${r.name}、酸素が切れた！`, 1, 'ain');
        this.hurtRunner(r, 999);
        return;
      }
      // rough divers poke whoever is digging beside them, and the referee is watching them too
      if (r.near && r.mood > 0.6 && r.strikeT <= 0) {
        const seen = this.watching(r.x, r.y);
        if (Math.random() < (seen ? 0.03 : 0.25)) {
          for (const o of [this.hero, ...this.rivals]) {
            if (o === r || o.done || o.ko > 0 || dist2(o.x, o.y, r.x, r.y) > 52 * 52) continue;
            r.strikeT = 3;
            this.arcs.push({ x: r.x, y: r.y, ang: Math.atan2(o.y - r.y, o.x - r.x), r: 60, t: 0, color: '#ff8fa3' });
            this.hurtRunner(o, 12, r.x, r.y, r);
            if (seen) {
              seen.alert = 1;
              if (o.me) this.host.hud.say(`${r.name}が${o.name}に直接攻撃！ 審判が見ています、反則ポイント！`, 2);
              this.foul(r, 1);
            } else if (o.me) this.host.hud.say(`${r.name}が審判の死角で${o.name}を攻撃！`, 2);
            break;
          }
        }
      }
    }

    if (d < 16) {
      if (!pt.dig) {
        n.pts.shift();
        n.stuck = 0;
        return;
      }
      // digging: a blow sets it back, just as it does for the player
      r.moving = false;
      r.vx = r.vy = 0;
      if (r.inv > 0.2) n.dig = Math.max(0, n.dig - dt * 2);
      else n.dig += dt * n.rate;
      if (r.near && Math.random() < dt * 5) this.puff(pt.dig.x + (Math.random() - 0.5) * 30, pt.dig.y, '#d9c7a0', 1, 120);
      if (n.dig >= pt.dig.need) {
        if (pt.dig.kind === 'relic') {
          r.gate += 1;
          r.hp = r.maxHp;
          this.through(r, this.gates[pt.dig.zone]);
        } else {
          pt.dig.done = true;
          r.done = true;
          this.passed += 1;
          r.place = this.passed;
          this.finishTimes.push(Math.round(this.time * 10) / 10);
          const hud = this.host.hud;
          if (this.passed === 1) hud.say(`最初の秘宝を手にしたのは ${r.name}！`, 3);
          else if (this.passed <= 3) hud.say(`${this.passed}個目の秘宝は ${r.name}！`, 2);
          const left = QUOTA - this.passed;
          if (left === 5 || left === 3 || left === 1) hud.say(`秘宝は、残り${left}個！`, 3, 'ain');
        }
        n.pts = [];
      }
      return;
    }

    let vx = (dx / d) * sp;
    let vy = (dy / d) * sp;
    if (!r.near) {
      r.x += vx * dt;
      r.y += vy * dt;
      r.moving = true;
      return;
    }
    // fight what is in reach, and lean away from what is too close
    let hit: Enemy | null = null;
    for (const e of this.enemies) {
      if (e.dead || e.asleep) continue;
      const d2 = dist2(e.x, e.y, r.x, r.y);
      if (d2 < (105 + e.r) ** 2 && !hit) hit = e;
      if (!e.boss && d2 < 60 * 60) {
        const dd = Math.sqrt(d2) || 1;
        vx += ((r.x - e.x) / dd) * 70;
        vy += ((r.y - e.y) / dd) * 70;
      }
    }
    r.atk -= dt;
    if (hit && r.atk <= 0) {
      r.atk = 0.5;
      if (!hit.boss) this.hitEnemy(hit, r.dps * 0.5, (hit.x - r.x) * 0.6, (hit.y - r.y) * 0.6, r);
      if (this.arcs.length < 24) this.arcs.push({ x: r.x, y: r.y, ang: Math.atan2(hit.y - r.y, hit.x - r.x), r: 64, t: 0, color: '#c9d2ff' });
      this.passive(r, 'skill');
    }
    r.vx += (vx - r.vx) * Math.min(1, dt * 6);
    r.vy += (vy - r.vy) * Math.min(1, dt * 6);
    const bx = r.x;
    const by = r.y;
    // a rival wedged on a corner for too long simply slips past it
    if (n.stuck > 1.5) {
      r.x += (dx / d) * sp * dt;
      r.y += (dy / d) * sp * dt;
      if (n.stuck > 2.5) n.stuck = 0;
    } else this.moveBody(r, r.vx * dt, r.vy * dt);
    n.stuck += Math.hypot(r.x - bx, r.y - by) < sp * dt * 0.3 ? dt : n.stuck > 1.5 ? dt : -n.stuck;
    r.moving = true;
    if (Math.abs(r.vx) > 20) r.flip = r.vx > 0;
    r.bob += dt * 8;
  }

  protected bossAI(e: Enemy, dt: number): void {
    const h = this.hero;
    const dx = h.x - e.x;
    const dy = h.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    e.timer -= dt;
    if (e.state === 0) {
      this.moveBody(e, (dx / d) * e.speed * dt, (dy / d) * e.speed * dt + Math.sin(e.t * 2) * 20 * dt);
      if (e.timer <= 0) {
        e.state = 1;
        e.timer = 0.55;
      }
    } else if (e.state === 1) {
      e.flash = 0.05;
      if (e.timer <= 0) {
        e.ay += 1;
        const kind = e.ay % 3;
        if (kind === 1) {
          const n = 18;
          const off = this.rng() * TAU;
          for (let i = 0; i < n; i++) this.fire(e.x, e.y, off + (i / n) * TAU, 160, e.dmg * 0.7, '#b58bff');
          for (let i = -1; i <= 1; i++) this.fire(e.x, e.y, Math.atan2(dy, dx) + i * 0.2, 250, e.dmg, '#ffb35c', 9);
          sfx('magic');
          e.state = 0;
          e.timer = 2;
        } else if (kind === 2) {
          e.state = 2;
          e.timer = 0.85;
          e.vx = dx / d;
          e.vy = dy / d;
          sfx('beast');
        } else {
          const en = cat.enemies.creeper;
          if (this.enemies.filter((o) => !o.dead && !o.asleep).length < 18) {
            for (let i = 0; i < 3; i++) {
              const a = en[4];
              this.spawn({ url: a.img, name: a.name }, e.x + (i - 1) * 90, e.y - 80, { hp: 70, speed: 120, dmg: 10, ai: 'chase', xp: 3, tier: 4 });
            }
          }
          sfx('warn');
          e.state = 0;
          e.timer = 2.2;
        }
      }
    } else {
      this.moveBody(e, e.vx * e.speed * 6 * dt, e.vy * e.speed * 6 * dt);
      if (e.timer <= 0) {
        e.state = 0;
        e.timer = 1.6;
      }
    }
  }

  // ------------------------------------------------------------------ drawing
  private depthColor(y: number, table: [number, number, number][]): string {
    const f = clamp(y / (HT * T), 0, 0.999) * 3;
    const i = Math.floor(f);
    return mixColor(table[i], table[i + 1], f - i);
  }

  protected drawBack(g: CanvasRenderingContext2D): void {
    const vx = this.camX;
    const vy = this.camY;
    // water, in bands so the colour deepens smoothly
    for (let y = Math.floor(vy / 60) * 60; y < vy + this.vh + 60; y += 60) {
      g.fillStyle = this.depthColor(y, WATER);
      g.fillRect(vx - 20, y, this.vw + 40, 61);
    }
    // sunbeams near the surface
    if (vy < 900) {
      g.globalAlpha = clamp(0.16 * (1 - vy / 900), 0, 1);
      g.fillStyle = '#dff8ff';
      for (let i = 0; i < 9; i++) {
        const x = i * 190 + Math.sin(this.time * 0.4 + i) * 30;
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x + 60, 0);
        g.lineTo(x - 140, 900);
        g.lineTo(x - 240, 900);
        g.fill();
      }
      g.globalAlpha = 1;
    }
    // drifting specks
    g.fillStyle = 'rgba(210,240,255,0.35)';
    for (let i = 0; i < 46; i++) {
      const px = ((hash2(i, 3) * 1700 + this.time * (6 + hash2(i, 5) * 10)) % 1700) - 100;
      const py = Math.floor(vy / 700) * 700 + hash2(i, 4) * 1400 - ((this.time * 8) % 700);
      g.fillRect(px, py, 2, 2);
    }

    const tx0 = Math.max(0, Math.floor(vx / T) - 1);
    const tx1 = Math.min(W - 1, Math.floor((vx + this.vw) / T) + 1);
    const ty0 = Math.max(0, Math.floor(vy / T) - 1);
    const ty1 = Math.min(HT - 1, Math.floor((vy + this.vh) / T) + 1);
    // rock
    for (let ty = ty0; ty <= ty1; ty++) {
      const base = this.depthColor(ty * T, ROCK);
      for (let tx = tx0; tx <= tx1; tx++) {
        if (!this.isSolid(tx, ty)) continue;
        const x = tx * T;
        const y = ty * T;
        g.fillStyle = base;
        g.fillRect(x, y, T + 1, T + 1);
        const hv = hash2(tx, ty);
        g.fillStyle = hv < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.05)';
        g.fillRect(x + Math.floor(hv * 5) * 8, y + Math.floor(hash2(ty, tx) * 5) * 8, 16, 8);
        if (!this.isSolid(tx, ty - 1)) {
          g.fillStyle = 'rgba(190,255,220,0.28)';
          g.fillRect(x, y, T, 5);
        }
        g.fillStyle = 'rgba(0,0,0,0.3)';
        if (!this.isSolid(tx, ty + 1)) g.fillRect(x, y + T - 5, T, 5);
        if (!this.isSolid(tx - 1, ty)) g.fillRect(x, y, 4, T);
        if (!this.isSolid(tx + 1, ty)) g.fillRect(x + T - 4, y, 4, T);
      }
    }
    // weeds and coral on the ledges
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (this.isSolid(tx, ty) || !this.isSolid(tx, ty + 1)) continue;
        const hv = hash2(tx * 7, ty * 3);
        if (hv > 0.55) continue;
        const x = tx * T + 8 + hv * 50;
        const y = (ty + 1) * T;
        if (hv < 0.3) {
          g.strokeStyle = hv < 0.15 ? '#3fbf8a' : '#2f9a78';
          g.lineWidth = 3;
          for (let k = 0; k < 3; k++) {
            const sway = Math.sin(this.time * 1.6 + tx + k) * 5;
            g.beginPath();
            g.moveTo(x + k * 7, y);
            g.quadraticCurveTo(x + k * 7 + sway, y - 14, x + k * 7 + sway * 1.6, y - 22 - k * 5);
            g.stroke();
          }
        } else {
          g.fillStyle = hv < 0.42 ? '#ff7f9c' : '#ffb35c';
          g.fillRect(x, y - 12, 6, 12);
          g.fillRect(x - 6, y - 8, 6, 4);
          g.fillRect(x + 6, y - 16, 6, 8);
        }
      }
    }

    // vents
    for (const v of this.vents) {
      if (v.y < vy - 60 || v.y > vy + this.vh + 60) continue;
      g.fillStyle = '#5c6c80';
      g.fillRect(v.x - 14, v.y + 16, 28, 12);
      g.fillStyle = '#8fa2ba';
      g.fillRect(v.x - 10, v.y + 12, 20, 6);
      if (v.cd <= 0) {
        g.strokeStyle = 'rgba(210,245,255,0.9)';
        g.lineWidth = 2;
        for (let i = 0; i < 5; i++) {
          const k = (this.time * 0.9 + i / 5) % 1;
          g.beginPath();
          g.arc(v.x + Math.sin(k * 9 + i) * 8, v.y + 8 - k * 70, 3 + k * 6, 0, TAU);
          g.stroke();
        }
      }
    }

    // things to dig up
    for (const d of this.digs) {
      if (d.y < vy - 80 || d.y > vy + this.vh + 80) continue;
      if (d.done) {
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.fillRect(d.x - 22, d.y + 4, 44, 6);
        continue;
      }
      if (d.kind === 'relic' && this.hero.gate > d.zone) continue;
      const locked = false;
      const pulse = 0.5 + Math.sin(this.time * 4) * 0.5;
      if (d.kind === 'relic') {
        g.globalAlpha = 0.25 + pulse * 0.2;
        g.fillStyle = '#7dfff0';
        g.beginPath();
        g.arc(d.x, d.y - 18, 40, 0, TAU);
        g.fill();
        g.globalAlpha = 1;
        g.fillStyle = '#2bd6c4';
        g.beginPath();
        g.moveTo(d.x, d.y - 44);
        g.lineTo(d.x + 16, d.y - 18);
        g.lineTo(d.x, d.y + 6);
        g.lineTo(d.x - 16, d.y - 18);
        g.fill();
        g.fillStyle = '#c9fff8';
        g.beginPath();
        g.moveTo(d.x, d.y - 44);
        g.lineTo(d.x + 6, d.y - 18);
        g.lineTo(d.x, d.y - 8);
        g.lineTo(d.x - 6, d.y - 18);
        g.fill();
      } else {
        const big = d.kind === 'treasure' ? 1.6 : 1;
        const w = 40 * big;
        const hh = 28 * big;
        if (!locked) {
          g.globalAlpha = 0.18 + pulse * 0.15;
          g.fillStyle = '#ffe45c';
          g.beginPath();
          g.arc(d.x, d.y - hh / 2, w, 0, TAU);
          g.fill();
          g.globalAlpha = 1;
        }
        g.fillStyle = locked ? '#4c4660' : '#8a5a2b';
        g.fillRect(d.x - w / 2, d.y - hh, w, hh);
        g.fillStyle = locked ? '#6a6480' : '#b9792f';
        g.fillRect(d.x - w / 2, d.y - hh, w, hh * 0.4);
        g.fillStyle = locked ? '#8d88a0' : '#ffd84d';
        g.fillRect(d.x - w / 2, d.y - hh * 0.62, w, 4 * big);
        g.fillRect(d.x - 4 * big, d.y - hh * 0.7, 8 * big, 10 * big);
      }
      // the sand it is buried in, sinking as the digging goes on
      const left = 1 - clamp(d.prog / d.need, 0, 1);
      g.fillStyle = '#c9b48a';
      g.beginPath();
      g.ellipse(d.x, d.y + 6, 34, 4 + 16 * left, 0, Math.PI, 0);
      g.fill();
      if (d.prog > 0) {
        g.strokeStyle = 'rgba(0,0,0,0.5)';
        g.lineWidth = 7;
        g.beginPath();
        g.arc(d.x, d.y - 64, 14, 0, TAU);
        g.stroke();
        g.strokeStyle = '#ffe45c';
        g.lineWidth = 5;
        g.beginPath();
        g.arc(d.x, d.y - 64, 14, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - left));
        g.stroke();
      }
    }

    // gates
    for (const gt of this.gates) {
      if (gt.y < vy - 60 || gt.y > vy + this.vh + 60) continue;
      g.fillStyle = '#2c2a44';
      g.fillRect(gt.x0 - 10, gt.y - 14, 20, 28);
      g.fillRect(gt.x1 - 10, gt.y - 14, 20, 28);
      const open = this.hero.gate > this.gates.indexOf(gt);
      g.fillStyle = open ? '#6dffa0' : '#7dfff0';
      g.fillRect(gt.x0 - 4, gt.y - 5, 8, 10);
      g.fillRect(gt.x1 - 4, gt.y - 5, 8, 10);
      if (!open) {
        g.globalAlpha = 0.3;
        g.fillStyle = '#7dfff0';
        g.fillRect(gt.x0, gt.y - 8, gt.x1 - gt.x0, 16);
        g.globalAlpha = 0.95;
        for (let x = gt.x0 + ((this.time * 120) % 36); x < gt.x1 - 18; x += 36) g.fillRect(x, gt.y - 3, 20, 6);
        g.globalAlpha = 1;
      }
    }
  }

  protected drawHero(g: CanvasRenderingContext2D, blink: boolean): void {
    const h = this.hero;
    if (blink) g.globalAlpha = 0.45;
    g.save();
    g.translate(h.x, h.y + Math.sin(this.time * 3) * 2);
    g.rotate(clamp(h.vx / 900, -0.25, 0.25));
    this.sprite(g, this.heroArt.img, 0, 0, 60, h.flip);
    // a bubble helmet
    g.strokeStyle = 'rgba(220,245,255,0.75)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(0, -12, 22, 0, TAU);
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.beginPath();
    g.arc(0, -12, 17, -2.4, -1.5);
    g.stroke();
    g.restore();
    g.globalAlpha = 1;
  }

  protected drawOverlay(g: CanvasRenderingContext2D): void {
    const h = this.hero;
    const f = clamp(h.y / (HT * T), 0, 1);
    const alpha = clamp(f * 1.25 - 0.08, 0, 0.9);
    const hx = h.x - this.camX;
    const hy = h.y - this.camY;
    if (alpha > 0.02) {
      const q = 4;
      const dw = Math.ceil(this.vw / q);
      const dh = Math.ceil(this.vh / q);
      if (this.dark.width !== dw || this.dark.height !== dh) {
        this.dark.width = dw;
        this.dark.height = dh;
      }
      const d = this.dark.getContext('2d')!;
      d.globalCompositeOperation = 'source-over';
      d.clearRect(0, 0, dw, dh);
      d.fillStyle = `rgba(2,5,16,${alpha})`;
      d.fillRect(0, 0, dw, dh);
      d.globalCompositeOperation = 'destination-out';
      const hole = (x: number, y: number, r: number, s: number) => {
        const gr = d.createRadialGradient(x / q, y / q, 0, x / q, y / q, r / q);
        gr.addColorStop(0, `rgba(0,0,0,${s})`);
        gr.addColorStop(0.6, `rgba(0,0,0,${s * 0.75})`);
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        d.fillStyle = gr;
        d.beginPath();
        d.arc(x / q, y / q, r / q, 0, TAU);
        d.fill();
      };
      hole(hx, hy, 330 - f * 90, 1);
      for (const r of this.rivals) if (!r.done && r.near) hole(r.x - this.camX, r.y - this.camY, 70, 0.75);
      for (const f of this.refs) hole(f.x - this.camX, f.y - this.camY, 90, 0.5);
      for (const dg of this.digs) if (!dg.done) hole(dg.x - this.camX, dg.y - 20 - this.camY, dg.kind === 'chest' ? 80 : 120, 0.8);
      for (const v of this.vents) hole(v.x - this.camX, v.y - this.camY, 70, 0.6);
      for (const gt of this.gates) if (this.hero.gate <= this.gates.indexOf(gt)) hole((gt.x0 + gt.x1) / 2 - this.camX, gt.y - this.camY, 200, 0.7);
      for (const b of this.ebullets) hole(b.x - this.camX, b.y - this.camY, 34, 0.9);
      for (const s of this.arsenal.projs) hole(s.x - this.camX, s.y - this.camY, 40, 0.7);
      if (this.boss && !this.boss.dead) hole(this.boss.x - this.camX, this.boss.y - this.camY, 190, 0.85);
      g.imageSmoothingEnabled = true;
      g.drawImage(this.dark, 0, 0, dw * q, dh * q);
      g.imageSmoothingEnabled = false;
    }

    // sonar: the main objective, and the chests of this depth
    const arrow = (tx: number, ty: number, color: string, rad: number, label: string) => {
      const dx = tx - h.x;
      const dy = ty - h.y;
      const d = Math.hypot(dx, dy);
      if (d < 150) return;
      const a = Math.atan2(dy, dx);
      const ax = hx + Math.cos(a) * rad;
      const ay = hy + Math.sin(a) * rad;
      g.save();
      g.translate(ax, ay);
      g.rotate(a);
      g.fillStyle = color;
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(14, 0);
      g.lineTo(-8, -9);
      g.lineTo(-3, 0);
      g.lineTo(-8, 9);
      g.closePath();
      g.stroke();
      g.fill();
      g.restore();
      if (label) {
        g.font = '12px DotGothic16, sans-serif';
        g.textAlign = 'center';
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(0,0,0,0.7)';
        const lx = hx + Math.cos(a) * (rad + 26);
        const ly = hy + Math.sin(a) * (rad + 26) + 4;
        g.strokeText(label, lx, ly);
        g.fillStyle = color;
        g.fillText(label, lx, ly);
      }
    };
    const zone = this.zoneOf(h.y);
    for (const d of this.digs) if (d.kind === 'chest' && !d.done && d.zone === zone) arrow(d.x, d.y, '#ffd84d', 66, '');
    const goal = this.goal();
    arrow(goal.x, goal.y, '#7dfff0', 86, `${goal.label} ${Math.round(Math.hypot(goal.x - h.x, goal.y - h.y) / 16)}m`);
  }

  // ------------------------------------------------------------------ debug bot
  private route(tx: number, ty: number): void {
    const h = this.hero;
    const sx = Math.floor(h.x / T);
    const sy = Math.floor(h.y / T);
    const ex = Math.floor(tx / T);
    const ey = Math.floor(ty / T);
    const prev = new Int32Array(W * HT).fill(-1);
    const queue = [sy * W + sx];
    prev[sy * W + sx] = sy * W + sx;
    const gate = this.gates[h.gate];
    while (queue.length) {
      const c = queue.shift()!;
      if (c === ey * W + ex) break;
      const x = c % W;
      const y = Math.floor(c / W);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= HT || this.isSolid(nx, ny)) continue;
        if (gate && ny >= gate.row && y < gate.row) continue;
        const n = ny * W + nx;
        if (prev[n] !== -1) continue;
        prev[n] = c;
        queue.push(n);
      }
    }
    this.botPath = [];
    let c = ey * W + ex;
    if (prev[c] === -1) return;
    while (c !== sy * W + sx) {
      this.botPath.unshift(c);
      c = prev[c];
    }
  }

  botStep(): { x: number; y: number; a: boolean; b: boolean } {
    const h = this.hero;
    const goal = this.goal();
    const tx = goal.x;
    const ty = goal.y - 20;
    this.botT -= 1 / 60;
    if (this.botT <= 0) {
      this.botT = 0.2;
      this.route(tx, ty);
    }
    let x = tx - h.x;
    let y = ty - h.y;
    if (this.botPath.length > 1) {
      const c = this.botPath[Math.min(1, this.botPath.length - 1)];
      x = ((c % W) + 0.5) * T - h.x;
      y = (Math.floor(c / W) + 0.5) * T - h.y;
    }
    const l = Math.hypot(x, y);
    // the harpoon is for monsters: not with a rival close enough to catch it
    const shoot = !!this.nearest(h.x, h.y, 320) && !this.rivals.some((r) => !r.done && dist2(r.x, r.y, h.x, h.y) < 170 * 170);
    if (l < 10) return { x: 0, y: 0, a: shoot, b: false };
    return { x: x / l, y: y / l, a: shoot, b: false };
  }
}
