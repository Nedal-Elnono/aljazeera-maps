// The artboard on screen: renders layers into live <g>s, keeps the board fitted,
// previews map moves with a transform and redraws crisply when the gesture ends.
import { store, LAYOUT_TYPES } from '../store.js';
import { refSize, fitZoom } from '../presets.js';
import { makeContext, STATIC_DEFS, isReal, realBase } from '../render/compose.js';
import { real } from './realmap.js';
import { renderBase, renderLabels } from '../render/base.js';
import { renderElement, regionEdges, linePath, areaPath } from '../render/elements.js';
import { panView, zoomAround } from '../geo/projection.js';
import { rafThrottle, clamp } from '../util.js';
import { geoCircle } from 'd3';
import * as D from '../geo/data.js';
import { elBox } from './selection.js';
import { union } from './snap.js';
import { foldRoom } from '../ui/panels.js';
import { zoomBy } from './navigate.js';

let liveQueued = false;

/**
 * Slide a group drawn with projection P0 to where projection P1 puts it: Mercator pans and zooms
 * are a scale + shift of the plane. Line widths are divided back, so lines keep their thickness.
 */
function slideGroup(g, P0, P1, c) {
  const k = P1.scale() / P0.scale(), a = P0(c), b = P1(c);
  if (!a || !b || !Number.isFinite(k)) return;
  g.setAttribute('transform', `matrix(${k} 0 0 ${k} ${b[0] - k * a[0]} ${b[1] - k * a[1]})`);
  for (const n of g.querySelectorAll('[stroke-width]')) {
    if (!n.dataset.w) n.dataset.w = n.getAttribute('stroke-width');
    n.setAttribute('stroke-width', n.dataset.w / k);
  }
}
/** Things drawn around one point (a marker, a label without a pointer): moving the map just slides them. */
const slides = (el) => !el.hidden && Array.isArray(el.at) && (el.type === 'marker' || (el.type === 'label' && !(el.leaderOn && el.to)));

