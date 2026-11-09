// The edit bar: appears right next to whatever was picked, with what you'd change most —
// colors, sizes, styles — so editing doesn't mean a trip to the side panels.
import { store, makeElement, TYPE_NAMES } from '../store.js';
import { canvas } from '../editor/canvas.js';
import { real } from '../editor/realmap.js';
import { isReal } from '../render/compose.js';
import { LABEL_STYLES, MARKER_SHAPES } from '../presets.js';
import { REAL_DEFAULTS, palette as realPalette } from '../geo/realstyle.js';
import { LAYER_NAMES, elLabel } from '../editor/smart.js';
import { ICONS } from '../render/icons.js';
import { icon } from './icons.js';
import { h } from './controls.js';
import { removeWithUndo, duplicate, showPick } from '../editor/tools.js';
import { fitBounds } from '../geo/projection.js';
import * as D from '../geo/data.js';
import { geoBounds } from 'd3';
import { setOpen } from './panels.js';
import { clamp } from '../util.js';
import { feedback } from '../vendor/folks/folks.js';
import { colorPicker } from './colorpicker.js';
import { elBox, alignSel, distributeSel, duplicateSel, deleteSel, movable, shadeSel, pickedRegions, regionsOnly, countryBox } from '../editor/selection.js';
import { union } from '../editor/snap.js';
import { editText } from '../editor/textedit.js';

let bar, pop, muted = false;

export function initCtxbar() {
  bar = h('div', { class: 'cbar f-glass', role: 'toolbar', 'aria-label': 'تعديل سريع', hidden: true });
  canvas.stage.append(bar);
  bar.addEventListener('pointerdown', (e) => e.stopPropagation());
  // Holding Shift means "add to the selection": let clicks pass through the bar to the map.
  const shift = (e) => canvas.stage.classList.toggle('is-shift', e.shiftKey && e.key === 'Shift' ? e.type === 'keydown' : e.shiftKey);
  addEventListener('keydown', shift); addEventListener('keyup', shift); addEventListener('blur', () => canvas.stage.classList.remove('is-shift'));
  bar.addEventListener('wheel', (e) => e.stopPropagation());
  store.on((k) => {
    if (muted) return;
    if (k === 'sel' || k === 'load' || k === 'doc' || k === 'tool') build();
    else if (k === 'viewend' || k === 'zoom' || k === 'view' || k === 'el' || k === 'maploaded') place();
  });
}

/* ---------- writing to the document from the bar ---------- */

// Every change from the bar is one named undo step ("تراجع: تغيير اللون").
const KEY_LABELS = {
  fill: 'تغيير اللون', color: 'تغيير اللون', stroke: 'تغيير لون الحد', bg: 'تغيير لون الخلفية', accent: 'تغيير اللون المميّز', border: 'تغيير لون الإطار',
  opacity: 'تغيير الشفافية', bgOpacity: 'تغيير شفافية الخلفية', size: 'تغيير الحجم', labelSize: 'تغيير حجم الاسم', width: 'تغيير السُمك', strokeWidth: 'تغيير السُمك',
  text: 'تعديل النص', title: 'تعديل العنوان', body: 'تعديل النص', radius: 'تغيير نصف القطر', dash: 'تغيير نوع الخط', mode: 'تغيير شكل الخط', hatch: 'تخطيط',
  shape: 'تغيير الشكل', icon: 'تغيير الأيقونة', labelStyle: 'تغيير نمط الاسم', style: 'تغيير النمط', align: 'تغيير المحاذاة', showName: 'إظهار الاسم',
};
const upd = (fn, commit = true, kind, label = 'تعديل') => { muted = true; try { store.update(fn, { commit: commit !== false, kind: kind || (commit !== false ? 'doc' : 'el'), label }); } finally { muted = false; } place(); };
const setEl = (k, v, c = true) => upd(() => { const e = store.selected; if (e) e[k] = v; }, c, undefined, KEY_LABELS[k] || 'تعديل ' + (TYPE_NAMES[store.selected?.type] || ''));
const setStyle = (k, v, c = true) => upd((d) => { d.style[k] = v; }, c, c === false ? 'el' : 'doc', 'تعديل الخريطة');
const setReal = (k, v, c = true) => upd((d) => { d.real = { ...REAL_DEFAULTS, ...d.real, [k]: v }; }, c, 'doc', 'تعديل الخريطة');
const setRealColor = (key, v, c = true) => upd((d) => { d.real = { ...REAL_DEFAULTS, ...d.real, colors: { ...(d.real.colors || {}), [key]: v } }; }, c, 'doc', 'تغيير لون الخريطة');

