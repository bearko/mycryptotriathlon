const KEY = 'mct.v1';
export interface Save {
  best: number | null;
  bestSplits: [number, number, number] | null;
  /** Best time of each race on its own (the "gold" splits). */
  gold: [number | null, number | null, number | null];
  runs: number;
  mute: boolean;
  seenHelp: boolean;
}
const blank = (): Save => ({ best: null, bestSplits: null, gold: [null, null, null], runs: 0, mute: false, seenHelp: false });
let state: Save | null = null;

export function save(): Save {
  if (state) return state;
  try {
    const txt = localStorage.getItem(KEY);
    state = txt ? { ...blank(), ...JSON.parse(txt) } : blank();
  } catch {
    state = blank();
  }
  return state!;
}
export function commit(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save()));
  } catch {
    /* private mode etc.: the game still works, it just does not remember */
  }
}
