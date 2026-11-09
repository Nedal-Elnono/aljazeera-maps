// Shaded countries/provinces as GeoJSON for the real map, which draws them under its own names.
import * as D from './data.js';
import { lodFor } from './projection.js';
import { mapScale, hatchId } from './realstyle.js';
import { mix, luminance } from '../util.js';

export function regionsGeo(doc) {
  const k = mapScale(doc);
  const hi = lodFor(doc.view, doc.artboard.w);
  const features = [], inner = [];
  let pending = false;
  for (const el of doc.elements) {
    if (el.type !== 'region' || el.hidden) continue;
    const f = D.regionFeature(el, doc.worldview, hi);
    if (!f) { pending = true; continue; }
    const stroked = el.stroke && el.stroke !== 'none' && el.strokeWidth > 0;
    const props = { id: el.id, fill: el.fill, opacity: el.opacity, stroke: stroked ? el.stroke : '#000000', strokeWidth: stroked ? el.strokeWidth / k : 0 };
    if (el.hatch) props.pattern = hatchId(el.hatchColor, +(el.hatchGap / k).toFixed(2), el.hatchAngle, +(el.hatchWidth / k).toFixed(2));
    features.push({ type: 'Feature', geometry: f.geometry, properties: props });
    if (el.inner && el.kind === 'country') {
      const a = D.admin1(el.a3);
      if (a) inner.push({ type: 'Feature', geometry: a.inner, properties: { color: el.innerColor } });
      else { D.admin1Loading(el.a3); pending = true; }
    }
  }
  inner.push(...sharedEdges(doc, hi).features);
  return {
    regions: { type: 'FeatureCollection', features },
    inner: { type: 'FeatureCollection', features: inner },
    // Changes whenever what's drawn changes (element props, detail level, data arriving).
    key: JSON.stringify([hi, pending, doc.worldview, k.toFixed(3), features.map((f) => f.properties), inner.length, inner.map((f) => f.properties), doc.elements.filter((e) => e.type === 'region' && !e.hidden).map((e) => [e.a3, e.rid, e.kind])]),
  };
}

/** A line color that reads on top of a shading color: darker on light fills, lighter on dark ones. */
export function edgeColor(fill) {
  if (!/^#[0-9a-f]{6}$/i.test(fill || '')) return '#ffffff';
  return luminance(fill) > 0.45 ? mix(fill, '#000000', 0.3) : mix(fill, '#ffffff', 0.45);
}

let EDGES = { key: null, fc: null };

/**
 * The borders between shaded regions that touch (provinces next to each other, or countries), so a
 * run of neighbours shaded in one color still shows where one ends and the next begins. Regions with
 * their own outline are left out (their stroke already draws the line). Lines take the color of the
 * shading they sit on. Neighbours from one dataset share their vertices exactly, so a shared edge is
 * a segment that two regions both have.
 */
export function sharedEdges(doc, lod) {
  const els = [];
  for (const el of doc.elements) {
    if (el.type !== 'region' || el.hidden || (el.stroke && el.stroke !== 'none' && el.strokeWidth > 0)) continue;
    const f = D.regionFeature(el, doc.worldview, lod);
    if (f) els.push({ el, f });
  }
  const key = JSON.stringify([lod, doc.worldview, els.map(({ el, f }) => [el.kind, el.a3, el.rid, el.level, el.fill, el.opacity, f.geometry.coordinates.length])]);
  if (EDGES.key === key) return EDGES.fc;
  const fc = { type: 'FeatureCollection', features: [] };
  if (els.length > 1) {
    const pt = (p) => Math.round(p[0] * 1e6) + ',' + Math.round(p[1] * 1e6);
    const seg = (a, b) => { const x = pt(a), y = pt(b); return x < y ? x + '|' + y : y + '|' + x; };
    const owner = new Map();
    const rings = (g) => (g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : []);
    const byColor = new Map(); // color|opacity -> lines
    els.forEach(({ el, f }, i) => {
      const color = edgeColor(el.fill), opacity = Math.max(0.55, el.opacity ?? 1);
      const k = color + '|' + opacity;
      if (!byColor.has(k)) byColor.set(k, { color, opacity, lines: [] });
      const out = byColor.get(k).lines;
      for (const r of rings(f.geometry)) {
        let cur = null;
        for (let j = 0; j < r.length - 1; j++) {
          const s = seg(r[j], r[j + 1]), o = owner.get(s);
          if (o === undefined) { owner.set(s, i); cur = null; continue; }
          if (o === i) { cur = null; continue; }
          if (cur) cur.push(r[j + 1]);
          else out.push((cur = [r[j], r[j + 1]]));
        }
      }
    });
    for (const { color, opacity, lines } of byColor.values()) {
      if (lines.length) fc.features.push({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: lines }, properties: { color, opacity } });
    }
  }
  EDGES = { key, fc };
  return fc;
}
