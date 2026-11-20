// Everything outside the races: title, relay line-up, the cards between races, the hangar, the result.

import { muffle, sample, sfx, unlockAudio } from '../core/audio';
import { openChat, whenReady } from '../core/platform';
import {
  ARM_SLOTS, autoTune, DEFAULT_ARM, gumLeft, openTune, rankCost, rankSpan, rowValue, SKY_ARMS, TUNE_MAX, TUNE_ROWS, tuneRate, type ArmKind, type TuneId,
} from '../game/tuning';
import { cat, RARITY_COLOR, traitsOf, type Hero } from '../core/catalog';
import { ambient, burstAt, chars, confetti, countUp, cover, isCovered, kick, replay, shock, uncover } from './fx';
import { iconOf, nameOf, type Def } from '../game/roster';
import { input } from '../core/input';
import { commit, save } from '../core/save';
import { meta } from '../game/meta';
import type { Payout } from '../game/reward';
import type { StageResult } from '../stages/stage';
import { fmtDelta, fmtTime } from '../core/util';
import {
  drawCards, maxLvOf, STAGE_EN, STAGE_NAME, STAGES, takeCard, totalTime, type Run, type StageId,
} from '../game/run';

let layer: HTMLElement;
export const screenLayer = () => layer;
export function initScreens(root: HTMLElement): void {
  layer = document.createElement('div');
  layer.className = 'screens';
  root.appendChild(layer);
}

function open(cls: string, html: string): HTMLElement {
  const el = document.createElement('div');
  el.className = `screen ${cls}`;
  el.innerHTML = html;
  layer.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  // a screen that arrives behind the wipe lifts it
  if (isCovered()) window.setTimeout(uncover, 60);
  return el;
}
function close(el: HTMLElement): void {
  el.classList.remove('in');
  el.classList.add('out');
  window.setTimeout(() => el.remove(), 220);
}
const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
const stars = (n: number) => '★'.repeat(n) + '<i>' + '★'.repeat(5 - n) + '</i>';

const RULES: Record<StageId, { goal: string; pc: string; touch: string }> = {
  land: {
    goal: '50組中、30位以内でゴールせよ。敵を倒してレベルを上げ、関門の番人に規定のダメージを与えて通過',
    pc: '前へは自動。W・S で上下 ／ Space ダッシュ ／ Shift ストライク（審判の円の中は反則） ／ 1・2 お助けエクステンション',
    touch: '前へは自動。スティックで上下 ／ A ダッシュ ／ B ストライク（審判の円の中は反則） ／ 右上のアイコンでお助けエクステンション',
  },
  sea: {
    goal: '30組中、先着10組だけが秘宝を手にできる。深さごとの遺物を自分で掘り出して門を抜け、最深部へ',
    pc: '移動 WASD ／ 銛 Space・クリック（審判の円の中でライバルに当てると反則） ／ 遺物・秘宝のそばで自動で発掘',
    touch: '左スティックで移動 ／ A で銛（審判の円の中でライバルに当てると反則） ／ 遺物・秘宝のそばで自動で発掘',
  },
  sky: {
    goal: '10機のバトルロワイヤル。弾は前にしか飛ばない。相手のうしろを取って撃ち、最後の1機になれ',
    pc: '移動 WASD ／ ブースト Space（前へ出る） ／ ブレーキ Shift（うしろへ下がる。出だしはロール） ／ どちらも同じエネルギーを使う',
    touch: '左スティックで移動 ／ A でブースト（前へ出る） ／ B でブレーキ（うしろへ下がる。出だしはロール） ／ どちらも同じエネルギーを使う',
  },
};

