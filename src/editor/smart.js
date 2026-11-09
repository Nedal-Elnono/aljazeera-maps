// Smart picking: whatever is under the pointer — an element, a map name, a border, water, roads,
// a country — lights up on hover with its name, and one click selects it for editing in place.
import { geoContains } from 'd3';
import { store, TYPE_NAMES } from '../store.js';
import { canvas } from './canvas.js';
import { real } from './realmap.js';
import { isReal } from '../render/compose.js';
import * as D from '../geo/data.js';
import { rafThrottle } from '../util.js';

export const LAYER_NAMES = {
  border: 'حدود الدول', admin1: 'حدود المحافظات', water: 'الماء', river: 'الأنهار', roads: 'الطرق',
  park: 'الحدائق والغابات', labels: 'أسماء الخريطة', land: 'اليابسة',
};

const inBounds = D.inGeoBox;
export function countryAt(ll) {
  const C = canvas.ctx?.countries;
  if (!C || !ll) return null;
  for (const f of C.features) if (inBounds(f, ll) && geoContains(f, ll)) return f;
  return null;
}
export function regionAt(ll) {
  const els = store.doc.elements;
  for (let i = els.length - 1; i >= 0; i--) {
    const el = els[i];
    if (el.type !== 'region' || el.hidden) continue;
    const f = D.regionFeature(el, store.doc.worldview, canvas.ctx?.lod);
    if (f && inBounds(f, ll) && geoContains(f, ll)) return el;
  }
  return null;
}

const realLayer = (id) =>
  id.startsWith('label-') ? 'labels'
    : id === 'boundary-disputed' || (id.startsWith('boundary-country') && !id.endsWith('-case')) ? 'border'
      : id.startsWith('boundary-admin') ? 'admin1'
        : id.startsWith('road-') || id === 'rail' ? 'roads'
          : id === 'water' || id === 'waterway' ? 'water'
            : id === 'park' || id === 'landuse-park' || id.startsWith('landcover') ? 'park'
              : id === 'regions-fill' || id === 'regions-hatch' ? 'region' : null;

// A map name in the document's language: OpenMapTiles has name:ar / name:en, Overture a JSON `names`.
const ovName = (p, lang) => { try { return JSON.parse(p.names).common?.[lang] || ''; } catch { return ''; } };
const placeName = (p = {}) => String((store.doc.lang === 'en'
  ? p['name:en'] || ovName(p, 'en') || p.name || p['@name']
  : p['name:ar'] || ovName(p, 'ar') || p.name || p['@name']) || '').replace(/\s*[،,][ _]?(إسرائيل|Israel)$/, ''); // see pseName
export const elLabel = (el) => {
  const t = (el.name || el.text || el.legend || (el.title || '').replace(/\*\*|==/g, '') || '').toString().split('\n')[0].slice(0, 26);
  return TYPE_NAMES[el.type] + (t ? ' · ' + t : '');
};

function countryPick(c) {
  const name = store.doc.lang === 'en' ? c.properties.name : c.properties.ar;
  // With a country or a shaded area picked, say how to add this one to it.
  const adding = store.sel?.startsWith('country:') || store.sel === 'geo:' || store.selected?.type === 'region';
  return { kind: 'country', a3: c.properties.id, name, label: `${name} · ${adding ? 'Shift + نقر لإضافتها للتحديد' : 'انقر لتلوينها'}` };
}

/** What's under the pointer, most likely intent first. `mp` = map point (real map), `ll` = lon/lat. */
export function pickAt(ev, mp, ll) {
  const t = ev?.target;
  const g = t?.closest?.('[data-el]');
  if (g) {
    const el = store.el(g.dataset.el);
    if (el && !(el.type === 'region' && isReal(store.doc))) return { kind: 'el', id: el.id, label: elLabel(el) };
  }
  const lab = t?.closest?.('[data-label]');
  if (lab) return { kind: 'label', key: lab.dataset.label, label: 'اسم على الخريطة · ' + (lab.textContent || '').trim() };

  if (isReal(store.doc) && real.map && mp) {
    const near = real.map.queryRenderedFeatures([[mp.x - 5, mp.y - 5], [mp.x + 5, mp.y + 5]]);
    const at = real.map.queryRenderedFeatures([mp.x, mp.y]);
    const find = (list, k) => list.find((f) => realLayer(f.layer.id) === k);
    const zoom = real.map.getZoom();
    let f;
    if ((f = find(near, 'labels'))) {
      // A country's name sits in its middle: clicking it means the country.
      if (f.layer.id.startsWith('label-country') && ll) {
        const c = countryAt(ll);
        if (c) { const r = regionAt(ll); if (r) return { kind: 'el', id: r.id, label: elLabel(r) }; return countryPick(c); }
      }
      const n = placeName(f.properties);
      return { kind: 'layer', layer: 'labels', name: n, ll, label: n ? `${n} · اسم على الخريطة` : LAYER_NAMES.labels };
    }
    if ((f = find(near, 'border'))) return { kind: 'layer', layer: 'border', geom: f.geometry, label: LAYER_NAMES.border };
    if ((f = find(near, 'admin1'))) return { kind: 'layer', layer: 'admin1', geom: f.geometry, label: LAYER_NAMES.admin1 };
    if ((f = find(at, 'region'))) { const el = store.el(f.properties.id); if (el) return { kind: 'el', id: el.id, label: elLabel(el) }; }
    if (zoom >= 10 && (f = find(near, 'roads'))) return { kind: 'layer', layer: 'roads', geom: f.geometry, label: LAYER_NAMES.roads };
    if ((f = find(at, 'water'))) { const n = placeName(f.properties); return { kind: 'layer', layer: 'water', label: LAYER_NAMES.water + (n ? ' · ' + n : '') }; }
  } else if (t) {
    const hit = t.closest?.('[data-layer],[data-cid]');
    if (hit?.dataset.layer) return { kind: 'layer', layer: hit.dataset.layer, label: LAYER_NAMES[hit.dataset.layer] || '' };
  }
  if (ll) {
    const r = regionAt(ll);
    if (r) return { kind: 'el', id: r.id, label: elLabel(r) };
    const c = countryAt(ll);
    if (c) return countryPick(c);
    if (isReal(store.doc)) {
      if (real.map && mp && real.map.getZoom() >= 10 && real.map.queryRenderedFeatures([mp.x, mp.y]).some((f) => realLayer(f.layer.id) === 'park')) return { kind: 'layer', layer: 'park', label: LAYER_NAMES.park };
      return { kind: 'layer', layer: 'land', label: LAYER_NAMES.land };
    }
  }
  return null;
}

