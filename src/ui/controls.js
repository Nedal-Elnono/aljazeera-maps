// Inspector building blocks on top of folks: fields, color, scrubbable numbers, segmented, toggles.
import { feedback } from '../vendor/folks/folks.js';
import { clamp } from '../util.js';
import { store } from '../store.js';
import { colorPicker } from './colorpicker.js';
import { icon } from './icons.js';

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') for (const [p, val] of Object.entries(v)) { if (p.startsWith('--')) el.style.setProperty(p, val); else el.style[p] = val; }
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
}

/* ---------- sections that fold ---------- */

// Folded sections, by panel kind and title ("map-real:الألوان"), remembered between sessions:
// fold "Effects" once and it stays folded for every map, without touching a marker's "Shape".
const FOLD_KEY = 'aj.folded';
let folded;
try { folded = new Set(JSON.parse(localStorage.getItem(FOLD_KEY) || '[]')); } catch { folded = new Set(); }
const saveFolded = () => { try { localStorage.setItem(FOLD_KEY, JSON.stringify([...folded])); } catch {} };
let scope = '';
/** Which panel the next sections belong to (the inspector sets it before building one). */
export const sectionScope = (s) => { scope = s; };
let secId = 0;

/** A titled section folds and unfolds from its title (⌥-click: every section in the panel). */
export function section(title, ...kids) {
  if (!title) return h('section', { class: 'ins-sec' }, ...kids);
  const key = scope + ':' + title;
  const closed = folded.has(key);
  const id = 'ins-sec-' + ++secId;
  const head = h('button', {
    class: 'f-label ins-sec__hd', type: 'button', 'aria-expanded': String(!closed), 'aria-controls': id, title: 'انقر للطيّ أو الفتح · ⌥ + نقر: كل الأقسام',
  }, h('span', {}, title), h('span', { class: 'ins-sec__chev', html: icon('chevDown') }));
  const sec = h('section', { class: 'ins-sec is-fold' + (closed ? ' is-closed' : ''), 'data-key': key },
    head, h('div', { class: 'ins-sec__bd', id, role: 'region', 'aria-label': title }, h('div', { class: 'ins-sec__in' }, ...kids)));
  if (closed) sec.querySelector('.ins-sec__bd').inert = true;
  head.addEventListener('click', (e) => {
    const close = !sec.classList.contains('is-closed');
    const all = e.altKey ? [...sec.parentElement.querySelectorAll(':scope > .ins-sec.is-fold')] : [sec];
    for (const s of all) fold(s, close);
    saveFolded();
    feedback('tick');
  });
  return sec;
}

function fold(sec, close) {
  if (sec.classList.contains('is-closed') === close) return;
  const bd = sec.querySelector('.ins-sec__bd');
  sec.classList.add('is-anim'); // clips the content only while it slides
  sec.classList.toggle('is-closed', close);
  sec.querySelector('.ins-sec__hd').setAttribute('aria-expanded', String(!close));
  bd.inert = close;
  clearTimeout(sec._t);
  sec._t = setTimeout(() => sec.classList.remove('is-anim'), 360);
  if (close) folded.add(sec.dataset.key); else folded.delete(sec.dataset.key);
}

export const field = (label, control, { hint, wide } = {}) =>
  h('div', { class: 'ins-row' + (wide ? ' is-wide' : '') }, h('label', { class: 'ins-lbl' }, label), h('div', { class: 'ins-ctl' }, control), hint ? h('div', { class: 'f-hint' }, hint) : null);
export const grid2 = (...kids) => h('div', { class: 'ins-grid2' }, ...kids);

/* ---------- color ---------- */

let pop;
function closePop() { pop?.remove(); pop = null; removeEventListener('pointerdown', outside, true); }
function outside(e) { if (pop && !pop.contains(e.target) && !e.target.closest('.clr')) closePop(); }

export function color(value, onChange, { none = false, title = 'اللون' } = {}) {
  const isNone = !value || value === 'none';
  const sw = h('span', { class: 'clr__sw' + (isNone ? ' is-none' : ''), style: { background: isNone ? '' : value } });
  const hex = h('input', { class: 'clr__hex f-mono', value: isNone ? '—' : value.toUpperCase(), spellcheck: 'false', dir: 'ltr', maxlength: 9 });
  let session = 0;
  const set = (v, quiet) => {
    const n = !v || v === 'none';
    sw.classList.toggle('is-none', n);
    sw.style.background = n ? '' : v;
    hex.value = n ? '—' : v.toUpperCase();
    if (!quiet) onChange(n ? (none ? 'none' : '') : v);
  };
  // One picker session = one undo step, however long you drag.
  const inSession = (fn) => { store.mergeKey = 'clr' + session; try { fn(); } finally { store.mergeKey = null; } };
  hex.addEventListener('change', () => {
    let v = hex.value.trim();
    if (v === '' || v === '—') return set('none');
    if (!v.startsWith('#')) v = '#' + v;
    if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) set(v);
    else hex.value = isNone ? '—' : value;
  });
  const btn = h('button', { class: 'clr__btn', type: 'button', 'aria-label': 'اختر لونًا' }, sw);
  btn.addEventListener('click', () => {
    if (pop) return closePop();
    session = Math.random();
    pop = h('div', { class: 'clr-pop' }, colorPicker({
      value: hex.value === '—' ? '' : hex.value, none, title,
      onInput: (v) => inSession(() => set(v)),
      onCommit: (v) => { inSession(() => set(v)); if (v === 'none') closePop(); },
    }));
    document.body.append(pop);
    const r = btn.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    pop.style.left = clamp(r.left + r.width - pw, 8, innerWidth - pw - 8) + 'px';
    pop.style.top = clamp(r.bottom + 8, 8, innerHeight - ph - 8) + 'px';
    addEventListener('pointerdown', outside, true);
  });
  return h('div', { class: 'clr' }, btn, hex);
}

