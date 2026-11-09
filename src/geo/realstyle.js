// The real map: OpenStreetMap vector tiles (OpenFreeMap, no key) drawn like Google Maps —
// countries, then provinces, cities, streets and buildings as you zoom in. Arabic names first.
// Map data © OpenStreetMap contributors · tiles by OpenFreeMap.

import { refSize } from '../presets.js';
import { overtureLayers, OVERTURE_CREDIT } from './overture.js';
import { PSE_LABELS, golanLine, OMT_INNER, OMT_HIDE_COUNTRY, pseName } from './palestine.js';
export const REAL_CREDIT = '© OpenStreetMap contributors · OpenFreeMap';

/** Where the real map's data comes from. Same look and tools either way. */
export const REAL_SOURCES = {
  osm: { name: 'OpenStreetMap', credit: REAL_CREDIT, hint: 'OpenStreetMap عبر OpenFreeMap · يُحدَّث أسبوعيًا' },
  overture: { name: 'Overture Maps', credit: OVERTURE_CREDIT, hint: 'Overture Maps (أمازون، مايكروسوفت، ميتا، TomTom) · يُحدَّث شهريًا' },
};
export const realCredit = (doc) => (REAL_SOURCES[doc.real?.source] || REAL_SOURCES.osm).credit;
const TILES = 'https://tiles.openfreemap.org/planet';
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

