import '@fontsource/dotgothic16/400.css';
import '@fontsource/dela-gothic-one/400.css';
import './styles/main.css';

import { preload } from './core/assets';
import { isMuted, playBgm, setMute, unlockAudio } from './core/audio';
import { cat, heroById, type Hero } from './core/catalog';
import { initInput, input, pollInput, setPad } from './core/input';
import { makeRng } from './core/util';
import { COURSE_SEED, newRun, rollExt, STAGES, takeExt, type Run, type StageId } from './game/run';
import { LandStage } from './stages/land';
import { SeaStage } from './stages/sea';
import type { Host, Stage } from './stages/stage';
import { createHud } from './ui/hud';
import {
  clearCard, hangarScreen, initScreens, introCard, pauseScreen, resultScreen, selectScreen, titleScreen,
} from './ui/screens';

const app = document.getElementById('app')!;
const mount = document.createElement('div');
mount.className = 'stage-mount';
app.appendChild(mount);
const hud = createHud(app);
initInput(app);
initScreens(app);

// Debug switches (not linked from anywhere): ?stage=sea&bot=1&quick=1&speed=4&heroes=1001,2001,3001
const q = new URLSearchParams(location.search);
const debug = {
  stage: q.get('stage') as StageId | null,
  bot: q.get('bot') === '1',
  quick: q.get('quick') === '1',
  speed: Math.max(1, Number(q.get('speed') ?? 1) || 1),
  heroes: (q.get('heroes') ?? '').split(',').map((s) => heroById.get(Number(s))).filter(Boolean) as Hero[],
};

let stage: Stage | null = null;
let playing = false;
let paused = false;
let baseTime = 0;
let settle: ((r: 'done' | 'restart' | 'quit') => void) | null = null;

const PAD: Record<StageId, [string, string]> = { land: ['ダッシュ', ''], sea: ['銛', ''], sky: ['ブースト', 'ロール'] };

async function makeStage(id: StageId, host: Host): Promise<Stage> {
  if (id === 'land') return new LandStage(host);
  if (id === 'sea') return new SeaStage(host);
  const { SkyStage } = await import('./stages/sky');
  return new SkyStage(host);
}

async function openPause(): Promise<void> {
  if (!playing || paused || !stage) return;
  paused = true;
  const a = await pauseScreen();
  paused = false;
  if (a !== 'resume') settle?.(a);
}
hud.onPause = () => void openPause();
hud.onMute = () => {
  unlockAudio();
  setMute(!isMuted());
  return isMuted();
};
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' || e.code === 'KeyP') void openPause();
  if (e.code === 'KeyM') setMute(!isMuted());
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) void openPause();
});

async function playStage(run: Run, index: number): Promise<'done' | 'restart' | 'quit'> {
  const id = STAGES[index];
  if (id === 'sky') await hangarScreen(run, debug.quick);
  const host: Host = { run, seed: COURSE_SEED, mount, hud, bot: debug.bot };
  baseTime = run.splits.reduce((a, b) => a + b, 0);
  stage = await makeStage(id, host);
  hud.show(id, run.splits);
  hud.clock(0, baseTime);
  playBgm(id);
  setPad(true, PAD[id][0], PAD[id][1]);
  await introCard(id, index, run, debug.quick);
  playing = true;
  const result = await new Promise<'done' | 'restart' | 'quit'>((res) => (settle = res));
  playing = false;
  settle = null;
  setPad(false);
  if (result === 'done') {
    run.splits[index] = stage.time;
    hud.clock(stage.time, baseTime + stage.time);
    await clearCard(index, run);
  }
  stage.dispose();
  stage = null;
  hud.hide();
  return result;
}

/** Debug: start in the middle of a run with plausible gear. */
function seedGear(run: Run, n: number): void {
  const rng = makeRng(99);
  for (let i = 0; i < n; i++) takeExt(run, rollExt(run, rng, 0.5));
  run.level = 1 + Math.floor(n / 2);
}

async function runOnce(heroes: [Hero, Hero, Hero]): Promise<'retry' | 'select' | 'quit'> {
  for (;;) {
    const run = newRun(heroes);
    let from = 0;
    if (debug.stage) {
      from = STAGES.indexOf(debug.stage);
      if (from > 0) seedGear(run, from === 1 ? 9 : 14);
      for (let i = 0; i < from; i++) run.splits[i] = 0;
    }
    (window as unknown as { __mct: unknown }).__mct = { run, get stage() { return stage; } };
    let again = false;
    for (let i = from; i < STAGES.length; i++) {
      const r = await playStage(run, i);
      if (r === 'restart') {
        again = true;
        break;
      }
      if (r === 'quit') return 'quit';
    }
    if (again) continue;
    playBgm('title', 0.35);
    const after = await resultScreen(run);
    if (after === 'select') return 'select';
  }
}

async function boot(): Promise<void> {
  void preload([cat.icons.ce, cat.bg.title]);
  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (stage) {
      if (playing && !paused) {
        for (let i = 0; i < debug.speed; i++) {
          if (debug.bot && stage.botStep) input.bot = stage.botStep();
          pollInput();
          stage.update(debug.speed > 1 ? 1 / 60 : dt);
          if (stage.finished) break;
        }
        hud.clock(stage.time, baseTime + stage.time);
        if (stage.finished && settle) settle('done');
      }
      stage.render();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  let skipTitle = !!debug.stage || debug.quick;
  for (;;) {
    playBgm('title', 0.35);
    if (!skipTitle) await titleScreen();
    for (;;) {
      let heroes: [Hero, Hero, Hero];
      if (debug.heroes.length === 3) heroes = debug.heroes as [Hero, Hero, Hero];
      else if (skipTitle) heroes = [cat.heroes[20], cat.heroes[60], cat.heroes[100]];
      else heroes = await selectScreen();
      const r = await runOnce(heroes);
      if (r === 'quit') break;
    }
    skipTitle = false;
    debug.stage = null;
  }
}

void boot();
