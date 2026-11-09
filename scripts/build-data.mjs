// Builds the map data the studio ships with, from Natural Earth (public domain).
// Input:  data-src/*.geojson (downloaded from github.com/nvkelso/natural-earth-vector)
// Output: public/data/*  (TopoJSON + compact JSON, Arabic names first)
//
//   node scripts/build-data.mjs
//
import fs from 'node:fs/promises';
import path from 'node:path';
import mapshaper from 'mapshaper';
import * as topojson from 'topojson-client';
import { geoArea } from 'd3';

const SRC = 'data-src';
const OUT = 'public/data';
const WORLDVIEWS = ['default', 'pse', 'sau', 'egy', 'mar', 'tur'];

// Short Arabic names as newsrooms write them (Natural Earth ships the long/official ones).
const AR_SHORT = {
  ARE: 'الإمارات', OMN: 'عُمان', USA: 'الولايات المتحدة', GBR: 'بريطانيا', COG: 'الكونغو',
  COD: 'الكونغو الديمقراطية', CAF: 'أفريقيا الوسطى', IRL: 'أيرلندا', DOM: 'الدومينيكان',
  SDS: 'جنوب السودان', SSD: 'جنوب السودان', ATA: 'أنتاركتيكا', BIH: 'البوسنة', CYN: 'شمال قبرص',
  KOR: 'كوريا الجنوبية', PRK: 'كوريا الشمالية', ZAF: 'جنوب أفريقيا', PNG: 'بابوا غينيا الجديدة',
  FSM: 'ميكرونيزيا', CNM: 'المنطقة العازلة', ESB: 'ديكيليا', PGA: 'جزر سبراتلي',
};

// Natural Earth's rivers have no Arabic names; these are the ones that come up in the news.
const RIVERS_AR = {
  'Nile': 'النيل', 'Euphrates': 'الفرات', 'Tigris': 'دجلة', 'Jordan': 'نهر الأردن', 'Orontes': 'العاصي',
  'Litani': 'الليطاني', 'Shatt al Arab': 'شط العرب', 'Karun': 'كارون', 'Blue Nile': 'النيل الأزرق',
  'White Nile': 'النيل الأبيض', 'Atbara': 'عطبرة', 'Indus': 'السند', 'Ganges': 'الغانج', 'Brahmaputra': 'براهمابوترا',
  'Danube': 'الدانوب', 'Volga': 'الفولغا', 'Dnieper': 'دنيبر', 'Don': 'الدون', 'Rhine': 'الراين',
  'Amu Darya': 'آمو داريا', 'Syr Darya': 'سير داريا', 'Helmand': 'هلمند', 'Kabul': 'نهر كابل', 'Kura': 'الكورا',
  'Aras': 'أراس', 'Niger': 'النيجر', 'Congo': 'الكونغو', 'Zambezi': 'الزامبيزي', 'Senegal': 'السنغال',
  'Chari': 'شاري', 'Benue': 'بنوي', 'Ubangi': 'أوبانغي', 'Limpopo': 'ليمبوبو', 'Orange': 'أورانج',
  'Mississippi': 'المسيسيبي', 'Missouri': 'ميزوري', 'Amazon': 'الأمازون', 'Paraná': 'بارانا', 'Yangtze': 'اليانغتسي',
  'Huang': 'النهر الأصفر', 'Mekong': 'الميكونغ', 'Irrawaddy': 'إيراوادي', 'Ob': 'أوب', 'Yenisey': 'ينيسي',
  'Lena': 'لينا', 'Ural': 'الأورال', 'Dniester': 'دنيستر', 'Vistula': 'فيستولا', 'Elbe': 'الإلبه', 'Loire': 'اللوار',
  'Seine': 'السين', 'Thames': 'التايمز', 'Tagus': 'تاجة', 'Ebro': 'إبرو', 'Po': 'البو', 'Rhône': 'الرون',
  'Sava': 'سافا', 'Juba': 'جوبا', 'Shabeelle': 'شبيلي', 'Awash': 'أواش', 'Sobat': 'السوباط', 'Bahr el Ghazal': 'بحر الغزال',
  'Yarmuk': 'اليرموك', 'Khabur': 'الخابور', 'Great Zab': 'الزاب الكبير', 'Little Zab': 'الزاب الصغير', 'Diyala': 'ديالى',
  'Karkheh': 'الكرخة', 'Moulouya': 'ملوية', 'Sebou': 'سبو', 'Chelif': 'الشلف', 'Medjerda': 'مجردة',
};

