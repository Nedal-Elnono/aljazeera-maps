// Puts the base map and the elements together: as live DOM groups in the editor,
// or as one standalone, layered SVG for export.
import { makeProjection, pathFor, lodFor } from '../geo/projection.js';
import * as D from '../geo/data.js';
import { renderBase, renderLabels, culledMesh, viewBox } from './base.js';
import { renderElement, regionEdges } from './elements.js';
import { LAYOUT_TYPES } from '../store.js';
import { palette, REAL_DEFAULTS, realCredit } from '../geo/realstyle.js';
import { esc } from '../util.js';

export function makeContext(doc, { editing = false, ext = null } = {}) {
  const { w: W, h: H } = doc.artboard;
  const proj = makeProjection(doc.view, W, H, { box: ext });
  const lod = lodFor(doc.view, W);
  const hi = lod !== 'lo';
  return {
    doc, W, H, proj, path: pathFor(proj), hi, lod,
    countries: D.countries(doc.worldview, lod),
    font: doc.font, editing, ext,
    defs: [], credits: new Set(), boxes: new Map(), hiddenLabels: [],
  };
}

export const STATIC_DEFS = `
<filter id="f-gray" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="linear" slope="1.08" intercept="-0.03"/><feFuncG type="linear" slope="1.08" intercept="-0.03"/><feFuncB type="linear" slope="1.08" intercept="-0.03"/></feComponentTransfer></filter>
<filter id="f-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6"/></filter>
<filter id="f-blur"><feGaussianBlur stdDeviation="8"/></filter>
<filter id="f-shadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="10" stdDeviation="18" flood-color="#000" flood-opacity=".22"/></filter>
<filter id="f-landshadow" x="-5%" y="-5%" width="110%" height="110%"><feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000" flood-opacity=".35"/></filter>
<filter id="f-grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  0 0 0 .55 0"/></filter>
<radialGradient id="g-vignette" cx="50%" cy="48%" r="72%"><stop offset="55%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="1"/></radialGradient>`;

export const isReal = (doc) => doc.base === 'real';

/** A Natural Earth stand-in in the real map's colors, for thumbnails where the live map isn't around. */
export function previewDoc(doc) {
  const p = palette({ ...REAL_DEFAULTS, ...(doc.real || {}) });
  const water = p.water || '#3d5a6b';
  return {
    ...doc, base: 'design',
    style: { ...doc.style, sea: water, land: p.bg, border: p.border, borderWidth: 1.4, coast: 'none', label: p.country, seaLabel: p.waterLabel, river: water, lake: water, city: p.city, cities: true, cityRank: 2, satellite: !!p.satellite, satGray: false },
  };
}

function finish(ctx) {
  const { W, H, doc } = ctx;
  let s = '';
  if (doc.style.vignette > 0) s += `<rect width="${W}" height="${H}" fill="url(#g-vignette)" opacity="${doc.style.vignette}"/>`;
  if (doc.style.texture === 'grain') s += `<rect width="${W}" height="${H}" filter="url(#f-grain)" opacity=".5"/>`;
  return s;
}

/**
 * What we draw ourselves over the real map: editorial country borders (if chosen) and the finish.
 * `margin` draws the borders that much (× the stage) past every edge, so the editor can slide them
 * along with a moving map and only redraw when it stops.
 */
