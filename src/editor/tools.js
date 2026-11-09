// Pointer work on the artboard: pick, move, draw, place, resize, pan and zoom the map.
import { geoDistance, geoCircle, geoContains } from 'd3';
import { real } from './realmap.js';
import * as smart from './smart.js';
import { isReal } from '../render/compose.js';
import { store, makeElement, LAYOUT_TYPES } from '../store.js';
import { designSize } from '../presets.js';
import { canvas } from './canvas.js';
import * as D from '../geo/data.js';
import { kmPerPx } from '../geo/projection.js';
import { round, debounce, rafThrottle, pickFile, blobToDataURL, clamp, mod } from '../util.js';
import { toast } from '../vendor/folks/folks.js';
import { computeSnap, guidesSVG, union, intersects, contains } from './snap.js';
import { elBox, snapTargets, shiftEl, movable, nudgeSel, duplicateSel, deleteSel } from './selection.js';
import { editText } from './textedit.js';
import { openMenu } from '../ui/ctxmenu.js';
import * as nav from './navigate.js';

let drag = null;
export const keysState = { space: false };

const P = () => canvas.ctx.proj;
const inv = (pt) => { const r = P().invert(pt); return r ? [round(r[0], 5), round(r[1], 5)] : null; };

export function initTools() {
  const svg = canvas.svg;
  // The whole stage is the map: listen there, but let the real map handle its own gestures.
  const host = canvas.stage;
  const ours = (fn) => (e) => { if (e.target.closest?.('.mapzoom') || (isReal(store.doc) && e.target.closest?.('#mapgl'))) return; fn(e); };
  host.addEventListener('pointerdown', ours(onDown));
  // Shift + drag on the live map draws a selection box instead of moving the map.
  host.addEventListener('pointerdown', (e) => {
    if (store.tool !== 'select' || !e.shiftKey || e.button !== 0 || !isReal(store.doc) || !e.target.closest?.('#mapgl')) return;
    e.preventDefault(); e.stopPropagation();
    startMarquee(e, canvas.toArt(e));
  }, true);
  host.addEventListener('contextmenu', (e) => { if (e.target.closest?.('.cbar, .cb-pop, .tedit, .ctxm')) return; e.preventDefault(); openMenu(e); });
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
  addEventListener('pointercancel', onUp);
  host.addEventListener('dblclick', ours(onDbl));
  // Wheel, trackpad and pinch anywhere on the stage — on the map or on an element — move and zoom the map.
  host.addEventListener('wheel', nav.onWheel, { passive: false });
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) host.addEventListener(t, nav.onGesture, { passive: false });
  host.addEventListener('pointermove', ours(onHover));
  host.addEventListener('pointerleave', () => { smart.clearHover(); if (canvas.hover) { canvas.hover = null; canvas.drawUI(); } });
  store.on((k) => {
    if (k === 'tool') {
      svg.dataset.tool = store.tool; canvas.stage.dataset.tool = store.tool; canvas.hover = null; smart.clearHover(); canvas.ghost = ''; canvas.rubber = null; twoClick = null;
      if (store.tool !== 'region') clearPick();
      real.setInteractive({ dblZoom: !['line', 'area'].includes(store.tool) });
      canvas.drawUI();
    }
  });
  svg.dataset.tool = store.tool;
  canvas.stage.dataset.tool = store.tool;
  real.handlers = { click: onMapClick, dblclick: onMapDbl, move: onMapMove };
}

/* ---------- real map: clicks and moves arrive from the map itself ---------- */

let twoClick = null;
export const cancelTwoClick = () => { if (twoClick) { twoClick = null; canvas.ghost = ''; canvas.rubber = null; canvas.drawUI(); return true; } return false; };