export const THEMES = {
  standard: {
    name: 'عادي', bg: '#f3f2ef', urban: '#ebe9e5', industrial: '#e8e5e9', water: '#9fcbf0', waterLabel: '#3f76ad',
    park: '#c6e6bd', wood: '#cbe5bf', grass: '#d8ecce', sand: '#f3ebd2', ice: '#ffffff',
    building: '#e2e0db', buildingLine: '#d3d0c9', road: '#ffffff', roadCase: '#d8d4cc', major: '#ffffff', majorCase: '#cbc6bd',
    motorway: '#fdd981', motorwayCase: '#dfae4b', rail: '#b9b6b0', runway: '#dedbd5',
    border: '#7d7a75', borderCase: '#f3f2ef', admin1: '#a19d96',
    country: '#3d3d3d', state: '#8a867f', city: '#262626', town: '#3d3d3d', suburb: '#7a766f', roadLabel: '#5a5a5a', halo: '#ffffff',
  },
  grey: {
    name: 'رمادي', bg: '#ebebeb', urban: '#e3e3e3', industrial: '#e1e1e1', water: '#c9d8e3', waterLabel: '#7f97aa',
    park: '#e0e4dd', wood: '#e1e4de', grass: '#e4e6e2', sand: '#ececea', ice: '#f4f4f4',
    building: '#dddddd', buildingLine: '#d2d2d2', road: '#ffffff', roadCase: '#dadada', major: '#ffffff', majorCase: '#cecece',
    motorway: '#ffffff', motorwayCase: '#c2c2c2', rail: '#cacaca', runway: '#dddddd',
    border: '#8f8f8f', borderCase: '#ebebeb', admin1: '#b9b9b9',
    country: '#6b6b6b', state: '#9a9a9a', city: '#4a4a4a', town: '#5c5c5c', suburb: '#8d8d8d', roadLabel: '#7d7d7d', halo: '#ebebeb',
  },
  dark: {
    name: 'داكن', bg: '#1c1e22', urban: '#22252a', industrial: '#24272c', water: '#0e1823', waterLabel: '#557591',
    park: '#1f2a22', wood: '#1f2922', grass: '#212924', sand: '#26251f', ice: '#2c2f34',
    building: '#2a2d33', buildingLine: '#33373e', road: '#353941', roadCase: '#202328', major: '#3f444c', majorCase: '#202328',
    motorway: '#4d525b', motorwayCase: '#202328', rail: '#3b3e44', runway: '#2e3137',
    border: '#8a8f97', borderCase: '#1c1e22', admin1: '#4d525a',
    country: '#d7d9dd', state: '#8c9199', city: '#eceef1', town: '#c6c9ce', suburb: '#8c9199', roadLabel: '#a5a9af', halo: '#1c1e22',
  },
  hybrid: {
    name: 'قمر صناعي', satellite: true, bg: '#1c2a1e', urban: null, industrial: null, water: null, waterLabel: '#bfe0ff',
    park: null, wood: null, grass: null, sand: null, ice: null,
    building: null, buildingLine: null, road: 'rgba(255,255,255,0.75)', roadCase: 'rgba(0,0,0,0.25)', major: 'rgba(255,255,255,0.85)', majorCase: 'rgba(0,0,0,0.3)',
    motorway: 'rgba(253,217,129,0.9)', motorwayCase: 'rgba(0,0,0,0.3)', rail: 'rgba(255,255,255,0.4)', runway: 'rgba(255,255,255,0.3)',
    border: '#ffffff', borderCase: 'rgba(0,0,0,0.35)', admin1: 'rgba(255,255,255,0.7)',
    country: '#ffffff', state: '#f1f1f1', city: '#ffffff', town: '#f4f4f4', suburb: '#e6e6e6', roadLabel: '#ffffff', halo: 'rgba(0,0,0,0.75)',
  },

  // Apple Maps' colors, measured from maps.apple.com (light, dark and hybrid). Like Apple, the open
  // land changes tone as you zoom into a city (`bgCity`): warm beige → near white in light mode,
  // olive → slate blue in dark mode.
  apple: {
    name: 'أبل فاتح', group: 'apple', bg: '#f5edd6', bgCity: '#f5f1ea', urban: '#f6f4eb', industrial: '#eeebe6', water: '#8ddbf6', waterLabel: '#4f96ba',
    park: '#cdebb0', wood: '#c6e3a3', grass: '#dcedbc', sand: '#f5f3e4', ice: '#ffffff',
    building: '#eceae5', buildingLine: '#dad7d0', road: '#ffffff', roadCase: '#dddbd5', major: '#dde1e8', majorCase: '#bfc3cb',
    motorway: '#b6c5de', motorwayCase: '#97a9c8', rail: '#c5c5cb', runway: '#e3e0ee',
    border: '#d49cbc', borderCase: '#efdcdc', admin1: '#e0b9cd',
    country: '#7b345e', state: '#9b5f84', city: '#1c1c1c', town: '#3d3f3f', suburb: '#6b7070', roadLabel: '#5c6161', halo: '#ffffff',
  },
  appleDark: {
    name: 'أبل داكن', group: 'apple', bg: '#747660', bgCity: '#314256', urban: '#2f3d52', industrial: '#3a4259', water: '#1f3580', waterLabel: '#5d88c8',
    park: '#316756', wood: '#1f6a5f', grass: '#3a7260', sand: '#666b59', ice: '#a7b1bd',
    building: '#46566f', buildingLine: '#56667f', road: '#56657a', roadCase: '#2b3849', major: '#7d8fa8', majorCase: '#2b3849',
    motorway: '#a9b9d6', motorwayCase: '#3a4a63', rail: '#5a6880', runway: '#4a4f6a',
    border: '#a07892', borderCase: '#2a3444', admin1: '#8a6c80',
    country: '#bb98ad', state: '#a88a9c', city: '#dae4ed', town: '#c7d5e7', suburb: '#9fb0c6', roadLabel: '#aab8cc', halo: '#2a3444',
  },
  appleHybrid: {
    name: 'أبل قمر صناعي', group: 'apple', satellite: true, bg: '#1c2a1e', urban: null, industrial: null, water: null, waterLabel: '#a9deea',
    park: null, wood: null, grass: null, sand: null, ice: null,
    building: null, buildingLine: null, road: 'rgba(255,255,255,0.45)', roadCase: 'rgba(0,0,0,0.15)', major: 'rgba(255,255,255,0.6)', majorCase: 'rgba(0,0,0,0.2)',
    motorway: 'rgba(255,255,255,0.75)', motorwayCase: 'rgba(0,0,0,0.25)', rail: 'rgba(255,255,255,0.35)', runway: 'rgba(255,255,255,0.3)',
    border: '#5a2a50', borderCase: 'rgba(255,255,255,0.18)', admin1: 'rgba(90,42,80,0.75)',
    country: '#ffffff', state: '#f0e6ee', city: '#ffffff', town: '#f6f6f6', suburb: '#ececec', roadLabel: '#ffffff', halo: 'rgba(0,0,0,0.6)',
  },
};

