import '@fontsource/dotgothic16/400.css';
import '@fontsource/dela-gothic-one/400.css';

import './styles/main.css';
import './styles/show.css';
import { initFx } from './ui/fx';

import { preload } from './core/assets';
import { isMuted, playBgm, setMute, unlockAudio } from './core/audio';
import { cat, heroById, type Hero } from './core/catalog';
import { initInput, input, pollInput, setPad } from './core/input';
import { makeRng } from './core/util';
import { earn, meta, saveMeta, setMetaForTest, treeLevels, watchFeats } from './game/meta';
import { chatVisible, startPlatform, step, submitRun, trophy, whenReady } from './core/platform';
import { payout } from './game/reward';
import { COURSE_SEED, drawCards, newRun, STAGES, takeCard, type Run, type StageId } from './game/run';
import { stats } from './game/meta';
import { LandStage } from './stages/land';
import { SeaStage } from './stages/sea';
import type { Host, Stage, StageResult } from './stages/stage';
import { treeScreen } from './ui/tree';
import { createHud } from './ui/hud';
import {
  clearCard, goalScreen, initScreens, introCard, levelUpScreen, outScreen, pauseScreen, resultScreen, screenLayer, selectScreen, titleScreen, tuneScreen,
} from './ui/screens';

const app = document.getElementById('app')!;
const mount = document.createElement('div');
mount.className = 'stage-mount';
app.appendChild(mount);
const hud = createHud(app);
initInput(app);
initScreens(app);
initFx(app);

// Debug switches (not linked from anywhere): ?stage=sea&bot=1&quick=1&speed=4&heroes=1001,2001,3001
const q = new URLSearchParams(location.search);
const debug = {
  stage: q.get('stage') as StageId | null,
  bot: q.get('bot') === '1',
  quick: q.get('quick') === '1',
  speed: Math.max(1, Number(q.get('speed') ?? 1) || 1),
  heroes: (q.get('heroes') ?? '').split(',').map((s) => heroById.get(Number(s))).filter(Boolean) as Hero[],
  /** ?tree=atk:5,speed:3 starts from that skill tree (and never touches the real save). */
  tree: q.get('tree'),
};
if (debug.tree !== null) {
  const lv: Record<string, number> = {};
  for (const part of debug.tree.split(',')) {
    const [id, n] = part.split(':');
    if (id) lv[id] = Number(n ?? 1);
  }
  setMetaForTest({ lv, ce: Number(q.get('ce') ?? 0), medal: Number(q.get('medal') ?? 0) });
}

let stage: Stage | null = null;
let playing = false;
let paused = false;
let baseTime = 0;
let settle: ((r: 'done' | 'restart' | 'quit') => void) | null = null;

const PAD: Record<StageId, [string, string]> = { land: ['ダッシュ', 'ストライク'], sea: ['銛', ''], sky: ['ブースト', 'ブレーキ'] };
let lastResult: StageResult | null = null;
/** The finish-line overlay of the race in progress (shown once). */
let outro: { index: number; run: Run; shown: boolean } | null = null;
(window as unknown as { __log: unknown[] }).__log = [];

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
  // the hangar's clock is part of the race: what is spent deciding is added to the sky's time
  const tuned = id === 'sky' ? await tuneScreen(run, debug.quick) : 0;
  const host: Host = {
    run, seed: COURSE_SEED, mount, hud, bot: debug.bot,
    pick: (r) => levelUpScreen(r, debug.bot).then(() => step('levelup')),
    items: (r) => hud.items(r.items, stats().itemSlots),
  };
  baseTime = run.splits.reduce((a, b) => a + b, 0);
  stage = await makeStage(id, host);
  hud.show(id, run.splits);
  hud.clock(0, baseTime);
  hud.slots(id === 'sky' ? [] : run.slots);
  if (id === 'land') host.items(run);
  playBgm(id);
  setPad(true, PAD[id][0], PAD[id][1]);
  chatVisible(false);
  await introCard(id, index, run, debug.quick);
  if (id === 'land') step(meta().runs >= 1 ? 'retry' : 'race');
  outro = { index, run, shown: false };
  playing = true;
  const result = await new Promise<'done' | 'restart' | 'quit'>((res) => (settle = res));
  playing = false;
  settle = null;
  setPad(false);
  lastResult = stage.result ?? null;
  (window as unknown as { __ft: unknown }).__ft = (stage as unknown as { finishTimes?: number[] }).finishTimes;
  (window as unknown as { __log: unknown[] }).__log.push({ stage: id, time: Math.round(stage.time * 10) / 10, result: lastResult, kills: run.kills, lv: run.level, downs: run.downs });
  if (result === 'done') {
    run.splits[index] = stage.time + tuned;
    hud.clock(stage.time, baseTime + stage.time);
    if (!outro.shown && (!lastResult || lastResult.qualified)) await clearCard(index, run, lastResult ?? undefined);
  }
  stage.dispose();
  stage = null;
  hud.hide();
  return result;
}

