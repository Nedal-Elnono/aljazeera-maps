// What the designer adds on top of the map. Each renderer returns an SVG string;
// geo elements follow the map when it moves, layout elements stay put on the artboard.
import { line as d3line, curveCatmullRom, curveCatmullRomClosed, geoCircle, geoLength } from 'd3';
import * as D from '../geo/data.js';
import { sharedEdges } from '../geo/regions.js';
import { insetTiles, SAT_CREDIT } from '../geo/tiles.js';
import { ICONS, pinPath } from './icons.js';
import { textSVG, measure, wrapRich, richTextSVG, fontStack } from './text.js';
import { pxArea } from './base.js';
import { LABEL_STYLES } from '../presets.js';
import { esc, fmtNum, onColor, mix, luminance } from '../util.js';

const f1 = (n) => (+n).toFixed(1);
const dashFor = (dash, w) => {
  switch (dash) {
    case 'dashed': return `${f1(w * 2.6 + 4)} ${f1(w * 1.8 + 3)}`;
    case 'dotted': return `0.01 ${f1(w * 2.2)}`;
    case 'long': return `${f1(w * 6 + 8)} ${f1(w * 2.4 + 4)}`;
    default: return null;
  }
};
const strokeAttrs = (color, w, dash, extra = '') => {
  if (!color || color === 'none' || !w) return 'stroke="none"';
  const da = dashFor(dash, w);
  return `stroke="${esc(color)}" stroke-width="${f1(w)}" stroke-linejoin="round" stroke-linecap="round"${da ? ` stroke-dasharray="${da}"` : ''}${extra}`;
};

function hatchDef(ctx, id, color, gap, angle, width) {
  const pid = `h-${id}`;
  ctx.defs.push(`<pattern id="${pid}" patternUnits="userSpaceOnUse" width="${gap}" height="${gap}" patternTransform="rotate(${angle})"><line x1="0" y1="0" x2="0" y2="${gap}" stroke="${esc(color)}" stroke-width="${width}"/></pattern>`);
  return `url(#${pid})`;
}

/* ---------- a label in a box (shared by labels, markers, frames) ---------- */

export function boxLabel(ctx, { x, y, text, style = 'dark', size = 28, color, bg, accent, pad = 12, weight, rotate = 0, anchor = 'center' }) {
  const S = LABEL_STYLES[style] || LABEL_STYLES.dark;
  const font = ctx.font;
  const wgt = weight || S.weight;
  const bgc = bg || S.bg;
  const col = color || S.color;
  const lines = String(text || '').split('\n');
  const tw = Math.max(...lines.map((l) => measure(l, size, wgt, font)));
  const lh = size * 1.3;
  const hasBox = !!bgc;
  const w = tw + (hasBox ? pad * 2.2 : 0);
  const h = lines.length * lh + (hasBox ? pad * 1.1 : 0) - (lines.length > 1 ? 0 : size * 0.3 - (hasBox ? 0 : 0));
  // anchor: where (x,y) sits on the box
  let cx = x, cy = y;
  if (anchor === 'right') cx = x - w / 2;      // box's right edge at x
  else if (anchor === 'left') cx = x + w / 2;  // box's left edge at x
  else if (anchor === 'top') cy = y + h / 2;
  else if (anchor === 'bottom') cy = y - h / 2;
  const bx = cx - w / 2, by = cy - h / 2;
  let s = '';
  if (hasBox) s += `<rect x="${f1(bx)}" y="${f1(by)}" width="${f1(w)}" height="${f1(h)}" fill="${esc(bgc)}"/>`;
  if (accent) s += `<rect x="${f1(bx + w * 0.5)}" y="${f1(by - Math.max(4, size * 0.16))}" width="${f1(w * 0.5)}" height="${f1(Math.max(4, size * 0.16))}" fill="${esc(accent)}"/>`;
  lines.forEach((l, i) => {
    s += textSVG(l, { x: cx, y: cy - ((lines.length - 1) * lh) / 2 + i * lh, size, family: font, weight: wgt, color: col, halo: S.halo, haloWidth: size * 0.2 });
  });
  if (rotate) s = `<g transform="rotate(${rotate} ${f1(cx)} ${f1(cy)})">${s}</g>`;
  return { svg: s, box: { x: bx, y: by, w, h, cx, cy } };
}