/* ---------- little controls ---------- */

function closePop() { pop?.remove(); pop = null; removeEventListener('pointerdown', outside, true); }
function outside(e) { if (pop && !pop.contains(e.target) && !bar.contains(e.target)) closePop(); }
function openPop(anchor, content) {
  closePop();
  pop = h('div', { class: 'cb-pop f-glass' }, content);
  canvas.stage.append(pop);
  const st = canvas.stage.getBoundingClientRect(), r = anchor.getBoundingClientRect();
  let x = r.left - st.left + r.width / 2 - pop.offsetWidth / 2, y = r.bottom - st.top + 8;
  if (y + pop.offsetHeight > st.height - 10) y = r.top - st.top - pop.offsetHeight - 8;
  pop.style.transform = `translate(${clamp(x, 8, st.width - pop.offsetWidth - 8)}px, ${Math.max(8, y)}px)`;
  pop.addEventListener('pointerdown', (e) => e.stopPropagation());
  setTimeout(() => addEventListener('pointerdown', outside, true));
}

/** A color dot that opens the picker. onPick(hex, commit): commit=false while dragging in the picker. */
function sw(value, onPick, { title = 'اللون', none = false } = {}) {
  const isNone = (v) => !v || v === 'none';
  const dot = h('span', { class: 'cb-dot' + (isNone(value) ? ' is-none' : ''), style: { background: isNone(value) ? '' : value } });
  const b = h('button', { class: 'cb-btn cb-sw', type: 'button', title, 'aria-label': title }, dot);
  const show = (v) => { dot.style.background = isNone(v) ? '' : v; dot.classList.toggle('is-none', isNone(v)); };
  b.addEventListener('click', () => {
    if (pop) return closePop();
    openPop(b, colorPicker({
      value, none, title,
      onInput: (v) => { show(v); onPick(v, false); },
      onCommit: (v) => { show(v); value = v; onPick(v, true); if (v === 'none') closePop(); },
    }));
  });
  return b;
}

/** A number you drag sideways (or click to type). */
function scrub(label, value, onChange, { min = 0, max = 100, step = 1, fmt = (v) => v, title } = {}) {
  const dec = (String(step).split('.')[1] || '').length;
  const val = h('b', {}, fmt(value));
  const b = h('button', { class: 'cb-btn cb-scrub', type: 'button', title: title || 'اسحب يمينًا أو يسارًا، أو انقر لتكتب' }, h('span', {}, label), val);
  let cur = value;
  b.addEventListener('pointerdown', (e) => {
    const x0 = e.clientX, v0 = cur;
    let moved = false;
    b.setPointerCapture(e.pointerId);
    const mv = (ev) => {
      const dx = ev.clientX - x0;
      if (Math.abs(dx) > 3) moved = true;
      if (!moved) return;
      const nv = clamp(+(v0 + Math.round(dx / 4) * step).toFixed(dec), min, max);
      if (nv !== cur) { cur = nv; val.textContent = fmt(cur); onChange(cur, false); }
    };
    const up = () => {
      b.removeEventListener('pointermove', mv); b.removeEventListener('pointerup', up);
      if (moved) { onChange(cur, true); return; }
      const i = h('input', { class: 'cb-num', value: cur, inputmode: 'decimal', dir: 'ltr' });
      val.replaceWith(i); i.focus(); i.select();
      const done = () => { const v = parseFloat(i.value); if (!Number.isNaN(v)) { cur = clamp(v, min, max); onChange(cur, true); } i.replaceWith(val); val.textContent = fmt(cur); };
      i.addEventListener('blur', done, { once: true });
      i.addEventListener('keydown', (k) => { if (k.key === 'Enter') i.blur(); if (k.key === 'Escape') { i.value = cur; i.blur(); } k.stopPropagation(); });
    };
    b.addEventListener('pointermove', mv);
    b.addEventListener('pointerup', up);
  });
  return b;
}

