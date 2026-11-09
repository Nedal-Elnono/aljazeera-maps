// The start screen: templates with live previews, the last session, a blank board.
import { store, newDoc } from '../store.js';
import { h } from './controls.js';
import { icon } from './icons.js';
import { TEMPLATES } from '../templates.js';
import { composeSVG } from '../render/compose.js';
import { canvas } from '../editor/canvas.js';
import { openProject } from './topbar.js';
import * as D from '../geo/data.js';
import { idb } from '../util.js';
import { feedback, stagger } from '../vendor/folks/folks.js';

let host = null;
const built = new Map();

export async function openTemplates({ first = false } = {}) {
  if (host) return;
  const grid = h('div', { class: 'tpl__grid' });
  const last = await idb.get('autosave');
  const close = () => { host?.classList.add('is-out'); setTimeout(() => { host?.remove(); host = null; }, 220); removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  const use = (doc) => { store.load(structuredClone(doc)); canvas.fit = true; canvas.fitToStage(); feedback('success'); close(); };

  const cards = [
    h('button', { class: 'tpl__card tpl__blank', type: 'button', onclick: () => use(newDoc()) },
      h('div', { class: 'tpl__thumb', html: `<div class="tpl__blank-in">${icon('plus', 'i i--xl')}</div>` }),
      h('div', { class: 'tpl__meta' }, h('b', {}, 'لوحة فارغة'), h('small', {}, 'خريطة حقيقية: مدن وشوارع تظهر مع التقريب'))),
  ];
  if (last?.elements?.length) {
    const c = h('button', { class: 'tpl__card', type: 'button', onclick: () => use(last) },
      h('div', { class: 'tpl__thumb' }),
      h('div', { class: 'tpl__meta' }, h('b', {}, 'أكمل آخر عمل'), h('small', {}, last.name || '')));
    thumb(c.firstChild, last);
    cards.push(c);
  }
  for (const t of TEMPLATES) {
    const c = h('button', { class: 'tpl__card', type: 'button' },
      h('div', { class: 'tpl__thumb' }, h('span', { class: 'f-skeleton tpl__sk' })),
      h('div', { class: 'tpl__meta' }, h('b', {}, t.name), h('small', {}, t.desc)));
    c.addEventListener('click', async () => use(await getBuilt(t)));
    cards.push(c);
    getBuilt(t).then((doc) => thumb(c.firstChild, doc)).catch(() => {});
  }
  grid.append(...cards);

  host = h('div', { class: 'tpl f' },
    h('div', { class: 'tpl__box', role: 'dialog', 'aria-label': 'القوالب' },
      h('div', { class: 'tpl__head' },
        h('div', {}, h('h2', {}, first ? 'ماذا سترسم اليوم؟' : 'القوالب'), h('p', {}, 'ابدأ من قالب مبني على خرائط القناة، ثم غيّر الدولة والنص والألوان.')),
        h('div', { class: 'tpl__acts' },
          h('button', { class: 'f-capsule', type: 'button', onclick: () => { close(); openProject(); } }, 'فتح ملف .ajmap'),
          h('button', { class: 'f-gbtn f-gbtn--icon', type: 'button', 'aria-label': 'إغلاق', html: icon('close'), onclick: close }))),
      grid));
  host.addEventListener('pointerdown', (e) => { if (e.target === host) close(); });
  addEventListener('keydown', esc);
  document.body.append(host);
  stagger(grid);
}

async function getBuilt(t) {
  if (!built.has(t.id)) built.set(t.id, t.build().then((d) => { if (!t.real) d.base = 'design'; d.artboard = { ...d.artboard, free: false }; return d; }));
  return structuredClone(await built.get(t.id));
}

async function thumb(el, doc) {
  await D.loadCountries(doc.worldview, 'lo').catch(() => {});
  // Let detailed data arrive for close-up templates before drawing.
  await new Promise((r) => setTimeout(r, 60));
  const svg = composeSVG(doc, { credits: false });
  el.innerHTML = svg.replace('<svg ', '<svg preserveAspectRatio="xMidYMid meet" class="tpl__svg" ').replace(/ width="\d+" height="\d+"/, '');
}
