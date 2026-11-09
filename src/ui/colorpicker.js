// The color picker, ported from BrandingOS's ColorPickerHSV (React → vanilla) and grown for maps:
// a saturation/brightness square + hue strip, hex field, eyedropper (pick a color straight off the
// map or a reference image), the colors already in this map, recent picks and the newsroom palette.
import { store } from '../store.js';
import { PALETTE } from '../presets.js';
import { h } from './controls.js';
import { clamp, rafThrottle } from '../util.js';
import { feedback } from '../vendor/folks/folks.js';

/* ---------- color math (same as BrandingOS) ---------- */

export function hexToRgb(hex) {
  let c = String(hex || '').replace('#', '').trim();
  if (/^[0-9a-f]{3}$/i.test(c)) c = c.split('').map((x) => x + x).join('');
  if (/^[0-9a-f]{8}$/i.test(c)) c = c.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(c)) return null;
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}
const rgbToHex = (r, g, b) => '#' + [r, g, b].map((n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')).join('');
function rgbToHsv(r, g, b) {
  const rf = r / 255, gf = g / 255, bf = b / 255;
  const max = Math.max(rf, gf, bf), min = Math.min(rf, gf, bf), d = max - min;
  let hh = 0;
  if (d) {
    if (max === rf) hh = ((gf - bf) / d) % 6;
    else if (max === gf) hh = (bf - rf) / d + 2;
    else hh = (rf - gf) / d + 4;
    hh *= 60; if (hh < 0) hh += 360;
  }
  return { h: hh, s: max ? d / max : 0, v: max };
}
function hsvToHex(hh, s, v) {
  const c = v * s, hp = hh / 60, x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0]; else if (hp < 2) [r, g, b] = [x, c, 0]; else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c]; else if (hp < 5) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  const m = v - c;
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}
export const normHex = (v) => { let s = String(v || '').trim(); if (!s.startsWith('#')) s = '#' + s; const rgb = hexToRgb(s); return rgb ? rgbToHex(...rgb) : null; };

/* ---------- recent & document colors ---------- */

const RKEY = 'ajmap.recentColors';
const readRecent = () => { try { return JSON.parse(localStorage.getItem(RKEY) || '[]').slice(0, 10); } catch { return []; } };
export function pushRecent(hex) {
  const n = normHex(hex);
  if (!n) return;
  try { localStorage.setItem(RKEY, JSON.stringify([n, ...readRecent().filter((c) => c !== n)].slice(0, 10))); } catch {}
}
const COLOR_KEYS = ['fill', 'color', 'stroke', 'bg', 'accent', 'hatchColor', 'border', 'nameColor', 'leaderColor', 'dotColor', 'titleColor', 'innerColor', 'casing'];
/** Colors already used on this map, most used first. */
export function docColors() {
  const n = new Map();
  for (const e of store.doc.elements) for (const k of COLOR_KEYS) {
    const c = normHex(e[k]);
    if (c) n.set(c, (n.get(c) || 0) + 1);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 10);
}

/* ---------- the picker ---------- */

/**
 * @param {object} o
 * @param {string} o.value      starting color (hex, '' or 'none')
 * @param {(hex:string)=>void} o.onInput   live, while dragging (no undo step)
 * @param {(hex:string)=>void} o.onCommit  final pick (one undo step)
 * @param {boolean} [o.none]    offer "no color"
 * @param {string} [o.title]
 */
