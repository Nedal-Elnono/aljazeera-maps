// Working with what's selected — one thing or many: where it is on the board, moving it,
// aligning and spacing it, duplicating, deleting, copying and pasting.
import { store, makeElement, TYPE_NAMES, isElId } from '../store.js';
import { canvas } from './canvas.js';
import * as D from '../geo/data.js';
import { round, uid } from '../util.js';
import { union } from './snap.js';
import { designSize } from '../presets.js';
import { toast, feedback } from '../vendor/folks/folks.js';
import { isReal } from '../render/compose.js';

const P = () => canvas.ctx.proj;

/* ---------- where things are (artboard units) ---------- */

const box = (b) => (b && Number.isFinite(b.x) && b.width + b.height > 0 ? { x: b.x, y: b.y, width: b.width, height: b.height } : null);
function nodeBox(node, skipParts = false) {
  if (!node) return null;
  try {
    if (!skipParts) return box(node.getBBox());
    // A marker aligns by its dot, not by its dot + name.
    const kids = [...node.children].filter((c) => !c.dataset?.part && c.tagName !== 'title');
    return union(kids.map((c) => box(c.getBBox())).filter(Boolean));
  } catch { return null; }
}

/** The box of an element on the board, or null if it isn't drawn. A marker counts by its dot;
 *  part 'label' = its name tag, part 'all' = dot and name together. */