// ------------------------------------------------------------------ title
export function titleScreen(): Promise<void> {
  const s = save();
  const m = meta();
  // the parade: a different crowd of heroes runs past every time the title opens
  const crowd = [...cat.heroes].sort(() => Math.random() - 0.5).slice(0, 14);
  const runner = (h: Hero, i: number, shade: boolean) => {
    const d = shade ? 16 + Math.random() * 10 : 7 + Math.random() * 7;
    return `<i class="tt-run${shade ? ' shade' : ''}" style="--d:${d.toFixed(1)}s;--w:${(-Math.random() * d).toFixed(1)}s;--s:${(shade ? 1.5 + Math.random() * 0.6 : 0.8 + (i % 3) * 0.2).toFixed(2)}"><img src="${h.img}" alt=""></i>`;
  };
  const news = [
    m.runs ? `挑戦 <b>${m.runs}</b> 回` : 'はじめての挑戦、歓迎します',
    m.bestPlace ? `陸の最高 <b>${m.bestPlace}位</b>` : m.runs ? `陸の最長 <b>${Math.round(m.bestProgress * 100)}%</b>` : '最初は予選を通れなくて当たり前',
    s.best !== null ? `優勝ベスト <b>${fmtTime(s.best)}</b>` : '走る → 負ける → スキルツリーで強くなる → もう一度',
    '審判の円の中での直接攻撃は反則',
    '順位が低いほど、宝箱から強いお助けエクステンションが出る',
    '空では、弾は前にしか飛ばない',
    '非公式の二次創作です ／ 素材：My Crypto Heroes',
  ].join('　◆　');
  const el = open('title', `
    ${ambient('MY CRYPTO TRIATHLON ● LAND ● SEA ● SKY')}
    <div class="tt-track">${crowd.slice(0, 5).map((h, i) => runner(h, i, true)).join('')}${crowd.slice(5).map((h, i) => runner(h, i, false)).join('')}</div>
    <div class="tt-logo">
      <p class="tt-kicker"><span>50 TEAMS</span><span>3 RACES</span><span>1 CHAMPION</span></p>
      <h1><span class="tt-my">${chars('MY CRYPTO')}</span><span class="tt-tri">${chars('TRIATHLON')}</span></h1>
      <p class="tt-jp">陸・海・空 3種目リレー</p>
    </div>
    <img class="title-chris" src="${cat.chars.chrisCheer}" alt="">
    <div class="tt-side">
      <div class="tt-leg land"><b>陸</b><span>LAND</span><em>50 ▶ 30組</em></div>
      <div class="tt-leg sea"><b>海</b><span>SEA</span><em>30 ▶ 10組</em></div>
      <div class="tt-leg sky"><b>空</b><span>SKY</span><em>最後の1組</em></div>
      <div class="tt-cta"><button class="btn big" id="t-start">START</button><p class="tt-any">TAP ／ PRESS ANY KEY</p></div>
    </div>
    <div class="tt-links"><button class="btn ghost small" id="t-about">このゲームについて</button><button class="btn ghost small" id="t-chat" hidden>💬 全体チャット</button></div>
    <div class="tt-ticker"><span>${news}</span><span>${news}</span></div>`);
  return new Promise((res) => {
    let gone = false;
    const start = async () => {
      if (gone || document.querySelector('.screen.modal')) return;
      gone = true;
      window.removeEventListener('keydown', onKey);
      unlockAudio();
      sfx('select');
      burstAt(el.querySelector('#t-start')!, 22, 160);
      await cover();
      close(el);
      res();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') void start();
    };
    window.addEventListener('keydown', onKey);
    el.querySelector('#t-start')!.addEventListener('click', () => void start());
    el.querySelector('#t-about')!.addEventListener('click', () => {
      unlockAudio();
      sfx('ui');
      aboutModal();
    });
    // the chat of the shared platform: the button only exists once the platform has answered
    const chat = el.querySelector<HTMLButtonElement>('#t-chat')!;
    whenReady(() => (chat.hidden = false));
    chat.addEventListener('click', () => {
      sfx('ui');
      openChat();
    });
  });
}

function aboutModal(): void {
  const el = open('modal', `
    <div class="panel about">
      <h2>このゲームについて</h2>
      <p>My Crypto Triathlon は、My Crypto Heroes のヒーロー 50 組が陸・海・空の3種目を競うスポーツゲームです。3人のヒーローでリレーを組み、エクステンションをバトンのように受け渡します。陸で上位 30 組、海で上位 10 組に入らないと、次へは進めません。</p>
      <p>最初は予選を通れなくて当たり前。走るたびに手に入る CE でスキルツリーを育て、少しずつゴールに近づいていきます。</p>
      <p>HP が 0 になると数秒のあいだ気絶します。コースには審判が立っています。審判の視界（円）の中でライバルを直接攻撃（ストライク）すると反則ポイントがたまり、たまりきるとその場で止められます。円の外なら、おとがめなし。ダッシュの体当たりやアイテムは、どこでも反則になりません。</p>
      <p class="fine">非公式の二次創作（ファン制作）です。ヒーロー・エクステンション・エネミーの画像、BGM、効果音は My Crypto Heroes（MCH Co., Ltd.）のもので、デザインガイドラインに沿って非営利で使っています。クリスくん・マインちゃんのドット絵：こじもこ。</p>
      <p class="fine"><a href="https://bearko.games/" target="_blank" rel="noopener">bearko.games</a></p>
      <button class="btn" id="a-close">とじる</button>
    </div>`);
  el.querySelector('#a-close')!.addEventListener('click', () => {
    sfx('uiBack');
    close(el);
  });
}

// ------------------------------------------------------------------ relay line-up
function draft(n: number): Hero[] {
  const pool = [...cat.heroes];
  const out: Hero[] = [];
  // one specialist for each race first, so every hand has a workable relay
  for (const key of ['land', 'sea', 'sky'] as const) {
    const good = pool.filter((h) => traitsOf(h)[key] >= 4);
    const h = good[Math.floor(Math.random() * good.length)];
    if (h) {
      out.push(h);
      pool.splice(pool.indexOf(h), 1);
    }
  }
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return out.sort(() => Math.random() - 0.5);
}