export const canvas = {
  stage: null, svg: null, g: {},
  ctx: null, baseKey: '',
  preview: null,   // {view, k, tx, ty} while the map is being moved
  fit: true,

  mount(stage) {
    this.stage = stage;
    // The map fills the whole stage; the post's size is a frame drawn over it.
    stage.innerHTML = `
      <div class="board" id="board">
        <svg id="art" xmlns="http://www.w3.org/2000/svg">
          <defs>${STATIC_DEFS}</defs><defs id="d-dyn"></defs>
          <g id="L-map"><g id="L-base"></g><g id="L-regions"></g><g id="L-hit"></g><g id="L-labels"></g><g id="L-geo"></g><g id="L-finish"></g></g>
          <g id="L-layout"></g>
          <g id="L-pick"></g>
          <g id="L-ui"></g>
        </svg>
      </div>
      <div class="frame" id="frame" aria-hidden="true"><div class="board-size f-mono" id="boardSize"></div></div>
      <div class="mapzoom f-glass" id="mapzoom" hidden>
        <button type="button" data-z="1" title="تقريب الخريطة"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>
        <div class="mapzoom__z f-mono" id="mapzoomZ"></div>
        <button type="button" data-z="-1" title="تبعيد الخريطة"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 12h14"/></svg></button>
      </div>`;
    stage.querySelector('#mapzoom').addEventListener('click', (e) => { const b = e.target.closest('[data-z]'); if (b) zoomBy(+b.dataset.z); });
    this.svg = stage.querySelector('#art');
    this.board = stage.querySelector('#board');
    this.frame = stage.querySelector('#frame');
    real.mount(stage);
    for (const id of ['L-map', 'L-base', 'L-hit', 'L-regions', 'L-labels', 'L-geo', 'L-finish', 'L-layout', 'L-pick', 'L-ui', 'd-dyn']) this.g[id] = this.svg.querySelector('#' + id);
    new ResizeObserver(() => this.fitToStage()).observe(stage);
  },

  /** The whole stage in artboard coordinates (the map is drawn this far, beyond the frame). */
  ext() {
    const g = this.geom;
    if (!g) return null;
    return { x0: -g.ox / g.z, y0: -g.oy / g.z, x1: (g.sw - g.ox) / g.z, y1: (g.sh - g.oy) / g.z };
  },

  /** Screen → artboard coordinates. */
  toArt(e) {
    const r = this.svg.getBoundingClientRect();
    return [(e.clientX - r.left) / store.zoom, (e.clientY - r.top) / store.zoom];
  },

  fitToStage() {
    const SW = this.stage.clientWidth, SH = this.stage.clientHeight;
    const DOCK = 92; // room for the floating dock under the frame
    const a = store.doc.artboard;
    const free = !!a.free;
    this.stage.classList.toggle('is-free', free);
    let ox, oy;
    if (free) {
      // No post size: the whole box is the canvas (and what gets exported) — at the scale the chosen
      // post would show at here, so names, markers and text keep their size when the frame toggles.
      // Folding a side panel doesn't count: it shows more map at the same scale.
      const r = refSize(a);
      const z = fitZoom(r.w, r.h, SW - foldRoom(), SH);
      // Same scale, different box (a panel folding): keep the map exactly where it is on screen —
      // same spot under the same pixels, and the same scale (the view's zoom is relative to the
      // board's width, which just changed).
      const st = this.stage.getBoundingClientRect(), g0 = this.geom, P0 = this.ctx?.proj, s0 = this.stageAt;
      const fw0 = Math.round(SW / z), fh0 = Math.round(SH / z);
      if (!a.fromPost && g0?.free && s0 && P0 && Math.abs(g0.z - z) < 1e-9 && (st.left !== s0.left || st.top !== s0.top || SW !== g0.sw || SH !== g0.sh)) {
        // The new board's middle, in the old board's units (whole board units: no rounding creep).
        const ll = P0.invert([(st.left - s0.left) / z + fw0 / 2, (st.top - s0.top) / z + fh0 / 2]);
        const v = store.doc.view;
        const dz = a.w > 0 && fw0 !== a.w ? Math.log2(a.w / fw0) : 0;
        if (ll && Number.isFinite(ll[0]) && Number.isFinite(ll[1])) store.doc.view = { ...v, center: [ll[0], ll[1]], zoom: v.zoom + dz };
        else if (dz) store.doc.view = { ...v, zoom: v.zoom + dz };
      }
      this.stageAt = { left: st.left, top: st.top };
      store.zoom = z;
      const fw = fw0, fh = fh0;
      if (a.fromPost) {
        // A project made with a post frame (see store.load): the post's middle becomes the canvas's
        // middle at the same map scale, and text boxes, legends, images and lenses keep their place.
        const dx = (fw - a.w) / 2, dy = (fh - a.h) / 2;
        for (const el of store.doc.elements) if (Number.isFinite(el.x) && Number.isFinite(el.y)) { el.x += dx; el.y += dy; }
        const v = store.doc.view;
        if (a.w > 0) store.doc.view = { ...v, zoom: v.zoom + Math.log2(a.w / fw) };
        const { fromPost, ...rest } = a;
        store.doc.artboard = { ...rest, w: fw, h: fh };
        store.rebase();
      } else if (a.w !== fw || a.h !== fh) store.doc.artboard = { ...a, w: fw, h: fh };
      ox = 0; oy = 0;
    }
    const { w, h } = store.doc.artboard;
    if (!free && this.fit) store.zoom = fitZoom(w, h, SW, SH);
    const z = store.zoom, bw = w * z, bh = h * z;
    if (!free) { ox = Math.round((SW - bw) / 2); oy = Math.round(Math.max(20, (SH - DOCK - bh) / 2 + 8)); }
    this.geom = { sw: SW, sh: SH, ox, oy, z, free };
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.svg.setAttribute('width', bw.toFixed(1));
    this.svg.setAttribute('height', bh.toFixed(1));
    for (const el of [this.board, this.frame]) Object.assign(el.style, { left: ox + 'px', top: oy + 'px', width: bw.toFixed(1) + 'px', height: bh.toFixed(1) + 'px' });
    this.board.style.setProperty('--z', z);
    real.layout(this.geom);
    this.stage.querySelector('#boardSize').textContent = `${w} × ${h} · ${Math.round(z * 100)}%`;
    if (this.ctx && !isReal(store.doc) && !this.slideEnding && document.getElementById('app')?.classList.contains('is-folding')) this.slideStep(free);
    else if (this.ctx) { this.render(true); this.drawnAt = this.stageAt; }
    else this.drawUI();
    store.emit('zoom');
  },

  /**
   * A side panel is sliding. The simplified map is one big SVG redraw (~100ms), far too slow for
   * every frame of the slide: keep the drawing as it is — shifted so the map stays still on screen
   * when there's no post frame (it moves with the frame otherwise) — and redraw once the slide is over.
   */
  slideStep(free) {
    const st = this.stage.getBoundingClientRect();
    if (!this.slide) this.slide = { left: this.drawnAt?.left ?? st.left, top: this.drawnAt?.top ?? st.top };
    const z = store.zoom;
    if (free) this.g['L-map'].setAttribute('transform', `translate(${(this.slide.left - st.left) / z} ${(this.slide.top - st.top) / z})`);
    this.ctx = makeContext(store.doc, { editing: true, ext: this.ext() }); // for the overlay and the next step
    this.drawUI();
    clearTimeout(this.slideT);
    this.slideT = setTimeout(() => {
      this.slide = null;
      this.g['L-map'].removeAttribute('transform');
      this.slideEnding = true;
      try { this.fitToStage(); } finally { this.slideEnding = false; }
    }, 140);
  },
  /** Change the post size (or turn it off) without the map jumping in scale. */
  setArtboard(next) {
    const g0 = this.geom, proj0 = this.ctx?.proj;
    const before = store.doc.artboard.w * store.zoom;
    store.update((d) => { d.artboard = next; }, { label: next.free ? 'إيقاف مقاس البوست' : 'مقاس البوست' });
    this.fit = true;
    this.fitToStage();
    const a = store.doc.artboard, g1 = this.geom;
    const after = a.w * store.zoom;
    // Keep the map still on screen: whatever sat where the new frame's middle is stays put.
    let center = null;
    if (proj0 && g0 && g1) {
      const cx = g1.ox + (a.w * g1.z) / 2, cy = g1.oy + (a.h * g1.z) / 2;
      const ll = proj0.invert([(cx - g0.ox) / g0.z, (cy - g0.oy) / g0.z]);
      if (ll && Number.isFinite(ll[0]) && Number.isFinite(ll[1])) center = [ll[0], ll[1]];
    }
    const dz = before > 0 && after > 0 && Math.abs(before - after) > 1 ? Math.log2(before / after) : 0;
    if (dz || center) store.update((d) => { d.view = { ...d.view, zoom: d.view.zoom + dz, ...(center ? { center } : {}) }; }, { commit: false, kind: 'view' });
  },

  setZoom(z) {
    this.fit = z === 'fit';
    if (!this.fit) store.zoom = clamp(z, 0.05, 4);
    this.fitToStage();
  },

  /** Full redraw when the view, style or data changed; otherwise only the overlay. */
  render(force = false) {
    const doc = store.doc;
    const realMode = isReal(doc);
    this.stage.classList.toggle('is-real', realMode);
    // Wherever the simplified map isn't drawn yet (a panel sliding, a drag), the stage shows its sea.
    this.stage.classList.toggle('has-sea', !realMode && !!doc.style.sea);
    if (!realMode && doc.style.sea) this.stage.style.setProperty('--map-sea', doc.style.sea);
    this.stage.classList.remove('is-moving');
    this.g['L-base'].removeAttribute('transform'); // left by a live frame (see liveFrame)
    if (this.slide) { // redrawn mid-slide (data arrived…): this drawing is the new reference
      const st = this.stage.getBoundingClientRect();
      this.slide = { left: st.left, top: st.top };
      this.g['L-map'].removeAttribute('transform');
    }
    if (realMode) {
      // The live map draws the base; we draw editorial borders, finish and everything on top.
      real.ensure();
      real.syncFromDoc();
      this.showZoom(); // after the sync: before it, the map still has the previous zoom
      this.ctx = makeContext(doc, { editing: true, ext: this.ext() });
      this.ctx.mapDrawsRegions = true;
      const b = realBase(this.ctx, { margin: 0.5 });
      this.baseProj = this.ctx.proj;
      this.g['L-base'].innerHTML = b.borders;
      this.g['L-hit'].innerHTML = '';
      this.g['L-finish'].innerHTML = b.finish;
      this.baseKey = '';
      this.renderOverlay();
      return;
    }
    this.showZoom();
    const key = JSON.stringify([doc.view, doc.artboard, doc.style, doc.worldview, doc.detail ? doc.detail.at : 0, this.dataVersion || 0, this.geom]);
    this.ctx = makeContext(doc, { editing: true, ext: this.ext() });
    if (force || key !== this.baseKey) {
      this.baseKey = key;
      this.ctx.skipLabels = true;
      const b = renderBase(this.ctx);
      this.g['L-base'].innerHTML = b.sea + b.sat + b.land + b.lakes + b.rivers + b.graticule + b.admin1 + b.borders + b.detail;
      this.g['L-hit'].innerHTML = b.hit || '';
      this.g['L-finish'].innerHTML = b.finish;
      this.ctx.skipLabels = false;
      this.credits = this.ctx.credits;
    }
    this.renderOverlay();
  },

  /**
   * While the real map moves. The map fires 'move' inside its own animation frame, just before it
   * paints; doing our part right there (not a frame later) keeps everything glued to the map instead
   * of trailing behind it. Several moves in one go collapse into one update.
   */
  renderLive() {
    if (liveQueued) return;
    liveQueued = true;
    queueMicrotask(() => { liveQueued = false; canvas.liveFrame(); });
  },

  /**
   * One live frame: markers and plain labels slide to their new spot (a transform; their text isn't
   * laid out again), the editorial borders slide and scale as one piece, and only lines, areas and
   * shapes are redrawn. Text boxes, legends and lenses stay put. The full redraw waits for the end.
   */
  liveFrame() {
    const doc = store.doc;
    if (!isReal(doc)) { canvas.render(); return; }
    // A move that already settled was redrawn in full: don't undo it.
    if (!real.moving) return;
    if (!canvas.stage.classList.contains('is-moving')) canvas.stage.classList.add('is-moving');
    const ctx = (canvas.ctx = makeContext(doc, { editing: true, ext: canvas.ext() }));
    ctx.mapDrawsRegions = true;
    const base = canvas.g['L-base'];
    if (doc.real?.borders === 'ne' && canvas.baseProj && base.firstChild) slideGroup(base, canvas.baseProj, ctx.proj, doc.view.center);
    // The selected shape's outline glides with the map (handles step aside until it stops),
    // instead of vanishing and popping back.
    const ui = canvas.g['L-ui'];
    if (canvas.uiProj && ui.firstChild) slideGroup(ui, canvas.uiProj, ctx.proj, doc.view.center);
    canvas.showZoom();
    for (const el of doc.elements) {
      if (el.hidden || LAYOUT_TYPES.has(el.type) || el.type === 'callout') continue;
      if (el.type === 'region' && !el.showName && !el.innerNames) continue;
      const node = canvas.svg.querySelector(`[data-el="${el.id}"]`);
      if (!node) continue;
      const a0 = slides(el) && canvas.anchors.get(el.id);
      if (a0) {
        const p = ctx.proj(el.at);
        if (p) { node.setAttribute('transform', `translate(${(p[0] - a0[0]).toFixed(2)} ${(p[1] - a0[1]).toFixed(2)})`); continue; }
      }
      const html = renderElement(el, ctx);
      const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      tmp.innerHTML = html;
      if (tmp.firstChild) node.replaceWith(tmp.firstChild);
    }
  },

  anchors: new Map(), // where each sliding element was drawn: id → [x, y]

  /** The map zoom buttons (both map types) and the zoom level between them. */
  showZoom() {
    const mz = this.stage.querySelector('#mapzoom');
    if (!mz) return;
    if (mz.hidden) mz.hidden = false;
    const z = isReal(store.doc) ? real.map?.getZoom() : store.doc.view.zoom;
    const t = Number.isFinite(z) ? z.toFixed(1) : '';
    const out = mz.querySelector('#mapzoomZ');
    if (out.textContent !== t) out.textContent = t;
  },

  renderOverlay() {
    const doc = store.doc;
    const ctx = this.ctx || (this.ctx = makeContext(doc, { editing: true, ext: this.ext() }));
    if (isReal(doc)) { ctx.mapDrawsRegions = true; real.syncRegions(); }
    ctx.defs = []; ctx.boxes = new Map(); ctx.hiddenLabels = [];
    let regions = '', geo = '', layout = '';
    this.anchors = new Map();
    for (const el of doc.elements) {
      const s = renderElement(el, ctx);
      if (el.type === 'region') regions += s;
      else if (LAYOUT_TYPES.has(el.type)) layout += s;
      else geo += s;
      if (s && slides(el)) { const p = ctx.proj(el.at); if (p) this.anchors.set(el.id, p); }
    }
    this.g['L-regions'].innerHTML = regions + regionEdges(ctx);
    this.g['L-geo'].innerHTML = geo;
    this.g['L-layout'].innerHTML = layout;
    this.g['L-labels'].innerHTML = isReal(doc) ? '' : renderLabels(ctx);
    this.g['d-dyn'].innerHTML = ctx.defs.join('');
    this.drawUI();
  },

  /* ---------- moving the map ---------- */

  beginMove() {
    this.preview = { view: { ...store.doc.view }, k: 1, tx: 0, ty: 0 };
  },
  pan(dx, dy) {
    const p = this.preview || (this.beginMove(), this.preview);
    const { w, h } = store.doc.artboard;
    p.view = panView(p.view, dx, dy, w, h);
    p.tx += dx; p.ty += dy;
    this.applyPreview();
  },
  zoomAt(factor, pt) {
    const p = this.preview || (this.beginMove(), this.preview);
    const { w, h } = store.doc.artboard;
    const before = p.view.zoom;
    p.view = zoomAround(p.view, factor, pt, w, h);
    const f = 2 ** (p.view.zoom - before);
    p.k *= f; p.tx = f * p.tx + pt[0] * (1 - f); p.ty = f * p.ty + pt[1] * (1 - f);
    this.applyPreview();
  },
  applyPreview: rafThrottle(function () {
    const p = canvas.preview;
    if (!p) return;
    if (store.doc.view.projection === 'mercator') {
      canvas.g['L-map'].setAttribute('transform', `matrix(${p.k} 0 0 ${p.k} ${p.tx} ${p.ty})`);
      canvas.g['L-ui'].setAttribute('transform', `matrix(${p.k} 0 0 ${p.k} ${p.tx} ${p.ty})`);
    } else {
      // Other projections don't move rigidly: redraw live.
      store.doc.view = p.view;
      canvas.render();
    }
  }),
  endMove() {
    const p = this.preview;
    if (!p) return;
    this.preview = null;
    this.g['L-map'].removeAttribute('transform');
    this.g['L-ui'].removeAttribute('transform');
    store.update((d) => { d.view = p.view; }, { kind: 'view' });
  },

  /* ---------- editor overlay: selection, handles, drafts ---------- */

  hover: null,
  drawUI() {
    const ui = this.g['L-ui'];
    if (!ui) return;
    // Drawn for the map as it is now; while the real map moves, liveFrame slides it from here.
    if (!this.preview) ui.removeAttribute('transform');
    this.uiProj = this.ctx?.proj || null;
    const z = store.zoom, hs = 6 / z, sw = 1.5 / z;
    let s = '';
    const ctx = this.ctx;
    const multi = store.multi || store.sel === 'geo:'; // several elements, or countries picked with Shift
    const el = multi ? null : store.selected;
    const H = (x, y, h, i = '', shape = 'circle') => shape === 'circle'
      ? `<circle class="hdl" data-h="${h}" data-i="${i}" cx="${x}" cy="${y}" r="${hs}" stroke-width="${sw}"/>`
      : `<rect class="hdl hdl-sq" data-h="${h}" data-i="${i}" x="${x - hs}" y="${y - hs}" width="${hs * 2}" height="${hs * 2}" stroke-width="${sw}"/>`;

    // Selection follows the thing itself: map shapes get their own border; markers, labels and
    // lines get a ring that hugs their exact outline. No rectangles around shapes.
    const outline = (d, cls = '') => `<path class="sel-halo ${cls}" d="${d}" stroke-width="${5 / z}"/><path class="sel-line ${cls}" d="${d}" stroke-width="${2 / z}"/>`;
    const ring = (node) => {
      if (!node) return '';
      // A copy just for the ring: no ids, no hit bands, never catches the pointer.
      const html = node.outerHTML
        .replace(/<path[^>]*stroke="transparent"[^>]*><\/path>/g, '').replace(/<rect[^>]*stroke="transparent"[^>]*><\/rect>/g, '')
        .replace(/\s(data-el|data-part|data-label|id|pointer-events)="[^"]*"/g, '').replace(/\sfilter="url\(#f-shadow\)"/g, '');
      return `<g class="sel-ring" filter="url(#f-sel)">${html}</g>`;
    };
    const rectD = (x, y, w, h) => `M${x} ${y}h${w}v${h}h${-w}Z`;
    const circleD = (x, y, r) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
    const a = 2.2 / z, b = 4.6 / z;
    s += `<defs><filter id="f-sel" x="-60%" y="-60%" width="220%" height="220%" color-interpolation-filters="sRGB">
      <feMorphology in="SourceAlpha" operator="dilate" radius="${a}" result="d1"/><feMorphology in="SourceAlpha" operator="dilate" radius="${b}" result="d2"/>
      <feComposite in="d1" in2="SourceAlpha" operator="out" result="r1"/><feComposite in="d2" in2="d1" operator="out" result="r2"/>
      <feFlood flood-color="#ffffff"/><feComposite in2="r2" operator="in" result="c2"/>
      <feFlood flood-color="#111111"/><feComposite in2="r1" operator="in" result="c1"/>
      <feMerge><feMergeNode in="c2"/><feMergeNode in="c1"/></feMerge></filter></defs>`;

    if (this.hover) s += `<path class="hover-halo" d="${this.hover}" stroke-width="${4 / z}"/><path class="hover-line" d="${this.hover}" stroke-width="${1.6 / z}"/>`;

    // The outline of a thing, as a path where it has one (shapes, boxes), else null.
    const shapeD = (e) => {
      if (!e || !ctx) return null;
      if (e.type === 'region') { const f = D.regionFeature(e, store.doc.worldview, ctx.lod); return f ? ctx.path(f) : null; }
      if (e.type === 'area') return areaPath(e, ctx).d;
      if (e.type === 'circle') return ctx.path(geoCircle().center(e.at).radius(e.radius / 111.32)());
      if (e.type === 'frame') { const A = ctx.proj(e.a), B = ctx.proj(e.b); return A && B ? rectD(Math.min(A[0], B[0]), Math.min(A[1], B[1]), Math.abs(B[0] - A[0]), Math.abs(B[1] - A[1])) : null; }
      if (e.type === 'textbox' || e.type === 'legend') { const bx = ctx.boxes.get(e.id); return bx ? rectD(bx.x, bx.y, bx.w, bx.h) : null; }
      if (e.type === 'image') return rectD(e.x, e.y, e.w, e.h);
      if (e.type === 'callout') return e.shape === 'rect' ? rectD(e.x - e.r, e.y - e.r * 0.72, e.r * 2, e.r * 1.44) : circleD(e.x, e.y, e.r);
      if (e.type === 'marker' && e.shape === 'image') { const p = ctx.proj(e.at); return p ? circleD(p[0], p[1], e.size * 1.05) : null; }
      return null;
    };
    const featD = (t) => {
      if (!ctx || !t) return null;
      if (t.geom) return ctx.path({ type: 'Feature', geometry: t.geom, properties: {} });
      if (t.layer === 'border' && !isReal(store.doc) && ctx.countries) return ctx.path(ctx.countries.borders);
      return null;
    };
    const lineGlow = (d, sel) => `<path class="feat-halo" d="${d}" stroke-width="${(sel ? 9 : 7) / z}"/><path class="feat-line${sel ? ' is-sel' : ''}" d="${d}" stroke-width="${(sel ? 3 : 2) / z}"/>`;

    // Hover: whatever the pointer is on lights up softly.
    const ht = this.hoverTarget;
    if (ht && ctx) {
      if (ht.kind === 'el') {
        const he = store.el(ht.id);
        const d = shapeD(he);
        s += d ? `<g class="is-hover">${outline(d)}</g>` : `<g class="is-hover">${ring(this.svg.querySelector(`[data-el="${ht.id}"]`))}</g>`;
      } else if (ht.kind === 'country') {
        const f = ctx.countries?.byId.get(ht.a3);
        const d = f && ctx.path(f);
        if (d) s += `<g class="is-hover">${outline(d)}</g>`;
      } else if (ht.kind === 'label') {
        s += `<g class="is-hover">${ring(this.svg.querySelector(`[data-label="${CSS.escape(ht.key)}"]`))}</g>`;
      } else if (ht.kind === 'layer') {
        const d = featD(ht);
        if (d) s += lineGlow(d, false);
      }
    }

    // A country or a map layer picked by click (not an element yet).
    if (store.sel?.startsWith('country:') && ctx) {
      const f = ctx.countries?.byId.get(store.sel.slice(8));
      const d = f && ctx.path(f);
      if (d) s += outline(d);
    } else if (store.sel?.startsWith('layer:') && ctx) {
      const d = featD(store.selInfo);
      if (d) s += lineGlow(d, true);
    }

    // Several things picked: each one hugs its outline, and one dashed box holds them all.
    if (multi && ctx) {
      const boxes = [];
      for (const m of store.selection) {
        if (m.hidden) continue;
        const d = shapeD(m);
        s += d ? outline(d) : ring(this.svg.querySelector(`[data-el="${m.id}"]`));
        if (m.type !== 'region') { const b = elBox(m, 'all'); if (b) boxes.push(b); }
      }
      for (const a3 of store.geoSel) { const f = ctx.countries?.byId.get(a3); const d = f && ctx.path(f); if (d) s += outline(d); }
      const u = union(boxes);
      if (u) { const p = 8 / z; s += `<rect class="grp" x="${u.x - p}" y="${u.y - p}" width="${u.width + 2 * p}" height="${u.height + 2 * p}" stroke-width="${1.2 / z}" stroke-dasharray="${4 / z} ${3 / z}"/>`; }
    }

    if (el && ctx && !el.hidden) {
      const node = this.svg.querySelector(`[data-el="${el.id}"]`);
      const d = shapeD(el);
      s += d ? outline(d) : ring(node); // markers, labels, lines: hug the drawn shape
      if (!el.locked) {
        if (el.type === 'line' || el.type === 'area') {
          const pts = el.points.map((p) => ctx.proj(p));
          const n = pts.length;
          const closed = el.type === 'area';
          for (let i = 0; i < n; i++) {
            const a = pts[i], b = pts[(i + 1) % n];
            if (a && b && (closed || i < n - 1)) s += `<circle class="hdl hdl-mid" data-h="m" data-i="${i}" cx="${(a[0] + b[0]) / 2}" cy="${(a[1] + b[1]) / 2}" r="${hs * 0.7}" stroke-width="${sw}"/>`;
          }
          pts.forEach((p, i) => { if (p) s += H(p[0], p[1], 'v', i); });
        } else if (el.type === 'circle') {
          const ring = geoCircle().center(el.at).radius(el.radius / 111.32)();
          const ring0 = ring.coordinates[0];
          const east = ctx.proj(ring0[Math.floor(ring0.length * 0.25)] || ring0[0]);
          const c = ctx.proj(el.at);
          if (c) s += H(c[0], c[1], 'move', '', 'sq');
          if (east) s += H(east[0], east[1], 'r');
        } else if (el.type === 'frame') {
          const A = ctx.proj(el.a), B = ctx.proj(el.b);
          if (A && B) { s += H(A[0], A[1], 'fa', '', 'sq') + H(B[0], B[1], 'fb', '', 'sq'); }
        } else if (el.type === 'label') {
          if (el.leaderOn && el.to) { const q = ctx.proj(el.to); if (q) s += H(q[0], q[1], 'to'); }
          // Size from the corner, turn from the knob above; both follow the label's rotation.
          const parts = node ? [...node.querySelectorAll('rect, text')] : [];
          let bx = null;
          for (const n of parts) { try { const b = n.getBBox(); bx = bx ? union([bx, b]) : { x: b.x, y: b.y, width: b.width, height: b.height }; } catch {} }
          const c = ctx.proj(el.at);
          if (bx && c) {
            const rad = ((el.rotate || 0) * Math.PI) / 180, co = Math.cos(rad), si = Math.sin(rad);
            const rot = (x, y) => [c[0] + (x - c[0]) * co - (y - c[1]) * si, c[1] + (x - c[0]) * si + (y - c[1]) * co];
            const k = rot(bx.x + bx.width + 4 / z, bx.y + bx.height + 4 / z);
            const top = rot(bx.x + bx.width / 2, bx.y - 4 / z), knob = rot(bx.x + bx.width / 2, bx.y - 26 / z);
            s += `<line class="hdl-stem" x1="${top[0]}" y1="${top[1]}" x2="${knob[0]}" y2="${knob[1]}" stroke-width="${sw}"/>`;
            s += H(k[0], k[1], 'ls', '', 'sq') + `<circle class="hdl hdl-rot" data-h="rot" cx="${knob[0]}" cy="${knob[1]}" r="${hs * 0.95}" stroke-width="${sw}"/>`;
          }
        } else if (el.type === 'marker') {
          const b = elBox(el);
          if (b) s += H(b.x + b.width + 3 / z, b.y + b.height + 3 / z, 'ms', '', 'sq');
        } else if (el.type === 'callout') {
          const q = ctx.proj(el.at);
          if (q) s += H(q[0], q[1], 'ca');
          s += H(el.x + el.r, el.y, 'cr', '', 'sq');
        } else if (el.type === 'textbox') {
          const b = ctx.boxes.get(el.id);
          if (b) s += `<rect class="hdl hdl-bar" data-h="w" x="${b.x - hs * 0.6}" y="${b.y + b.h / 2 - hs * 2.2}" width="${hs * 1.2}" height="${hs * 4.4}" rx="${hs * 0.6}" stroke-width="${sw}"/>`;
        } else if (el.type === 'image') {
          s += H(el.x + el.w, el.y + el.h, 'wh', '', 'sq');
        }
      }
    }

    // Base label picked
    if (store.sel?.startsWith('label:')) {
      const node = this.svg.querySelector(`[data-label="${CSS.escape(store.sel.slice(6))}"]`);
      s += ring(node);
    }

    // Drafting a line or an area
    const dr = store.draft;
    if (dr && ctx) {
      const tmp = { ...dr.el, points: dr.cursor ? [...dr.el.points, dr.cursor] : dr.el.points };
      const { d } = dr.el.type === 'area' ? areaPath(tmp, ctx) : linePath({ ...tmp, mode: dr.el.mode === 'smooth' ? 'smooth' : dr.el.mode }, ctx);
      if (d) s += `<path class="draft" d="${d}" stroke="${dr.el.type === 'area' ? dr.el.stroke : dr.el.color}" stroke-width="${Math.max(2 / z, (dr.el.width || dr.el.strokeWidth || 2))}" fill="${dr.el.type === 'area' ? dr.el.fill : 'none'}" fill-opacity="${dr.el.type === 'area' ? 0.3 : 0}"/>`;
      dr.el.points.forEach((p, i) => { const q = ctx.proj(p); if (q) s += `<circle class="hdl" cx="${q[0]}" cy="${q[1]}" r="${hs * (i === 0 ? 1.2 : 0.9)}" stroke-width="${sw}"/>`; });
    }
    if (this.rubber) {
      const r = this.rubber;
      s += `<rect class="rubber" x="${Math.min(r[0], r[2])}" y="${Math.min(r[1], r[3])}" width="${Math.abs(r[2] - r[0])}" height="${Math.abs(r[3] - r[1])}" stroke-width="${sw}" stroke-dasharray="${5 / z} ${4 / z}"/>`;
    }
    if (this.ghost) s += this.ghost;
    ui.innerHTML = s;
  },
};