/* ---------- region: a country or province, filled ---------- */

function region(el, ctx) {
  // On the real map the shading itself is drawn by the map; skip all geometry work unless names are on.
  if (ctx.mapDrawsRegions && !el.showName && !el.innerNames) return '';
  const f = D.regionFeature(el, ctx.doc.worldview, ctx.lod);
  if (!f) return '';
  const d = ctx.path(f);
  if (!d) return '';
  // On the real map the shading is drawn by the map itself (under its names); only names stay here.
  const own = !ctx.mapDrawsRegions;
  let s = own ? `<path d="${d}" fill="${esc(el.fill)}"${el.opacity < 1 ? ` fill-opacity="${el.opacity}"` : ''} stroke="none"/>` : '';
  if (el.hatch && own) s += `<path d="${d}" fill="${hatchDef(ctx, el.id, el.hatchColor, el.hatchGap, el.hatchAngle, el.hatchWidth)}"/>`;
  if ((el.inner || el.innerNames) && el.kind === 'country') {
    const a = D.admin1(el.a3);
    if (!a) D.admin1Loading(el.a3);
    else {
      if (el.inner && own) s += `<path d="${ctx.path(a.inner) || ''}" fill="none" stroke="${esc(el.innerColor)}" stroke-width="1.3" stroke-linejoin="round"/>`;
      if (el.innerNames) {
        // Province names, biggest first, skipping the ones that would collide.
        const size = el.innerNameSize || 18, placed = [];
        const items = a.features.map((g) => ({ g, area: pxArea(ctx, g, g.properties.ly || 0) })).sort((x, y) => y.area - x.area);
        for (const { g, area } of items) {
          const p = g.properties;
          const c = p.lx != null ? ctx.proj([p.lx, p.ly]) : ctx.path.centroid(g);
          if (!c || Number.isNaN(c[0]) || area < size * size * 3) continue;
          const t = ctx.doc.lang === 'en' ? p.name : p.ar;
          const w = measure(t, size, 500, ctx.font);
          const b = { x1: c[0] - w / 2 - 3, x2: c[0] + w / 2 + 3, y1: c[1] - size * 0.6, y2: c[1] + size * 0.6 };
          if (placed.some((q) => !(b.x2 < q.x1 || b.x1 > q.x2 || b.y2 < q.y1 || b.y1 > q.y2))) continue;
          placed.push(b);
          s += textSVG(t, { x: c[0], y: c[1], size, family: ctx.font, weight: 500, color: el.innerNameColor || el.innerColor });
        }
      }
    }
  }
  if (el.stroke && el.stroke !== 'none' && own) s += `<path d="${d}" fill="none" ${strokeAttrs(el.stroke, el.strokeWidth, 'solid')}/>`;
  if (el.showName && el.kind !== 'country') {
    const p = f.properties;
    const c = p.lx != null ? ctx.proj([p.lx, p.ly]) : ctx.path.centroid(f);
    if (c && !Number.isNaN(c[0])) s += textSVG(el.name || (ctx.doc.lang === 'en' ? p.name : p.ar), { x: c[0], y: c[1], size: el.nameSize, family: ctx.font, weight: 600, color: el.nameColor });
  }
  return s;
}

/* ---------- marker ---------- */