export function selectScreen(): Promise<[Hero, Hero, Hero]> {
  let hand = draft(10);
  const chosen: (Hero | null)[] = [null, null, null];
  const el = open('select', `
    ${ambient('RELAY ENTRY ● 走順を決める')}
    <header><h2 data-k="ENTRY">リレーの走順を決める</h2><p>ヒーローをタップして、陸 → 海 → 空 の順に並べる</p></header>
    <div class="relay" id="s-relay"></div>
    <div class="hand" id="s-hand"></div>
    <footer>
      <button class="btn ghost" id="s-reroll">引き直す</button>
      <button class="btn ghost" id="s-auto">おまかせ</button>
      <button class="btn big" id="s-go" disabled>スタート</button>
    </footer>`);
  const relay = el.querySelector<HTMLElement>('#s-relay')!;
  const handEl = el.querySelector<HTMLElement>('#s-hand')!;
  const go = el.querySelector<HTMLButtonElement>('#s-go')!;

  const paint = () => {
    relay.innerHTML = STAGES.map((st, i) => {
      const h = chosen[i];
      const t = h ? traitsOf(h) : null;
      return `<button class="leg-slot ${st}${h ? ' set' : ''}${i === justSet ? ' pop' : ''}" data-i="${i}">
        <i class="wm">${STAGE_NAME[st]}</i>
        <span class="tag"><b>${STAGE_NAME[st]}</b>${STAGE_EN[st]}</span>
        ${h ? `<img src="${h.img}" alt=""><span class="nm">${h.name}</span><span class="st">${stars(t![st])}</span>` : '<span class="empty">SELECT</span>'}
      </button>`;
    }).join('<i class="arrow">▶</i>');
    handEl.innerHTML = hand.map((h, i) => {
      const t = traitsOf(h);
      const used = chosen.includes(h);
      return `<button class="card${used ? ' used' : ''}" data-i="${i}" style="--rar:${RARITY_COLOR[h.rarity]};--n:${dealt ? i : -1}">
        <img src="${h.img}" alt="">
        <span class="nm">${h.name}</span>
        <span class="apt"><em class="land">陸</em>${stars(t.land)}</span>
        <span class="apt"><em class="sea">海</em>${stars(t.sea)}</span>
        <span class="apt"><em class="sky">空</em>${stars(t.sky)}</span>
      </button>`;
    }).join('');
    go.disabled = chosen.some((c) => !c);
    if (justSet >= 0) {
      const slot = relay.querySelectorAll('.leg-slot')[justSet];
      if (slot) burstAt(slot, 12, 90);
    }
    justSet = -1;
    dealt = false;
  };
  /** The slot that was just filled (it pops), and whether the hand is being dealt afresh. */
  let justSet = -1;
  let dealt = true;
  paint();

  handEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.card');
    if (!b) return;
    unlockAudio();
    const h = hand[Number(b.dataset.i)];
    const at = chosen.indexOf(h);
    if (at >= 0) {
      chosen[at] = null;
      sfx('uiBack');
    } else {
      const free = chosen.indexOf(null);
      if (free < 0) return;
      chosen[free] = h;
      justSet = free;
      sfx('stamp');
    }
    paint();
  });
  relay.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.leg-slot');
    if (!b) return;
    const i = Number(b.dataset.i);
    if (chosen[i]) {
      chosen[i] = null;
      sfx('uiBack');
      paint();
    }
  });
  el.querySelector('#s-reroll')!.addEventListener('click', () => {
    unlockAudio();
    hand = draft(10);
    chosen.fill(null);
    dealt = true;
    sfx('deal');
    paint();
  });
  el.querySelector('#s-auto')!.addEventListener('click', () => {
    unlockAudio();
    const left = [...hand];
    STAGES.forEach((st, i) => {
      left.sort((a, b) => traitsOf(b)[st] - traitsOf(a)[st]);
      chosen[i] = left.shift()!;
    });
    sfx('stamp');
    paint();
    relay.querySelectorAll('.leg-slot').forEach((sl) => replay(sl, 'pop'));
  });
  return new Promise((res) => {
    go.addEventListener('click', async () => {
      unlockAudio();
      sfx('select');
      burstAt(go, 20, 150);
      await cover();
      close(el);
      res(chosen as [Hero, Hero, Hero]);
    });
  });
}

// ------------------------------------------------------------------ before a race
/** The card that introduces the race, then 3-2-1. The clock is not running here. */
export async function introCard(stage: StageId, index: number, run: Run, quick: boolean): Promise<void> {
  const h = run.heroes[index];
  const r = RULES[stage];
  const el = open(`intro ${stage}`, `
    <div class="in-tint"></div>
    <i class="in-kanji">${STAGE_NAME[stage]}</i>
    <div class="in-runner"><img src="${h.img}" alt=""><p><small>RUNNER</small>${h.name}</p></div>
    <div class="in-body">
      <p class="in-leg"><span>ROUND ${index + 1}</span><span>${['第1走', '第2走', '第3走'][index]}</span></p>
      <h2>${STAGE_EN[stage]}</h2>
      <p class="in-goal">${r.goal}</p>
      <p class="in-keys">${(input.touch ? r.touch : r.pc).split(' ／ ').join('<br>')}</p>
    </div>
    <p class="tap">TAP ／ SPACE でスタート</p>
    <div class="count" id="i-count"></div>`);
  if (!quick) sfx('stamp');
  if (!quick) {
    await new Promise<void>((res) => {
      let done = false;
      const fin = () => {
        if (done) return;
        done = true;
        window.removeEventListener('keydown', onKey);
        res();
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.code === 'Space' || e.code === 'Enter') fin();
      };
      window.addEventListener('keydown', onKey);
      el.addEventListener('click', fin);
      window.setTimeout(fin, 6000);
    });
  }
  unlockAudio();
  if (!quick) sfx('whoosh');
  el.classList.add('counting');
  const count = el.querySelector<HTMLElement>('#i-count')!;
  for (const n of quick ? [] : ['3', '2', '1']) {
    count.textContent = n;
    count.classList.remove('tick');
    void count.offsetWidth;
    count.classList.add('tick');
    sfx('count');
    kick(5);
    await wait(430);
  }
  count.textContent = 'GO!';
  count.classList.remove('tick');
  void count.offsetWidth;
  count.classList.add('tick', 'go');
  sfx('go');
  if (!quick) {
    kick(12);
    shock(window.innerWidth / 2, window.innerHeight / 2, '#d8ff3a');
  }
  window.setTimeout(() => close(el), 350);
}