export function colorPicker({ value, onInput, onCommit, none = false, title = 'اللون' }) {
  const start = normHex(value) || '#888888';
  const [r0, g0, b0] = hexToRgb(start);
  const st = rgbToHsv(r0, g0, b0);
  let cur = start;

  const svThumb = h('i', { class: 'cp-sv__thumb' });
  const sv = h('div', { class: 'cp-sv', role: 'slider', 'aria-label': 'التشبّع والسطوع', tabindex: 0 }, svThumb);
  const hueThumb = h('i', { class: 'cp-hue__thumb' });
  const hue = h('div', { class: 'cp-hue', role: 'slider', 'aria-label': 'درجة اللون', tabindex: 0 }, hueThumb);
  const prev = h('span', { class: 'cp-prev' });
  const hex = h('input', { class: 'cp-hex', value: start.toUpperCase(), spellcheck: 'false', dir: 'ltr', maxlength: 7, 'aria-label': 'كود اللون' });

  const live = rafThrottle((c) => onInput?.(c));
  const paint = (emit) => {
    cur = hsvToHex(st.h, st.s, st.v);
    sv.style.setProperty('--hue', `hsl(${st.h} 100% 50%)`);
    svThumb.style.left = st.s * 100 + '%'; svThumb.style.top = (1 - st.v) * 100 + '%';
    svThumb.style.background = cur;
    hueThumb.style.left = (st.h / 360) * 100 + '%';
    hueThumb.style.background = `hsl(${st.h} 100% 50%)`;
    prev.style.background = cur;
    if (document.activeElement !== hex) hex.value = cur.toUpperCase();
    if (emit) live(cur);
  };
  const commit = (c = cur) => { const n = normHex(c); if (!n) return; pushRecent(n); onCommit?.(n); };
  const setHex = (c, emit = true) => { const rgb = hexToRgb(c); if (!rgb) return false; Object.assign(st, rgbToHsv(...rgb)); paint(emit); return true; };

  const drag = (el, onMove) => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      const move = (ev) => { const r = el.getBoundingClientRect(); onMove(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1)); paint(true); };
      const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); commit(); };
      move(e);
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
  };
  // The square's x runs left→right whatever the page direction: like every design tool.
  drag(sv, (x, y) => { st.s = x; st.v = 1 - y; });
  drag(hue, (x) => { st.h = x * 360; });
  const keyNudge = (el, fn) => el.addEventListener('keydown', (e) => {
    const d = e.shiftKey ? 0.1 : 0.02;
    const k = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, d], ArrowDown: [0, -d] }[e.key];
    if (!k) return;
    e.preventDefault(); e.stopPropagation(); fn(...k); paint(true); commit();
  });
  keyNudge(sv, (dx, dy) => { st.s = clamp(st.s + dx, 0, 1); st.v = clamp(st.v + dy, 0, 1); });
  keyNudge(hue, (dx) => { st.h = (st.h + dx * 360 + 360) % 360; });

  hex.addEventListener('input', () => { const n = normHex(hex.value); hex.classList.toggle('is-bad', !n && hex.value.length >= 4); if (n && hex.value.replace('#', '').length >= 6) setHex(n); });
  hex.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { const n = normHex(hex.value); if (n) { setHex(n, false); commit(n); feedback('tick'); } else { hex.classList.add('is-bad'); hex.select(); } }
  });
  hex.addEventListener('blur', () => { const n = normHex(hex.value); if (n && n !== start) { setHex(n, false); commit(n); } else hex.value = cur.toUpperCase(); });

  const chip = (c, cls = '') => h('button', {
    type: 'button', class: 'cp-chip ' + cls + (c === normHex(value) ? ' is-on' : ''), style: { background: c }, title: c.toUpperCase(), 'aria-label': c,
    onclick: () => { setHex(c, false); commit(c); feedback('tick'); },
  });
  const row = (label, list, cls) => list.length ? h('div', { class: 'cp-row' }, h('span', { class: 'cp-row__t' }, label), h('div', { class: 'cp-chips ' + (cls || '') }, ...list.map((c) => chip(c)))) : null;

  const eye = 'EyeDropper' in window ? h('button', {
    type: 'button', class: 'cp-ib', title: 'قطّارة: خذ لونًا من الشاشة', 'aria-label': 'قطّارة',
    html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m14.5 5.5 4 4M4 20l1.5-4.5L15 6l3 3-9.5 9.5L4 20Z"/><path d="m13 4 7 7"/></svg>',
    onclick: async () => { try { const r = await new window.EyeDropper().open(); if (setHex(r.sRGBHex, false)) { commit(r.sRGBHex); feedback('tick'); } } catch {} },
  }) : null;
  const noneBtn = none ? h('button', { type: 'button', class: 'cp-none', title: 'بدون لون', onclick: () => { onCommit?.('none'); feedback('tick'); } }, 'بدون') : null;

  const root = h('div', { class: 'cp', dir: 'rtl' },
    h('div', { class: 'cp-head' }, h('b', {}, title), h('span', { class: 'cp-head__a' }, noneBtn, eye)),
    sv, hue,
    h('div', { class: 'cp-hexrow' }, prev, hex),
    row('في هذه الخريطة', docColors()),
    row('الأخيرة', readRecent()),
    row('لوحة الجزيرة', PALETTE, 'is-grid'),
  );
  paint(false);
  return root;
}