function markerShape(el, x, y, ctx) {
  const s = el.size, c = esc(el.color), st = esc(el.stroke || 'none'), sw = el.stroke ? el.strokeWidth : 0;
  switch (el.shape) {
    case 'pulse':
      return `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(s * 1.35)}" fill="${c}" opacity=".18"/><circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(s * 0.9)}" fill="${c}" opacity=".38"/><circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(s * 0.46)}" fill="${c}"/><circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(s * 0.17)}" fill="#ffffff"/>`;
    case 'ring':
      return `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(s / 2)}" fill="none" stroke="${c}" stroke-width="${f1(Math.max(3, s * 0.13))}"/>`;
    case 'pin': {
      const h = s * 1.7, r = h * 0.36;
      return `<g transform="translate(${f1(x)} ${f1(y)})"><path d="${pinPath(h)}" fill="${c}" stroke="${st}" stroke-width="${sw}"/><circle cx="0" cy="${f1(-h + r)}" r="${f1(r * 0.46)}" fill="#ffffff"/></g>`;
    }
    case 'square':
      return `<rect x="${f1(x - s / 2)}" y="${f1(y - s / 2)}" width="${f1(s)}" height="${f1(s)}" fill="${c}" stroke="${st}" stroke-width="${sw}"/>`;
    case 'diamond':
      return `<rect x="${f1(x - s / 2.6)}" y="${f1(y - s / 2.6)}" width="${f1(s / 1.3)}" height="${f1(s / 1.3)}" fill="${c}" stroke="${st}" stroke-width="${sw}" transform="rotate(45 ${f1(x)} ${f1(y)})"/>`;
    case 'icon': {
      const ic = ICONS[el.icon] || ICONS.blast;
      const rule = ic.rule ? ` fill-rule="${ic.rule}"` : '';
      if (el.badge === false) {
        const k = (s * 1.2) / 24;
        return `<path d="${ic.d}"${rule} transform="translate(${f1(x - 12 * k)} ${f1(y - 12 * k)}) scale(${k.toFixed(3)})" fill="${c}" stroke="#ffffff" stroke-width="${f1(2.2 / k)}" paint-order="stroke" stroke-linejoin="round"/>`;
      }
      const R = s * 0.62, k = (s * 0.78) / 24;
      return `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(R)}" fill="${c}" stroke="${st}" stroke-width="${sw}"/><path d="${ic.d}"${rule} transform="translate(${f1(x - 12 * k)} ${f1(y - 12 * k)}) scale(${k.toFixed(3)})" fill="${onColor(el.color)}"/>`;
    }
    case 'flag': {
      const w = s * 1.5, h = s;
      return `<image href="https://flagcdn.com/${esc((el.flag || 'ps').toLowerCase())}.svg" x="${f1(x - w / 2)}" y="${f1(y - h / 2)}" width="${f1(w)}" height="${f1(h)}" preserveAspectRatio="none"/><rect x="${f1(x - w / 2)}" y="${f1(y - h / 2)}" width="${f1(w)}" height="${f1(h)}" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="1"/>`;
    }
    case 'image': {
      const src = ctx.doc.assets[el.asset];
      if (!src) return `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(s / 2)}" fill="${c}"/>`;
      return `<image href="${src}" x="${f1(x - s)}" y="${f1(y - s)}" width="${f1(s * 2)}" height="${f1(s * 2)}" preserveAspectRatio="xMidYMid meet"/>`;
    }
    default:
      return `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(s / 2)}" fill="${c}" stroke="${st}" stroke-width="${sw}"/>`;
  }
}

function marker(el, ctx) {
  const p = ctx.proj(el.at);
  if (!p) return '';
  const [x, y] = p;
  let s = '';
  let shape = markerShape(el, x, y, ctx);
  if (el.text) {
    const half = el.shape === 'pin' ? el.size * 0.5 : el.shape === 'pulse' ? el.size * 0.7 : el.shape === 'flag' ? el.size * 0.75 : el.size / 2;
    const g = half + el.gap;
    const pos = {
      left: { x: x - g, y, anchor: 'right' }, right: { x: x + g, y, anchor: 'left' },
      top: { x, y: y - g - (el.shape === 'pin' ? el.size * 1.2 : 0), anchor: 'bottom' }, bottom: { x, y: y + g, anchor: 'top' },
    }[el.side] || { x: x - g, y, anchor: 'right' };
    const lb = boxLabel(ctx, { x: pos.x + (el.ldx || 0), y: pos.y + (el.ldy || 0), text: el.text, style: el.labelStyle, size: el.labelSize, anchor: pos.anchor, pad: el.labelSize * 0.4 });
    if (el.leader !== 'none' || el.ldx || el.ldy) {
      const b = lb.box;
      const lc = (LABEL_STYLES[el.labelStyle]?.bg) || (luminance(ctx.doc.style.land) > 0.5 ? '#111111' : '#ffffff');
      if (el.leader === 'under') {
        // Leader runs to the label and underlines it (the classic city-call-out).
        const ux = x < b.cx ? b.x : b.x + b.w, uy = b.y + b.h + 4;
        s += `<path d="M${f1(x)} ${f1(y)}L${f1(ux)} ${f1(uy)}L${f1(x < b.cx ? b.x + b.w : b.x)} ${f1(uy)}" fill="none" stroke="${lc}" stroke-width="2"/>`;
      } else if (el.leader !== 'none' || Math.hypot(el.ldx || 0, el.ldy || 0) > el.size) {
        const tx = Math.max(b.x, Math.min(x, b.x + b.w)), ty = Math.max(b.y, Math.min(y, b.y + b.h));
        s += `<line x1="${f1(x)}" y1="${f1(y)}" x2="${f1(tx)}" y2="${f1(ty)}" stroke="${lc}" stroke-width="2"${el.leader === 'dashed' ? ' stroke-dasharray="6 5"' : ''}/>`;
      }
    }
    s += shape + `<g data-part="label">${lb.svg}</g>`;
    return s;
  }
  return shape;
}