function onMapClick(e) {
  const ev = e.originalEvent;
  const pt = canvas.toArt(ev);
  const ll = [e.lngLat.lng, e.lngLat.lat];
  const tool = store.tool;
  if (tool === 'select') return ev?.shiftKey ? undefined : smart.click(ev, e.point, ll);   // anything on the map: pick it (Shift: see shiftClick)
  if (tool === 'hand') { store.select(null); return; }
  if (tool === 'region') return regionAtPoint(ev, ll);
  if (['marker', 'label', 'textbox', 'legend', 'callout', 'image'].includes(tool)) return place(tool, pt, ev);
  if (tool === 'line' || tool === 'area') return draftClick(pt);
  if (tool === 'circle' || tool === 'frame') {
    if (!twoClick) { twoClick = { kind: tool, start: pt, cur: pt }; return; }
    const d = { ...twoClick, cur: pt };
    twoClick = null;
    finishShape(d, ev);
  }
}

/** Shift-click on the map, design or live: add the country / province under it to the selection. */
function shiftClick(e, target) {
  const ev = { target, shiftKey: true, clientX: e.clientX, clientY: e.clientY };
  const m = isReal(store.doc) ? real.map : null;
  if (!m) return smart.click(ev, null, canvas.ctx ? inv(canvas.toArt(e)) : null);
  const r = m.getContainer().getBoundingClientRect();
  const mp = { x: e.clientX - r.left, y: e.clientY - r.top };
  const L = m.unproject([mp.x, mp.y]);
  smart.click(ev, mp, [L.lng, L.lat]);
}

function onMapDbl(e) { if (store.draft) { e.preventDefault(); finishDraft(); } }

const hoverSoon = rafThrottle((ll) => {
  const f = countryAt(ll);
  const d = f ? canvas.ctx?.path(f) || null : null;
  if (d !== canvas.hover) { canvas.hover = d; canvas.drawUI(); }
});
function onMapMove(e) {
  const pt = canvas.toArt(e.originalEvent);
  if (store.draft && (store.tool === 'line' || store.tool === 'area')) { store.draft.cursor = inv(pt); drawUIsoon(); }
  if (twoClick) {
    twoClick.cur = pt;
    const [x0, y0] = twoClick.start;
    if (twoClick.kind === 'circle') canvas.ghost = `<circle class="draft" cx="${x0}" cy="${y0}" r="${Math.hypot(pt[0] - x0, pt[1] - y0)}" fill="#f2c230" fill-opacity=".35" stroke="#d9661f" stroke-width="${2 / store.zoom}"/>`;
    else canvas.rubber = [x0, y0, pt[0], pt[1]];
    drawUIsoon();
  }
  if (store.tool === 'region' && !store.pick) hoverSoon([e.lngLat.lng, e.lngLat.lat]);
  if (store.tool === 'select') smart.hover(e.originalEvent, e.point, [e.lngLat.lng, e.lngLat.lat]);
}

const inBounds = D.inGeoBox;
/** The country under a lon/lat point. */
export function countryAt(ll) {
  const C = canvas.ctx?.countries;
  if (!C) return null;
  for (const f of C.features) if (inBounds(f, ll) && geoContains(f, ll)) return f;
  return null;
}
/** The top-most shaded region under a lon/lat point. */
function regionAt(ll) {
  const els = store.doc.elements;
  for (let i = els.length - 1; i >= 0; i--) {
    const el = els[i];
    if (el.type !== 'region' || el.hidden) continue;
    const f = D.regionFeature(el, store.doc.worldview, canvas.ctx?.lod);
    if (f && inBounds(f, ll) && geoContains(f, ll)) return el;
  }
  return null;
}

/** Region tool: a plain click picks one; Shift adds to (or takes out of) the countries/provinces picked. */
function pickRegion(id, shift) {
  if (!shift) return store.select(id);
  const same = store.sels.filter((x) => store.el(x)?.type === 'region');
  store.selectMany(same.includes(id) ? same.filter((x) => x !== id) : [...same, id]);
}
function addRegion(el, e) {
  store.add(el, { select: false });
  pickRegion(el.id, e?.shiftKey);
  store.emit('placed');
}

