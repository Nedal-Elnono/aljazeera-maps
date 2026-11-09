// One document, one selection, one history. Everything else listens.
import { uid, idb, debounce } from './util.js';
import { STYLES, DEFAULT_FONT } from './presets.js';
import { REAL_DEFAULTS } from './geo/realstyle.js';

export function baseStyle(preset = 'light') {
  return {
    preset, ...STYLES[preset],
    labelSize: 26, seaLabelSize: 22, cityLabelSize: 22,
    countryLabels: true, seaLabels: true, regionLabels: false, cities: false, cityRank: 3,
    rivers: true, lakes: true, admin1All: true, graticule: false, coastGlow: false,
    bgImage: null, bgOpacity: 0.35, bgBlur: 0,
    satellite: false, satGray: true, satOpacity: 1, satDim: 0.15,
    detailRoads: true, detailPlaces: true, detailRivers: true,
  };
}

export function newDoc() {
  return {
    v: 1,
    provinces: 2,               // province lines on by default (older projects are switched on once in load)
    name: 'خريطة جديدة',
    base: 'real',               // 'real' = live OpenStreetMap map · 'design' = simplified Natural Earth map
    real: structuredClone(REAL_DEFAULTS),
    artboard: { preset: 'ig45', w: 1080, h: 1350, free: true }, // free = no post size yet: the whole box
    view: { projection: 'mercator', center: [46, 26], zoom: 3.05 },
    worldview: 'pse',
    lang: 'ar',
    font: DEFAULT_FONT,
    style: baseStyle('light'),
    labels: {},
    elements: [],
    assets: {},
    detail: null,
  };
}

// Defaults for every element type. Geo-anchored ones carry lon/lat; layout ones carry artboard px.
export const DEFAULTS = {
  region: { kind: 'country', a3: '', rid: '', name: '', fill: '#6b6b6b', opacity: 1, stroke: 'none', strokeWidth: 2, hatch: false, hatchColor: '#111111', hatchGap: 10, hatchAngle: 45, hatchWidth: 1.4, inner: false, innerColor: '#8a8a8a', innerNames: false, innerNameSize: 18, innerNameColor: '', labelColor: '', showName: false, nameSize: 24, nameColor: '#ffffff', legend: '' },
  marker: { at: [0, 0], shape: 'dot', color: '#e8323c', size: 24, stroke: '#ffffff', strokeWidth: 2.5, icon: 'blast', flag: 'ps', asset: '', text: '', labelStyle: 'dark', labelSize: 26, side: 'left', gap: 12, leader: 'none', ldx: 0, ldy: 0, legend: '' },
  label: { at: [0, 0], text: 'تسمية', style: 'dark', size: 30, color: '', bg: '', accent: '', pad: 12, rotate: 0, leaderOn: false, to: null, leaderDash: 'dashed', leaderElbow: 'v', leaderColor: '' },
  line: { points: [], mode: 'smooth', color: '#f2c230', width: 5, dash: 'solid', casing: '', casingWidth: 3, glow: false, arrow: 'none', opacity: 1, dist: false, distText: '', distSize: 26, distColor: '', distOffset: -20, legend: '' },
  area: { points: [], smooth: false, fill: '#9b9b9b', opacity: 0.55, stroke: '#111111', strokeWidth: 2, dash: 'solid', hatch: true, hatchColor: '#111111', hatchGap: 11, hatchAngle: 45, hatchWidth: 1.3, legend: '' },
  circle: { at: [0, 0], radius: 60, fill: '#f2c230', opacity: 0.78, stroke: '#d9661f', strokeWidth: 2, dash: 'dashed', legend: '' },
  frame: { a: [0, 0], b: [0, 0], stroke: '#ffffff', strokeWidth: 4, dash: 'dashed', fill: '', opacity: 0.12, text: '' },
  callout: { x: 0, y: 0, r: 190, at: [0, 0], source: 'satellite', asset: '', satZoom: 15, gray: false, border: '#ffffff', borderWidth: 6, leader: 'elbow', leaderDash: 'dashed', leaderColor: '#ffffff', leaderWidth: 3, dot: true, dotColor: '#e8323c' },
  textbox: { x: 0, y: 0, w: 840, title: 'عنوان الخريطة', body: 'اكتب النص التوضيحي هنا. استخدم **نجمتين** للتعريض و==علامتي يساوي== للتلوين.', align: 'right', bg: '#f2f2f2', bgOpacity: 0.9, color: '#111111', titleColor: '', titleSize: 48, bodySize: 32, accent: '#e8323c', pad: 46, lineHeight: 1.75, shadow: true, radius: 0 },
  legend: { x: 0, y: 0, auto: true, items: [], title: '', bg: '#f2f2f2', bgOpacity: 0.92, color: '#111111', size: 28, pad: 24, gap: 16 },
  image: { x: 0, y: 0, w: 200, h: 200, asset: '', opacity: 1 },
};

