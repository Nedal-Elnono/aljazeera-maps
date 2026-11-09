// Getting around the map — the same on both map types, the way designers know it from Figma:
//   trackpad · slide two fingers to move the map in any direction, pinch to zoom (⌘ + slide zooms too)
//   mouse    · the wheel zooms at the pointer (smoothly), Shift + wheel moves sideways, drag moves
//   keys     · arrows move the map when nothing is picked (Shift = further), + / − zoom
// On the real map we drive MapLibre's camera ourselves: one step per frame, painted in that same frame.
import { store } from '../store.js';
import { isReal } from '../render/compose.js';
import { real } from './realmap.js';
import { canvas } from './canvas.js';
import { clamp, debounce } from '../util.js';

/* ---------- which device is this? ---------- */

// macOS reports mouse-wheel steps in multiples of this; a trackpad sends a stream of small pixel
// deltas, often sideways too. We decide on a gesture's first event and keep it until the gesture
// ends, so a fast flick (or its momentum) never turns into zooming halfway.
const NOTCH = 4.000244140625;
const isNotch = (v) => v !== 0 && Math.abs(v / NOTCH - Math.round(v / NOTCH)) < 1e-6;
let kind = null, kindAt = 0;

function classify(e) {
  if (e.ctrlKey || e.metaKey) return 'pinch';              // a pinch arrives as Ctrl + wheel; ⌘ + slide zooms too
  const now = performance.now();
  if (kind && now - kindAt < 240) { kindAt = now; return kind; }
  const dy = Math.abs(e.deltaY);
  kind = e.shiftKey || e.deltaX !== 0 ? 'pan'
    : e.deltaMode !== 0 || isNotch(e.deltaY) || dy >= 40 ? 'wheel'
      : 'pan';
  kindAt = now;
  return kind;
}

let safariPinch = false, gScale = 1;

/** Wheel anywhere on the stage (map or elements). */
export function onWheel(e) {
  if (e.target.closest?.('.mapzoom, .cbar, .cb-pop, .tedit, .ctxm')) return;
  e.preventDefault(); // also stops the browser's swipe-back on a sideways slide
  const k = classify(e);
  const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
  let dx = e.deltaX * unit, dy = e.deltaY * unit;
  const at = [e.clientX, e.clientY];
  if (k === 'pinch') { if (!safariPinch) zoomBy(clamp(-dy * 0.012, -0.7, 0.7), at, false); return; }
  if (k === 'wheel') { zoomBy(-Math.sign(dy) * clamp(Math.abs(dy) / 220, 0.12, 1), at, true); return; }
  if (e.shiftKey && !dx) { dx = dy; dy = 0; } // Shift + mouse wheel on Windows
  panBy(dx, dy);
}

/** Safari reports a trackpad pinch as gesture events. */
export function onGesture(e) {
  e.preventDefault();
  if (e.type === 'gesturestart') { safariPinch = true; gScale = 1; return; }
  if (e.type === 'gestureend') { safariPinch = false; return; }
  const dz = Math.log2(e.scale / gScale);
  gScale = e.scale;
  if (Number.isFinite(dz) && dz) zoomBy(dz, [e.clientX, e.clientY], false);
}

/* ---------- moving and zooming ---------- */

/** The middle of the post frame, in screen pixels (where keys and buttons zoom to). */
function frameMid() {
  const r = canvas.frame.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
}

/** Zoom by dz levels around a screen point (smooth = eased, for wheel notches, keys and buttons). */
export function zoomBy(dz, at = null, smooth = true) {
  if (!dz) return;
  if (isReal(store.doc)) realZoom(dz, at || frameMid(), smooth);
  else designZoom(dz, at || frameMid());
}

/** Move the view by screen pixels (the map slides the other way, like scrolling a page). */
export function panBy(dx, dy, smooth = false) {
  if (!dx && !dy) return;
  if (isReal(store.doc)) realPan(dx, dy, smooth);
  else designPan(dx, dy);
}

/** Arrow keys: a smooth step; holding the key glides. */
export function keyPan(dirX, dirY, far) {
  const d = far ? 360 : 110;
  panBy(dirX * d, dirY * d, true);
}

/* ---------- the real map: our own camera, one step per frame ---------- */