function regionAtPoint(ev, ll) {
  const mode = store.regionMode || 'country';
  const f = countryAt(ll);
  if (!f) return;
  const cid = f.properties.id;
  if (mode !== 'country') { showPick(cid, mode); return; }
  const reg = store.doc.elements.find((x) => x.type === 'region' && x.kind === 'country' && x.a3 === cid);
  if (reg) { if (ev.altKey) removeWithUndo(reg.id); else pickRegion(reg.id, ev.shiftKey); return; }
  addCountry(cid, ev);
}

function addCountry(cid, ev) {
  const f = canvas.ctx.countries?.byId.get(cid);
  const name = f ? (store.doc.lang === 'en' ? f.properties.name : f.properties.ar) : cid;
  addRegion(makeElement('region', { kind: 'country', a3: cid, name, fill: store.doc.style.highlight, opacity: isReal(store.doc) ? 0.6 : 1 }), ev);
}

/* ---------- pointer down ---------- */

// With pointer capture, release / click / dblclick report the canvas: keep what was really pressed.
let lastDown = null, lastDownAt = 0;

function onDown(e) {
  if (e.button === 2) return;
  lastDown = e.target; lastDownAt = performance.now();
  const pt = canvas.toArt(e);
  const tool = store.tool;
  if (keysState.space || tool === 'hand' || e.button === 1) return startPan(e, false);

  if (tool === 'select') {
    const h = e.target.closest('[data-h]');
    if (h && store.selected) return startHandle(e, pt, h.dataset.h, +h.dataset.i);
    const g = e.target.closest('[data-el]');
    if (g) {
      const el = store.el(g.dataset.el);
      if (el) {
        store.selPoint = inv(pt);
        smart.clearHover();
        // Shift-click adds to (or takes out of) the selection.
        if (e.shiftKey) { store.toggleSel(el.id); return; }
        const inGroup = store.sels.includes(el.id) && store.multi;
        if (!inGroup) store.select(el.id);
        else if (store.sel !== el.id) { store.sel = el.id; store.emit('sel'); }
        if (el.locked || el.type === 'region') return isReal(store.doc) ? undefined : startPan(e, false);
        return startMoveSel(e, pt, el, e.target.closest('[data-part]')?.dataset.part, inGroup);
      }
    }
    const lab = e.target.closest('[data-label]');
    if (lab && !e.shiftKey) { store.selPoint = inv(pt); smart.clearHover(); store.select('label:' + lab.dataset.label); return startLabelDrag(e, pt, lab.dataset.label); }
    if (e.shiftKey) return startMarquee(e, pt);
    return startPan(e, true);
  }
  if (tool === 'region') return regionClick(e, pt);
  if (['marker', 'label', 'textbox', 'legend', 'callout', 'image'].includes(tool)) return place(tool, pt, e);
  if (tool === 'line' || tool === 'area') return draftClick(pt, e);
  if (tool === 'circle' || tool === 'frame') { drag = { kind: tool, start: pt, cur: pt }; capture(e); }
}

const capture = (e) => { try { canvas.svg.setPointerCapture(e.pointerId); } catch {} };

function startPan(e, deselect) {
  // Remember what was under the press: with pointer capture, the release reports the canvas instead.
  drag = { kind: 'pan', last: [e.clientX, e.clientY], moved: false, deselect, target: e.target };
  canvas.beginMove();
  canvas.stage.classList.add('is-panning');
  capture(e);
}

/**
 * Drag the selection. Everything selected moves together, snapping to the edges and centers of
 * everything else and of the post frame (hold ⌘ to place freely; hold Alt to drag out copies).
 */
function startMoveSel(e, pt, el, part, inGroup) {
  const group = store.multi ? store.selection.filter(movable) : [el];
  const part1 = store.multi ? undefined : part;
  const boxes = group.map((x) => elBox(x, part1)).filter(Boolean);
  drag = {
    kind: 'move', items: group.map((x) => ({ el: x, orig: structuredClone(x) })), part: part1, start: pt, moved: false,
    box0: union(boxes), others: null, alt: e.altKey, collapse: inGroup ? el.id : null,
  };
  capture(e);
}

