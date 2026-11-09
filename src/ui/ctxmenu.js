// Right-click: what you can do with whatever is under the pointer — the selection (cut, copy,
// align, stack, lock, delete), a country (shade it, its provinces, zoom), or the empty map
// (paste, drop a marker or a label right there).
import { store, makeElement, isElId } from '../store.js';
import { canvas } from '../editor/canvas.js';
import { real } from '../editor/realmap.js';
import { isReal } from '../render/compose.js';
import { pickAt } from '../editor/smart.js';
import { h } from './controls.js';
import { icon } from './icons.js';
import { copySel, cutSel, pasteFrom, duplicateSel, deleteSel, selectAll, restackSel, alignSel, distributeSel, canPaste } from '../editor/selection.js';
import { editText } from '../editor/textedit.js';
import { showPick } from '../editor/tools.js';
import { zoomTo } from './ctxbar.js';
import { isMac, round } from '../util.js';
import { designSize } from '../presets.js';
import { feedback } from '../vendor/folks/folks.js';

const M = isMac ? '⌘' : 'Ctrl ';
const TEXT_TYPES = new Set(['label', 'marker', 'frame', 'textbox', 'legend', 'region']);
let menu = null;

export function closeMenu() {
  if (!menu) return;
  menu.remove(); menu = null;
  removeEventListener('pointerdown', outside, true);
  removeEventListener('keydown', onKey, true);
  removeEventListener('blur', closeMenu);
}
const outside = (e) => { if (menu && !menu.contains(e.target)) closeMenu(); };

function onKey(e) {
  if (!menu) return;
  const items = [...menu.querySelectorAll('button:not(:disabled)')];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); e.stopPropagation();
    const n = items.length, j = e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n;
    items[j]?.focus();
  }
}

const item = (ic, label, kbd, fn, { danger = false, disabled = false } = {}) => h('button', {
  type: 'button', role: 'menuitem', class: 'ctxm__it' + (danger ? ' is-danger' : ''), disabled,
  html: `${icon(ic || 'more')}<span class="ctxm__t">${label}</span>${kbd ? `<kbd class="ctxm__k">${kbd}</kbd>` : ''}`,
  onclick: () => { closeMenu(); fn(); },
});
const sep = () => h('div', { class: 'ctxm__sep', role: 'separator' });
const row = (label, btns) => h('div', { class: 'ctxm__row' }, h('span', { class: 'ctxm__rt' }, label), h('div', { class: 'ctxm__ib' }, ...btns));
const ib = (ic, title, fn) => h('button', { type: 'button', role: 'menuitem', class: 'ctxm__ibtn', title, 'aria-label': title, html: icon(ic), onclick: () => { closeMenu(); fn(); } });
const headLine = (text) => h('div', { class: 'ctxm__head' }, text);

function selectionItems() {
  const els = store.selection;
  const n = els.length;
  const one = n === 1 ? els[0] : null;
  const anyLocked = els.some((e) => e.locked), anyHidden = els.some((e) => e.hidden);
  const out = [];
  out.push(headLine(n > 1 ? `${n} عناصر محددة` : null));
  if (one && TEXT_TYPES.has(one.type)) out.push(item('type', 'تعديل النص', 'Enter', () => editText(one.id)), sep());
  out.push(
    item('cut', 'قص', M + 'X', () => cutSel()),
    item('copy', 'نسخ', M + 'C', () => copySel()),
    item('paste', 'لصق', M + 'V', () => pasteFrom(), { disabled: !canPaste() }),
    item('plus', 'تكرار', M + 'D', () => duplicateSel(24)),
    sep(),
    row(n > 1 ? 'محاذاة' : 'محاذاة مع الإطار', [
      ib('alignR', 'لليمين', () => alignSel('right')), ib('alignHC', 'للوسط أفقيًا', () => alignSel('hcenter')), ib('alignL', 'لليسار', () => alignSel('left')),
      ib('alignT', 'للأعلى', () => alignSel('top')), ib('alignVC', 'للوسط رأسيًا', () => alignSel('vcenter')), ib('alignB', 'للأسفل', () => alignSel('bottom')),
    ]),
  );
  if (n >= 3) out.push(row('توزيع', [ib('distH', 'مسافات أفقية متساوية', () => distributeSel('x')), ib('distV', 'مسافات رأسية متساوية', () => distributeSel('y'))]));
  out.push(
    sep(),
    item('front', 'إلى الأمام', M + ']', () => restackSel(1)),
    item('back', 'إلى الخلف', M + '[', () => restackSel(-1)),
    item('up', 'إلى المقدمة', '⇧' + M + ']', () => restackSel(1, true)),
    item('down', 'إلى الأسفل', '⇧' + M + '[', () => restackSel(-1, true)),
    sep(),
    item(anyLocked ? 'unlock' : 'lock', anyLocked ? 'فك القفل' : 'قفل', '', () => store.update(() => { for (const e of els) e.locked = !anyLocked; }, { label: anyLocked ? 'فك القفل' : 'قفل' })),
    item(anyHidden ? 'eye' : 'eyeOff', anyHidden ? 'إظهار' : 'إخفاء', '', () => store.update(() => { for (const e of els) e.hidden = !anyHidden; }, { label: anyHidden ? 'إظهار' : 'إخفاء' })),
    sep(),
    item('trash', 'حذف', '⌫', () => deleteSel(), { danger: true }),
  );
  return out;
}