/* ---------- free label ---------- */

function label(el, ctx) {
  const p = ctx.proj(el.at);
  if (!p) return '';
  const lb = boxLabel(ctx, { x: p[0], y: p[1], text: el.text, style: el.style, size: el.size, color: el.color, bg: el.bg, accent: el.accent, pad: el.pad, rotate: el.rotate });
  let s = '';
  if (el.leaderOn && el.to) {
    const q = ctx.proj(el.to);
    if (q) {
      const b = lb.box;
      const col = el.leaderColor || LABEL_STYLES[el.style]?.bg || '#111111';
      const da = el.leaderDash === 'dashed' ? ' stroke-dasharray="7 6"' : el.leaderDash === 'dotted' ? ' stroke-dasharray="1 5" stroke-linecap="round"' : '';
      let d;
      if (el.leaderElbow === 'none') {
        const tx = Math.max(b.x, Math.min(q[0], b.x + b.w)), ty = Math.max(b.y, Math.min(q[1], b.y + b.h));
        d = `M${f1(tx)} ${f1(ty)}L${f1(q[0])} ${f1(q[1])}`;
      } else if (el.leaderElbow === 'h') {
        const sx = q[0] > b.cx ? b.x + b.w : b.x;
        d = `M${f1(sx)} ${f1(b.cy)}L${f1(q[0])} ${f1(b.cy)}L${f1(q[0])} ${f1(q[1])}`;
      } else {
        const sy = q[1] > b.cy ? b.y + b.h : b.y;
        const sx = Math.max(b.x + 6, Math.min(q[0], b.x + b.w - 6));
        d = `M${f1(sx)} ${f1(sy)}L${f1(sx)} ${f1(q[1])}L${f1(q[0])} ${f1(q[1])}`;
      }
      s += `<path d="${d}" fill="none" stroke="${esc(col)}" stroke-width="2.5"${da}/><circle cx="${f1(q[0])}" cy="${f1(q[1])}" r="5" fill="${esc(col)}" stroke="#ffffff" stroke-width="2"/>`;
    }
  }
  return s + lb.svg;
}

/* ---------- line / route ---------- */

export function linePath(el, ctx) {
  const pts = el.points.map((p) => ctx.proj(p)).filter(Boolean);
  if (pts.length < 2) return { d: '', pts, end: null };
  let d, end;
  if (el.mode === 'geo') {
    d = ctx.path({ type: 'LineString', coordinates: el.points }) || '';
    const n = pts.length;
    end = [pts[n - 2], pts[n - 1]];
  } else if (el.mode === 'smooth' && pts.length > 2) {
    d = d3line().curve(curveCatmullRom.alpha(0.5))(pts);
    end = [pts[pts.length - 2], pts[pts.length - 1]];
  } else if (el.mode === 'arc') {
    d = `M${f1(pts[0][0])} ${f1(pts[0][1])}`;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const mx = (ax + bx) / 2, my = (ay + by) / 2, dx = bx - ax, dy = by - ay;
      const k = el.bend ?? 0.28;
      const cx = mx - dy * k, cy = my + dx * k;
      d += `Q${f1(cx)} ${f1(cy)} ${f1(bx)} ${f1(by)}`;
      if (i === pts.length - 1) end = [[cx, cy], [bx, by]];
    }
  } else {
    d = 'M' + pts.map((p) => `${f1(p[0])} ${f1(p[1])}`).join('L');
    end = [pts[pts.length - 2], pts[pts.length - 1]];
  }
  return { d, pts, end };
}