function startMarquee(e, pt) {
  drag = { kind: 'marquee', start: pt, cur: pt, moved: false, add: e.shiftKey, base: [...store.sels], target: e.target };
  capture(e);
}

function startLabelDrag(e, pt, key) {
  const o = store.doc.labels[key] || {};
  drag = { kind: 'label', key, start: pt, orig: { dx: o.dx || 0, dy: o.dy || 0 }, moved: false };
  capture(e);
}

function startHandle(e, pt, h, i) {
  const el = store.selected;
  if (h === 'm') {
    // Grab a midpoint: it becomes a new vertex.
    const p = inv(pt);
    if (!p) return;
    store.update((d) => el.points.splice(i + 1, 0, p), { commit: false, kind: 'el' });
    h = 'v'; i = i + 1;
  }
  if (h === 'v' && e.altKey) {
    const min = el.type === 'area' ? 3 : 2;
    if (el.points.length > min) store.update(() => el.points.splice(i, 1), { kind: 'el' });
    return;
  }
  const c = el.at && canvas.ctx ? canvas.ctx.proj(el.at) : null;
  drag = { kind: 'handle', el, h, i, start: pt, orig: structuredClone(el), moved: false, center: c, shift: e.shiftKey };
  capture(e);
}

/* ---------- pointer move ---------- */

function onMove(e) {
  if (!drag) {
    if (store.draft && (store.tool === 'line' || store.tool === 'area')) {
      store.draft.cursor = inv(canvas.toArt(e));
      drawUIsoon();
    }
    return;
  }
  const pt = canvas.toArt(e);
  if (drag.kind === 'pan') {
    const dx = (e.clientX - drag.last[0]) / store.zoom, dy = (e.clientY - drag.last[1]) / store.zoom;
    if (Math.abs(dx) + Math.abs(dy) > 0) drag.moved = drag.moved || Math.hypot(e.clientX - drag.last[0], e.clientY - drag.last[1]) > 0.5;
    drag.last = [e.clientX, e.clientY];
    canvas.pan(dx, dy);
    return;
  }
  const dx = pt[0] - drag.start[0], dy = pt[1] - drag.start[1];
  if (!drag.moved && Math.hypot(dx, dy) * store.zoom < 3) return;
  drag.moved = true;

  if (drag.kind === 'move') {
    if (drag.alt) {
      // Alt-drag: leave the originals, carry copies.
      drag.alt = false;
      const ids = duplicateSel(0, { label: 'تكرار بالسحب' });
      drag.items = ids.map((id) => store.el(id)).filter(Boolean).map((x) => ({ el: x, orig: structuredClone(x) }));
      drag.collapse = null;
    }
    let mx = dx, my = dy;
    canvas.ghost = '';
    if (drag.box0 && !mod(e)) {
      drag.others ||= snapTargets(new Set(drag.items.map((i) => i.el.id)));
      const b = drag.box0;
      const sn = computeSnap({ x: b.x + dx, y: b.y + dy, width: b.width, height: b.height }, drag.others, 5 / store.zoom);
      mx += sn.dx; my += sn.dy;
      canvas.ghost = guidesSVG(sn.guides, store.zoom);
    }
    store.update(() => { for (const it of drag.items) shiftEl(it.el, it.orig, mx, my, drag.part); }, { commit: false, kind: 'el' });
  } else if (drag.kind === 'marquee') {
    drag.cur = pt;
    canvas.rubber = [drag.start[0], drag.start[1], pt[0], pt[1]];
    const r = { x: Math.min(drag.start[0], pt[0]), y: Math.min(drag.start[1], pt[1]), width: Math.abs(dx), height: Math.abs(dy) };
    // Things the box touches; a shaded country only when it's wholly inside.
    const hit = store.doc.elements.filter((el) => {
      if (el.hidden || el.locked) return false;
      const b = elBox(el, 'all');
      return b && (el.type === 'region' ? contains(r, b) : intersects(r, b));
    }).map((el) => el.id);
    const next = drag.add ? [...new Set([...drag.base, ...hit])] : hit;
    if (next.join() !== store.sels.join()) { store.sels = next; store.sel = store.geoSel.length ? 'geo:' : next[next.length - 1] || null; store.emit('sel'); }
    drawUIsoon();
  } else if (drag.kind === 'label') {
    store.update((d) => { d.labels[drag.key] = { ...(d.labels[drag.key] || {}), dx: drag.orig.dx + dx, dy: drag.orig.dy + dy }; }, { commit: false, kind: 'el' });
  } else if (drag.kind === 'handle') {
    drag.shift = e.shiftKey;
    store.update(() => applyHandle(drag, pt), { commit: false, kind: 'el' });
  } else if (drag.kind === 'circle' || drag.kind === 'frame') {
    drag.cur = pt;
    const [x0, y0] = drag.start;
    if (drag.kind === 'circle') {
      const r = Math.hypot(pt[0] - x0, pt[1] - y0);
      canvas.ghost = `<circle class="draft" cx="${x0}" cy="${y0}" r="${r}" fill="#f2c230" fill-opacity=".35" stroke="#d9661f" stroke-width="${2 / store.zoom}"/>`;
    } else {
      canvas.rubber = [x0, y0, pt[0], pt[1]];
    }
    drawUIsoon();
  }
}

