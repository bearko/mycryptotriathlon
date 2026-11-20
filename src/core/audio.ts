// BGM (streamed <audio>), a handful of sampled effects, and small synthesized blips.
// Nothing here may throw: a browser that refuses audio must still run the game.

import { cat } from './catalog';
import { commit, save } from './save';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const buffers = new Map<string, AudioBuffer>();
let bgm: HTMLAudioElement | null = null;
let bgmKey = '';
let unlocked = false;
const lastPlayed = new Map<string, number>();

function ac(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = save().mute ? 0 : 0.9;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
  return ctx;
}

async function load(key: string): Promise<void> {
  const c = ac();
  const url = cat.se[key];
  if (!c || !url || buffers.has(key)) return;
  try {
    const res = await fetch(url);
    const buf = await c.decodeAudioData(await res.arrayBuffer());
    buffers.set(key, buf);
  } catch {
    /* the effect is simply silent */
  }
}

/** Call from the first tap / key press: browsers only allow sound after a gesture. */
export function unlockAudio(): void {
  if (unlocked) return;
  unlocked = true;
  const c = ac();
  if (c && c.state === 'suspended') void c.resume();
  for (const k of Object.keys(cat.se)) void load(k);
  if (bgmKey && bgm) void bgm.play().catch(() => undefined);
}

export function playBgm(key: string, volume = 0.45): void {
  if (bgmKey === key) return;
  bgmKey = key;
  try {
    if (bgm) {
      bgm.pause();
      bgm.src = '';
    }
    if (!key) {
      bgm = null;
      return;
    }
    bgm = new Audio(cat.bgm[key]);
    bgm.loop = true;
    bgm.volume = volume;
    bgm.muted = save().mute;
    if (unlocked) void bgm.play().catch(() => undefined);
  } catch {
    bgm = null;
  }
}

export function setMute(m: boolean): void {
  save().mute = m;
  commit();
  if (master) master.gain.value = m ? 0 : 0.9;
  if (bgm) bgm.muted = m;
}
export const isMuted = () => save().mute;

/** Sampled effect from the asset database. */
export function sample(key: string, volume = 0.6, rate = 1): void {
  const c = ctx;
  const buf = buffers.get(key);
  if (!c || !master || !buf || !unlocked) return;
  const now = c.currentTime;
  if (now - (lastPlayed.get(key) ?? -1) < 0.05) return;
  lastPlayed.set(key, now);
  try {
    const s = c.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rate;
    const g = c.createGain();
    g.gain.value = volume;
    s.connect(g).connect(master);
    s.start();
  } catch {
    /* ignore */
  }
}

type Wave = OscillatorType | 'noise';
function tone(wave: Wave, f0: number, f1: number, dur: number, vol: number, delay = 0): void {
  const c = ctx;
  if (!c || !master || !unlocked) return;
  try {
    const t0 = c.currentTime + delay;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    g.connect(master);
    if (wave === 'noise') {
      const n = Math.floor(c.sampleRate * dur);
      const b = c.createBuffer(1, n, c.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      const s = c.createBufferSource();
      s.buffer = b;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(f0, t0);
      f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + dur);
      s.connect(f).connect(g);
      s.start(t0);
    } else {
      const o = c.createOscillator();
      o.type = wave;
      o.frequency.setValueAtTime(f0, t0);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
      o.connect(g);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    }
  } catch {
    /* ignore */
  }
}

const SFX: Record<string, () => void> = {
  shot: () => tone('square', 880, 320, 0.07, 0.05),
  laser: () => tone('sawtooth', 1400, 500, 0.08, 0.04),
  slash: () => tone('noise', 5000, 800, 0.1, 0.1),
  magic: () => tone('sine', 520, 1040, 0.16, 0.07),
  beast: () => { tone('sawtooth', 140, 60, 0.3, 0.1); tone('noise', 900, 200, 0.3, 0.08); },
  aura: () => tone('triangle', 300, 900, 0.22, 0.07),
  hit: () => tone('square', 240, 90, 0.06, 0.06),
  kill: () => { tone('noise', 2600, 300, 0.12, 0.1); tone('square', 420, 120, 0.1, 0.05); },
  hurt: () => { tone('sawtooth', 220, 60, 0.25, 0.14); tone('noise', 1200, 200, 0.2, 0.1); },
  gem: () => tone('sine', 1200, 1800, 0.05, 0.035),
  pickup: () => { tone('square', 660, 660, 0.07, 0.07); tone('square', 990, 990, 0.1, 0.07, 0.07); },
  levelup: () => { tone('square', 523, 523, 0.09, 0.07); tone('square', 659, 659, 0.09, 0.07, 0.09); tone('square', 784, 784, 0.09, 0.07, 0.18); tone('square', 1046, 1046, 0.2, 0.07, 0.27); },
  dash: () => tone('noise', 3000, 600, 0.14, 0.09),
  harpoon: () => { tone('noise', 4000, 1500, 0.08, 0.1); tone('triangle', 500, 200, 0.12, 0.06); },
  bubble: () => tone('sine', 400, 1100, 0.14, 0.06),
  dig: () => tone('noise', 700, 300, 0.07, 0.07),
  gate: () => { tone('sawtooth', 110, 440, 0.5, 0.09); tone('square', 220, 880, 0.5, 0.05); },
  warn: () => { tone('square', 620, 620, 0.14, 0.07); tone('square', 620, 620, 0.14, 0.07, 0.22); },
  count: () => tone('square', 440, 440, 0.12, 0.09),
  go: () => tone('square', 880, 880, 0.4, 0.1),
  boost: () => tone('sawtooth', 200, 700, 0.3, 0.06),
  roll: () => tone('triangle', 900, 300, 0.25, 0.07),
  ring: () => { tone('sine', 880, 880, 0.08, 0.08); tone('sine', 1320, 1320, 0.15, 0.08, 0.06); },
  boom: () => { tone('noise', 1800, 60, 0.5, 0.2); tone('sine', 120, 30, 0.5, 0.2); },
  ui: () => tone('square', 700, 900, 0.05, 0.05),
  uiBack: () => tone('square', 500, 350, 0.06, 0.05),
  down: () => { tone('sawtooth', 400, 50, 0.6, 0.14); },
};

/** Synthesized blip, rate-limited per name so a crowd of enemies does not turn into noise. */
export function sfx(name: keyof typeof SFX | string, minGap = 0.04): void {
  const c = ctx;
  if (!c || !unlocked) return;
  const now = c.currentTime;
  if (now - (lastPlayed.get(name) ?? -1) < minGap) return;
  lastPlayed.set(name, now);
  SFX[name]?.();
}
