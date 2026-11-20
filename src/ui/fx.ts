// The show around the game: screen wipes, the living background behind every menu, and the little
// reactions (a spark under the finger, a number counting up, a stamp landing) that make the interface
// feel like something being touched instead of something being displayed.

import { sfx } from '../core/audio';

let root: HTMLElement;
let wipeEl: HTMLElement;
let covered = false;
let guard = 0;
const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

const PALETTE = ['#ff2e6c', '#ffb13d', '#37c8f2', '#b693ff', '#d8ff3a', '#ffffff'];

export function initFx(app: HTMLElement): void {
  root = document.createElement('div');
  root.className = 'fx';
  root.innerHTML = '<div class="wipe" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><b>MCT</b></div>';
  app.appendChild(root);
  wipeEl = root.querySelector<HTMLElement>('.wipe')!;

  // every button answers the finger: a click of sound and a few sparks, before the screen even reacts
  const isButton = (t: EventTarget | null) => {
    const el = (t as HTMLElement | null)?.closest?.<HTMLElement>('button, .btn');
    if (!el || (el as HTMLButtonElement).disabled || el.classList.contains('pbtn') || el.dataset.quiet !== undefined) return null;
    return el;
  };
  let hovered: HTMLElement | null = null;
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = isButton(e.target);
    if (el && el !== hovered) sfx('hover', 0.03);
    hovered = el;
  });
  document.addEventListener('pointerdown', (e) => {
    const el = isButton(e.target);
    if (!el) return;
    sfx('press', 0.02);
    burst(e.clientX, e.clientY, 7, 34);
  }, true);
}

/** Bands sweep across and hide everything. Change the screen while it is covered, then call `uncover`. */
export async function cover(): Promise<void> {
  if (covered) return;
  covered = true;
  if (calm()) {
    wipeEl.className = 'wipe on calm';
    await wait(140);
    return;
  }
  sfx('wipe');
  wipeEl.className = 'wipe in';
  await wait(430);
  wipeEl.className = 'wipe on';
  // nothing may ever leave the game hidden behind the wipe
  window.clearTimeout(guard);
  guard = window.setTimeout(uncover, 3000);
}
export function uncover(): void {
  if (!covered) return;
  covered = false;
  if (calm()) {
    wipeEl.className = 'wipe';
    return;
  }
  sfx('whoosh');
  wipeEl.className = 'wipe out';
  window.setTimeout(() => {
    if (!covered) wipeEl.className = 'wipe';
  }, 520);
}
export const isCovered = () => covered;

/** A handful of shards flying out from a point (screen coordinates). */
export function burst(x: number, y: number, n = 10, reach = 70, colors: string[] = PALETTE): void {
  if (calm() || !root) return;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    p.className = 'spark';
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.8;
    const d = reach * (0.5 + Math.random() * 0.7);
    const w = 4 + Math.random() * 7;
    p.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${Math.random() < 0.5 ? w : 2 + Math.random() * 2}px;background:${colors[Math.floor(Math.random() * colors.length)]}`;
    root.appendChild(p);
    const anim = p.animate(
      [
        { transform: `translate(-50%,-50%) rotate(${Math.random() * 90}deg) scale(1)`, opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) rotate(${200 + Math.random() * 300}deg) scale(0)`, opacity: 0.9 },
      ],
      { duration: 320 + Math.random() * 260, easing: 'cubic-bezier(.1,.7,.3,1)' },
    );
    anim.onfinish = () => p.remove();
  }
}
/** Sparks from the middle of an element. */
export function burstAt(el: Element, n = 14, reach = 110, colors?: string[]): void {
  const r = el.getBoundingClientRect();
  burst(r.left + r.width / 2, r.top + r.height / 2, n, reach, colors);
}

/** Paper falling over the whole screen (a win, a goal). */
export function confetti(n = 70): void {
  if (calm() || !root) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    p.className = 'confetti';
    const x = Math.random() * w;
    const s = 6 + Math.random() * 8;
    p.style.cssText = `left:${x}px;top:-20px;width:${s}px;height:${s * (0.4 + Math.random() * 0.8)}px;background:${PALETTE[i % PALETTE.length]}`;
    root.appendChild(p);
    const drift = (Math.random() - 0.5) * 220;
    const anim = p.animate(
      [
        { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
        { transform: `translate(${drift}px, ${h + 60}px) rotate(${(Math.random() - 0.5) * 1400}deg)`, opacity: 1 },
      ],
      { duration: 1500 + Math.random() * 1700, delay: Math.random() * 700, easing: 'cubic-bezier(.3,.2,.6,1)', fill: 'backwards' },
    );
    anim.onfinish = () => p.remove();
  }
}

/** A ring that opens from a point and fades: the echo of something heavy landing. */
export function shock(x: number, y: number, color = '#ffffff'): void {
  if (calm() || !root) return;
  const p = document.createElement('i');
  p.className = 'shock';
  p.style.cssText = `left:${x}px;top:${y}px;border-color:${color}`;
  root.appendChild(p);
  const anim = p.animate(
    [
      { transform: 'translate(-50%,-50%) scale(.1)', opacity: 1, borderWidth: '18px' },
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 0, borderWidth: '1px' },
    ],
    { duration: 520, easing: 'cubic-bezier(.1,.7,.2,1)' },
  );
  anim.onfinish = () => p.remove();
}

/** The whole view kicks once (a stamp landing, a place settling). */
export function kick(px = 8): void {
  if (calm()) return;
  document.getElementById('app')?.animate(
    [
      { transform: `translate(${px}px, ${-px * 0.6}px)` },
      { transform: `translate(${-px * 0.7}px, ${px * 0.5}px)` },
      { transform: `translate(${px * 0.4}px, ${px * 0.2}px)` },
      { transform: 'translate(0,0)' },
    ],
    { duration: 240, easing: 'ease-out' },
  );
}

/** Counts a number up in an element, ticking as it goes. Resolves when it lands. */
export function countUp(el: HTMLElement, to: number, ms = 700, fmt: (n: number) => string = (n) => String(n)): Promise<void> {
  if (calm() || to === 0) {
    el.textContent = fmt(to);
    return Promise.resolve();
  }
  return new Promise((res) => {
    const t0 = performance.now();
    let last = -1;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const v = Math.round(to * (1 - Math.pow(1 - k, 3)));
      if (v !== last) {
        last = v;
        el.textContent = fmt(v);
        sfx('tick', 0.035);
      }
      if (k < 1) requestAnimationFrame(step);
      else res();
    };
    requestAnimationFrame(step);
  });
}

/** Each character in its own span (`--i` is its index), so a title can arrive letter by letter. */
export function chars(text: string, cls = 'ch'): string {
  return [...text].map((c, i) => `<span class="${cls}" style="--i:${i}">${c === ' ' ? '&nbsp;' : c}</span>`).join('');
}

/**
 * The background behind every menu. It never stands still: rays turn, dots drift, two bands of text
 * run across at an angle. `tone` tints it (land, sea, sky, or nothing for the house colours).
 */
export function ambient(words: string, tone = ''): string {
  const line = `${words} ● `.repeat(6);
  return `<div class="amb ${tone}" aria-hidden="true">
    <i class="amb-rays"></i><i class="amb-dots"></i>
    <div class="amb-band b1"><span>${line}</span><span>${line}</span></div>
    <div class="amb-band b2"><span>${line}</span><span>${line}</span></div>
    <i class="amb-vig"></i>
  </div>`;
}

/** Restarts a CSS animation class on an element. */
export function replay(el: Element, cls: string): void {
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}