function arrowHead(a, b, w, color) {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const L = Math.max(14, w * 3.4), Wd = Math.max(10, w * 2.6);
  const bx = b[0] - Math.cos(ang) * L, by = b[1] - Math.sin(ang) * L;
  const px = -Math.sin(ang) * Wd / 2, py = Math.cos(ang) * Wd / 2;
  return `<path d="M${f1(b[0] + Math.cos(ang) * 2)} ${f1(b[1] + Math.sin(ang) * 2)}L${f1(bx + px)} ${f1(by + py)}L${f1(bx - px)} ${f1(by - py)}Z" fill="${esc(color)}"/>`;
}

function line(el, ctx) {
  const { d, pts, end } = linePath(el, ctx);
  if (!d) return '';
  let s = '';
  const op = el.opacity < 1 ? ` opacity="${el.opacity}"` : '';
  // In the editor, a wide invisible band makes thin lines easy to hover and grab.
  if (ctx.editing) s += `<path d="${d}" fill="none" stroke="transparent" stroke-width="${f1(Math.max(18, el.width + 14))}" pointer-events="stroke" stroke-linecap="round"/>`;
  if (el.glow) s += `<path d="${d}" fill="none" stroke="${esc(el.color)}" stroke-width="${f1(el.width * 3.2)}" stroke-opacity=".45" filter="url(#f-glow)" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (el.casing) s += `<path d="${d}" fill="none" ${strokeAttrs(el.casing, el.width + el.casingWidth * 2, 'solid')}/>`;
  s += `<path d="${d}" fill="none" ${strokeAttrs(el.color, el.width, el.dash)}/>`;
  if (el.arrow === 'end' || el.arrow === 'both') s += arrowHead(end[0], end[1], el.width, el.color);
  if (el.arrow === 'both') s += arrowHead(pts[1], pts[0], el.width, el.color);
  if (el.dist) {
    const km = geoLength({ type: 'LineString', coordinates: el.points }) * 6371;
    const text = el.distText || `${fmtNum(km)} كم`;
    // Midpoint along the drawn polyline
    let total = 0;
    const segs = [];
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(l); total += l; }
    let acc = 0, i = 0;
    while (i < segs.length - 1 && acc + segs[i] < total / 2) acc += segs[i++];
    const t = segs[i] ? (total / 2 - acc) / segs[i] : 0.5;
    const a = pts[i], b = pts[i + 1];
    let ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
    const mx = a[0] + (b[0] - a[0]) * t, my = a[1] + (b[1] - a[1]) * t;
    const rad = (ang * Math.PI) / 180;
    const ox = -Math.sin(rad) * el.distOffset, oy = Math.cos(rad) * el.distOffset;
    s += `<g transform="rotate(${ang.toFixed(1)} ${f1(mx + ox)} ${f1(my + oy)})">${textSVG(text, { x: mx + ox, y: my + oy, size: el.distSize, family: ctx.font, weight: 600, color: el.distColor || el.color })}</g>`;
  }
  return op ? `<g${op}>${s}</g>` : s;
}

/* ---------- area (drawn polygon) ---------- */

export function areaPath(el, ctx) {
  const pts = el.points.map((p) => ctx.proj(p)).filter(Boolean);
  if (pts.length < 3) return { d: pts.length === 2 ? `M${pts[0]}L${pts[1]}` : '', pts };
  const d = el.smooth ? d3line().curve(curveCatmullRomClosed.alpha(0.5))(pts) : 'M' + pts.map((p) => `${f1(p[0])} ${f1(p[1])}`).join('L') + 'Z';
  return { d, pts };
}

function area(el, ctx) {
  const { d } = areaPath(el, ctx);
  if (!d) return '';
  let s = `<path d="${d}" fill="${esc(el.fill)}" fill-opacity="${el.opacity}" stroke="none"/>`;
  if (el.hatch) s += `<path d="${d}" fill="${hatchDef(ctx, el.id, el.hatchColor, el.hatchGap, el.hatchAngle, el.hatchWidth)}"/>`;
  if (el.stroke && el.stroke !== 'none' && el.strokeWidth) s += `<path d="${d}" fill="none" ${strokeAttrs(el.stroke, el.strokeWidth, el.dash)}/>`;
  return s;
}

/* ---------- circle (radius in km) ---------- */

function circle(el, ctx) {
  const d = ctx.path(geoCircle().center(el.at).radius(el.radius / 111.32).precision(2)());
  if (!d) return '';
  return `<path d="${d}" fill="${esc(el.fill)}" fill-opacity="${el.opacity}" ${strokeAttrs(el.stroke, el.strokeWidth, el.dash)}/>`;
}

/* ---------- frame (area of interest) ---------- */

function frame(el, ctx) {
  const A = ctx.proj(el.a), B = ctx.proj(el.b);
  if (!A || !B) return '';
  const x = Math.min(A[0], B[0]), y = Math.min(A[1], B[1]), w = Math.abs(B[0] - A[0]), h = Math.abs(B[1] - A[1]);
  let s = ctx.editing ? `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" fill="none" stroke="transparent" stroke-width="18" pointer-events="stroke"/>` : '';
  s += `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" fill="${el.fill ? esc(el.fill) : 'none'}"${el.fill ? ` fill-opacity="${el.opacity}"` : ''} ${strokeAttrs(el.stroke, el.strokeWidth, el.dash)}/>`;
  if (el.text) s += boxLabel(ctx, { x: x + w, y: y - 26, text: el.text, style: 'light', size: 30, anchor: 'right', pad: 12 }).svg;
  return s;
}