const tog = (ic, label, on, onChange, title) => {
  const b = h('button', { class: 'cb-btn cb-tog', type: 'button', 'aria-pressed': String(!!on), title: title || label, html: (ic ? icon(ic) : '') + (label ? `<span>${label}</span>` : '') });
  b.addEventListener('click', () => { const v = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(v)); feedback('tick'); onChange(v); });
  return b;
};
const choice = (options, value, onChange) => {
  const g = h('div', { class: 'cb-choice', role: 'group' });
  for (const o of options) {
    const b = h('button', { type: 'button', class: 'cb-btn', 'aria-pressed': String(o.v === value), title: o.title || o.label, html: o.html || o.label });
    b.addEventListener('click', () => { g.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); feedback('tick'); onChange(o.v); });
    g.append(b);
  }
  return g;
};
const txt = (value, onChange, placeholder = '') => {
  const i = h('input', { class: 'cb-text', value: value ?? '', placeholder, dir: 'rtl', spellcheck: 'false' });
  let t;
  i.addEventListener('input', () => { clearTimeout(t); onChange(i.value, false); t = setTimeout(() => onChange(i.value, true), 600); });
  i.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') i.blur(); });
  return i;
};
const act = (ic, title, onClick, cls = '') => h('button', { class: 'cb-btn cb-act ' + cls, type: 'button', title, 'aria-label': title, html: icon(ic), onclick: onClick });
const btn = (ic, label, onClick) => h('button', { class: 'cb-btn cb-tog', type: 'button', html: (ic ? icon(ic) : '') + `<span>${label}</span>`, onclick: onClick });
const sep = () => h('span', { class: 'cb-sep' });
const head = (ic, text) => h('span', { class: 'cb-head', html: icon(ic) + `<span>${text}</span>` });
const DASH = [{ v: 'solid', label: 'متصل' }, { v: 'dashed', label: 'متقطع' }, { v: 'dotted', label: 'منقّط' }];

/* ---------- what the bar shows for each kind of pick ---------- */

