// SKY: the gear gathered on land and under the sea becomes a fighter. Fly into the screen, from the
// blue sky up into space, and bring down the last enemy at the end of the course.

import * as THREE from 'three';
import { sample, sfx } from '../core/audio';
import { cat, traitsOf, type Traits } from '../core/catalog';
import { input } from '../core/input';
import { clamp, lerp, makeRng, TAU, type Rng } from '../core/util';
import { DOWN_PENALTY, levelMul, type Run } from '../game/run';
import { DEFAULT_ARM, SKY_ARMS, tuneStats, type FighterStats } from '../game/tuning';
import type { Host, Stage } from './stage';

const BX = 12;
const BY = 6.4;
const SPAWN_Z = -280;
const COURSE = 3000;
const MID_AT = 0.5;

interface Foe {
  s: THREE.Sprite; x: number; y: number; z: number; r: number; hp: number; max: number;
  type: 'bagel' | 'letter' | 'heart' | 'mid' | 'boss';
  t: number; fireT: number; bx: number; by: number; holdZ: number; flash: number; dead: boolean; boss: boolean;
  bitCd: number; vx: number; vy: number; phase: number; name: string;
}
interface Block { m: THREE.Mesh; x: number; y: number; z: number; r: number; solid: boolean; spin: number }
interface Ring { m: THREE.Mesh; x: number; y: number; z: number; taken: boolean }
interface Shot { m: THREE.Object3D; x: number; y: number; z: number; vx: number; vy: number; vz: number; dmg: number; life: number; target: Foe | null; live: boolean }
interface EShot { s: THREE.Sprite; x: number; y: number; z: number; vx: number; vy: number; vz: number; dmg: number; live: boolean }
interface Fx { s: THREE.Sprite; t: number; max: number; size: number }
interface Ev { at: number; kind: 'blocks' | 'wave' | 'rings'; seed: number }

function glowTexture(inner: string, outer: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, inner);
  gr.addColorStop(0.35, outer);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
function ringTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#fff';
  g.lineWidth = 4;
  g.beginPath();
  g.arc(32, 32, 24, 0, TAU);
  g.stroke();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    g.beginPath();
    g.moveTo(32 + Math.cos(a) * 16, 32 + Math.sin(a) * 16);
    g.lineTo(32 + Math.cos(a) * 30, 32 + Math.sin(a) * 30);
    g.stroke();
  }
  return new THREE.CanvasTexture(c);
}

export class SkyStage implements Stage {
  time = 0;
  finished = false;
  private run: Run;
  private traits: Traits;
  private rng: Rng;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(62, 1, 0.1, 700);
  private ship = new THREE.Group();
  private flame: THREE.Sprite;
  private reticle: THREE.Sprite;
  private lock: THREE.Sprite;
  private stars: THREE.Points;
  private lines: THREE.Mesh[] = [];
  private clouds: THREE.Sprite[] = [];
  private bitSprites: THREE.Sprite[] = [];
  private tex = new Map<string, THREE.Texture>();
  private loader = new THREE.TextureLoader();
  private glowPink: THREE.Texture;
  private glowWarm: THREE.Texture;
  private glowWhite: THREE.Texture;
  private boxGeo = new THREE.BoxGeometry(1, 1, 1);
  private laserGeo = new THREE.BoxGeometry(0.18, 0.18, 2.6);
  private laserMat = new THREE.MeshBasicMaterial({ color: 0x9dffb0 });
  private spreadMat = new THREE.MeshBasicMaterial({ color: 0xffd166 });
  private missileGeo = new THREE.BoxGeometry(0.34, 0.34, 1.2);
  private missileMat = new THREE.MeshBasicMaterial({ color: 0x8fb4ff });
  private ringGeo = new THREE.TorusGeometry(2.6, 0.22, 6, 20);
  private ringMat = new THREE.MeshBasicMaterial({ color: 0xffe45c });

  private px = 0;
  private py = 0;
  private vx = 0;
  private vy = 0;
  private hp = 100;
  private maxHp = 100;
  private inv = 0;
  private boost = 0.6;
  private boosting = false;
  private rollT = 0;
  private rollCd = 0;
  private rollDir = 1;
  private speed = 30;
  private baseSpeed = 30;
  private dist = 0;
  private hold: Foe | null = null;
  private midDone = false;
  private bossCalled = false;
  private st: FighterStats;
  private fireT = 0;
  private missileT = 1;
  private pulseT = 2;
  private bitAng = 0;
  private shake = 0;

  private foes: Foe[] = [];
  private blocks: Block[] = [];
  private rings: Ring[] = [];
  private shots: Shot[] = [];
  private eshots: EShot[] = [];
  private fx: Fx[] = [];
  private events: Ev[] = [];
  private evi = 0;
  private bg = new THREE.Color();
  private onResize = () => this.resize();