const TILE = 512;
const MAXLAT = 85.051129;
function toWorld(ll, z) {
  const ws = TILE * 2 ** z, s = Math.sin((clamp(ll.lat, -MAXLAT, MAXLAT) * Math.PI) / 180);
  return [((ll.lng + 180) / 360) * ws, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * ws];
}
function fromWorld([x, y], z) {
  const ws = TILE * 2 ** z;
  return [(x / ws) * 360 - 180, (360 / Math.PI) * Math.atan(Math.exp((0.5 - y / ws) * 2 * Math.PI)) - 90];
}

// zTo: zoom we're heading to · at: screen point that stays put while zooming
// px/py: pan to apply now (trackpad) · ex/ey: pan still to glide (keys)
const cam = { zTo: null, smooth: false, at: null, px: 0, py: 0, ex: 0, ey: 0, raf: 0, t: 0 };

function realZoom(dz, at, smooth) {
  const map = real.map;
  if (!map) return;
  cam.zTo = clamp((cam.zTo ?? map.getZoom()) + dz, map.getMinZoom(), map.getMaxZoom());
  cam.smooth = smooth;
  cam.at = at;
  kick();
}
function realPan(dx, dy, smooth) {
  if (!real.map) return;
  if (smooth) { cam.ex += dx; cam.ey += dy; } else { cam.px += dx; cam.py += dy; }
  kick();
}
function kick() {
  real.holdUntil = performance.now() + 180; // the map isn't "done moving" while we still drive it
  if (!cam.raf) { cam.t = performance.now() - 16; cam.raf = requestAnimationFrame(step); }
}
const busy = () => cam.zTo != null || Math.abs(cam.ex) > 0.5 || Math.abs(cam.ey) > 0.5;
const idle = () => cam.zTo == null && !cam.px && !cam.py && !cam.ex && !cam.ey;

function step(now) {
  cam.raf = 0;
  const map = real.map;
  if (!map || !isReal(store.doc)) { Object.assign(cam, { zTo: null, px: 0, py: 0, ex: 0, ey: 0 }); return; }
  // Stay in the frame loop for the whole gesture, booked *before* the map books its own frame: then
  // our redraw below replaces the map's frame instead of adding a second one (one paint per frame).
  if (busy() || now < real.holdUntil) cam.raf = requestAnimationFrame(step);
  if (idle()) { cam.t = now; return; }
  const dt = clamp(now - cam.t, 1, 64);
  cam.t = now;
  const ease = 1 - Math.exp(-dt / 75);
  const el = map.getContainer(), r = el.getBoundingClientRect();
  const s = r.width / el.offsetWidth || 1; // the map element is drawn scaled; deltas arrive in screen pixels

  const z0 = map.getZoom();
  let z1 = z0;
  if (cam.zTo != null) {
    z1 = cam.smooth ? z0 + (cam.zTo - z0) * ease : cam.zTo;
    if (Math.abs(cam.zTo - z1) < 0.004) { z1 = cam.zTo; cam.zTo = null; }
  }
  const c = map.getCenter(), cp = map.project(c);
  let w = toWorld(c, z1);
  if (z1 !== z0 && cam.at) {
    // Keep the place under the pointer under the pointer.
    const p = [(cam.at[0] - r.left) / s, (cam.at[1] - r.top) / s];
    const a = toWorld(map.unproject(p), z1);
    w = [a[0] - (p[0] - cp.x), a[1] - (p[1] - cp.y)];
  }
  let dx = cam.px, dy = cam.py;
  cam.px = cam.py = 0;
  if (cam.ex || cam.ey) {
    const gx = Math.abs(cam.ex) > 0.5 ? cam.ex * ease : cam.ex, gy = Math.abs(cam.ey) > 0.5 ? cam.ey * ease : cam.ey;
    cam.ex -= gx; cam.ey -= gy; dx += gx; dy += gy;
    if (Math.abs(cam.ex) <= 0.5 && Math.abs(cam.ey) <= 0.5) cam.ex = cam.ey = 0;
  }
  w = [w[0] + dx / s, w[1] + dy / s];
  if (busy()) real.holdUntil = performance.now() + 180;
  map.jumpTo({ center: fromWorld(w, z1), zoom: z1 });
  // Paint now, in the same frame as the overlay (which follows the map's 'move' right away).
  map.redraw();
}

/* ---------- the simplified map: a cheap preview while moving, one crisp redraw at the end ---------- */

const endSoon = debounce(() => canvas.endMove(), 220);

function designZoom(dz, at) {
  canvas.zoomAt(2 ** dz, canvas.toArt({ clientX: at[0], clientY: at[1] }));
  endSoon();
}
function designPan(dx, dy) {
  canvas.pan(-dx / store.zoom, -dy / store.zoom);
  endSoon();
}
