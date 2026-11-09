// Loads and caches map data. Everything ships in /public/data (built from Natural Earth);
// finer boundaries come from geoBoundaries on demand.
import * as topojson from 'topojson-client';
import { geoBounds, geoArea } from 'd3';
import { normAr } from '../util.js';

/**
 * d3 draws polygons on a sphere: a ring wound the "wrong" way means "everything except this shape"
 * and floods the map. Natural Earth mixes orientations, so normalize once on load.
 */
function fixWinding(features) {
  for (const f of features) {
    const g = f.geometry;
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const poly of polys) {
      if (geoArea({ type: 'Polygon', coordinates: poly }) > 2 * Math.PI) for (const ring of poly) ring.reverse();
    }
  }
  return features;
}

const BASE = import.meta.env.BASE_URL + 'data/';

/**
 * The editor tells us when the map is moving; heavy parsing waits for a still moment, so a
 * dataset landing mid-gesture never freezes a frame (the closest loaded detail stands in meanwhile).
 */
let busy = () => false;
export const setBusy = (fn) => { busy = fn; };
const calm = () => new Promise((res) => { const t = () => (busy() ? setTimeout(t, 120) : res()); t(); });

/** One load per key, however many times it's asked for while in flight (every frame, during a move). */
const loads = new Map();
const once = (key, fn) => {
  if (!loads.has(key)) loads.set(key, fn().catch((e) => { loads.delete(key); throw e; }));
  return loads.get(key);
};

const getJSON = (url) => once('json:' + url, () => fetch(url)
  .then((r) => { if (!r.ok) throw new Error(r.status + ' ' + url); return r.text(); })
  .then(async (t) => { await calm(); return JSON.parse(t); }));

/**
 * A feature's lon/lat box in geoBounds' shape [[w, s], [e, n]], read straight off its coordinates
 * (~25× faster than geoBounds, which matters with thousands of detailed shapes). A shape split at the
 * antimeridian simply spans every longitude, and a small margin covers great-circle edges bowing
 * past their end points. For culling and for "could the pointer be in here" before geoContains.
 */
const BOX = new WeakMap();
export function geoBox(f) {
  let b = BOX.get(f);
  if (b) return b;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const pts = (a) => { for (const p of a) { const x = p[0], y = p[1]; if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; } };
  const geom = (g) => {
    if (!g) return;
    const c = g.coordinates;
    if (g.type === 'Point') pts([c]);
    else if (g.type === 'MultiPoint' || g.type === 'LineString') pts(c);
    else if (g.type === 'MultiLineString') for (const l of c) pts(l);
    else if (g.type === 'Polygon') { if (c[0]) pts(c[0]); }
    else if (g.type === 'MultiPolygon') { for (const p of c) if (p[0]) pts(p[0]); }
    else if (g.type === 'GeometryCollection') for (const x of g.geometries) geom(x);
  };
  if (f.type === 'FeatureCollection') for (const x of f.features) geom(x.geometry);
  else geom(f.type === 'Feature' ? f.geometry : f);
  b = w > e ? [[Infinity, Infinity], [-Infinity, -Infinity]] : [[w - 0.1, Math.max(-90, s - 0.3)], [e + 0.1, Math.min(90, n + 0.3)]];
  BOX.set(f, b);
  return b;
}
/** Is a lon/lat point inside a feature's box (any world copy)? */
export function inGeoBox(f, [x, y]) {
  const [[w, s], [e, n]] = geoBox(f);
  if (y < s || y > n) return false;
  if (e - w >= 359) return true;
  x = ((((x + 180) % 360) + 360) % 360) - 180;
  return x >= w && x <= e;
}

let onLoaded = () => {};
/** Called whenever a lazy dataset arrives, so the map can redraw with it. */
export const whenLoaded = (fn) => { onLoaded = fn; };

const C = {};       // countries by `${wv}-${lod}`
const A1 = {};      // admin1 by a3
const GB = {};      // geoBoundaries by `${iso}-${level}`
let PLACES = null, MARINE = null, REGIONS = null, RIVERS = null, LAKES = null, A1INDEX = null;

function packCountries(topo) {
  const obj = topo.objects.countries;
  // mapshaper writes outer rings clockwise, the way d3 reads them, so no rewinding here
  // (scripts/build-data.mjs checks every polygon). Borders and coasts are built on first use.
  const features = topojson.feature(topo, obj).features;
  const byId = new Map(features.map((f) => [f.properties.id, f]));
  let borders = null, coast = null;
  return {
    features, byId,
    get borders() { return (borders ||= topojson.mesh(topo, obj, (a, b) => a !== b)); },
    get coast() { return (coast ||= topojson.mesh(topo, obj, (a, b) => a === b)); },
  };
}

