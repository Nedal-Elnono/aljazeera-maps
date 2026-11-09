// Exporting the real map: an offscreen render at artboard size (any resolution) for PNG,
// and a true vector SVG rebuilt from the features the map actually drew — every style layer
// becomes a named group (water, parks, roads, borders, names…) that stays editable.
import maplibregl from 'maplibre-gl';
import { geoPath } from 'd3';
import { buildStyle, mapScale, colorAtZoom } from '../geo/realstyle.js';
import { camZoom, ensureRTL, addHatchImages } from '../editor/realmap.js';
import { regionsGeo } from '../geo/regions.js';
import { makeProjection } from '../geo/projection.js';
import { tilesFor } from '../geo/tiles.js';
import { fontStack } from '../render/text.js';
import { esc } from '../util.js';

/** Draw the document's real map offscreen and wait until every tile and label is in. */
export async function renderRealMap(doc, scale = 1) {
  ensureRTL();
  const k = mapScale(doc);
  const { w: W, h: H } = doc.artboard;
  const div = document.createElement('div');
  Object.assign(div.style, { position: 'fixed', left: '-30000px', top: '0', width: W / k + 'px', height: H / k + 'px', pointerEvents: 'none', direction: 'ltr' });
  document.body.append(div);
  const map = new maplibregl.Map({
    container: div, style: buildStyle(doc, regionsGeo(doc)), center: doc.view.center, zoom: camZoom(doc),
    interactive: false, attributionControl: false, preserveDrawingBuffer: true, fadeDuration: 0,
    pixelRatio: Math.min(k * scale, 8), renderWorldCopies: true,
  });
  addHatchImages(map);
  await new Promise((res) => {
    const t = setTimeout(res, 40000);
    map.once('idle', () => { clearTimeout(t); res(); });
  });
  return { map, k, dispose: () => { map.remove(); div.remove(); } };
}

/** The map as an image of artboard × scale pixels. */
export async function realMapCanvas(doc, scale = 1) {
  const { map, dispose } = await renderRealMap(doc, scale);
  try {
    const { w, h } = doc.artboard;
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    c.getContext('2d').drawImage(map.getCanvas(), 0, 0, c.width, c.height);
    return c;
  } finally { dispose(); }
}

/* ---------- vector ---------- */

const colorOf = (c) => {
  if (c == null) return null;
  if (typeof c === 'string') return c;
  const s = c.toString?.();
  if (s && s !== '[object Object]') return s;
  if ('r' in c) { const a = c.a || 1; return `rgba(${Math.round((c.r * 255) / a)},${Math.round((c.g * 255) / a)},${Math.round((c.b * 255) / a)},${a})`; }
  return null;
};
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const textOf = (f, lang) => {
  const t = f.layer?.layout?.['text-field'];
  if (t?.sections) return t.sections.map((s) => s.text).join('');
  if (typeof t === 'string' && !t.includes('{')) return t;
  const p = f.properties || {};
  let ov = '';
  try { ov = p.names ? JSON.parse(p.names).common?.[lang === 'en' ? 'en' : 'ar'] || '' : ''; } catch {} // Overture
  return lang === 'en' ? p['name:en'] || p.name_en || ov || p.name || p['@name'] : p['name:ar'] || ov || p.name || p['@name'];
};

/** Midpoint and angle of the part of a line that's on the board. */
function lineAnchor(geom, proj, W, H) {
  const lines = geom.type === 'LineString' ? [geom.coordinates] : geom.type === 'MultiLineString' ? geom.coordinates : [];
  let best = null, bestLen = 0;
  for (const ln of lines) {
    const pts = ln.map((p) => proj(p)).filter((p) => p && p[0] > -20 && p[0] < W + 20 && p[1] > -20 && p[1] < H + 20);
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (len > bestLen) { bestLen = len; best = pts; }
  }
  if (!best || best.length < 2) return null;
  let acc = 0, i = 1;
  for (; i < best.length; i++) { const l = Math.hypot(best[i][0] - best[i - 1][0], best[i][1] - best[i - 1][1]); if (acc + l >= bestLen / 2) break; acc += l; }
  const a = best[i - 1], b = best[Math.min(i, best.length - 1)];
  let ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
  return { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, ang };
}

