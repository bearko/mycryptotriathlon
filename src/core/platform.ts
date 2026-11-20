// The window onto the bearko.games shared platform (login, achievements, total score, chat, visitor counts).
// No other file touches window.BearkoGames: they call the functions here (docs/PLATFORM.md).
//
// The rule that matters: if the SDK cannot be read (offline, blocked) or a call fails (the title is not
// registered yet), the game still plays to the end. Every call is wrapped; a failure is one console.warn.
// The game never touches cookies: who is logged in belongs to the platform.

import pkg from '../../package.json';

export const GAME = 'triathlon';

/** The little of the SDK this game uses (https://bearko.games/sdk/v1.js; no npm dependency). */
interface Sdk {
  init(opts: Record<string, unknown>): Promise<unknown>;
  tutorialStep(step: number, id: string): void;
  unlockTrophy(id: string): Promise<unknown>;
  submitScore(metrics: Record<string, unknown>, opts?: { quiet?: boolean }): Promise<unknown>;
  chat: { open(): void; setVisible(on: boolean): void };
}

/**
 * Where a new player is, for the funnel on the platform's admin page. Once published, the numbers and
 * ids never change (the counts before and after could no longer be compared); new steps take a free number.
 */
export const STEPS = {
  start: 0,
  team: 10,
  race: 20,
  levelup: 30,
  gate1: 40,
  result: 50,
  tree: 60,
  retry: 70,
  done: 90,
} as const;
export type Step = keyof typeof STEPS;

/** Medals of this game that are also achievements on the platform (`triathlon.<id>`). */
export const TROPHIES = ['gate1', 'goal', 'land30', 'land1', 'sea', 'sea1', 'sky', 'kill300', 'noko', 'foul'] as const;

const found = (): Sdk | null => (typeof window === 'undefined' ? null : ((window as unknown as { BearkoGames?: Sdk }).BearkoGames ?? null));
let ready = false;
let begun = false;
const sentSteps = new Set<Step>();
const waiting: (() => void)[] = [];

function guard(what: string, run: (api: Sdk) => unknown): void {
  try {
    const api = found();
    if (!api) return;
    const out = run(api);
    if (out instanceof Promise) out.catch((err) => console.warn(`[platform] ${what}`, err));
  } catch (err) {
    console.warn(`[platform] ${what}`, err);
  }
}
/** Runs now if the platform is connected, otherwise when it connects (never, if it does not). */
function later(fn: () => void): void {
  if (ready) fn();
  else if (waiting.length < 60) waiting.push(fn);
}

/**
 * Once, at boot. The SDK is deferred, so if it is not there yet this waits for the page to load.
 * Chat: the game fills the whole screen sideways, so neither the dock nor a floating button is used;
 * it opens from a button on the title screen. Notices come in at the top, clear of the buttons at the bottom.
 */
export function startPlatform(): void {
  if (typeof window === 'undefined') return;
  const begin = (): void => {
    if (begun || !found()) return;
    begun = true;
    try {
      const r = found()!.init({ game: GAME, version: pkg.version, chat: { layout: 'float', button: false }, toast: 'top', toastOffset: 8 });
      Promise.resolve(r)
        .catch((err) => console.warn('[platform] init', err))
        .then(() => {
          ready = true;
          for (const fn of waiting.splice(0)) fn();
          for (const fn of readyFns.splice(0)) fn();
        });
    } catch (err) {
      console.warn('[platform] init', err);
    }
  };
  begin();
  if (!begun) window.addEventListener('load', begin, { once: true });
}
const readyFns: (() => void)[] = [];
/** Calls back once the platform has answered (to show the chat button, to send what was earned earlier). */
export function whenReady(fn: () => void): void {
  if (ready) fn();
  else readyFns.push(fn);
}
export const platformReady = () => ready;

/** A step of the first session. Sent once per page; the server keeps the first time per person. */
export function step(id: Step): void {
  if (sentSteps.has(id)) return;
  sentSteps.add(id);
  later(() => guard('tutorialStep', (api) => api.tutorialStep(STEPS[id], id)));
}

/** A medal was earned (or was earned before the platform knew this title): sent if it is one of the achievements. */
export function trophy(feat: string): void {
  if (!(TROPHIES as readonly string[]).includes(feat)) return;
  later(() => guard('unlockTrophy', (api) => api.unlockTrophy(`${GAME}.${feat}`)));
}

/** One attempt, finished. Sent once per attempt by the caller. */
export function submitRun(metrics: Record<string, unknown>): void {
  later(() => guard('submitScore', (api) => api.submitScore({ ...metrics, regulation: 'normal', difficulty: 'normal', balance: 1 })));
}

export function openChat(): void {
  guard('chat.open', (api) => api.chat.open());
}
/** The chat (and its notices) keep out of the way during a race. */
export function chatVisible(on: boolean): void {
  later(() => guard('chat.setVisible', (api) => api.chat.setVisible(on)));
}