export function loadCountries(wv, lod = 'lo') {
  const k = `${wv}-${lod}`;
  if (C[k]) return Promise.resolve(C[k]);
  return once('countries:' + k, async () => {
    const topo = await getJSON(`${BASE}countries-${wv}-${lod}.json`);
    await calm();
    C[k] = packCountries(topo);
    if (lod === 'lo') buildIndexCountries(C[k]);
    onLoaded('countries');
    return C[k];
  });
}

/**
 * The best countries set available right now for a level of detail ('lo' | 'mid' | 'hi';
 * true means 'hi'). Starts loading the wanted one; meanwhile falls back to the closest loaded.
 */
export function countries(wv, want = 'lo') {
  const lod = want === true ? 'hi' : want === false ? 'lo' : want;
  const has = (l) => C[`${wv}-${l}`];
  if (!has(lod)) loadCountries(wv, lod).catch(() => {});
  if (lod !== 'lo' && !has('lo')) loadCountries(wv, 'lo').catch(() => {});
  const order = { lo: ['lo', 'mid', 'hi'], mid: ['mid', 'lo', 'hi'], hi: ['hi', 'mid', 'lo'] }[lod] || ['lo'];
  for (const l of order) if (has(l)) return has(l);
  return null;
}

export function loadAdmin1(a3) {
  if (!a3) return Promise.reject(new Error('no country code'));
  if (A1[a3]) return Promise.resolve(A1[a3]);
  return once('admin1:' + a3, async () => {
    const topo = await getJSON(`${BASE}admin1/${a3}.json`);
    const obj = topo.objects.admin1;
    const features = fixWinding(topojson.feature(topo, obj).features);
    A1[a3] = { features, byId: new Map(features.map((f) => [f.properties.id, f])), inner: topojson.mesh(topo, obj, (a, b) => a !== b) };
    onLoaded('admin1');
    return A1[a3];
  });
}
export const admin1 = (a3) => A1[a3] || null;
export const admin1Loading = (a3) => { if (a3 && !A1[a3]) loadAdmin1(a3).catch(() => {}); };
export async function admin1Index() { return (A1INDEX ||= await getJSON(`${BASE}admin1/index.json`)); }

/** Districts and finer units from geoBoundaries (CC BY / ODbL per country; credited in exports). */
export function loadGB(iso3, level = 'ADM2') {
  const k = `${iso3}-${level}`;
  if (GB[k]) return Promise.resolve(GB[k]);
  return once('gb:' + k, async () => {
    const meta = await getJSON(`https://www.geoboundaries.org/api/current/gbOpen/${iso3}/${level}/`);
    const gj = await getJSON(meta.simplifiedGeometryGeoJSON || meta.gjDownloadURL);
    const features = fixWinding(gj.features).map((f, i) => ({ ...f, properties: { id: f.properties.shapeID || `${k}-${i}`, name: f.properties.shapeName || '', ar: f.properties.shapeName || '' } }));
    GB[k] = { features, byId: new Map(features.map((f) => [f.properties.id, f])), license: meta.boundaryLicense, source: meta.boundarySource, inner: null };
    onLoaded('gb');
    return GB[k];
  });
}
export const gb = (iso3, level = 'ADM2') => GB[`${iso3}-${level}`] || null;

export async function loadBasics() {
  [PLACES, MARINE, REGIONS] = await Promise.all([getJSON(BASE + 'places.json'), getJSON(BASE + 'marine.json'), getJSON(BASE + 'regions.json')]);
  buildIndexPoints();
  onLoaded('basics');
}
export const places = () => PLACES || [];
export const marine = () => MARINE || [];
export const regions = () => REGIONS || [];

export function rivers() {
  if (!RIVERS) once('rivers', () => getJSON(BASE + 'rivers.json').then((t) => { RIVERS = topojson.feature(t, t.objects.rivers).features; onLoaded('rivers'); })).catch(() => {});
  return RIVERS || [];
}
export function lakes() {
  if (!LAKES) once('lakes', () => getJSON(BASE + 'lakes.json').then((t) => { LAKES = fixWinding(topojson.feature(t, t.objects.lakes).features); onLoaded('lakes'); })).catch(() => {});
  return LAKES || [];
}