/* ---------- callout: a round window with a photo or satellite view ---------- */

function callout(el, ctx) {
  const { x, y, r } = el;
  const q = ctx.proj(el.at);
  const cid = `cp-${el.id}`;
  const shape = el.shape === 'rect'
    ? `<rect x="${f1(x - r)}" y="${f1(y - r * 0.72)}" width="${f1(r * 2)}" height="${f1(r * 1.44)}" rx="${f1(r * 0.08)}"/>`
    : `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}"/>`;
  ctx.defs.push(`<clipPath id="${cid}">${shape}</clipPath>`);
  let inner = '';
  if (el.source === 'image' && ctx.doc.assets[el.asset]) {
    inner = `<image href="${ctx.doc.assets[el.asset]}" x="${f1(x - r)}" y="${f1(y - r)}" width="${f1(r * 2)}" height="${f1(r * 2)}" preserveAspectRatio="xMidYMid slice"/>`;
  } else {
    const c = el.satCenter || el.at;
    const tiles = insetTiles(c[0], c[1], el.satZoom, r * 2, r * 2);
    inner = tiles.map((t) => `<image href="${t.href}" x="${f1(x - r + t.x)}" y="${f1(y - r + t.y)}" width="${f1(t.w + 0.5)}" height="${f1(t.h + 0.5)}" preserveAspectRatio="none"/>`).join('');
    ctx.credits.add(SAT_CREDIT);
  }
  let leader = '';
  if (q && el.leader !== 'none') {
    const col = esc(el.leaderColor), da = el.leaderDash === 'dashed' ? ` stroke-dasharray="${f1(el.leaderWidth * 2.6 + 3)} ${f1(el.leaderWidth * 2 + 3)}"` : '';
    const edgeX = q[0] < x ? x - r : x + r;
    let d;
    if (el.leader === 'elbow' && Math.abs(q[0] - x) > r) d = `M${f1(q[0])} ${f1(q[1])}L${f1(q[0])} ${f1(y)}L${f1(edgeX)} ${f1(y)}`;
    else { const a = Math.atan2(q[1] - y, q[0] - x); d = `M${f1(q[0])} ${f1(q[1])}L${f1(x + Math.cos(a) * r)} ${f1(y + Math.sin(a) * r)}`; }
    leader = `<path d="${d}" fill="none" stroke="${col}" stroke-width="${el.leaderWidth}"${da}/>`;
  }
  const dot = q && el.dot ? `<circle cx="${f1(q[0])}" cy="${f1(q[1])}" r="9" fill="${esc(el.dotColor)}" stroke="#ffffff" stroke-width="3"/>` : '';
  const border = shape.replace('/>', ` fill="none" stroke="${esc(el.border)}" stroke-width="${el.borderWidth}"/>`);
  return `${leader}${dot}<g clip-path="url(#${cid})"><g${el.gray ? ' filter="url(#f-gray)"' : ''}>${inner}</g></g>${border}`;
}

/* ---------- text box (title + body) ---------- */