function elementItems(el) {
  const common = [sep(), act('copy', 'تكرار (⌘D)', () => duplicate(el.id)), act('trash', 'حذف', () => removeWithUndo(el.id), 'is-danger'), act('more', 'كل الخصائص (اللوحة الجانبية)', flashInspector)];
  const pct = (k, label = 'شفافية') => scrub(label, Math.round((el[k] ?? 1) * 100), (v, c) => setEl(k, v / 100, c), { min: 0, max: 100, step: 5, fmt: (v) => v + '%' });
  const I = [head(el.type === 'region' ? 'region' : el.type, elLabel(el))];
  switch (el.type) {
    case 'region':
      I.push(sw(el.fill, (v, c) => setEl('fill', v, c), { title: 'لون التظليل' }), pct('opacity'), tog('area', 'تخطيط', el.hatch, (v) => setEl('hatch', v)), sw(el.stroke, (v, c) => setEl('stroke', v, c), { title: 'لون الحد', none: true }));
      if (el.kind === 'country') I.push(tog('region', 'المحافظات', el.inner, (v) => { setEl('inner', v); if (v) D.loadAdmin1(el.a3).catch(() => {}); }), btn('', 'اختر محافظة', () => { store.regionMode = 'admin1'; store.setTool('region'); showPick(el.a3, 'admin1'); store.emit('tool'); }));
      else I.push(tog('label', 'الاسم', el.showName, (v) => setEl('showName', v)));
      break;
    case 'area':
      I.push(sw(el.fill, (v, c) => setEl('fill', v, c), { title: 'لون التعبئة' }), pct('opacity'), tog('area', 'تخطيط', el.hatch, (v) => setEl('hatch', v)), sw(el.stroke, (v, c) => setEl('stroke', v === 'none' ? '' : v, c), { title: 'لون الحد', none: true }), choice(DASH.slice(0, 2), el.dash === 'solid' ? 'solid' : 'dashed', (v) => setEl('dash', v)), tog('', 'ناعم', el.smooth, (v) => setEl('smooth', v)));
      break;
    case 'circle':
      I.push(sw(el.fill, (v, c) => setEl('fill', v, c), { title: 'لون التعبئة' }), pct('opacity'), scrub('كم', el.radius, (v, c) => setEl('radius', v, c), { min: 0.1, max: 5000, step: el.radius > 30 ? 5 : 0.5 }), sw(el.stroke, (v, c) => setEl('stroke', v === 'none' ? '' : v, c), { title: 'لون الحد', none: true }), choice(DASH.slice(0, 2), el.dash === 'solid' ? 'solid' : 'dashed', (v) => setEl('dash', v)));
      break;
    case 'line':
      I.push(sw(el.color, (v, c) => setEl('color', v, c), { title: 'لون الخط' }), scrub('سُمك', el.width, (v, c) => setEl('width', v, c), { min: 0.5, max: 60, step: 0.5 }), choice(DASH, el.dash, (v) => setEl('dash', v)), choice([{ v: 'straight', label: 'مستقيم' }, { v: 'smooth', label: 'منحنٍ' }, { v: 'arc', label: 'قوس' }], el.mode === 'geo' ? 'straight' : el.mode, (v) => setEl('mode', v)), tog('', 'سهم', el.arrow !== 'none', (v) => setEl('arrow', v ? 'end' : 'none')), tog('', 'المسافة', el.dist, (v) => setEl('dist', v)));
      break;
    case 'marker': {
      const shapeBtn = h('button', { class: 'cb-btn cb-tog', type: 'button', html: `<span>الشكل</span>` });
      shapeBtn.addEventListener('click', () => openPop(shapeBtn, h('div', { class: 'cb-grid' },
        ...MARKER_SHAPES.filter((m) => m.id !== 'image').map((m) => h('button', { type: 'button', class: 'cb-btn' + (el.shape === m.id ? ' is-on' : ''), onclick: () => { setEl('shape', m.id); closePop(); } }, m.name)),
        ...(el.shape === 'icon' ? Object.entries(ICONS).map(([k, ic]) => h('button', { type: 'button', class: 'cb-btn cb-ic' + (el.icon === k ? ' is-on' : ''), title: ic.name, html: `<svg viewBox="0 0 24 24"><path d="${ic.d}" ${ic.rule ? `fill-rule="${ic.rule}"` : ''} fill="currentColor"/></svg>`, onclick: () => { setEl('icon', k); closePop(); } })) : []))));
      I.push(sw(el.color, (v, c) => { setEl('color', v, c); store.lastMarkerColor = v; }, { title: 'لون العلامة' }), scrub('حجم', el.size, (v, c) => setEl('size', v, c), { min: 4, max: 300 }), shapeBtn, txt(el.text, (v, c) => setEl('text', v, c), 'اكتب اسم المكان'), labelStyles(el.labelStyle, (v) => setEl('labelStyle', v)));
      break;
    }
    case 'label':
      I.push(act('type', 'اكتب في مكانه (Enter أو نقر مزدوج)', () => editText(el.id)), txt(el.text, (v, c) => setEl('text', v, c), 'النص'), labelStyles(el.style, (v) => upd(() => { const e = store.selected; e.style = v; e.color = ''; e.bg = ''; })), scrub('حجم', el.size, (v, c) => setEl('size', v, c), { min: 8, max: 300 }), tog('', 'خط ربط', el.leaderOn, (v) => upd(() => { const e = store.selected; e.leaderOn = v; if (v && !e.to) { const p = canvas.ctx.proj(e.at); e.to = (p && canvas.ctx.proj.invert([p[0], p[1] + 140])) || e.at; } })));
      break;
    case 'textbox': {
      const edit = btn('textbox', 'النص', () => openPop(edit, h('div', { class: 'cb-textpop' },
        h('label', {}, 'العنوان'), txtArea(el.title, (v, c) => setEl('title', v, c), 2),
        h('label', {}, 'النص'), txtArea(el.body, (v, c) => setEl('body', v, c), 5),
        h('small', {}, '**كلمة** للعريض · ==كلمة== للون المميّز'))));
      I.push(edit, sw(el.bg, (v, c) => setEl('bg', v, c), { title: 'لون الخلفية' }), pct('bgOpacity', 'خلفية'), sw(el.color, (v, c) => setEl('color', v, c), { title: 'لون النص' }), sw(el.accent, (v, c) => setEl('accent', v, c), { title: 'اللون المميّز' }), scrub('العنوان', el.titleSize, (v, c) => setEl('titleSize', v, c), { min: 10, max: 200 }), scrub('النص', el.bodySize, (v, c) => setEl('bodySize', v, c), { min: 8, max: 120 }), choice([{ v: 'right', label: 'يمين' }, { v: 'center', label: 'وسط' }, { v: 'left', label: 'يسار' }], el.align, (v) => setEl('align', v)));
      break;
    }
    case 'legend':
      I.push(sw(el.bg, (v, c) => setEl('bg', v, c), { title: 'لون الخلفية' }), pct('bgOpacity', 'خلفية'), sw(el.color, (v, c) => setEl('color', v, c), { title: 'لون النص' }), scrub('حجم', el.size, (v, c) => setEl('size', v, c), { min: 8, max: 120 }));
      break;
    case 'image':
      I.push(pct('opacity'), scrub('عرض', el.w, (v, c) => upd(() => { const e = store.selected; const r = e.h / e.w; e.w = v; e.h = Math.round(v * r); }, c), { min: 16, max: 4000, step: 4 }));
      break;
    case 'callout':
      I.push(choice([{ v: 'satellite', label: 'قمر صناعي' }, { v: 'image', label: 'صورة' }], el.source, (v) => setEl('source', v)), scrub('تقريب', el.satZoom, (v, c) => setEl('satZoom', v, c), { min: 3, max: 19, step: 0.25 }), tog('', 'أبيض وأسود', el.gray, (v) => setEl('gray', v)), sw(el.border, (v, c) => setEl('border', v, c), { title: 'لون الإطار' }));
      break;
    case 'frame':
      I.push(sw(el.stroke, (v, c) => setEl('stroke', v, c), { title: 'لون الإطار' }), scrub('سُمك', el.strokeWidth, (v, c) => setEl('strokeWidth', v, c), { min: 0.5, max: 30, step: 0.5 }), choice(DASH, el.dash, (v) => setEl('dash', v)));
      break;
  }
  return [...I, ...common];
}

