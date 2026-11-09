// Editorial rule: the map always shows Palestine, never Israel — on the design map (the data build
// folds Israel into Palestine) and on the real map, whichever source draws it. OpenStreetMap and
// Overture both name Israel and draw the West Bank and Gaza lines as international borders, and both
// put the Golan inside Israel. Here their "Israel" becomes Palestine:
//  · no "إسرائيل" label; one "فلسطين" label, with the West Bank, Gaza and the Golan as regions;
//  · the West Bank / Gaza lines are drawn as province lines inside Palestine;
//  · the Golan is Syrian: the ceasefire line becomes a province line, and the Palestine–Syria line
//    west of it (missing from OpenStreetMap) comes from our data.

const pt = (lon, lat, ar, en, cls) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { name: ar, 'name:ar': ar, 'name:en': en, class: cls } });

/** Our own names for the area, the same on every source. */
export const PSE_LABELS = {
  type: 'FeatureCollection',
  features: [
    pt(35.02, 31.42, 'فلسطين', 'Palestine', 'country'),
    pt(35.27, 31.95, 'الضفة الغربية', 'West Bank', 'state'),
    pt(34.38, 31.43, 'قطاع غزة', 'Gaza Strip', 'state'),
    pt(35.77, 33.0, 'الجولان', 'Golan', 'state'),
  ],
};

export const golanLine = () => import.meta.env.BASE_URL + 'data/golan-line.json';

const box = (w, s, e, n) => ({ type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] });

/**
 * OpenMapTiles: a border line that's inside Palestine (or the Golan ceasefire line).
 * From z5 the lines come from OSM and carry the countries on each side: the Palestinian territories
 * carry no code, so "Israel on one side, nothing on the other" is the 1967 line around the West Bank
 * and Gaza. The Golan ceasefire line is the one Israel claims. Below z5 the lines come from Natural
 * Earth with no codes at all (and no `claimed_by`), so they're found by place instead.
 */
const isr = (a, b) => ['all', ['==', ['get', a], 'ISR'], ['!', ['has', b]]];
const lowZoom = ['all', ['!', ['has', 'adm0_l']], ['!', ['has', 'adm0_r']], ['!', ['has', 'claimed_by']]];
export const OMT_INNER = ['any',
  ['all', ['==', ['get', 'maritime'], 0], ['any', isr('adm0_l', 'adm0_r'), isr('adm0_r', 'adm0_l')]],
  ['==', ['get', 'claimed_by'], 'IL'],
  ['all', lowZoom, ['any', ['within', box(34.2, 31.15, 35.6, 32.6)], ['within', box(35.7, 32.72, 35.93, 33.4)]]],
];
/** OpenMapTiles country labels we replace. */
export const OMT_HIDE_COUNTRY = ['match', ['get', 'iso_a2'], ['IL', 'PS'], true, false];

/**
 * Overture: boundaries carry the ids of the divisions on each side (ids are stable across releases).
 * Overture splits the area into Israel, the West Bank, Gaza, the Latrun no man's land and the Golan.
 */
const OV = {
  IL: '304c055c-1116-4844-8b3f-8a2da41d5c86',
  XW: '9d886720-144d-4802-9ce3-5b7007f0c904',
  XG: 'f7224d14-4120-4e12-8e48-0ba9dc181f39',
  XZ: '5f9327fb-5f13-4aab-9b89-e347a261a8af',
  XH: '9b7d1a58-1050-4d34-91d4-496123b5d8f5',
  SY: '96b69dac-6b0b-4df7-8595-da1cbca21ab9',
};
const has = (id) => ['>=', ['index-of', id, ['coalesce', ['get', 'division_ids'], '']], 0];
const PAL = [OV.IL, OV.XW, OV.XG, OV.XZ];
/** Both sides inside Palestine, or the Golan against the rest of Syria. */
export const OV_INNER = ['any',
  ['>=', ['+', ...PAL.map((id) => ['case', has(id), 1, 0])], 2],
  ['all', has(OV.XH), has(OV.SY)],
];
/** Palestine's and the Golan's outer borders: plain borders, not disputed ones. */
export const OV_OURS = ['any', ...[...PAL, OV.XH].map(has)];
/** Overture "countries" we replace. */
export const OV_HIDE_COUNTRY = ['match', ['get', 'country'], ['IL', 'PS', 'XW', 'XG', 'XZ', 'XH'], true, false];

/** A few names carry a Wikipedia-style ", Israel" suffix ("نحشون،_إسرائيل"): drop it. */
export const pseName = (expr) => ['،_إسرائيل', '، إسرائيل', '،إسرائيل', ',_Israel', ', Israel'].reduce(
  (e, s) => ['let', 't', e, ['let', 'i', ['index-of', s, ['var', 't']], ['case', ['>', ['var', 'i'], 0], ['slice', ['var', 't'], 0, ['var', 'i']], ['var', 't']]]],
  expr,
);