export function number(value, onChange, { min = -1e9, max = 1e9, step = 1, unit = '', label } = {}) {
  const dec = String(step).includes('.') ? String(step).split('.')[1].length : 0;
  const fmt = (v) => (+v).toFixed(dec);
  const input = h('input', { class: 'num__in f-mono', value: fmt(value), inputmode: 'decimal', dir: 'ltr' });
  let cur = +value;
  const set = (v, commit = true) => {
    cur = clamp(+(+v).toFixed(dec), min, max);
    input.value = fmt(cur);
    onChange(cur, commit);
  };
  input.addEventListener('change', () => { const v = parseFloat(input.value.replace(/[^\d.-]/g, '')); if (!Number.isNaN(v)) set(v); else input.value = fmt(cur); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); set(cur + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)); }
    if (e.key === 'Enter') input.blur();
  });
  const grip = h('span', { class: 'num__grip', title: 'اسحب لتغيير القيمة' }, label || '↔');
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const x0 = e.clientX, v0 = cur;
    document.body.classList.add('is-scrubbing');
    const move = (ev) => set(v0 + Math.round((ev.clientX - x0) / 3) * step * (ev.shiftKey ? 10 : 1), false);
    const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); document.body.classList.remove('is-scrubbing'); onChange(cur, true); };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });
  return h('div', { class: 'num' }, grip, input, unit ? h('span', { class: 'num__unit' }, unit) : null);
}

/* ---------- slider ---------- */

export function slider(value, onChange, { min = 0, max = 1, step = 0.01, fmt = (v) => Math.round(v * 100) + '%' } = {}) {
  const out = h('span', { class: 'sld__v f-mono' }, fmt(value));
  const r = h('input', { type: 'range', class: 'sld__in', min, max, step, value });
  const paint = () => r.style.setProperty('--p', ((r.value - min) / (max - min)) * 100 + '%');
  paint();
  r.addEventListener('input', () => { out.textContent = fmt(+r.value); paint(); onChange(+r.value, false); });
  r.addEventListener('change', () => onChange(+r.value, true));
  return h('div', { class: 'sld' }, r, out);
}

/* ---------- segmented (folks) ---------- */

export function seg(options, value, onChange, { small } = {}) {
  const i0 = Math.max(0, options.findIndex((o) => o.v === value));
  const el = h('div', { class: 'f-seg ins-seg' + (small ? ' is-small' : ''), role: 'tablist', style: { '--n': options.length, '--i': i0 } },
    h('span', { class: 'f-seg__thumb' }),
    ...options.map((o, i) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(i === i0), title: o.title || o.label, html: o.icon ? o.icon + (o.label && !o.iconOnly ? `<span>${o.label}</span>` : '') : null }, o.icon ? null : o.label)));
  const btns = [...el.querySelectorAll('button')];
  btns.forEach((b, i) => b.addEventListener('click', () => {
    el.style.setProperty('--i', i);
    btns.forEach((x, j) => x.setAttribute('aria-selected', String(i === j)));
    feedback('tick');
    onChange(options[i].v);
  }));
  return el;
}

/* ---------- toggle (folks) ---------- */

export function toggle(value, onChange) {
  const b = h('button', { class: 'f-toggle', type: 'button', role: 'switch', 'aria-checked': String(!!value) });
  b.addEventListener('click', () => { const on = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(on)); feedback('tick'); onChange(on); });
  return b;
}
export const toggleRow = (label, value, onChange, hint) =>
  h('label', { class: 'ins-trow' }, h('span', {}, label, hint ? h('small', {}, hint) : null), toggle(value, onChange));

/* ---------- text ---------- */

export function text(value, onChange, { multiline = false, placeholder = '', rows = 3, dir = 'auto', live = true } = {}) {
  const el = multiline
    ? h('textarea', { class: 'f-field ins-text', rows, placeholder, dir }, value ?? '')
    : h('input', { class: 'f-field ins-text', value: value ?? '', placeholder, dir });
  if (multiline) el.value = value ?? '';
  let t;
  el.addEventListener('input', () => { if (!live) return; clearTimeout(t); onChange(el.value, false); t = setTimeout(() => onChange(el.value, true), 500); });
  el.addEventListener('change', () => { clearTimeout(t); onChange(el.value, true); });
  return el;
}

export function select(options, value, onChange) {
  const s = h('select', { class: 'f-field ins-select' }, ...options.map((o) => h('option', { value: o.v, selected: o.v === value }, o.label)));
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

export const button = (label, onClick, { cls = 'f-btn--quiet', icon } = {}) =>
  h('button', { class: 'ins-btn ' + cls, type: 'button', onclick: onClick, html: (icon || '') + `<span>${label}</span>` });