function txtArea(value, onChange, rows) {
  const t = h('textarea', { class: 'cb-area', rows, dir: 'rtl' });
  t.value = value ?? '';
  let tm;
  t.addEventListener('input', () => { clearTimeout(tm); onChange(t.value, false); tm = setTimeout(() => onChange(t.value, true), 600); });
  t.addEventListener('keydown', (e) => e.stopPropagation());
  return t;
}

function labelStyles(value, onPick) {
  const g = h('div', { class: 'cb-choice cb-lsty' });
  for (const k of ['dark', 'red', 'light', 'yellow', 'halo', 'plain']) {
    const S = LABEL_STYLES[k];
    const b = h('button', { type: 'button', class: 'cb-btn', title: S.name, 'aria-pressed': String(value === k), style: { background: S.bg || 'transparent', color: S.color } }, 'ن');
    b.addEventListener('click', () => { g.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); onPick(k); });
    g.append(b);
  }
  return g;
}

const QUICK = ['#6b6b6b', '#e8323c', '#f2c230', '#2f80ed', '#2e9e6b', '#111111'];

// The one color that "is" each kind of thing, so a group can be recolored in one go.
const MAIN_COLOR = { region: 'fill', area: 'fill', circle: 'fill', marker: 'color', line: 'color', frame: 'stroke', textbox: 'bg', legend: 'bg' };

function multiItems() {
  const els = store.selection, n = els.length;
  const colored = els.filter((e) => MAIN_COLOR[e.type]);
  const first = colored[0];
  const canMove = els.filter(movable).length;
  const I = [h('span', { class: 'cb-head', html: icon('selectAll') + `<span>${n} عناصر</span>` })];
  if (colored.length) {
    I.push(sw(first[MAIN_COLOR[first.type]], (v, c) => upd(() => { for (const e of colored) { e[MAIN_COLOR[e.type]] = v; if (e.type === 'marker') store.lastMarkerColor = v; } }, c, undefined, 'تغيير اللون'), { title: 'لون الكل' }));
  }
  if (canMove) {
    const a = (ic, title, how) => act(ic, title, () => alignSel(how));
    I.push(sep(), a('alignR', 'محاذاة لليمين', 'right'), a('alignHC', 'توسيط أفقي', 'hcenter'), a('alignL', 'محاذاة لليسار', 'left'), a('alignT', 'محاذاة للأعلى', 'top'), a('alignVC', 'توسيط رأسي', 'vcenter'), a('alignB', 'محاذاة للأسفل', 'bottom'));
    if (canMove >= 3) I.push(act('distH', 'مسافات أفقية متساوية', () => distributeSel('x')), act('distV', 'مسافات رأسية متساوية', () => distributeSel('y')));
  }
  I.push(sep(), act('copy', 'تكرار (⌘D)', () => duplicateSel(24)), act('trash', 'حذف الكل', () => deleteSel(), 'is-danger'));
  return I;
}

