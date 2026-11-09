// The properties panel. Nothing selected: the map's look. Something selected: its properties.
import { store, TYPE_NAMES, baseStyle, makeElement } from '../store.js';
import { h, section, field, grid2, color, number, slider, seg, toggleRow, text, select, button, sectionScope } from './controls.js';
import { STYLES, FONTS, PROJECTIONS, WORLDVIEWS, LABEL_STYLES, MARKER_SHAPES } from '../presets.js';
import { THEMES, REAL_COLORS, REAL_DEFAULTS, palette, REAL_SOURCES } from '../geo/realstyle.js';
import { ICONS } from '../render/icons.js';
import { icon } from './icons.js';
import { canvas } from '../editor/canvas.js';
import { removeWithUndo, duplicate, showPick } from '../editor/tools.js';
import { viewBox } from '../render/base.js';
import { makeContext } from '../render/compose.js';
import { fetchDetail, MAX_AREA } from '../geo/osm.js';
import * as D from '../geo/data.js';
import { customFonts } from '../export/export.js';
import { pickFile, blobToDataURL, fmtNum, idb } from '../util.js';
import { toast, working, feedback } from '../vendor/folks/folks.js';
import { geoLength } from 'd3';
import { alignSel, distributeSel, duplicateSel, deleteSel, movable, shadeSel, pickedRegions, regionsOnly } from '../editor/selection.js';

let root, muted = false;

export function initInspector(el) {
  root = el;
  render();
  store.on((k) => {
    if (muted) return;
    if (k === 'sel' || k === 'load' || k === 'doc' || k === 'tool') render();
    // The map panel shows view-dependent things (e.g. whether OSM detail is available).
    else if ((k === 'view' || k === 'viewend') && !store.sel && store.doc.base !== 'real') render();
  });
}

/** Change the document from the panel without rebuilding the panel. */
function set(fn, commit = true, kind) {
  muted = true;
  try { store.update(fn, { commit, kind: kind || (commit ? 'doc' : 'el') }); } finally { muted = false; }
}
const setStyle = (k, v, commit = true) => set((d) => { d.style[k] = v; }, commit, 'doc');
// With several countries/provinces picked, the region panel edits them all.
const targets = () => (store.multi && regionsOnly() ? pickedRegions() : store.selected ? [store.selected] : []);
const setEl = (k, v, commit = true) => set(() => { for (const e of targets()) e[k] = v; }, commit);

function render() {
  if (!root) return;
  const scroll = root.scrollTop;
  root.innerHTML = '';
  const sel = store.sel;
  // Folded sections are remembered per kind of panel (the map's "Shape" isn't a marker's "Shape").
  const regions = sel === 'geo:' || (store.multi && regionsOnly());
  sectionScope(sel?.startsWith('label:') ? 'label' : regions ? 'region' : store.multi ? 'multi' : store.selected ? store.selected.type : 'map-' + store.doc.base);
  const parts = sel?.startsWith('label:') ? baseLabelPanel(sel.slice(6)) : regions ? regionGroupPanel() : store.multi ? multiPanel() : store.selected ? elementPanel(store.selected) : mapPanel();
  root.append(...parts.filter(Boolean));
  root.scrollTop = scroll;
}

/* ---------- several things at once ---------- */

const MAIN_COLOR = { region: 'fill', area: 'fill', circle: 'fill', marker: 'color', line: 'color', frame: 'stroke', textbox: 'bg', legend: 'bg' };

function multiPanel() {
  const els = store.selection, n = els.length;
  const mov = els.filter(movable).length;
  const ib = (ic, title, fn) => h('button', { class: 'f-ibtn ins-align', type: 'button', title, 'aria-label': title, html: icon(ic), onclick: fn });
  const colored = els.filter((e) => MAIN_COLOR[e.type]);
  const anyLocked = els.some((e) => e.locked), anyHidden = els.some((e) => e.hidden);
  return [
    h('div', { class: 'ins-head' },
      h('span', { class: 'ins-head__ic', html: icon('selectAll') }),
      h('div', { class: 'ins-head__t' }, h('b', {}, `${n} عناصر محددة`), h('small', {}, 'Shift + نقر للإضافة أو الإزالة · اسحب أيًّا منها لتحريكها معًا')),
      h('div', { class: 'ins-head__a' },
        h('button', { class: 'f-ibtn', type: 'button', title: 'تكرار (⌘D)', html: icon('copy'), onclick: () => duplicateSel(24) }),
        h('button', { class: 'f-ibtn', type: 'button', title: 'حذف', html: icon('trash'), onclick: () => deleteSel() }))),
    mov ? section('محاذاة',
      h('div', { class: 'ins-aligns' },
        ib('alignR', 'لليمين', () => alignSel('right')), ib('alignHC', 'توسيط أفقي', () => alignSel('hcenter')), ib('alignL', 'لليسار', () => alignSel('left')),
        ib('alignT', 'للأعلى', () => alignSel('top')), ib('alignVC', 'توسيط رأسي', () => alignSel('vcenter')), ib('alignB', 'للأسفل', () => alignSel('bottom'))),
      mov >= 3 ? h('div', { class: 'ins-aligns' }, ib('distH', 'مسافات أفقية متساوية', () => distributeSel('x')), ib('distV', 'مسافات رأسية متساوية', () => distributeSel('y'))) : null,
      h('div', { class: 'f-hint' }, 'Alt + ⇧ + الأسهم للمحاذاة من لوحة المفاتيح')) : null,
    colored.length ? section('اللون', field(`لون ${colored.length === n ? 'الكل' : colored.length + ' منها'}`, color(colored[0][MAIN_COLOR[colored[0].type]], (v) => set(() => { for (const e of colored) e[MAIN_COLOR[e.type]] = v; })))) : null,
    section('العناصر',
      h('div', { class: 'ins-mlist' }, ...els.map((e) => h('button', { class: 'ins-mitem', type: 'button', html: icon(e.type) + `<span>${(e.name || e.text || (e.title || '').replace(/\*\*|==/g, '') || e.legend || TYPE_NAMES[e.type]).toString().split('\n')[0].slice(0, 30)}</span>`, onclick: () => store.select(e.id) }))),
      h('div', { class: 'ins-actions' },
        button(anyLocked ? 'فك القفل' : 'قفل الكل', () => set(() => { for (const e of els) e.locked = !anyLocked; }), { icon: icon(anyLocked ? 'unlock' : 'lock') }),
        button(anyHidden ? 'إظهار الكل' : 'إخفاء الكل', () => set(() => { for (const e of els) e.hidden = !anyHidden; }), { icon: icon(anyHidden ? 'eye' : 'eyeOff') }))),
  ];
}