function placeItems(ll) {
  const at = ll ? [round(ll[0], 5), round(ll[1], 5)] : null;
  const { w, h: H } = designSize(store.doc.artboard);
  return [
    item('paste', 'لصق', M + 'V', () => pasteFrom(), { disabled: !canPaste() }),
    item('selectAll', 'تحديد الكل', M + 'A', () => selectAll(), { disabled: !store.doc.elements.length }),
    sep(),
    item('marker', 'ضع علامة هنا', 'M', () => { if (at) { store.add(makeElement('marker', { at, color: store.lastMarkerColor || '#e8323c' })); feedback('success'); } }, { disabled: !at }),
    item('label', 'اكتب تسمية هنا', 'T', () => { if (!at) return; const el = store.add(makeElement('label', { at, size: Math.round(Math.min(w, H) / 34) })); requestAnimationFrame(() => editText(el.id, null, { selectAll: true })); }, { disabled: !at }),
  ];
}

function countryItems(p) {
  const shade = () => {
    store.add(makeElement('region', { kind: 'country', a3: p.a3, name: p.name, fill: store.doc.style.highlight, opacity: isReal(store.doc) ? 0.6 : 1 }), { label: 'تظليل ' + p.name });
    feedback('success');
  };
  return [
    headLine(p.name),
    item('region', 'ظلّل ' + p.name, '', shade),
    item('layers', 'محافظات ' + p.name, '', () => { store.regionMode = 'admin1'; store.setTool('region'); showPick(p.a3, 'admin1'); store.emit('tool'); }),
    item('zoomIn', 'قرّب إلى ' + p.name, '', () => zoomTo(p.a3)),
    sep(),
  ];
}

export function openMenu(e) {
  closeMenu();
  if (store.tool !== 'select') store.setTool('select');
  const pt = canvas.toArt(e);
  const ll = canvas.ctx?.proj.invert(pt) || null;
  let mp = null;
  if (isReal(store.doc) && real.map && e.target.closest?.('#mapgl')) {
    const c = real.map.getCanvas(), r = c.getBoundingClientRect();
    mp = { x: ((e.clientX - r.left) * c.clientWidth) / r.width, y: ((e.clientY - r.top) * c.clientHeight) / r.height };
  }
  const p = pickAt(e, mp, ll);

  let items;
  if (p?.kind === 'el') {
    if (!store.sels.includes(p.id)) store.select(p.id);
    items = selectionItems();
  } else if (p?.kind === 'label') {
    const key = 'label:' + p.key;
    store.select(key);
    items = [
      item('type', 'تعديل الاسم', 'Enter', () => editText(key)),
      item('eyeOff', 'إخفاء الاسم', '⌫', () => { store.update((d) => { d.labels[p.key] = { ...(d.labels[p.key] || {}), hidden: true }; }, { label: 'إخفاء اسم' }); store.select(null); }),
      item('undo', 'إعادة ضبط', '', () => store.update((d) => { delete d.labels[p.key]; }, { label: 'إعادة ضبط اسم' })),
      sep(), ...placeItems(ll),
    ];
  } else if (store.multi && !p) {
    items = selectionItems();
  } else if (p?.kind === 'country') {
    items = [...countryItems(p), ...placeItems(ll)];
  } else {
    if (isElId(store.sel) && !store.multi) store.select(null);
    items = placeItems(ll);
  }

  menu = h('div', { class: 'ctxm', role: 'menu', dir: 'rtl' }, ...items.filter(Boolean).filter((x) => !(x.classList?.contains('ctxm__head') && !x.textContent)));
  document.body.append(menu);
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = Math.min(e.clientX, innerWidth - mw - 8) + 'px';
  menu.style.top = Math.max(8, Math.min(e.clientY, innerHeight - mh - 8)) + 'px';
  menu.addEventListener('contextmenu', (ev) => ev.preventDefault());
  setTimeout(() => {
    addEventListener('pointerdown', outside, true);
    addEventListener('keydown', onKey, true);
    addEventListener('blur', closeMenu);
  });
  menu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
}
