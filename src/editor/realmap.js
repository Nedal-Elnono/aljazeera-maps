// The live real map under the artboard (MapLibre + OpenStreetMap tiles).
// It handles dragging (with inertia), touch and double-click; the wheel, trackpad and keys go
// through navigate.js. The document's view follows the map, so every element stays pinned to its place.
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { store } from '../store.js';
import { buildStyle, mapScale, hatchImage } from '../geo/realstyle.js';
import { regionsGeo } from '../geo/regions.js';
import { Protocol } from 'pmtiles';
import { overtureRelease, refreshOvertureRelease } from '../geo/overture.js';

// Overture Maps ships as PMTiles archives (one file per theme, read by byte ranges).
maplibregl.addProtocol('pmtiles', new Protocol().tile);

let rtl = false;
export function ensureRTL() {
  if (rtl) return;
  rtl = true;
  try { maplibregl.setRTLTextPlugin(import.meta.env.BASE_URL + 'vendor/mapbox-gl-rtl-text.js', false); } catch {}
}

/** Map zoom for a document view: the map is drawn at artboard/k pixels, then scaled by k. */
export const camZoom = (doc) => doc.view.zoom + Math.log2(doc.artboard.w / mapScale(doc) / 512);
export const viewZoom = (doc, mapZoom) => mapZoom - Math.log2(doc.artboard.w / mapScale(doc) / 512);

