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
}

export interface Host {
  run: Run;
  seed: number;
  mount: HTMLElement;
  hud: Hud;
  /** Debug: let the game play itself. */
  bot: boolean;
}

export interface Stage {
  /** Stage clock in seconds (includes penalties). */
  time: number;
  finished: boolean;
  update(dt: number): void;
  render(): void;
  dispose(): void;
  /** Debug: steer the hero. */
  botStep?(): { x: number; y: number; a: boolean; b: boolean };
}