// "محافظة حمص" → "حمص": the prefix is noise on a map label.
const ADMIN_PREFIX = /^(محافظة|محافظه|ولاية|منطقة|إقليم|اقليم|مقاطعة|لواء|قضاء|مديرية|إمارة|امارة|جهة|مدينة|بلدية|شعبية|دائرة|المحافظة)\s+/;
const stripAdmin = (s) => (s || '').replace(ADMIN_PREFIX, '').trim();

const read = async (f) => JSON.parse(await fs.readFile(path.join(SRC, f), 'utf8'));
const write = async (f, data) => {
  const p = path.join(OUT, f);
  await fs.mkdir(path.dirname(p), { recursive: true });
  const s = typeof data === 'string' ? data : JSON.stringify(data);
  await fs.writeFile(p, s);
  return (Buffer.byteLength(s) / 1024).toFixed(0) + ' KB';
};
const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

async function topo(name, fc, simplify, extra = '') {
  const cmd = `-i in.json -simplify ${simplify} keep-shapes -clean -o ${name}.json format=topojson quantization=1e5 ${extra}`;
  const out = await mapshaper.applyCommands(cmd, { 'in.json': fc });
  return out[`${name}.json`].toString().replace(/"in"/g, `"${name}"`);
}

/**
 * d3 reads a ring wound the wrong way as "the whole globe except this shape". mapshaper writes outer
 * rings clockwise, which is what d3 wants, and the app trusts that (it skips rewinding when it loads
 * countries, to keep zooming smooth) — so make sure here.
 */
function checkWinding(json, name) {
  const t = JSON.parse(json);
  let bad = 0;
  for (const f of topojson.feature(t, Object.values(t.objects)[0]).features) {
    const g = f.geometry;
    const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
    for (const p of polys) if (geoArea({ type: 'Polygon', coordinates: p }) > 2 * Math.PI) bad++;
  }
  if (bad) throw new Error(`${name}: ${bad} polygons wound the wrong way for d3`);
  return json;
}

/*
 * Editorial rule: the map always shows Palestine, never Israel. Natural Earth draws Israel as a
 * country in every point of view (Palestine's included), so it's folded into Palestine here: one
 * country whose provinces are the West Bank (with East Jerusalem), Gaza and the 1948 districts.
 * The Golan stays Syrian (the de facto view puts it inside Israel), and so does Shebaa.
 */
const fc = (features) => ({ type: 'FeatureCollection', features });
let pseSrc;
const pse = async () => (pseSrc ||= await read('ne_10m_admin_0_countries_pse.geojson'));
const pseCountry = async (id) => (await pse()).features.find((f) => f.properties.ADM0_A3 === id);
// mapshaper writes a GeometryCollection when there are no attributes, a FeatureCollection otherwise.
const geojsonOut = (out) => { const j = JSON.parse(out['out.json'].toString()); return j.features || j.geometries.map((geometry) => ({ type: 'Feature', geometry, properties: {} })); };
const dissolve = async (features) => geojsonOut(await mapshaper.applyCommands('-i in.json -dissolve -o out.json format=geojson', { 'in.json': fc(features) }))[0].geometry;
const clip = async (features, mask) => geojsonOut(await mapshaper.applyCommands('-i in.json -clip mask.json -o out.json format=geojson', { 'in.json': fc(features), 'mask.json': fc([mask]) }));

async function palestineCountry(gj) {
  const [isr, psx] = [await pseCountry('ISR'), await pseCountry('PSX')];
  const swap = new Map([['SYR', await pseCountry('SYR')], ['LBN', await pseCountry('LBN')]]);
  const P = isr.properties, Q = psx.properties;
  const merged = {
    type: 'Feature', geometry: await dissolve([isr, psx]),
    properties: { ...Q, TYPE: 'Sovereign country', LABEL_X: 35.02, LABEL_Y: 31.42, LABELRANK: Math.min(P.LABELRANK, Q.LABELRANK), MIN_LABEL: Math.min(P.MIN_LABEL, Q.MIN_LABEL) },
  };
  gj.features = gj.features
    .filter((f) => f.properties.ADM0_A3 !== 'ISR')
    .map((f) => (f.properties.ADM0_A3 === 'PSX' ? merged : swap.get(f.properties.ADM0_A3) || f));
}