export const TYPE_NAMES = {
  region: 'تظليل', marker: 'علامة', label: 'تسمية', line: 'خط', area: 'منطقة', circle: 'دائرة',
  frame: 'إطار', callout: 'عدسة', textbox: 'صندوق نص', legend: 'مفتاح', image: 'صورة',
};
export const LAYOUT_TYPES = new Set(['textbox', 'legend', 'image']);

export function makeElement(type, props = {}) {
  return { id: uid(type[0]), type, name: '', hidden: false, locked: false, ...structuredClone(DEFAULTS[type]), ...props };
}

/* ---------- the store ---------- */

const listeners = new Set();
// History keeps the light part of the document; images and fetched OSM detail live outside it.
const strip = (doc) => JSON.stringify({ ...doc, view: undefined, assets: undefined, detail: doc.detail ? { at: doc.detail.at } : null });

export const isElId = (k) => !!k && !k.includes(':');

export const store = {
  doc: newDoc(),
  sel: null,            // element id, or 'label:<key>' for a base-map label
  sels: [],             // every selected element (sel is the last one picked)
  geoSel: [],           // countries picked with Shift that aren't shaded yet (a3 codes); sel is then 'geo:'
  tool: 'select',
  draft: null,          // a line/area being drawn
  zoom: 1,              // how big the artboard is on screen
  past: [], future: [],   // [snapshot, label] pairs
  _last: null, _label: '',

  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit(kind = 'doc') { for (const fn of listeners) fn(kind); },

  get selected() { return this.doc.elements.find((e) => e.id === this.sel) || null; },
  /** Every selected element, in document order. */
  get selection() { const ids = new Set(this.sels); return this.doc.elements.filter((e) => ids.has(e.id)); },
  get multi() { return this.sels.length > 1; },
  /** How many things are picked: elements, plus countries that aren't shaded yet. */
  get count() { return this.sels.length + this.geoSel.length; },
  el(id) { return this.doc.elements.find((e) => e.id === id) || null; },

  /** Change the document. commit=false while dragging; commit once at the end. `label` names the undo step. */
  update(fn, { commit = true, kind = 'doc', label = '' } = {}) {
    fn(this.doc);
    if (commit) this.commit(label);
    this.emit(kind);
  },
  mergeKey: null, _merge: null,   // commits under the same mergeKey (e.g. one color drag) make one undo step
  commit(label = '') {
    const snap = strip(this.doc);
    if (snap === this._last) return;
    const merging = this.mergeKey && this.mergeKey === this._merge;
    if (this._last !== null && !merging) { this.past.push([this._last, this._label]); if (this.past.length > 150) this.past.shift(); }
    this._last = snap; this._label = label || this._label;
    if (!merging) this._label = label;
    this._merge = this.mergeKey;
    this.future = [];
    autosave();
  },
  /** What the next undo / redo would do, for buttons and toasts. */
  get undoLabel() { return this.past.length ? this._label : null; },
  get redoLabel() { return this.future.length ? this.future[this.future.length - 1][1] : null; },
  undo() {
    if (!this.past.length) return false;
    const label = this._label;
    this.future.push([this._last, this._label]);
    [this._last, this._label] = this.past.pop();
    this._restore(this._last);
    return label || true;
  },
  redo() {
    if (!this.future.length) return false;
    this.past.push([this._last, this._label]);
    [this._last, this._label] = this.future.pop();
    this._restore(this._last);
    return this._label || true;
  },
  _restore(snap) {
    const { assets, detail, view } = this.doc;
    const next = JSON.parse(snap);
    // The camera isn't part of undo: undoing an edit never jumps the map.
    this.doc = { ...next, view, assets, detail: next.detail && detail && next.detail.at === detail.at ? detail : next.detail ? detail : null };
    if (this.sel && !this.sel.startsWith('label:') && !this.sel.startsWith('geo:') && !this.el(this.sel)) this.sel = null;
    this.sels = this.sels.filter((id) => this.el(id));
    if (this.sel === 'geo:' && !this.geoSel.length) this.sel = this.sels[this.sels.length - 1] || null;
    this.emit('doc');
    autosave();
  },
  load(doc) {
    const fresh = newDoc();
    if (!doc.base) doc = { ...doc, base: 'design' }; // projects from before the real map
    this.doc = { ...fresh, ...doc, real: { ...fresh.real, ...(doc.real || {}) }, style: { ...fresh.style, ...doc.style }, view: { ...fresh.view, ...doc.view }, artboard: { ...fresh.artboard, ...doc.artboard } };
    // Province lines are on by default now, on both maps; projects from before get them once.
    if (!doc.provinces) { this.doc.style.admin1All = true; this.doc.real.admin1 = true; this.doc.provinces = fresh.provinces; }
    this.doc.elements = (this.doc.elements || []).map((e) => ({ ...structuredClone(DEFAULTS[e.type] || {}), ...e }));
    this.doc.assets ||= {};
    this.doc.labels ||= {};
    // The map shows Palestine, never Israel: shading or a renamed label made on "Israel" moves to Palestine.
    for (const e of this.doc.elements) if (e.type === 'region' && e.a3 === 'ISR' && e.kind !== 'gb') e.a3 = 'PSX';
    if (this.doc.labels['c:ISR'] && !this.doc.labels['c:PSX']) this.doc.labels['c:PSX'] = this.doc.labels['c:ISR'];
    delete this.doc.labels['c:ISR'];
    // There's no post frame any more: a project or template made with one opens on the free canvas,
    // remembering its post size so text and markers keep their size. The canvas finishes the move
    // on its first fit (it knows the screen): see `fromPost` in canvas.fitToStage.
    const ab = this.doc.artboard;
    if (!ab.free) this.doc.artboard = { ...ab, free: true, refW: ab.w, refH: ab.h, fromPost: true };
    this.sel = null; this.sels = []; this.geoSel = []; this.draft = null;
    this.past = []; this.future = []; this._last = strip(this.doc); this._label = '';
    this.emit('load');
    autosave();
  },

  /** Save soon without adding an undo step (e.g. after moving the map). */
  save() { autosave(); },
  /** The document was adjusted without being edited (an old project fitted to the canvas): undo starts here. */
  rebase() { this._last = strip(this.doc); autosave(); },

  select(id) {
    const sels = isElId(id) ? [id] : [];
    if (this.sel === id && this.sels.length === sels.length && !this.geoSel.length) return;
    this.sel = id; this.sels = sels; this.geoSel = []; this.emit('sel');
  },
  /** Shift-click: add or take away one element. */
  toggleSel(id) {
    if (!isElId(id)) return this.select(id);
    this._joinCountry();
    const has = this.sels.includes(id);
    this.sels = has ? this.sels.filter((x) => x !== id) : [...this.sels.filter(isElId), id];
    this._settle(has ? this.sels[this.sels.length - 1] || null : id);
  },
  /** Shift-click on a country that isn't shaded yet: add it to the selection, or take it out. */
  toggleCountry(a3) {
    this._joinCountry();
    this.geoSel = this.geoSel.includes(a3) ? this.geoSel.filter((x) => x !== a3) : [...this.geoSel, a3];
    this._settle(this.sels[this.sels.length - 1] || null);
  },
  // A country picked with a plain click joins the Shift-selection that starts from it.
  _joinCountry() {
    if (!this.sel?.startsWith('country:')) return;
    const a3 = this.sel.slice(8);
    if (!this.geoSel.includes(a3)) this.geoSel = [a3, ...this.geoSel];
  },
  _settle(last) {
    if (this.geoSel.length === 1 && !this.sels.length) { this.sel = 'country:' + this.geoSel[0]; this.geoSel = []; }
    else this.sel = this.geoSel.length ? 'geo:' : last;
    this.emit('sel');
  },
  selectMany(ids, add = false) {
    const next = [...new Set([...(add ? this.sels : []), ...ids])].filter((id) => this.el(id));
    this.sels = next;
    if (!add) this.geoSel = [];
    this.sel = this.geoSel.length ? 'geo:' : next[next.length - 1] || null;
    this.emit('sel');
  },
  setTool(t) { if (this.tool === t) return; this.tool = t; this.draft = null; this.emit('tool'); },

  add(el, { select = true, label } = {}) {
    this.update((d) => d.elements.push(el), { label: label || 'إضافة ' + TYPE_NAMES[el.type] });
    if (select) this.select(el.id);
    return el;
  },
  remove(id, { label } = {}) {
    const ids = Array.isArray(id) ? id : [id];
    const out = [];
    for (const x of ids) {
      const i = this.doc.elements.findIndex((e) => e.id === x);
      if (i < 0) continue;
      const [el] = this.doc.elements.splice(i, 1);
      out.push({ el, i });
    }
    if (!out.length) return null;
    if (ids.includes(this.sel)) this.sel = null;
    this.sels = this.sels.filter((x) => !ids.includes(x));
    this.commit(label || (out.length > 1 ? `حذف ${out.length} عناصر` : 'حذف ' + TYPE_NAMES[out[0].el.type])); this.emit('doc');
    return Array.isArray(id) ? out : out[0];
  },
  addAsset(dataUrl) {
    const id = uid('a');
    this.doc.assets[id] = dataUrl;
    return id;
  },
};

const autosave = debounce(() => idb.set('autosave', store.doc), 700);