/** Debug: start in the middle of a run with plausible gear. */
function seedGear(run: Run, n: number): void {
  for (let i = 0; i < n; i++) {
    const cards = drawCards(run);
    if (cards.length) takeCard(run, cards[0]);
  }
  run.level = 1 + n;
}

/** One attempt: as far as the team gets. Always ends in the skill tree. */
async function runOnce(heroes: [Hero, Hero, Hero]): Promise<'again' | 'team' | 'quit'> {
  const run = newRun(heroes);
  const featsBefore = [...meta().feats];
  let from = 0;
  if (debug.stage) {
    from = STAGES.indexOf(debug.stage);
    if (from > 0) seedGear(run, from === 1 ? 9 : 14);
    for (let i = 0; i < from; i++) run.splits[i] = 0;
  }
  (window as unknown as { __mct: unknown }).__mct = { run, meta: meta(), get stage() { return stage; }, get last() { return lastResult; } };
  let land: StageResult | null = null;
  let sea: StageResult | null = null;
  let sky: StageResult | null = null;
  let cleared = 0;
  let out: StageId | null = null;
  for (let i = from; i < STAGES.length; i++) {
    const r = await playStage(run, i);
    if (r === 'restart' || r === 'quit') chatVisible(true);
    if (r === 'restart') return 'again';
    if (r === 'quit') return 'quit';
    if (STAGES[i] === 'land') land = lastResult;
    if (STAGES[i] === 'sea') sea = lastResult;
    if (STAGES[i] === 'sky') sky = lastResult;
    if (lastResult && !lastResult.qualified) {
      out = STAGES[i];
      break;
    }
    cleared = i + 1;
  }
  if (cleared >= 2) earn('sea');
  if (cleared >= 3) earn('sky');
  const pay = payout(run, land, sea, sky, featsBefore);
  // the attempt is over: its result goes to the shared platform, once
  chatVisible(true);
  step('result');
  submitRun({
    cleared, champion: cleared >= 3,
    landPlace: land?.place ?? null, landProgress: land ? Math.round(land.progress * 1000) / 1000 : 0, landGates: land?.gates ?? 0, landQualified: !!land?.qualified,
    seaPlace: sea?.place ?? null, seaProgress: sea ? Math.round(sea.progress * 1000) / 1000 : 0, seaRelics: sea?.gates ?? 0, seaQualified: !!sea?.qualified,
    skyPlace: sky?.place ?? null, skyKills: sky?.gates ?? 0,
    kills: run.kills, level: run.level, downs: run.downs, timeMs: Math.round(run.splits.reduce((a, b) => a + b, 0) * 1000), tree: treeLevels(),
  });
  playBgm('title', 0.35);
  if (out && lastResult) await outScreen(out, lastResult, pay);
  else if (cleared >= 3) await resultScreen(run, pay);
  if (debug.quick) await new Promise((r) => window.setTimeout(r, 600));
  const next = await treeScreen(screenLayer());
  return next === 'team' ? 'team' : 'again';
}

async function boot(): Promise<void> {
  // The shared platform. Debug sessions (bots, a seeded tree, a race opened directly) stay off it,
  // so that test runs never reach the rankings or the visitor counts.
  if (!debug.bot && !debug.quick && !debug.stage && debug.tree === null) {
    startPlatform();
    watchFeats((id) => {
      trophy(id);
      if (id === 'gate1') step('gate1');
      if (id === 'land30') step('done');
    });
    // medals earned before the platform knew this title (or while it could not be reached) are offered again
    whenReady(() => meta().feats.forEach(trophy));
  }
  void preload([cat.icons.ce, cat.bg.title]);
  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
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
        else if (stage.outro && stage.result && outro && !outro.shown && settle) {
          // the place is settled: the race runs on behind the result until the player moves on
          outro.shown = true;
          setPad(false);
          if (debug.quick) settle('done');
          else void goalScreen(STAGES[outro.index], outro.index, outro.run, stage.result, stage.time).then(() => settle?.('done'));
        }
      }
      stage.render();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  let skipTitle = !!debug.stage || debug.quick;
  for (;;) {
    playBgm('title', 0.35);
    if (!skipTitle) {
      await titleScreen();
      step('start');
    }
    let heroes: [Hero, Hero, Hero] | null = null;
    const saved = meta().team.map((id) => heroById.get(id)).filter(Boolean) as Hero[];
    if (debug.heroes.length === 3) heroes = debug.heroes as [Hero, Hero, Hero];
    else if (skipTitle) heroes = [cat.heroes[20], cat.heroes[60], cat.heroes[100]];
    else if (saved.length === 3) heroes = saved as [Hero, Hero, Hero];
    for (;;) {
      if (!heroes) {
        heroes = await selectScreen();
        step('team');
        meta().team = heroes.map((h) => h.id);
        saveMeta();
      }
      const r = await runOnce(heroes);
      if (r === 'quit') break;
      if (r === 'team') heroes = null;
    }
    skipTitle = false;
    debug.stage = null;
  }
}

void boot();