function textbox(el, ctx) {
  const font = ctx.font;
  const inner = el.w - el.pad * 2;
  const tl = el.title ? wrapRich(el.title, inner, el.titleSize, font, { normal: 700, bold: 800 }) : [];
  const bl = el.body ? wrapRich(el.body, inner, el.bodySize, font) : [];
  const titleLH = 1.35;
  const th = tl.length * el.titleSize * titleLH;
  const gap = tl.length && bl.length ? el.bodySize * 0.55 : 0;
  const bh = bl.length * el.bodySize * el.lineHeight;
  const h = el.pad * 2 + th + gap + bh - (bl.length ? el.bodySize * (el.lineHeight - 1) * 0.5 : 0);
  const ax = el.align === 'center' ? el.x + el.w / 2 : el.align === 'left' ? el.x + el.pad : el.x + el.w - el.pad;
  let s = '';
  if (el.bgOpacity > 0) s += `<rect x="${f1(el.x)}" y="${f1(el.y)}" width="${f1(el.w)}" height="${f1(h)}" rx="${el.radius || 0}" fill="${esc(el.bg)}" fill-opacity="${el.bgOpacity}"${el.shadow ? ' filter="url(#f-shadow)"' : ''}/>`;
  let y = el.y + el.pad;
  // Parts let the editor type into the title or the body; exports drop the wrappers' meaning.
  const part = (name, svg) => (ctx.editing ? `<g data-part="${name}">${svg}</g>` : svg);
  if (tl.length) {
    s += part('title', richTextSVG(tl, { x: ax, y: y + el.titleSize * 0.95, size: el.titleSize, lineHeight: titleLH, family: font, color: el.titleColor || el.color, accent: el.accent, align: el.align, weight: 700, boldWeight: 800 }));
    y += th + gap;
  }
  if (bl.length) s += part('body', richTextSVG(bl, { x: ax, y: y + el.bodySize * 1.0, size: el.bodySize, lineHeight: el.lineHeight, family: font, color: el.color, accent: el.accent, align: el.align }));
  ctx.boxes.set(el.id, { x: el.x, y: el.y, w: el.w, h });
  return s;
}

/* ---------- legend (auto-collects every element given a legend name) ---------- */

export function legendItems(doc) {
  const items = [];
  for (const e of doc.elements) {
    if (!e.legend || e.hidden) continue;
    if (e.type === 'region' || e.type === 'area') items.push({ kind: 'swatch', color: e.fill, opacity: e.type === 'area' ? Math.max(0.6, e.opacity) : e.opacity, hatch: e.hatch ? e.hatchColor : null, stroke: e.type === 'area' ? e.stroke : null, label: e.legend });
    else if (e.type === 'circle') items.push({ kind: 'circle', color: e.fill, stroke: e.stroke, label: e.legend });
    else if (e.type === 'line') items.push({ kind: 'line', color: e.color, dash: e.dash, width: e.width, label: e.legend });
    else if (e.type === 'marker') items.push({ kind: 'marker', el: e, label: e.legend });
  }
  return items;
}