// What the designer can recolor, and which palette keys follow each choice.
export const REAL_COLORS = [
  { key: 'land', label: 'اليابسة', keys: ['bg'] },
  { key: 'water', label: 'الماء', keys: ['water'] },
  { key: 'park', label: 'الحدائق والغابات', keys: ['park', 'wood', 'grass'] },
  { key: 'roads', label: 'الطرق', keys: ['road', 'major'] },
  { key: 'border', label: 'حدود الدول', keys: ['border'] },
  { key: 'admin1', label: 'حدود المحافظات', keys: ['admin1'] },
  { key: 'labels', label: 'الأسماء', keys: ['country', 'city', 'town'] },
];

export const REAL_DEFAULTS = {
  source: 'osm', theme: 'standard', colors: {}, labels: true, roads: true, roadLabels: true, buildings: true, admin1: true,
  water: true, landcover: true, borders: 'osm', textScale: 1, lang: null, borderScale: 1,
};

/**
 * Map pixels per artboard pixel: newsroom artboards get bigger type and lines than a phone map.
 * With the post frame off, it follows the chosen post size (not the window), so city names keep
 * one size whether the frame is on or off and however big the window is.
 */
export const mapScale = (doc) => {
  const a = doc.artboard, r = a.free ? refSize(a) : a;
  return Math.max(0.6, (Math.min(r.w, r.h) / 640) * (doc.real?.textScale || 1));
};

export function palette(real) {
  const p = { ...(THEMES[real.theme] || THEMES.standard) };
  for (const c of REAL_COLORS) {
    const v = real.colors?.[c.key];
    if (v) for (const k of c.keys) p[k] = v;
  }
  if (real.colors?.land) { p.urban = mix(p.bg, '#000000', 0.035); p.borderCase = p.bg; delete p.bgCity; }
  // The open land's paint: one color, or (Apple themes) a shift toward `bgCity` as you zoom into a city.
  p.land = p.bgCity ? ['interpolate', ['linear'], ['zoom'], 9.5, p.bg, 11.5, p.bgCity] : p.bg;
  return p;
}

/** A paint color at a zoom: plain colors as they are, a zoom `interpolate` between hex colors resolved. */
export function colorAtZoom(v, zoom) {
  if (!Array.isArray(v) || v[0] !== 'interpolate') return v;
  const s = v.slice(3);
  if (zoom <= s[0]) return s[1];
  for (let i = 2; i < s.length; i += 2) {
    if (zoom <= s[i]) return mix(s[i - 1], s[i + 1], (zoom - s[i - 2]) / (s[i] - s[i - 2]));
  }
  return s[s.length - 1];
}