/** Several countries and provinces at once: shade them, then recolor and restyle them together. */
function regionGroupItems() {
  const els = pickedRegions(), geo = store.geoSel;
  const n = els.length + geo.length;
  const countries = geo.length + els.filter((e) => e.kind === 'country').length;
  const I = [head('region', `${n} ${countries === n ? 'دول' : countries ? 'مناطق' : 'محافظات'}`)];
  if (geo.length) {
    // Some aren't shaded yet: a color shades them all (and recolors the rest).
    I.push(
      h('span', { class: 'cb-note' }, 'لوّنها:'),
      ...QUICK.map((c) => h('button', { type: 'button', class: 'cb-btn cb-quick', title: 'تظليل الكل', style: { '--c': c }, onclick: () => shadeSel(c) })),
      sw(store.doc.style.highlight, (v, c) => { if (c !== false) shadeSel(v); }, { title: 'لون آخر' }),
    );
  } else {
    const f = els[0];
    const all = (k, v, c = true) => upd(() => { for (const e of pickedRegions()) e[k] = v; }, c, undefined, KEY_LABELS[k] || 'تعديل');
    I.push(
      sw(f.fill, (v, c) => all('fill', v, c), { title: 'لون التظليل' }),
      scrub('شفافية', Math.round((f.opacity ?? 1) * 100), (v, c) => all('opacity', v / 100, c), { min: 0, max: 100, step: 5, fmt: (v) => v + '%' }),
      tog('area', 'تخطيط', f.hatch, (v) => all('hatch', v)),
      sw(f.stroke, (v, c) => all('stroke', v, c), { title: 'لون الحد', none: true }),
      countries ? null : tog('label', 'الأسماء', f.showName, (v) => all('showName', v)),
    );
  }
  I.push(sep(), btn('zoomIn', 'قرّب', () => zoomToFeatures([...els.map((e) => D.regionFeature(e, store.doc.worldview, canvas.ctx?.lod)), ...geo.map((a3) => canvas.ctx?.countries?.byId.get(a3))])));
  if (els.length) I.push(act('trash', geo.length ? 'إزالة التظليل' : 'حذف الكل', () => deleteSel(), 'is-danger'));
  I.push(act('more', 'كل الخصائص (اللوحة الجانبية)', flashInspector));
  return I;
}

function countryItems(a3) {
  const f0 = canvas.ctx?.countries?.byId.get(a3);
  const name = (f0 && (store.doc.lang === 'en' ? f0.properties.name : f0.properties.ar)) || store.selInfo?.name || a3;
  const real = isReal(store.doc);
  const shade = (fill) => {
    const el = makeElement('region', { kind: 'country', a3, name, fill, opacity: real ? 0.6 : 1 });
    store.add(el);
    feedback('success');
  };
  const landColor = real ? (store.doc.real?.colors?.land || realPalette({ ...REAL_DEFAULTS, ...store.doc.real }).bg) : store.doc.style.land;
  return [
    head('region', name),
    h('span', { class: 'cb-note' }, 'لوّنها:'),
    ...QUICK.map((c) => h('button', { type: 'button', class: 'cb-btn cb-quick', title: 'تظليل', style: { '--c': c }, onclick: () => shade(c) })),
    sw(store.doc.style.highlight, (v, c) => { if (c !== false) shade(v); }, { title: 'لون آخر' }),
    sep(),
    btn('region', 'محافظاتها', () => { store.regionMode = 'admin1'; store.setTool('region'); showPick(a3, 'admin1'); store.emit('tool'); }),
    btn('zoomIn', 'قرّب', () => zoomTo(a3)),
    sep(),
    sw(landColor, (v, c) => (real ? setRealColor('land', v, c) : setStyle('land', v, c)), { title: 'لون كل اليابسة' }),
  ];
}

export function zoomTo(a3) { zoomToFeatures([canvas.ctx?.countries?.byId.get(a3)]); }

function zoomToFeatures(fs) {
  const features = fs.filter(Boolean);
  if (!features.length) return;
  const { w, h: H } = store.doc.artboard;
  const target = fitBounds(store.doc.view, geoBounds({ type: 'FeatureCollection', features }), w, H, 0.12);
  if (!(isReal(store.doc) && real.flyTo(target))) store.update((d) => { d.view = target; }, { kind: 'view' });
}

