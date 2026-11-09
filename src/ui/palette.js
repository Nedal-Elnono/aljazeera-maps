// ⌘K: find a place in Arabic or English and go there, shade it or pin it. Also every command.
import { store, makeElement } from '../store.js';
import { h } from './controls.js';
import { icon } from './icons.js';
import * as D from '../geo/data.js';
import { fitBounds } from '../geo/projection.js';
import { canvas } from '../editor/canvas.js';
import { real } from '../editor/realmap.js';
import { feedback, toast } from '../vendor/folks/folks.js';
import { normAr, isMac } from '../util.js';
import { STYLES } from '../presets.js';
import { THEMES, REAL_DEFAULTS } from '../geo/realstyle.js';

let host = null;
const K = isMac ? '⌘' : 'Ctrl+';

const COMMANDS = () => [
  { t: 'قالب جديد…', k: 'templates قوالب', run: () => import('./templates.js').then((m) => m.openTemplates()) },
  { t: 'تصدير…', k: 'export تصدير png svg', run: () => import('./topbar.js').then((m) => m.exportQuick()) },
  { t: 'حفظ المشروع', k: 'save حفظ', run: () => import('../export/export.js').then((m) => m.saveProject(store.doc)) },
  { t: 'فتح مشروع', k: 'open فتح', run: () => import('./topbar.js').then((m) => m.openProject()) },
  { t: 'إظهار/إخفاء الطبقات', k: 'layers panel طبقات لوحة', run: () => import('./panels.js').then((m) => m.togglePanel('layers')) },
  { t: 'إظهار/إخفاء الخصائص', k: 'inspector properties panel خصائص لوحة', run: () => import('./panels.js').then((m) => m.togglePanel('inspector')) },
  { t: 'إخفاء اللوحتين / إظهارهما (⌘\\)', k: 'panels hide ui لوحات إخفاء', run: () => import('./panels.js').then((m) => m.togglePanels()) },
  { t: 'إظهار/إخفاء المدن', k: 'cities مدن', run: () => store.update((d) => { d.style.cities = !d.style.cities; }) },
  { t: 'صور الأقمار الصناعية', k: 'satellite قمر صناعي', run: () => store.update((d) => { d.style.satellite = !d.style.satellite; d.view.projection = 'mercator'; }) },
  { t: 'كرة أرضية', k: 'globe كرة orthographic', run: () => store.update((d) => { d.view = { ...d.view, projection: d.view.projection === 'orthographic' ? 'mercator' : 'orthographic', zoom: Math.max(d.view.zoom, 1.4) }; }) },
  ...Object.entries(STYLES).map(([k, s]) => ({ t: `الشكل: ${s.name}`, k: 'style شكل ' + k, run: () => store.update((d) => { d.style = { ...d.style, ...s, preset: k }; }) })),
  ...Object.entries(THEMES).map(([k, s]) => ({ t: `الخريطة الحقيقية: ${s.name}`, k: 'theme real map خريطة حقيقية apple ابل أبل ' + k, run: () => store.update((d) => { d.base = 'real'; d.view = { ...d.view, projection: 'mercator' }; d.real = { ...REAL_DEFAULTS, ...d.real, theme: k, colors: {} }; }) })),
];

