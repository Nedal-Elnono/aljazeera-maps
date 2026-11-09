// The two side panels fold into slim rails (and back) to give the map the room — from the button
// at the top of each, the rail itself, ⌘\ for both, or the command palette. Remembered.
import { store } from '../store.js';
import { h } from './controls.js';
import { icon } from './icons.js';
import { isMac } from '../util.js';
import { feedback } from '../vendor/folks/folks.js';

const KEY = 'aj.panels';
const M = isMac ? '⌘' : 'Ctrl+';
// Layers sit on the right of the screen (the start side in Arabic), the properties on the left.
const PANELS = {
  layers: { name: 'الطبقات', cls: 'is-layers-closed', ic: 'sideR' },
  inspector: { name: 'الخصائص', cls: 'is-inspector-closed', ic: 'sideL' },
};

let closed = {};
try { closed = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(closed)); } catch {} };
const app = () => document.getElementById('app');

export const isOpen = (id) => !closed[id];

/**
 * How much wider the stage is right now than with both panels open (also mid-animation). With the
 * post frame off, the map keeps the scale it has with the panels open: folding one reveals more map.
 */
export function foldRoom() {
  const a = app();
  if (!a) return 0;
  const cs = getComputedStyle(a);
  let room = 0;
  for (const [id, v] of [['layers', '--rail-l'], ['inspector', '--rail-r']]) {
    const shell = document.getElementById('p-' + id);
    const open = parseFloat(cs.getPropertyValue(v));
    if (shell && open) room += Math.max(0, open - shell.getBoundingClientRect().width);
  }
  return room;
}

export function initPanels() {
  for (const [id, p] of Object.entries(PANELS)) {
    const shell = document.getElementById('p-' + id);
    p.body = shell.querySelector('.panel__body');
    p.fold = h('button', {
      class: 'f-ibtn panel__fold', type: 'button', html: icon(p.ic),
      title: `إخفاء ${p.name} (${M}\\ للوحتين)`, 'aria-label': 'إخفاء ' + p.name, 'aria-controls': p.body.id,
      onclick: () => setOpen(id, false, { focus: true }),
    });
    p.rail = h('button', {
      class: 'panel__rail', type: 'button', title: 'إظهار ' + p.name, 'aria-label': 'إظهار ' + p.name, 'aria-controls': p.body.id,
      onclick: () => setOpen(id, true, { focus: true }),
    },
    h('span', { class: 'panel__rail-ic', html: icon(p.ic) }),
    h('span', { class: 'panel__rail-t' }, p.name),
    id === 'layers' ? h('span', { class: 'f-tag f-num panel__rail-n' }) : null);
    shell.append(p.fold, p.rail);
    apply(id);
  }
  const count = () => { const n = PANELS.layers.rail.querySelector('.panel__rail-n'); n.textContent = String(store.doc.elements.length); n.hidden = !store.doc.elements.length; };
  count();
  store.on((k) => { if (k === 'doc' || k === 'load') count(); });
}

function apply(id) {
  const p = PANELS[id], open = !closed[id];
  app().classList.toggle(p.cls, !open);
  p.body.inert = !open;
  p.fold.inert = !open;
  p.rail.inert = open;
  p.fold.setAttribute('aria-expanded', String(open));
  p.rail.setAttribute('aria-expanded', String(open));
}

let t;
export function setOpen(id, open, { focus = false } = {}) {
  if (!PANELS[id] || !closed[id] === open) return;
  // The columns slide only for this (not when the window is resized).
  const a = app();
  a.classList.add('is-folding');
  clearTimeout(t);
  t = setTimeout(() => a.classList.remove('is-folding'), 420);
  closed[id] = !open;
  apply(id);
  save();
  feedback('tick');
  if (focus) (open ? PANELS[id].fold : PANELS[id].rail).focus({ preventScroll: true });
}
export const togglePanel = (id) => setOpen(id, !isOpen(id));

/** ⌘\: hide both for the whole map, or bring both back. */
export function togglePanels() {
  const show = !isOpen('layers') && !isOpen('inspector');
  for (const id of Object.keys(PANELS)) setOpen(id, show);
}