/** Several countries and provinces: one panel edits them all (countries picked with Shift get shaded first). */
function regionGroupPanel() {
  const els = pickedRegions(), geo = store.geoSel;
  const C = canvas.ctx?.countries;
  const nameOf = (a3) => { const f = C?.byId.get(a3); return f ? (store.doc.lang === 'en' ? f.properties.name : f.properties.ar) : a3; };
  const n = els.length + geo.length;
  const countries = geo.length + els.filter((e) => e.kind === 'country').length;
  const noun = countries === n ? 'دول' : countries ? 'مناطق' : 'محافظات';
  const f = els[0];
  const list = [
    ...els.map((e) => h('button', { class: 'ins-mitem', type: 'button', html: icon('region') + `<span>${(e.name || e.a3).toString().slice(0, 30)}</span>`, onclick: () => store.select(e.id) })),
    ...geo.map((a3) => h('button', { class: 'ins-mitem', type: 'button', html: icon('region') + `<span>${nameOf(a3)} · غير مظللة</span>`, onclick: () => store.select('country:' + a3) })),
  ];
  return [
    h('div', { class: 'ins-head' },
      h('span', { class: 'ins-head__ic', html: icon('region') }),
      h('div', { class: 'ins-head__t' }, h('b', {}, `${n} ${noun} محددة`), h('small', {}, 'Shift + نقر لإضافة دولة أو محافظة أو إزالتها · أي تعديل هنا يطبَّق عليها كلها')),
      els.length ? h('div', { class: 'ins-head__a' }, h('button', { class: 'f-ibtn', type: 'button', title: 'حذف التظليل', html: icon('trash'), onclick: () => deleteSel() })) : null),
    geo.length
      ? section('التظليل', field(els.length ? 'لون الكل' : 'لوّنها كلها', color(f?.fill || store.doc.style.highlight, (v) => { shadeSel(v); })), h('div', { class: 'f-hint' }, `${geo.length === n ? 'لم تُظلَّل بعد' : geo.length + ' منها لم تُظلَّل بعد'}: اختيار لون يظللها كلها`))
      : null,
    !geo.length && f ? fillSection(f) : null,
    !geo.length && f ? strokeSection(f, { dash: false }) : null,
    !geo.length && f && !countries ? section('الأسماء',
      toggleRow('إظهار الأسماء', f.showName, (v) => { setEl('showName', v); render(); }),
      f.showName ? grid2(field('الحجم', number(f.nameSize, (v, c) => setEl('nameSize', v, c), { min: 8, max: 120 })), field('اللون', color(f.nameColor, (v) => setEl('nameColor', v)))) : null) : null,
    section(`ال${noun}`, h('div', { class: 'ins-mlist' }, ...list)),
  ];
}

/* ---------- the map ---------- */

function styleThumb(k) {
  const s = STYLES[k];
  return `<svg viewBox="0 0 60 40" class="sty__svg"><rect width="60" height="40" fill="${s.sea}"/><path d="M-2 12C8 6 16 14 24 10s14-8 22-2 12 4 16 2v32H-2z" fill="${s.land}"/><path d="M24 10c2 8-3 14 0 32M46 8c-4 10 2 18-2 34" fill="none" stroke="${s.border}" stroke-width="1.4"/><path d="M28 16c4-3 10-2 12 3s-1 10-6 10-9-8-6-13z" fill="${s.highlight}"/></svg>`;
}

const setReal = (k, v, commit = true) => set((d) => { d.real = { ...REAL_DEFAULTS, ...d.real, [k]: v }; }, commit, 'doc');

function themeThumb(k) {
  const p = THEMES[k];
  const water = p.water || '#2f4a3a', land = p.satellite ? '#4b5a3f' : p.bg;
  return `<svg viewBox="0 0 80 50"><rect width="80" height="50" fill="${water}"/><path d="M-2 10C10 4 20 12 30 8s18-6 26 0 16 3 26 1v44H-2z" fill="${land}"/>${p.satellite ? '<path d="M0 30h80M20 14l30 36" stroke="#6f7d5c" stroke-width="5" opacity=".6"/>' : `<path d="M44 20c6-3 14 0 16 6s-2 12-8 12-12-12-8-18z" fill="${p.park}"/>`}<path d="M6 40C24 30 40 34 78 18" stroke="${p.majorCase || '#000'}" stroke-width="4" fill="none" opacity=".5"/><path d="M6 40C24 30 40 34 78 18" stroke="${p.motorway}" stroke-width="2.4" fill="none"/><path d="M30 8c2 10-4 18 0 42" stroke="${p.border}" stroke-width="1.4" fill="none"/><text x="58" y="44" font-size="7" font-weight="700" fill="${p.city}" font-family="sans-serif">مدينة</text></svg>`;
}

function mapTypeSection(d) {
  const card = (v, title, desc, art) => h('button', { class: 'mtype__item' + (d.base === v ? ' is-on' : ''), type: 'button', html: art + `<span>${title}</span><small>${desc}</small>`, onclick: () => { if (d.base === v) return; set((doc) => { doc.base = v; if (v === 'real') doc.view = { ...doc.view, projection: 'mercator' }; }); render(); feedback('tick'); } });
  return section('نوع الخريطة', h('div', { class: 'mtype' },
    card('real', 'خريطة حقيقية', 'مدن وشوارع تظهر مع التقريب', themeThumb((d.real?.theme) || 'standard')),
    card('design', 'خريطة مبسّطة', 'بأسلوب القناة، كلها متجهات', styleThumb(d.style.preset in STYLES ? d.style.preset : 'light'))));
}

