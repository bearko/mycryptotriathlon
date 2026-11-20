import type { Run, Slot } from '../game/run';

export interface Hud {
  /** Main gauge (HP / oxygen / shield): 0..1 */
  gauge(frac: number, text: string): void;
  /** Second gauge (dash / boost): 0..1. Pass -1 to hide. */
  sub(frac: number): void;
  progress(frac: number, marks: number[]): void;
  level(level: number, frac: number): void;
  slots(slots: Slot[], changed?: Slot | null): void;
  boss(name: string | null, frac?: number): void;
  objective(text: string): void;
  banner(text: string, sub?: string, tone?: 'warn' | 'good'): void;
  hurt(): void;
  penalty(sec: number): void;
  /** One line from the commentary booth. Higher priority lines push ahead of chatter. */
  say(text: string, prio?: number, who?: 'chris' | 'ain'): void;
  /** Place in the race, and how many of the qualifying spots are taken. */
  rank(place: number, total: number, passed: number, quota: number): void;
  fouls(n: number, limit: number): void;
  gum(n: number): void;
  /** Every runner's progress along the course (0..1); `me` is the player's. */
  dots(all: number[], me: number): void;
  /** The passive-skill cut-in. */
  cutin(img: string, name: string, text: string): void;
}

export interface Host {
  run: Run;
  seed: number;
  mount: HTMLElement;
  hud: Hud;
  /** Debug: let the game play itself. */
  bot: boolean;
  /** Shows the level-up cards and resolves once one has been taken. */
  pick(run: Run): Promise<void>;
  /** Draws the stock of helper items again. */
  items(run: Run): void;
}

export interface Stage {
  /** Stage clock in seconds (includes penalties). */
  time: number;
  finished: boolean;
  /** True once the place is settled and the hero is running on past the line: the race waits for the player to move on. */
  outro?: boolean;
  /** Set when the race ends: the place taken, and whether that was enough to go on. */
  result?: StageResult;
  update(dt: number): void;
  render(): void;
  dispose(): void;
  /** Debug: steer the hero. */
  botStep?(): { x: number; y: number; a: boolean; b: boolean };
}

export interface StageResult {
  place: number; field: number; quota: number; qualified: boolean;
  /** 0..1 along the course when the race ended. */
  progress: number;
  gates: number;
}