function layerItems(layer) {
  const d = store.doc, r = { ...REAL_DEFAULTS, ...d.real }, pal = realPalette(r);
  const I = [head('layers', LAYER_NAMES[layer] || layer)];
  if (isReal(d)) {
    const col = (key, fallback) => sw(r.colors?.[key] || fallback, (v, c) => setRealColor(key, v, c), { title: 'اللون' });
    if (layer === 'border') I.push(col('border', pal.border), scrub('سُمك', r.borderScale, (v, c) => setReal('borderScale', v, c), { min: 0.3, max: 4, step: 0.1, fmt: (v) => v.toFixed(1) + '×' }), choice([{ v: 'osm', label: 'OpenStreetMap' }, { v: 'ne', label: 'تحريرية' }], r.borders, (v) => setReal('borders', v)));
    if (layer === 'admin1') I.push(col('admin1', pal.admin1), tog('', 'إظهار', r.admin1, (v) => setReal('admin1', v)));
    if (layer === 'water') I.push(col('water', pal.water || '#9fcbf0'));
    if (layer === 'roads') I.push(col('roads', pal.road), tog('', 'الطرق', r.roads, (v) => setReal('roads', v)), tog('', 'أسماء الشوارع', r.roadLabels, (v) => setReal('roadLabels', v)));
    if (layer === 'park') I.push(col('park', pal.park || '#c6e6bd'), tog('', 'إظهار', r.landcover, (v) => setReal('landcover', v)));
    if (layer === 'land') I.push(col('land', pal.bg));
    if (layer === 'labels') {
      I.push(col('labels', pal.country), scrub('حجم', r.textScale, (v, c) => setReal('textScale', v, c), { min: 0.6, max: 2.2, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' }), tog('', 'إظهار', r.labels, (v) => setReal('labels', v)));
      const info = store.selInfo;
      if (info?.name && info.ll) I.push(sep(), btn('marker', 'ثبّت علامة هنا', () => { store.add(makeElement('marker', { at: info.ll, text: info.name, shape: 'dot', side: 'left' })); feedback('success'); }));
    }
  } else {
    if (layer === 'border') I.push(sw(d.style.border, (v, c) => setStyle('border', v, c), { title: 'لون الحدود' }), scrub('سُمك', d.style.borderWidth, (v, c) => setStyle('borderWidth', v, c), { min: 0, max: 8, step: 0.1 }));
    if (layer === 'water') I.push(sw(d.style.sea, (v, c) => upd((doc) => { doc.style.sea = v; doc.style.lake = v; }, c, c === false ? 'el' : 'doc', 'تغيير لون الماء'), { title: 'لون الماء' }));
    if (layer === 'river') I.push(sw(d.style.river, (v, c) => setStyle('river', v, c), { title: 'لون الأنهار' }), tog('', 'إظهار', d.style.rivers, (v) => setStyle('rivers', v)));
    if (layer === 'admin1') I.push(sw(d.style.admin1, (v, c) => setStyle('admin1', v, c), { title: 'لون حدود المحافظات' }), tog('', 'إظهار', d.style.admin1All, (v) => setStyle('admin1All', v)));
  }
  return I;
}

function baseLabelItems(key) {
  const o = store.doc.labels[key] || {};
  const node = canvas.svg.querySelector(`[data-label="${CSS.escape(key)}"] text`);
  const setL = (k, v, c = true) => upd((d) => { d.labels[key] = { ...(d.labels[key] || {}), [k]: v }; }, c, undefined, KEY_LABELS[k] || 'تعديل اسم');
  return [
    head('label', 'اسم على الخريطة'),
    txt(o.text ?? node?.textContent ?? '', (v, c) => setL('text', v, c)),
    scrub('حجم', o.size || +(node?.getAttribute('font-size') || 24), (v, c) => setL('size', v, c), { min: 6, max: 200 }),
    sw(o.color || node?.getAttribute('fill') || '#888888', (v, c) => setL('color', v, c), { title: 'اللون' }),
    sep(),
    act('eyeOff', 'إخفاء', () => { setL('hidden', true); store.select(null); }),
    act('undo', 'إعادة ضبط', () => upd((d) => { delete d.labels[key]; })),
  ];
}

function flashInspector() {
  setOpen('inspector', true); // "more" means the full panel, even if it was folded away
  const ins = document.querySelector('#inspector');
  ins.scrollTop = 0;
  ins.closest('.panel').animate([{ boxShadow: '0 0 0 3px var(--f-ink)' }, { boxShadow: '0 0 0 0 transparent' }], { duration: 900, easing: 'ease-out' });
}

/* ---------- build & place ---------- */

function build() {
  if (!bar) return;
  closePop();
  const sel = store.sel;
  let items = null;
  // Drawing tools: the bar stays out of the way — except for the provinces being picked.
  if (!sel || !(store.tool === 'select' || (store.tool === 'region' && regionsOnly()))) items = null;
  else if (sel === 'geo:' || (store.multi && regionsOnly())) items = regionGroupItems();
  else if (sel.startsWith('country:')) items = countryItems(sel.slice(8));
  else if (sel.startsWith('layer:')) items = layerItems(sel.slice(6));
  else if (sel.startsWith('label:')) items = baseLabelItems(sel.slice(6));
  else if (store.multi) items = multiItems();
  else if (store.selected) items = elementItems(store.selected);
  if (!items) { bar.hidden = true; return; }
  bar.replaceChildren(...items.filter(Boolean));
  bar.hidden = false;
  place();
}

function place() {
  if (!bar || bar.hidden) return;
  const st = canvas.stage.getBoundingClientRect(), sv = canvas.svg.getBoundingClientRect(), z = store.zoom;
  const sel = store.sel;
  let ax = null, top = null, bottom = null;
  const node = !sel ? null : sel.startsWith('label:') ? canvas.svg.querySelector(`[data-label="${CSS.escape(sel.slice(6))}"]`) : sel.includes(':') ? null : canvas.svg.querySelector(`[data-el="${sel}"]`);
  let bb = null;
  const group = store.multi || sel === 'geo:';
  if (group) bb = union([...store.selection.map((e) => elBox(e, 'all')), ...store.geoSel.map(countryBox)].filter(Boolean));
  else try { bb = node?.getBBox(); } catch {}
  const has = bb && bb.width + bb.height > 0;
  // Boxes (text, legend, image, lens) and groups: the bar goes above or below the whole box, never over it.
  const boxy = group || ['textbox', 'legend', 'image', 'callout'].includes(store.selected?.type);
  if (has && (boxy || (bb.width * z < 440 && bb.height * z < 320))) {
    ax = sv.left + (bb.x + bb.width / 2) * z; top = sv.top + bb.y * z; bottom = sv.top + (bb.y + bb.height) * z;
  } else if (store.selPoint && canvas.ctx) {
    const p = canvas.ctx.proj(store.selPoint);
    if (p) { ax = sv.left + p[0] * z; top = bottom = sv.top + p[1] * z; }
  }
  if (ax == null && store.selected?.type === 'region' && canvas.ctx) {
    const f = D.regionFeature(store.selected, store.doc.worldview, canvas.ctx.lod);
    const c = f && canvas.ctx.path.centroid(f);
    if (c && !Number.isNaN(c[0])) { ax = sv.left + c[0] * z; top = bottom = sv.top + c[1] * z; }
  }
  if (ax == null && has) { ax = sv.left + (bb.x + bb.width / 2) * z; top = sv.top + bb.y * z; bottom = top + bb.height * z; }
  if (ax == null) { ax = st.left + st.width / 2; top = bottom = st.top + 70; }
  const bw = bar.offsetWidth, bh = bar.offsetHeight;
  // A label has its rotate knob above it: keep the bar clear of it.
  const knob = !store.multi && store.selected?.type === 'label' && !store.selected.locked ? 34 : 0;
  // Keep clear of the tool dock at the bottom (taller while picking provinces).
  const dock = [...document.querySelectorAll('#dock > *')].map((n) => n.getBoundingClientRect()).filter((r) => r.height > 0).reduce((m, r) => Math.min(m, r.top), Infinity);
  const maxY = Math.max(10, Math.min(st.height - bh - 104, dock - st.top - bh - 10));
  let y = top - st.top - bh - 16 - knob;
  if (y < 10) { y = bottom - st.top + 16; if (y > maxY) y = 10; } // taller than the screen (several countries): the bar waits at the top
  const x = clamp(ax - st.left - bw / 2, 10, Math.max(10, st.width - bw - 10));
  y = clamp(y, 10, maxY);
  bar.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}
