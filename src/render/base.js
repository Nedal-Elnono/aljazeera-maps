// The base map: sea, land, borders, water, satellite, OSM detail and the automatic labels.
import { geoBounds, geoArea, geoContains } from 'd3';
import * as D from '../geo/data.js';
import { graticule } from '../geo/projection.js';
import { tilesFor, SAT_CREDIT } from '../geo/tiles.js';
import { textSVG, measure } from './text.js';
import { esc, luminance, mix } from '../util.js';

const fArea = new WeakMap();
/** On-board area in px² from the (cached) spherical area — no need to project the shape. */
export function pxArea(ctx, f, lat = 0) {
  let a = fArea.get(f);
  if (a === undefined) { a = geoArea(f); fArea.set(f, a); }
  const s = ctx.proj.scale();
  const c = Math.cos((lat * Math.PI) / 180);
  return (a * s * s) / (ctx.proj.kind === 'mercator' ? Math.max(0.05, c * c) : 1);
}

const fBounds = new WeakMap();
const boundsOf = (f) => { let b = fBounds.get(f); if (!b) { b = geoBounds(f); fBounds.set(f, b); } return b; };

/** Lon/lat box the artboard shows (null = don't cull, e.g. on a globe). */
export function viewBox(ctx) {
  const { proj } = ctx;
  if (proj.kind === 'orthographic') return null;
  const b = area(ctx);
  const pts = [];
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) { const g = proj.invert([b.x0 + ((b.x1 - b.x0) * i) / 4, b.y0 + ((b.y1 - b.y0) * j) / 4]); if (g) pts.push(g); }
  if (pts.length < 4) return null;
  const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
  let w = Math.min(...lons), e = Math.max(...lons);
  if (e - w > 300) return null; // crosses the antimeridian or shows the world
  const s = Math.min(...lats), n = Math.max(...lats);
  const mx = (e - w) * 0.08 + 0.2, my = (n - s) * 0.08 + 0.2;
  return [w - mx, s - my, e + mx, n + my];
}
/** What gets drawn: the artboard, or the whole stage in the editor. */
const area = (ctx) => ctx.ext || { x0: 0, y0: 0, x1: ctx.W, y1: ctx.H };

const hits = (b, vb) => {
  if (!vb) return true;
  let [[w, s], [e, n]] = b;
  if (e < w) return true; // feature crosses the antimeridian
  return !(e < vb[0] || w > vb[2] || n < vb[1] || s > vb[3]);
};

const meshCache = new WeakMap();
function splitMesh(mesh) {
  let m = meshCache.get(mesh);
  if (!m) {
    m = mesh.coordinates.map((c) => {
      let w = 180, e = -180, s = 90, n = -90;
      for (const [x, y] of c) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
      return { c, b: [[w, s], [e, n]] };
    });
    meshCache.set(mesh, m);
  }
  return m;
}
/** Only the border lines inside a lon/lat box (null = all of them). */
export const culledMesh = (mesh, vb) => ({ type: 'MultiLineString', coordinates: splitMesh(mesh).filter((l) => hits(l.b, vb)).map((l) => l.c) });

/** Web-map-ish zoom used to decide which labels and water features appear. */
export const labelZoom = (ctx) => ctx.doc.view.zoom + Math.log2(ctx.W / 256) - 1.1;