export function realBase(ctx, { margin = 0 } = {}) {
  const { doc, W, H } = ctx;
  const out = { sea: '', sat: '', land: '', lakes: '', rivers: '', graticule: '', admin1: '', detail: '', labels: '', borders: '', finish: finish(ctx) };
  if (doc.real?.borders === 'ne' && ctx.countries) {
    const e = ctx.ext;
    const box = margin && e ? { x0: e.x0 - (e.x1 - e.x0) * margin, y0: e.y0 - (e.y1 - e.y0) * margin, x1: e.x1 + (e.x1 - e.x0) * margin, y1: e.y1 + (e.y1 - e.y0) * margin } : e;
    const proj = box === e ? ctx.proj : makeProjection(doc.view, W, H, { box });
    // Only the lines near the view: projecting every border on Earth is most of the cost.
    const d = pathFor(proj)(culledMesh(ctx.countries.borders, viewBox({ proj, ext: box, W, H }))) || '';
    const p = palette({ ...REAL_DEFAULTS, ...doc.real });
    const w = Math.max(1.4, Math.min(W, H) / 560);
    const sw = (v) => `stroke-width="${v.toFixed(2)}"${margin ? ` data-w="${v.toFixed(2)}"` : ''}`; // data-w: the width to keep while sliding
    out.borders = `<path d="${d}" fill="none" stroke="${p.borderCase}" stroke-opacity=".6" ${sw(w * 2.6)} stroke-linejoin="round"/>` +
      `<path d="${d}" fill="none" stroke="${p.border}" ${sw(w)} stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  ctx.credits.add(realCredit(doc));
  return out;
}

/** All the layer strings for a document. */
export function renderAll(doc, ctx = makeContext(doc)) {
  let base;
  if (isReal(doc)) base = realBase(ctx);
  else { ctx.skipLabels = true; base = renderBase(ctx); ctx.skipLabels = false; }
  let regions = '', geo = '', layout = '';
  for (const el of doc.elements) {
    if (el.type === 'region') regions += renderElement(el, ctx);
    else if (LAYOUT_TYPES.has(el.type)) layout += renderElement(el, ctx);
    else geo += renderElement(el, ctx);
  }
  regions += regionEdges(ctx);
  // Labels last: they step aside for text boxes and legends.
  if (!isReal(doc)) base.labels = renderLabels(ctx);
  return { ctx, base, regions, geo, layout };
}

/**
 * One standalone SVG, layers named for Illustrator / Figma.
 * Real-map documents take their map layer as `realBase` (vector SVG from the tiles);
 * `overlayOnly` leaves the map out (to draw over a map image).
 */
export function composeSVG(doc, { transparent = false, credits = true, fontCSS = '', elementsOnly = false, realBase = null, overlayOnly = false } = {}) {
  if (isReal(doc) && realBase == null && !overlayOnly && !elementsOnly) return composeSVG(previewDoc(doc), { transparent, credits, fontCSS });
  const ctx = makeContext(doc);
  ctx.mapDrawsRegions = isReal(doc) && !elementsOnly; // the real map already has them under its names
  const { base, regions, geo, layout } = renderAll(doc, ctx);
  const { W, H } = ctx;
  const BASE_IDS = new Set(['Map', 'Sea', 'Satellite', 'Land', 'Lakes', 'Rivers', 'Graticule', 'Provinces', 'Borders', 'Detail_OSM', 'Labels_Map', 'Finish', 'Credits']);
  const g = (id, s) => (s && !(elementsOnly && BASE_IDS.has(id)) ? `<g id="${id}">${s}</g>` : '');
  const creditColor = isReal(doc) ? palette({ ...REAL_DEFAULTS, ...doc.real }).country : doc.style.label;
  const credit = credits && ctx.credits.size
    ? `<text x="${W - 16}" y="${H - 14}" direction="rtl" text-anchor="start" font-family="${esc(ctx.font)}, sans-serif" font-size="${Math.max(11, Math.round(W / 110))}" fill="${creditColor}" opacity=".7">${esc([...ctx.credits].join(' · '))}</text>` : '';
  const head = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<title>${esc(doc.name)}</title>
<defs>${fontCSS ? `<style>${fontCSS}</style>` : ''}${STATIC_DEFS}${ctx.defs.join('')}</defs>`;
  if (isReal(doc)) {
    return `${head}
${overlayOnly || transparent ? '' : g('Map', realBase)}
${g('Borders', base.borders)}
${g('Shading', regions)}
${g('Elements', geo)}
${transparent ? '' : g('Finish', base.finish)}
${g('Layout', layout)}
${g('Credits', credit)}
</svg>`;
  }
  return `${head}
${transparent ? '' : g('Sea', base.sea)}
${g('Satellite', base.sat)}
${transparent ? '' : g('Land', base.land)}
${g('Lakes', base.lakes)}
${g('Rivers', base.rivers)}
${g('Graticule', base.graticule)}
${g('Provinces', base.admin1)}
${g('Borders', base.borders)}
${g('Detail_OSM', base.detail)}
${g('Shading', regions)}
${g('Labels_Map', base.labels)}
${g('Elements', geo)}
${transparent ? '' : g('Finish', base.finish)}
${g('Layout', layout)}
${g('Credits', credit)}
</svg>`;
}