const drawUIsoon = rafThrottle(() => canvas.drawUI());

/* ---------- pointer up ---------- */

function onUp(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  canvas.stage.classList.remove('is-panning');
  if (d.kind === 'pan') {
    if (d.moved) canvas.endMove();
    else { canvas.preview = null; if (d.deselect) smart.click({ target: d.target, clientX: e.clientX, clientY: e.clientY }, null, canvas.ctx ? inv(canvas.toArt(e)) : null); }
    return;
  }
  if (d.kind === 'move' || d.kind === 'label' || d.kind === 'handle') {
    canvas.ghost = '';
    if (d.moved) { store.commit(d.kind === 'handle' ? HANDLE_LABEL[d.h] || 'تعديل' : d.items?.length > 1 ? `تحريك ${d.items.length} عناصر` : 'تحريك'); store.emit('doc'); }
    else {
      // A plain click on one of several selected things picks just that one.
      if (d.collapse) store.select(d.collapse);
      canvas.drawUI();
    }
    return;
  }
  if (d.kind === 'marquee') {
    canvas.rubber = null;
    // Shift-click (no drag): add what's under it — a country, a province — to the selection. On the
    // live map too: the map never saw this press (Shift-drag is ours), so its own click can't be trusted.
    if (!d.moved && d.add) shiftClick(e, d.target);
    if (!d.moved && !d.add) store.select(null);
    canvas.drawUI();
    store.emit('sel');
    return;
  }
  finishShape(d, e);
}

function finishShape(d, e) {
  if (d.kind === 'circle') {
    canvas.ghost = '';
    const { w, h } = store.doc.artboard;
    const c = inv(d.start);
    if (!c) return;
    const px = Math.hypot(d.cur[0] - d.start[0], d.cur[1] - d.start[1]);
    const radius = px > 6 / store.zoom ? geoDistance(c, inv(d.cur) || c) * 6371 : kmPerPx(store.doc.view, w, h) * 70;
    finishPlace(makeElement('circle', { at: c, radius: round(radius, 2) }), e);
  }
  if (d.kind === 'frame') {
    canvas.rubber = null;
    const [x0, y0] = d.start, [x1, y1] = d.cur;
    if (Math.abs(x1 - x0) < 8 / store.zoom || Math.abs(y1 - y0) < 8 / store.zoom) { canvas.drawUI(); return; }
    const a = inv([Math.min(x0, x1), Math.min(y0, y1)]), b = inv([Math.max(x0, x1), Math.max(y0, y1)]);
    if (a && b) finishPlace(makeElement('frame', { a, b }), e);
  }
}

/* ---------- geometry edits ---------- */