export function renderBase(ctx) {
  const { doc, W, H, proj, path } = ctx;
  const st = doc.style;
  const C = ctx.countries;
  const vb = (ctx.vb = viewBox(ctx));
  const out = {};
  const globe = proj.kind === 'orthographic';
  const sphere = path({ type: 'Sphere' });

  // Sea / background
  const A = area(ctx);
  const full = `x="${A.x0.toFixed(1)}" y="${A.y0.toFixed(1)}" width="${(A.x1 - A.x0).toFixed(1)}" height="${(A.y1 - A.y0).toFixed(1)}"`;
  const space = luminance(st.sea) > 0.3 ? '#f7f7f7' : '#030303';
  out.sea = globe
    ? `<rect ${full} fill="${space}"/><path d="${sphere}" fill="${st.sea}" data-layer="water"/>`
    : `<rect ${full} fill="${st.sea}" data-layer="water"/>`;
  if (st.bgImage && doc.assets[st.bgImage]) {
    out.sea += `<image href="${doc.assets[st.bgImage]}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" opacity="${st.bgOpacity}"${st.bgBlur ? ` filter="url(#f-blur)"` : ''}/>`;
  }

  // Satellite
  out.sat = '';
  if (st.satellite && proj.kind === 'mercator') {
    const tiles = tilesFor(proj, { x: A.x0, y: A.y0, w: A.x1 - A.x0, h: A.y1 - A.y0 });
    out.sat = `<g${st.satGray ? ' filter="url(#f-gray)"' : ''} opacity="${st.satOpacity}">` +
      tiles.map((t) => `<image href="${t.href}" x="${t.x.toFixed(2)}" y="${t.y.toFixed(2)}" width="${(t.w + 0.6).toFixed(2)}" height="${(t.h + 0.6).toFixed(2)}" preserveAspectRatio="none"/>`).join('') + '</g>' +
      (st.satDim > 0 ? `<rect ${full} fill="#000" opacity="${st.satDim}"/>` : '');
    ctx.credits.add(SAT_CREDIT);
  }
  const sat = !!out.sat;

  // Land: one path per country so a click knows which one.
  let land = '';
  if (C) {
    for (const f of C.features) {
      if (!hits(D.geoBox(f), vb)) continue;
      const d = path(f);
      if (d) land += `<path d="${d}" data-cid="${esc(f.properties.id)}"/>`;
    }
  }
  out.land = `<g fill="${sat ? 'transparent' : st.land}"${st.landShadow ? ' filter="url(#f-landshadow)"' : ''}>${land}</g>`;

  // Water
  const z = labelZoom(ctx);
  out.lakes = '';
  if (st.lakes && !sat) {
    const ls = D.lakes().filter((f) => f.properties.rank <= z + 4 && hits(D.geoBox(f), vb));
    if (ls.length) out.lakes = `<path d="${path({ type: 'FeatureCollection', features: ls }) || ''}" fill="${st.lake || st.sea}" data-layer="water"/>`;
  }
  out.rivers = '';
  if (st.rivers) {
    const rs = D.rivers().filter((f) => f.properties.rank <= z + 3.5 && hits(D.geoBox(f), vb));
    if (rs.length) {
      const w = Math.max(1, Math.min(3, 0.6 + z * 0.25));
      const rd = path({ type: 'FeatureCollection', features: rs }) || '';
      out.rivers = `<path d="${rd}" fill="none" stroke="${st.river}" stroke-width="${w.toFixed(2)}" stroke-linejoin="round" stroke-linecap="round" data-layer="river"/>` +
        (ctx.editing ? `<path d="${rd}" fill="none" stroke="transparent" stroke-width="12" pointer-events="stroke" data-layer="river"/>` : '');
    }
  }

  // Graticule
  out.graticule = st.graticule ? `<path d="${path(graticule) || ''}" fill="none" stroke="${st.border}" stroke-opacity=".5" stroke-width="1"/>` : '';

  // Provinces everywhere in view (only when zoomed in enough to matter)
  out.admin1 = '';
  if (st.admin1All && C && ctx.hi) {
    let d = '';
    let n = 0;
    for (const f of C.features) {
      if (!hits(D.geoBox(f), vb) || n > 14) continue;
      n++;
      const a = D.admin1(f.properties.id);
      if (!a) { D.admin1Loading(f.properties.id); continue; }
      d += path(culledMesh(a.inner, vb)) || '';
    }
    if (d) out.admin1 = `<path data-layer="admin1" d="${d}" fill="none" stroke="${st.admin1}" stroke-width="${Math.max(0.8, st.borderWidth * 0.6).toFixed(2)}" stroke-dasharray="${st.admin1Dash ? '3 4' : 'none'}" stroke-linejoin="round"/>`;
  }

  // Borders & coast
  out.borders = '';
  if (C) {
    const bw = st.borderWidth;
    const bd = path(culledMesh(C.borders, vb)) || '';
    out.borders = `<path d="${bd}" fill="none" stroke="${sat ? '#ffffff' : st.border}" stroke-width="${bw}" stroke-linejoin="round" stroke-linecap="round"${sat ? ' stroke-opacity=".85"' : ''} data-layer="border"/>`;
    // Editor only: an invisible band over the borders (drawn above shading) to hover/pick them.
    out.hit = ctx.editing ? `<path d="${bd}" fill="none" stroke="transparent" stroke-width="12" pointer-events="stroke" data-layer="border"/>` : '';
    if (st.coast && st.coast !== 'none' && st.coastWidth > 0) {
      out.borders = `<path d="${path(culledMesh(C.coast, vb)) || ''}" fill="none" stroke="${st.coast}" stroke-width="${st.coastWidth}" stroke-linejoin="round"/>` + out.borders;
    }
  }

  out.detail = renderDetail(ctx);
  out.labels = ctx.skipLabels ? '' : renderLabels(ctx);

  // Finish: grain + vignette over everything on the map.
  out.finish = '';
  if (st.vignette > 0) out.finish += `<rect width="${W}" height="${H}" fill="url(#g-vignette)" opacity="${st.vignette}"/>`;
  if (st.texture === 'grain') out.finish += `<rect width="${W}" height="${H}" filter="url(#f-grain)" opacity=".5"/>`;
  return out;
}

