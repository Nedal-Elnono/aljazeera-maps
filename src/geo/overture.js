// The real map from Overture Maps (Linux Foundation; Amazon, Microsoft, Meta, TomTom and others):
// its monthly release, read straight from Overture's public PMTiles archives, drawn in the same
// themes, colors and layer names as the OpenStreetMap style — so picking, shading and SVG export
// work the same. Names are Arabic first (Overture keeps every language in one JSON string, `names`).
//
// Overture keeps only the last couple of releases online, so the newest one is looked up once per
// session (and remembered); the fallback below is just where to start.
// Data: © OpenStreetMap contributors (ODbL), Overture Maps Foundation (CDLA Permissive 2.0 / ODbL).

import { OV_INNER, OV_OURS, OV_HIDE_COUNTRY, pseName } from './palestine.js';

export const OVERTURE_CREDIT = '© OpenStreetMap contributors · Overture Maps Foundation';
const BUCKET = 'https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com';
const FALLBACK_RELEASE = '2026-10-21.0';
const KEY = 'aj.overture.release';

let release = FALLBACK_RELEASE;
try { release = localStorage.getItem(KEY) || FALLBACK_RELEASE; } catch {}
let checked = null;

/** The release the map is drawn from, e.g. "2026-10-21.0". */
export const overtureRelease = () => release;

/** Finds the newest release online (once per session). Resolves true when it changed. */
export function refreshOvertureRelease() {
  checked ||= fetch(`${BUCKET}/?list-type=2&prefix=tiles/&delimiter=/`)
    .then((r) => (r.ok ? r.text() : ''))
    .then((xml) => {
      const all = [...xml.matchAll(/<Prefix>tiles\/(\d{4}-\d{2}-\d{2}\.\d+)\/<\/Prefix>/g)].map((m) => m[1]);
      all.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
      const latest = all.at(-1);
      if (!latest || latest === release) return false;
      release = latest;
      try { localStorage.setItem(KEY, latest); } catch {}
      return true;
    })
    .catch(() => false);
  return checked;
}

const url = (theme) => `pmtiles://${BUCKET}/tiles/${release}/${theme}.pmtiles`;

/* ---------- style helpers (same curves as the OpenStreetMap style) ---------- */

const z = (...stops) => ['interpolate', ['exponential', 1.5], ['zoom'], ...stops];
const lin = (...stops) => ['interpolate', ['linear'], ['zoom'], ...stops];
const vis = (on) => ({ visibility: on ? 'visible' : 'none' });
const isIn = (key, ...vals) => ['match', ['get', key], vals, true, false];
const has = (key, needle) => ['>=', ['index-of', needle, ['coalesce', ['get', key], '']], 0];
const poly = ['==', ['geometry-type'], 'Polygon'];
const line = ['==', ['geometry-type'], 'LineString'];

/** One language out of Overture's `names` JSON ("…"common":{"ar":"مصر",…}…"), as a style expression. */
const pick = (lang) => {
  const k = `"${lang}":"`;
  return ['let', 's', ['coalesce', ['get', 'names'], ''],
    ['let', 'i', ['index-of', k, ['var', 's']],
      ['case', ['>=', ['var', 'i'], 0],
        ['let', 'b', ['+', ['var', 'i'], k.length],
          ['slice', ['var', 's'], ['var', 'b'], ['index-of', '"', ['var', 's'], ['var', 'b']]]],
        '']]];
};
/** Arabic (or English) name, else the local name. */
export const overtureName = (lang) => ['let', 'n', pick(lang === 'en' ? 'en' : 'ar'),
  ['case', ['!=', ['var', 'n'], ''], ['var', 'n'], ['coalesce', ['get', '@name'], '']]];

/**
 * The Overture layers for a palette: `base` goes under the shading, `labels` above it.
 * Ids match the OpenStreetMap style (road-*, boundary-*, label-*, water…), which picking relies on.
 */