const HANDLE_LABEL = { v: 'تعديل نقطة', r: 'تغيير نصف القطر', fa: 'تغيير الإطار', fb: 'تغيير الإطار', to: 'تحريك خط الربط', ca: 'تحريك مركز العدسة', cr: 'تغيير حجم العدسة', w: 'تغيير العرض', wh: 'تغيير الحجم', ls: 'تغيير حجم النص', rot: 'تدوير', ms: 'تغيير حجم العلامة' };

function applyHandle(d, pt) {
  const el = d.el, o = d.orig;
  switch (d.h) {
    case 'v': { const p = inv(pt); if (p) el.points[d.i] = p; break; }
    case 'r': { const p = inv(pt); if (p) el.radius = round(Math.max(0.05, geoDistance(el.at, p) * 6371), 2); break; }
    case 'move': { const p = inv(pt); if (p) el.at = p; break; }
    case 'fa': { const p = inv(pt); if (p) el.a = p; break; }
    case 'fb': { const p = inv(pt); if (p) el.b = p; break; }
    case 'to': { const p = inv(pt); if (p) el.to = p; break; }
    case 'ca': { const p = inv(pt); if (p) el.at = p; break; }
    case 'cr': el.r = Math.round(clamp(Math.hypot(pt[0] - el.x, pt[1] - el.y), 40, 900)); break;
    case 'w': { const right = o.x + o.w; el.x = Math.round(Math.min(pt[0], right - 160)); el.w = Math.round(right - el.x); break; }
    case 'wh': { const ratio = o.h / o.w; el.w = Math.round(Math.max(24, pt[0] - o.x)); el.h = Math.round(el.w * ratio); break; }
    // Size by pulling a corner away from (or toward) the middle; turn by the knob above.
    case 'ls': case 'ms': {
      const c = d.center, k = Math.hypot(pt[0] - c[0], pt[1] - c[1]) / Math.max(1, Math.hypot(d.start[0] - c[0], d.start[1] - c[1]));
      if (d.h === 'ls') el.size = Math.round(clamp(o.size * k, 8, 400));
      else el.size = Math.round(clamp(o.size * k, 4, 300));
      break;
    }
    case 'rot': {
      const c = d.center;
      let a = (Math.atan2(pt[1] - c[1], pt[0] - c[0]) * 180) / Math.PI + 90;
      a = ((a + 540) % 360) - 180;
      el.rotate = d.shift ? Math.round(a / 15) * 15 : Math.abs(a) < 3 ? 0 : Math.round(a);
      break;
    }
  }
}

/* ---------- region tool ---------- */

export function clearPick() { store.pick = null; canvas.g['L-pick'] && (canvas.g['L-pick'].innerHTML = ''); }

async function regionClick(e, pt) {
  const mode = store.regionMode || 'country';
  const pickHit = e.target.closest('[data-pick]');
  if (pickHit && store.pick) {
    const { a3, kind, level } = store.pick;
    const id = pickHit.dataset.pick;
    const existing = store.doc.elements.find((x) => x.type === 'region' && x.kind === kind && x.rid === id);
    if (existing) { pickRegion(existing.id, e.shiftKey); return; }
    const src = kind === 'admin1' ? D.admin1(a3) : D.gb(a3, level);
    const f = src?.byId.get(id);
    const name = f ? (store.doc.lang === 'en' ? f.properties.name : f.properties.ar) : '';
    addRegion(makeElement('region', { kind, a3, rid: id, level, name, fill: store.doc.style.highlight }), e);
    return;
  }
  const regHit = e.target.closest('[data-el]');
  const reg = regHit && store.el(regHit.dataset.el);
  // Look under labels and markers for the country itself.
  const under = document.elementsFromPoint(e.clientX, e.clientY).find((n) => n.dataset?.cid);
  const cid = e.target.closest('[data-cid]')?.dataset.cid || (reg?.type === 'region' ? reg.a3 : null) || under?.dataset.cid;
  if (!cid) return;
  if (mode === 'country') {
    if (reg && reg.type === 'region' && reg.kind === 'country') {
      if (e.altKey) { removeWithUndo(reg.id); return; }
      pickRegion(reg.id, e.shiftKey); return;
    }
    const f = canvas.ctx.countries?.byId.get(cid);
    const name = f ? (store.doc.lang === 'en' ? f.properties.name : f.properties.ar) : cid;
    addRegion(makeElement('region', { kind: 'country', a3: cid, name, fill: store.doc.style.highlight }), e);
    return;
  }
  // Provinces / districts: show the units of the clicked country to pick from.
  showPick(cid, mode);
}

