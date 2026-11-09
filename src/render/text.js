// Arabic text for SVG: measuring, wrapping and light markup (**bold**, ==accent==).
// SVG has no line wrapping, so lines are laid out here and written as <tspan>s, which keeps
// the text live and editable in Illustrator and Figma.
import { esc } from '../util.js';

const ctx = document.createElement('canvas').getContext('2d');
const cache = new Map();

export function fontStack(family) {
  return `"${family}", "IBM Plex Sans Arabic", "Noto Kufi Arabic", Tahoma, sans-serif`;
}

export function measure(text, size, weight = 400, family = 'IBM Plex Sans Arabic') {
  const k = `${family}|${weight}|${size}|${text}`;
  let w = cache.get(k);
  if (w === undefined) {
    ctx.font = `${weight} ${size}px ${fontStack(family)}`;
    ctx.direction = 'rtl';
    w = ctx.measureText(text).width;
    if (cache.size > 20000) cache.clear();
    cache.set(k, w);
  }
  return w;
}
export const clearMeasureCache = () => cache.clear();

/** "**a** b ==c==" → [{t:'a',b:1},{t:' b '},{t:'c',a:1}] */
export function parseRich(s) {
  const runs = [];
  const re = /(\*\*([^*]+)\*\*|==([^=]+)==)/g;
  let i = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > i) runs.push({ t: s.slice(i, m.index) });
    if (m[2] !== undefined) runs.push({ t: m[2], b: 1 });
    else runs.push({ t: m[3], a: 1, b: 1 });
    i = m.index + m[0].length;
  }
  if (i < s.length) runs.push({ t: s.slice(i) });
  return runs;
}

/**
 * Wrap rich text to a width. Returns lines: [{runs:[{t,b,a}], w}].
 * Paragraphs split on newlines.
 */
export function wrapRich(text, maxW, size, family, weights = { normal: 400, bold: 700 }) {
  const lines = [];
  for (const para of String(text ?? '').split('\n')) {
    const words = [];
    for (const r of parseRich(para)) {
      const parts = r.t.split(/(\s+)/);
      for (const p of parts) if (p) words.push({ ...r, t: p, space: /^\s+$/.test(p) });
    }
    // Pieces with no space between them (e.g. "و" + "==كلمة==") are one word: never wrap inside it.
    const groups = [];
    for (const word of words) {
      word.w = measure(word.t, size, word.b ? weights.bold : weights.normal, family);
      const last = groups[groups.length - 1];
      if (!word.space && last && !last.space) { last.parts.push(word); last.w += word.w; }
      else groups.push({ space: word.space, parts: [word], w: word.w });
    }
    let cur = [], w = 0;
    const flush = () => {
      while (cur.length && cur[cur.length - 1].space) w -= cur.pop().w;
      lines.push({ runs: merge(cur), w });
      cur = []; w = 0;
    };
    for (const g of groups) {
      if (g.space && !cur.length) continue;
      if (!g.space && w + g.w > maxW && cur.length) flush();
      cur.push(...g.parts); w += g.w;
    }
    flush();
  }
  return lines;
}
function merge(words) {
  const out = [];
  for (const w of words) {
    const last = out[out.length - 1];
    if (last && !!last.b === !!w.b && !!last.a === !!w.a) last.t += w.t;
    else out.push({ t: w.t, b: w.b, a: w.a });
  }
  return out;
}

/**
 * SVG <text> for wrapped lines. align: right|center|left in RTL terms; x is the anchor edge.
 */
export function richTextSVG(lines, { x, y, size, lineHeight = 1.6, family, color, accent, align = 'right', weight = 400, boldWeight = 700 }) {
  const anchor = align === 'center' ? 'middle' : align === 'left' ? 'end' : 'start';
  const lh = size * lineHeight;
  // One <text> per line: WebKit, Illustrator and Figma reorder RTL lines that share a <text>.
  const rows = lines.map((ln, i) => {
    const spans = ln.runs.map((r) => {
      const attrs = [];
      if (r.b) attrs.push(`font-weight="${boldWeight}"`);
      if (r.a) attrs.push(`fill="${esc(accent)}"`);
      return attrs.length ? `<tspan ${attrs.join(' ')}>${esc(r.t)}</tspan>` : esc(r.t);
    }).join('');
    return `<text x="${x.toFixed(1)}" y="${(y + i * lh).toFixed(1)}" direction="rtl" text-anchor="${anchor}" font-family="${esc(fontStack(family))}" font-size="${size}" font-weight="${weight}" fill="${esc(color)}">${spans || ' '}</text>`;
  }).join('');
  return `<g>${rows}</g>`;
}

/** One-line label as SVG text (centered on x,y unless anchor says otherwise). */
export function textSVG(t, { x, y, size, family, weight = 500, color = '#000', anchor = 'middle', halo = null, haloWidth = 0, opacity = 1, extra = '' }) {
  const haloAttr = halo ? ` stroke="${esc(halo)}" stroke-width="${haloWidth || Math.max(2, size * 0.16)}" stroke-linejoin="round" paint-order="stroke"` : '';
  const op = opacity < 1 ? ` opacity="${opacity}"` : '';
  // Baseline set by hand (not dominant-baseline) so Illustrator and Figma place it the same way.
  return `<text x="${x.toFixed(1)}" y="${(y + size * 0.36).toFixed(1)}" direction="rtl" text-anchor="${anchor}" font-family="${esc(fontStack(family))}" font-size="${size}" font-weight="${weight}" fill="${esc(color)}"${haloAttr}${op}${extra}>${esc(t)}</text>`;
}