function legend(el, ctx) {
  const items = el.auto ? legendItems(ctx.doc) : el.items;
  const font = ctx.font, size = el.size, pad = el.pad, sw = size * 1.05, gap = el.gap;
  const rowH = Math.max(sw, size * 1.25);
  const titleH = el.title ? size * 1.5 : 0;
  const textW = Math.max(80, ...items.map((i) => measure(i.label, size, 500, font)), el.title ? measure(el.title, size, 700, font) : 0);
  const w = pad * 2 + sw + 14 + textW;
  const h = pad * 2 + titleH + Math.max(1, items.length) * rowH + Math.max(0, items.length - 1) * gap;
  const { x, y } = el;
  let s = el.bgOpacity > 0 ? `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" fill="${esc(el.bg)}" fill-opacity="${el.bgOpacity}"/>` : '';
  if (el.title) s += textSVG(el.title, { x: x + w - pad, y: y + pad + size * 0.55, size, family: font, weight: 700, color: el.color, anchor: 'start' });
  if (!items.length) s += textSVG('أعطِ العناصر اسمًا في المفتاح', { x: x + w - pad, y: y + pad + titleH + rowH / 2, size: size * 0.7, family: font, color: el.color, anchor: 'start', opacity: 0.6 });
  items.forEach((it, i) => {
    const cy = y + pad + titleH + i * (rowH + gap) + rowH / 2;
    const sx = x + w - pad - sw, sy = cy - sw / 2;
    if (it.kind === 'swatch') {
      s += `<rect x="${f1(sx)}" y="${f1(sy)}" width="${f1(sw)}" height="${f1(sw)}" fill="${esc(it.color)}" fill-opacity="${it.opacity ?? 1}"${it.stroke ? ` stroke="${esc(it.stroke)}" stroke-width="2"` : ''}/>`;
      if (it.hatch) s += `<rect x="${f1(sx)}" y="${f1(sy)}" width="${f1(sw)}" height="${f1(sw)}" fill="${hatchDef(ctx, el.id + i, it.hatch, 7, 45, 1.4)}"/>`;
    } else if (it.kind === 'circle') {
      s += `<circle cx="${f1(sx + sw / 2)}" cy="${f1(cy)}" r="${f1(sw / 2)}" fill="${esc(it.color)}" stroke="${esc(it.stroke || 'none')}" stroke-width="2"/>`;
    } else if (it.kind === 'line') {
      s += `<line x1="${f1(sx)}" y1="${f1(cy)}" x2="${f1(sx + sw)}" y2="${f1(cy)}" ${strokeAttrs(it.color, Math.min(it.width, 6), it.dash)}/>`;
    } else if (it.kind === 'marker') {
      const m = { ...it.el, size: Math.min(it.el.size, sw * (it.el.shape === 'pulse' ? 0.75 : 1)), text: '' };
      s += markerShape(m, sx + sw / 2, cy + (m.shape === 'pin' ? m.size * 0.8 : 0), ctx);
    }
    s += textSVG(it.label, { x: sx - 14, y: cy, size, family: font, weight: 500, color: el.color, anchor: 'start' });
  });
  ctx.boxes.set(el.id, { x, y, w, h });
  return s;
}

/* ---------- image (logo, photo) ---------- */

function image(el, ctx) {
  const src = ctx.doc.assets[el.asset];
  ctx.boxes.set(el.id, { x: el.x, y: el.y, w: el.w, h: el.h });
  if (!src) return `<rect x="${f1(el.x)}" y="${f1(el.y)}" width="${f1(el.w)}" height="${f1(el.h)}" fill="none" stroke="#999" stroke-dasharray="6 5"/>`;
  return `<image href="${src}" x="${f1(el.x)}" y="${f1(el.y)}" width="${f1(el.w)}" height="${f1(el.h)}" preserveAspectRatio="xMidYMid meet"${el.opacity < 1 ? ` opacity="${el.opacity}"` : ''}/>`;
}

/** The lines between shaded regions that touch (see sharedEdges), drawn over all the shading. */
export function regionEdges(ctx) {
  if (ctx.mapDrawsRegions) return '';
  return sharedEdges(ctx.doc, ctx.lod).features.map((f) => {
    const d = ctx.path(f);
    return d ? `<path d="${d}" fill="none" stroke="${esc(f.properties.color)}"${f.properties.opacity < 1 ? ` stroke-opacity="${f.properties.opacity}"` : ''} stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/>` : '';
  }).join('');
}

export const RENDER = { region, marker, label, line, area, circle, frame, callout, textbox, legend, image };

export function renderElement(el, ctx) {
  if (el.hidden) return '';
  try {
    const s = RENDER[el.type]?.(el, ctx) || '';
    return s ? `<g data-el="${el.id}" id="${esc(layerName(el))}">${s}</g>` : `<g data-el="${el.id}"></g>`;
  } catch (e) {
    console.warn('render', el.type, e);
    return '';
  }
}

const NAMES_EN = { region: 'Shade', marker: 'Marker', label: 'Label', line: 'Line', area: 'Area', circle: 'Circle', frame: 'Frame', callout: 'Lens', textbox: 'TextBox', legend: 'Legend', image: 'Image' };
export function layerName(el) {
  const t = (el.name || el.text || el.title || el.legend || el.a3 || '').toString().replace(/\*\*|==/g, '').trim().slice(0, 28);
  return `${NAMES_EN[el.type] || el.type}${t ? '_' + t.replace(/\s+/g, '_') : ''}_${el.id.slice(-4)}`;
}
export { fontStack };
