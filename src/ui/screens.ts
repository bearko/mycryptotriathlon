// Everything outside the races: title, relay line-up, the cards between races, the hangar, the result.

import { sample, sfx, unlockAudio } from '../core/audio';
import {
  cat, KIND_COLOR, KIND_LABEL, KIND_SKY, RARITY_COLOR, RARITY_NAME, traitsOf, type Hero,
} from '../core/catalog';
import { input } from '../core/input';
import { commit, save } from '../core/save';
import { fmtDelta, fmtTime } from '../core/util';
import {
  autoFighter, fighterStats, STAGE_EN, STAGE_NAME, STAGES, totalTime, type Run, type StageId,
} from '../game/run';

let layer: HTMLElement;
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
    goal: 'エクステンションを拾って強くなり、関門を破ってゴールへ',
    pc: '移動 WASD ／ ダッシュ Space',
    touch: '左スティックで移動 ／ A でダッシュ',
  },
  sea: {
    goal: '遺物を掘り出して門を開き、深海の主を倒して秘宝を手に入れろ',
    pc: '移動 WASD ／ 銛 Space・クリック ／ 宝のそばで自動で発掘',
    touch: '左スティックで移動 ／ A で銛 ／ 宝のそばで自動で発掘',
  },
  sky: {
    goal: '集めたエクステンションの戦闘機で、宇宙の果てまで飛べ',
    pc: '移動 WASD ／ ブースト Space ／ ロール Shift（弾をはじく）',
    touch: '左スティックで移動 ／ A でブースト ／ B でロール',
  },
};

// ------------------------------------------------------------------ title
export function titleScreen(): Promise<void> {
  const s = save();
  const el = open('title', `
    <div class="title-bg" style="background-image:url(${cat.bg.title})"></div>
    <div class="title-box">
      <p class="title-sub">陸・海・空 3種目リレー タイムアタック</p>
      <h1><span>My</span><span>Crypto</span><span class="tri">Triathlon</span></h1>
      <div class="title-legs">
        <span class="l-land"><b>陸</b>駆け抜ける</span><i>▶</i>
        <span class="l-sea"><b>海</b>潜る</span><i>▶</i>
        <span class="l-sky"><b>空</b>飛ぶ</span>
      </div>
      <button class="btn big" id="t-start">START</button>
      <p class="title-best">${s.best !== null ? `自己ベスト <b>${fmtTime(s.best)}</b>` : 'はじめての挑戦'}</p>
      <button class="btn ghost small" id="t-about">このゲームについて</button>
    </div>
    <img class="title-chris" src="${cat.chars.chrisCheer}" alt="">
    <p class="title-foot">非公式の二次創作です ／ 素材：My Crypto Heroes</p>`);
  return new Promise((res) => {
    el.querySelector('#t-start')!.addEventListener('click', () => {
      unlockAudio();
      sfx('ui');
      close(el);
      res();
    });
    el.querySelector('#t-about')!.addEventListener('click', () => {
      unlockAudio();
      sfx('ui');
      aboutModal();
    });
  });
}