/** Split time after a race. Resolves on a tap or after a moment: the next runner is waiting. */
export async function clearCard(index: number, run: Run, res?: StageResult): Promise<void> {
  const stage = STAGES[index];
  const s = save();
  const split = run.splits[index];
  const pb = s.bestSplits?.[index];
  const gold = s.gold[index];
  const isGold = gold === null || split < gold;
  const delta = pb !== undefined && pb !== null ? split - pb : null;
  sample('win', 0.5);
  const el = open(`clear ${stage}`, `
    <div class="clear-band">
      <p class="what">${res ? `${STAGE_NAME[stage]} ${res.place}位で通過！` : `${STAGE_NAME[stage]} CLEAR`}</p>
      <p class="split">${fmtTime(split)}</p>
      <p class="delta ${delta === null ? '' : delta <= 0 ? 'ahead' : 'behind'}">
        ${delta === null ? '' : `自己ベスト比 ${fmtDelta(delta)}`}${isGold && gold !== null ? ' <b class="gold">区間ベスト！</b>' : ''}
      </p>
      <p class="tot">TOTAL ${fmtTime(totalTime(run))}</p>
      ${index < 2 ? `<p class="baton">バトンタッチ ▶ <img src="${run.heroes[index + 1].img}" alt=""> ${run.heroes[index + 1].name}</p>` : ''}
    </div>`);
  await new Promise<void>((res) => {
    let done = false;
    const fin = () => {
      if (done) return;
      done = true;
      window.removeEventListener('keydown', onKey);
      res();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') fin();
    };
    window.setTimeout(() => {
      window.addEventListener('keydown', onKey);
      el.addEventListener('click', fin);
    }, 350);
    window.setTimeout(fin, 2600);
  });
  close(el);
}

// ------------------------------------------------------------------ hangar
/** Choose up to four pieces of gear to bolt onto the fighter. */
/**
 * The hangar before the sky. Every extension is sold for GUM first; the GUM then buys ranks for the hull
 * (one row per stat: pick a rank with ◀ ▶, see the number it will become, confirm the lot) and sky-only weapons.
 * The clock keeps running while the player decides. Resolves with the seconds spent here.
 */
