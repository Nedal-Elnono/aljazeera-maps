// Smart guides, ported from BrandingOS (features/editor/adapter/snapGuides.ts) and extended:
// a moving box snaps its left / center / right and top / middle / bottom to the same lines of
// every other thing on the map and of the post frame, and the guide spans everything that lines up.
// Pure: boxes in, offsets and guide segments out.

export const SNAP_THRESHOLD_PX = 5;

/** @typedef {{x:number,y:number,width:number,height:number}} BBox */

const linesX = (b) => [b.x, b.x + b.width / 2, b.x + b.width];
const linesY = (b) => [b.y, b.y + b.height / 2, b.y + b.height];

/**
 * @param {BBox} moving
 * @param {BBox[]} others
 * @param {number} threshold  in the same units as the boxes
 * @returns {{dx:number, dy:number, guides:{axis:'x'|'y', pos:number, from:number, to:number}[]}}
 */
export function computeSnap(moving, others, threshold = SNAP_THRESHOLD_PX) {
  const best = (lines, get) => {
    let d = null;
    for (const o of others) for (const t of get(o)) for (const m of lines) {
      const delta = t - m;
      if (Math.abs(delta) <= threshold && (d === null || Math.abs(delta) < Math.abs(d))) d = delta;
    }
    return d;
  };
  const dx = best(linesX(moving), linesX);
  const dy = best(linesY(moving), linesY);
  const snapped = { x: moving.x + (dx || 0), y: moving.y + (dy || 0), width: moving.width, height: moving.height };
  const guides = [];
  const eps = 0.5;
  // One guide per line that now matches, running across every box sitting on it.
  if (dx !== null) for (const m of linesX(snapped)) {
    const hits = others.filter((o) => linesX(o).some((t) => Math.abs(t - m) < eps));
    if (!hits.length) continue;
    const ys = [snapped, ...hits].flatMap((b) => [b.y, b.y + b.height]);
    guides.push({ axis: 'x', pos: m, from: Math.min(...ys), to: Math.max(...ys) });
  }
  if (dy !== null) for (const m of linesY(snapped)) {
    const hits = others.filter((o) => linesY(o).some((t) => Math.abs(t - m) < eps));
    if (!hits.length) continue;
    const xs = [snapped, ...hits].flatMap((b) => [b.x, b.x + b.width]);
    guides.push({ axis: 'y', pos: m, from: Math.min(...xs), to: Math.max(...xs) });
  }
  return { dx: dx || 0, dy: dy || 0, guides };
}

/** Guide segments as SVG, in artboard units. */
export function guidesSVG(guides, z) {
  const w = 1 / z, t = 3.5 / z;
  return guides.map((g) => g.axis === 'x'
    ? `<line class="guide" x1="${g.pos}" y1="${g.from}" x2="${g.pos}" y2="${g.to}" stroke-width="${w}"/><path class="guide" d="M${g.pos - t} ${g.from - t}l${2 * t} ${2 * t}m0 ${-2 * t}l${-2 * t} ${2 * t}M${g.pos - t} ${g.to - t}l${2 * t} ${2 * t}m0 ${-2 * t}l${-2 * t} ${2 * t}" stroke-width="${w}"/>`
    : `<line class="guide" x1="${g.from}" y1="${g.pos}" x2="${g.to}" y2="${g.pos}" stroke-width="${w}"/><path class="guide" d="M${g.from - t} ${g.pos - t}l${2 * t} ${2 * t}m0 ${-2 * t}l${-2 * t} ${2 * t}M${g.to - t} ${g.pos - t}l${2 * t} ${2 * t}m0 ${-2 * t}l${-2 * t} ${2 * t}" stroke-width="${w}"/>`).join('');
}

export const union = (boxes) => {
  if (!boxes.length) return null;
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width)), y1 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
};
export const intersects = (a, b) => !(a.x + a.width < b.x || b.x + b.width < a.x || a.y + a.height < b.y || b.y + b.height < a.y);
export const contains = (a, b) => b.x >= a.x && b.y >= a.y && b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height;