/** Every visible style layer of the offscreen map → SVG groups in artboard coordinates. */
export function mapLayersSVG(map, doc, k) {
  const { w: W, h: H } = doc.artboard;
  const proj = makeProjection(doc.view, W, H);
  const path = geoPath(proj);
  const zoom = map.getZoom();
  const font = doc.font;
  let out = '';
  const placed = new Set();
  for (const layer of map.getStyle().layers) {
    if (layer.layout?.visibility === 'none') continue;
    if (zoom < (layer.minzoom ?? 0) || zoom >= (layer.maxzoom ?? 24)) continue;
    let body = '';
    if (layer.type === 'background') {
      body = `<rect width="${W}" height="${H}" fill="${esc(colorOf(colorAtZoom(layer.paint?.['background-color'], zoom)) || '#ffffff')}"/>`;
    } else if (layer.type === 'raster') {
      body = tilesFor(proj, { x: 0, y: 0, w: W, h: H }).map((t) => `<image href="${t.href}" x="${t.x.toFixed(2)}" y="${t.y.toFixed(2)}" width="${(t.w + 0.6).toFixed(2)}" height="${(t.h + 0.6).toFixed(2)}" preserveAspectRatio="none"/>`).join('');
    } else {
      let feats = [];
      try { feats = map.queryRenderedFeatures({ layers: [layer.id] }); } catch {}
      if (!feats.length) continue;
      if (layer.type === 'fill' && layer.id === 'regions-hatch') {
        // Hatching → real SVG <pattern>s, sized for the artboard.
        const groups = new Map();
        for (const f of feats) { const pid = f.properties?.pattern; if (!pid) continue; if (!groups.has(pid)) groups.set(pid, []); groups.get(pid).push(f.geometry); }
        let n = 0;
        for (const [pid, geoms] of groups) {
          const [, color, gap, angle, width] = pid.split('|');
          const id = `mh${n++}`, G = (+gap * k).toFixed(2);
          body += `<defs><pattern id="${id}" patternUnits="userSpaceOnUse" width="${G}" height="${G}" patternTransform="rotate(${angle})"><line x1="0" y1="0" x2="0" y2="${G}" stroke="${esc(color)}" stroke-width="${(+width * k).toFixed(2)}"/></pattern></defs>`;
          const d = path({ type: 'GeometryCollection', geometries: geoms });
          if (d) body += `<path d="${d}" fill="url(#${id})"/>`;
        }
      } else if (layer.type === 'fill') {
        const groups = new Map();
        for (const f of feats) {
          const c = colorOf(f.layer.paint?.['fill-color']);
          if (!c) continue;
          const o = num(f.layer.paint?.['fill-opacity'], 1);
          const key = c + '|' + o;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(f.geometry);
        }
        for (const [key, geoms] of groups) {
          const [c, o] = key.split('|');
          const d = path({ type: 'GeometryCollection', geometries: geoms });
          if (d) body += `<path d="${d}" fill="${esc(c)}"${+o < 1 ? ` fill-opacity="${o}"` : ''}/>`;
        }
      } else if (layer.type === 'line') {
        const groups = new Map();
        for (const f of feats) {
          const P = f.layer.paint || {};
          const c = colorOf(P['line-color']);
          if (!c) continue;
          const w = num(P['line-width'], 1), gap = num(P['line-gap-width'], 0), o = num(P['line-opacity'], 1);
          const dash = Array.isArray(P['line-dasharray']) ? P['line-dasharray'] : (P['line-dasharray']?.from || null);
          const sw = (gap > 0 ? gap + 2 * w : w) * k;
          const da = dash && gap === 0 ? dash.map((x) => (x * w * k).toFixed(2)).join(' ') : '';
          const key = [c, sw.toFixed(2), da, o].join('|');
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(f.geometry);
        }
        const cap = layer.layout?.['line-cap'] || 'butt', join = layer.layout?.['line-join'] || 'miter';
        for (const [key, geoms] of groups) {
          const [c, sw, da, o] = key.split('|');
          const d = path({ type: 'GeometryCollection', geometries: geoms });
          if (d) body += `<path d="${d}" fill="none" stroke="${esc(c)}" stroke-width="${sw}" stroke-linecap="${cap}" stroke-linejoin="${join}"${da ? ` stroke-dasharray="${da}"` : ''}${+o < 1 ? ` stroke-opacity="${o}"` : ''}/>`;
        }
      } else if (layer.type === 'symbol') {
        for (const f of feats) {
          const t = textOf(f, doc.lang);
          if (!t) continue;
          const L = f.layer.layout || {}, P = f.layer.paint || {};
          const size = num(L['text-size'], 14) * k;
          const bold = (L['text-font'] || []).join(' ').includes('Bold');
          let x, y, ang = 0;
          if (f.geometry.type === 'Point') { const p = proj(f.geometry.coordinates); if (!p) continue; [x, y] = p; }
          else { const a = lineAnchor(f.geometry, proj, W, H); if (!a) continue; ({ x, y, ang } = a); }
          if (x < 0 || x > W || y < 0 || y > H) continue;
          const key = t + '|' + Math.round(x / 40) + '|' + Math.round(y / 40);
          if (placed.has(key)) continue;
          placed.add(key);
          const fill = colorOf(P['text-color']) || '#333', halo = colorOf(P['text-halo-color']), hw = num(P['text-halo-width'], 0) * k;
          const tx = `<text x="${x.toFixed(1)}" y="${(y + size * 0.36).toFixed(1)}" direction="rtl" text-anchor="middle" font-family="${esc(fontStack(font))}" font-size="${size.toFixed(1)}" font-weight="${bold ? 700 : 500}" fill="${esc(fill)}"${halo && hw ? ` stroke="${esc(halo)}" stroke-width="${(hw * 1.6).toFixed(1)}" stroke-linejoin="round" paint-order="stroke"` : ''}>${esc(t)}</text>`;
          body += ang ? `<g transform="rotate(${ang.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})">${tx}</g>` : tx;
        }
      }
    }
    if (body) out += `<g id="${esc(layer.id.startsWith('regions-') ? 'Shading_' + layer.id.slice(8) : layer.id)}">${body}</g>`;
  }
  return out;
}

/** The real map as vector SVG groups (for the Map layer of an export). */
export async function realVectorSVG(doc) {
  const { map, k, dispose } = await renderRealMap(doc, 1);
  try { return mapLayersSVG(map, doc, k); } finally { dispose(); }
}