export function tuneScreen(run: Run, quick: boolean): Promise<number> {
  const t = openTune(run);
  if (quick) {
    autoTune(run);
    return Promise.resolve(0);
  }
  const pilot = run.heroes[2];
  const el = open('tune', `
    <div class="tn-top">
      <p class="tn-title"><b>TUNING</b><span>${pilot.name} 機</span></p>
      <p class="tn-rate">改造度 <b id="tn-rate">0%</b></p>
      <p class="tn-gum"><img src="${cat.icons.gum}" alt=""><b id="tn-gum">0</b><small>GUM</small></p>
      <p class="tn-time">TIME <b id="tn-time">0:00.0</b></p>
    </div>
    <div class="tn-main">
      <div class="tn-panel tn-rows">
        <p class="tn-head"><span>改造項目</span><em>◀ ▶ でランクを選び「実行」で確定</em></p>
        <div id="tn-rows"></div>
      </div>
      <div class="tn-side">
        <div class="tn-ship" id="tn-ship"></div>
        <div class="tn-panel tn-arms">
          <p class="tn-head"><span>武装</span><em>追加は ${ARM_SLOTS} つまで</em></p>
          <div id="tn-arms"></div>
        </div>
      </div>
    </div>
    <div class="tn-foot">
      <p class="tn-cost"><span>消費GUM</span><b id="tn-use">0</b></p>
      <p class="tn-cost"><span>残GUM</span><b id="tn-left">0</b></p>
      <button class="btn" id="tn-apply" disabled>実行</button>
      <button class="btn ghost small" id="tn-auto">おまかせ</button>
      <button class="btn big" id="tn-go">発進！</button>
    </div>
    <div class="tn-sell" id="tn-sell">
      <div class="tn-sellbox">
        <h2>エクステンションを GUM に換える</h2>
        <p>陸と海で集めた品は、空へは持ちこめない。すべて売って、機体の改造と武装にあてる</p>
        <ul>${t.sold.map((s, i) => `<li style="animation-delay:${i * 60}ms;--rar:${RARITY_COLOR[s.lv]}"><img src="${s.img}" alt=""><span>${s.name}</span><b>+${s.gum}</b></li>`).join('')}
          <li class="held" style="animation-delay:${t.sold.length * 60}ms"><img src="${cat.icons.gum}" alt=""><span>レースで拾った GUM</span><b>+${t.earned}</b></li></ul>
        <p class="tn-total"><img src="${cat.icons.gum}" alt=""> 合計 <b>${t.budget}</b> GUM</p>
        <button class="btn big" id="tn-sold">チューニングへ</button>
      </div>
    </div>`);
  const $ = <T extends HTMLElement>(q: string) => el.querySelector<T>(q)!;
  const rowsEl = $('#tn-rows');
  const armsEl = $('#tn-arms');
  const shipEl = $('#tn-ship');
  const apply = $<HTMLButtonElement>('#tn-apply');
  /** Ranks picked but not yet confirmed. */
  const want: Record<TuneId, number> = { ...t.ranks };
  let cursor = 0;
  const pending = () => TUNE_ROWS.reduce((a, r) => a + rankSpan(t.ranks[r.id], want[r.id]), 0);
  const paint = () => {
    const use = pending();
    const left = gumLeft(t) - use;
    rowsEl.innerHTML = TUNE_ROWS.map((r, i) => {
      const cur = t.ranks[r.id];
      const nw = want[r.id];
      const next = nw < TUNE_MAX ? rankCost(nw) : 0;
      const segs = Array.from({ length: TUNE_MAX }, (_, k) => `<s class="${k < cur ? 'on' : k < nw ? 'new' : ''}" style="--k:${k}"></s>`).join('');
      return `<div class="tn-row${i === cursor ? ' sel' : ''}${nw > cur ? ' changed' : ''}" data-id="${r.id}" style="--c:${r.color}">
        <span class="tn-lab">${r.name}<small>${r.note}</small></span>
        <div class="tn-rank"><small>RANK</small>
          <button data-d="-1" ${nw <= cur ? 'disabled' : ''} aria-label="下げる">◀</button><b>${nw}</b><button data-d="1" ${nw >= TUNE_MAX || next > left ? 'disabled' : ''} aria-label="上げる">▶</button>
        </div>
        <div class="tn-val">
          <p><span>${rowValue(run, r.id, cur)}</span><i>»</i><span class="${nw > cur ? 'up' : ''}">${rowValue(run, r.id, nw)}${nw > cur ? ' ▲' : ''}</span>
            <em>${nw >= TUNE_MAX ? 'MAX' : `次 ${next}`}</em></p>
          <div class="tn-segs">${segs}</div>
        </div>
      </div>`;
    }).join('');
    window.setTimeout(() => rowsEl.parentElement!.classList.add('painted'), 600);
    armsEl.innerHTML = `<div class="tn-arm std"><img src="${DEFAULT_ARM.img}" alt=""><span><b>${DEFAULT_ARM.name}</b><small>${DEFAULT_ARM.desc}</small></span><em>標準</em></div>` +
      SKY_ARMS.map((a) => {
        const on = t.arms.includes(a.id);
        const can = on || (t.arms.length < ARM_SLOTS && a.price <= left);
        return `<button class="tn-arm${on ? ' on' : ''}" data-arm="${a.id}" ${can ? '' : 'disabled'}>
          <img src="${a.img}" alt=""><span><b>${a.name}</b><small>${a.desc}</small></span><em>${on ? '装備中' : a.price}</em></button>`;
      }).join('');
    shipEl.innerHTML = `
      <svg viewBox="0 0 200 150" class="hull" aria-hidden="true">
        <polygon points="100,8 118,70 100,128 82,70" fill="#e8eef7"/>
        <polygon points="100,8 118,70 100,60" fill="#bcc8da"/>
        <polygon points="84,62 14,112 20,124 86,100" fill="#6f8fd6"/>
        <polygon points="116,62 186,112 180,124 114,100" fill="#5878c0"/>
        <polygon points="92,104 100,146 108,104" fill="#ff9a3d"/>
        <polygon points="96,40 104,40 108,64 92,64" fill="#2b3350"/>
      </svg>
      <img class="pilot" src="${pilot.img}" alt="">
      <img class="tn-hard nose" src="${DEFAULT_ARM.img}" alt="">
      ${t.arms.map((id, i) => `<img class="tn-hard h${i}" src="${SKY_ARMS.find((a) => a.id === id)!.img}" alt="">`).join('')}`;
    $('#tn-gum').textContent = String(gumLeft(t));
    $('#tn-use').textContent = String(use);
    $('#tn-left').textContent = String(left);
    $('#tn-left').classList.toggle('low', left < 40);
    $('#tn-rate').textContent = `${tuneRate(t)}%`;
    apply.disabled = use <= 0;
  };
  const step = (id: TuneId, d: number) => {
    const nw = want[id] + d;
    if (nw < t.ranks[id] || nw > TUNE_MAX) return;
    if (d > 0 && rankCost(want[id]) > gumLeft(t) - pending()) {
      sfx('hit');
      return;
    }
    want[id] = nw;
    sfx(d > 0 ? 'ui' : 'uiBack');
    paint();
  };
  const commit = (loud: boolean) => {
    if (pending() <= 0) return;
    for (const r of TUNE_ROWS) t.ranks[r.id] = want[r.id];
    if (loud) {
      sfx('levelup');
      sample('buff', 0.5);
      el.classList.remove('done');
      void el.offsetWidth;
      el.classList.add('done');
      window.setTimeout(() => el.classList.remove('done'), 500);
    }
    paint();
  };
  paint();
  rowsEl.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.tn-row');
    if (!row) return;
    cursor = TUNE_ROWS.findIndex((r) => r.id === row.dataset.id);
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (b && !b.disabled) step(row.dataset.id as TuneId, Number(b.dataset.d));
    else paint();
  });
  armsEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button.tn-arm');
    if (!b || b.disabled) return;
    const id = b.dataset.arm as ArmKind;
    const at = t.arms.indexOf(id);
    if (at >= 0) {
      t.arms.splice(at, 1);
      sfx('uiBack');
    } else {
      t.arms.push(id);
      sample('chest', 0.5);
    }
    paint();
  });
  apply.addEventListener('click', () => commit(true));
  $('#tn-auto').addEventListener('click', () => {
    for (const r of TUNE_ROWS) want[r.id] = t.ranks[r.id];
    autoTune(run);
    for (const r of TUNE_ROWS) want[r.id] = t.ranks[r.id];
    sfx('levelup');
    paint();
  });
  const onKey = (e: KeyboardEvent) => {
    if (!$('#tn-sell').hidden) return;
    const id = TUNE_ROWS[cursor].id;
    if (e.code === 'ArrowUp' || e.code === 'KeyW') cursor = (cursor + TUNE_ROWS.length - 1) % TUNE_ROWS.length;
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') cursor = (cursor + 1) % TUNE_ROWS.length;
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') return step(id, -1);
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') return step(id, 1);
    else if (e.code === 'Enter') return commit(true);
    else return;
    sfx('ui', 0.05);
    paint();
  };
  window.addEventListener('keydown', onKey);
  $('#tn-sold').addEventListener('click', () => {
    sample('chest', 0.6);
    $('#tn-sell').hidden = true;
  });
  const began = performance.now();
  const clock = window.setInterval(() => {
    $('#tn-time').textContent = fmtTime((performance.now() - began) / 1000);
  }, 100);
  return new Promise((res) => {
    $('#tn-go').addEventListener('click', () => {
      commit(false);
      window.clearInterval(clock);
      window.removeEventListener('keydown', onKey);
      t.time = (performance.now() - began) / 1000;
      sfx('go');
      close(el);
      res(t.time);
    });
  });
}

