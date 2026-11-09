// The map camera: view {projection, center, zoom} + artboard size → a d3 projection.
import { geoMercator, geoEqualEarth, geoNaturalEarth1, geoOrthographic, geoPath, geoGraticule10 } from 'd3';
import { clamp } from '../util.js';

const MAKERS = { mercator: geoMercator, equalEarth: geoEqualEarth, naturalEarth: geoNaturalEarth1, orthographic: geoOrthographic };

export const scaleFor = (zoom, W) => (W / (2 * Math.PI)) * 2 ** zoom;

export function makeProjection(view, W, H, { clip = true, box = null } = {}) {
  const [lon, lat] = view.center;
  const kind = MAKERS[view.projection] ? view.projection : 'mercator';
  const p = MAKERS[kind]();
  if (kind === 'orthographic') p.rotate([-lon, -lat, 0]).clipAngle(90);
  else p.rotate([-lon, 0, 0]).center([0, lat]);
  p.scale(scaleFor(view.zoom, W)).translate([W / 2, H / 2]);
  // Our data is already dense; Mercator needs no adaptive resampling (much faster).
  p.precision(kind === 'mercator' ? 0 : 0.6);
  if (clip) p.clipExtent(box ? [[box.x0 - 60, box.y0 - 60], [box.x1 + 60, box.y1 + 60]] : [[-60, -60], [W + 60, H + 60]]);
  p.kind = kind;
  return p;
}

export const pathFor = (proj) => geoPath(proj);

/** Detailed coastlines once the artboard spans less than ~50° of longitude. */
export const wantsHi = (view, W) => 2 * Math.PI * scaleFor(view.zoom, W) > 7.2 * W;

/**
 * How much border detail the view needs: 'lo' for the world and big regions, 'mid' for a few
 * countries, 'hi' for close-ups. More points than pixels only costs time.
 */
export function lodFor(view, W = 1080) {
  const z = view.zoom + Math.log2(W / 1080); // bigger artboards show more pixels per degree
  if (z < 2.85) return 'lo';
  if (z < 5.2) return 'mid';
  return 'hi';
}

export function normalizeView(v) {
  let [lon, lat] = v.center;
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  lat = clamp(lat, v.projection === 'mercator' ? -78 : -89, v.projection === 'mercator' ? 82 : 89);
  return { ...v, center: [lon, lat], zoom: clamp(v.zoom, -0.5, 14) };
}

/** Drag the map by (dx, dy) artboard pixels. */
export function panView(view, dx, dy, W, H) {
  const p = makeProjection(view, W, H, { clip: false });
  const c = p.invert([W / 2 - dx, H / 2 - dy]);
  if (!c || Number.isNaN(c[0])) return view;
  return normalizeView({ ...view, center: c });
}

/** Zoom by a factor while keeping the point under the cursor still. */
export function zoomAround(view, factor, pt, W, H) {
  const p0 = makeProjection(view, W, H, { clip: false });
  const g = p0.invert(pt);
  const next = normalizeView({ ...view, zoom: view.zoom + Math.log2(factor) });
  if (!g || view.projection === 'orthographic') return next;
  const p1 = makeProjection(next, W, H, { clip: false });
  const q = p1(g);
  return panView(next, pt[0] - q[0], pt[1] - q[1], W, H);
}

/** A view that shows these lon/lat bounds with some breathing room. */
export function fitBounds(view, bounds, W, H, pad = 0.18) {
  let [[w, s], [e, n]] = bounds;
  if (e < w) e += 360;
  const center = [(w + e) / 2, (s + n) / 2];
  const base = normalizeView({ ...view, center, zoom: 0 });
  const p = makeProjection(base, W, H, { clip: false });
  const a = p([w, n]), b = p([e, s]);
  if (!a || !b) return { ...view, center };
  const bw = Math.max(4, Math.abs(b[0] - a[0])), bh = Math.max(4, Math.abs(b[1] - a[1]));
  const k = Math.min((W * (1 - 2 * pad)) / bw, (H * (1 - 2 * pad)) / bh);
  const zoom = clamp(Math.log2(k), -0.5, 13);
  const v = normalizeView({ ...view, center, zoom });
  // Mercator stretches latitudes: re-center on the projected middle.
  if (view.projection === 'mercator') {
    const p2 = makeProjection(v, W, H, { clip: false });
    const m = p2.invert([(p2([w, n])[0] + p2([e, s])[0]) / 2, (p2([w, n])[1] + p2([e, s])[1]) / 2]);
    if (m) v.center = m;
  }
  return normalizeView(v);
}

export const graticule = geoGraticule10();

/** Kilometers per artboard pixel at the center of the view (for scale bars and defaults). */
export function kmPerPx(view, W, H) {
  const p = makeProjection(view, W, H, { clip: false });
  const a = p.invert([W / 2, H / 2]), b = p.invert([W / 2 + 100, H / 2]);
  if (!a || !b) return 1;
  const R = 6371, toR = Math.PI / 180;
  const d = Math.acos(clamp(Math.sin(a[1] * toR) * Math.sin(b[1] * toR) + Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.cos((b[0] - a[0]) * toR), -1, 1));
  return (d * R) / 100;
}