export function elBox(el, part) {
  const ctx = canvas.ctx;
  if (!ctx || !el || el.hidden) return null;
  if (el.type === 'textbox' || el.type === 'legend' || el.type === 'image') { const b = ctx.boxes.get(el.id); return b ? box({ x: b.x, y: b.y, width: b.w, height: b.h }) : null; }
  if (el.type === 'callout') return el.shape === 'rect' ? box({ x: el.x - el.r, y: el.y - el.r * 0.72, width: el.r * 2, height: el.r * 1.44 }) : box({ x: el.x - el.r, y: el.y - el.r, width: el.r * 2, height: el.r * 2 });
  if (el.type === 'region') {
    const f = D.regionFeature(el, store.doc.worldview, ctx.lod);
    if (!f) return null;
    const [[x0, y0], [x1, y1]] = ctx.path.bounds(f);
    return box({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
  }
  const node = canvas.svg.querySelector(`[data-el="${el.id}"]`);
  if (el.type === 'marker') return part === 'label' ? nodeBox(node?.querySelector('[data-part="label"]')) : part === 'all' ? nodeBox(node) : nodeBox(node, true) || nodeBox(node);
  return nodeBox(node);
}

/** Boxes of everything a moving selection can line up with: other elements and the post frame. */
export function snapTargets(exclude = new Set()) {
  const out = [];
  for (const el of store.doc.elements) {
    if (el.hidden || el.type === 'region' || exclude.has(el.id)) continue;
    const b = elBox(el);
    if (b) out.push(b);
  }
  const { w, h } = store.doc.artboard, M = Math.round(Math.min(w, h) * 0.06);
  out.push({ x: 0, y: 0, width: w, height: h }, { x: M, y: M, width: w - 2 * M, height: h - 2 * M });
  return out;
}

/* ---------- moving (in artboard pixels, whatever the element is anchored to) ---------- */

export function shiftEl(el, orig, dx, dy, part) {
  const proj = P();
  const mv = (ll) => { const q = proj(ll); if (!q) return ll; const r = proj.invert([q[0] + dx, q[1] + dy]); return r ? [round(r[0], 5), round(r[1], 5)] : ll; };
  switch (el.type) {
    case 'marker':
      if (part === 'label') { el.ldx = Math.round(orig.ldx + dx); el.ldy = Math.round(orig.ldy + dy); }
      else el.at = mv(orig.at);
      break;
    case 'label': el.at = mv(orig.at); if (orig.to && part === 'all') el.to = mv(orig.to); break;
    case 'circle': el.at = mv(orig.at); break;
    case 'line': case 'area': el.points = orig.points.map(mv); break;
    case 'frame': el.a = mv(orig.a); el.b = mv(orig.b); break;
    case 'callout': case 'textbox': case 'legend': case 'image': el.x = Math.round(orig.x + dx); el.y = Math.round(orig.y + dy); break;
  }
}
export const movable = (el) => el && !el.locked && !el.hidden && el.type !== 'region';

/** Arrow keys: move every selected thing by a few pixels. */
export function nudgeSel(dx, dy) {
  const els = store.selection.filter(movable);
  if (!els.length) return;
  store.update(() => { for (const el of els) shiftEl(el, structuredClone(el), dx, dy); }, { kind: 'el', label: 'تحريك' });
  canvas.ghost = '';
}

/* ---------- align & distribute ---------- */

/** Align to each other (2+), or to the post frame (one). how: left|hcenter|right|top|vcenter|bottom */
export function alignSel(how) {
  const els = store.selection.filter(movable);
  if (!els.length) return;
  const items = els.map((el) => ({ el, b: elBox(el) })).filter((i) => i.b);
  const { w, h } = store.doc.artboard;
  const ref = items.length > 1 ? union(items.map((i) => i.b)) : { x: 0, y: 0, width: w, height: h };
  store.update(() => {
    for (const { el, b } of items) {
      let dx = 0, dy = 0;
      if (how === 'left') dx = ref.x - b.x;
      if (how === 'hcenter') dx = ref.x + ref.width / 2 - (b.x + b.width / 2);
      if (how === 'right') dx = ref.x + ref.width - (b.x + b.width);
      if (how === 'top') dy = ref.y - b.y;
      if (how === 'vcenter') dy = ref.y + ref.height / 2 - (b.y + b.height / 2);
      if (how === 'bottom') dy = ref.y + ref.height - (b.y + b.height);
      if (dx || dy) shiftEl(el, structuredClone(el), dx, dy);
    }
  }, { label: 'محاذاة' });
  feedback('tick');
}

/** Equal gaps between 3+ things, across (x) or down (y). */
export function distributeSel(axis) {
  const items = store.selection.filter(movable).map((el) => ({ el, b: elBox(el) })).filter((i) => i.b);
  if (items.length < 3) return;
  const pos = axis === 'x' ? 'x' : 'y', size = axis === 'x' ? 'width' : 'height';
  items.sort((a, b) => a.b[pos] - b.b[pos]);
  const first = items[0].b, last = items[items.length - 1].b;
  const total = items.reduce((s, i) => s + i.b[size], 0);
  const gap = (last[pos] + last[size] - first[pos] - total) / (items.length - 1);
  store.update(() => {
    let at = first[pos];
    for (const { el, b } of items) {
      const d = at - b[pos];
      if (Math.abs(d) > 0.01) shiftEl(el, structuredClone(el), axis === 'x' ? d : 0, axis === 'x' ? 0 : d);
      at += b[size] + gap;
    }
  }, { label: 'توزيع بالتساوي' });
  feedback('tick');
}

/* ---------- duplicate, delete, select all ---------- */

function cloneShifted(el, off) {
  const c = structuredClone(el);
  c.id = makeElement(el.type).id;
  if (off) shiftEl(c, structuredClone(el), off, off);
  return c;
}

/** Copies right above their originals. Returns the new ids (and selects them). */
export function duplicateSel(off = 24, { select = true, label = 'تكرار' } = {}) {
  const els = store.selection;
  if (!els.length) return [];
  const made = [];
  store.update((d) => {
    for (const el of els) {
      const c = cloneShifted(el, off);
      d.elements.splice(d.elements.indexOf(el) + 1, 0, c);
      made.push(c.id);
    }
  }, { label });
  if (select) store.selectMany(made);
  return made;
}

/* ---------- several countries and provinces at once ---------- */

/** The shaded countries/provinces picked, and the countries picked with Shift that aren't shaded yet. */
export const pickedRegions = () => store.selection.filter((e) => e.type === 'region');
export const regionsOnly = () => { const s = store.selection; return s.length + store.geoSel.length > 0 && s.every((e) => e.type === 'region'); };

/** The board box of a country (for countries picked but not shaded yet). */
export function countryBox(a3) {
  const ctx = canvas.ctx, f = ctx?.countries?.byId.get(a3);
  if (!f) return null;
  const [[x0, y0], [x1, y1]] = ctx.path.bounds(f);
  return box({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
}

/**
 * Give every picked country and province one color, in one undo step: the ones already shaded are
 * recolored, the countries not shaded yet get shaded. They stay selected, ready for the next edit.
 */
export function shadeSel(fill) {
  const doc = store.doc, C = canvas.ctx?.countries;
  const name = (a3) => { const f = C?.byId.get(a3); return f ? (doc.lang === 'en' ? f.properties.name : f.properties.ar) : a3; };
  const shaded = (a3) => doc.elements.find((e) => e.type === 'region' && e.kind === 'country' && e.a3 === a3 && !e.hidden);
  const old = [...pickedRegions(), ...store.geoSel.map(shaded).filter(Boolean)];
  const fresh = store.geoSel.filter((a3) => !shaded(a3)).map((a3) => makeElement('region', { kind: 'country', a3, name: name(a3), fill, opacity: isReal(doc) ? 0.6 : 1 }));
  const n = old.length + fresh.length;
  if (!n) return [];
  store.update((d) => { for (const e of old) e.fill = fill; d.elements.push(...fresh); }, { label: fresh.length ? (n > 1 ? `تظليل ${n} مناطق` : 'تظليل') : 'تغيير اللون' });
  const ids = [...new Set([...store.sels, ...old.map((e) => e.id), ...fresh.map((e) => e.id)])];
  store.selectMany(ids);
  feedback('success');
  return ids;
}

export function deleteSel() {
  const ids = store.sels.length ? [...store.sels] : isElId(store.sel) ? [store.sel] : [];
  if (!ids.length) return;
  const r = store.remove(ids);
  if (!r?.length) return;
  const n = r.length;
  toast(n > 1 ? `حُذفت ${n} عناصر` : 'حُذف ' + TYPE_NAMES[r[0].el.type], {
    actionTitle: 'تراجع',
    onUndo: () => { store.update((d) => { for (const x of [...r].sort((a, b) => a.i - b.i)) d.elements.splice(x.i, 0, x.el); }, { label: 'استرجاع' }); store.selectMany(r.map((x) => x.el.id)); },
  });
}

export function selectAll() {
  store.selectMany(store.doc.elements.filter((e) => !e.hidden && !e.locked && e.type !== 'region').map((e) => e.id));
}

/** Bring forward / send back, for the whole selection. */
export function restackSel(dir, toEnd) {
  const ids = new Set(store.sels);
  if (!ids.size) return;
  store.update((d) => {
    const picked = d.elements.filter((e) => ids.has(e.id));
    if (toEnd) {
      const rest = d.elements.filter((e) => !ids.has(e.id));
      d.elements = dir > 0 ? [...rest, ...picked] : [...picked, ...rest];
      return;
    }
    const arr = d.elements;
    const order = dir > 0 ? [...arr.keys()].reverse() : [...arr.keys()];
    for (const i of order) {
      if (!ids.has(arr[i].id)) continue;
      const j = i + dir;
      if (j < 0 || j >= arr.length || ids.has(arr[j].id)) continue;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }, { label: dir > 0 ? 'تقديم للأمام' : 'إرجاع للخلف' });
}

/* ---------- clipboard ---------- */

const TAG = 'AJMAP-ELEMENTS:';
let clip = null, pasteN = 0;

function payload() {
  const els = store.selection;
  if (!els.length) return null;
  const assets = {};
  for (const e of els) for (const k of ['asset']) if (e[k] && store.doc.assets[e[k]]) assets[e[k]] = store.doc.assets[e[k]];
  return { els: structuredClone(els), assets };
}

export function copySel(ev) {
  const p = payload();
  if (!p) return false;
  clip = p; pasteN = 0;
  const text = TAG + JSON.stringify(p);
  if (ev?.clipboardData) { ev.clipboardData.setData('text/plain', text); ev.preventDefault(); }
  else navigator.clipboard?.writeText(text).catch(() => {});
  flash(p.els.length > 1 ? `نُسخت ${p.els.length} عناصر` : 'نُسخ ' + TYPE_NAMES[p.els[0].type]);
  return true;
}
export function cutSel(ev) { if (copySel(ev)) { const ids = [...store.sels]; store.remove(ids, { label: 'قص' }); } }

function pasteElements(p) {
  pasteN += 1;
  const off = 24 * pasteN;
  const made = [];
  store.update((d) => {
    for (const [k, v] of Object.entries(p.assets || {})) if (!d.assets[k]) d.assets[k] = v;
    for (const el of p.els) {
      const c = structuredClone(el);
      c.id = uid(c.type[0]);
      if (canvas.ctx) shiftEl(c, structuredClone(el), off, off);
      d.elements.push(c);
      made.push(c.id);
    }
  }, { label: 'لصق' });
  store.selectMany(made);
  feedback('drop');
}

function centerAt() {
  const { w, h } = store.doc.artboard;
  const ll = canvas.ctx?.proj.invert([w / 2, h / 2]);
  return { x: w / 2, y: h / 2, ll: ll ? [round(ll[0], 5), round(ll[1], 5)] : [0, 0] };
}

async function pasteImage(blob) {
  const url = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
  const img = new Image(); img.src = url; await img.decode().catch(() => {});
  const { w } = designSize(store.doc.artboard), c = centerAt();
  const iw = Math.round(Math.min(w * 0.3, img.naturalWidth || 240)), ih = Math.round(iw * ((img.naturalHeight || 1) / (img.naturalWidth || 1)));
  const asset = store.addAsset(url);
  store.add(makeElement('image', { x: Math.round(c.x - iw / 2), y: Math.round(c.y - ih / 2), w: iw, h: ih, asset, name: 'صورة ملصوقة' }), { label: 'لصق صورة' });
}

/** ⌘V: our own elements, an image (logo, screenshot), or plain text (becomes a label). */
export async function pasteFrom(ev) {
  const dt = ev?.clipboardData;
  if (dt) {
    const file = [...dt.items].find((i) => i.kind === 'file' && i.type.startsWith('image/'))?.getAsFile();
    const text = dt.getData('text/plain');
    if (text?.startsWith(TAG)) { ev.preventDefault(); try { pasteElements(JSON.parse(text.slice(TAG.length))); } catch {} return; }
    if (file) { ev.preventDefault(); pasteImage(file); return; }
    if (text?.trim()) { ev.preventDefault(); pasteText(text.trim()); return; }
  }
  // From a menu: no paste event, ask the async clipboard, fall back to what we copied here.
  try {
    const items = await navigator.clipboard.read();
    for (const it of items) {
      const img = it.types.find((t) => t.startsWith('image/'));
      if (img) return pasteImage(await it.getType(img));
      if (it.types.includes('text/plain')) {
        const t = await (await it.getType('text/plain')).text();
        if (t.startsWith(TAG)) return pasteElements(JSON.parse(t.slice(TAG.length)));
        if (t.trim()) return pasteText(t.trim());
      }
    }
  } catch {}
  if (clip) pasteElements(clip);
}
export const canPaste = () => !!clip || !!navigator.clipboard?.read;

function pasteText(t) {
  const c = centerAt();
  const { w, h } = designSize(store.doc.artboard);
  store.add(makeElement('label', { at: c.ll, text: t.slice(0, 400), size: Math.round(Math.min(w, h) / 34) }), { label: 'لصق نص' });
}

/* ---------- a small note at the top of the stage (undo/redo, copy) ---------- */

let flashEl, flashT;
export function flash(text) {
  if (!canvas.stage) return;
  if (!flashEl) { flashEl = document.createElement('div'); flashEl.className = 'flash'; canvas.stage.append(flashEl); }
  flashEl.textContent = text;
  flashEl.classList.remove('is-on'); void flashEl.offsetWidth; flashEl.classList.add('is-on');
  clearTimeout(flashT);
  flashT = setTimeout(() => flashEl.classList.remove('is-on'), 1400);
}