export async function showPick(a3, mode) {
  const kind = mode === 'district' ? 'gb' : 'admin1';
  store.pick = { a3, kind, level: 'ADM2', loading: true };
  canvas.g['L-pick'].innerHTML = '';
  try {
    if (kind === 'admin1') await D.loadAdmin1(a3);
    else await D.loadGB(a3, 'ADM2');
  } catch (err) {
    store.pick = null;
    toast(kind === 'gb' ? 'تعذّر تحميل المديريات لهذه الدولة' : 'لا توجد محافظات لهذه الدولة');
    return;
  }
  if (!store.pick || store.pick.a3 !== a3) return;
  store.pick.loading = false;
  renderPick();
}

export function renderPick() {
  const pk = store.pick;
  const g = canvas.g['L-pick'];
  if (!pk || !g || !canvas.ctx) { if (g) g.innerHTML = ''; return; }
  const src = pk.kind === 'admin1' ? D.admin1(pk.a3) : D.gb(pk.a3, pk.level);
  if (!src) return;
  const path = canvas.ctx.path;
  const z = store.zoom;
  g.innerHTML = src.features.map((f) => `<path class="pick" data-pick="${f.properties.id}" d="${path(f) || ''}" stroke-width="${1.2 / z}"><title>${f.properties.ar || f.properties.name}</title></path>`).join('');
}

/* ---------- placing things ---------- */

async function place(tool, pt, e) {
  const { w, h } = store.doc.artboard;
  const S = designSize(store.doc.artboard), s0 = Math.min(S.w, S.h); // sizes follow the post, not the window
  const at = inv(pt);
  let el;
  if (tool === 'marker') el = makeElement('marker', { at, color: store.lastMarkerColor || '#e8323c' });
  else if (tool === 'label') el = makeElement('label', { at, size: Math.round(s0 / 34) });
  else if (tool === 'textbox') { const bw = Math.round(Math.min(840, S.w * 0.78, w)); el = makeElement('textbox', { x: Math.round(clamp(pt[0] - bw / 2, 0, w - bw)), y: Math.round(pt[1]), w: bw }); }
  else if (tool === 'legend') el = makeElement('legend', { x: Math.round(pt[0]), y: Math.round(pt[1]) });
  else if (tool === 'callout') {
    const r = Math.round(s0 * 0.17);
    const side = pt[0] > w * 0.55 ? -1 : 1;
    el = makeElement('callout', { at, r, x: Math.round(clamp(pt[0] + side * r * 1.7, r, w - r)), y: Math.round(clamp(pt[1] + r * 0.8, r, h - r)), satZoom: Math.min(17, Math.round(store.doc.view.zoom + Math.log2(w / 256) + 4)) });
  } else if (tool === 'image') {
    const file = await pickFile('image/*');
    if (!file) return;
    const url = await blobToDataURL(file);
    const img = new Image(); img.src = url; await img.decode().catch(() => {});
    const iw = Math.round(Math.min(S.w * 0.3, img.naturalWidth || 240)), ih = Math.round(iw * ((img.naturalHeight || 1) / (img.naturalWidth || 1)));
    const asset = store.addAsset(url);
    el = makeElement('image', { x: Math.round(pt[0] - iw / 2), y: Math.round(pt[1] - ih / 2), w: iw, h: ih, asset, name: file.name.replace(/\.\w+$/, '') });
  }
  if (!el || (el.at && !at && !LAYOUT_TYPES.has(el.type) && el.type !== 'callout')) return;
  finishPlace(el, e);
}

