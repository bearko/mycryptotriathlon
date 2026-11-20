// The skill tree between races: drag to move, wheel / pinch / buttons to zoom, tap a node to read it,
// tap again (or press the button) to learn it. Nodes appear as the ones before them are learned.

import { sample, sfx, unlockAudio } from '../core/audio';
import { cat } from '../core/catalog';
import { ambient, burstAt, countUp, cover, isCovered, kick, replay, uncover } from './fx';
import {
  BRANCHES, buy, canBuy, costOf, FEATS, isOpen, levelOf, meta, NODE, SKILLS, type SkillNode,
} from '../game/meta';

const UNIT = 96;

export function treeScreen(layer: HTMLElement): Promise<'race' | 'team'> {
  const el = document.createElement('div');
  el.className = 'screen tree';
  el.innerHTML = `
    <div class="tree-stage" id="tr-stage">
      ${ambient('SKILL TREE ● 走って、負けて、強くなる')}
      <div class="tree-world" id="tr-world"></div>
      <div class="tree-wallet"><span class="ce"><img src="${cat.icons.ce}" alt="">CE <b id="tr-ce"></b></span><span class="medal">🏅 メダル <b id="tr-medal"></b></span></div>
      <div class="tree-zoom"><button class="ibtn" id="tr-in">＋</button><button class="ibtn" id="tr-out">－</button><button class="ibtn" id="tr-fit">⤢</button></div>
      <div class="tree-legend"><i class="new"></i>新しい要素 <i class="risk"></i>試練（難しくなるかわりに報酬）</div>
    </div>
    <aside class="tree-side">
      <h2 data-k="GROW">スキルツリー</h2>
      <div class="tree-detail" id="tr-detail"></div>
      <div class="tree-nav">
        <button class="btn ghost small" id="tr-feats">メダル一覧</button>
        <button class="btn ghost small" id="tr-team">走者を選びなおす</button>
        <button class="btn big" id="tr-race">レースへ！</button>
      </div>
    </aside>`;
  layer.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  if (isCovered()) window.setTimeout(uncover, 60);
  const stage = el.querySelector<HTMLElement>('#tr-stage')!;
  const world = el.querySelector<HTMLElement>('#tr-world')!;
  const detail = el.querySelector<HTMLElement>('#tr-detail')!;
  const ceEl = el.querySelector<HTMLElement>('#tr-ce')!;
  const medalEl = el.querySelector<HTMLElement>('#tr-medal')!;

  let zoom = Math.min(1, Math.max(0.55, window.innerHeight / 620));
  let ox = 0;
  let oy = 0;
  let shownCe = -1;
  let picked: SkillNode = SKILLS.find((n) => canBuy(n)) ?? NODE.get('root')!;

  /** Shown when open, or when it is the next step after something open (as a silhouette). */
  const visible = (n: SkillNode) => isOpen(n) || n.requires.some((r) => isOpen(NODE.get(r)!));

  const place = () => {
    world.style.transform = `translate(${stage.clientWidth / 2 + ox}px, ${stage.clientHeight / 2 + oy}px) scale(${zoom})`;
  };

  const paint = () => {
    const m = meta();
    const ce = Math.floor(m.ce);
    // the wallet rolls to its new figure when something is bought
    if (shownCe >= 0 && ce !== shownCe) {
      const from = shownCe;
      void countUp(ceEl, from - ce, 380, (n) => String(from - n));
      replay(ceEl.parentElement!, 'spend');
    } else ceEl.textContent = String(ce);
    shownCe = ce;
    medalEl.textContent = String(m.medal);
    let lines = '';
    let nodes = '';
    for (const n of SKILLS) {
      if (!visible(n)) continue;
      const lv = levelOf(n.id);
      const open = isOpen(n);
      const color = BRANCHES[n.branch].color;
      for (const r of n.requires) {
        const p = NODE.get(r)!;
        if (!visible(p)) continue;
        const lit = levelOf(r) > 0 && lv > 0;
        lines += `<line class="${lit ? 'lit' : ''}" style="--branch:${color}" x1="${p.x * UNIT}" y1="${p.y * UNIT}" x2="${n.x * UNIT}" y2="${n.y * UNIT}"/>`;
      }
      const cls = [
        'tnode', n.flavor ?? '', open ? '' : 'veiled', lv >= n.max ? 'max' : '', lv > 0 ? 'owned' : '',
        canBuy(n) ? 'can' : '', n === picked ? 'sel' : '',
      ].join(' ');
      nodes += `<button class="${cls}" data-id="${n.id}" style="--branch:${color};left:${n.x * UNIT}px;top:${n.y * UNIT}px">
        ${open ? `<img src="${n.icon}" alt="">` : '<span class="q">?</span>'}
        ${open && n.id !== 'root' ? `<b>${lv >= n.max ? 'MAX' : `${lv}/${n.max}`}</b>` : ''}
        ${open ? `<i style="width:${(lv / n.max) * 100}%"></i>` : ''}
      </button>`;
    }
    world.innerHTML = `<svg class="tree-lines" viewBox="-800 -800 1600 1600" width="1600" height="1600">${lines}</svg>${nodes}`;

    const n = picked;
    const lv = levelOf(n.id);
    const open = isOpen(n);
    const b = BRANCHES[n.branch];
    const cur = n.currency === 'medal' ? 'メダル' : 'CE';
    if (!open) {
      detail.innerHTML = `<p class="tb" style="color:${b.color}">${b.name}・${b.role}</p><h3>？？？</h3><p class="td">手前のパネルを習得すると、内容がわかります。</p>`;
    } else {
      const maxed = lv >= n.max;
      detail.innerHTML = `
        <p class="tb" style="color:${b.color}">${b.name}・${b.role}${n.flavor === 'new' ? '<em class="tag new">新要素</em>' : n.flavor === 'risk' ? '<em class="tag risk">試練</em>' : ''}</p>
        <h3><img src="${n.icon}" alt="">${n.name}</h3>
        <p class="td">${n.desc}</p>
        ${n.id === 'root' ? '' : `<p class="tl">Lv ${lv} / ${n.max}</p>
        <button class="btn ${canBuy(n) ? 'big' : ''}" id="tr-buy" ${canBuy(n) ? '' : 'disabled'}>${maxed ? '習得済み（MAX）' : `習得する ${costOf(n)} ${cur}`}</button>`}`;
      detail.querySelector('#tr-buy')?.addEventListener('click', learn);
    }
  };

  const learn = () => {
    if (!buy(picked)) {
      sfx('hit');
      return;
    }
    sfx('stamp');
    sfx('armed');
    sample('buff', 0.5);
    paint();
    const node = world.querySelector<HTMLElement>(`[data-id="${picked.id}"]`);
    node?.classList.add('bought');
    if (node) burstAt(node, 18, 120);
    kick(5);
  };

  // pan and zoom
  const pts = new Map<number, { x: number; y: number }>();
  let moved = 0;
  let pinch = 0;
  stage.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('.tree-zoom')) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = 0;
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  stage.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pts.size === 1) {
      ox += dx;
      oy += dy;
      moved += Math.abs(dx) + Math.abs(dy);
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0) zoom = Math.min(1.6, Math.max(0.35, zoom * (d / pinch)));
      pinch = d;
      moved += 10;
    }
    place();
  });
  const up = (e: PointerEvent) => {
    const had = pts.delete(e.pointerId);
    if (!had || moved > 8) return;
    const b = (e.target as HTMLElement).closest<HTMLElement>('.tnode');
    if (!b) return;
    unlockAudio();
    const n = NODE.get(b.dataset.id!)!;
    if (n === picked && canBuy(n)) learn();
    else {
      picked = n;
      sfx('ui');
      paint();
      replay(detail, 'swap');
    }
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', (e) => pts.delete(e.pointerId));
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom = Math.min(1.6, Math.max(0.35, zoom * (e.deltaY < 0 ? 1.12 : 0.89)));
    place();
  }, { passive: false });
  el.querySelector('#tr-in')!.addEventListener('click', () => { zoom = Math.min(1.6, zoom * 1.2); place(); });
  el.querySelector('#tr-out')!.addEventListener('click', () => { zoom = Math.max(0.35, zoom / 1.2); place(); });
  el.querySelector('#tr-fit')!.addEventListener('click', () => {
    const shown = SKILLS.filter(visible);
    const xs = shown.map((n) => n.x * UNIT);
    const ys = shown.map((n) => n.y * UNIT);
    const w = Math.max(...xs) - Math.min(...xs) + UNIT * 1.6;
    const h = Math.max(...ys) - Math.min(...ys) + UNIT * 1.6;
    zoom = Math.min(1.2, Math.max(0.35, Math.min(stage.clientWidth / w, stage.clientHeight / h)));
    ox = -((Math.max(...xs) + Math.min(...xs)) / 2) * zoom;
    oy = -((Math.max(...ys) + Math.min(...ys)) / 2) * zoom;
    place();
  });
  el.querySelector('#tr-feats')!.addEventListener('click', () => {
    sfx('ui');
    const got = new Set(meta().feats);
    const md = document.createElement('div');
    md.className = 'screen modal in';
    md.innerHTML = `<div class="panel feats"><h2>メダル</h2><p>はじめて達成すると、メダルを 1 枚もらえます。メダルは特別なパネルの習得に使います。</p>
      <ul>${FEATS.map((f) => `<li class="${got.has(f.id) ? 'got' : ''}"><b>${got.has(f.id) ? '🏅' : '・'} ${f.name}</b><span>${f.desc}</span></li>`).join('')}</ul>
      <button class="btn">とじる</button></div>`;
    md.querySelector('button')!.addEventListener('click', () => {
      sfx('uiBack');
      md.remove();
    });
    layer.appendChild(md);
  });

  paint();
  place();
  const onResize = () => place();
  window.addEventListener('resize', onResize);
  return new Promise((res) => {
    const done = (r: 'race' | 'team') => {
      window.removeEventListener('resize', onResize);
      el.classList.remove('in');
      el.classList.add('out');
      window.setTimeout(() => el.remove(), 220);
      res(r);
    };
    el.querySelector('#tr-race')!.addEventListener('click', async () => {
      unlockAudio();
      sfx('select');
      await cover();
      done('race');
    });
    el.querySelector('#tr-team')!.addEventListener('click', async () => {
      sfx('ui');
      await cover();
      done('team');
    });
  });
}