export const real = {
  map: null, el: null, styleKey: '', fromMap: false, ready: false,
  handlers: {},
  // True from the first frame the map moves until it has been still for a moment. A gesture can
  // stop and start again (a trackpad's bursts, a drag that pauses, wheel notches): the overlay stays
  // in "moving" mode through all of it, instead of flashing a full redraw at every little pause.
  moving: false, holdUntil: 0, settleT: 0,

  active: () => store.doc.base === 'real',

  mount(stage) {
    this.el = document.createElement('div');
    this.el.id = 'mapgl';
    stage.prepend(this.el);
  },

  ensure() {
    if (this.map) {
      if (this.needsLayout) { this.needsLayout = false; this.layout(); }
      return this.map;
    }
    ensureRTL();
    const doc = store.doc;
    this.styleKey = styleKey(doc);
    this.layout();
    const rg = regionsGeo(doc);
    this.regionsKey = rg.key;
    const map = new maplibregl.Map({
      container: this.el, style: buildStyle(doc, rg), center: doc.view.center, zoom: camZoom(doc),
      attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false, boxZoom: false,
      keyboard: false, fadeDuration: 120, maxPitch: 0, renderWorldCopies: true, maxZoom: 19.5,
      // The wheel, the trackpad and the keys are ours (navigate.js): a two-finger slide moves the map.
      scrollZoom: false,
      // Keep fetching the tiles on screen while zooming, so nothing goes blank on a slow connection.
      cancelPendingTileRequestsWhileZooming: false,
      pixelRatio: this.pixelRatio(),
    });
    map.touchZoomRotate.disableRotation();
    if (this.padding) map.setPadding(this.padding);
    this.map = map;

    map.on('move', () => {
      // Only the live real map drives the view (a hidden one resizing must not move the document).
      if (this.syncing || store.doc.base !== 'real') return;
      const c = map.getCenter();
      const d = store.doc;
      d.view = { ...d.view, projection: 'mercator', center: [c.lng, c.lat], zoom: viewZoom(d, map.getZoom()) };
      clearTimeout(this.settleT);
      this.fromMap = true;
      if (!this.moving) { this.moving = true; store.emit('movestart'); }
      store.emit('viewlive');
      this.fromMap = false;
    });
    map.on('moveend', () => { if (!this.syncing && store.doc.base === 'real') this.settleSoon(); });
    map.on('click', (e) => this.handlers.click?.(e));
    map.on('dblclick', (e) => this.handlers.dblclick?.(e));
    map.on('mousemove', (e) => this.handlers.move?.(e));
    map.on('load', () => { this.ready = true; this.syncRegions(true); store.emit('maploaded'); });
    addHatchImages(map);
    return map;
  },

  pixelRatio: () => Math.min(3, mapScale(store.doc) * store.zoom * (window.devicePixelRatio || 1)),

  /**
   * The map covers the whole stage. It's drawn in "map pixels" (artboard/k) and scaled up, and its
   * center is pinned to the middle of the post frame with padding, so the frame shows exactly
   * what gets exported.
   */
  layout(g) {
    if (g) this.geom = g;
    g = this.geom;
    if (!this.el || !g) return;
    const doc = store.doc, k = mapScale(doc), s = k * g.z;
    const cw = g.sw / s, ch = g.sh / s;
    Object.assign(this.el.style, { width: cw + 'px', height: ch + 'px', transform: `scale(${s})` });
    const cx = (g.ox + (doc.artboard.w * g.z) / 2) / s, cy = (g.oy + (doc.artboard.h * g.z) / 2) / s;
    this.padding = { left: Math.max(0, 2 * cx - cw), right: Math.max(0, cw - 2 * cx), top: Math.max(0, 2 * cy - ch), bottom: Math.max(0, ch - 2 * cy) };
    if (this.map && store.doc.base !== 'real') this.needsLayout = true;
    if (this.map && store.doc.base === 'real') {
      this.syncing = true;
      const pr = this.pixelRatio();
      if (Math.abs(this.map.getPixelRatio() - pr) > 1e-6) this.map.setPixelRatio(pr);
      this.map.resize();
      this.map.setPadding(this.padding);
      this.syncing = false;
      this.syncFromDoc(true);
    }
  },

  /** Push the document's view (and style) into the map. */
  syncFromDoc(force = false) {
    if (!this.map || this.fromMap) return;
    const doc = store.doc;
    // Overture keeps only its latest releases online: look for the newest once, then redraw from it.
    if (doc.real?.source === 'overture') refreshOvertureRelease().then((changed) => { if (changed) this.syncFromDoc(); });
    const key = styleKey(doc);
    if (key !== this.styleKey) {
      this.styleKey = key;
      const rg = regionsGeo(doc);
      this.regionsKey = rg.key;
      this.map.setStyle(buildStyle(doc, rg), { diff: true });
    } else this.syncRegions();
    const c = this.map.getCenter(), zz = camZoom(doc);
    if (force || Math.abs(c.lng - doc.view.center[0]) > 1e-7 || Math.abs(c.lat - doc.view.center[1]) > 1e-7 || Math.abs(this.map.getZoom() - zz) > 1e-6) {
      this.syncing = true;
      this.map.jumpTo({ center: doc.view.center, zoom: zz });
      this.syncing = false;
    }
  },

  /** Shaded regions changed (or their data arrived): update the map's GeoJSON. */
  syncRegions(force = false) {
    if (!this.map) return;
    const rg = regionsGeo(store.doc);
    if (!force && rg.key === this.regionsKey) return;
    const src = this.map.getSource('regions'), inn = this.map.getSource('regions-inner');
    if (!src || !inn) return; // style still loading; 'load' will call again
    this.regionsKey = rg.key;
    src.setData(rg.regions);
    inn.setData(rg.inner);
  },

  /** A smooth trip to a place (used by search). */
  flyTo(view) {
    if (!this.map) return false;
    const doc = store.doc;
    this.map.flyTo({ center: view.center, zoom: view.zoom + Math.log2(doc.artboard.w / mapScale(doc) / 512), speed: 1.6, curve: 1.3, essential: true });
    return true;
  },

  setInteractive({ dblZoom = true } = {}) {
    if (!this.map) return;
    dblZoom ? this.map.doubleClickZoom.enable() : this.map.doubleClickZoom.disable();
  },

  /** The move is over once the map has been still for a moment: then the overlay redraws crisp. */
  settleSoon(ms = 140) {
    clearTimeout(this.settleT);
    this.settleT = setTimeout(() => {
      if (!this.moving) return;
      if (this.map?.isMoving() || performance.now() < this.holdUntil) { this.settleSoon(60); return; }
      this.moving = false;
      store.emit('viewend');
    }, ms);
  },
};

// What the style is built from. (Not the board size: with the post frame off the board follows the
// stage, and rebuilding the style every frame of a panel folding would stall the map.)
const styleKey = (doc) => JSON.stringify([doc.real, doc.lang, doc.real?.source === 'overture' ? overtureRelease() : 0]);

/** Hatch patterns are drawn on demand, whatever color/spacing a shaded region asks for. */
export function addHatchImages(map) {
  map.on('styleimagemissing', (e) => {
    if (!e.id.startsWith('hatch|') || map.hasImage(e.id)) return;
    const { image, pixelRatio } = hatchImage(e.id);
    map.addImage(e.id, image, { pixelRatio });
  });
}