function finishPlace(el, e, stay = false) {
  store.add(el);
  if (!e?.shiftKey && !stay) store.setTool('select');
  store.emit('placed');
  // New text: start typing right away.
  if (!e?.shiftKey && (el.type === 'label' || el.type === 'textbox')) requestAnimationFrame(() => editText(el.id, el.type === 'textbox' ? 'title' : null, { selectAll: true }));
}

/* ---------- drawing lines and areas ---------- */

function draftClick(pt) {
  const type = store.tool;
  const p = inv(pt);
  if (!p) return;
  if (!store.draft || store.draft.el.type !== type) {
    store.draft = { el: makeElement(type, { points: [] }), cursor: null };
    if (type === 'line' && store.lastLine) Object.assign(store.draft.el, store.lastLine);
  }
  const pts = store.draft.el.points;
  if (type === 'area' && pts.length >= 3) {
    const first = P()(pts[0]);
    if (first && Math.hypot(first[0] - pt[0], first[1] - pt[1]) * store.zoom < 12) return finishDraft();
  }
  pts.push(p);
  store.emit('draft');
  canvas.drawUI();
}

export function finishDraft() {
  const d = store.draft;
  if (!d) return;
  const proj = P();
  // Double-click leaves twin points; drop near-duplicates.
  const pts = [];
  for (const p of d.el.points) {
    const q = proj(p), last = pts.length && proj(pts[pts.length - 1]);
    if (!last || !q || Math.hypot(q[0] - last[0], q[1] - last[1]) > 3) pts.push(p);
  }
  d.el.points = pts;
  store.draft = null;
  const min = d.el.type === 'area' ? 3 : 2;
  if (pts.length >= min) finishPlace(d.el);
  else canvas.drawUI();
  store.emit('draft');
}
export function cancelDraft() { store.draft = null; canvas.drawUI(); store.emit('draft'); }

function onDbl(e) {
  if (store.draft) { finishDraft(); return; }
  if (store.tool !== 'select') return;
  const t = lastDown && performance.now() - lastDownAt < 800 && lastDown.isConnected ? lastDown : e.target;
  const g = t.closest?.('[data-el]');
  if (g) {
    const el = store.el(g.dataset.el);
    if (!el) return;
    if (el.type === 'line' || el.type === 'area') return; // double-click on a path: nothing to type
    const part = t.closest('[data-part]')?.dataset.part;
    store.select(el.id);
    editText(el.id, part);
    return;
  }
  const lab = t.closest?.('[data-label]');
  if (lab) { store.select('label:' + lab.dataset.label); editText('label:' + lab.dataset.label); }
}

/* ---------- hover ---------- */

function onHover(e) {
  if (drag) return;
  if (store.tool === 'select') { smart.hover(e, null, canvas.ctx ? inv(canvas.toArt(e)) : null); return; }
  if (store.tool === 'region' && (store.regionMode || 'country') === 'country') {
    const t = e.target.closest('[data-cid]');
    const d = t?.getAttribute('d') || null;
    if (d !== canvas.hover) { canvas.hover = d; drawUIsoon(); }
  } else if (store.tool === 'region' && !store.pick) {
    const t = e.target.closest('[data-cid]');
    const d = t?.getAttribute('d') || null;
    if (d !== canvas.hover) { canvas.hover = d; drawUIsoon(); }
  }
}

/* ---------- shared actions ---------- */

/** Delete / duplicate an element — or, if it's part of a multi-selection, the whole selection. */
export function removeWithUndo(id) {
  if (!store.sels.includes(id)) store.select(id);
  deleteSel();
}
export function duplicate(id) {
  if (id && !store.sels.includes(id)) store.select(id);
  duplicateSel(24);
}
export const nudge = nudgeSel;

export function circleRing(el) { return geoCircle().center(el.at).radius(el.radius / 111.32)(); }
