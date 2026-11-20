// What a race pays, in CE. Even a failed attempt pays for how far it got: every run moves the tree forward.

import { meta, saveMeta, stats, FEATS, type Feat } from './meta';
import type { Run } from './run';
import type { StageResult } from '../stages/stage';

export interface Payout { lines: { label: string; ce: number }[]; total: number; mult: number; feats: Feat[] }

export function payout(run: Run, land: StageResult | null, seaClear: boolean, skyClear: boolean, featsBefore: string[]): Payout {
  const lines: { label: string; ce: number }[] = [];
  if (land) {
    lines.push({ label: `走破 ${Math.round(land.progress * 100)}%`, ce: Math.round(land.progress * 40) });
    if (land.gates) lines.push({ label: `関門 ×${land.gates}`, ce: land.gates * 20 });
    if (land.progress >= 1) lines.push({ label: `完走 ${land.place}位`, ce: 30 + Math.max(0, land.field - land.place) });
    if (land.qualified) lines.push({ label: '予選通過', ce: 120 });
  }
  if (run.kills) lines.push({ label: `撃破 ${run.kills}`, ce: Math.round(run.kills * 0.25) });
  if (seaClear) lines.push({ label: '海をクリア', ce: 150 });
  if (skyClear) lines.push({ label: '空をクリア', ce: 250 });
  const mult = stats().ce;
  const total = Math.round(lines.reduce((a, l) => a + l.ce, 0) * mult);
  const m = meta();
  m.ce += total;
  m.runs += 1;
  if (land) {
    m.bestProgress = Math.max(m.bestProgress, land.progress);
    if (land.progress >= 1 && (m.bestPlace === null || land.place < m.bestPlace)) m.bestPlace = land.place;
  }
  const feats = FEATS.filter((f) => m.feats.includes(f.id) && !featsBefore.includes(f.id));
  saveMeta();
  return { lines, total, mult, feats };
}