async function palestineProvinces(by) {
  const isr = by.get('ISR') || [], psx = by.get('PSX') || [];
  const country = (await pseCountry('PSX')).geometry;
  const parts = country.type === 'MultiPolygon' ? country.coordinates : [country.coordinates];
  const isGaza = (poly) => poly[0].every(([x]) => x < 34.7);
  const geom = (keep) => { const c = parts.filter(keep); return c.length === 1 ? { type: 'Polygon', coordinates: c[0] } : { type: 'MultiPolygon', coordinates: c }; };
  const wb = psx.find((f) => f.properties.id === 'PS-WBK'), gz = psx.find((f) => f.properties.id === 'PS-GZZ');
  if (!wb || !gz || !isr.length) throw new Error('Palestine provinces: source rows not found');
  by.set('PSX', [
    { ...wb, geometry: geom((p) => !isGaza(p)) },
    { ...gz, geometry: geom(isGaza), properties: { ...gz.properties, ar: 'قطاع غزة' } },
    ...(await clip(isr, await pseCountry('ISR'))),
  ]);
  by.delete('ISR');
  // The Golan joins Quneitra, the Syrian province it belongs to.
  const golan = await clip(isr.filter((f) => f.properties.id === 'IL-Z'), await pseCountry('SYR'));
  const syr = by.get('SYR') || [], qi = syr.findIndex((f) => f.properties.id === 'SY-QU');
  if (!golan.length || qi < 0) throw new Error('Golan: Quneitra not found');
  syr[qi] = { ...syr[qi], geometry: await dissolve([syr[qi], ...golan]) };
}

async function countries() {
  for (const wv of WORLDVIEWS) {
    const file = wv === 'default' ? 'ne_10m_admin_0_countries.geojson' : `ne_10m_admin_0_countries_${wv}.geojson`;
    const gj = await read(file);
    await palestineCountry(gj);
    if (wv === 'pse') {
      // The Palestine–Syria line west of the Golan. OpenStreetMap has none (it puts the Golan inside
      // Israel), so the real map draws this one.
      const two = gj.features.filter((f) => ['PSX', 'SYR'].includes(f.properties.ADM0_A3)).map((f) => ({ ...f, properties: {} }));
      const out = await mapshaper.applyCommands('-i in.json -innerlines -o out.json format=geojson precision=0.0001', { 'in.json': fc(two) });
      console.log('golan line', await write('golan-line.json', fc(geojsonOut(out))));
    }
    gj.features = gj.features.filter((f) => f.properties.ADM0_A3 !== 'ATA' || true).map((f) => {
      const p = f.properties;
      return {
        type: 'Feature', geometry: f.geometry,
        properties: {
          id: p.ADM0_A3, iso2: p.ISO_A2_EH, name: p.NAME, ar: AR_SHORT[p.ADM0_A3] || p.NAME_AR || p.NAME,
          arFull: p.NAME_AR || '', lx: round(p.LABEL_X), ly: round(p.LABEL_Y), rank: p.LABELRANK, minz: p.MIN_LABEL,
          sub: p.SUBREGION, type: p.TYPE,
        },
      };
    });
    // Two levels of detail: "lo" for regional/world views, "hi" when the artboard spans a few countries.
    // Three levels of detail: world/region views, a few countries, and close-ups.
    const lo = checkWinding(await topo('countries', gj, 'interval=6000'), `countries-${wv}-lo`);
    const mid = checkWinding(await topo('countries', gj, 'interval=1500'), `countries-${wv}-mid`);
    const hi = checkWinding(await topo('countries', gj, 'interval=350'), `countries-${wv}-hi`);
    console.log('countries', wv, 'lo', await write(`countries-${wv}-lo.json`, lo), 'mid', await write(`countries-${wv}-mid.json`, mid), 'hi', await write(`countries-${wv}-hi.json`, hi));
  }
}