// ------------------------------------------------------------------ result
export type After = 'retry' | 'select';
export function resultScreen(run: Run, pay?: Payout): Promise<After> {
  const s = save();
  const total = totalTime(run);
  const prev = s.best;
  const prevSplits = s.bestSplits;
  const record = prev === null || total < prev;
  s.runs += 1;
  run.splits.forEach((t, i) => {
    if (s.gold[i] === null || t < s.gold[i]!) s.gold[i] = t;
  });
  if (record) {
    s.best = total;
    s.bestSplits = [run.splits[0], run.splits[1], run.splits[2]];
  }
  commit();
  sample('win', 0.6);
  sfx('fanfare');
  confetti(160);
  window.setTimeout(() => {
    sfx('slam');
    kick(14);
    confetti(120);
  }, 480);
  const rows = STAGES.map((st, i) => {
    const d = prevSplits ? run.splits[i] - prevSplits[i] : null;
    return `<li class="${st}">
      <img src="${run.heroes[i].img}" alt="">
      <span class="rn"><b>${STAGE_NAME[st]}</b>${run.heroes[i].name}</span>
      <span class="rt">${fmtTime(run.splits[i])}</span>
      <span class="rd ${d === null ? '' : d <= 0 ? 'ahead' : 'behind'}">${d === null ? '' : fmtDelta(d)}</span>
    </li>`;
  }).join('');
  const el = open('result', `
    ${ambient('CHAMPION ● MY CRYPTO TRIATHLON ● WINNER', 'sky')}
    <div class="result-box">
      <p class="fin">CHAMPION ― 3 種目を制した</p>
      ${record ? `<p class="record">${prev === null ? '初優勝！' : '自己ベスト更新！'}</p>` : ''}
      <p class="total">${fmtTime(total)}</p>
      <p class="vs">${prev !== null ? `これまでのベスト ${fmtTime(prev)}（${fmtDelta(total - prev)}）` : '&nbsp;'}</p>
      <ul class="splits">${rows}</ul>
      <p class="meta">撃破 ${run.kills} ／ ダウン ${run.downs}（+${(run.downs * 8).toFixed(0)}秒） ／ チーム Lv${run.level}</p>
      <div class="gear">${run.slots.map((sl) => `<span style="--rar:${RARITY_COLOR[sl.lv]}" title="${nameOf(sl.def, sl.lv)}"><img src="${iconOf(sl.def, sl.lv)}" alt=""><b>Lv${sl.lv}</b></span>`).join('')}</div>
      ${pay ? `<p class="earn"><img src="${cat.icons.ce}" alt=""> CE +${pay.total}${pay.feats.length ? ` ／ 🏅 メダル +${pay.feats.length}` : ''}</p>` : ''}
      <footer>
        <button class="btn big" id="r-retry">スキルツリーへ</button>
      </footer>
    </div>
    <img class="result-chris" src="${record ? cat.chars.chrisGuts : cat.chars.chrisIdle}" alt="">`);
  return new Promise((res) => {
    el.querySelector('#r-retry')!.addEventListener('click', async () => {
      sfx('select');
      await cover();
      close(el);
      res('retry');
    });
  });
}

