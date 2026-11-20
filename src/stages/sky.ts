// SKY: the last ten teams, one fighter each, flying into the screen until one is left.
// Guns only fire forward, so the fight is about position: brake to drop behind a rival and shoot, boost to
// pull away from one. Both burn the same energy, and a fighter that spends none slides back to the middle of the pack.
// Nobody can sit at the back: energy does not come back there. Out in front, exposed, it comes back fastest. The safe airspace narrows as the flight climbs from blue sky into space.

import * as THREE from 'three';
import { sample, sfx } from '../core/audio';
import { cat, traitsOf, type Hero, type Traits } from '../core/catalog';
import { input } from '../core/input';
import { clamp, lerp, makeRng, TAU, type Rng } from '../core/util';
import { earn, stats } from '../game/meta';
import { levelMul, type Run } from '../game/run';
import { DEFAULT_ARM, SKY_ARMS, tuneStats, type FighterStats } from '../game/tuning';
import type { Host, Stage, StageResult } from './stage';

const BX = 12;
const BY = 6.4;
const SPAWN_Z = -280;
const FIELD = 10;
/** Half the depth of the pack: how far ahead or behind the middle a fighter can sit. It closes in with the ring. */
const DEPTH0 = 34;
const DEPTH1 = 14;
/** The safe airspace starts to narrow, is at its smallest, and then nobody is safe anywhere. */
const SHRINK_FROM = 25;
const SHRINK_TO = 150;
const RING_MIN = 0.42;
const SUDDEN = 175;
/** Rivals: hull, sting, and how much harder their shots land on each other than on the player. */
/** Energy per second for a boost and for the brake, and how fast the brake drops a fighter back. */
const BOOST_COST = 0.3;
const BRAKE_COST = 0.42;
const BRAKE_SPEED = 15;
const RIVAL_HP = 420;
const RIVAL_HP_SPAN = 420;
const RIVAL_DMG = 11;
const RIVAL_DMG_SPAN = 8;
const RIVAL_X = 1.1;
/** How much of the player's fire a rival hull shrugs off (the sky's creatures take all of it). */
const PLAYER_X = 0.25;

