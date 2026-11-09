// The top bar: brand, file name, search, undo/redo, theme, templates, export.
import { store } from '../store.js';
import { h, seg, toggle } from './controls.js';
import { icon } from './icons.js';
import { canvas } from '../editor/canvas.js';
import { exportPNG, exportSVG, exportLayersZip, copySVG, saveProject } from '../export/export.js';
import { theme, working, toast, feedback } from '../vendor/folks/folks.js';
import { isMac, pickFile } from '../util.js';
import { openTemplates } from './templates.js';
import { openPalette } from './palette.js';
import { undoRedo } from '../editor/keys.js';

const K = isMac ? '⌘' : 'Ctrl ';

export function initTopbar(root) {
  const name = h('input', { class: 'tb__name', value: store.doc.name, 'aria-label': 'اسم الخريطة', spellcheck: 'false' });
  name.addEventListener('change', () => store.update((d) => { d.name = name.value.trim() || 'خريطة'; }));

  // No post size: the whole stage is the canvas, and the export is what you see.
  const undo = h('button', { class: 'f-gbtn f-gbtn--icon tb__ib', type: 'button', title: `تراجع (${K}Z)`, html: icon('undo'), onclick: () => undoRedo(false) });
  const redo = h('button', { class: 'f-gbtn f-gbtn--icon tb__ib', type: 'button', title: `إعادة (${K}⇧Z)`, html: icon('redo'), onclick: () => undoRedo(true) });

  const themeBtn = h('button', { class: 'f-gbtn f-gbtn--icon tb__ib', type: 'button', title: 'المظهر' });
  const paintTheme = () => {
    const t = theme();
    const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    themeBtn.innerHTML = icon(dark ? 'sun' : 'moon');
  };
  themeBtn.addEventListener('click', () => {
    const t = theme();
    const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    theme(dark ? 'light' : 'dark'); paintTheme(); feedback('tick');
  });
  paintTheme();

  const search = h('button', { class: 'tb__search', type: 'button', onclick: () => openPalette() },
    h('span', { html: icon('search') }), h('span', { class: 'tb__search-t' }, 'ابحث عن دولة، مدينة، بحر…'), h('kbd', { class: 'f-mono' }, `${K}K`));

  const exportBtn = h('button', { class: 'f-btn tb__export', type: 'button', html: `${icon('download')}<span>تصدير</span>` });
  exportBtn.addEventListener('click', () => toggleExport(exportBtn));

  const templatesBtn = h('button', { class: 'f-gbtn tb__tpl', type: 'button', html: `${icon('grid')}<span>القوالب</span>`, onclick: () => openTemplates() });

  root.replaceChildren(
    h('div', { class: 'tb__brand' }, h('span', { class: 'tb__mark', html: markSVG() }), h('div', { class: 'tb__bt' }, h('b', {}, 'استوديو الخرائط'), h('small', {}, 'لفرق التصميم والمونتاج'))),
    h('span', { class: 'tb__sep' }),
    name,
    h('span', { class: 'tb__sp' }),
    search,
    h('span', { class: 'tb__sp' }),
    h('div', { class: 'tb__grp' }, undo, redo),
    themeBtn,
    templatesBtn,
    exportBtn,
  );

  const sync = () => {
    if (document.activeElement !== name) name.value = store.doc.name;
    undo.disabled = !store.past.length; redo.disabled = !store.future.length;
    undo.title = `تراجع${store.undoLabel ? ': ' + store.undoLabel : ''} (${K}Z)`;
    redo.title = `إعادة${store.redoLabel ? ': ' + store.redoLabel : ''} (${K}⇧Z)`;
  };
  store.on((k) => { if (k === 'viewlive' || k === 'maploaded') return; sync(); });
  sync();
}

const markSVG = () => `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="currentColor"/><path d="M6 13c4-3 7-1 10-2.5s5-4 10-2v15c-3 1.5-6 0-9 1s-6 3.5-11 2z" fill="var(--f-on-ink)" opacity=".9"/><circle cx="19" cy="15" r="2.6" fill="currentColor"/></svg>`;

/* ---------- export popover ---------- */