  constructor(private host: Host) {
    this.run = host.run;
    const pilot = this.run.heroes[2];
    this.traits = traitsOf(pilot);
    this.rng = makeRng(host.seed + 37);
    this.st = tuneStats(this.run);
    this.maxHp = this.st.hp;
    this.hp = this.maxHp;
    this.baseSpeed = 28 * (0.9 + 0.1 * this.traits.agi) + Math.min(9, this.st.engine * 0.13);

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.domElement.className = 'game-canvas';
    host.mount.appendChild(this.renderer.domElement);
    this.scene.fog = new THREE.Fog(0x6fb9f2, 140, 480);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445588, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(6, 12, 8);
    this.scene.add(sun);

    this.glowPink = glowTexture('#ffffff', '#ff4f8b');
    this.glowWarm = glowTexture('#ffffff', '#ffa040');
    this.glowWhite = glowTexture('#ffffff', '#9fd0ff');

    // ---- the fighter: a small low-poly hull, the pilot on top, and the chosen gear bolted on
    const hullMat = new THREE.MeshLambertMaterial({ color: 0xe8eef7, flatShading: true });
    const wingMat = new THREE.MeshLambertMaterial({ color: 0x5878c0, flatShading: true });
    const dark = new THREE.MeshLambertMaterial({ color: 0x2b3350, flatShading: true });
    const hull = new THREE.Mesh(new THREE.ConeGeometry(0.7, 3.4, 5), hullMat);
    hull.rotation.x = -Math.PI / 2;
    this.ship.add(hull);
    for (const sgn of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.1, 1), wingMat);
      wing.position.set(sgn * 1.25, -0.05, 0.6);
      wing.rotation.y = sgn * -0.32;
      wing.rotation.z = sgn * 0.08;
      this.ship.add(wing);
      const gun = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 1.3), dark);
      gun.position.set(sgn * 1.9, 0, 0.1);
      this.ship.add(gun);
    }
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.8), wingMat);
    fin.position.set(0, 0.45, 1.1);
    this.ship.add(fin);
    const pilotS = this.sprite(pilot.img, 1.35);
    pilotS.position.set(0, 0.8, 0.1);
    this.ship.add(pilotS);
    const hard: [number, number, number][] = [[-2.5, 0.35, 0.8], [2.5, 0.35, 0.8], [-1.3, 0.45, 1.2], [1.3, 0.45, 1.2]];
    // the weapons bought in the hangar, bolted on (the laser that comes with the hull sits on the nose)
    const nose = this.sprite(DEFAULT_ARM.img, 0.8);
    nose.position.set(0, 0.25, -1.2);
    this.ship.add(nose);
    (this.run.tune?.arms ?? []).forEach((id, i) => {
      const arm = SKY_ARMS.find((a) => a.id === id);
      if (!arm || i > 3) return;
      const s = this.sprite(arm.img, 0.95);
      s.position.set(...hard[i]);
      this.ship.add(s);
      if (id === 'bits') {
        const n = 2 + Math.floor(this.st.bits / 30);
        for (let k = this.bitSprites.length; k < Math.min(5, n); k++) {
          const b = this.sprite(arm.img, 1.3);
          this.scene.add(b);
          this.bitSprites.push(b);
        }
      }
    });
    this.flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowWarm, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.flame.position.set(0, -0.15, 1.7);
    this.ship.add(this.flame);
    this.scene.add(this.ship);

    const rt = ringTexture();
    this.reticle = new THREE.Sprite(new THREE.SpriteMaterial({ map: rt, color: 0x9dffb0, transparent: true, opacity: 0.7, depthTest: false }));
    this.reticle.scale.set(3, 3, 1);
    this.scene.add(this.reticle);
    this.lock = new THREE.Sprite(new THREE.SpriteMaterial({ map: rt, color: 0xff5c7a, transparent: true, opacity: 0.9, depthTest: false }));
    this.lock.visible = false;
    this.scene.add(this.lock);

    // ---- stars, speed lines and clouds
    const n = 700;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (this.rng() - 0.5) * 420;
      pos[i * 3 + 1] = (this.rng() - 0.5) * 260;
      pos[i * 3 + 2] = -this.rng() * 600;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.9, sizeAttenuation: true, transparent: true, opacity: 0, fog: false }));
    this.scene.add(this.stars);
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, fog: false });
    for (let i = 0; i < 46; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 7), lineMat);
      m.position.set((this.rng() - 0.5) * 70, (this.rng() - 0.5) * 40, -this.rng() * 260);
      this.scene.add(m);
      this.lines.push(m);
    }
    const cloudTex = glowTexture('rgba(255,255,255,0.95)', 'rgba(255,255,255,0.55)');
    for (let i = 0; i < 26; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.8, depthWrite: false }));
      const w = 30 + this.rng() * 50;
      s.scale.set(w, w * 0.45, 1);
      const side = this.rng() < 0.5 ? -1 : 1;
      s.position.set(side * (24 + this.rng() * 70), -16 - this.rng() * 30 + (this.rng() < 0.25 ? 45 : 0), -this.rng() * 480);
      this.scene.add(s);
      this.clouds.push(s);
    }

    // ---- the course: the same for everyone
    const er = makeRng(host.seed + 41);
    let at = 70;
    let i = 0;
    while (at < COURSE - 90) {
      const p = at / COURSE;
      const nearMid = Math.abs(p - MID_AT) < 0.03;
      if (!nearMid) {
        const cyc = i % 5;
        const kind: Ev['kind'] = cyc === 0 || cyc === 3 ? 'wave' : cyc === 1 ? 'blocks' : cyc === 2 ? 'rings' : er() < 0.5 ? 'blocks' : 'wave';
        this.events.push({ at, kind, seed: Math.floor(er() * 1e9) });
        i++;
      }
      at += 58 - p * 14 + er() * 10;
    }

    this.resize();
    window.addEventListener('resize', this.onResize);
    host.hud.slots([]);
    host.hud.objective('敵を撃ち落として、宇宙の果てへ');
    this.place(0);
  }

  private sprite(url: string, size: number): THREE.Sprite {
    let t = this.tex.get(url);
    if (!t) {
      t = this.loader.load(url);
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.colorSpace = THREE.SRGBColorSpace;
      this.tex.set(url, t);
    }
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, alphaTest: 0.2 }));
    s.scale.set(size, size, 1);
    return s;
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // narrow windows: widen the view so the whole play area stays on screen
    this.camera.fov = w / h < 1.5 ? clamp(62 * (1.5 / (w / h)) ** 0.7, 62, 95) : 62;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = (m as unknown as { material?: THREE.Material | THREE.Material[] }).material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    for (const t of this.tex.values()) t.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ------------------------------------------------------------------ spawning
  private spawnFoe(type: Foe['type'], x: number, y: number, prog: number): Foe {
    const en = cat.enemies;
    const tier = clamp(Math.floor(prog * 6), 0, 5);
    const scale = 1 + prog * 1.9;
    let art = en.bagel[tier];
    let hp = 30 * scale;
    let size = 4.2;
    let r = 1.9;
    if (type === 'letter') {
      art = en.letter[tier];
      hp = 20 * scale;
      size = 4;
    } else if (type === 'heart') {
      art = en.heart[tier];
      hp = 72 * scale;
      size = 5;
      r = 2.3;
    } else if (type === 'mid') {
      art = en.skyMid[0];
      hp = 2100;
      size = 15;
      r = 5.4;
    } else if (type === 'boss') {
      art = en.skyBoss[0];
      hp = 5200;
      size = 20;
      r = 6.6;
    }
    const s = this.sprite(art.img, size);
    this.scene.add(s);
    const f: Foe = {
      s, x, y, z: SPAWN_Z, r, hp, max: hp, type, t: 0, fireT: 1 + this.rng() * 1.5, bx: x, by: y,
      holdZ: -48 - this.rng() * 34, flash: 0, dead: false, boss: type === 'mid' || type === 'boss', bitCd: 0,
      vx: 0, vy: 0, phase: 0, name: art.name,
    };
    if (f.boss) f.holdZ = type === 'mid' ? -74 : -86;
    this.foes.push(f);
    return f;
  }

  private doEvent(ev: Ev): void {
    const r = makeRng(ev.seed);
    const prog = ev.at / COURSE;
    if (ev.kind === 'wave') {
      const n = 3 + Math.floor(prog * 3.2);
      const cx = (r() - 0.5) * 12;
      const cy = (r() - 0.5) * 6;
      const roll = r();
      const type: Foe['type'] = prog > 0.2 && roll < 0.25 ? 'heart' : roll < 0.6 ? 'bagel' : 'letter';
      const shape = Math.floor(r() * 3);
      const count = type === 'heart' ? Math.max(2, n - 2) : n;
      for (let i = 0; i < count; i++) {
        const k = i - (count - 1) / 2;
        let x = cx + k * 4.2;
        let y = cy;
        if (shape === 1) y = cy + Math.abs(k) * 1.8 - 2;
        if (shape === 2) {
          x = cx + Math.cos((i / count) * TAU) * 5;
          y = cy + Math.sin((i / count) * TAU) * 3.4;
        }
        const f = this.spawnFoe(type, clamp(x, -BX, BX), clamp(y, -BY, BY), prog);
        f.z = SPAWN_Z - i * 5;
      }
    } else if (ev.kind === 'blocks') {
      const n = 7 + Math.floor(prog * 9);
      const lx = (r() - 0.5) * 16;
      const ly = (r() - 0.5) * 8;
      for (let i = 0; i < n; i++) {
        const x = (r() - 0.5) * (BX * 2 + 6);
        const y = (r() - 0.5) * (BY * 2 + 4);
        const size = 2.2 + r() * 3;
        if (Math.hypot(x - lx, y - ly) < 3.4 + size * 0.6) continue;
        this.addBlock(x, y, SPAWN_Z - r() * 46, size, true, prog, r);
      }
    } else {
      const sx = (r() - 0.5) * 16;
      const sy = (r() - 0.5) * 8;
      const dx = (r() - 0.5) * 7;
      const dy = (r() - 0.5) * 4;
      for (let i = 0; i < 3; i++) {
        const m = new THREE.Mesh(this.ringGeo, this.ringMat);
        const ring: Ring = { m, x: clamp(sx + dx * i, -BX + 1, BX - 1), y: clamp(sy + dy * i, -BY + 1, BY - 1), z: SPAWN_Z - i * 26, taken: false };
        this.scene.add(m);
        this.rings.push(ring);
      }
    }
    // scenery off to the sides
    for (let i = 0; i < 3; i++) {
      const side = r() < 0.5 ? -1 : 1;
      this.addBlock(side * (22 + r() * 40), -10 - r() * 22 + (r() < 0.3 ? 34 : 0), SPAWN_Z - r() * 60, 6 + r() * 14, false, prog, r);
    }
  }

  private addBlock(x: number, y: number, z: number, size: number, solid: boolean, prog: number, r: Rng): void {
    // floating islands of CryptoWorld low down, crystal and steel further up
    const palette = prog < 0.33 ? [0x6fbf6a, 0xb99a6a, 0x8fd08a] : prog < 0.66 ? [0x8a7fd0, 0x5c6ab8, 0xb9a0ff] : [0x4c5674, 0x7f6ad0, 0x2f3a5c];
    const mat = new THREE.MeshLambertMaterial({ color: palette[Math.floor(r() * palette.length)], flatShading: true });
    const m = new THREE.Mesh(this.boxGeo, mat);
    m.scale.set(size, size * (0.6 + r() * 0.8), size * (0.7 + r() * 0.9));
    m.rotation.set(r() * 0.5, r() * TAU, r() * 0.5);
    this.scene.add(m);
    this.blocks.push({ m, x, y, z, r: size * 0.62, solid, spin: (r() - 0.5) * 0.6 });
  }

  // ------------------------------------------------------------------ shooting
  private addShot(x: number, y: number, z: number, vx: number, vy: number, vz: number, dmg: number, kind: 0 | 1 | 2, target: Foe | null): void {
    const m = new THREE.Mesh(kind === 2 ? this.missileGeo : this.laserGeo, kind === 0 ? this.laserMat : kind === 1 ? this.spreadMat : this.missileMat);
    this.scene.add(m);
    this.shots.push({ m, x, y, z, vx, vy, vz, dmg, life: kind === 2 ? 2.4 : 1.5, target, live: true });
  }

  /** The enemy the nose is roughly pointing at (aim assist). */
  private aimTarget(): Foe | null {
    let best: Foe | null = null;
    let bd = this.st.aim;
    for (const f of this.foes) {
      if (f.dead || f.z > -6 || f.z < -190) continue;
      const d = Math.hypot(f.x - this.px, f.y - this.py) - f.r * 0.7;
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    return best;
  }

  private fireGuns(dt: number, target: Foe | null): void {
    const st = this.st;
    const lv = levelMul(this.run.level);
    const phys = this.traits.phy * lv * st.power;
    const mag = this.traits.int * lv * st.power;
    this.fireT -= dt;
    if (this.fireT <= 0) {
      this.fireT = 1 / Math.min(11, 5 + st.laser / 9);
      const dmg = (8 + st.laser * 0.13) * phys;
      for (const sgn of [-1, 1]) {
        const ox = this.px + sgn * 1.9;
        let vx = 0;
        let vy = 0;
        const vz = -230;
        if (target) {
          const tt = (target.z - 0) / vz;
          vx = (target.x - ox) / Math.max(0.08, tt);
          vy = (target.y - this.py) / Math.max(0.08, tt);
        }
        this.addShot(ox, this.py, -1.2, vx, vy, vz, dmg, 0, null);
        if (st.spread > 0) {
          const sd = (6 + st.spread * 0.15) * phys;
          const fan = st.spread > 40 ? [0.09, 0.19] : [0.11];
          for (const a of fan) this.addShot(ox, this.py, -1.2, vx + sgn * a * 230, vy, vz, sd, 1, null);
          if (st.spread > 20) this.addShot(ox, this.py, -1.2, vx, vy + (sgn > 0 ? 1 : -1) * 0.09 * 230, vz, sd, 1, null);
        }
      }
      sfx('laser', 0.09);
    }
    if (st.missile > 0) {
      this.missileT -= dt;
      if (this.missileT <= 0) {
        const live = this.foes.filter((f) => !f.dead && f.z < -4 && f.z > -200);
        if (live.length) {
          this.missileT = Math.max(0.55, 1.5 - st.missile / 90);
          const n = 1 + Math.floor(st.missile / 28);
          live.sort((a, b) => b.z - a.z);
          for (let i = 0; i < n; i++) {
            const t = live[i % live.length];
            this.addShot(this.px, this.py + 0.4, -0.5, (i - (n - 1) / 2) * 16, 14, -70, (20 + st.missile * 0.55) * mag, 2, t);
          }
          sfx('magic', 0.15);
        } else {
          this.missileT = 0.2;
        }
      }
    }
    if (st.pulse > 0) {
      this.pulseT -= dt;
      if (this.pulseT <= 0) {
        let any = false;
        const dmg = (34 + st.pulse * 1.3) * mag;
        for (const f of this.foes) {
          if (f.dead || f.z < -110 || f.z > 6) continue;
          if (Math.hypot(f.x - this.px, f.y - this.py) < 11 + f.r) {
            any = true;
            this.hitFoe(f, dmg);
          }
        }
        for (const b of this.eshots) {
          if (b.live && Math.hypot(b.x - this.px, b.y - this.py) < 9 && b.z > -40) {
            b.live = false;
            any = true;
          }
        }
        if (any) {
          this.pulseT = Math.max(2, 4.6 - st.pulse / 40);
          this.boom(this.px, this.py, -6, 26, this.glowWhite, 0.4);
          sfx('aura', 0.2);
        } else {
          this.pulseT = 0.3;
        }
      }
    }
  }

  private hitFoe(f: Foe, dmg: number): void {
    if (f.dead) return;
    f.hp -= dmg;
    f.flash = 0.08;
    sfx('hit', 0.06);
    if (f.hp <= 0) {
      f.dead = true;
      this.run.kills += 1;
      this.boost = Math.min(1, this.boost + 0.05);
      this.boom(f.x, f.y, f.z, f.boss ? 40 : f.r * 5, this.glowWarm, f.boss ? 0.9 : 0.4);
      if (f.boss) {
        sample('blast', 0.7);
        sfx('boom');
        this.shake = 1.2;
        for (let i = 0; i < 8; i++) this.boom(f.x + (Math.random() - 0.5) * 14, f.y + (Math.random() - 0.5) * 10, f.z, 16, this.glowWarm, 0.5 + Math.random() * 0.5);
        for (const b of this.eshots) b.live = false;
        if (this.hold === f) this.hold = null;
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.4);
        if (f.type === 'mid') {
          this.midDone = true;
          this.host.hud.banner('突破！', '大気圏を抜ける', 'good');
          this.host.hud.objective('敵を撃ち落として、宇宙の果てへ');
        } else {
          this.finished = true;
          sample('clear', 0.7);
        }
      } else {
        sfx('kill', 0.07);
      }
    }
  }

  private boom(x: number, y: number, z: number, size: number, tex: THREE.Texture, life: number): void {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.position.set(x, y, z);
    this.scene.add(s);
    this.fx.push({ s, t: 0, max: life, size });
  }

  private efire(f: Foe, vx: number, vy: number, vz: number, dmg: number): void {
    if (this.eshots.length > 260) return;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowPink, depthWrite: false, transparent: true, fog: false }));
    s.scale.set(2.3, 2.3, 1);
    this.scene.add(s);
    this.eshots.push({ s, x: f.x, y: f.y, z: f.z + 1, vx, vy, vz, dmg, live: true });
  }
  /** A shot aimed at where the fighter is now. */
  private aimed(f: Foe, speed: number, dmg: number, offX = 0, offY = 0): void {
    const dz = 0 - f.z;
    const t = dz / speed;
    this.efire(f, (this.px + offX - f.x) / t, (this.py + offY - f.y) / t, speed, dmg);
  }

  private hurt(dmg: number): void {
    if (this.inv > 0 || this.rollT > 0 || this.finished) return;
    this.hp -= dmg * this.st.guard;
    this.inv = 1;
    this.shake = 0.7;
    sfx('hurt');
    this.host.hud.hurt();
    if (this.hp <= 0) {
      this.time += DOWN_PENALTY;
      this.run.downs += 1;
      this.hp = this.maxHp;
      this.inv = 2.6;
      for (const b of this.eshots) b.live = false;
      this.boom(this.px, this.py, 0, 30, this.glowWhite, 0.6);
      sfx('down');
      this.host.hud.penalty(DOWN_PENALTY);
      this.host.hud.banner('ダウン！', '', 'warn');
    }
  }

  // ------------------------------------------------------------------ update
  update(dt: number): void {
    if (this.finished) return;
    this.time += dt;
    const hud = this.host.hud;
    const prog = clamp(this.dist / COURSE, 0, 1);

    // steering
    const ax = input.move.x;
    const ay = -input.move.y;
    const top = 17 * (0.9 + 0.1 * this.traits.agi) * (this.rollT > 0 ? 1.7 : 1);
    const k = 1 - Math.pow(0.0006, dt);
    this.vx += (ax * top - this.vx) * k;
    this.vy += (ay * top - this.vy) * k;
    this.px = clamp(this.px + this.vx * dt, -BX, BX);
    this.py = clamp(this.py + this.vy * dt, -BY, BY);
    this.inv = Math.max(0, this.inv - dt);

    // roll: a quick spin that shrugs off shots
    this.rollCd = Math.max(0, this.rollCd - dt);
    if (input.bPressed && this.rollCd <= 0 && this.rollT <= 0) {
      this.rollT = 0.5;
      this.rollCd = 1;
      this.rollDir = ax < 0 ? 1 : -1;
      sfx('roll');
    }
    if (this.rollT > 0) {
      this.rollT -= dt;
      for (const b of this.eshots) {
        if (b.live && Math.abs(b.z) < 5 && Math.hypot(b.x - this.px, b.y - this.py) < 3.4) {
          b.live = false;
          this.boom(b.x, b.y, b.z, 4, this.glowWhite, 0.2);
        }
      }
    }

    // boost
    const want = input.a && this.boost > 0.02 && !this.hold;
    if (want && !this.boosting) sfx('boost', 0.3);
    this.boosting = want;
    if (this.boosting) this.boost = Math.max(0, this.boost - 0.36 * dt);
    else this.boost = Math.min(1, this.boost + (0.11 + this.st.en) * dt);
    const target = this.baseSpeed * (this.boosting ? 1.8 : 1);
    this.speed = lerp(this.speed, target, 1 - Math.pow(0.02, dt));
    if (!this.hold) this.dist += this.speed * dt;

    // the course
    while (this.evi < this.events.length && this.events[this.evi].at <= this.dist) this.doEvent(this.events[this.evi++]);
    if (!this.midDone && !this.hold && prog >= MID_AT) {
      this.hold = this.spawnFoe('mid', 0, 1, prog);
      sfx('warn');
      hud.banner('WARNING', `${this.hold.name} が行く手をふさぐ`, 'warn');
      hud.objective('行く手をふさぐ敵を倒せ！');
    }
    if (!this.bossCalled && this.dist >= COURSE) {
      this.bossCalled = true;
      this.dist = COURSE;
      this.hold = this.spawnFoe('boss', 0, 1, 1);
      sfx('warn');
      hud.banner('FINAL', `${this.hold.name}`, 'warn');
      hud.objective('最後の敵を倒せ！');
    }

    const aim = this.aimTarget();
    this.fireGuns(dt, aim);
    this.stepShots(dt);
    this.stepFoes(dt, prog);
    this.stepWorld(dt);
    this.shake = Math.max(0, this.shake - dt * 2.5);

    hud.gauge(clamp(this.hp / this.maxHp, 0, 1), `${Math.max(0, Math.ceil(this.hp))}`);
    hud.sub(this.boost);
    hud.progress(prog, [MID_AT]);
    hud.level(this.run.level, 0);
    hud.boss(this.hold && !this.hold.dead ? this.hold.name : null, this.hold ? this.hold.hp / this.hold.max : 0);
    this.place(dt, aim);
  }

  private stepShots(dt: number): void {
    for (const s of this.shots) {
      if (!s.live) continue;
      s.life -= dt;
      if (s.target) {
        if (s.target.dead) s.target = null;
        else {
          const t = s.target;
          const dx = t.x - s.x;
          const dy = t.y - s.y;
          const dz = t.z - s.z;
          const d = Math.hypot(dx, dy, dz) || 1;
          const sp = Math.min(190, Math.hypot(s.vx, s.vy, s.vz) + 260 * dt);
          const kk = 1 - Math.pow(0.001, dt);
          s.vx += ((dx / d) * sp - s.vx) * kk;
          s.vy += ((dy / d) * sp - s.vy) * kk;
          s.vz += ((dz / d) * sp - s.vz) * kk;
        }
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      if (s.life <= 0 || s.z < -300) {
        s.live = false;
        continue;
      }
      for (const f of this.foes) {
        if (f.dead) continue;
        if (Math.abs(f.z - s.z) < 3.4 + f.r * 0.5 && Math.hypot(f.x - s.x, f.y - s.y) < f.r + 0.5) {
          s.live = false;
          this.hitFoe(f, s.dmg);
          this.boom(s.x, s.y, f.z + 1, 2.4, this.glowWhite, 0.12);
          break;
        }
      }
      if (!s.live) continue;
      for (const b of this.blocks) {
        if (!b.solid) continue;
        if (Math.abs(b.z - s.z) < b.r + 1.2 && Math.hypot(b.x - s.x, b.y - s.y) < b.r) {
          s.live = false;
          this.boom(s.x, s.y, s.z, 2, this.glowWhite, 0.1);
          break;
        }
      }
    }
    for (const s of this.shots) {
      if (!s.live) this.scene.remove(s.m);
      else {
        s.m.position.set(s.x, s.y, s.z);
        s.m.lookAt(s.x + s.vx, s.y + s.vy, s.z + s.vz);
      }
    }
    this.shots = this.shots.filter((s) => s.live);
  }

  private stepFoes(dt: number, prog: number): void {
    const bitN = this.bitSprites.length;
    this.bitAng += dt * 3.4;
    for (const f of this.foes) {
      if (f.dead) continue;
      f.t += dt;
      f.flash = Math.max(0, f.flash - dt);
      f.bitCd = Math.max(0, f.bitCd - dt);
      if (f.type === 'letter') {
        // dives straight at the fighter
        f.z += (this.speed + 58) * dt;
        const kk = 1 - Math.pow(0.35, dt);
        if (f.z < -14) {
          f.x += (this.px - f.x) * kk;
          f.y += (this.py - f.y) * kk;
        }
      } else if (f.z < f.holdZ) {
        f.z = Math.min(f.holdZ, f.z + (this.speed + 95) * dt);
      } else {
        const life = f.boss ? 1e9 : f.type === 'heart' ? 10 : 8;
        if (f.t > life) {
          f.z += (this.speed + 30) * dt;
          f.y += 9 * dt;
        } else if (f.boss) {
          this.bossMove(f, dt);
        } else {
          f.x = clamp(f.bx + Math.sin(f.t * 1.4 + f.by) * 3.2, -BX - 2, BX + 2);
          f.y = clamp(f.by + Math.cos(f.t * 1.1 + f.bx) * 1.6, -BY - 1, BY + 1);
          f.fireT -= dt;
          if (f.fireT <= 0) {
            if (f.type === 'heart') {
              f.fireT = 3 - prog * 0.8;
              for (const o of [-3.2, 0, 3.2]) this.aimed(f, 44, 11, o, 0);
            } else {
              f.fireT = 2.6 - prog * 0.9;
              this.aimed(f, 48 + prog * 8, 10);
            }
          }
        }
      }
      // shield bits and ramming
      if (bitN && f.bitCd <= 0 && Math.abs(f.z) < 4 + f.r && Math.hypot(f.x - this.px, f.y - this.py) < 3.6 + f.r) {
        f.bitCd = 0.3;
        this.hitFoe(f, (22 + this.st.bits * 0.6) * levelMul(this.run.level));
      }
      if (!f.dead && Math.abs(f.z) < 2.2 && Math.hypot(f.x - this.px, f.y - this.py) < f.r * 0.8 + 0.9) this.hurt(14);
      if (f.z > 14) f.dead = true;
      f.s.position.set(f.x, f.y, f.z);
      const c = f.flash > 0 ? 3.5 : 1;
      (f.s.material as THREE.SpriteMaterial).color.setRGB(c, c, c);
    }
    for (const f of this.foes) if (f.dead) this.scene.remove(f.s);
    this.foes = this.foes.filter((f) => !f.dead);

    for (const b of this.eshots) {
      if (!b.live) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      if (b.z > 12) b.live = false;
      else if (Math.abs(b.z) < 1.6 && Math.hypot(b.x - this.px, b.y - this.py) < 1.25) {
        b.live = false;
        this.hurt(b.dmg);
      } else if (bitN && Math.abs(b.z) < 4) {
        for (let i = 0; i < bitN; i++) {
          const a = this.bitAng + (i / bitN) * TAU;
          if (Math.hypot(b.x - (this.px + Math.cos(a) * 3), b.y - (this.py + Math.sin(a) * 2.2)) < 1.5) {
            b.live = false;
            this.boom(b.x, b.y, b.z, 3, this.glowWhite, 0.15);
            break;
          }
        }
      }
      b.s.position.set(b.x, b.y, b.z);
    }
    for (const b of this.eshots) if (!b.live) this.scene.remove(b.s), b.s.material.dispose();
    this.eshots = this.eshots.filter((b) => b.live);
  }

  private bossMove(f: Foe, dt: number): void {
    const final = f.type === 'boss';
    const rage = f.hp < f.max * 0.5 ? 1 : 0;
    f.x = Math.sin(f.t * (0.5 + rage * 0.2)) * (final ? 7 : 6);
    f.y = 1 + Math.sin(f.t * 0.9) * 2.6;
    f.fireT -= dt;
    const cyc = (f.t % (final ? 12 : 9));
    if (cyc < 4) {
      // fans of aimed shots
      if (f.fireT <= 0) {
        f.fireT = 1.15 - rage * 0.3;
        const n = final ? 5 : 3;
        for (let i = 0; i < n; i++) this.aimed(f, 52, 11, (i - (n - 1) / 2) * 3.4, 0);
        sfx('shot', 0.2);
      }
    } else if (cyc < 8) {
      // rings that open up as they come, with a gap to slip through
      if (f.fireT <= 0) {
        f.fireT = 1.5 - rage * 0.4;
        const n = final ? 16 : 12;
        const gap = Math.floor(this.rng() * n);
        for (let i = 0; i < n; i++) {
          if (i === gap || i === (gap + 1) % n) continue;
          const a = (i / n) * TAU;
          this.efire(f, Math.cos(a) * 9 + (this.px - f.x) * 0.5, Math.sin(a) * 9 + (this.py - f.y) * 0.5, 44, 10);
        }
        sfx('magic', 0.2);
      }
    } else if (final) {
      // a spiral, and reinforcements
      if (f.fireT <= 0) {
        f.fireT = 0.11;
        f.phase += 0.5;
        this.efire(f, Math.cos(f.phase) * 11 + (this.px - f.x) * 0.45, Math.sin(f.phase) * 11 + (this.py - f.y) * 0.45, 46, 10);
      }
      if (cyc > 11.9 - dt * 1.01 && this.foes.length < 8) {
        for (let i = 0; i < 3; i++) this.spawnFoe('bagel', (i - 1) * 7, -3, 0.9);
      }
    } else if (f.fireT <= 0) {
      f.fireT = 0.5;
      this.aimed(f, 58, 12);
    }
  }

  private stepWorld(dt: number): void {
    const v = this.speed * dt;
    for (const b of this.blocks) {
      b.z += v;
      b.m.rotation.y += b.spin * dt;
      b.m.position.set(b.x, b.y, b.z);
      if (b.solid && Math.abs(b.z) < b.r * 0.8 + 1 && Math.hypot(b.x - this.px, b.y - this.py) < b.r + 0.8) {
        if (this.inv <= 0 && this.rollT <= 0) {
          this.hurt(16);
          this.speed *= 0.55;
        }
      }
    }
    for (const b of this.blocks) {
      if (b.z > 30) {
        this.scene.remove(b.m);
        (b.m.material as THREE.Material).dispose();
      }
    }
    this.blocks = this.blocks.filter((b) => b.z <= 30);

    for (const r of this.rings) {
      r.z += v;
      r.m.position.set(r.x, r.y, r.z);
      r.m.rotation.z += dt * 2;
      if (!r.taken && Math.abs(r.z) < 2.5 && Math.hypot(r.x - this.px, r.y - this.py) < 3.2) {
        r.taken = true;
        this.boost = Math.min(1, this.boost + 0.45);
        this.speed += 14;
        this.hp = Math.min(this.maxHp, this.hp + 4);
        sfx('ring');
        this.boom(r.x, r.y, 0, 12, this.glowWarm, 0.3);
      }
    }
    for (const r of this.rings) if (r.taken || r.z > 20) this.scene.remove(r.m);
    this.rings = this.rings.filter((r) => !r.taken && r.z <= 20);

    for (const f of this.fx) {
      f.t += dt;
      const k = f.t / f.max;
      const sc = f.size * (0.3 + k * 0.9);
      f.s.scale.set(sc, sc, 1);
      f.s.material.opacity = 1 - k;
      f.s.position.z += v * 0.5;
    }
    for (const f of this.fx) if (f.t >= f.max) this.scene.remove(f.s), f.s.material.dispose();
    this.fx = this.fx.filter((f) => f.t < f.max);

    // stars, speed lines, clouds
    const pos = this.stars.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let z = pos.getZ(i) + v * 0.5;
      if (z > 20) z -= 600;
      pos.setZ(i, z);
    }
    pos.needsUpdate = true;
    for (const m of this.lines) {
      m.position.z += v * 2.6;
      if (m.position.z > 20) {
        m.position.z -= 280;
        m.position.x = this.px + (Math.random() - 0.5) * 70;
        m.position.y = this.py + (Math.random() - 0.5) * 40;
      }
    }
    for (const c of this.clouds) {
      c.position.z += v * 1.1;
      if (c.position.z > 30) c.position.z -= 500;
    }
  }

  /** Puts the fighter, the camera and the mood of the sky in place. */
  private place(dt: number, aim: Foe | null = null): void {
    const prog = clamp(this.dist / COURSE, 0, 1);
    // blue sky -> dusk -> space
    const a = clamp(prog / 0.4, 0, 1);
    const b = clamp((prog - 0.4) / 0.25, 0, 1);
    this.bg.setRGB(lerp(lerp(0.4, 0.13, a), 0.012, b), lerp(lerp(0.71, 0.13, a), 0.014, b), lerp(lerp(0.95, 0.38, a), 0.04, b));
    this.scene.background = this.bg;
    (this.scene.fog as THREE.Fog).color.copy(this.bg);
    (this.stars.material as THREE.PointsMaterial).opacity = clamp((prog - 0.22) / 0.25, 0, 1);
    const cloudA = clamp(1 - prog / 0.36, 0, 1) * 0.85;
    for (const c of this.clouds) {
      c.material.opacity = cloudA;
      c.visible = cloudA > 0.01;
    }
    (this.lines[0].material as THREE.MeshBasicMaterial).opacity = this.boosting ? 0.6 : 0.16;

    const roll = this.rollT > 0 ? (1 - this.rollT / 0.5) * TAU * this.rollDir : 0;
    this.ship.position.set(this.px, this.py, 0);
    this.ship.rotation.set(this.vy * 0.018, -this.vx * 0.012, -this.vx * 0.035 + roll);
    this.ship.visible = !(this.inv > 0 && Math.floor(this.time * 18) % 2 === 0);
    const fl = (this.boosting ? 2.3 : 1.1) + Math.sin(this.time * 40) * 0.15;
    this.flame.scale.set(fl, fl, 1);

    const n = this.bitSprites.length;
    for (let i = 0; i < n; i++) {
      const an = this.bitAng + (i / n) * TAU;
      this.bitSprites[i].position.set(this.px + Math.cos(an) * 3, this.py + Math.sin(an) * 2.2, Math.sin(an) * 0.8);
    }

    this.reticle.position.set(this.px, this.py, -46);
    if (aim) {
      this.lock.visible = true;
      this.lock.position.set(aim.x, aim.y, aim.z + 1);
      const sc = aim.r * 2.6 + Math.sin(this.time * 12) * 0.4;
      this.lock.scale.set(sc, sc, 1);
      this.lock.material.rotation += dt * 3;
    } else {
      this.lock.visible = false;
    }

    const sh = this.shake;
    this.camera.position.set(this.px * 0.62 + (Math.random() - 0.5) * sh, this.py * 0.6 + 2.2 + (Math.random() - 0.5) * sh, 13.5 + (this.boosting ? 1.6 : 0));
    this.camera.lookAt(this.px * 0.78, this.py * 0.74 + 0.4, -40);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  // ------------------------------------------------------------------ debug bot
  botStep(): { x: number; y: number; a: boolean; b: boolean } {
    let tx = 0;
    let ty = 0;
    const aim = this.foes.filter((f) => !f.dead && f.z < -8).sort((a, b) => b.z - a.z)[0];
    if (aim) {
      tx = aim.x;
      ty = aim.y;
    }
    let roll = false;
    let ax = clamp((tx - this.px) / 2, -1, 1);
    let ay = clamp((ty - this.py) / 2, -1, 1);
    for (const b of this.blocks) {
      if (!b.solid || b.z > 2 || b.z < -55) continue;
      const dx = this.px - b.x;
      const dy = this.py - b.y;
      const d = Math.hypot(dx, dy);
      if (d < b.r + 2.6) {
        ax += (dx / (d || 1)) * 2.4;
        ay += (dy / (d || 1)) * 2.4;
      }
    }
    for (const b of this.eshots) {
      if (b.z < -26 || b.z > 1) continue;
      const t = -b.z / b.vz;
      const dx = this.px - (b.x + b.vx * t);
      const dy = this.py - (b.y + b.vy * t);
      const d = Math.hypot(dx, dy);
      if (d < 2.4) {
        ax += (dx / (d || 1)) * 2 + (d < 0.2 ? 1 : 0);
        ay += (dy / (d || 1)) * 2;
        if (b.z > -5 && d < 1.4) roll = true;
      }
    }
    const l = Math.max(1, Math.hypot(ax, ay));
    return { x: ax / l, y: -ay / l, a: this.boost > 0.3 && !this.hold, b: roll };
  }
}