export function openPalette() {
  if (host) return;
  const input = h('input', { class: 'pal__in', placeholder: 'اكتب اسم دولة أو مدينة أو بحر… أو أمرًا', spellcheck: 'false' });
  const list = h('div', { class: 'pal__list', role: 'listbox' });
  const foot = h('div', { class: 'pal__foot' },
    h('span', {}, h('kbd', {}, '↵'), ' اذهب'), h('span', {}, h('kbd', {}, K + '↵'), ' ظلّل / ثبّت علامة'), h('span', {}, h('kbd', {}, 'Esc'), ' إغلاق'));
  const box = h('div', { class: 'pal__box', role: 'dialog', 'aria-label': 'بحث' }, h('div', { class: 'pal__top', html: icon('search') }, input), list, foot);
  host = h('div', { class: 'pal f' }, box);
  document.body.append(host);
  input.focus();
  let items = [], idx = 0, remote = [];

  const go = (it, alt) => {
    close();
    if (it.cmd) { it.cmd.run(); return; }
    const { w, h: H } = store.doc.artboard;
    const v = store.doc.view;
    const target = it.bounds ? fitBounds(v, it.bounds, w, H, 0.16) : { ...v, center: [it.lon, it.lat], zoom: Math.max(v.zoom, it.kind === 'sea' ? 3 : it.kind === 'osm' ? 9 : 5.5) };
    // On the real map, fly there; on the simplified map, jump.
    if (!(store.doc.base === 'real' && real.flyTo(target))) store.update((d) => { d.view = target; }, { kind: 'view' });
    if (alt) {
      if (it.kind === 'country') {
        const ex = store.doc.elements.find((e) => e.type === 'region' && e.a3 === it.a3);
        if (!ex) store.add(makeElement('region', { kind: 'country', a3: it.a3, name: it.ar, fill: store.doc.style.highlight }));
      } else {
        store.add(makeElement('marker', { at: [it.lon, it.lat], text: it.ar, shape: 'dot', side: 'left' }));
      }
    }
    feedback('success');
  };

  const draw = () => {
    const q = input.value.trim();
    const places = q ? D.search(q, 9) : [];
    const nq = normAr(q);
    const cmds = q ? COMMANDS().filter((c) => normAr(c.t + ' ' + c.k).includes(nq)).slice(0, 5) : COMMANDS().slice(0, 6);
    items = [...places, ...remote, ...cmds.map((c) => ({ cmd: c }))];
    if (q && !remote.length) items.push({ remote: true });
    idx = Math.min(idx, items.length - 1);
    list.replaceChildren(...items.map((it, i) => {
      if (it.remote) return h('div', { class: 'pal__item' + (i === idx ? ' is-on' : ''), onclick: () => runRemote() }, h('span', { class: 'pal__ic', html: icon('globe') }), h('span', { class: 'pal__t' }, `ابحث عن «${q}» في خريطة العالم`), h('span', { class: 'pal__k' }, 'OpenStreetMap'));
      if (it.cmd) return h('div', { class: 'pal__item' + (i === idx ? ' is-on' : ''), onclick: () => go(it) }, h('span', { class: 'pal__ic', html: icon('sparkle') }), h('span', { class: 'pal__t' }, it.cmd.t), h('span', { class: 'pal__k' }, 'أمر'));
      return h('div', { class: 'pal__item' + (i === idx ? ' is-on' : ''), onclick: (e) => go(it, e.metaKey || e.ctrlKey) },
        h('span', { class: 'pal__ic', html: icon(it.kind === 'country' ? 'region' : it.kind === 'sea' ? 'globe' : 'marker') }),
        h('span', { class: 'pal__t' }, h('b', {}, it.ar), it.en && it.en !== it.ar ? h('small', { dir: 'ltr' }, it.en.slice(0, 60)) : null),
        h('span', { class: 'pal__k' }, D.kindName(it.kind)),
        h('button', { class: 'pal__act', type: 'button', title: it.kind === 'country' ? 'ظلّل' : 'ثبّت علامة', html: icon(it.kind === 'country' ? 'region' : 'marker'), onclick: (e) => { e.stopPropagation(); go(it, true); } }));
    }));
    list.querySelector('.is-on')?.scrollIntoView({ block: 'nearest' });
  };

  const runRemote = async () => {
    const q = input.value.trim();
    if (!q) return;
    list.append(h('div', { class: 'pal__item pal__busy' }, h('span', { class: 'f-dots', html: '<i></i><i></i><i></i>' }), ' جارٍ البحث…'));
    try { remote = await D.searchRemote(q); if (!remote.length) toast('لا نتائج'); }
    catch { toast('تعذّر البحث الآن'); remote = []; }
    idx = 0; draw();
  };

  input.addEventListener('input', () => { remote = []; idx = 0; draw(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(items.length - 1, idx + 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); draw(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const it = items[idx];
      if (!it) return;
      if (it.remote) runRemote(); else go(it, e.metaKey || e.ctrlKey);
    } else if (e.key === 'Escape') close();
  });
  host.addEventListener('pointerdown', (e) => { if (e.target === host) close(); });
  draw();
}

function close() { host?.remove(); host = null; }