function realPanel() {
  const d = store.doc;
  const r = { ...REAL_DEFAULTS, ...d.real };
  const pal = palette(r);
  const out = [];
  out.push(section('مصدر الخريطة',
    field('البيانات', seg(Object.entries(REAL_SOURCES).map(([v, x]) => ({ v, label: x.name })), r.source, (v) => { setReal('source', v); render(); }, { small: true }),
      { hint: REAL_SOURCES[r.source]?.hint }),
  ));
  const themeGrid = (keys) => h('div', { class: 'sty' }, ...keys.map((k) => h('button', {
    class: 'sty__item' + (r.theme === k ? ' is-on' : ''), type: 'button', html: themeThumb(k).replace('<svg ', '<svg class="sty__svg" ') + `<span>${THEMES[k].name}</span>`,
    onclick: () => { set((doc) => { doc.real = { ...REAL_DEFAULTS, ...doc.real, theme: k, colors: {} }; }); render(); feedback('tick'); },
  })));
  const keys = Object.keys(THEMES);
  out.push(section('الشكل',
    themeGrid(keys.filter((k) => !THEMES[k].group)),
    h('div', { class: 'sty__group' }, 'بألوان خرائط أبل'),
    themeGrid(keys.filter((k) => THEMES[k].group === 'apple')),
  ));
  out.push(section('الألوان',
    grid2(...REAL_COLORS.map((c) => field(c.label, color(r.colors?.[c.key] || pal[c.keys[0]] || '#000000', (v) => set((doc) => { doc.real = { ...REAL_DEFAULTS, ...doc.real, colors: { ...(doc.real.colors || {}), [c.key]: v } }; }, true, 'doc')))),
      field('لون التظليل', color(d.style.highlight, (v) => setStyle('highlight', v)), { hint: 'للدول التي تنقر عليها' })),
    Object.keys(r.colors || {}).length ? button('رجوع لألوان الشكل', () => { setReal('colors', {}); render(); }, { icon: icon('undo') }) : null,
  ));
  out.push(section('ما يظهر على الخريطة',
    toggleRow('الأسماء', r.labels, (v) => { setReal('labels', v); render(); }, 'دول، محافظات، مدن، أحياء'),
    r.labels ? toggleRow('أسماء الشوارع', r.roadLabels, (v) => setReal('roadLabels', v)) : null,
    toggleRow('الطرق والشوارع', r.roads, (v) => setReal('roads', v)),
    toggleRow('المباني', r.buildings, (v) => setReal('buildings', v), 'عند التقريب الشديد'),
    toggleRow('حدود المحافظات', r.admin1, (v) => setReal('admin1', v)),
    toggleRow('الحدائق والغابات', r.landcover, (v) => setReal('landcover', v)),
  ));
  out.push(section('حدود الدول',
    field('المصدر', seg([{ v: 'osm', label: REAL_SOURCES[r.source]?.name || 'OpenStreetMap' }, { v: 'ne', label: 'وجهة نظر تحريرية' }], r.borders, (v) => { setReal('borders', v); render(); }, { small: true }),
      { hint: r.borders === 'ne' ? 'الحدود من Natural Earth حسب وجهة النظر المختارة — أدق للتحرير، أقل دقة عند التقريب الشديد' : `الحدود الفعلية من ${REAL_SOURCES[r.source]?.name || 'OpenStreetMap'}، والمتنازع عليها بخط متقطع` }),
    r.borders === 'ne' ? field('وجهة النظر', select(WORLDVIEWS.map((w) => ({ v: w.id, label: w.name })), d.worldview, (v) => set((doc) => { doc.worldview = v; }))) : null,
  ));
  out.push(section('النصوص',
    field('حجم النصوص والخطوط', slider(r.textScale, (v, c) => setReal('textScale', v, c), { min: 0.6, max: 2.2, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' }), { hint: 'كبّرها للشاشة والسوشيال' }),
    field('لغة الخريطة', seg([{ v: 'ar', label: 'عربي' }, { v: 'en', label: 'English' }], d.lang, (v) => set((doc) => { doc.lang = v; }))),
    field('خط عناصرك', h('div', { class: 'ins-inline' },
      select([...FONTS.map((f) => ({ v: f.family, label: f.label + ' — ' + f.family })), ...[...customFonts.keys()].map((k) => ({ v: k, label: '★ ' + k }))], d.font, (v) => set((doc) => { doc.font = v; })),
      h('button', { class: 'f-ibtn', type: 'button', title: 'ارفع خط القناة (TTF / OTF / WOFF)', html: icon('font'), onclick: uploadFont }),
    ), { hint: 'للتسميات والنصوص التي تضيفها، وأسماء الخريطة في ملف SVG' }),
  ));
  out.push(section('تأثيرات',
    toggleRow('حبيبات (Grain)', d.style.texture === 'grain', (v) => setStyle('texture', v ? 'grain' : 'none')),
    field('تظليل الأطراف', slider(d.style.vignette, (v, c) => setStyle('vignette', v, c), { min: 0, max: 1 })),
  ));
  out.push(boardSection());
  return out;
}

function boardSection() {
  const d = store.doc;
  // No post size to set: the canvas is the whole stage, and the export is what you see.
  return section('الملف',
    field('اسم الملف', text(d.name, (v, c) => set((doc) => { doc.name = v; }, c), { placeholder: 'اسم الخريطة' })),
  );
}

function mapPanel() {
  const d = store.doc, st = d.style;
  const out = [];

  out.push(h('div', { class: 'ins-head' }, h('div', { class: 'ins-head__t' }, h('b', {}, 'الخريطة'), h('small', {}, d.base === 'real' ? 'إصبعان أو سحب للتحريك · القرص أو العجلة للتقريب' : 'اختر شكلًا، ثم انقر على دولة لتظليلها'))));
  out.push(mapTypeSection(d));
  if (d.base === 'real') return [...out, ...realPanel()];

  out.push(section('الشكل',
    h('div', { class: 'sty' }, ...Object.keys(STYLES).map((k) => h('button', {
      class: 'sty__item' + (st.preset === k ? ' is-on' : ''), type: 'button', html: styleThumb(k) + `<span>${STYLES[k].name}</span>`,
      onclick: () => { set((doc) => { doc.style = { ...doc.style, ...STYLES[k], preset: k }; }); render(); feedback('tick'); },
    }))),
  ));

  out.push(section('الألوان',
    grid2(
      field('البحر', color(st.sea, (v) => setStyle('sea', v))),
      field('اليابسة', color(st.land, (v) => setStyle('land', v))),
      field('الحدود', color(st.border, (v) => setStyle('border', v))),
      field('سُمك الحدود', number(st.borderWidth, (v, c) => setStyle('borderWidth', v, c), { min: 0, max: 8, step: 0.1 })),
      field('أسماء الدول', color(st.label, (v) => setStyle('label', v))),
      field('أسماء البحار', color(st.seaLabel, (v) => setStyle('seaLabel', v))),
      field('الأنهار', color(st.river, (v) => { set((doc) => { doc.style.river = v; doc.style.lake = v; }); })),
      field('لون التظليل', color(st.highlight, (v) => setStyle('highlight', v)), { hint: 'للدول التي تنقر عليها' }),
    ),
  ));

  out.push(section('التسميات',
    toggleRow('أسماء الدول', st.countryLabels, (v) => setStyle('countryLabels', v)),
    toggleRow('أسماء البحار والخلجان', st.seaLabels, (v) => setStyle('seaLabels', v)),
    toggleRow('المدن', st.cities, (v) => setStyle('cities', v)),
    st.cities ? field('كثافة المدن', slider(st.cityRank, (v, c) => setStyle('cityRank', v, c), { min: 0, max: 8, step: 1, fmt: (v) => v + 1 })) : null,
    grid2(
      field('حجم أسماء الدول', number(st.labelSize, (v, c) => setStyle('labelSize', v, c), { min: 8, max: 120 })),
      field('حجم البحار', number(st.seaLabelSize, (v, c) => setStyle('seaLabelSize', v, c), { min: 8, max: 120 })),
    ),
    st.cities ? field('حجم المدن', number(st.cityLabelSize, (v, c) => setStyle('cityLabelSize', v, c), { min: 8, max: 120 })) : null,
    field('لغة الخريطة', seg([{ v: 'ar', label: 'عربي' }, { v: 'en', label: 'English' }], d.lang, (v) => set((doc) => { doc.lang = v; }))),
    field('الخط', h('div', { class: 'ins-inline' },
      select([...FONTS.map((f) => ({ v: f.family, label: f.label + ' — ' + f.family })), ...[...customFonts.keys()].map((k) => ({ v: k, label: '★ ' + k }))], d.font, (v) => set((doc) => { doc.font = v; })),
      h('button', { class: 'f-ibtn', type: 'button', title: 'ارفع خط القناة (TTF / OTF / WOFF)', html: icon('font'), onclick: uploadFont }),
    ), { hint: 'ارفع خط الجزيرة ليُستخدم في الخريطة والتصدير' }),
  ));

  out.push(section('الإسقاط والحدود',
    field('الإسقاط', seg(PROJECTIONS.map((p) => ({ v: p.id, label: p.name })), d.view.projection, (v) => {
      set((doc) => { doc.view = { ...doc.view, projection: v, zoom: v === 'orthographic' ? Math.max(doc.view.zoom, 1.4) : doc.view.zoom }; if (v !== 'mercator') doc.style.satellite = false; });
    }, { small: true })),
    field('رسم الحدود حسب', select(WORLDVIEWS.map((w) => ({ v: w.id, label: w.name })), d.worldview, (v) => set((doc) => { doc.worldview = v; })), { hint: 'مصدرها Natural Earth. يمكنك تعديل أي حدود يدويًا بتحويلها إلى منطقة' }),
    toggleRow('الحدود الإدارية (المحافظات)', st.admin1All, (v) => setStyle('admin1All', v), 'تظهر عند التقريب'),
    toggleRow('الأنهار', st.rivers, (v) => setStyle('rivers', v)),
    toggleRow('البحيرات', st.lakes, (v) => setStyle('lakes', v)),
    toggleRow('خطوط الطول والعرض', st.graticule, (v) => setStyle('graticule', v)),
  ));

  const sat = d.view.projection === 'mercator';
  out.push(section('خلفية وتأثيرات',
    toggleRow('صور الأقمار الصناعية', st.satellite, (v) => { if (!sat) { toast('القمر الصناعي يعمل مع إسقاط مركاتور'); return; } setStyle('satellite', v); render(); }, 'Esri World Imagery'),
    st.satellite ? toggleRow('أبيض وأسود', st.satGray, (v) => setStyle('satGray', v)) : null,
    st.satellite ? field('تعتيم', slider(st.satDim, (v, c) => setStyle('satDim', v, c), { min: 0, max: 0.8 })) : null,
    field('صورة خلفية', h('div', { class: 'ins-inline' },
      button(st.bgImage ? 'تغيير الصورة' : 'ارفع صورة', async () => {
        const f = await pickFile('image/*'); if (!f) return;
        const url = await blobToDataURL(f);
        set((doc) => { const id = store.addAsset(url); doc.style.bgImage = id; }); render();
      }, { icon: icon('image') }),
      st.bgImage ? h('button', { class: 'f-ibtn', type: 'button', title: 'إزالة', html: icon('close'), onclick: () => { setStyle('bgImage', null); render(); } }) : null,
    )),
    st.bgImage ? field('شفافية الصورة', slider(st.bgOpacity, (v, c) => setStyle('bgOpacity', v, c))) : null,
    toggleRow('حبيبات (Grain)', st.texture === 'grain', (v) => setStyle('texture', v ? 'grain' : 'none')),
    field('تظليل الأطراف', slider(st.vignette, (v, c) => setStyle('vignette', v, c), { min: 0, max: 1 })),
    toggleRow('ظل تحت اليابسة', !!st.landShadow, (v) => setStyle('landShadow', v)),
  ));

  out.push(detailSection());

  out.push(section('الملف',
    field('اسم الملف', text(d.name, (v, c) => set((doc) => { doc.name = v; }, c), { placeholder: 'اسم الخريطة' })),
  ));
  return out;
}

function detailSection() {
  const d = store.doc;
  const vb = viewBox(makeContext(d));
  const area = vb ? (vb[2] - vb[0]) * (vb[3] - vb[1]) : Infinity;
  const ok = area <= MAX_AREA;
  const status = h('div', { class: 'f-hint' }, d.detail ? `${fmtNum(d.detail.roads.length)} طريق · ${fmtNum(d.detail.places.length)} بلدة · ${fmtNum(d.detail.rivers.length)} مجرى` : ok ? 'للخرائط القريبة: طرق وقرى بأسمائها العربية' : 'قرّب الخريطة أكثر لتفعيل هذا الخيار');
  const btn = h('button', { class: 'f-btn ins-cta', type: 'button', disabled: !ok, html: `${icon('detail')}<span>${d.detail ? 'تحديث التفاصيل لهذا الإطار' : 'جلب التفاصيل لهذا الإطار'}</span>` });
  btn.addEventListener('click', () => working(btn, async (report) => {
    report(0.15);
    const det = await fetchDetail(vb, (s) => { status.textContent = s; report(0.35); });
    set((doc) => { doc.detail = det; });
    render();
  }, { busy: 'جارٍ الجلب من OpenStreetMap…', done: 'تم' }).catch(() => {}));
  return section('تفاصيل OpenStreetMap',
    btn, status,
    d.detail ? toggleRow('الطرق', d.style.detailRoads, (v) => setStyle('detailRoads', v)) : null,
    d.detail ? toggleRow('البلدات والقرى', d.style.detailPlaces, (v) => setStyle('detailPlaces', v)) : null,
    d.detail ? toggleRow('المجاري المائية', d.style.detailRivers, (v) => setStyle('detailRivers', v)) : null,
    d.detail ? button('إزالة التفاصيل', () => { set((doc) => { doc.detail = null; }); render(); }, { icon: icon('trash') }) : null,
  );
}

async function uploadFont() {
  const f = await pickFile('.ttf,.otf,.woff,.woff2,font/*');
  if (!f) return;
  const family = f.name.replace(/\.(ttf|otf|woff2?)$/i, '').replace(/[-_]+/g, ' ').trim();
  const url = await blobToDataURL(f);
  try {
    const face = new FontFace(family, `url(${url})`);
    await face.load();
    document.fonts.add(face);
    customFonts.set(family, url);
    const saved = (await idb.get('fonts')) || {};
    saved[family] = url;
    await idb.set('fonts', saved);
    set((doc) => { doc.font = family; });
    render();
    toast(`أُضيف الخط: ${family}`);
  } catch { toast('تعذّر قراءة ملف الخط'); }
}

/* ---------- a base-map label ---------- */

function baseLabelPanel(key) {
  const o = store.doc.labels[key] || {};
  const node = canvas.svg.querySelector(`[data-label="${CSS.escape(key)}"] text`);
  const current = node?.textContent || o.text || '';
  const setL = (k, v, commit = true) => set((d) => { d.labels[key] = { ...(d.labels[key] || {}), [k]: v }; }, commit);
  return [
    h('div', { class: 'ins-head' }, h('div', { class: 'ins-head__t' }, h('b', {}, 'تسمية من الخريطة'), h('small', {}, 'اسحبها لتحريكها'))),
    section('',
      field('النص', text(current, (v, c) => setL('text', v, c), { dir: 'rtl' })),
      grid2(
        field('الحجم', number(o.size || +(node?.getAttribute('font-size') || 24), (v, c) => setL('size', v, c), { min: 6, max: 200 })),
        field('اللون', color(o.color || node?.getAttribute('fill') || '#888888', (v) => setL('color', v))),
      ),
      h('div', { class: 'ins-actions' },
        button('إخفاء', () => { setL('hidden', true); store.select(null); }, { icon: icon('eyeOff') }),
        button('إعادة ضبط', () => { set((d) => { delete d.labels[key]; }); render(); }, { icon: icon('undo') }),
      ),
    ),
  ];
}

/* ---------- elements ---------- */

function elementPanel(el) {
  const out = [];
  out.push(h('div', { class: 'ins-head' },
    h('span', { class: 'ins-head__ic', html: icon(el.type === 'region' ? 'region' : el.type) }),
    h('div', { class: 'ins-head__t' },
      h('input', { class: 'ins-name', value: el.name || '', placeholder: TYPE_NAMES[el.type], onchange: (e) => setEl('name', e.target.value) }),
      h('small', {}, TYPE_NAMES[el.type])),
    h('div', { class: 'ins-head__a' },
      h('button', { class: 'f-ibtn', type: 'button', title: 'تكرار (⌘D)', html: icon('copy'), onclick: () => duplicate(el.id) }),
      h('button', { class: 'f-ibtn', type: 'button', title: 'حذف', html: icon('trash'), onclick: () => removeWithUndo(el.id) }),
    ),
  ));
  const P = PANELS[el.type];
  if (P) out.push(...P(el));
  if (['region', 'area', 'circle', 'line', 'marker'].includes(el.type)) {
    out.push(section('مفتاح الخريطة', field('الاسم في المفتاح', text(el.legend, (v, c) => setEl('legend', v, c), { placeholder: 'مثال: نقاط التوغّل' }), { hint: 'يظهر تلقائيًا في أي مفتاح على اللوحة' })));
  }
  return out;
}

const fillSection = (el, { hatch = true, opacity = true } = {}) => section('التعبئة',
  grid2(
    field('اللون', color(el.fill, (v) => setEl('fill', v))),
    opacity ? field('الشفافية', slider(el.opacity, (v, c) => setEl('opacity', v, c))) : null,
  ),
  hatch ? toggleRow('تخطيط مائل', el.hatch, (v) => { setEl('hatch', v); render(); }) : null,
  hatch && el.hatch ? grid2(
    field('لون الخطوط', color(el.hatchColor, (v) => setEl('hatchColor', v))),
    field('المسافة', number(el.hatchGap, (v, c) => setEl('hatchGap', v, c), { min: 3, max: 60 })),
    field('الزاوية', number(el.hatchAngle, (v, c) => setEl('hatchAngle', v, c), { min: -90, max: 90, step: 5, unit: '°' })),
    field('السُمك', number(el.hatchWidth, (v, c) => setEl('hatchWidth', v, c), { min: 0.3, max: 10, step: 0.1 })),
  ) : null,
);

const strokeSection = (el, { dash = true, title = 'الحدّ' } = {}) => section(title,
  grid2(
    field('اللون', color(el.stroke, (v) => setEl('stroke', v), { none: true })),
    field('السُمك', number(el.strokeWidth, (v, c) => setEl('strokeWidth', v, c), { min: 0, max: 40, step: 0.5 })),
  ),
  dash ? field('النمط', dashSeg(el.dash, (v) => setEl('dash', v))) : null,
);

const dashSeg = (v, on) => seg([{ v: 'solid', label: 'متصل' }, { v: 'dashed', label: 'متقطع' }, { v: 'dotted', label: 'منقّط' }, { v: 'long', label: 'طويل' }], v, on, { small: true });

const labelStyleChips = (value, on) => h('div', { class: 'lsty' }, ...Object.entries(LABEL_STYLES).map(([k, s]) => h('button', {
  type: 'button', class: 'lsty__item' + (value === k ? ' is-on' : ''), title: s.name,
  style: { background: s.bg || 'transparent', color: s.color, textShadow: s.halo ? `0 0 3px ${s.halo}, 0 0 3px ${s.halo}` : 'none' },
  onclick: (e) => { on(k); e.currentTarget.parentElement.querySelectorAll('.is-on').forEach((x) => x.classList.remove('is-on')); e.currentTarget.classList.add('is-on'); },
}, 'نص')));

const PANELS = {
  region(el) {
    const isCountry = el.kind === 'country';
    return [
      section('',
        h('div', { class: 'ins-note' }, isCountry ? 'دولة كاملة' : el.kind === 'admin1' ? 'محافظة / ولاية' : 'مديرية (geoBoundaries)', ' · ', h('b', {}, el.name || el.a3)),
        isCountry ? h('div', { class: 'ins-actions' },
          button('اختر محافظاتها', () => { store.regionMode = 'admin1'; store.setTool('region'); showPick(el.a3, 'admin1'); store.emit('tool'); }, { icon: icon('region') }),
          button('حوّلها لشكل قابل للتعديل', () => regionToArea(el), { icon: icon('area') }),
        ) : null,
      ),
      fillSection(el),
      strokeSection(el, { dash: false }),
      isCountry ? section('داخل الدولة',
        toggleRow('حدود المحافظات', el.inner, (v) => { setEl('inner', v); if (v) D.loadAdmin1(el.a3).catch(() => toast('لا توجد محافظات لهذه الدولة')); render(); }),
        el.inner ? field('لون حدود المحافظات', color(el.innerColor, (v) => setEl('innerColor', v))) : null,
        toggleRow('أسماء المحافظات', el.innerNames, (v) => { setEl('innerNames', v); if (v) D.loadAdmin1(el.a3).catch(() => toast('لا توجد محافظات لهذه الدولة')); render(); }),
        el.innerNames ? grid2(
          field('حجم الأسماء', number(el.innerNameSize, (v, c) => setEl('innerNameSize', v, c), { min: 8, max: 80 })),
          field('لونها', color(el.innerNameColor || el.innerColor, (v) => setEl('innerNameColor', v))),
        ) : null,
        store.doc.base === 'real' ? null : field('لون اسم الدولة', color(el.labelColor || '', (v) => setEl('labelColor', v === 'none' ? '' : v), { none: true }), { hint: 'فارغ = يُختار تلقائيًا ليقرأ فوق التظليل' }),
      ) : section('الاسم',
        toggleRow('إظهار الاسم', el.showName, (v) => { setEl('showName', v); render(); }),
        el.showName ? field('النص', text(el.name, (v, c) => setEl('name', v, c))) : null,
        el.showName ? grid2(field('الحجم', number(el.nameSize, (v, c) => setEl('nameSize', v, c), { min: 8, max: 120 })), field('اللون', color(el.nameColor, (v) => setEl('nameColor', v)))) : null,
      ),
    ];
  },

  marker(el) {
    const shapes = MARKER_SHAPES.map((s) => ({ v: s.id, label: s.name }));
    return [
      section('الشكل',
        h('div', { class: 'shapes' }, ...shapes.map((s) => h('button', {
          type: 'button', class: 'shapes__item' + (el.shape === s.v ? ' is-on' : ''), title: s.label,
          html: markerGlyph(s.v, el) + `<span>${s.label}</span>`,
          onclick: () => { setEl('shape', s.v); if (s.v === 'image' && !el.asset) uploadMarkerImage(); render(); },
        }))),
        el.shape === 'icon' ? h('div', { class: 'icons' }, ...Object.entries(ICONS).map(([k, ic]) => h('button', {
          type: 'button', class: 'icons__item' + (el.icon === k ? ' is-on' : ''), title: ic.name,
          html: `<svg viewBox="0 0 24 24"><path d="${ic.d}" ${ic.rule ? `fill-rule="${ic.rule}"` : ''} fill="currentColor"/></svg>`,
          onclick: () => { setEl('icon', k); render(); },
        }))) : null,
        el.shape === 'icon' ? toggleRow('داخل دائرة', el.badge !== false, (v) => setEl('badge', v)) : null,
        el.shape === 'flag' ? field('رمز الدولة', text(el.flag, (v, c) => setEl('flag', v.trim().toLowerCase(), c), { placeholder: 'ps · es · ma …', dir: 'ltr' }), { hint: 'رمز ISO من حرفين' }) : null,
        el.shape === 'image' ? button('ارفع أيقونة', uploadMarkerImage, { icon: icon('image') }) : null,
        grid2(
          field('اللون', color(el.color, (v) => { setEl('color', v); store.lastMarkerColor = v; })),
          field('الحجم', number(el.size, (v, c) => setEl('size', v, c), { min: 4, max: 300 })),
          field('الإطار', color(el.stroke, (v) => setEl('stroke', v === 'none' ? '' : v), { none: true })),
          field('سُمك الإطار', number(el.strokeWidth, (v, c) => setEl('strokeWidth', v, c), { min: 0, max: 20, step: 0.5 })),
        ),
      ),
      section('التسمية',
        field('النص', text(el.text, (v, c) => { setEl('text', v, c); }, { placeholder: 'اسم المكان', dir: 'rtl' })),
        field('الشكل', labelStyleChips(el.labelStyle, (v) => setEl('labelStyle', v))),
        grid2(
          field('الحجم', number(el.labelSize, (v, c) => setEl('labelSize', v, c), { min: 8, max: 200 })),
          field('المسافة', number(el.gap, (v, c) => setEl('gap', v, c), { min: 0, max: 200 })),
        ),
        field('المكان', seg([{ v: 'right', label: 'يمين' }, { v: 'left', label: 'يسار' }, { v: 'top', label: 'أعلى' }, { v: 'bottom', label: 'أسفل' }], el.side, (v) => set(() => { const e = store.selected; e.side = v; e.ldx = 0; e.ldy = 0; }), { small: true })),
        field('خط الربط', seg([{ v: 'none', label: 'بدون' }, { v: 'line', label: 'خط' }, { v: 'dashed', label: 'متقطع' }, { v: 'under', label: 'تحتي' }], el.leader, (v) => setEl('leader', v), { small: true }), { hint: 'اسحب التسمية على الخريطة لتحريكها بعيدًا عن النقطة' }),
      ),
    ];
  },

  label(el) {
    return [
      section('النص',
        text(el.text, (v, c) => setEl('text', v, c), { multiline: true, rows: 2, dir: 'rtl' }),
        field('الشكل', labelStyleChips(el.style, (v) => set(() => { const e = store.selected; e.style = v; e.color = ''; e.bg = ''; }))),
        grid2(
          field('الحجم', number(el.size, (v, c) => setEl('size', v, c), { min: 8, max: 300 })),
          field('الدوران', number(el.rotate, (v, c) => setEl('rotate', v, c), { min: -180, max: 180, unit: '°' })),
          field('لون النص', color(el.color || LABEL_STYLES[el.style]?.color, (v) => setEl('color', v))),
          field('الخلفية', color(el.bg || LABEL_STYLES[el.style]?.bg || '', (v) => setEl('bg', v === 'none' ? '' : v), { none: true })),
          field('شريط لوني', color(el.accent || '', (v) => setEl('accent', v === 'none' ? '' : v), { none: true }), { hint: 'خط ملون فوق الصندوق' }),
          field('الهامش', number(el.pad, (v, c) => setEl('pad', v, c), { min: 0, max: 80 })),
        ),
      ),
      section('خط إلى نقطة',
        toggleRow('خط ربط', el.leaderOn, (v) => {
          set(() => {
            const e = store.selected; e.leaderOn = v;
            if (v && !e.to) { const p = canvas.ctx.proj(e.at); const q = p && canvas.ctx.proj.invert([p[0], p[1] + 140]); e.to = q || e.at; }
          });
          render();
        }),
        el.leaderOn ? field('الشكل', seg([{ v: 'v', label: 'عمودي' }, { v: 'h', label: 'أفقي' }, { v: 'none', label: 'مباشر' }], el.leaderElbow, (v) => setEl('leaderElbow', v), { small: true }), { hint: 'اسحب النقطة البيضاء لتحديد الموقع' }) : null,
        el.leaderOn ? grid2(field('النمط', select([{ v: 'dashed', label: 'متقطع' }, { v: 'solid', label: 'متصل' }, { v: 'dotted', label: 'منقّط' }], el.leaderDash, (v) => setEl('leaderDash', v))), field('اللون', color(el.leaderColor || LABEL_STYLES[el.style]?.bg || '#111111', (v) => setEl('leaderColor', v)))) : null,
      ),
    ];
  },

  line(el) {
    const km = geoLength({ type: 'LineString', coordinates: el.points }) * 6371;
    return [
      section('المسار',
        field('النوع', seg([{ v: 'straight', label: 'مستقيم' }, { v: 'smooth', label: 'منحنٍ' }, { v: 'arc', label: 'قوس' }, { v: 'geo', label: 'جيوديسي' }], el.mode, (v) => { setEl('mode', v); render(); }, { small: true })),
        el.mode === 'arc' ? field('الانحناء', slider(el.bend ?? 0.28, (v, c) => setEl('bend', v, c), { min: -0.6, max: 0.6, step: 0.01, fmt: (v) => v.toFixed(2) })) : null,
        h('div', { class: 'f-hint' }, `${el.points.length} نقاط · الطول ${fmtNum(km)} كم · Alt + نقر لحذف نقطة`),
      ),
      section('الخط',
        grid2(
          field('اللون', color(el.color, (v) => setEl('color', v))),
          field('السُمك', number(el.width, (v, c) => setEl('width', v, c), { min: 0.5, max: 60, step: 0.5 })),
        ),
        field('النمط', dashSeg(el.dash, (v) => setEl('dash', v))),
        field('السهم', seg([{ v: 'none', label: 'بدون' }, { v: 'end', label: 'في النهاية' }, { v: 'both', label: 'الطرفين' }], el.arrow, (v) => setEl('arrow', v), { small: true })),
        grid2(
          field('إطار للخط', color(el.casing || '', (v) => setEl('casing', v === 'none' ? '' : v), { none: true })),
          field('سُمك الإطار', number(el.casingWidth, (v, c) => setEl('casingWidth', v, c), { min: 0, max: 20, step: 0.5 })),
        ),
        toggleRow('توهّج', el.glow, (v) => setEl('glow', v)),
        field('الشفافية', slider(el.opacity, (v, c) => setEl('opacity', v, c))),
      ),
      section('المسافة',
        toggleRow('إظهار المسافة على الخط', el.dist, (v) => { setEl('dist', v); render(); }, `${fmtNum(km)} كم`),
        el.dist ? field('نص بديل', text(el.distText, (v, c) => setEl('distText', v, c), { placeholder: `${fmtNum(km)} كم` })) : null,
        el.dist ? grid2(
          field('الحجم', number(el.distSize, (v, c) => setEl('distSize', v, c), { min: 8, max: 160 })),
          field('اللون', color(el.distColor || el.color, (v) => setEl('distColor', v))),
          field('الإزاحة', number(el.distOffset, (v, c) => setEl('distOffset', v, c), { min: -300, max: 300 })),
        ) : null,
      ),
    ];
  },

  area(el) {
    return [
      section('', toggleRow('حواف ناعمة', el.smooth, (v) => setEl('smooth', v)), h('div', { class: 'f-hint' }, 'اسحب النقاط لتعديل الحدود · اسحب النقاط الصغيرة لإضافة نقطة · Alt + نقر للحذف')),
      fillSection(el),
      strokeSection(el),
    ];
  },

  circle(el) {
    return [
      section('الحجم', field('نصف القطر', number(el.radius, (v, c) => setEl('radius', v, c), { min: 0.05, max: 5000, step: 0.5, unit: 'كم' }), { hint: 'أو اسحب المقبض على حافة الدائرة' })),
      fillSection(el, { hatch: false }),
      strokeSection(el),
    ];
  },

  frame(el) {
    return [
      strokeSection(el, { title: 'الإطار' }),
      section('التعبئة', grid2(field('اللون', color(el.fill || '', (v) => setEl('fill', v === 'none' ? '' : v), { none: true })), field('الشفافية', slider(el.opacity, (v, c) => setEl('opacity', v, c))))),
      section('عنوان', text(el.text, (v, c) => setEl('text', v, c), { placeholder: 'اختياري' })),
    ];
  },

  callout(el) {
    return [
      section('المحتوى',
        field('المصدر', seg([{ v: 'satellite', label: 'قمر صناعي' }, { v: 'image', label: 'صورة' }], el.source, (v) => { setEl('source', v); if (v === 'image' && !el.asset) uploadCalloutImage(); render(); })),
        el.source === 'satellite'
          ? field('التقريب', slider(el.satZoom, (v, c) => setEl('satZoom', v, c), { min: 3, max: 19, step: 0.25, fmt: (v) => v.toFixed(1) }), { hint: 'تتبع العدسة النقطة الحمراء — اسحبها لتغيير المكان' })
          : button('اختر صورة', uploadCalloutImage, { icon: icon('image') }),
        toggleRow('أبيض وأسود', el.gray, (v) => setEl('gray', v)),
      ),
      section('الشكل',
        field('الشكل', seg([{ v: 'circle', label: 'دائرة' }, { v: 'rect', label: 'مستطيل' }], el.shape || 'circle', (v) => setEl('shape', v))),
        grid2(
          field('نصف القطر', number(el.r, (v, c) => setEl('r', v, c), { min: 40, max: 900 })),
          field('سُمك الإطار', number(el.borderWidth, (v, c) => setEl('borderWidth', v, c), { min: 0, max: 30 })),
          field('لون الإطار', color(el.border, (v) => setEl('border', v))),
        ),
      ),
      section('خط الربط',
        field('الشكل', seg([{ v: 'elbow', label: 'منكسر' }, { v: 'straight', label: 'مستقيم' }, { v: 'none', label: 'بدون' }], el.leader, (v) => setEl('leader', v), { small: true })),
        grid2(
          field('النمط', select([{ v: 'dashed', label: 'متقطع' }, { v: 'solid', label: 'متصل' }], el.leaderDash, (v) => setEl('leaderDash', v))),
          field('اللون', color(el.leaderColor, (v) => setEl('leaderColor', v))),
        ),
        toggleRow('نقطة على الموقع', el.dot, (v) => setEl('dot', v)),
        el.dot ? field('لون النقطة', color(el.dotColor, (v) => setEl('dotColor', v))) : null,
      ),
    ];
  },

  textbox(el) {
    return [
      section('المحتوى',
        field('العنوان', text(el.title, (v, c) => setEl('title', v, c), { multiline: true, rows: 2, dir: 'rtl' })),
        field('النص', text(el.body, (v, c) => setEl('body', v, c), { multiline: true, rows: 6, dir: 'rtl' }), { hint: '**كلمة** للعريض · ==كلمة== للون المميّز · سطر جديد = فقرة' }),
      ),
      section('الكتابة',
        field('المحاذاة', seg([{ v: 'right', label: 'يمين' }, { v: 'center', label: 'وسط' }, { v: 'left', label: 'يسار' }], el.align, (v) => setEl('align', v), { small: true })),
        grid2(
          field('حجم العنوان', number(el.titleSize, (v, c) => setEl('titleSize', v, c), { min: 10, max: 200 })),
          field('حجم النص', number(el.bodySize, (v, c) => setEl('bodySize', v, c), { min: 8, max: 120 })),
          field('تباعد الأسطر', number(el.lineHeight, (v, c) => setEl('lineHeight', v, c), { min: 1, max: 3, step: 0.05 })),
          field('العرض', number(el.w, (v, c) => setEl('w', v, c), { min: 120, max: 8000, unit: 'px' })),
          field('لون النص', color(el.color, (v) => setEl('color', v))),
          field('لون العنوان', color(el.titleColor || el.color, (v) => setEl('titleColor', v))),
          field('اللون المميّز', color(el.accent, (v) => setEl('accent', v))),
          field('الهامش', number(el.pad, (v, c) => setEl('pad', v, c), { min: 0, max: 200 })),
        ),
      ),
      section('الخلفية',
        grid2(
          field('اللون', color(el.bg, (v) => setEl('bg', v))),
          field('الشفافية', slider(el.bgOpacity, (v, c) => setEl('bgOpacity', v, c))),
          field('الزوايا', number(el.radius, (v, c) => setEl('radius', v, c), { min: 0, max: 120 })),
        ),
        toggleRow('ظل', el.shadow, (v) => setEl('shadow', v)),
      ),
    ];
  },

  legend(el) {
    return [
      section('المحتوى',
        toggleRow('تلقائي من العناصر', el.auto, (v) => { setEl('auto', v); render(); }, 'كل عنصر له اسم في المفتاح'),
        field('العنوان', text(el.title, (v, c) => setEl('title', v, c), { placeholder: 'اختياري' })),
        !el.auto ? legendItemsEditor(el) : null,
      ),
      section('الشكل', grid2(
        field('حجم الخط', number(el.size, (v, c) => setEl('size', v, c), { min: 8, max: 120 })),
        field('المسافة', number(el.gap, (v, c) => setEl('gap', v, c), { min: 0, max: 100 })),
        field('لون النص', color(el.color, (v) => setEl('color', v))),
        field('الخلفية', color(el.bg, (v) => setEl('bg', v))),
        field('شفافية الخلفية', slider(el.bgOpacity, (v, c) => setEl('bgOpacity', v, c))),
        field('الهامش', number(el.pad, (v, c) => setEl('pad', v, c), { min: 0, max: 120 })),
      )),
    ];
  },

  image(el) {
    return [
      section('الصورة',
        button('استبدال الصورة', async () => { const f = await pickFile('image/*'); if (!f) return; const url = await blobToDataURL(f); set(() => { store.selected.asset = store.addAsset(url); }); }, { icon: icon('image') }),
        grid2(
          field('العرض', number(el.w, (v, c) => setEl('w', v, c), { min: 8, max: 8000 })),
          field('الارتفاع', number(el.h, (v, c) => setEl('h', v, c), { min: 8, max: 8000 })),
        ),
        field('الشفافية', slider(el.opacity, (v, c) => setEl('opacity', v, c))),
      ),
    ];
  },
};

function legendItemsEditor(el) {
  const wrap = h('div', { class: 'lgi' });
  const draw = () => {
    wrap.innerHTML = '';
    el.items.forEach((it, i) => wrap.append(h('div', { class: 'lgi__row' },
      color(it.color, (v) => set(() => { store.selected.items[i].color = v; })),
      text(it.label, (v, c) => set(() => { store.selected.items[i].label = v; }, c)),
      h('button', { class: 'f-ibtn', type: 'button', html: icon('close'), onclick: () => { set(() => store.selected.items.splice(i, 1)); draw(); } }),
    )));
    wrap.append(button('أضف بندًا', () => { set(() => store.selected.items.push({ kind: 'swatch', color: '#e8323c', label: 'بند جديد' })); draw(); }, { icon: icon('plus') }));
  };
  draw();
  return wrap;
}

function markerGlyph(shape, el) {
  const c = 'currentColor';
  const g = {
    dot: `<circle cx="12" cy="12" r="6" fill="${c}"/>`,
    pulse: `<circle cx="12" cy="12" r="10" fill="${c}" opacity=".2"/><circle cx="12" cy="12" r="6.5" fill="${c}" opacity=".4"/><circle cx="12" cy="12" r="3.4" fill="${c}"/>`,
    ring: `<circle cx="12" cy="12" r="7" fill="none" stroke="${c}" stroke-width="2.4"/>`,
    pin: `<path d="M12 21s-6-5.5-6-10.5a6 6 0 0 1 12 0C18 15.5 12 21 12 21z" fill="${c}"/><circle cx="12" cy="10.5" r="2.3" fill="var(--f-surface)"/>`,
    square: `<rect x="6" y="6" width="12" height="12" fill="${c}"/>`,
    diamond: `<rect x="7" y="7" width="10" height="10" fill="${c}" transform="rotate(45 12 12)"/>`,
    icon: `<circle cx="12" cy="12" r="9" fill="${c}"/><path d="${ICONS[el.icon]?.d || ICONS.blast.d}" transform="translate(5.4 5.4) scale(.55)" fill="var(--f-surface)"/>`,
    flag: `<rect x="4" y="7" width="16" height="10.5" rx="1" fill="none" stroke="${c}" stroke-width="1.6"/><path d="M4 10.5h16M4 14h16" stroke="${c}" stroke-width="1.2" opacity=".6"/>`,
    image: `<rect x="4" y="5" width="16" height="14" rx="2" fill="none" stroke="${c}" stroke-width="1.6"/><circle cx="9" cy="10" r="1.6" fill="${c}"/>`,
  };
  return `<svg viewBox="0 0 24 24">${g[shape] || g.dot}</svg>`;
}

async function uploadMarkerImage() {
  const f = await pickFile('image/*,.svg');
  if (!f) return;
  const url = await blobToDataURL(f);
  set(() => { const e = store.selected; e.asset = store.addAsset(url); e.shape = 'image'; });
  render();
}
async function uploadCalloutImage() {
  const f = await pickFile('image/*');
  if (!f) return;
  const url = await blobToDataURL(f);
  set(() => { const e = store.selected; e.asset = store.addAsset(url); e.source = 'image'; });
  render();
}

/* ---------- a country's outline → an editable area ---------- */

function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  // A closed ring starts and ends on the same point: split it at its farthest point first.
  const [fx, fy] = pts[0], [lx, ly] = pts[pts.length - 1];
  if (Math.hypot(fx - lx, fy - ly) < 1e-6) {
    let far = 1, fd = 0;
    for (let i = 1; i < pts.length - 1; i++) { const d = Math.hypot(pts[i][0] - fx, pts[i][1] - fy); if (d > fd) { fd = d; far = i; } }
    const a = simplifyOpen(pts.slice(0, far + 1), tol), b = simplifyOpen(pts.slice(far), tol);
    return a.concat(b.slice(1));
  }
  return simplifyOpen(pts, tol);
}
function simplifyOpen(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0, idx = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const L = Math.hypot(bx - ax, by - ay) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function regionToArea(el) {
  const f = D.regionFeature(el, store.doc.worldview, canvas.ctx.lod);
  if (!f) return;
  const proj = canvas.ctx.proj;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  let best = null, bestA = 0;
  for (const poly of polys) {
    const ring = poly[0].map((p) => proj(p)).filter(Boolean);
    let a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
    if (Math.abs(a) > bestA) { bestA = Math.abs(a); best = ring; }
  }
  if (!best) return;
  let tol = 1.5, pts = simplify(best, tol);
  while (pts.length > 140) { tol *= 1.4; pts = simplify(best, tol); }
  if (pts.length > 3 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1) pts.pop();
  const points = pts.map((p) => proj.invert(p)).filter(Boolean).map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]);
  const area = makeElement('area', { points, fill: el.fill, opacity: el.opacity, hatch: el.hatch, hatchColor: el.hatchColor, stroke: el.stroke === 'none' ? '' : el.stroke, strokeWidth: el.stroke === 'none' ? 0 : el.strokeWidth, name: el.name, legend: el.legend });
  const i = store.doc.elements.indexOf(el);
  store.update((d) => { d.elements.splice(i, 1, area); });
  store.setTool('select');
  store.select(area.id);
  toast(`صار لديك ${points.length} نقطة قابلة للسحب`);
}