/** Which feature a region element points at. */
export function regionFeature(el, wv, lod) {
  if (el.kind === 'country') return countries(wv, lod)?.byId.get(el.a3) || null;
  if (el.kind === 'admin1') { const a = admin1(el.a3); if (!a) admin1Loading(el.a3); return a?.byId.get(el.rid) || null; }
  if (el.kind === 'gb') { const g = gb(el.a3, el.level || 'ADM2'); if (!g) loadGB(el.a3, el.level || 'ADM2').catch(() => {}); return g?.byId.get(el.rid) || null; }
  return null;
}

/* ---------- search: countries, cities, seas, regions, then OpenStreetMap ---------- */

const INDEX = [];
const KINDS = { country: 'دولة', capital: 'عاصمة', city: 'مدينة', sea: 'بحر', region: 'منطقة', admin1: 'محافظة', osm: 'خريطة العالم' };
export const kindName = (k) => KINDS[k] || k;

function push(item) { item.n = normAr(item.ar) + ' | ' + normAr(item.en); INDEX.push(item); }
let countriesIndexed = false;
function buildIndexCountries(c) {
  if (countriesIndexed) return;
  countriesIndexed = true;
  for (const f of c.features) {
    const p = f.properties;
    if (!p.id || p.id === '-99') continue;
    push({ kind: 'country', ar: p.ar, en: p.name, a3: p.id, lon: p.lx, lat: p.ly, bounds: geoBounds(f), rank: p.rank ?? 3 });
  }
}
let pointsIndexed = false;
function buildIndexPoints() {
  if (pointsIndexed) return;
  pointsIndexed = true;
  for (const [ar, en, lon, lat, rank, cls, a3] of PLACES) push({ kind: cls === 0 ? 'capital' : 'city', ar, en, lon, lat, a3, rank: rank + (cls === 0 ? 0 : 2) });
  for (const [ar, en, lon, lat, rank] of MARINE) push({ kind: 'sea', ar, en, lon, lat, rank: rank + 1 });
  for (const [ar, en, lon, lat, rank] of REGIONS) push({ kind: 'region', ar, en, lon, lat, rank: rank + 3 });
}

const SYNONYMS = { 'الخليج': 'الخليج العربي', 'الخليج الفارسي': 'الخليج العربي', 'امريكا': 'الولايات المتحده', 'اميركا': 'الولايات المتحده', 'بريطانيا': 'المملكه المتحده', 'غزه': 'فلسطين', 'الضفه': 'فلسطين', 'إسرائيل': 'فلسطين', 'israel': 'palestine' };
// Keyed the way queries are normalized ("الخليج" → "خليج", "إسرائيل" → "اسراييل").
const SYN = new Map(Object.entries(SYNONYMS).map(([k, v]) => [normAr(k), v]));

export function search(q, limit = 12) {
  let nq = normAr(q);
  if (!nq) return [];
  nq = normAr(SYN.get(nq) || nq) || nq;
  const out = [];
  for (const it of INDEX) {
    const i = it.n.indexOf(nq);
    if (i < 0) continue;
    const starts = i === 0 || it.n[i - 1] === ' ' || it.n.slice(0, i).endsWith('| ');
    out.push({ it, score: (starts ? 0 : 6) + it.rank + (it.kind === 'country' ? -3 : 0) + (it.n.length - nq.length) * 0.04 });
  }
  out.sort((a, b) => a.score - b.score);
  return out.slice(0, limit).map((o) => o.it);
}

/** Anywhere on Earth, in Arabic, via OpenStreetMap's Nominatim (1 request at a time, on Enter). */
export async function searchRemote(q) {
  const u = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&accept-language=ar&q=${encodeURIComponent(q)}`;
  const r = await fetch(u, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('nominatim ' + r.status);
  const j = await r.json();
  return j.map((x) => {
    const [s, n, w, e] = (x.boundingbox || []).map(Number);
    const pse = (s) => String(s || '').replace(/الأراضي الفلسطينية|إسرائيل|ישראל/g, 'فلسطين');
    return { kind: 'osm', ar: pse(x.name || x.display_name.split('،')[0].split(',')[0]), en: pse(x.display_name), lon: +x.lon, lat: +x.lat, bounds: x.boundingbox ? [[w, s], [e, n]] : null, sub: x.type };
  });
}