async function admin1() {
  const gj = await read('ne_10m_admin_1_states_provinces.geojson');
  const by = new Map();
  for (const f of gj.features) {
    const p = f.properties;
    const a3 = p.adm0_a3;
    if (!by.has(a3)) by.set(a3, []);
    by.get(a3).push({
      type: 'Feature', geometry: f.geometry,
      properties: {
        id: p.iso_3166_2 || p.adm1_code, name: p.name || p.name_en || '', ar: stripAdmin(p.name_ar) || p.name || '',
        type: p.type_en || '', lx: round(p.longitude), ly: round(p.latitude),
      },
    });
  }
  await palestineProvinces(by);
  const index = {};
  for (const [a3, features] of by) {
    if (!a3) continue;
    const s = await topo('admin1', { type: 'FeatureCollection', features }, 'interval=400');
    await write(`admin1/${a3}.json`, s);
    index[a3] = features.length;
  }
  console.log('admin1', Object.keys(index).length, 'countries', await write('admin1/index.json', index));
}

async function places() {
  const gj = await read('ne_10m_populated_places.geojson');
  const cls = (c) => (/Admin-0 capital/.test(c) ? 0 : /Admin-1 capital/.test(c) ? 1 : 2);
  const rows = gj.features.map((f) => {
    const p = f.properties;
    // Palestine, not Israel (see palestineCountry): Jerusalem is its capital, Tel Aviv a city.
    const a3 = p.ADM0_A3 === 'ISR' ? 'PSX' : p.ADM0_A3;
    const c = a3 === 'PSX' ? (p.NAME === 'Jerusalem' ? 0 : Math.max(1, cls(p.FEATURECLA))) : cls(p.FEATURECLA);
    return [p.NAME_AR || p.NAME, p.NAME, round(p.LONGITUDE), round(p.LATITUDE), p.SCALERANK, c, a3, p.POP_MAX];
  }).sort((a, b) => a[4] - b[4] || b[7] - a[7]);
  console.log('places', rows.length, await write('places.json', rows));
}

async function rivers() {
  const gj = await read('ne_10m_rivers_lake_centerlines.geojson');
  gj.features = gj.features.map((f) => {
    const p = f.properties;
    const name = p.name || p.name_en || '';
    return { type: 'Feature', geometry: f.geometry, properties: { name, ar: RIVERS_AR[name] || '', rank: p.scalerank } };
  });
  console.log('rivers', await write('rivers.json', await topo('rivers', gj, 'interval=500')));
}

async function lakes() {
  const gj = await read('ne_10m_lakes.geojson');
  gj.features = gj.features.map((f) => {
    const p = f.properties;
    return { type: 'Feature', geometry: f.geometry, properties: { name: p.name || '', ar: p.name_ar || '', rank: p.scalerank } };
  });
  console.log('lakes', await write('lakes.json', await topo('lakes', gj, 'interval=500')));
}

async function labels() {
  // Seas, gulfs, straits: one point inside each polygon.
  const marine = await read('ne_10m_geography_marine_polys.geojson');
  marine.features = marine.features.map((f) => ({ ...f, properties: { name: f.properties.name || '', ar: f.properties.name_ar || '', rank: f.properties.scalerank, cls: f.properties.featurecla } }));
  const out = await mapshaper.applyCommands('-i in.json -points inner -o out.json format=geojson', { 'in.json': marine });
  const pts = JSON.parse(out['out.json'].toString()).features.map((f) => [f.properties.ar || f.properties.name, f.properties.name, round(f.geometry.coordinates[0]), round(f.geometry.coordinates[1]), f.properties.rank, f.properties.cls]);
  const regions = (await read('ne_10m_geography_regions_points.geojson')).features.map((f) => {
    const p = f.properties;
    return [p.name_ar || p.name, p.name, round(f.geometry.coordinates[0]), round(f.geometry.coordinates[1]), p.scalerank, p.featurecla];
  });
  console.log('marine', pts.length, await write('marine.json', pts), 'regions', regions.length, await write('regions.json', regions));
}

const only = process.argv[2];
const steps = { countries, admin1, places, rivers, lakes, labels };
for (const [k, fn] of Object.entries(steps)) if (!only || only === k) await fn();