/* ---------- OpenStreetMap detail (roads, rivers, towns) ---------- */

function renderDetail(ctx) {
  const { doc, path } = ctx;
  const d = doc.detail, st = doc.style;
  if (!d) return '';
  ctx.credits.add('© OpenStreetMap contributors');
  let s = '';
  const sat = st.satellite;
  if (st.detailRivers && d.rivers?.length) {
    s += `<path d="${path({ type: 'MultiLineString', coordinates: d.rivers }) || ''}" fill="none" stroke="${st.river}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  if (st.detailRoads && d.roads?.length) {
    const byCls = { 1: [], 2: [], 3: [] };
    for (const r of d.roads) byCls[r.c]?.push(r.g);
    const col = sat ? '#ffffff' : mix(st.land, luminance(st.land) > 0.5 ? '#000000' : '#ffffff', 0.18);
    const w = { 1: 3.2, 2: 2.2, 3: 1.3 };
    for (const c of [3, 2, 1]) {
      if (!byCls[c].length) continue;
      s += `<path d="${path({ type: 'MultiLineString', coordinates: byCls[c] }) || ''}" fill="none" stroke="${col}" stroke-width="${w[c]}" stroke-linejoin="round" stroke-linecap="round"${sat ? ' stroke-opacity=".8"' : ''}/>`;
    }
  }
  return s;
}

/* ---------- labels: countries, seas, cities ---------- */

export function renderLabels(ctx) {
  const { doc, W, H, proj, font } = ctx;
  const st = doc.style;
  const C = ctx.countries;
  const z = labelZoom(ctx);
  // Opaque boxes on the board (text boxes, legends) push map labels away.
  const placed = [];
  for (const el of doc.elements) {
    const b = ctx.boxes.get(el.id);
    if (!b || el.hidden || (el.bgOpacity ?? 1) < 0.5) continue;
    placed.push({ x1: b.x, x2: b.x + b.w, y1: b.y, y2: b.y + b.h });
  }
  const fits = (b) => !placed.some((p) => !(b.x2 < p.x1 || b.x1 > p.x2 || b.y2 < p.y1 || b.y1 > p.y2));
  const inside = (x, y, m = 10) => x > m && x < W - m && y > m && y < H - m;
  const sat = st.satellite;
  let out = '';

  const regionsBy = new Map();
  for (const el of doc.elements) if (el.type === 'region' && el.kind === 'country' && !el.hidden) regionsBy.set(el.a3, el);

  const put = (key, text, x, y, size, color, weight, { force = false, halo = null } = {}) => {
    const o = doc.labels[key] || {};
    if (o.hidden) { if (ctx.editing) ctx.hiddenLabels.push({ key, x, y }); return; }
    const t = o.text ?? text;
    const s = o.size || size;
    const lx = x + (o.dx || 0), ly = y + (o.dy || 0);
    const w = measure(t, s, weight, font);
    const b = { x1: lx - w / 2 - 6, x2: lx + w / 2 + 6, y1: ly - s * 0.6, y2: ly + s * 0.6 };
    if (!force && !o.dx && !o.dy && (!fits(b) || !inside(lx, ly) || b.x1 < 6 || b.x2 > W - 6 || b.y1 < 4 || b.y2 > H - 4)) return;
    placed.push(b);
    out += `<g data-label="${esc(key)}">${textSVG(t, { x: lx, y: ly, size: s, family: font, weight, color: o.color || color, halo: halo || (sat ? 'rgba(0,0,0,.55)' : null) })}</g>`;
  };

  // Countries, most important first.
  if (st.countryLabels && C) {
    const list = [];
    for (const f of C.features) {
      const p = f.properties;
      if (!p.lx && !p.ly) continue;
      const key = 'c:' + p.id;
      const o = doc.labels[key];
      const show = (p.minz ?? 3) <= z + 0.8 || o;
      if (!show) continue;
      let pt = proj([p.lx, p.ly]);
      const out = !pt || pt[0] < 40 || pt[0] > W - 40 || pt[1] < 30 || pt[1] > H - 30;
      if (out && !o?.dx) {
        // Zoomed in past the usual label point: name the part that's on the board.
        if (pxArea(ctx, f, p.ly) < W * H * 0.06) continue;
        // Cheap: middle of where the country's box meets the board, if that point is in the country.
        const [[bw, bs], [be, bn]] = boundsOf(f);
        const a = proj([bw, bn]), b = proj([be, bs]);
        if (!a || !b || be < bw) continue;
        const x1 = Math.max(60, Math.min(a[0], b[0])), x2 = Math.min(W - 60, Math.max(a[0], b[0]));
        const y1 = Math.max(40, Math.min(a[1], b[1])), y2 = Math.min(H - 40, Math.max(a[1], b[1]));
        if (x2 - x1 < W * 0.2 || y2 - y1 < H * 0.12) continue;
        const c = [(x1 + x2) / 2, (y1 + y2) / 2];
        const ll = proj.invert(c);
        if (!ll || !geoContains(f, ll)) continue;
        pt = c;
      }
      if (!pt) continue;
      list.push({ f, p, pt, key, o });
    }
    list.sort((a, b) => (a.p.rank ?? 5) - (b.p.rank ?? 5));
    for (const { f, p, pt, key, o } of list) {
      const reg = regionsBy.get(p.id);
      let color = sat ? '#ffffff' : st.label;
      if (reg) {
        if (reg.labelColor) color = reg.labelColor;
        else if (Math.abs(luminance(reg.fill) - luminance(st.land)) > 0.18 && reg.opacity > 0.5 && !reg.hatch) color = mix(reg.fill, luminance(reg.fill) < 0.3 ? '#ffffff' : '#000000', 0.42);
      }
      // Smaller countries get smaller names.
      const area = pxArea(ctx, f, p.ly);
      const size = area < 1800 ? st.labelSize * 0.62 : area < 9000 ? st.labelSize * 0.78 : st.labelSize;
      const name = doc.lang === 'en' ? p.name : p.ar;
      put(key, name, pt[0], pt[1], Math.round(size), color, reg && !reg.labelColor ? 500 : 400, { force: !!o });
    }
  }

  // Seas and gulfs
  if (st.seaLabels && !sat) {
    for (const [ar, en, lon, lat, rank] of D.marine()) {
      if (rank > z + 0.2) continue;
      const pt = proj([lon, lat]);
      if (!pt) continue;
      put('s:' + en, doc.lang === 'en' ? en : ar, pt[0], pt[1], st.seaLabelSize, st.seaLabel, 400);
    }
  }

  // Cities
  if (st.cities) {
    let n = 0;
    for (const [ar, en, lon, lat, rank, cls] of D.places()) {
      if (rank > Math.min(10, z - 2 + st.cityRank) || n > 60) continue;
      const pt = proj([lon, lat]);
      if (!pt || !inside(pt[0], pt[1], 30)) continue;
      const key = 'p:' + en + ':' + lon;
      const o = doc.labels[key] || {};
      if (o.hidden) continue;
      const t = o.text ?? (doc.lang === 'en' ? en : ar);
      const s = o.size || st.cityLabelSize;
      const w = measure(t, s, 500, font);
      const lx = pt[0] - 10 + (o.dx || 0), ly = pt[1] + (o.dy || 0);
      const b = { x1: lx - w - 4, x2: pt[0] + 8, y1: ly - s * 0.6, y2: ly + s * 0.6 };
      if (!fits(b) && !o.dx) continue;
      placed.push(b); n++;
      const col = sat ? '#ffffff' : st.city;
      out += `<g data-label="${esc(key)}"><circle cx="${pt[0].toFixed(1)}" cy="${pt[1].toFixed(1)}" r="${cls === 0 ? 6 : 4.5}" fill="${col}"${cls === 0 ? ` stroke="${sat ? '#000' : st.land}" stroke-width="2"` : ''}/>` +
        textSVG(t, { x: lx, y: ly, size: s, family: font, weight: cls === 0 ? 700 : 500, color: col, anchor: 'start', halo: sat ? 'rgba(0,0,0,.6)' : st.land, haloWidth: 5 }) + '</g>';
    }
  }

  // OSM towns
  if (doc.detail?.places?.length && doc.style.detailPlaces) {
    for (const pl of doc.detail.places) {
      const pt = proj([pl.lon, pl.lat]);
      if (!pt || !inside(pt[0], pt[1], 20)) continue;
      const key = 'o:' + pl.id;
      const o = doc.labels[key] || {};
      if (o.hidden) continue;
      const t = o.text ?? (doc.lang === 'en' ? pl.en || pl.ar : pl.ar || pl.en);
      if (!t) continue;
      const s = o.size || Math.round(st.cityLabelSize * (pl.r === 1 ? 1.05 : pl.r === 2 ? 0.92 : 0.8));
      const w = measure(t, s, 500, font);
      const lx = pt[0] + (o.dx || 0), ly = pt[1] + (o.dy || 0);
      const b = { x1: lx - w / 2 - 4, x2: lx + w / 2 + 4, y1: ly - s * 0.6, y2: ly + s * 0.6 };
      if (!fits(b) && !o.dx) continue;
      placed.push(b);
      out += `<g data-label="${esc(key)}">${textSVG(t, { x: lx, y: ly, size: s, family: font, weight: 500, color: sat ? '#ffffff' : st.city, halo: sat ? 'rgba(0,0,0,.6)' : st.land, haloWidth: 4 })}</g>`;
    }
  }
  return out;
}
