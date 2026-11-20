// Keyboard + mouse + touch, read the same way by every race.
//   move  : WASD / arrows / left virtual stick
//   A     : Space / J / left click / right-hand "A" button
//   B     : Shift / K / right-hand "B" button

import { clamp } from './util';

const keys = new Set<string>();
let stickId = -1;
let stickOx = 0;
let stickOy = 0;
const stick = { x: 0, y: 0 };
let aHeld = false;
let bHeld = false;
let aEdge = false;
let bEdge = false;
let mouseA = false;
let touchA = false;
let touchB = false;

export const input = {
  /** Normalised movement (length <= 1). */
  move: { x: 0, y: 0 },
  a: false,
  b: false,
  aPressed: false,
  bPressed: false,
  /** Mouse position in CSS pixels. `aim` is true while a mouse is in use (not on touch). */
  pointer: { x: 0, y: 0, aim: false },
  touch: false,
  /** Bots (debug) may drive the game through this. */
  bot: null as null | { x: number; y: number; a: boolean; b: boolean },
};

let stickEl: HTMLElement | null = null;
let knobEl: HTMLElement | null = null;
let padEl: HTMLElement | null = null;

function setTouchMode(on: boolean): void {
  if (input.touch === on) return;
  input.touch = on;
  document.documentElement.classList.toggle('touch', on);
  if (on) input.pointer.aim = false;
}

export function initInput(root: HTMLElement): void {
  padEl = document.createElement('div');
  padEl.className = 'pad';
  padEl.innerHTML =
    '<div class="stick" id="stick"><div class="knob" id="knob"></div></div>' +
    '<button class="pbtn pb" id="btn-b" aria-label="B"><span></span></button>' +
    '<button class="pbtn pa" id="btn-a" aria-label="A"><span></span></button>';
  root.appendChild(padEl);
  stickEl = padEl.querySelector('#stick');
  knobEl = padEl.querySelector('#knob');
  const btnA = padEl.querySelector<HTMLElement>('#btn-a')!;
  const btnB = padEl.querySelector<HTMLElement>('#btn-b')!;

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => {
    keys.clear();
    mouseA = false;
  });

  window.addEventListener('mousemove', (e) => {
    if (input.touch) return;
    input.pointer.x = e.clientX;
    input.pointer.y = e.clientY;
    input.pointer.aim = true;
  });
  window.addEventListener('mousedown', (e) => {
    if (input.touch || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, .screen, .modal')) return;
    mouseA = true;
  });
  window.addEventListener('mouseup', () => (mouseA = false));
  window.addEventListener('contextmenu', (e) => e.preventDefault());

  // Left half of the screen: a stick that appears where the thumb lands.
  const onStart = (e: TouchEvent) => {
    setTouchMode(true);
    for (const t of Array.from(e.changedTouches)) {
      const el = t.target as HTMLElement;
      if (el.closest('button, .screen, .modal')) continue;
      if (stickId < 0 && t.clientX < window.innerWidth * 0.55) {
        stickId = t.identifier;
        stickOx = t.clientX;
        stickOy = t.clientY;
        stick.x = 0;
        stick.y = 0;
        if (stickEl) {
          stickEl.style.left = `${stickOx}px`;
          stickEl.style.top = `${stickOy}px`;
          stickEl.classList.add('on');
        }
        e.preventDefault();
      }
    }
  };
  const onMove = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier !== stickId) continue;
      const R = 56;
      let dx = (t.clientX - stickOx) / R;
      let dy = (t.clientY - stickOy) / R;
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        dx /= len;
        dy /= len;
      }
      stick.x = dx;
      stick.y = dy;
      if (knobEl) knobEl.style.transform = `translate(${dx * R}px, ${dy * R}px)`;
      e.preventDefault();
    }
  };
  const onEnd = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier !== stickId) continue;
      stickId = -1;
      stick.x = 0;
      stick.y = 0;
      stickEl?.classList.remove('on');
      if (knobEl) knobEl.style.transform = '';
    }
  };
  root.addEventListener('touchstart', onStart, { passive: false });
  root.addEventListener('touchmove', onMove, { passive: false });
  root.addEventListener('touchend', onEnd);
  root.addEventListener('touchcancel', onEnd);

  const hold = (el: HTMLElement, set: (v: boolean) => void) => {
    el.addEventListener('touchstart', (e) => {
      setTouchMode(true);
      set(true);
      el.classList.add('down');
      e.preventDefault();
      e.stopPropagation();
    }, { passive: false });
    const up = (e: Event) => {
      set(false);
      el.classList.remove('down');
      e.preventDefault();
    };
    el.addEventListener('touchend', up);
    el.addEventListener('touchcancel', up);
  };
  hold(btnA, (v) => (touchA = v));
  hold(btnB, (v) => (touchB = v));
}

/** Shows / hides the touch controls and names the two buttons for the current race. */
export function setPad(on: boolean, aLabel = '', bLabel = ''): void {
  if (!padEl) return;
  padEl.classList.toggle('show', on);
  const a = padEl.querySelector<HTMLElement>('#btn-a span')!;
  const b = padEl.querySelector<HTMLElement>('#btn-b span')!;
  a.textContent = aLabel;
  b.textContent = bLabel;
  padEl.querySelector<HTMLElement>('#btn-a')!.style.display = aLabel ? '' : 'none';
  padEl.querySelector<HTMLElement>('#btn-b')!.style.display = bLabel ? '' : 'none';
}

/** Call once per frame, before the game update. */
export function pollInput(): void {
  let x = 0;
  let y = 0;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1;
  if (x || y) {
    const l = Math.hypot(x, y);
    x /= l;
    y /= l;
  } else {
    x = stick.x;
    y = stick.y;
    // a small dead zone, then full speed early so the thumb does not have to travel far
    const l = Math.hypot(x, y);
    if (l < 0.18) {
      x = 0;
      y = 0;
    } else {
      const k = clamp((l - 0.18) / 0.5, 0, 1) / l;
      x *= k;
      y *= k;
    }
  }
  let a = keys.has('Space') || keys.has('KeyJ') || keys.has('KeyZ') || mouseA || touchA;
  let b = keys.has('ShiftLeft') || keys.has('ShiftRight') || keys.has('KeyK') || keys.has('KeyX') || touchB;
  if (input.bot) {
    x = input.bot.x;
    y = input.bot.y;
    a = input.bot.a;
    b = input.bot.b;
  }
  input.move.x = x;
  input.move.y = y;
  aEdge = a && !aHeld;
  bEdge = b && !bHeld;
  aHeld = a;
  bHeld = b;
  input.a = a;
  input.b = b;
  input.aPressed = aEdge;
  input.bPressed = bEdge;
}

export const keyDown = (code: string) => keys.has(code);

// Helper items: keys 1-3 (or Q / E), or a tap on the item itself in the HUD.
let itemPress = -1;
export function pressItem(i: number): void {
  itemPress = i;
}
/** The item slot the player just asked to use (-1 when none). Reading it clears it. */
export function takeItemPress(): number {
  const i = itemPress;
  itemPress = -1;
  return i;
}
if (typeof window !== 'undefined') window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const map: Record<string, number> = { Digit1: 0, Digit2: 1, Digit3: 2, KeyQ: 0, KeyE: 1 };
  if (e.code in map) itemPress = map[e.code];
});
