// The layers list: everything on the map, top-most first. Click to pick, drag to reorder.
import { store, TYPE_NAMES } from '../store.js';
import { h } from './controls.js';
import { icon } from './icons.js';
import { reorder, feedback } from '../vendor/folks/folks.js';

let root;
export function initLayers(el) {
  root = el;
  render();
  store.on((k) => { if (k === 'doc' || k === 'sel' || k === 'load') render(); });
}

const label = (el) => (el.name || el.text || (el.title || '').replace(/\*\*|==/g, '') || el.legend || TYPE_NAMES[el.type]).toString().split('\n')[0].slice(0, 40);
const swatch = (el) => el.fill || el.color || (el.type === 'textbox' ? el.bg : '') || '';

function render() {
  if (!root) return;
  const els = store.doc.elements;
  const list = h('div', { class: 'lyr__list', role: 'listbox' });
  [...els].reverse().forEach((el) => {
    const on = store.sels.includes(el.id);
    const row = h('div', {
      class: 'lyr__row' + (on ? ' is-on' : '') + (on && store.multi ? ' is-multi' : '') + (el.hidden ? ' is-hidden' : ''), role: 'option', 'aria-selected': String(on), 'data-id': el.id, tabindex: 0,
    },
    h('span', { class: 'lyr__ic', html: icon(el.type) }),
    swatch(el) ? h('i', { class: 'lyr__sw', style: { background: swatch(el) } }) : null,
    h('span', { class: 'lyr__name' }, label(el)),
    h('button', { class: 'lyr__btn', type: 'button', title: el.locked ? 'فك القفل' : 'قفل', html: icon(el.locked ? 'lock' : 'unlock'), 'data-act': 'lock' }),
    h('button', { class: 'lyr__btn', type: 'button', title: el.hidden ? 'إظهار' : 'إخفاء', html: icon(el.hidden ? 'eyeOff' : 'eye'), 'data-act': 'eye' }));
    if (el.locked) row.classList.add('is-locked');
    list.append(row);
  });

  list.addEventListener('click', (e) => {
    const row = e.target.closest('.lyr__row');
    if (!row) return;
    const el = store.el(row.dataset.id);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'eye') { store.update(() => { el.hidden = !el.hidden; }, { label: el.hidden ? 'إظهار' : 'إخفاء' }); feedback('tick'); return; }
    if (act === 'lock') { store.update(() => { el.locked = !el.locked; }, { label: el.locked ? 'فك القفل' : 'قفل' }); feedback('tick'); return; }
    store.selPoint = null; // the edit bar opens beside the element itself
    if (e.metaKey || e.ctrlKey) { store.toggleSel(el.id); return; }
    if (e.shiftKey && store.sel && store.el(store.sel)) {
      // Shift: everything between the last pick and this row.
      const ids = [...els].reverse().map((x) => x.id);
      const a = ids.indexOf(store.sel), b = ids.indexOf(el.id);
      store.selectMany(ids.slice(Math.min(a, b), Math.max(a, b) + 1), true);
      return;
    }
    store.select(el.id);
  });
  list.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.lyr__row');
    if (!row) return;
    const el = store.el(row.dataset.id);
    const name = row.querySelector('.lyr__name');
    const input = h('input', { class: 'lyr__edit', value: label(el) });
    name.replaceWith(input); input.focus(); input.select();
    const done = () => store.update(() => { el.name = input.value.trim(); });
    input.addEventListener('blur', done);
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') input.blur(); if (ev.key === 'Escape') render(); });
  });
  enableDrag(list);

  const head = h('div', { class: 'lyr__head' }, h('b', {}, 'الطبقات'), h('span', { class: 'f-tag f-num' }, String(els.length)));
  const base = h('button', { class: 'lyr__row lyr__base' + (!store.sel ? ' is-on' : ''), type: 'button', onclick: () => store.select(null) },
    h('span', { class: 'lyr__ic', html: icon('globe') }), h('span', { class: 'lyr__name' }, 'الخريطة الأساسية'), h('small', { class: 'lyr__meta' }, 'الشكل والألوان'));
  const empty = !els.length ? h('div', { class: 'lyr__empty' },
    h('div', { class: 'lyr__empty-art', html: emptyArt() }),
    h('b', {}, 'ابدأ بنقرة'),
    h('p', {}, 'اختر أداة التظليل ثم انقر على أي دولة، أو ابحث عن مكان بـ ⌘K.'),
  ) : null;
  root.replaceChildren(head, h('div', { class: 'lyr__scroll' }, empty, list), base);
}

function enableDrag(list) {
  let row = null, startY = 0, moved = false, ghostIdx = -1;
  list.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button,input')) return;
    row = e.target.closest('.lyr__row');
    if (!row) return;
    startY = e.clientY; moved = false;
    list.setPointerCapture(e.pointerId);
  });
  list.addEventListener('pointermove', (e) => {
    if (!row) return;
    const dy = e.clientY - startY;
    if (!moved && Math.abs(dy) < 5) return;
    moved = true;
    row.classList.add('is-drag');
    row.style.transform = `translateY(${dy}px)`;
    const rows = [...list.children];
    const mid = row.getBoundingClientRect().top + row.offsetHeight / 2;
    ghostIdx = rows.filter((r) => r !== row && r.getBoundingClientRect().top + r.offsetHeight / 2 < mid).length;
  });
  const end = () => {
    if (!row) return;
    const r = row; row = null;
    r.classList.remove('is-drag'); r.style.transform = '';
    if (!moved || ghostIdx < 0) return;
    const els = store.doc.elements;
    const id = r.dataset.id;
    const from = els.findIndex((x) => x.id === id);
    const to = els.length - 1 - ghostIdx; // list shows top-most first
    if (from === to) return;
    reorder(list, () => {});
    store.update((d) => { const [x] = d.elements.splice(from, 1); d.elements.splice(to, 0, x); }, { label: 'ترتيب الطبقات' });
    feedback('drop');
  };
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);
}

const emptyArt = () => `<svg viewBox="0 0 120 80" fill="none"><rect x="1" y="1" width="118" height="78" rx="10" stroke="currentColor" stroke-opacity=".18" stroke-dasharray="4 4"/><path d="M14 36c10-8 20-4 28-8s16-12 28-6 20 6 36 2v40H14z" fill="currentColor" fill-opacity=".08"/><path d="M52 30c6-4 14-3 17 3s-2 13-9 13-12-11-8-16z" fill="currentColor" fill-opacity=".55"/><circle cx="84" cy="26" r="4" fill="currentColor"/><circle cx="84" cy="26" r="9" fill="currentColor" fill-opacity=".18"/></svg>`;
