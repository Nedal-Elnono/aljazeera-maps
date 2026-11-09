// Satellite tiles (Esri World Imagery) laid out in artboard space under a Web Mercator view.
// Imagery: Esri, Maxar, Earthstar Geographics. Check the license for on-air use.
import { blobToDataURL } from '../util.js';

export const SAT_URL = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
export const SAT_CREDIT = 'صور الأقمار الصناعية: Esri, Maxar, Earthstar Geographics';

const TAU = 2 * Math.PI;
const lon2x = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const lat2y = (lat, z) => ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z;
const x2lon = (x, z) => (x / 2 ** z) * 360 - 180;
const y2lat = (y, z) => { const n = Math.PI - (TAU * y) / 2 ** z; return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };

/**
 * Tiles covering a box of the artboard, for a Mercator projection `proj` (d3).
 * Returns [{href, x, y, size}] in artboard pixels.
 */
export function tilesFor(proj, box, maxZ = 18) {
  const scale = proj.scale();
  // pixels per tile at zoom z = scale * 2π / 2^z ; pick z so tiles are ~256–512px on the artboard
  let z = Math.ceil(Math.log2((scale * TAU) / 512));
  z = Math.max(1, Math.min(maxZ, z));
  const tl = proj.invert([box.x, box.y]), br = proj.invert([box.x + box.w, box.y + box.h]);
  if (!tl || !br) return [];
  const n = 2 ** z;
  let x0 = Math.floor(lon2x(tl[0], z)), x1 = Math.floor(lon2x(br[0], z));
  const y0 = Math.max(0, Math.floor(lat2y(Math.min(85, tl[1]), z))), y1 = Math.min(n - 1, Math.floor(lat2y(Math.max(-85, br[1]), z)));
  if (x1 < x0) x1 += n;
  const out = [];
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) return out;
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      const a = proj([x2lon(tx, z), y2lat(ty, z)]), b = proj([x2lon(tx + 1, z), y2lat(ty + 1, z)]);
      if (!a || !b) continue;
      const wx = ((tx % n) + n) % n;
      out.push({ href: SAT_URL(z, wx, ty), x: a[0], y: a[1], w: b[0] - a[0], h: b[1] - a[1], z });
    }
  }
  return out;
}

/**
 * Tiles for a small inset (callout): a Mercator window of size w×h px centered on lon/lat at web zoom z.
 * Coordinates are relative to the inset's top-left.
 */
export function insetTiles(lon, lat, z, w, h) {
  const tz = Math.max(1, Math.min(19, Math.round(z)));
  const k = 2 ** (z - tz); // tile scale
  const size = 256 * k;
  const cx = lon2x(lon, tz) * size, cy = lat2y(lat, tz) * size;
  const left = cx - w / 2, top = cy - h / 2;
  const out = [];
  for (let tx = Math.floor(left / size); tx <= Math.floor((left + w) / size); tx++) {
    for (let ty = Math.floor(top / size); ty <= Math.floor((top + h) / size); ty++) {
      if (ty < 0 || ty >= 2 ** tz) continue;
      const wx = ((tx % 2 ** tz) + 2 ** tz) % 2 ** tz;
      out.push({ href: SAT_URL(tz, wx, ty), x: tx * size - left, y: ty * size - top, w: size, h: size });
    }
  }
  return out;
}

/** Inline every tile as a data URL (needed for PNG export and self-contained SVG). */
const cache = new Map();
export async function inlineImages(svgText, onProgress) {
  const urls = [...new Set([...svgText.matchAll(/href="(https:\/\/[^"]+)"/g)].map((m) => m[1]))];
  let done = 0;
  await Promise.all(urls.map(async (u) => {
    if (!cache.has(u)) {
      cache.set(u, fetch(u, { mode: 'cors' }).then((r) => (r.ok ? r.blob() : null)).then((b) => (b ? blobToDataURL(b) : '')).catch(() => ''));
    }
    await cache.get(u);
    onProgress?.(++done / urls.length);
  }));
  let out = svgText;
  for (const u of urls) {
    const d = await cache.get(u);
    out = out.split(`href="${u}"`).join(`href="${d}"`);
  }
  return out;
}