function aboutModal(): void {
  const el = open('modal', `
    <div class="panel about">
      <h2>このゲームについて</h2>
      <p>My Crypto Triathlon は、My Crypto Heroes のヒーローが陸・海・空の3種目をリレーでつなぐ、タイムアタックのスポーツゲームです。3人のヒーローを選び、エクステンションをバトンのように受け渡しながら、合計タイムの短さを競います。</p>
      <p>ダウンしてもレースは終わりません。そのぶん、タイムに <b>+8秒</b> が加わります。</p>
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
    <header><h2>リレーの走順を決める</h2><p>ヒーローをタップして、陸 → 海 → 空 の順に並べる</p></header>
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
      return `<button class="leg-slot ${st}${h ? ' set' : ''}" data-i="${i}">
        <span class="tag"><b>${STAGE_NAME[st]}</b>${STAGE_EN[st]}</span>
        ${h ? `<img src="${h.img}" alt=""><span class="nm">${h.name}</span><span class="st">${stars(t![st])}</span>` : '<span class="empty">？</span>'}
      </button>`;
    }).join('<i class="arrow">▶</i>');
    handEl.innerHTML = hand.map((h, i) => {
      const t = traitsOf(h);
      const used = chosen.includes(h);
      return `<button class="card${used ? ' used' : ''}" data-i="${i}" style="--rar:${RARITY_COLOR[h.rarity]}">
        <img src="${h.img}" alt="">
        <span class="nm">${h.name}</span>
        <span class="apt"><em class="land">陸</em>${stars(t.land)}</span>
        <span class="apt"><em class="sea">海</em>${stars(t.sea)}</span>
        <span class="apt"><em class="sky">空</em>${stars(t.sky)}</span>
      </button>`;
    }).join('');
    go.disabled = chosen.some((c) => !c);
  };
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
      sfx('ui');
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
    sfx('ui');
    paint();
  });
  el.querySelector('#s-auto')!.addEventListener('click', () => {
    unlockAudio();
    const left = [...hand];
    STAGES.forEach((st, i) => {
      left.sort((a, b) => traitsOf(b)[st] - traitsOf(a)[st]);
      chosen[i] = left.shift()!;
    });
    sfx('ui');
    paint();
  });
  return new Promise((res) => {
    go.addEventListener('click', () => {
      unlockAudio();
      sfx('go');
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
    <div class="intro-band">
      <p class="leg-no">${['第1走', '第2走', '第3走'][index]}</p>
      <h2><b>${STAGE_NAME[stage]}</b><span>${STAGE_EN[stage]}</span></h2>
      <div class="runner"><img src="${h.img}" alt=""><span>${h.name}</span></div>
      <p class="goal">${r.goal}</p>
      <p class="keys">${input.touch ? r.touch : r.pc}</p>
      <p class="tap">タップ / Space でスタート</p>
    </div>
    <div class="count" id="i-count"></div>`);
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
  el.classList.add('counting');
  const count = el.querySelector<HTMLElement>('#i-count')!;
  for (const n of quick ? [] : ['3', '2', '1']) {
    count.textContent = n;
    count.classList.remove('tick');
    void count.offsetWidth;
    count.classList.add('tick');
    sfx('count');
    await wait(430);
  }
  count.textContent = 'GO!';
  count.classList.remove('tick');
  void count.offsetWidth;
  count.classList.add('tick', 'go');
  sfx('go');
  window.setTimeout(() => close(el), 350);
}