const same = (a, b) => (a && b && a.kind === b.kind && (a.id || a.a3 || a.key || a.layer) === (b.id || b.a3 || b.key || b.layer) && a.geom === b.geom) || (!a && !b);

/* ---------- hover ---------- */

let tip;
function showTip(p, ev) {
  if (!p || !ev) { if (tip && !tip.hidden) tip.hidden = true; return; }
  if (!tip) { tip = document.createElement('div'); tip.className = 'hovtip'; canvas.stage.append(tip); }
  const r = canvas.stage.getBoundingClientRect();
  tip.hidden = false;
  tip.textContent = p.label;
  tip.style.left = Math.min(ev.clientX - r.left + 16, r.width - 220) + 'px';
  tip.style.top = ev.clientY - r.top + 18 + 'px';
}

function apply(p, ev) {
  const selKey = store.sel;
  const isSel = p && ((p.kind === 'el' && (p.id === selKey || store.sels.includes(p.id))) || (p.kind === 'country' && (selKey === 'country:' + p.a3 || store.geoSel.includes(p.a3))) || (p.kind === 'label' && selKey === 'label:' + p.key));
  const shown = isSel ? null : p;
  canvas.stage.classList.toggle('is-hovering', !!p);
  showTip(shown, ev);
  if (!same(shown, canvas.hoverTarget)) { canvas.hoverTarget = shown; canvas.drawUI(); }
}

/** The map is being dragged, zoomed or flown: hovering waits (it would only cost frames). */
const moving = () => real.moving || canvas.stage.classList.contains('is-moving') || !!real.map?.isMoving();

// Picking asks the map and tests shapes, so it runs at most once a frame, on the latest pointer.
let pending = null;
const pickSoon = rafThrottle(() => {
  const a = pending;
  pending = null;
  if (!a || store.tool !== 'select' || moving()) return;
  apply(pickAt(...a), a[0]);
});

export function hover(ev, mp, ll) {
  if (store.tool !== 'select' || ev?.buttons || moving()) { pending = null; return clearHover(); }
  pending = [ev, mp, ll];
  pickSoon();
}
export function clearHover() {
  canvas.stage?.classList.remove('is-hovering');
  showTip(null);
  if (canvas.hoverTarget) { canvas.hoverTarget = null; canvas.drawUI(); }
}

/* ---------- click ---------- */

export function click(ev, mp, ll) {
  const p = pickAt(ev, mp, ll);
  store.selPoint = ll || null;
  clearHover();
  if (!p) { if (!ev?.shiftKey) store.select(null); return; }
  if (ev?.shiftKey) {
    // Shift adds to the selection (or takes out): elements, and countries that aren't shaded yet.
    if (p.kind === 'el') return store.toggleSel(p.id);
    if (p.kind === 'country') return store.toggleCountry(p.a3);
    // A country's name sits in its middle: Shift-clicking it means the country (or its shading).
    if (p.kind === 'label' && ll) {
      const r = regionAt(ll), c = !r && countryAt(ll);
      if (r) return store.toggleSel(r.id);
      if (c) return store.toggleCountry(c.properties.id);
    }
    if (store.count > 1 || store.sel === 'geo:') return; // Shift-clicking the map keeps a multi-selection
  }
  if (p.kind === 'el') return store.select(p.id), store.emit('sel');
  if (p.kind === 'label') return store.select('label:' + p.key), store.emit('sel');
  store.selInfo = p;
  const key = p.kind === 'country' ? 'country:' + p.a3 : 'layer:' + p.layer;
  if (store.sel === key) store.emit('sel'); else store.select(key);
}
