// The in-race display. Plain DOM over the canvas, shared by all three races.

import { KIND_COLOR, RARITY_COLOR } from '../core/catalog';
import { fmtTime } from '../core/util';
import { STAGE_EN, STAGE_NAME, STAGES, type Slot, type StageId } from '../game/run';
import type { Hud } from '../stages/stage';

export interface HudView extends Hud {
  el: HTMLElement;
  show(stage: StageId, splits: number[]): void;
  hide(): void;
  clock(stageTime: number, total: number): void;
  onPause: () => void;
  onMute: () => boolean;
}

export function createHud(root: HTMLElement): HudView {
  const el = document.createElement('div');
  el.className = 'hud';
  el.innerHTML = `
    <div class="hud-hurt" id="h-hurt"></div>
    <div class="hud-top">
      <div class="hud-legs" id="h-legs"></div>
      <div class="hud-time"><b id="h-time">0:00.00</b><small id="h-total"></small></div>
      <div class="hud-btns">
        <button id="h-mute" class="ibtn" aria-label="音">♪</button>
        <button id="h-pause" class="ibtn" aria-label="ポーズ">Ⅱ</button>
      </div>
    </div>
    <div class="hud-prog"><i id="h-prog"></i><span id="h-marks"></span><em id="h-dot"></em></div>
    <div class="hud-vitals">
      <div class="gauge"><i id="h-gauge"></i><span id="h-gtext"></span></div>
      <div class="gauge sub" id="h-subwrap"><i id="h-sub"></i></div>
      <div class="lv"><span id="h-lv">Lv1</span><div class="xp"><i id="h-xp"></i></div></div>
    </div>
    <div class="hud-boss" id="h-boss"><span id="h-bname"></span><div class="bbar"><i id="h-bbar"></i></div></div>
    <div class="hud-obj" id="h-obj"></div>
    <div class="hud-slots" id="h-slots"></div>
    <div class="hud-banner" id="h-banner"><b></b><small></small></div>
    <div class="hud-pen" id="h-pen"></div>`;
  root.appendChild(el);
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => el.querySelector<T>(`#${id}`)!;
  const time = $('h-time');
  const total = $('h-total');
  const gauge = $('h-gauge');
  const gtext = $('h-gtext');
  const sub = $('h-sub');
  const subwrap = $('h-subwrap');
  const prog = $('h-prog');
  const dot = $('h-dot');
  const marks = $('h-marks');
  const lv = $('h-lv');
  const xp = $('h-xp');
  const boss = $('h-boss');
  const bname = $('h-bname');
  const bbar = $('h-bbar');
  const obj = $('h-obj');
  const slotsEl = $('h-slots');
  const banner = $('h-banner');
  const pen = $('h-pen');
  const hurt = $('h-hurt');
  const legs = $('h-legs');
  const mute = $('h-mute');

  let lastG = -1;
  let lastGT = '';
  let lastS = -2;
  let lastP = -1;
  let lastLv = 0;
  let lastXp = -1;
  let lastBoss: string | null = '';
  let lastBF = -1;
  let lastObj = '';
  let lastMarks = '';
  let bannerT = 0;
  let stageNow: StageId = 'land';

  const api: HudView = {
    el,
    onPause: () => undefined,
    onMute: () => false,
    show(stage, splits) {
      stageNow = stage;
      el.classList.add('on');
      el.dataset.stage = stage;
      legs.innerHTML = STAGES.map((s, i) => {
        const done = splits[i] !== undefined;
        const cls = s === stage ? 'now' : done ? 'done' : '';
        return `<span class="leg ${cls}"><b>${STAGE_NAME[s]}</b>${done ? `<small>${fmtTime(splits[i])}</small>` : s === stage ? `<small>${STAGE_EN[s]}</small>` : ''}</span>`;
      }).join('');
      lastG = lastS = lastP = lastXp = lastBF = -3;
      lastGT = lastObj = lastMarks = '';
      lastBoss = '';
      lastLv = 0;
      boss.classList.remove('on');
      banner.classList.remove('on');
      gauge.parentElement!.dataset.kind = stage === 'sea' ? 'o2' : stage === 'sky' ? 'shield' : 'hp';
    },
    hide() {
      el.classList.remove('on');
    },
    clock(st, tot) {
      time.textContent = fmtTime(st);
      total.textContent = stageNow === 'land' ? '' : `TOTAL ${fmtTime(tot)}`;
    },
    gauge(frac, text) {
      const f = Math.round(frac * 200) / 200;
      if (f !== lastG) {
        lastG = f;
        gauge.style.transform = `scaleX(${f})`;
        gauge.parentElement!.classList.toggle('low', f < 0.3);
      }
      if (text !== lastGT) {
        lastGT = text;
        gtext.textContent = text;
      }
    },
    sub(frac) {
      const f = frac < 0 ? -1 : Math.round(Math.min(1, frac) * 100) / 100;
      if (f === lastS) return;
      lastS = f;
      subwrap.style.display = f < 0 ? 'none' : '';
      sub.style.transform = `scaleX(${Math.max(0, f)})`;
      subwrap.classList.toggle('full', f >= 1);
    },
    progress(frac, ms) {
      const f = Math.round(frac * 500) / 500;
      if (f !== lastP) {
        lastP = f;
        prog.style.transform = `scaleX(${f})`;
        dot.style.left = `${f * 100}%`;
      }
      const key = ms.join(',');
      if (key !== lastMarks) {
        lastMarks = key;
        marks.innerHTML = ms.map((m) => `<u style="left:${m * 100}%"></u>`).join('');
      }
    },
    level(level, frac) {
      if (level !== lastLv) {
        lastLv = level;
        lv.textContent = `Lv${level}`;
      }
      const f = Math.round(frac * 50) / 50;
      if (f !== lastXp) {
        lastXp = f;
        xp.style.transform = `scaleX(${f})`;
      }
    },
    slots(slots: Slot[], changed) {
      slotsEl.innerHTML = slots
        .map(
          (s) =>
            `<div class="slot${s === changed ? ' pop' : ''}" style="--rar:${RARITY_COLOR[s.ext.rarity]};--kind:${KIND_COLOR[s.ext.kind]}">` +
            `<img src="${s.ext.img}" alt=""><b>${s.lv >= 5 ? 'MAX' : `Lv${s.lv}`}</b></div>`,
        )
        .join('');
    },
    boss(name, frac = 0) {
      if (name !== lastBoss) {
        lastBoss = name;
        boss.classList.toggle('on', !!name);
        if (name) bname.textContent = name;
      }
      if (name) {
        const f = Math.round(Math.max(0, frac) * 200) / 200;
        if (f !== lastBF) {
          lastBF = f;
          bbar.style.transform = `scaleX(${f})`;
        }
      }
    },
    objective(text) {
      if (text === lastObj) return;
      lastObj = text;
      obj.textContent = text;
      obj.classList.remove('flash');
      void obj.offsetWidth;
      obj.classList.add('flash');
    },
    banner(text, subText = '', tone) {
      banner.querySelector('b')!.textContent = text;
      banner.querySelector('small')!.textContent = subText;
      banner.dataset.tone = tone ?? '';
      banner.classList.remove('on');
      void banner.offsetWidth;
      banner.classList.add('on');
      window.clearTimeout(bannerT);
      bannerT = window.setTimeout(() => banner.classList.remove('on'), 1700);
    },
    hurt() {
      hurt.classList.remove('on');
      void hurt.offsetWidth;
      hurt.classList.add('on');
    },
    penalty(sec) {
      pen.textContent = `+${sec.toFixed(2)}`;
      pen.classList.remove('on');
      void pen.offsetWidth;
      pen.classList.add('on');
    },
  };
  $('h-pause').addEventListener('click', () => api.onPause());
  mute.addEventListener('click', () => {
    mute.classList.toggle('off', api.onMute());
  });
  return api;
}