/** Split time after a race. Resolves on a tap or after a moment: the next runner is waiting. */
export async function clearCard(index: number, run: Run): Promise<void> {
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
      <p class="what">${STAGE_NAME[stage]} CLEAR</p>
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
export function hangarScreen(run: Run, quick: boolean): Promise<void> {
  run.fighter = autoFighter(run);
  if (quick) return Promise.resolve();
  const pilot = run.heroes[2];
  const el = open('hangar', `
    <header><h2>戦闘機を組み立てる</h2><p>ここまでに集めたエクステンションから 4 つまで搭載（タイムは止まっています）</p></header>
    <div class="hangar-main">
      <div class="ship" id="g-ship"></div>
      <div class="parts" id="g-parts"></div>
    </div>
    <div class="specs" id="g-specs"></div>
    <footer><button class="btn ghost" id="g-auto">おまかせ</button><button class="btn big" id="g-go">発進！</button></footer>`);
  const ship = el.querySelector<HTMLElement>('#g-ship')!;
  const parts = el.querySelector<HTMLElement>('#g-parts')!;
  const specs = el.querySelector<HTMLElement>('#g-specs')!;
  const paint = () => {
    const picked = run.fighter.map((id) => run.slots.find((s) => s.ext.id === id)!).filter(Boolean);
    ship.innerHTML = `
      <svg viewBox="0 0 200 150" class="hull" aria-hidden="true">
        <polygon points="100,8 118,70 100,128 82,70" fill="#e8eef7"/>
        <polygon points="100,8 118,70 100,60" fill="#bcc8da"/>
        <polygon points="84,62 14,112 20,124 86,100" fill="#6f8fd6"/>
        <polygon points="116,62 186,112 180,124 114,100" fill="#5878c0"/>
        <polygon points="92,104 100,146 108,104" fill="#ff9a3d"/>
        <polygon points="96,40 104,40 108,64 92,64" fill="#2b3350"/>
      </svg>
      <img class="pilot" src="${pilot.img}" alt="">
      ${[0, 1, 2, 3].map((i) => {
        const s = picked[i];
        return `<div class="hard hp${i}${s ? ' set' : ''}" style="${s ? `--rar:${RARITY_COLOR[s.ext.rarity]}` : ''}">${s ? `<img src="${s.ext.img}" alt="">` : ''}</div>`;
      }).join('')}`;
    parts.innerHTML = run.slots.map((s) => {
      const on = run.fighter.includes(s.ext.id);
      return `<button class="part${on ? ' on' : ''}" data-id="${s.ext.id}" style="--rar:${RARITY_COLOR[s.ext.rarity]};--kind:${KIND_COLOR[s.ext.kind]}">
        <img src="${s.ext.img}" alt="">
        <span class="pn">${s.ext.seriesName}<small>Lv${s.lv}・${RARITY_NAME[s.ext.rarity]}</small></span>
        <span class="pk">${KIND_SKY[s.ext.kind]}</span>
      </button>`;
    }).join('') || '<p class="none">エクステンションなし（基本のレーザーだけで飛びます）</p>';
    const st = fighterStats(run);
    const row = (label: string, v: number, max: number) =>
      `<div class="spec"><span>${label}</span><div><i style="width:${Math.min(100, (v / max) * 100)}%"></i></div></div>`;
    specs.innerHTML =
      row('火力', 14 + st.laser + st.spread * 0.9, 110) +
      row('誘導', st.missile + st.pulse * 0.6, 80) +
      row('速度', 10 + st.engine, 70) +
      row('守り', 12 + st.armor + st.bits * 0.8, 80);
  };
  paint();
  parts.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.part');
    if (!b) return;
    const id = Number(b.dataset.id);
    const at = run.fighter.indexOf(id);
    if (at >= 0) {
      run.fighter.splice(at, 1);
      sfx('uiBack');
    } else if (run.fighter.length < 4) {
      run.fighter.push(id);
      sfx('ui');
    } else {
      sfx('hit');
    }
    paint();
  });
  el.querySelector('#g-auto')!.addEventListener('click', () => {
    run.fighter = autoFighter(run);
    sfx('ui');
    paint();
  });
  return new Promise((res) => {
    el.querySelector('#g-go')!.addEventListener('click', () => {
      sfx('go');
      close(el);
      res();
    });
  });
}

// ------------------------------------------------------------------ result
export type After = 'retry' | 'select';
export function resultScreen(run: Run): Promise<After> {
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
    <div class="result-box">
      <p class="fin">FINISH</p>
      ${record ? `<p class="record">${prev === null ? '初完走！' : '自己ベスト更新！'}</p>` : ''}
      <p class="total">${fmtTime(total)}</p>
      <p class="vs">${prev !== null ? `これまでのベスト ${fmtTime(prev)}（${fmtDelta(total - prev)}）` : '&nbsp;'}</p>
      <ul class="splits">${rows}</ul>
      <p class="meta">撃破 ${run.kills} ／ ダウン ${run.downs}（+${(run.downs * 8).toFixed(0)}秒） ／ チーム Lv${run.level}</p>
      <div class="gear">${run.slots.map((sl) => `<span style="--rar:${RARITY_COLOR[sl.ext.rarity]}" title="${sl.ext.name}（${KIND_LABEL[sl.ext.kind]}）"><img src="${sl.ext.img}" alt=""><b>Lv${sl.lv}</b></span>`).join('')}</div>
      <footer>
        <button class="btn ghost" id="r-select">走者を選びなおす</button>
        <button class="btn big" id="r-retry">同じ走順でもう一度</button>
      </footer>
    </div>
    <img class="result-chris" src="${record ? cat.chars.chrisGuts : cat.chars.chrisIdle}" alt="">`);
  return new Promise((res) => {
    el.querySelector('#r-retry')!.addEventListener('click', () => {
      sfx('go');
      close(el);
      res('retry');
    });
    el.querySelector('#r-select')!.addEventListener('click', () => {
      sfx('ui');
      close(el);
      res('select');
    });
  });
}

// ------------------------------------------------------------------ pause
export function pauseScreen(): Promise<'resume' | 'restart' | 'quit'> {
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
