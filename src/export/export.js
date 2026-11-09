// Getting the map out: layered SVG (Illustrator / Figma), PNG at any scale,
// a ZIP of transparent layer PNGs for the editors (After Effects / Premiere), and the project file.
import JSZip from 'jszip';
import { composeSVG, isReal } from '../render/compose.js';
import { realVectorSVG, realMapCanvas } from './realexport.js';
import { inlineImages } from '../geo/tiles.js';
import { FONTS } from '../presets.js';
import { download, fileSafe, blobToDataURL } from '../util.js';

/* ---------- fonts embedded only for the glyphs used ---------- */

export const customFonts = new Map(); // family → dataURL (uploaded by the user)

async function fontCSSFor(svg, family) {
  if (customFonts.has(family)) return `@font-face{font-family:"${family}";src:url(${customFonts.get(family)});}`;
  const f = FONTS.find((x) => x.family === family) || FONTS[0];
  const chars = [...new Set(svg.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, ' '))].join('');
  const url = `https://fonts.googleapis.com/css2?family=${f.family.replace(/ /g, '+')}:wght@${f.weights.join(';')}&text=${encodeURIComponent(chars)}`;
  try {
    let css = await (await fetch(url)).text();
    const urls = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]))];
    for (const u of urls) {
      const data = await blobToDataURL(await (await fetch(u)).blob());
      css = css.split(u).join(data);
    }
    return css;
  } catch { return ''; }
}

/** The standalone SVG. `embed` inlines satellite tiles, flags, and fonts so it renders anywhere. */
export async function buildSVG(doc, { transparent = false, embed = false, elementsOnly = false, overlayOnly = false, onProgress } = {}) {
  let realBase = null;
  if (isReal(doc) && !elementsOnly && !overlayOnly && !transparent) {
    onProgress?.(0.1);
    realBase = await realVectorSVG(doc); // the live map, rebuilt as vectors
    onProgress?.(0.45);
  }
  let svg = composeSVG(doc, { transparent, elementsOnly, overlayOnly, realBase: realBase ?? undefined });
  if (embed) {
    svg = await inlineImages(svg, (p) => onProgress?.(p * 0.7));
    const css = await fontCSSFor(svg, doc.font);
    if (css) svg = svg.replace('<defs>', `<defs><style>${css}</style>`);
  }
  onProgress?.(0.8);
  return svg;
}

export async function rasterize(svg, w, h, scale = 2, under = null) {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'sync';
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const g = c.getContext('2d');
    if (under) g.drawImage(under, 0, 0, c.width, c.height); // e.g. the real map
    g.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob(res, 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}

/** A finished PNG blob: the real map drawn offscreen at full resolution, or the vector map. */
export async function renderPNG(doc, { scale = 2, transparent = false, onProgress } = {}) {
  if (isReal(doc) && !transparent) {
    onProgress?.(0.1);
    const map = await realMapCanvas(doc, scale);
    onProgress?.(0.6);
    const svg = await buildSVG(doc, { overlayOnly: true, embed: true });
    return rasterize(svg, doc.artboard.w, doc.artboard.h, scale, map);
  }
  const svg = await buildSVG(doc, { transparent, embed: true, overlayOnly: isReal(doc), onProgress });
  return rasterize(svg, doc.artboard.w, doc.artboard.h, scale);
}

export async function exportSVG(doc, opts = {}) {
  const svg = await buildSVG(doc, { ...opts, embed: opts.embed ?? false });
  download(new Blob([svg], { type: 'image/svg+xml' }), fileSafe(doc.name) + '.svg');
}

export async function exportPNG(doc, { scale = 2, transparent = false, onProgress } = {}) {
  const png = await renderPNG(doc, { scale, transparent, onProgress });
  onProgress?.(1);
  download(png, `${fileSafe(doc.name)}@${scale}x.png`);
}

/** Copies the SVG so it pastes straight into Figma or Illustrator as vectors. */
export async function copySVG(doc) {
  const svg = await buildSVG(doc, { embed: false });
  try {
    if (window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([svg], { type: 'text/plain' }) })]);
    } else await navigator.clipboard.writeText(svg);
    return true;
  } catch { return false; }
}

/**
 * One transparent PNG per layer, same size, ready to stack and animate in After Effects / Premiere:
 * 00-basemap, then every element in order, plus the full SVG.
 */
export async function exportLayersZip(doc, { scale = 1, onProgress } = {}) {
  const zip = new JSZip();
  const { w, h } = doc.artboard;
  // File names stay ASCII (After Effects, Premiere and old unzip tools choke on Arabic names);
  // layers.txt maps each file to its Arabic name.
  const steps = [];
  const manifest = ['00-basemap.png\tالخريطة الأساسية'];
  steps.push({ name: '00-basemap', doc: { ...doc, elements: [] } });
  const visible = doc.elements.filter((e) => !e.hidden);
  visible.forEach((el, i) => {
    const only = doc.elements.map((e) => (e.id === el.id ? e : { ...e, hidden: true }));
    const name = `${String(i + 1).padStart(2, '0')}-${el.type}${el.a3 ? '-' + el.a3 : ''}`;
    manifest.push(`${name}.png\t${(el.name || el.text || el.title || el.legend || el.type).toString().replace(/\*\*|==|\n/g, ' ').slice(0, 60)}`);
    steps.push({ name, doc: { ...doc, elements: only }, transparent: true });
  });
  zip.file('layers.txt', '﻿' + manifest.join('\n'));
  let i = 0;
  for (const s of steps) {
    const png = s.transparent
      ? await rasterize(await buildSVG(s.doc, { transparent: true, elementsOnly: true, embed: true }), w, h, scale)
      : await renderPNG(s.doc, { scale });
    zip.file(`${s.name}.png`, png);
    onProgress?.(++i / (steps.length + 1));
  }
  zip.file('map.svg', await buildSVG(doc, { embed: false }));
  const blob = await zip.generateAsync({ type: 'blob' });
  onProgress?.(1);
  download(blob, `${fileSafe(doc.name)}-layers.zip`);
}

export function saveProject(doc) {
  const blob = new Blob([JSON.stringify({ app: 'aj-map-studio', ...doc })], { type: 'application/json' });
  download(blob, fileSafe(doc.name) + '.ajmap');
}