interface Fighter {
  me: boolean; name: string; skill: number;
  g: THREE.Group; flame: THREE.Sprite; tag: THREE.Sprite | null; tagCv: HTMLCanvasElement | null; tagKey: string;
  x: number; y: number; z: number; vx: number; vy: number; vz: number; r: number;
  hp: number; maxHp: number; inv: number; bump: number; rollT: number; rollCd: number; rollDir: number; alive: boolean;
  tgt: Fighter | null; tail: Fighter | null; think: number; fireT: number; wob: number; dmg: number; top: number;
  lastBy: Fighter | null; kills: number; boosting: boolean;
  /** Rivals: energy for boosting and braking, and whether they are spending it on an attack right now. */
  en: number; hunting: boolean;
}
interface Foe {
  s: THREE.Sprite; x: number; y: number; z: number; r: number; hp: number; max: number;
  type: 'bagel' | 'letter' | 'heart';
  t: number; fireT: number; bx: number; by: number; holdZ: number; flash: number; dead: boolean;
  bitCd: number; name: string; vic: Fighter;
}
type Tgt = Foe | Fighter;
const isFoe = (t: Tgt): t is Foe => 'type' in t;
const gone = (t: Tgt) => (isFoe(t) ? t.dead : !t.alive);
interface Block { m: THREE.Mesh; x: number; y: number; z: number; r: number; solid: boolean; spin: number }
interface Ring { m: THREE.Mesh; x: number; y: number; z: number; taken: boolean }
interface Shot { m: THREE.Object3D; x: number; y: number; z: number; vx: number; vy: number; vz: number; dmg: number; life: number; target: Tgt | null; live: boolean; by: Fighter }
interface EShot { s: THREE.Sprite; x: number; y: number; z: number; vx: number; vy: number; vz: number; dmg: number; live: boolean }
interface Fx { s: THREE.Sprite; t: number; max: number; size: number }

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
  result?: StageResult;
  private run: Run;
  private traits: Traits;
  private rng: Rng;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(62, 1, 0.1, 700);
  private flame!: THREE.Sprite;
  private reticle: THREE.Sprite;
  private lock: THREE.Sprite;
  private stars: THREE.Points;
  private lines: THREE.Mesh[] = [];
  private clouds: THREE.Sprite[] = [];
  private frames: THREE.LineLoop[] = [];
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
  private rivalMat = new THREE.MeshBasicMaterial({ color: 0xff7a5c });
  private missileGeo = new THREE.BoxGeometry(0.34, 0.34, 1.2);
  private missileMat = new THREE.MeshBasicMaterial({ color: 0x8fb4ff });
  private ringGeo = new THREE.TorusGeometry(2.6, 0.22, 6, 20);
  private ringMat = new THREE.MeshBasicMaterial({ color: 0xffe45c });
  private frameMat = new THREE.LineBasicMaterial({ color: 0xff5cc8, transparent: true, opacity: 0.55, fog: false });

  private me!: Fighter;
  private fighters: Fighter[] = [];
  private boost = 0.6;
  private speed = 30;
  private st: FighterStats;
  private fireT = 0;
  private missileT = 1;
  private pulseT = 2;
  private bitAng = 0;
  private shake = 0;
  /** How much of the airspace is left (1 = all of it), and the half-depth of the pack right now. */
  private ring = 1;
  private depth = DEPTH0;
  private stormT = 0;
  private told = 0;
  private evT = 3;
  private evN = 0;
  private chatT = 9;
  private botHunt = false;

  private foes: Foe[] = [];
  private blocks: Block[] = [];
  private rings: Ring[] = [];
  private shots: Shot[] = [];
  private eshots: EShot[] = [];
  private fx: Fx[] = [];
  private bg = new THREE.Color();
  private ov: HTMLDivElement;
  private radar: HTMLCanvasElement;
  private warn: HTMLDivElement;
  private onResize = () => this.resize();

  constructor(private host: Host) {
    this.run = host.run;
    const pilot = this.run.heroes[2];
    this.traits = traitsOf(pilot);
    // unlike the courses of the land and the sea, no two dogfights are alike
    this.rng = makeRng(host.seed + 37 + Math.floor(Math.random() * 1e6));
    this.st = tuneStats(this.run);
    this.speed = 28 * (0.9 + 0.1 * this.traits.agi);

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

    // ---- the ten fighters
    const st = stats();
    const mine = new Set(this.run.heroes.map((h) => h.id));
    const pool: Hero[] = cat.heroes.filter((h) => !mine.has(h.id));
    const wing = [0x5878c0, 0xc05858, 0x58a06a, 0xb08a3a, 0x8a58c0, 0x3aa0b0, 0xc0589a, 0x7a8a3a, 0x4a5a9a, 0xb06a3a];
    this.me = this.addFighter(pilot, true, 0, wing[0]);
    this.me.maxHp = this.me.hp = this.st.hp;
    this.me.top = 17 * (0.9 + 0.1 * this.traits.agi) * (1 + this.st.engine / 260);
    for (let i = 1; i < FIELD; i++) {
      const art = pool.splice(Math.floor(this.rng() * pool.length), 1)[0];
      const skill = (i - 1) / (FIELD - 2);
      const r = this.addFighter(art, false, skill, wing[i]);
      r.maxHp = r.hp = Math.round((RIVAL_HP + RIVAL_HP_SPAN * skill) * (1 + st.rival));
      r.dmg = (RIVAL_DMG + RIVAL_DMG_SPAN * skill) * (1 + st.rival);
      r.top = 10 + 5 * skill;
    }
    // the grid: spread across the sky, the player a little behind the middle
    const order = this.fighters.slice().sort(() => this.rng() - 0.5);
    order.forEach((f, i) => {
      f.x = ((i % 5) - 2) * 4.6 + (this.rng() - 0.5);
      f.y = (i < 5 ? 2.4 : -2.4) + (this.rng() - 0.5);
      f.z = f.me ? 4 : -14 + this.rng() * 28;
    });
    // the weapons bought in the hangar, bolted on (the laser that comes with the hull sits on the nose)
    const hard: [number, number, number][] = [[-2.5, 0.35, 0.8], [2.5, 0.35, 0.8], [-1.3, 0.45, 1.2], [1.3, 0.45, 1.2]];
    const nose = this.sprite(DEFAULT_ARM.img, 0.8);
    nose.position.set(0, 0.25, -1.2);
    this.me.g.add(nose);
    (this.run.tune?.arms ?? []).forEach((id, i) => {
      const arm = SKY_ARMS.find((a) => a.id === id);
      if (!arm || i > 3) return;
      const s = this.sprite(arm.img, 0.95);
      s.position.set(...hard[i]);
      this.me.g.add(s);
      if (id === 'bits') {
        const n = 2 + Math.floor(this.st.bits / 30);
        for (let k = this.bitSprites.length; k < Math.min(5, n); k++) {
          const b = this.sprite(arm.img, 1.3);
          this.scene.add(b);
          this.bitSprites.push(b);
        }
      }
    });
    this.flame = this.me.flame;

    const rt = ringTexture();
    this.reticle = new THREE.Sprite(new THREE.SpriteMaterial({ map: rt, color: 0x9dffb0, transparent: true, opacity: 0.7, depthTest: false }));
    this.reticle.scale.set(3, 3, 1);
    this.scene.add(this.reticle);
    this.lock = new THREE.Sprite(new THREE.SpriteMaterial({ map: rt, color: 0xff5c7a, transparent: true, opacity: 0.9, depthTest: false }));
    this.lock.visible = false;
    this.scene.add(this.lock);

    // ---- the edge of the safe airspace: frames that rush past, as wide as the airspace is now
    const fg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1, -1, 0), new THREE.Vector3(1, -1, 0), new THREE.Vector3(1, 1, 0), new THREE.Vector3(-1, 1, 0)]);
    for (let i = 0; i < 9; i++) {
      const f = new THREE.LineLoop(fg, this.frameMat);
      f.position.z = -i * 36;
      this.scene.add(f);
      this.frames.push(f);
    }

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

    // ---- what the 3D view cannot show: who is behind (a small radar), and a shout when someone is on the tail
    this.ov = document.createElement('div');
    this.ov.className = 'sky-ov';
    this.ov.innerHTML = '<canvas class="sky-radar" width="96" height="132"></canvas><div class="sky-warn">▼ うしろに付かれた！ ブレーキで回りこめ</div>';
    host.mount.appendChild(this.ov);
    this.radar = this.ov.querySelector('canvas')!;
    this.warn = this.ov.querySelector<HTMLDivElement>('.sky-warn')!;

    this.resize();
    window.addEventListener('resize', this.onResize);
    host.hud.slots([]);
    host.hud.objective('前にいる相手を撃て！ 最後の1機になるまで');
    host.hud.say(`最終種目は空！ 残った${FIELD}機のバトルロワイヤルです！`, 3);
    host.hud.say('弾は前にしか飛びません。ブレーキで相手のうしろを取りましょう', 2, 'ain');
    host.hud.say('うしろにいる間はエネルギーが回復しません。前へ出るほど早く回復します', 2);
    this.status();
    this.place(0);
  }

  private addFighter(art: Hero, me: boolean, skill: number, wingColor: number): Fighter {
    const g = new THREE.Group();
    const hullMat = new THREE.MeshLambertMaterial({ color: me ? 0xe8eef7 : 0xcfd6e6, flatShading: true });
    const wingMat = new THREE.MeshLambertMaterial({ color: wingColor, flatShading: true });
    const dark = new THREE.MeshLambertMaterial({ color: 0x2b3350, flatShading: true });
    const hull = new THREE.Mesh(new THREE.ConeGeometry(0.7, 3.4, 5), hullMat);
    hull.rotation.x = -Math.PI / 2;
    g.add(hull);
    for (const sgn of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.1, 1), wingMat);
      wing.position.set(sgn * 1.25, -0.05, 0.6);
      wing.rotation.y = sgn * -0.32;
      wing.rotation.z = sgn * 0.08;
      g.add(wing);
      const gun = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 1.3), dark);
      gun.position.set(sgn * 1.9, 0, 0.1);
      g.add(gun);
    }
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.8), wingMat);
    fin.position.set(0, 0.45, 1.1);
    g.add(fin);
    const pilotS = this.sprite(art.img, 1.35);
    pilotS.position.set(0, 0.8, 0.1);
    g.add(pilotS);
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowWarm, blending: THREE.AdditiveBlending, depthWrite: false }));
    flame.position.set(0, -0.15, 1.7);
    g.add(flame);
    let tag: THREE.Sprite | null = null;
    let tagCv: HTMLCanvasElement | null = null;
    {
      // a name and a hull bar over every rival, and a marker over the player's own fighter.
      // They keep the same size on screen however far away the fighter is.
      tagCv = document.createElement('canvas');
      tagCv.width = 192;
      tagCv.height = 48;
      const tx = new THREE.CanvasTexture(tagCv);
      tx.colorSpace = THREE.SRGBColorSpace;
      tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, transparent: true, depthTest: false, fog: false, sizeAttenuation: false }));
      tag.scale.set(0.3, 0.075, 1);
      tag.position.set(0, me ? 2.1 : 2.5, 0);
      tag.renderOrder = 5;
      g.add(tag);
      if (me) {
        const c = tagCv.getContext('2d')!;
        c.font = 'bold 22px sans-serif';
        c.textAlign = 'center';
        c.lineWidth = 5;
        c.strokeStyle = '#000';
        c.strokeText('▼ YOU', 96, 30);
        c.fillStyle = '#7dffb0';
        c.fillText('▼ YOU', 96, 30);
      }
    }
    this.scene.add(g);
    const f: Fighter = {
      me, name: art.name, skill, g, flame, tag, tagCv, tagKey: '',
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 1.5,
      hp: 100, maxHp: 100, inv: 0, bump: 0, rollT: 0, rollCd: 0, rollDir: 1, alive: true,
      tgt: null, tail: null, think: this.rng(), fireT: 1 + this.rng(), wob: this.rng() * TAU, dmg: 0, top: 12,
      lastBy: null, kills: 0, boosting: false, en: 0.3 + this.rng() * 0.7, hunting: false,
    };
    this.fighters.push(f);
    return f;
  }

  private drawTag(f: Fighter): void {
    if (!f.tag || !f.tagCv || f.me) return;
    const frac = clamp(f.hp / f.maxHp, 0, 1);
    const hot = f.tgt === this.me && this.me.alive;
    const key = `${Math.ceil(frac * 24)}${hot ? 'h' : ''}`;
    if (key === f.tagKey) return;
    f.tagKey = key;
    const g = f.tagCv.getContext('2d')!;
    g.clearRect(0, 0, 192, 48);
    g.font = 'bold 20px sans-serif';
    g.textAlign = 'center';
    g.lineWidth = 5;
    g.strokeStyle = '#000';
    const name = f.name.length > 9 ? `${f.name.slice(0, 8)}…` : f.name;
    g.strokeText(name, 96, 20);
    g.fillStyle = hot ? '#ff8fa3' : '#ffffff';
    g.fillText(name, 96, 20);
    g.fillStyle = '#000';
    g.fillRect(28, 28, 136, 12);
    g.fillStyle = frac > 0.5 ? '#6dffa0' : frac > 0.25 ? '#ffd23f' : '#ff5c7a';
    g.fillRect(30, 30, 132 * frac, 8);
    (f.tag.material.map as THREE.CanvasTexture).needsUpdate = true;
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
    this.ov.remove();
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

  private alive(): Fighter[] {
    return this.fighters.filter((f) => f.alive);
  }
  private status(): void {
    const n = this.alive().length;
    this.host.hud.rank(n, FIELD, 0, 1, `残り ${n}機 ／ 撃墜 ${this.me.kills}`);
  }

  // ------------------------------------------------------------------ the sky's own creatures and wreckage
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
    }
    const s = this.sprite(art.img, size);
    this.scene.add(s);
    const live = this.alive();
    const f: Foe = {
      s, x, y, z: SPAWN_Z, r, hp, max: hp, type, t: 0, fireT: 1 + this.rng() * 1.5, bx: x, by: y,
      holdZ: -DEPTH0 - 18 - this.rng() * 30, flash: 0, dead: false, bitCd: 0, name: art.name,
      vic: live[Math.floor(this.rng() * live.length)] ?? this.me,
    };
    this.foes.push(f);
    return f;
  }

  /** Something new flies in: a flight of creatures, a field of wreckage, or a line of rings. */
  private event(prog: number): void {
    const r = this.rng;
    const cyc = this.evN++ % 5;
    const kind = cyc === 0 || cyc === 3 ? 'wave' : cyc === 1 ? 'blocks' : cyc === 2 ? 'rings' : r() < 0.5 ? 'blocks' : 'wave';
    const rx = BX * this.ring;
    const ry = BY * this.ring;
    if (kind === 'wave') {
      const n = 2 + Math.floor(prog * 2.4);
      const cx = (r() - 0.5) * rx;
      const cy = (r() - 0.5) * ry;
      const roll = r();
      const type: Foe['type'] = prog > 0.2 && roll < 0.25 ? 'heart' : roll < 0.6 ? 'bagel' : 'letter';
      for (let i = 0; i < n; i++) {
        const k = i - (n - 1) / 2;
        const f = this.spawnFoe(type, clamp(cx + k * 4.2, -rx, rx), clamp(cy + Math.abs(k) * 1.4 - 1, -ry, ry), prog);
        f.z = SPAWN_Z - i * 5;
      }
    } else if (kind === 'blocks') {
      const n = 5 + Math.floor(prog * 6);
      for (let i = 0; i < n; i++) {
        this.addBlock((r() - 0.5) * (rx * 2 + 4), (r() - 0.5) * (ry * 2 + 3), SPAWN_Z - r() * 46, 2.2 + r() * 2.6, true, prog, r);
      }
    } else {
      const sx = (r() - 0.5) * rx * 1.4;
      const sy = (r() - 0.5) * ry * 1.4;
      const dx = (r() - 0.5) * 7;
      const dy = (r() - 0.5) * 4;
      for (let i = 0; i < 3; i++) {
        const m = new THREE.Mesh(this.ringGeo, this.ringMat);
        const ring: Ring = { m, x: clamp(sx + dx * i, -rx + 1, rx - 1), y: clamp(sy + dy * i, -ry + 1, ry - 1), z: SPAWN_Z - i * 26, taken: false };
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
  private addShot(by: Fighter, x: number, y: number, z: number, vx: number, vy: number, vz: number, dmg: number, kind: 0 | 1 | 2 | 3, target: Tgt | null): void {
    const m = new THREE.Mesh(kind === 2 ? this.missileGeo : this.laserGeo, kind === 0 ? this.laserMat : kind === 1 ? this.spreadMat : kind === 2 ? this.missileMat : this.rivalMat);
    this.scene.add(m);
    this.shots.push({ m, x, y, z, vx, vy, vz, dmg, life: kind === 2 ? 2.4 : 1.3, target, live: true, by });
  }

  /** Everything in front of the player that can be shot: rivals first, then the sky's creatures. */
  private ahead(): Tgt[] {
    const me = this.me;
    const out: Tgt[] = [];
    for (const f of this.fighters) if (f.alive && !f.me && f.z < me.z - 3 && f.z > me.z - 120) out.push(f);
    for (const f of this.foes) if (!f.dead && f.z < me.z - 6 && f.z > me.z - 190) out.push(f);
    return out;
  }
  /** What the nose is roughly pointing at (aim assist). */
  private aimTarget(): Tgt | null {
    const me = this.me;
    let best: Tgt | null = null;
    let bd = this.st.aim;
    for (const f of this.ahead()) {
      const d = Math.hypot(f.x - me.x, f.y - me.y) - f.r * 0.7 - (isFoe(f) ? 0 : 0.6);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    return best;
  }

  private fireGuns(dt: number, target: Tgt | null): void {
    const st = this.st;
    const me = this.me;
    const lv = levelMul(this.run.level);
    const phys = this.traits.phy * lv * st.power;
    const mag = this.traits.int * lv * st.power;
    this.fireT -= dt;
    if (this.fireT <= 0) {
      this.fireT = 1 / Math.min(11, 5 + st.laser / 9);
      const dmg = (8 + st.laser * 0.13) * phys;
      for (const sgn of [-1, 1]) {
        const ox = me.x + sgn * 1.9;
        let vx = 0;
        let vy = 0;
        const vz = -230;
        if (target) {
          const tt = Math.max(0.08, (target.z - me.z) / vz);
          vx = (target.x - ox) / tt;
          vy = (target.y - me.y) / tt;
        }
        this.addShot(me, ox, me.y, me.z - 1.2, vx, vy, vz, dmg, 0, null);
        if (st.spread > 0) {
          const sd = (6 + st.spread * 0.15) * phys;
          const fan = st.spread > 40 ? [0.09, 0.19] : [0.11];
          for (const a of fan) this.addShot(me, ox, me.y, me.z - 1.2, vx + sgn * a * 230, vy, vz, sd, 1, null);
          if (st.spread > 20) this.addShot(me, ox, me.y, me.z - 1.2, vx, vy + (sgn > 0 ? 1 : -1) * 0.09 * 230, vz, sd, 1, null);
        }
      }
      sfx('laser', 0.09);
    }
    if (st.missile > 0) {
      this.missileT -= dt;
      if (this.missileT <= 0) {
        const live = this.ahead();
        if (live.length) {
          this.missileT = Math.max(0.7, 1.7 - st.missile / 90);
          const n = 1 + Math.floor(st.missile / 28);
          // rivals before creatures, the nearest first
          live.sort((a, b) => Number(isFoe(a)) - Number(isFoe(b)) || b.z - a.z);
          for (let i = 0; i < n; i++) {
            const t = live[i % live.length];
            this.addShot(me, me.x, me.y + 0.4, me.z - 0.5, (i - (n - 1) / 2) * 16, 14, -70, (16 + st.missile * 0.45) * mag, 2, t);
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
        // the one weapon that also reaches behind: it answers a rival sitting on the tail
        let any = false;
        const dmg = (30 + st.pulse * 1.1) * mag;
        for (const f of this.foes) {
          if (f.dead || Math.abs(f.z - me.z) > 60) continue;
          if (Math.hypot(f.x - me.x, f.y - me.y) < 11 + f.r) {
            any = true;
            this.hitFoe(f, dmg, me);
          }
        }
        for (const f of this.fighters) {
          if (!f.alive || f.me || Math.abs(f.z - me.z) > 30) continue;
          if (Math.hypot(f.x - me.x, f.y - me.y) < 9) {
            any = true;
            this.hurtFighter(f, dmg * PLAYER_X, me);
          }
        }
        for (const b of this.eshots) {
          if (b.live && Math.hypot(b.x - me.x, b.y - me.y) < 9 && Math.abs(b.z - me.z) < 40) {
            b.live = false;
            any = true;
          }
        }
        for (const s of this.shots) {
          if (s.live && !s.by.me && Math.hypot(s.x - me.x, s.y - me.y) < 8 && Math.abs(s.z - me.z) < 30) {
            s.live = false;
            any = true;
          }
        }
        if (any) {
          this.pulseT = Math.max(2.2, 4.8 - st.pulse / 40);
          this.boom(me.x, me.y, me.z - 4, 26, this.glowWhite, 0.4);
          sfx('aura', 0.2);
        } else {
          this.pulseT = 0.3;
        }
      }
    }
  }

  private hitFoe(f: Foe, dmg: number, by: Fighter | null): void {
    if (f.dead) return;
    f.hp -= dmg;
    f.flash = 0.08;
    if (by?.me) sfx('hit', 0.06);
    if (f.hp <= 0) {
      f.dead = true;
      this.boom(f.x, f.y, f.z, f.r * 5, this.glowWarm, 0.4);
      if (by?.me) {
        this.run.kills += 1;
        this.host.hud.ko();
        this.boost = Math.min(1, this.boost + 0.08);
        sfx('kill', 0.07);
      }
    }
  }

  /** Damage to a fighter. `by` is whoever fired it (null for the storm, wreckage and creatures). */
  private hurtFighter(f: Fighter, dmg: number, by: Fighter | null): void {
    if (!f.alive || f.inv > 0 || f.rollT > 0 || this.finished) return;
    if (f.me) dmg *= this.st.guard;
    f.hp -= dmg;
    if (by) f.lastBy = by;
    if (f.me) {
      f.inv = 0.45;
      this.shake = 0.6;
      sfx('hurt');
      this.host.hud.hurt();
    } else {
      f.inv = 0.05;
      if (by?.me) sfx('hit', 0.07);
    }
    if (f.hp <= 0) this.down(f);
  }

  private down(f: Fighter): void {
    if (!f.alive) return;
    const hud = this.host.hud;
    const left = this.alive().length - 1;
    f.alive = false;
    f.hp = 0;
    this.scene.remove(f.g);
    this.boom(f.x, f.y, f.z, 34, this.glowWarm, 0.8);
    for (let i = 0; i < 5; i++) this.boom(f.x + (Math.random() - 0.5) * 8, f.y + (Math.random() - 0.5) * 6, f.z, 14, this.glowWarm, 0.4 + Math.random() * 0.5);
    sample('blast', f.me ? 0.7 : 0.4);
    sfx('boom');
    const by = f.lastBy && f.lastBy.alive ? f.lastBy : null;
    if (by) {
      by.kills += 1;
      by.hp = Math.min(by.maxHp, by.hp + by.maxHp * (by.me ? 0.15 : 0.12));
    }
    if (f.me) {
      this.shake = 1.4;
      this.finished = true;
      this.result = { place: left + 1, field: FIELD, quota: 1, qualified: false, progress: (FIELD - 1 - left) / (FIELD - 1), gates: this.me.kills };
      return;
    }
    if (by?.me) {
      this.run.kills += 1;
      this.boost = 1;
      this.shake = 0.8;
      hud.banner('撃墜！', `${f.name} ／ 残り ${left}機`, 'good');
      hud.say(`${this.me.name}が${f.name}を撃墜！ 残り${left}機！`, 3);
    } else if (by) hud.say(`${by.name}が${f.name}を撃墜！ 残り${left}機！`, left <= 3 ? 3 : 2);
    else hud.say(`${f.name}、空域の外で力つきた！ 残り${left}機！`, left <= 3 ? 3 : 2, 'ain');
    if (left === 3) hud.say('残り3機！ ここからが本当の勝負です！', 3, 'ain');
    if (left === 2) hud.say(`ついに一騎打ち！ ${this.me.name} 対 ${this.alive().find((o) => !o.me)?.name ?? ''}！`, 3);
    this.status();
    if (left === 1 && this.me.alive) {
      this.finished = true;
      this.result = { place: 1, field: FIELD, quota: 1, qualified: true, progress: 1, gates: this.me.kills };
      earn('sky');
      sample('clear', 0.7);
    }
  }

  private boom(x: number, y: number, z: number, size: number, tex: THREE.Texture, life: number): void {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.position.set(x, y, z);
    this.scene.add(s);
    this.fx.push({ s, t: 0, max: life, size });
  }

  private efire(f: Foe, vx: number, vy: number, vz: number, dmg: number): void {
    if (this.eshots.length > 200) return;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowPink, depthWrite: false, transparent: true, fog: false }));
    s.scale.set(2.3, 2.3, 1);
    this.scene.add(s);
    this.eshots.push({ s, x: f.x, y: f.y, z: f.z + 1, vx, vy, vz, dmg, live: true });
  }
  /** A creature's shot, aimed at where its mark is now. */
  private aimed(f: Foe, speed: number, dmg: number, offX = 0, offY = 0): void {
    const v = f.vic;
    const t = Math.max(0.2, (v.z - f.z) / speed);
    this.efire(f, (v.x + offX - f.x) / t, (v.y + offY - f.y) / t, speed, dmg);
  }

  // ------------------------------------------------------------------ the rivals
  /**
   * Where a fighter wants to be: lined up behind the nearest fighter ahead; and if somebody is lined up
   * behind it, weaving and dropping back to turn the tables. Used by the rivals and by the debug bot.
   */
  private decide(f: Fighter): { x: number; y: number; z: number } {
    const rx = BX * this.ring * 0.85;
    const ry = BY * this.ring * 0.85;
    let tx: number;
    let ty: number;
    let tz: number;
    const t = f.tgt;
    if (t && t.alive) {
      const slop = (1 - f.skill) * 1.2;
      tx = t.x + Math.sin(this.time * 1.7 + f.wob) * slop;
      ty = t.y + Math.cos(this.time * 1.3 + f.wob) * slop * 0.6;
      tz = t.z + 11 + (1 - f.skill) * 7;
    } else {
      // nobody to go after: wander, and let the pack carry the fighter
      tx = Math.sin(this.time * 0.5 + f.wob) * rx * 0.7;
      ty = Math.cos(this.time * 0.4 + f.wob * 2) * ry * 0.7;
      tz = f.z;
    }
    // out of energy: the bold go out in front, where it comes back fastest
    if (!f.me && !f.hunting && !f.tail && f.skill > 0.5 && f.en > 0.12 && f.en < 0.5) tz = -9;
    if (f.tail) {
      // somebody is lined up behind: weave, and (for those who think of it) drop back behind them in turn
      tx += Math.sin(this.time * 3.2 + f.wob) * 5.5;
      ty += Math.cos(this.time * 2.6 + f.wob) * 2.6;
      if (f.skill > 0.35 || f.me) tz = Math.max(tz, f.tail.z + 9);
    }
    // wreckage in the way
    for (const b of this.blocks) {
      if (!b.solid || b.z > f.z + 2 || b.z < f.z - 55) continue;
      const dx = f.x - b.x;
      const dy = f.y - b.y;
      const d = Math.hypot(dx, dy);
      if (d < b.r + 2.8) {
        tx += (dx / (d || 1)) * 5;
        ty += (dy / (d || 1)) * 4;
      }
    }
    return { x: clamp(tx, -rx, rx), y: clamp(ty, -ry, ry), z: clamp(tz, -this.depth + 2, this.depth - 2) };
  }

  /** Picks who a fighter goes after, and notices who is after it. */
  private scan(f: Fighter): void {
    let best: Fighter | null = null;
    let bs = 1e9;
    let tail: Fighter | null = null;
    for (const o of this.fighters) {
      if (o === f || !o.alive) continue;
      const lat = Math.hypot(o.x - f.x, o.y - f.y);
      // whoever is easiest to get behind; the wounded draw fire, so does whoever just hit you, and so does an ace
      // …but nobody piles onto a fighter two others are already after
      let crowd = 0;
      for (const x of this.fighters) if (x.alive && x !== f && x.tgt === o) crowd++;
      const sc = lat + Math.max(0, crowd - 1) * 4 + Math.abs(o.z + 10 - f.z) * 0.25 - (o.hp < o.maxHp * 0.35 ? 4 : 0) - (f.lastBy === o ? 2 : 0) - o.kills * 1.2 + (f.tgt === o ? -1.5 : 0);
      if (sc < bs) {
        bs = sc;
        best = o;
      }
      if (o.z > f.z + 2 && lat < 3.4 && (o.me || o.tgt === f)) tail = o;
    }
    f.tgt = best;
    f.tail = tail;
  }

  private rivalAI(r: Fighter, dt: number): void {
    r.think -= dt;
    if (r.think <= 0) {
      r.think = 0.3 + this.rng() * 0.3;
      this.scan(r);
      // a roll out of the line of fire, for those quick enough to think of it
      if (r.tail && r.rollCd <= 0 && this.rng() < 0.15 + r.skill * 0.4) {
        r.rollT = 0.45;
        r.rollCd = 3.5 - r.skill * 1.2;
        r.rollDir = this.rng() < 0.5 ? -1 : 1;
      }
    }
    // an attack is paid for in energy: go for it on a full tank, coast when it runs dry
    if (r.hunting && r.en < 0.08) r.hunting = false;
    else if (!r.hunting && r.en > 0.45 + (1 - r.skill) * 0.25) r.hunting = true;
    const want = this.decide(r);
    const k = 1 - Math.pow(0.02, dt);
    r.vx += (clamp((want.x - r.x) * 2.4, -r.top, r.top) - r.vx) * k;
    r.vy += (clamp((want.y - r.y) * 2.4, -r.top * 0.8, r.top * 0.8) - r.vy) * k;
    const push = clamp((want.z - r.z) * 1.5, -22, 20);
    const spend = (r.hunting || (r.tail && r.en > 0.2) || push < -6) && Math.abs(push) > 3 && r.en > 0.02;
    if (spend) r.en = Math.max(0, r.en - (push > 0 ? BRAKE_COST : BOOST_COST) * dt);
    else r.en = Math.min(1, r.en + (0.14 + r.skill * 0.08) * this.charge(r.z) * dt);
    r.vz += ((spend ? clamp(push, -22, BRAKE_SPEED) : this.coast(r.z)) - r.vz) * k;
    r.boosting = r.vz < -6;
    r.x = clamp(r.x + r.vx * dt, -BX, BX);
    r.y = clamp(r.y + r.vy * dt, -BY, BY);
    r.z = clamp(r.z + r.vz * dt, -this.depth, this.depth + 6);

    r.fireT -= dt;
    const t = r.tgt;
    if (t && t.alive && r.fireT <= 0 && this.time > 3 && t.z < r.z - 2 && r.z - t.z < 70 && Math.hypot(t.x - r.x, t.y - r.y) < 2.6) {
      r.fireT = 0.52 - 0.16 * r.skill;
      // the guns warm up as the fight goes on: nobody is shot out of the sky in the first moments
      const vz = -150;
      const tt = Math.max(0.05, (t.z - r.z) / vz);
      const miss = (1 - r.skill) * 14;
      this.addShot(r, r.x, r.y, r.z - 1.5, (t.x - r.x) / tt + (this.rng() - 0.5) * miss, (t.y - r.y) / tt + (this.rng() - 0.5) * miss, vz, r.dmg * lerp(0.55, 1.25, clamp(this.time / 120, 0, 1)), 3, null);
      if (Math.abs(r.z - this.me.z) < 40) sfx('shot', 0.05);
    }
  }

  /** With no thrust either way, a fighter slides back toward the middle of the pack. */
  private coast(z: number): number {
    return clamp(-z * 0.6, -10, 10);
  }
  /** How fast energy comes back at a depth: not at all behind the pack, fastest out in front of it. */
  private charge(z: number): number {
    return z > 4 ? 0 : z < -6 ? 2.2 : 1;
  }

  // ------------------------------------------------------------------ update
  update(dt: number): void {
    if (this.finished) return;
    this.time += dt;
    const hud = this.host.hud;
    const me = this.me;
    const prog = clamp(this.time / SHRINK_TO, 0, 1);

    // the airspace
    const k = clamp((this.time - SHRINK_FROM) / (SHRINK_TO - SHRINK_FROM), 0, 1);
    this.ring = lerp(1, RING_MIN, k);
    this.depth = lerp(DEPTH0, DEPTH1, k);
    if (this.told === 0 && this.time > SHRINK_FROM) {
      this.told = 1;
      sfx('warn');
      hud.banner('空域が狭まる', '枠の外と、うしろの嵐にいると機体がけずられる', 'warn');
      hud.say('安全な空域が狭まりはじめました！ 枠の中へ！', 3, 'ain');
    } else if (this.told === 1 && k > 0.55) {
      this.told = 2;
      hud.say('空域はもう半分！ 逃げ場がなくなってきました！', 2);
    } else if (this.told === 2 && this.time > SUDDEN) {
      this.told = 3;
      sfx('warn');
      hud.banner('サドンデス', '嵐が空域をのみこむ。全機の機体がけずられていく', 'warn');
      hud.say('時間切れ、サドンデス！ 最後まで飛んでいた1機が勝者です！', 3);
    }

    // steering: the stick moves across the sky, boost goes ahead of the pack, the brake drops behind it
    const ax = input.move.x;
    const ay = -input.move.y;
    const top = me.top * (me.rollT > 0 ? 1.7 : 1);
    const kk = 1 - Math.pow(0.0006, dt);
    me.vx += (ax * top - me.vx) * kk;
    me.vy += (ay * top - me.vy) * kk;
    me.x = clamp(me.x + me.vx * dt, -BX, BX);
    me.y = clamp(me.y + me.vy * dt, -BY, BY);
    // the brake opens with a quick roll that shrugs off shots
    if (input.bPressed && me.rollCd <= 0 && me.rollT <= 0) {
      me.rollT = 0.5;
      me.rollCd = 1.6;
      me.rollDir = ax < 0 ? 1 : -1;
      sfx('roll');
    }
    // boost and brake burn the same energy
    const boosting = input.a && !input.b && this.boost > 0.02;
    const braking = input.b && this.boost > 0.02;
    if (boosting && !me.boosting) sfx('boost', 0.3);
    me.boosting = boosting;
    if (boosting || braking) this.boost = Math.max(0, this.boost - (braking ? BRAKE_COST : BOOST_COST) * dt);
    else this.boost = Math.min(1, this.boost + (0.11 + this.st.en) * this.charge(me.z) * dt);
    const wantZ = boosting ? -26 : braking ? BRAKE_SPEED : this.coast(me.z);
    me.vz += (wantZ - me.vz) * (1 - Math.pow(0.01, dt));
    me.z = clamp(me.z + me.vz * dt, -this.depth, this.depth + 6);

    me.think -= dt;
    if (me.think <= 0) {
      me.think = 0.25;
      this.scan(me);
    }
    for (const f of this.fighters) {
      if (!f.alive) continue;
      f.inv = Math.max(0, f.inv - dt);
      f.bump = Math.max(0, f.bump - dt);
      f.rollCd = Math.max(0, f.rollCd - dt);
      f.rollT = Math.max(0, f.rollT - dt);
      if (!f.me) this.rivalAI(f, dt);
    }
    if (me.rollT > 0) {
      for (const b of this.eshots) {
        if (b.live && Math.abs(b.z - me.z) < 5 && Math.hypot(b.x - me.x, b.y - me.y) < 3.4) {
          b.live = false;
          this.boom(b.x, b.y, b.z, 4, this.glowWhite, 0.2);
        }
      }
    }

    // outside the airspace, behind the pack, and (at the very end) everywhere: the storm eats the hull
    this.stormT -= dt;
    if (this.stormT <= 0) {
      this.stormT = 0.25;
      const rx = BX * this.ring + 0.6;
      const ry = BY * this.ring + 0.6;
      const all = this.time > SUDDEN ? 0.02 + (this.time - SUDDEN) * 0.0025 : 0;
      for (const f of this.fighters) {
        if (!f.alive) continue;
        const out = Math.abs(f.x) > rx || Math.abs(f.y) > ry || f.z > this.depth + 0.5;
        const rate = (out ? 0.07 : 0) + all;
        if (rate <= 0) continue;
        f.hp -= f.maxHp * rate * 0.25;
        if (f.me) {
          hud.hurt();
          sfx('hurt', 0.12);
        }
        if (f.hp <= 0) {
          if (out) f.lastBy = null;
          this.down(f);
          if (this.finished) return;
        }
      }
    }

    // what flies in
    this.evT -= dt;
    if (this.evT <= 0) {
      this.evT = 4.2 - prog * 1.2 + this.rng() * 1.5;
      this.event(prog);
    }

    const aim = this.time > 2 ? this.aimTarget() : null;
    if (this.time > 2) this.fireGuns(dt, aim);
    this.stepShots(dt);
    if (this.finished) return;
    this.stepFoes(dt, prog);
    if (this.finished) return;
    this.stepWorld(dt);
    if (this.finished) return;
    this.shake = Math.max(0, this.shake - dt * 2.5);

    this.chatT -= dt;
    if (this.chatT <= 0) {
      this.chatT = 10 + this.rng() * 5;
      const live = this.alive();
      const top = live.slice().sort((a, b) => b.kills - a.kills)[0];
      const lines = [
        `残り${live.length}機。${me.tail ? `${me.name}、うしろに付かれています！` : `${me.name}はまだ飛んでいます！`}`,
        'うしろを取られたら、ブレーキで相手のさらにうしろへ！',
        'エネルギーが切れたら前へ。先頭ほど早く回復します',
        'リングをくぐると、ブーストと機体が少し回復します',
      ];
      if (top && top.kills > 0) lines.push(`ここまでの撃墜王は ${top.name}、${top.kills}機！`);
      hud.say(lines[Math.floor(this.rng() * lines.length)], 1, this.rng() < 0.5 ? 'ain' : 'chris');
    }

    this.status();
    hud.gauge(clamp(me.hp / me.maxHp, 0, 1), `${Math.max(0, Math.ceil(me.hp))}`);
    hud.sub(this.boost);
    hud.progress(k, []);
    hud.level(this.run.level, 0);
    this.place(dt, aim);
    this.drawRadar();
  }

  private stepShots(dt: number): void {
    const me = this.me;
    for (const s of this.shots) {
      if (!s.live) continue;
      s.life -= dt;
      if (s.target) {
        if (gone(s.target)) s.target = null;
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
      if (s.life <= 0 || s.z < me.z - 300) {
        s.live = false;
        continue;
      }
      for (const f of this.fighters) {
        if (!f.alive || f === s.by) continue;
        if (Math.abs(f.z - s.z) < 2.8 && Math.hypot(f.x - s.x, f.y - s.y) < f.r + 0.5) {
          s.live = false;
          this.hurtFighter(f, s.by.me ? s.dmg * PLAYER_X : f.me ? s.dmg : s.dmg * RIVAL_X, s.by);
          this.boom(s.x, s.y, f.z + 1, 2.4, this.glowWhite, 0.12);
          break;
        }
      }
      if (this.finished) return;
      if (!s.live) continue;
      for (const f of this.foes) {
        if (f.dead) continue;
        if (Math.abs(f.z - s.z) < 3.4 + f.r * 0.5 && Math.hypot(f.x - s.x, f.y - s.y) < f.r + 0.5) {
          s.live = false;
          this.hitFoe(f, s.by.me ? s.dmg : s.dmg * 3, s.by);
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
    const me = this.me;
    const bitN = this.bitSprites.length;
    this.bitAng += dt * 3.4;
    const live = this.alive();
    for (const f of this.foes) {
      if (f.dead) continue;
      f.t += dt;
      f.flash = Math.max(0, f.flash - dt);
      f.bitCd = Math.max(0, f.bitCd - dt);
      if (!f.vic.alive) f.vic = live[Math.floor(this.rng() * live.length)] ?? me;
      if (f.type === 'letter') {
        // dives straight at its mark
        f.z += (this.speed + 58) * dt;
        const kk = 1 - Math.pow(0.35, dt);
        if (f.z < f.vic.z - 14) {
          f.x += (f.vic.x - f.x) * kk;
          f.y += (f.vic.y - f.y) * kk;
        }
      } else if (f.z < f.holdZ) {
        f.z = Math.min(f.holdZ, f.z + (this.speed + 95) * dt);
      } else if (f.t > (f.type === 'heart' ? 10 : 8)) {
        f.z += (this.speed + 30) * dt;
        f.y += 9 * dt;
      } else {
        f.x = clamp(f.bx + Math.sin(f.t * 1.4 + f.by) * 3.2, -BX - 2, BX + 2);
        f.y = clamp(f.by + Math.cos(f.t * 1.1 + f.bx) * 1.6, -BY - 1, BY + 1);
        f.fireT -= dt;
        if (f.fireT <= 0) {
          if (f.type === 'heart') {
            f.fireT = 3.2 - prog * 0.8;
            for (const o of [-3.2, 0, 3.2]) this.aimed(f, 44, 9, o, 0);
          } else {
            f.fireT = 2.8 - prog * 0.9;
            this.aimed(f, 48 + prog * 8, 8);
          }
        }
      }
      // shield bits, and running into things
      if (bitN && f.bitCd <= 0 && Math.abs(f.z - me.z) < 4 + f.r && Math.hypot(f.x - me.x, f.y - me.y) < 3.6 + f.r) {
        f.bitCd = 0.3;
        this.hitFoe(f, (22 + this.st.bits * 0.6) * levelMul(this.run.level), me);
      }
      if (!f.dead) {
        for (const ft of live) {
          if (ft.alive && ft.bump <= 0 && Math.abs(f.z - ft.z) < 2.2 && Math.hypot(f.x - ft.x, f.y - ft.y) < f.r * 0.8 + 0.9) {
            ft.bump = 0.6;
            this.hurtFighter(ft, ft.me ? 14 : ft.maxHp * 0.05, null);
          }
        }
      }
      if (this.finished) return;
      if (f.z > DEPTH0 + 24) f.dead = true;
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
      if (b.z > DEPTH0 + 20) b.live = false;
      else {
        for (const ft of live) {
          if (ft.alive && Math.abs(b.z - ft.z) < 1.6 && Math.hypot(b.x - ft.x, b.y - ft.y) < 1.25) {
            b.live = false;
            this.hurtFighter(ft, ft.me ? b.dmg : ft.maxHp * 0.03, null);
            break;
          }
        }
        if (this.finished) return;
        if (b.live && bitN && Math.abs(b.z - me.z) < 4) {
          for (let i = 0; i < bitN; i++) {
            const a = this.bitAng + (i / bitN) * TAU;
            if (Math.hypot(b.x - (me.x + Math.cos(a) * 3), b.y - (me.y + Math.sin(a) * 2.2)) < 1.5) {
              b.live = false;
              this.boom(b.x, b.y, b.z, 3, this.glowWhite, 0.15);
              break;
            }
          }
        }
      }
      b.s.position.set(b.x, b.y, b.z);
    }
    for (const b of this.eshots) if (!b.live) this.scene.remove(b.s), b.s.material.dispose();
    this.eshots = this.eshots.filter((b) => b.live);

    // the shield bits also swat rival shots coming up from behind, and scrape rivals who fly too close
    if (bitN) {
      for (const s of this.shots) {
        if (!s.live || s.by.me || Math.abs(s.z - me.z) > 4) continue;
        for (let i = 0; i < bitN; i++) {
          const a = this.bitAng + (i / bitN) * TAU;
          if (Math.hypot(s.x - (me.x + Math.cos(a) * 3), s.y - (me.y + Math.sin(a) * 2.2)) < 1.6) {
            s.live = false;
            this.boom(s.x, s.y, s.z, 3, this.glowWhite, 0.15);
            break;
          }
        }
      }
      for (const r of live) {
        if (r.me || !r.alive || r.bump > 0) continue;
        if (Math.abs(r.z - me.z) < 5 && Math.hypot(r.x - me.x, r.y - me.y) < 4.6) {
          r.bump = 0.4;
          this.hurtFighter(r, (18 + this.st.bits * 0.5) * levelMul(this.run.level) * PLAYER_X, me);
        }
      }
    }
  }

  private stepWorld(dt: number): void {
    const me = this.me;
    const v = this.speed * dt;
    const live = this.alive();
    for (const b of this.blocks) {
      b.z += v;
      b.m.rotation.y += b.spin * dt;
      b.m.position.set(b.x, b.y, b.z);
      if (!b.solid) continue;
      for (const f of live) {
        if (f.alive && f.bump <= 0 && f.rollT <= 0 && Math.abs(b.z - f.z) < b.r * 0.8 + 1 && Math.hypot(b.x - f.x, b.y - f.y) < b.r + 0.8) {
          f.bump = 0.7;
          this.hurtFighter(f, f.me ? 16 : f.maxHp * 0.06, null);
          f.vz += 10;
        }
      }
      if (this.finished) return;
    }
    for (const b of this.blocks) {
      if (b.z > DEPTH0 + 40) {
        this.scene.remove(b.m);
        (b.m.material as THREE.Material).dispose();
      }
    }
    this.blocks = this.blocks.filter((b) => b.z <= DEPTH0 + 40);

    for (const r of this.rings) {
      r.z += v;
      r.m.position.set(r.x, r.y, r.z);
      r.m.rotation.z += dt * 2;
      for (const f of live) {
        if (r.taken || !f.alive || Math.abs(r.z - f.z) > 2.5 || Math.hypot(r.x - f.x, r.y - f.y) > 3.2) continue;
        r.taken = true;
        f.hp = Math.min(f.maxHp, f.hp + f.maxHp * 0.06);
        if (f.me) {
          this.boost = Math.min(1, this.boost + 0.45);
          sfx('ring');
        }
        this.boom(r.x, r.y, r.z, 12, this.glowWarm, 0.3);
      }
    }
    for (const r of this.rings) if (r.taken || r.z > DEPTH0 + 30) this.scene.remove(r.m);
    this.rings = this.rings.filter((r) => !r.taken && r.z <= DEPTH0 + 30);

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

    // stars, speed lines, clouds, and the frames that mark the airspace
    const pos = this.stars.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let z = pos.getZ(i) + v * 0.5;
      if (z > 20) z -= 600;
      pos.setZ(i, z);
    }
    pos.needsUpdate = true;
    const rush = me.boosting ? 4 : 2.6;
    for (const m of this.lines) {
      m.position.z += v * rush;
      if (m.position.z > me.z + 20) {
        m.position.z -= 280;
        m.position.x = me.x + (Math.random() - 0.5) * 70;
        m.position.y = me.y + (Math.random() - 0.5) * 40;
      }
    }
    for (const c of this.clouds) {
      c.position.z += v * 1.1;
      if (c.position.z > 50) c.position.z -= 500;
    }
    for (const f of this.frames) {
      f.position.z += v * 1.6;
      if (f.position.z > me.z + 8) f.position.z -= 9 * 36;
      f.scale.set(BX * this.ring + 1.6, BY * this.ring + 1.4, 1);
    }
  }

  /** Puts the fighters, the camera and the mood of the sky in place. */
  private place(dt: number, aim: Tgt | null = null): void {
    const me = this.me;
    const prog = clamp(this.time / SHRINK_TO, 0, 1);
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
    (this.lines[0].material as THREE.MeshBasicMaterial).opacity = me.boosting ? 0.6 : 0.16;
    this.frameMat.opacity = 0.35 + (this.ring < 1 ? 0.3 : 0) + Math.sin(this.time * 5) * 0.08;

    for (const f of this.fighters) {
      if (!f.alive) continue;
      const roll = f.rollT > 0 ? (1 - f.rollT / 0.5) * TAU * f.rollDir : 0;
      f.g.position.set(f.x, f.y, f.z);
      f.g.rotation.set(f.vy * 0.018, -f.vx * 0.012, -f.vx * 0.035 + roll);
      const fl = (f.boosting ? 2.3 : 1.1) + Math.sin(this.time * 40 + f.wob) * 0.15;
      f.flame.scale.set(fl, fl, 1);
      if (f.me) f.g.visible = !(f.inv > 0 && Math.floor(this.time * 18) % 2 === 0);
      else this.drawTag(f);
    }

    const n = this.bitSprites.length;
    for (let i = 0; i < n; i++) {
      const an = this.bitAng + (i / n) * TAU;
      this.bitSprites[i].position.set(me.x + Math.cos(an) * 3, me.y + Math.sin(an) * 2.2, me.z + Math.sin(an) * 0.8);
      this.bitSprites[i].visible = me.alive;
    }

    this.reticle.position.set(me.x, me.y, me.z - 46);
    if (aim && !gone(aim)) {
      this.lock.visible = true;
      this.lock.position.set(aim.x, aim.y, aim.z + 1);
      const sc = aim.r * 2.6 + Math.sin(this.time * 12) * 0.4;
      this.lock.scale.set(sc, sc, 1);
      this.lock.material.rotation += dt * 3;
    } else {
      this.lock.visible = false;
    }
    this.warn.classList.toggle('on', !!me.tail && me.alive);

    const sh = this.shake;
    this.camera.position.set(me.x * 0.62 + (Math.random() - 0.5) * sh, me.y * 0.6 + 2.2 + (Math.random() - 0.5) * sh, me.z + 13.5 + (me.boosting ? 1.6 : 0));
    this.camera.lookAt(me.x * 0.78, me.y * 0.74 + 0.4, me.z - 40);
  }

  /** From above: ahead is up. Rivals behind the player cannot be seen any other way. */
  private drawRadar(): void {
    const g = this.radar.getContext('2d')!;
    const W = 96;
    const Hh = 132;
    const me = this.me;
    g.clearRect(0, 0, W, Hh);
    g.fillStyle = 'rgba(6,10,24,0.72)';
    g.fillRect(0, 0, W, Hh);
    const sx = (x: number) => W / 2 + (x / (BX + 1)) * (W / 2 - 4);
    const sy = (z: number) => Hh / 2 + (z / (DEPTH0 + 8)) * (Hh / 2 - 4);
    // the storm behind, and the edge of the airspace
    g.fillStyle = 'rgba(255,92,200,0.28)';
    g.fillRect(0, sy(this.depth), W, Hh);
    g.fillRect(0, 0, sx(-BX * this.ring), Hh);
    g.fillRect(sx(BX * this.ring), 0, W, Hh);
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.strokeRect(0.5, 0.5, W - 1, Hh - 1);
    for (const f of this.fighters) {
      if (!f.alive || f.me) continue;
      const hot = f.tgt === me && f.z > me.z;
      g.fillStyle = hot ? (Math.floor(this.time * 8) % 2 ? '#ffffff' : '#ff5c7a') : f.z > me.z ? '#ff9a5c' : '#ffd23f';
      g.beginPath();
      g.arc(sx(f.x), sy(f.z), hot ? 4 : 3, 0, TAU);
      g.fill();
    }
    g.fillStyle = '#7dffb0';
    g.beginPath();
    g.moveTo(sx(me.x), sy(me.z) - 6);
    g.lineTo(sx(me.x) + 4.5, sy(me.z) + 4);
    g.lineTo(sx(me.x) - 4.5, sy(me.z) + 4);
    g.fill();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  // ------------------------------------------------------------------ debug bot
  botStep(): { x: number; y: number; a: boolean; b: boolean } {
    const me = this.me;
    const want = this.decide(me);
    let ax = clamp((want.x - me.x) / 2, -1, 1);
    let ay = clamp((want.y - me.y) / 2, -1, 1);
    for (const b of this.eshots) {
      if (b.z < me.z - 26 || b.z > me.z + 1) continue;
      const t = (me.z - b.z) / b.vz;
      const dx = me.x - (b.x + b.vx * t);
      const dy = me.y - (b.y + b.vy * t);
      const d = Math.hypot(dx, dy);
      if (d < 2.4) {
        ax += (dx / (d || 1)) * 2 + (d < 0.2 ? 1 : 0);
        ay += (dy / (d || 1)) * 2;
      }
    }
    const l = Math.max(1, Math.hypot(ax, ay));
    // like the rivals: an attack on a full tank, then coast
    if (this.botHunt && this.boost < 0.08) this.botHunt = false;
    else if (!this.botHunt && this.boost > 0.6) this.botHunt = true;
    const go = this.botHunt || !!me.tail;
    return { x: ax / l, y: -ay / l, a: go && want.z < me.z - 4, b: go && want.z > me.z + 4 };
  }
}