let pop = null;
function toggleExport(anchor) {
  if (pop) { pop.remove(); pop = null; return; }
  const state = { fmt: 'png', scale: 2, transparent: false, embed: true };
  const body = h('div', { class: 'xp__body' });
  const draw = () => {
    body.replaceChildren(...[
      h('div', { class: 'xp__row' }, seg([{ v: 'png', label: 'PNG' }, { v: 'svg', label: 'SVG' }, { v: 'zip', label: 'طبقات ZIP' }], state.fmt, (v) => { state.fmt = v; draw(); })),
      h('p', { class: 'xp__desc' }, {
        png: 'صورة جاهزة للنشر والسوشيال.',
        svg: 'ملف متجهي بطبقات مسمّاة، يُفتح في Illustrator وFigma ويبقى قابلًا للتعديل.',
        zip: 'كل عنصر في صورة شفافة بنفس المقاس — للمونتاج والتحريك في After Effects وPremiere.',
      }[state.fmt]),
      state.fmt !== 'svg' ? h('div', { class: 'xp__row' }, h('span', {}, 'الدقة'), seg([{ v: 1, label: '1×' }, { v: 2, label: '2×' }, { v: 4, label: '4×' }], state.scale, (v) => { state.scale = v; }, { small: true })) : null,
      state.fmt === 'png' ? h('label', { class: 'xp__row' }, h('span', {}, 'خلفية شفافة'), toggle(state.transparent, (v) => { state.transparent = v; })) : null,
      state.fmt === 'svg' ? h('label', { class: 'xp__row' }, h('span', {}, 'تضمين الصور والخطوط'), toggle(state.embed, (v) => { state.embed = v; })) : null,
      go,
      h('div', { class: 'xp__more' },
        h('button', { class: 'xp__link', type: 'button', html: `${icon('copy')}<span>نسخ للصق في Figma / Illustrator</span>`, onclick: async () => { const ok = await copySVG(store.doc); toast(ok ? 'نُسخت الخريطة — الصقها في Figma أو Illustrator' : 'تعذّر النسخ'); } }),
        h('button', { class: 'xp__link', type: 'button', html: `${icon('file')}<span>حفظ المشروع (.ajmap)</span>`, onclick: () => saveProject(store.doc) }),
        h('button', { class: 'xp__link', type: 'button', html: `${icon('grid')}<span>فتح مشروع</span>`, onclick: openProject }),
      ),
    ].filter(Boolean));
  };
  const go = h('button', { class: 'f-btn xp__go', type: 'button', html: `${icon('download')}<span>تنزيل</span>` });
  go.addEventListener('click', () => working(go, async (report) => {
    const d = store.doc;
    if (state.fmt === 'png') await exportPNG(d, { scale: state.scale, transparent: state.transparent, onProgress: report });
    else if (state.fmt === 'svg') { report(0.3); await exportSVG(d, { embed: state.embed, onProgress: report }); }
    else await exportLayersZip(d, { scale: state.scale, onProgress: report });
  }, { busy: 'جارٍ التجهيز…', done: 'تم التنزيل' }));
  draw();
  pop = h('div', { class: 'xp f-glass', role: 'dialog' }, h('div', { class: 'f-label' }, h('span', {}, 'تصدير الخريطة'), h('span', { class: 'f-mono', dir: 'ltr' }, `${store.doc.artboard.w} × ${store.doc.artboard.h}`)), body);
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.top = r.bottom + 10 + 'px';
  pop.style.left = Math.max(12, r.left) + 'px';
  setTimeout(() => addEventListener('pointerdown', function off(e) { if (pop && !pop.contains(e.target) && !anchor.contains(e.target)) { pop.remove(); pop = null; removeEventListener('pointerdown', off, true); } }, true));
}

export async function openProject() {
  const f = await pickFile('.ajmap,.json,application/json');
  if (!f) return;
  try {
    const doc = JSON.parse(await f.text());
    delete doc.app;
    store.load(doc);
    canvas.fit = true; canvas.fitToStage();
    toast('فُتح المشروع');
  } catch { toast('الملف غير صالح'); }
}

export function exportQuick() { const b = document.querySelector('.tb__export'); b && toggleExport(b); }