// ------------------------------------------------------------------ pause
export function pauseScreen(): Promise<'resume' | 'restart' | 'quit'> {
  muffle(true);
  const el = open('modal', `
    <div class="panel pause">
      <h2>PAUSE</h2>
      <p>タイムは止まっています</p>
      <button class="btn big" data-a="resume">つづける</button>
      <button class="btn ghost" data-a="restart">最初からやりなおす</button>
      <button class="btn ghost" data-a="quit">タイトルへ</button>
    </div>`);
  return new Promise((res) => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'KeyP') fin('resume');
    };
    const fin = (a: 'resume' | 'restart' | 'quit') => {
      window.removeEventListener('keydown', onKey);
      sfx(a === 'resume' ? 'ui' : 'uiBack');
      muffle(false);
      close(el);
      res(a);
    };
    window.setTimeout(() => window.addEventListener('keydown', onKey), 100);
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
      if (b) fin(b.dataset.a as 'resume' | 'restart' | 'quit');
    });
  });
}

// ------------------------------------------------------------------ out of the race
/** Cut off before the goal (or outside the qualifying places). Shows how far it went and what it earned. */
export function outScreen(stage: StageId, res: StageResult, pay: Payout): Promise<void> {
  sample('lose', 0.5);
  sfx('sad');
  window.setTimeout(() => {
    sfx('stamp');
    kick(8);
  }, 330);
  const m = meta();
  const left = Math.round((1 - res.progress) * 3000);
  const el = open(`outrace ${stage}`, `
    ${ambient(`${STAGE_EN[stage]} ● ${stage === 'sky' ? 'SHOT DOWN' : 'OUT OF THE RACE'} ● TRY AGAIN`, stage)}
    <div class="out-box">
      <div class="out-l">
      <p class="fin">${STAGE_NAME[stage]}・${stage === 'sky' ? '決勝' : '予選'}</p>
      <h2>${res.progress >= 1 ? '通過ならず…' : stage === 'sky' ? '撃墜された…' : stage === 'sea' ? '秘宝が尽きた！' : '時間切れ！'}</h2>
      <p class="place"><b>${res.place}</b>位 <small>/ ${res.field}組（${stage === 'sky' ? '優勝は 1 組だけ' : `通過は ${res.quota}位まで`}）</small></p>
      <div class="howfar"><i style="width:${res.progress * 100}%"></i>${stage === 'land' ? `<u style="left:${m.bestProgress * 100}%"></u>` : ''}</div>
      <p class="left">${res.progress >= 1 ? 'ゴールはできた。あとは順位だ' : stage === 'sky' ? (res.place === 2 ? 'あと1機だった！' : `優勝まで あと ${res.place - 1}機`) : stage === 'sea' ? (res.progress > 0.9 ? '秘宝まで、あと一歩だった' : `最深部まで あと ${Math.round((1 - res.progress) * 420)}m`) : `ゴールまで あと ${left}m`}</p>
      </div>
      <div class="out-r">
      <ul class="pay">${pay.lines.map((l, i) => `<li style="--n:${i}"><span>${l.label}</span><b>+${l.ce}</b></li>`).join('')}
        ${pay.mult !== 1 ? `<li class="mul" style="--n:${pay.lines.length}"><span>賞金アップ</span><b>×${pay.mult.toFixed(2)}</b></li>` : ''}
        <li class="sum" style="--n:${pay.lines.length + 1}"><span><img src="${cat.icons.ce}" alt=""> 獲得 CE</span><b id="o-sum">+0</b></li>
      </ul>
      ${pay.feats.length ? `<p class="newfeat">🏅 メダル獲得：${pay.feats.map((f) => f.name).join('、')}</p>` : ''}
      <p class="hint">CE でスキルツリーを育てて、もう一度。</p>
      <button class="btn big" id="o-go">スキルツリーへ</button>
      </div>
    </div>
    <img class="result-chris out-chris" src="${cat.chars.chrisCry}" alt="">`);
  // the prize counts up after the lines have come in, and lands with a coin
  const sum = el.querySelector<HTMLElement>('#o-sum')!;
  window.setTimeout(() => {
    void countUp(sum, pay.total, 700, (n) => `+${n}`).then(() => {
      sfx('coin');
      burstAt(sum, 12, 70, ['#d8ff3a', '#ffe45c', '#ffffff']);
    });
  }, 900 + pay.lines.length * 70);
  return new Promise((r) => {
    el.querySelector('#o-go')!.addEventListener('click', async () => {
      sfx('select');
      await cover();
      close(el);
      r();
    });
  });
}

// ------------------------------------------------------------------ level up
/** Three cards (or four); one is taken. The race holds still meanwhile. Keys 1-4 also pick. */
/** Over the finished race (which keeps running behind it): the place, large, and the way on. */
export function goalScreen(stage: StageId, index: number, run: Run, res: StageResult, time: number): Promise<void> {
  sample('win', 0.5);
  const next = index < 2 ? run.heroes[index + 1] : null;
  sfx('slam');
  window.setTimeout(() => {
    kick(14);
    shock(window.innerWidth / 2, window.innerHeight * 0.36);
    confetti(res.place <= 3 ? 120 : 60);
    sfx(res.place <= 3 ? 'fanfare' : 'rankUp');
  }, 420);
  const el = open(`goal ${stage}`, `
    <div class="goal-top">
      <p class="goal-fin">GOAL!</p>
      <p class="goal-place"><b>${res.place}</b><span>位</span></p>
      <p class="goal-sub">${res.field}組中 ／ 通過は ${res.quota}位まで　<em>${STAGE_NAME[stage]} ${fmtTime(time)}</em></p>
    </div>
    <div class="goal-bottom">
      ${next ? `<p class="baton">バトンタッチ ▶ <img src="${next.img}" alt=""> ${next.name}</p>` : ''}
      <button class="btn big" id="g-next" disabled>次のステージへ進む</button>
    </div>`);
  return new Promise((r) => {
    const btn = el.querySelector<HTMLButtonElement>('#g-next')!;
    // the button wakes a moment later, so a press meant for the race does not skip the finish
    window.setTimeout(() => (btn.disabled = false), 1200);
    btn.addEventListener('click', async () => {
      sfx('select');
      await cover();
      close(el);
      r();
    });
  });
}

