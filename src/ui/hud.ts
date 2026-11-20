// The in-race display. Plain DOM over the canvas, shared by all three races.
// Top row: place and qualifying spots, the commentary booth, the clock.

import { cat, RARITY_COLOR } from '../core/catalog';
import { pressItem } from '../core/input';
import { iconOf, itemImg, type Item } from '../game/roster';
import { fmtTime } from '../core/util';
import { STAGE_EN, STAGE_NAME, type Slot, type StageId } from '../game/run';
import type { Hud } from '../stages/stage';

export interface HudView extends Hud {
  items(list: Item[], max: number): void;
  el: HTMLElement;
  show(stage: StageId, splits: number[]): void;
  hide(): void;
  clock(stageTime: number, total: number): void;
  onPause: () => void;
  onMute: () => boolean;
}

interface Line { text: string; prio: number; who: 'chris' | 'ain' }

export function createHud(root: HTMLElement): HudView {
  const el = document.createElement('div');
  el.className = 'hud';
  el.innerHTML = `
    <div class="hud-hurt" id="h-hurt"></div>
    <div class="hud-top">
      <div class="hud-rank" id="h-rankbox">
        <span class="stg" id="h-stage"></span>
        <b id="h-place">-</b><small id="h-field"></small>
        <span class="quota" id="h-quota"></span>
      </div>
      <div class="hud-cast" id="h-cast">
        <img id="h-castimg" src="${cat.chars.chrisTalk}" alt="">
        <p id="h-castline"></p>
      </div>
      <div class="hud-btns">
        <div class="hud-time"><b id="h-time">0:00.00</b></div>
        <button id="h-mute" class="ibtn" aria-label="音">♪</button>
        <button id="h-pause" class="ibtn" aria-label="ポーズ">Ⅱ</button>
      </div>
    </div>
    <div class="hud-prog"><i id="h-prog"></i><span id="h-marks"></span><span id="h-dots"></span><em id="h-dot"></em></div>
    <div class="hud-vitals">
      <div class="gauge"><i id="h-gauge"></i><span id="h-gtext"></span></div>
      <div class="gauge sub" id="h-subwrap"><i id="h-sub"></i></div>
      <div class="lv"><span id="h-lv">Lv1</span><div class="xp"><i id="h-xp"></i></div><span class="gum"><img src="${cat.icons.gum}" alt=""><b id="h-gum">0</b></span></div>
      <div class="fouls" id="h-fouls"></div>
    </div>
    <div class="hud-items" id="h-items"></div>
    <div class="hud-boss" id="h-boss"><span id="h-bname"></span><div class="bbar"><i id="h-bbar"></i></div></div>
    <div class="hud-obj" id="h-obj"></div>
    <div class="hud-slots" id="h-slots"></div>
    <div class="hud-banner" id="h-banner"><b></b><small></small></div>
    <div class="hud-cutin" id="h-cutin"><img alt=""><div><small>PASSIVE SKILL</small><b></b><p></p></div></div>
    <div class="hud-pen" id="h-pen"></div>`;
  root.appendChild(el);
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => el.querySelector<T>(`#${id}`)!;
  const time = $('h-time');
  const gauge = $('h-gauge');
  const gtext = $('h-gtext');
  const sub = $('h-sub');
  const subwrap = $('h-subwrap');
  const prog = $('h-prog');
  const dot = $('h-dot');
  const marks = $('h-marks');
  const dotsEl = $('h-dots');
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
  const mute = $('h-mute');
  const place = $('h-place');
  const field = $('h-field');
  const quota = $('h-quota');
  const rankbox = $('h-rankbox');
  const stageEl = $('h-stage');
  const foulsEl = $('h-fouls');
  const cast = $('h-cast');
  const castImg = $<HTMLImageElement>('h-castimg');
  const castLine = $('h-castline');
  const cutin = $('h-cutin');
  const gumEl = $('h-gum');
  const itemsEl = $('h-items');
  let lastGum = -1;
  itemsEl.addEventListener('pointerdown', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.item');
    if (b) {
      e.preventDefault();
      e.stopPropagation();
      pressItem(Number(b.dataset.i));
    }
  });

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
  let lastRank = '';
  let lastFoul = '';
  let bannerT = 0;
  let cutT = 0;
  let dotEls: HTMLElement[] = [];
  let dotsAt = 0;

  // the commentary booth: one line at a time, important lines jump the queue
  const queue: Line[] = [];
  let showing: Line | null = null;
  let shownAt = 0;
  const pump = () => {
    const now = performance.now();
    if (showing && now - shownAt < (queue.length && queue[0].prio > showing.prio ? 700 : 1900)) return;
    const next = queue.shift();
    if (!next) {
      if (showing && now - shownAt > 4200) {
        showing = null;
        cast.classList.remove('on');
      }
      return;
    }
    showing = next;
    shownAt = now;
    castImg.src = next.who === 'ain' ? cat.chars.ainTalk : cat.chars.chrisTalk;
    castLine.textContent = next.text;
    cast.dataset.who = next.who;
    cast.dataset.prio = String(next.prio);
    cast.classList.remove('pop');
    void cast.offsetWidth;
    cast.classList.add('on', 'pop');
  };
  window.setInterval(pump, 200);

  const api: HudView = {
    el,
    onPause: () => undefined,
    onMute: () => false,
    show(stage) {
      el.classList.add('on');
      el.dataset.stage = stage;
      stageEl.textContent = `${STAGE_NAME[stage]} ${STAGE_EN[stage]}`;
      lastG = lastS = lastP = lastXp = lastBF = -3;
      lastGT = lastObj = lastMarks = lastRank = lastFoul = '';
      lastBoss = '';
      lastLv = 0;
      boss.classList.remove('on');
      banner.classList.remove('on');
      cutin.classList.remove('on');
      rankbox.classList.remove('race');
      place.textContent = '';
      field.textContent = '';
      quota.textContent = '';
      foulsEl.innerHTML = '';
      itemsEl.innerHTML = '';
      lastGum = -1;
      dotsEl.innerHTML = '';
      dotEls = [];
      queue.length = 0;
      showing = null;
      cast.classList.remove('on');
      gauge.parentElement!.dataset.kind = stage === 'sea' ? 'o2' : stage === 'sky' ? 'shield' : 'hp';
    },
    hide() {
      el.classList.remove('on');
    },
    clock(st) {
      time.textContent = fmtTime(st);
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
    dots(all) {
      const now = performance.now();
      if (now - dotsAt < 180) return;
      dotsAt = now;
      if (dotEls.length !== all.length) {
        dotsEl.innerHTML = all.map(() => '<s></s>').join('');
        dotEls = Array.from(dotsEl.querySelectorAll<HTMLElement>('s'));
      }
      for (let i = 0; i < all.length; i++) dotEls[i].style.left = `${Math.min(1, all[i]) * 100}%`;
    },
    rank(p, total, passed, q) {
      const key = `${p}/${total}/${passed}/${q}`;
      if (key === lastRank) return;
      const was = Number(lastRank.split('/')[0]) || p;
      lastRank = key;
      rankbox.classList.add('race');
      place.textContent = String(p);
      field.textContent = `位 / ${total}`;
      quota.textContent = `通過 ${passed}/${q}`;
      rankbox.classList.toggle('safe', p <= q);
      quota.classList.toggle('tight', q - passed <= 5);
      if (p !== was) {
        rankbox.classList.remove('up', 'down');
        void rankbox.offsetWidth;
        rankbox.classList.add(p < was ? 'up' : 'down');
      }
    },
    fouls(n, limit) {
      const key = `${n}/${limit}`;
      if (key === lastFoul) return;
      lastFoul = key;
      foulsEl.innerHTML = `<span>反則</span>${Array.from({ length: limit }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}`;
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
            `<div class="slot${s === changed ? ' pop' : ''}${s.def.weapon ? '' : ' boost'}" style="--rar:${RARITY_COLOR[s.lv]};--kind:${s.def.color}">` +
            `<img src="${iconOf(s.def, s.lv)}" alt=""><b>${s.lv >= 5 ? 'MAX' : `Lv${s.lv}`}</b></div>`,
        )
        .join('');
    },
    gum(n) {
      if (n === lastGum) return;
      lastGum = n;
      gumEl.textContent = String(n);
    },
    items(list, max) {
      itemsEl.innerHTML = Array.from({ length: max }, (_, i) => {
        const it = list[i];
        return `<button class="item${it ? ' has' : ''}" data-i="${i}" aria-label="${it ? it.name : '空き'}">${it ? `<img src="${itemImg(it)}" alt=""><span>${it.name}</span>` : ''}<kbd>${i + 1}</kbd></button>`;
      }).join('');
    },
    boss(name, frac = 0) {
      if (name !== lastBoss) {
        lastBoss = name;
        boss.classList.toggle('on', !!name);
        if (name) bname.textContent = name;
      }
      if (name) {
        const f = Math.round(Math.max(0, Math.min(1, frac)) * 200) / 200;
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
    say(text, prio = 1, who = 'chris') {
      // chatter is dropped when the booth is busy; big moments always get through
      if (prio <= 1 && queue.length >= 2) return;
      if (queue.some((l) => l.text === text)) return;
      const line = { text, prio, who };
      const at = queue.findIndex((l) => l.prio < prio);
      if (at < 0) queue.push(line);
      else queue.splice(at, 0, line);
      if (queue.length > 5) queue.length = 5;
      pump();
    },
    cutin(image, name, text) {
      cutin.querySelector('img')!.src = image;
      cutin.querySelector('b')!.textContent = name;
      cutin.querySelector('p')!.textContent = text;
      cutin.classList.remove('on');
      void cutin.offsetWidth;
      cutin.classList.add('on');
      window.clearTimeout(cutT);
      cutT = window.setTimeout(() => cutin.classList.remove('on'), 2300);
    },
  };
  $('h-pause').addEventListener('click', () => api.onPause());
  mute.addEventListener('click', () => {
    mute.classList.toggle('off', api.onMute());
  });
  return api;
}
