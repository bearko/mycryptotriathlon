export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const dist2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) ** 2 + (ay - by) ** 2;
export const TAU = Math.PI * 2;

export type Rng = () => number;
/** Small seeded generator (mulberry32). The same seed always gives the same course. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)];
export const rint = (rng: Rng, a: number, b: number) => a + Math.floor(rng() * (b - a + 1));
/** Cheap hash of two integers to 0..1 (for per-tile variation). */
export function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 83.456 -> "1:23.45" */
export function fmtTime(sec: number): string {
  if (!isFinite(sec)) return '--:--.--';
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(2)}`;
}
export function fmtDelta(sec: number): string {
  const sign = sec < 0 ? '-' : '+';
  return `${sign}${Math.abs(sec).toFixed(2)}`;
}
export function mixColor(a: [number, number, number], b: [number, number, number], t: number): string {
  const k = clamp(t, 0, 1);
  return `rgb(${Math.round(lerp(a[0], b[0], k))},${Math.round(lerp(a[1], b[1], k))},${Math.round(lerp(a[2], b[2], k))})`;
}
