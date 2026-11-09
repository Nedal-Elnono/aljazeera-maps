import './vendor/folks/folks.css';
import '../styles/tokens.css';
import '../styles/app.css';
import { store } from './store.js';
import { canvas } from './editor/canvas.js';
import { real } from './editor/realmap.js';
import { initTools, renderPick } from './editor/tools.js';
import { initKeys } from './editor/keys.js';
import { initTopbar } from './ui/topbar.js';
import { initDock } from './ui/dock.js';
import { initLayers } from './ui/layers.js';
import { initInspector } from './ui/inspector.js';
import { initCtxbar } from './ui/ctxbar.js';
import { initPanels } from './ui/panels.js';
import { initTextEdit } from './editor/textedit.js';
import { clearHover } from './editor/smart.js';
import { openTemplates } from './ui/templates.js';
import * as D from './geo/data.js';
import { clearMeasureCache } from './render/text.js';
import { customFonts } from './export/export.js';
import { theme, sound } from './vendor/folks/folks.js';
import { idb, debounce } from './util.js';

theme.restore();
// No interface sounds in the studio: the design system's own mute switch, always on. (Muted, it
// never even starts the browser's audio engine, so the first click doesn't pay for that either.)
sound.muted = true;
// Handy in the console (and for automated checks).
window.__studio = { store, canvas, real };

const $ = (s) => document.querySelector(s);
initPanels();
canvas.mount($('#stage'));
initTools();
initKeys();
initTopbar($('#topbar'));
initDock($('#dock'));
initLayers($('#layers'));
initInspector($('#inspector'));
initCtxbar();
initTextEdit();

// Redraw policy: view/style/data → full; element edits → overlay only.
store.on((k) => {
  if (k === 'movestart') {
    // Whatever was lit up under the pointer belonged to the map before it moved: let it go now
    // (the next pointer move picks again), rather than redrawing a stale outline when it stops.
    clearHover();
    if (canvas.hover) { canvas.hover = null; canvas.drawUI(); }
    return;
  }
  if (k === 'viewlive') { canvas.renderLive(); return; }                     // the real map is moving
  if (k === 'viewend') { canvas.render(); if (store.pick) renderPick(); store.save(); return; }
  if (k === 'el') canvas.renderOverlay();
  else if (k === 'doc' || k === 'view' || k === 'load') { canvas.render(); if (store.pick) renderPick(); }
  else if (k === 'sel' || k === 'zoom') canvas.drawUI();
  if (k === 'load') canvas.fitToStage();
});

// Heavy data parsing waits while the map is being moved (it would freeze a frame).
const mapMoving = () => !!(real.moving || real.map?.isMoving() || canvas.preview);
D.setBusy(mapMoving);

// Lazy data (detailed coastlines, provinces, rivers…) redraws the map when it lands — unless the
// map is moving, in which case the redraw at the end of the move picks it up.
const dataArrived = debounce(() => {
  canvas.dataVersion = (canvas.dataVersion || 0) + 1;
  if (mapMoving()) return;
  canvas.render();
  if (store.pick) renderPick();
}, 30);
D.whenLoaded(dataArrived);

/** Finer borders get parsed while nobody's looking, so zooming in never waits for them. */
const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 5000 }) : setTimeout(fn, 400));
function prefetchDetail(wv) {
  idle(() => D.loadCountries(wv, 'mid').then(() => idle(() => D.loadCountries(wv, 'hi').catch(() => {}))).catch(() => {}));
}

// Web fonts change text widths: re-measure once they're in.
document.fonts?.ready.then(() => { clearMeasureCache(); canvas.renderOverlay(); });
document.fonts?.addEventListener?.('loadingdone', () => { clearMeasureCache(); canvas.renderOverlay(); });

async function boot() {
  // Fonts the team uploaded before.
  const fonts = (await idb.get('fonts')) || {};
  for (const [family, url] of Object.entries(fonts)) {
    try { const f = new FontFace(family, `url(${url})`); await f.load(); document.fonts.add(f); customFonts.set(family, url); } catch {}
  }
  const saved = await idb.get('autosave');
  if (saved?.elements) store.load(saved);
  else store.load(store.doc);
  canvas.fitToStage();
  canvas.render(true);
  await Promise.all([D.loadCountries(store.doc.worldview, 'lo'), D.loadBasics()]).catch((e) => console.error(e));
  canvas.render(true);
  document.body.classList.add('is-ready');
  if (!saved?.elements?.length) openTemplates({ first: true });
  prefetchDetail(store.doc.worldview);
}
boot();

// Worldview switches need their dataset.
let wv = store.doc.worldview;
store.on(() => { if (store.doc.worldview !== wv) { wv = store.doc.worldview; D.loadCountries(wv, 'lo').catch(() => {}); prefetchDetail(wv); } });