function mix(a, b, t) {
  const h = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
  if (!/^#[0-9a-f]{6}$/i.test(a)) return a;
  const A = h(a), B = h(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

const z = (...stops) => ['interpolate', ['exponential', 1.5], ['zoom'], ...stops];
const lin = (...stops) => ['interpolate', ['linear'], ['zoom'], ...stops];
const cls = (...c) => ['match', ['get', 'class'], c, true, false];
const nameExpr = (lang) => lang === 'en'
  ? ['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name']]
  : ['coalesce', ['get', 'name:ar'], ['get', 'name']];

/**
 * Shaded countries/provinces live inside the map, under its names (like Google Maps):
 * `regions` is a FeatureCollection with fill/opacity/stroke/hatch properties per feature.
 */
export const EMPTY_FC = { type: 'FeatureCollection', features: [] };
export const hatchId = (color, gap, angle, width) => `hatch|${color}|${gap}|${angle}|${width}`;

/**
 * A seamless hatch tile for map.addImage (MapLibre asks for it by name when a layer needs it).
 * Angles snap to 0/45/90/135° so the tile repeats without seams. Returns {image, pixelRatio}.
 */
export function hatchImage(id, ratio = 2) {
  const [, color, gap, angle, width] = id.split('|');
  const g = Math.max(2, +gap);
  const a = (((Math.round(+angle / 45) * 45) % 180) + 180) % 180;
  const T = a === 45 || a === 135 ? g * Math.SQRT2 : g;
  const size = Math.max(4, Math.round(T * ratio));
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  x.scale(size / T, size / T);
  x.strokeStyle = color; x.lineWidth = +width; x.lineCap = 'butt';
  const seg = (x0, y0, x1, y1) => { x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke(); };
  if (a === 0) seg(T / 2, -1, T / 2, T + 1);
  else if (a === 90) seg(-1, T / 2, T + 1, T / 2);
  else if (a === 45) { seg(-1, T + 1, T + 1, -1); seg(-1, 1, 1, -1); seg(T - 1, T + 1, T + 1, T - 1); }
  else { seg(-1, -1, T + 1, T + 1); seg(T - 1, -1, T + 1, 1); seg(-1, T - 1, 1, T + 1); }
  const img = x.getImageData(0, 0, size, size);
  return { image: { width: size, height: size, data: new Uint8Array(img.data.buffer) }, pixelRatio: size / T };
}

/** The full MapLibre style for a document. */
export function buildStyle(doc, { regions = EMPTY_FC, inner = EMPTY_FC } = {}) {
  const real = { ...REAL_DEFAULTS, ...(doc.real || {}) };
  const p = palette(real);
  const name = pseName(nameExpr(doc.lang));
  const R = 'Noto Sans Regular', B = 'Noto Sans Bold';
  const L = [];
  const add = (l) => L.push(l);
  const vis = (on) => ({ visibility: on ? 'visible' : 'none' });
  // Overture draws land on the sea; the OpenStreetMap tiles draw the sea on land.
  const OV = real.source === 'overture' ? overtureLayers(p, real, doc.lang) : null;

  add({ id: 'background', type: 'background', paint: { 'background-color': OV && !p.satellite ? p.water || p.bg : p.land } });
  if (p.satellite) add({ id: 'satellite', type: 'raster', source: 'satellite', paint: { 'raster-fade-duration': 0 } });

  if (OV) OV.base.forEach(add);
  else omtBase();

  /** The OpenStreetMap (OpenMapTiles) land, water, roads and borders. */
  function omtBase() {
    if (!p.satellite) {
      add({ id: 'landcover-ice', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: cls('ice', 'glacier'), layout: vis(real.landcover), paint: { 'fill-color': p.ice } });
      add({ id: 'landcover-sand', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: cls('sand', 'beach'), layout: vis(real.landcover), paint: { 'fill-color': p.sand } });
      add({ id: 'landcover-wood', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: cls('wood', 'forest'), layout: vis(real.landcover), paint: { 'fill-color': p.wood, 'fill-opacity': lin(5, 0.35, 10, 0.85) } });
      add({ id: 'landcover-grass', type: 'fill', source: 'omt', 'source-layer': 'landcover', minzoom: 9, filter: cls('grass', 'meadow', 'wetland'), layout: vis(real.landcover), paint: { 'fill-color': p.grass, 'fill-opacity': lin(9, 0, 11, 0.6) } });
      add({ id: 'landuse-urban', type: 'fill', source: 'omt', 'source-layer': 'landuse', minzoom: 5, filter: cls('residential', 'suburb', 'neighbourhood', 'commercial', 'retail'), paint: { 'fill-color': p.urban, 'fill-opacity': lin(5, 0.5, 9, 1) } });
      add({ id: 'landuse-industrial', type: 'fill', source: 'omt', 'source-layer': 'landuse', minzoom: 11, filter: cls('industrial', 'railway', 'military'), paint: { 'fill-color': p.industrial } });
      add({ id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', layout: vis(real.landcover), paint: { 'fill-color': p.park, 'fill-opacity': lin(4, 0.5, 9, 0.9) } });
      add({ id: 'landuse-park', type: 'fill', source: 'omt', 'source-layer': 'landuse', minzoom: 11, filter: cls('park', 'cemetery', 'stadium', 'pitch', 'playground', 'garden'), layout: vis(real.landcover), paint: { 'fill-color': p.park } });
      add({ id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', filter: ['!=', ['get', 'brunnel'], 'tunnel'], layout: vis(real.water), paint: { 'fill-color': p.water } });
      add({ id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', minzoom: 6, filter: ['!=', ['get', 'brunnel'], 'tunnel'], layout: { ...vis(real.water), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': p.water, 'line-width': (() => { const big = ['match', ['get', 'class'], ['river', 'canal'], true, false]; const s = (a, b) => ['case', big, a, b]; return z(6, s(0.6, 0), 10, s(1.4, 0.2), 12, s(2, 0.4), 14, s(3, 1), 18, s(10, 3)); })() } });
      add({ id: 'aeroway', type: 'line', source: 'omt', 'source-layer': 'aeroway', minzoom: 11, filter: cls('runway', 'taxiway'), paint: { 'line-color': p.runway, 'line-width': z(11, 1, 14, 6, 18, 40) } });
      add({ id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 14.5, layout: vis(real.buildings), paint: { 'fill-color': p.building, 'fill-outline-color': p.buildingLine, 'fill-opacity': lin(14.5, 0, 15.5, 1) } });
    } else {
      add({ id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', minzoom: 10, layout: vis(false), paint: { 'line-color': '#7fb2e0' } });
    }

    // Roads: casings first, then fills, minor to major.
    const ROADS = [
      { id: 'minor', c: ['minor', 'service'], min: 12, w: z(12, 0.5, 14, 2, 16, 6, 18, 14), col: p.road, cas: p.roadCase, casMin: 13.5 },
      { id: 'tertiary', c: ['tertiary'], min: 10, w: z(10, 0.6, 13, 1.6, 16, 7, 18, 16), col: p.road, cas: p.roadCase, casMin: 12 },
      { id: 'secondary', c: ['secondary'], min: 8, w: z(8, 0.6, 12, 1.6, 15, 6, 18, 18), col: p.major, cas: p.majorCase, casMin: 10 },
      { id: 'primary', c: ['primary'], min: 7, w: z(7, 0.6, 11, 1.8, 15, 7, 18, 20), col: p.major, cas: p.majorCase, casMin: 9 },
      { id: 'trunk', c: ['trunk'], min: 5, w: z(5, 0.5, 10, 2, 15, 8, 18, 22), col: p.motorway, cas: p.motorwayCase, casMin: 8 },
      { id: 'motorway', c: ['motorway'], min: 4, w: z(4, 0.5, 10, 2.2, 15, 9, 18, 24), col: p.motorway, cas: p.motorwayCase, casMin: 7 },
    ];
    const roadFilter = (c) => ['all', ['match', ['get', 'class'], c, true, false], ['!=', ['get', 'brunnel'], 'tunnel']];
    for (const r of ROADS) {
      add({ id: `road-${r.id}-case`, type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: r.casMin, filter: roadFilter(r.c), layout: { ...vis(real.roads), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': r.cas, 'line-gap-width': r.w, 'line-width': z(r.casMin, 0.5, 16, 1.5, 18, 2) } });
    }
    add({ id: 'road-path', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 15, filter: cls('path', 'track'), layout: vis(real.roads), paint: { 'line-color': p.roadCase, 'line-width': z(15, 0.8, 18, 2), 'line-dasharray': [2, 1.5] } });
    add({ id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 9, filter: cls('rail', 'transit'), layout: vis(real.roads), paint: { 'line-color': p.rail, 'line-width': z(9, 0.6, 14, 1.4, 18, 3), 'line-dasharray': [3, 2] } });
    for (const r of ROADS) {
      add({ id: `road-${r.id}`, type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: r.min, filter: roadFilter(r.c), layout: { ...vis(real.roads), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': r.col, 'line-width': r.w } });
    }

    // Borders: provinces dashed; countries always on, from the first zoom, with a soft halo.
    const land = ['==', ['get', 'maritime'], 0];
    add({ id: 'boundary-admin2', type: 'line', source: 'omt', 'source-layer': 'boundary', minzoom: 9, filter: ['all', ['match', ['get', 'admin_level'], [5, 6], true, false], land], layout: vis(real.admin1), paint: { 'line-color': p.admin1, 'line-width': z(9, 0.6, 14, 1.2), 'line-dasharray': [1, 2], 'line-opacity': 0.7 } });
    add({ id: 'boundary-admin1', type: 'line', source: 'omt', 'source-layer': 'boundary', minzoom: 3, filter: ['all', ['match', ['get', 'admin_level'], [3, 4], true, false], land], layout: { ...vis(real.admin1), 'line-join': 'round' }, paint: { 'line-color': p.admin1, 'line-width': z(3, 0.5, 7, 1.1, 12, 2), 'line-dasharray': [3, 2] } });
    const country = real.borders !== 'ne';
    const bs = real.borderScale || 1;
    // Palestine, not Israel (see palestine.js): the West Bank / Gaza lines are province lines inside it.
    const nat = ['all', ['==', ['get', 'admin_level'], 2], land, ['!', OMT_INNER]];
    add({ id: 'boundary-admin1-pse', type: 'line', source: 'omt', 'source-layer': 'boundary', minzoom: 3, filter: ['all', ['==', ['get', 'admin_level'], 2], land, OMT_INNER], layout: { ...vis(real.admin1), 'line-join': 'round' }, paint: { 'line-color': p.admin1, 'line-width': z(3, 0.5, 7, 1.1, 12, 2), 'line-dasharray': [3, 2] } });
    add({ id: 'boundary-country-case', type: 'line', source: 'omt', 'source-layer': 'boundary', filter: nat, layout: { ...vis(country), 'line-join': 'round' }, paint: { 'line-color': p.borderCase, 'line-width': z(0, 2 * bs, 5, 3.5 * bs, 10, 6 * bs, 14, 9 * bs), 'line-opacity': 0.6 } });
    add({ id: 'boundary-country', type: 'line', source: 'omt', 'source-layer': 'boundary', filter: ['all', nat, ['!=', ['get', 'disputed'], 1]], layout: { ...vis(country), 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': p.border, 'line-width': z(0, 0.8 * bs, 5, 1.3 * bs, 10, 2.2 * bs, 14, 3.2 * bs) } });
    add({ id: 'boundary-disputed', type: 'line', source: 'omt', 'source-layer': 'boundary', filter: ['all', nat, ['==', ['get', 'disputed'], 1]], layout: { ...vis(country), 'line-join': 'round' }, paint: { 'line-color': p.border, 'line-width': z(0, 0.8 * bs, 5, 1.3 * bs, 10, 2.2 * bs, 14, 3.2 * bs), 'line-dasharray': [2, 1.6] } });
    // The Palestine–Syria line west of the Golan, which OpenStreetMap doesn't have.
    add({ id: 'boundary-country-golan-case', type: 'line', source: 'golan', layout: { ...vis(country), 'line-join': 'round' }, paint: { 'line-color': p.borderCase, 'line-width': z(0, 2 * bs, 5, 3.5 * bs, 10, 6 * bs, 14, 9 * bs), 'line-opacity': 0.6 } });
    add({ id: 'boundary-country-golan', type: 'line', source: 'golan', layout: { ...vis(country), 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': p.border, 'line-width': z(0, 0.8 * bs, 5, 1.3 * bs, 10, 2.2 * bs, 14, 3.2 * bs) } });
  }

  // Shading (from the designer's elements), above roads and borders, under every name.
  add({ id: 'regions-fill', type: 'fill', source: 'regions', paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': ['get', 'opacity'] } });
  add({ id: 'regions-hatch', type: 'fill', source: 'regions', filter: ['has', 'pattern'], paint: { 'fill-pattern': ['get', 'pattern'] } });
  add({ id: 'regions-inner', type: 'line', source: 'regions-inner', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 1.2, 'line-opacity': ['coalesce', ['get', 'opacity'], 1] } });
  add({ id: 'regions-line', type: 'line', source: 'regions', filter: ['>', ['get', 'strokeWidth'], 0], layout: { 'line-join': 'round' }, paint: { 'line-color': ['get', 'stroke'], 'line-width': ['get', 'strokeWidth'] } });

  // Labels
  const halo = { 'text-halo-color': p.halo, 'text-halo-width': 1.4, 'text-halo-blur': 0.2 };
  if (OV) OV.labels.forEach(add);
  else {
    const lab = (o) => add({ ...o, type: 'symbol', source: 'omt', layout: { 'text-field': name, 'text-font': [R], 'text-max-width': 8, ...vis(real.labels), ...o.layout }, paint: { ...halo, ...o.paint } });
    lab({ id: 'label-water-line', 'source-layer': 'water_name', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'symbol-placement': 'line', 'text-size': 13 }, paint: { 'text-color': p.waterLabel } });
    lab({ id: 'label-water', 'source-layer': 'water_name', filter: ['==', ['geometry-type'], 'Point'], layout: { 'text-size': ['match', ['get', 'class'], 'ocean', 16, 'sea', 14, 13] }, paint: { 'text-color': p.waterLabel } });
    lab({ id: 'label-waterway', 'source-layer': 'waterway', minzoom: 12, filter: cls('river', 'canal'), layout: { 'symbol-placement': 'line', 'text-size': 12 }, paint: { 'text-color': p.waterLabel } });
    lab({ id: 'label-road', 'source-layer': 'transportation_name', minzoom: 13, filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'], true, false], layout: { 'symbol-placement': 'line', 'text-size': z(13, 10, 17, 14), ...vis(real.labels && real.roadLabels) }, paint: { 'text-color': p.roadLabel } });
    lab({ id: 'label-suburb', 'source-layer': 'place', minzoom: 12, filter: cls('suburb', 'quarter', 'neighbourhood'), layout: { 'text-size': z(12, 11, 16, 15) }, paint: { 'text-color': p.suburb } });
    lab({ id: 'label-village', 'source-layer': 'place', minzoom: 10, filter: cls('village', 'hamlet'), layout: { 'text-size': z(10, 11, 14, 14, 17, 17) }, paint: { 'text-color': p.town } });
    lab({ id: 'label-town', 'source-layer': 'place', minzoom: 7, filter: cls('town'), layout: { 'text-size': z(7, 11, 12, 15, 16, 19) }, paint: { 'text-color': p.town } });
    lab({ id: 'label-city', 'source-layer': 'place', minzoom: 3, filter: cls('city'), layout: { 'text-size': z(3, 11, 7, 14, 11, 18, 15, 22), 'text-font': [B], 'symbol-sort-key': ['coalesce', ['get', 'rank'], 99] }, paint: { 'text-color': p.city } });
    lab({ id: 'label-state', 'source-layer': 'place', minzoom: 4.5, maxzoom: 10, filter: cls('state', 'province'), layout: { 'text-size': z(4.5, 10, 8, 13) }, paint: { 'text-color': p.state } });
    lab({ id: 'label-country', 'source-layer': 'place', maxzoom: 11, filter: ['all', cls('country'), ['!', OMT_HIDE_COUNTRY]], layout: { 'text-size': z(1, 10, 4, 14, 7, 19), 'text-font': [B] }, paint: { 'text-color': p.country } });
  }

  // Our names for Palestine, the West Bank, Gaza and the Golan, on every source (see palestine.js).
  const pse = ({ cls: c, ...o }) => add({ ...o, type: 'symbol', source: 'pse-labels', filter: ['==', ['get', 'class'], c], layout: { 'text-field': name, 'text-font': [R], 'text-max-width': 8, ...vis(real.labels), ...o.layout }, paint: { ...halo, ...o.paint } });
  pse({ id: 'label-state-pse', cls: 'state', minzoom: 6, maxzoom: 11, layout: { 'text-size': z(6, 11, 9, 14) }, paint: { 'text-color': p.state } });
  pse({ id: 'label-country-pse', cls: 'country', maxzoom: 11, layout: { 'text-size': z(1, 10, 4, 14, 7, 19), 'text-font': [B] }, paint: { 'text-color': p.country } });

  const sources = {
    ...(OV ? OV.sources : { omt: { type: 'vector', url: TILES, attribution: REAL_CREDIT }, golan: { type: 'geojson', data: golanLine() } }),
    'pse-labels': { type: 'geojson', data: PSE_LABELS },
    regions: { type: 'geojson', data: regions },
    'regions-inner': { type: 'geojson', data: inner },
  };
  if (p.satellite) sources.satellite = { type: 'raster', tiles: [SAT], tileSize: 256, maxzoom: 19, attribution: 'Esri, Maxar, Earthstar Geographics' };
  return { version: 8, name: 'aj-real', glyphs: GLYPHS, sources, layers: L };
}