export function overtureLayers(p, real, lang) {
  const base = [], labels = [];
  const add = (l) => base.push(l);
  const name = pseName(overtureName(lang));
  const R = 'Noto Sans Regular', B = 'Noto Sans Bold';
  const fill = (id, src, layer, filter, color, extra = {}) => { if (color) add({ id, type: 'fill', source: src, 'source-layer': layer, filter, ...extra, paint: { 'fill-color': color, ...(extra.paint || {}) } }); };

  if (!p.satellite) {
    // The sea is the background; land is drawn on it (Overture's land comes from the coastline).
    fill('landmass', 'ov-base', 'land', poly, p.land || p.bg);
    // Land cover (from ESA WorldCover at small scales): soft, the way Google tints the land.
    fill('landcover-sand', 'ov-base', 'land_cover', isIn('subtype', 'barren'), p.sand, { layout: vis(real.landcover), paint: { 'fill-opacity': lin(3, 0.35, 9, 0.5) } });
    fill('landcover-wood', 'ov-base', 'land_cover', isIn('subtype', 'forest', 'mangrove'), p.wood, { layout: vis(real.landcover), paint: { 'fill-opacity': lin(3, 0.3, 10, 0.75) } });
    fill('landcover-grass', 'ov-base', 'land_cover', isIn('subtype', 'grass', 'shrub', 'wetland', 'moss'), p.grass, { layout: vis(real.landcover), paint: { 'fill-opacity': lin(3, 0.25, 10, 0.5) } });
    fill('landcover-ice', 'ov-base', 'land_cover', isIn('subtype', 'snow'), p.ice, { layout: vis(real.landcover) });
    fill('landuse-urban', 'ov-base', 'land_cover', isIn('subtype', 'urban'), p.urban, { minzoom: 4, paint: { 'fill-opacity': lin(4, 0.45, 9, 0.9) } });
    fill('landuse-residential', 'ov-base', 'land_use', ['all', poly, isIn('subtype', 'residential', 'developed')], p.urban, { minzoom: 10 });
    fill('landuse-industrial', 'ov-base', 'land_use', ['all', poly, isIn('subtype', 'military', 'resource_extraction', 'construction', 'transportation')], p.industrial, { minzoom: 11 });
    fill('landuse-park', 'ov-base', 'land_use', ['all', poly, isIn('subtype', 'park', 'recreation', 'golf', 'cemetery', 'grass', 'horticulture')], p.park, { minzoom: 9, layout: vis(real.landcover) });
    fill('park', 'ov-base', 'land_use', ['all', poly, isIn('subtype', 'protected')], p.park, { minzoom: 8, layout: vis(real.landcover), paint: { 'fill-opacity': lin(8, 0.35, 12, 0.7) } });
    fill('landcover-forest', 'ov-base', 'land', ['all', poly, isIn('subtype', 'forest', 'tree')], p.wood, { minzoom: 9, layout: vis(real.landcover), paint: { 'fill-opacity': 0.8 } });
    fill('landcover-sand-osm', 'ov-base', 'land', ['all', poly, isIn('subtype', 'sand')], p.sand, { minzoom: 9, layout: vis(real.landcover) });
    fill('water', 'ov-base', 'water', ['all', poly, ['!', isIn('subtype', 'human_made')]], p.water, { layout: vis(real.water) });
    fill('water-pools', 'ov-base', 'water', ['all', poly, isIn('subtype', 'human_made')], p.water, { minzoom: 14, layout: vis(real.water) });
    const big = isIn('subtype', 'river', 'canal');
    add({ id: 'waterway', type: 'line', source: 'ov-base', 'source-layer': 'water', minzoom: 6, filter: ['all', line, isIn('subtype', 'river', 'canal', 'stream')], layout: { ...vis(real.water), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': p.water, 'line-width': z(6, ['case', big, 0.6, 0], 10, ['case', big, 1.4, 0.2], 12, ['case', big, 2, 0.4], 14, ['case', big, 3, 1], 18, ['case', big, 10, 3]) } });
    fill('building', 'ov-bld', 'building', poly, p.building, { minzoom: 14.5, layout: vis(real.buildings), paint: { 'fill-outline-color': p.buildingLine, 'fill-opacity': lin(14.5, 0, 15.5, 1) } });
  }

  // Roads. Overture's tiles keep the road type only on major roads below zoom 14; the rest of the
  // street network comes without it, so it's drawn as a light mesh until the detailed zoom.
  const notTunnel = ['all', ['!', has('road_flags', 'is_tunnel')], ['!', has('rail_flags', 'is_tunnel')]];
  const road = (...c) => ['all', ['==', ['get', 'subtype'], 'road'], isIn('class', ...c), notTunnel];
  const ROADS = [
    { id: 'minor', c: ['residential', 'living_street', 'unclassified', 'service'], min: 12, w: z(12, 0.5, 14, 2, 16, 6, 18, 14), col: p.road, cas: p.roadCase, casMin: 13.5 },
    { id: 'tertiary', c: ['tertiary'], min: 10, w: z(10, 0.6, 13, 1.6, 16, 7, 18, 16), col: p.road, cas: p.roadCase, casMin: 12 },
    { id: 'secondary', c: ['secondary'], min: 8, w: z(8, 0.6, 12, 1.6, 15, 6, 18, 18), col: p.major, cas: p.majorCase, casMin: 10 },
    { id: 'primary', c: ['primary'], min: 7, w: z(7, 0.6, 11, 1.8, 15, 7, 18, 20), col: p.major, cas: p.majorCase, casMin: 9 },
    { id: 'trunk', c: ['trunk'], min: 5, w: z(5, 0.5, 10, 2, 15, 8, 18, 22), col: p.motorway, cas: p.motorwayCase, casMin: 8 },
    { id: 'motorway', c: ['motorway'], min: 4, w: z(4, 0.5, 10, 2.2, 15, 9, 18, 24), col: p.motorway, cas: p.motorwayCase, casMin: 7 },
  ];
  add({ id: 'road-network', type: 'line', source: 'ov-trans', 'source-layer': 'segment', minzoom: 11, maxzoom: 14, filter: ['all', line, ['!', ['has', 'subtype']]], layout: { ...vis(real.roads), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': p.roadCase, 'line-opacity': lin(11, 0.35, 13, 0.8), 'line-width': z(11, 0.3, 13, 0.9) } });
  for (const r of ROADS) add({ id: `road-${r.id}-case`, type: 'line', source: 'ov-trans', 'source-layer': 'segment', minzoom: r.casMin, filter: road(...r.c), layout: { ...vis(real.roads), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': r.cas, 'line-gap-width': r.w, 'line-width': z(r.casMin, 0.5, 16, 1.5, 18, 2) } });
  add({ id: 'road-path', type: 'line', source: 'ov-trans', 'source-layer': 'segment', minzoom: 15, filter: road('footway', 'path', 'cycleway', 'track', 'pedestrian', 'steps', 'bridleway'), layout: vis(real.roads), paint: { 'line-color': p.roadCase, 'line-width': z(15, 0.8, 18, 2), 'line-dasharray': [2, 1.5] } });
  add({ id: 'rail', type: 'line', source: 'ov-trans', 'source-layer': 'segment', minzoom: 9, filter: ['all', ['==', ['get', 'subtype'], 'rail'], notTunnel], layout: vis(real.roads), paint: { 'line-color': p.rail, 'line-width': z(9, 0.6, 14, 1.4, 18, 3), 'line-dasharray': [3, 2] } });
  for (const r of ROADS) add({ id: `road-${r.id}`, type: 'line', source: 'ov-trans', 'source-layer': 'segment', minzoom: r.min, filter: road(...r.c), layout: { ...vis(real.roads), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': r.col, 'line-width': r.w } });

  // Borders: districts and provinces dashed; countries always on, with a soft halo; disputed dashed.
  const onLand = ['==', ['get', 'class'], 'land'];
  const bnd = (...s) => ['all', isIn('subtype', ...s), onLand];
  add({ id: 'boundary-admin2', type: 'line', source: 'ov-div', 'source-layer': 'division_boundary', minzoom: 9, filter: bnd('county'), layout: vis(real.admin1), paint: { 'line-color': p.admin1, 'line-width': z(9, 0.6, 14, 1.2), 'line-dasharray': [1, 2], 'line-opacity': 0.7 } });
  add({ id: 'boundary-admin1', type: 'line', source: 'ov-div', 'source-layer': 'division_boundary', minzoom: 3, filter: bnd('region'), layout: { ...vis(real.admin1), 'line-join': 'round' }, paint: { 'line-color': p.admin1, 'line-width': z(3, 0.5, 7, 1.1, 12, 2), 'line-dasharray': [3, 2] } });
  const country = real.borders !== 'ne';
  const bs = real.borderScale || 1;
  // Palestine, not Israel (see palestine.js): lines inside Palestine, and the Golan's ceasefire line,
  // are province lines; Palestine's and the Golan's outer borders are plain borders.
  const disputed = ['all', ['==', ['get', 'is_disputed'], true], ['!', OV_OURS]];
  const nat = ['all', bnd('country'), ['!', OV_INNER]];
  add({ id: 'boundary-admin1-pse', type: 'line', source: 'ov-div', 'source-layer': 'division_boundary', minzoom: 3, filter: ['all', bnd('country'), OV_INNER], layout: { ...vis(real.admin1), 'line-join': 'round' }, paint: { 'line-color': p.admin1, 'line-width': z(3, 0.5, 7, 1.1, 12, 2), 'line-dasharray': [3, 2] } });
  add({ id: 'boundary-country-case', type: 'line', source: 'ov-div', 'source-layer': 'division_boundary', filter: nat, layout: { ...vis(country), 'line-join': 'round' }, paint: { 'line-color': p.borderCase, 'line-width': z(0, 2 * bs, 5, 3.5 * bs, 10, 6 * bs, 14, 9 * bs), 'line-opacity': 0.6 } });
  add({ id: 'boundary-country', type: 'line', source: 'ov-div', 'source-layer': 'division_boundary', filter: ['all', nat, ['!', disputed]], layout: { ...vis(country), 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': p.border, 'line-width': z(0, 0.8 * bs, 5, 1.3 * bs, 10, 2.2 * bs, 14, 3.2 * bs) } });
  add({ id: 'boundary-disputed', type: 'line', source: 'ov-div', 'source-layer': 'division_boundary', filter: ['all', nat, disputed], layout: { ...vis(country), 'line-join': 'round' }, paint: { 'line-color': p.border, 'line-width': z(0, 0.8 * bs, 5, 1.3 * bs, 10, 2.2 * bs, 14, 3.2 * bs), 'line-dasharray': [2, 1.6] } });

  // Labels
  const halo = { 'text-halo-color': p.halo, 'text-halo-width': 1.4, 'text-halo-blur': 0.2 };
  const lab = (o) => labels.push({ ...o, type: 'symbol', layout: { 'text-field': name, 'text-font': [R], 'text-max-width': 8, ...vis(real.labels), ...o.layout }, paint: { ...halo, ...o.paint } });
  const prom = ['to-number', ['coalesce', ['get', '@prominence'], 0]];
  const division = (sub) => ['==', ['get', 'subtype'], sub];
  const cityTier = (lo, hi) => ['all', division('locality'), ['>=', prom, lo], ['<', prom, hi]];
  const sortKey = ['-', 100, prom];
  lab({ id: 'label-water', source: 'ov-base', 'source-layer': 'water', filter: ['all', poly, ['has', '@name'], isIn('subtype', 'ocean', 'sea', 'bay', 'strait', 'gulf', 'lagoon')], layout: { 'text-size': 14, 'symbol-sort-key': 1 }, paint: { 'text-color': p.waterLabel } });
  lab({ id: 'label-lake', source: 'ov-base', 'source-layer': 'water', minzoom: 8, filter: ['all', poly, ['has', '@name'], isIn('subtype', 'lake', 'reservoir')], layout: { 'text-size': 12 }, paint: { 'text-color': p.waterLabel } });
  lab({ id: 'label-waterway', source: 'ov-base', 'source-layer': 'water', minzoom: 12, filter: ['all', line, ['has', '@name'], isIn('subtype', 'river', 'canal')], layout: { 'symbol-placement': 'line', 'text-size': 12 }, paint: { 'text-color': p.waterLabel } });
  lab({ id: 'label-road', source: 'ov-trans', 'source-layer': 'segment', minzoom: 13, filter: ['all', ['==', ['get', 'subtype'], 'road'], ['has', '@name']], layout: { 'symbol-placement': 'line', 'text-size': z(13, 10, 17, 14), ...vis(real.labels && real.roadLabels) }, paint: { 'text-color': p.roadLabel } });
  lab({ id: 'label-suburb', source: 'ov-div', 'source-layer': 'division', minzoom: 12, filter: isIn('subtype', 'neighborhood', 'macrohood', 'microhood'), layout: { 'text-size': z(12, 11, 16, 15) }, paint: { 'text-color': p.suburb } });
  // Cities by Overture's prominence (Cairo 100, Alexandria 89…): the big ones first, the rest as you zoom in.
  lab({ id: 'label-village', source: 'ov-div', 'source-layer': 'division', minzoom: 11, filter: cityTier(0, 30), layout: { 'text-size': z(11, 11, 14, 14, 17, 17), 'symbol-sort-key': sortKey }, paint: { 'text-color': p.town } });
  lab({ id: 'label-town', source: 'ov-div', 'source-layer': 'division', minzoom: 8, filter: cityTier(30, 55), layout: { 'text-size': z(8, 11, 12, 15, 16, 19), 'symbol-sort-key': sortKey }, paint: { 'text-color': p.town } });
  lab({ id: 'label-city', source: 'ov-div', 'source-layer': 'division', minzoom: 3, filter: cityTier(55, 1000), layout: { 'text-size': z(3, 11, 7, 14, 11, 18, 15, 22), 'text-font': [B], 'symbol-sort-key': sortKey }, paint: { 'text-color': p.city } });
  lab({ id: 'label-state', source: 'ov-div', 'source-layer': 'division', minzoom: 4.5, maxzoom: 10, filter: division('region'), layout: { 'text-size': z(4.5, 10, 8, 13), 'symbol-sort-key': sortKey }, paint: { 'text-color': p.state } });
  lab({ id: 'label-country', source: 'ov-div', 'source-layer': 'division', maxzoom: 11, filter: ['all', isIn('subtype', 'country', 'dependency'), ['!', OV_HIDE_COUNTRY]], layout: { 'text-size': z(1, 10, 4, 14, 7, 19), 'text-font': [B], 'symbol-sort-key': sortKey }, paint: { 'text-color': p.country } });

  const src = (theme) => ({ type: 'vector', url: url(theme), attribution: OVERTURE_CREDIT });
  return { base, labels, sources: { 'ov-base': src('base'), 'ov-trans': src('transportation'), 'ov-div': src('divisions'), 'ov-bld': src('buildings') } };
}