export function levelUpScreen(run: Run, auto: boolean): Promise<void> {
  const shown = new Set<string>();
  let cards = drawCards(run);
  if (!cards.length) {
    run.pending = Math.max(0, run.pending - 1);
    return Promise.resolve();
  }
  if (auto) {
    takeCard(run, cards.find((c) => c.weapon) ?? cards[0]);
    run.pending = Math.max(0, run.pending - 1);
    return Promise.resolve();
  }
  sample('chest', 0.5);
  sfx('levelup');
  muffle(true);
  const el = open('levelup', '<div class="lu-box"><p class="lu-head"></p><div class="lu-cards"></div><p class="lu-wait">ボタンから手をはなすと選べます</p><div class="lu-foot"></div></div>');
  const head = el.querySelector<HTMLElement>('.lu-head')!;
  const box = el.querySelector<HTMLElement>('.lu-cards')!;
  const foot = el.querySelector<HTMLElement>('.lu-foot')!;
  const max = maxLvOf();
  const paint = () => {
    head.innerHTML = `<b>${chars('LEVEL UP!')}</b><span>チーム Lv${run.level} ／ エクステンションを 1 つ選ぶ</span>`;
    box.innerHTML = cards.map((d: Def, i) => {
      const own = run.slots.find((s) => s.def === d);
      const next = (own?.lv ?? 0) + 1;
      const t = d.tiers[next - 1];
      return `<button class="lu-card ${d.weapon ? 'weapon' : 'boost'}" data-i="${i}" style="--c:${d.color};--rar:${RARITY_COLOR[next]};--n:${i};animation-delay:${i * 90 + 120}ms">
        <span class="lu-tag">${own ? `Lv${own.lv} → <b>Lv${next}${next >= max ? ' MAX' : ''}</b>` : '<b>NEW</b>'}</span>
        <img src="${iconOf(d, next)}" alt="">
        <span class="lu-name">${nameOf(d, next)}</span>
        <span class="lu-kind">${d.weapon ? '武器' : '強化'}・${d.skill}</span>
        <span class="lu-desc">${d.desc(t)}</span>
        <kbd>${i + 1}</kbd>
      </button>`;
    }).join('');
    foot.innerHTML = run.rerolls > 0 ? `<button class="btn ghost small" id="lu-re">引き直す（あと ${run.rerolls} 回）</button>` : '';
  };
  paint();
  return new Promise((res) => {
    let done = false;
    const pick = (i: number) => {
      if (done || !cards[i]) return;
      done = true;
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', mash, true);
      takeCard(run, cards[i]);
      run.pending = Math.max(0, run.pending - 1);
      sfx('select');
      sample('buff', 0.5);
      // the chosen card flies up and out; the others fall off the table
      const chosenEl = box.querySelector(`[data-i="${i}"]`);
      box.querySelectorAll('.lu-card').forEach((c) => c.classList.add(c === chosenEl ? 'picked' : 'lost'));
      if (chosenEl) burstAt(chosenEl, 20, 140);
      kick(6);
      window.setTimeout(() => {
        muffle(false);
        close(el);
        res();
      }, 330);
    };
    const onKey = (e: KeyboardEvent) => {
      const i = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
      if (i >= 0 && armed) pick(i);
    };
    // A guard against button mashing: the cards cannot be taken until the hands have been still for a moment.
    // Every press during the guard (a tap anywhere, a key) starts the wait again.
    let armed = false;
    let timer = 0;
    const arm = (ms: number) => {
      window.clearTimeout(timer);
      el.classList.remove('armed');
      timer = window.setTimeout(() => {
        armed = true;
        el.classList.add('armed');
        sfx('armed');
      }, ms);
    };
    const mash = (e: Event) => {
      if (!armed && !(e as KeyboardEvent).repeat) arm(450);
    };
    arm(700);
    el.addEventListener('pointerdown', mash, true);
    window.addEventListener('keydown', mash, true);
    window.addEventListener('keydown', onKey);
    el.addEventListener('click', (e) => {
      if (!armed) return;
      const t = e.target as HTMLElement;
      if (t.closest('#lu-re') && run.rerolls > 0) {
        run.rerolls -= 1;
        for (const c of cards) shown.add(c.id);
        cards = drawCards(run, shown);
        sfx('ui');
        paint();
        return;
      }
      const b = t.closest<HTMLElement>('.lu-card');
      if (b) pick(Number(b.dataset.i));
    });
  });
}
