// The tool dock at the bottom of the canvas. Hold ⌘ to see every shortcut.
import { store } from '../store.js';
import { h, seg } from './controls.js';
import { icon } from './icons.js';
import { feedback } from '../vendor/folks/folks.js';
import { finishDraft, cancelDraft, clearPick } from '../editor/tools.js';

export const TOOLS = [
  { id: 'select', key: 'V', name: 'تحديد وتحريك' },
  { id: 'hand', key: 'H', name: 'تحريك الخريطة' },
  { sep: true },
  { id: 'region', key: 'C', name: 'تظليل دولة / محافظة' },
  { id: 'marker', key: 'M', name: 'علامة' },
  { id: 'label', key: 'T', name: 'تسمية' },
  { id: 'line', key: 'L', name: 'خط / مسار' },
  { id: 'area', key: 'A', name: 'منطقة' },
  { id: 'circle', key: 'O', name: 'دائرة' },
  { id: 'frame', key: 'R', name: 'إطار' },
  { sep: true },
  { id: 'callout', key: 'I', name: 'عدسة (صورة / قمر صناعي)' },
  { id: 'textbox', key: 'B', name: 'صندوق نص' },
  { id: 'legend', key: 'G', name: 'مفتاح الخريطة' },
  { id: 'image', key: 'P', name: 'صورة / شعار' },
];

const HINTS = {
  select: 'انقر على أي شيء لتعديله · Shift + نقر لتحديد أكثر من دولة · حرّك الخريطة بإصبعين أو بالسحب',
  hand: 'اسحب أو حرّك بإصبعين لتحريك الخريطة · الأسهم تحرّكها و + / − للتقريب',
  region: 'انقر لتظليل دولة أو محافظة · Shift + نقر لتحديد أكثر من واحدة وتعديلها معًا · Alt + نقر لإزالة التظليل',
  marker: 'انقر لوضع علامة · Shift لإضافة أكثر من واحدة',
  label: 'انقر لكتابة تسمية',
  line: 'انقر لإضافة نقاط · نقر مزدوج أو Enter للإنهاء · Esc للإلغاء',
  area: 'انقر لرسم الحدود · انقر على النقطة الأولى للإغلاق',
  circle: 'اسحب من المركز لتحديد نصف القطر',
  frame: 'اسحب لرسم إطار حول منطقة الاهتمام',
  callout: 'انقر على المكان الذي تريد تكبيره',
  textbox: 'انقر لوضع صندوق العنوان والنص',
  legend: 'انقر لوضع المفتاح — يجمع العناصر تلقائيًا',
  image: 'انقر ثم اختر صورة أو شعار',
};

export function initDock(root) {
  const btns = new Map();
  const bar = h('div', { class: 'dock__bar f-glass', role: 'toolbar', 'aria-label': 'الأدوات' });
  for (const t of TOOLS) {
    if (t.sep) { bar.append(h('span', { class: 'dock__sep' })); continue; }
    const b = h('button', { class: 'dock__btn', type: 'button', 'aria-label': t.name, 'data-tool': t.id, html: icon(t.id) + `<span class="dock__tip">${t.name}<kbd class="f-mono">${t.key}</kbd></span><kbd class="dock__key f-mono">${t.key}</kbd>` });
    b.addEventListener('click', () => { store.setTool(t.id); feedback('tick'); });
    btns.set(t.id, b);
    bar.append(b);
  }
  const hint = h('div', { class: 'dock__hint' });
  const sub = h('div', { class: 'dock__sub' });
  root.replaceChildren(sub, hint, bar);

  const sync = () => {
    for (const [id, b] of btns) b.setAttribute('aria-pressed', String(store.tool === id));
    hint.textContent = HINTS[store.tool] || '';
    sub.replaceChildren();
    if (store.tool === 'region') {
      sub.append(h('div', { class: 'dock__pill f-glass' }, seg([{ v: 'country', label: 'دولة' }, { v: 'admin1', label: 'محافظة' }, { v: 'district', label: 'مديرية' }], store.regionMode || 'country', (v) => { store.regionMode = v; clearPick(); sync(); }, { small: true }),
        h('span', { class: 'dock__pill-t' }, (store.regionMode || 'country') === 'country' ? '' : 'انقر الدولة أولًا لإظهار أقسامها')));
    }
    if (store.draft) {
      sub.append(h('div', { class: 'dock__pill f-glass' },
        h('span', { class: 'f-mono dock__pill-t' }, `${store.draft.el.points.length} نقاط`),
        h('button', { class: 'f-capsule', type: 'button', onclick: finishDraft }, 'إنهاء'),
        h('button', { class: 'f-link', type: 'button', onclick: cancelDraft }, 'إلغاء')));
    }
  };
  store.on((k) => { if (k === 'tool' || k === 'draft' || k === 'load') sync(); });
  sync();

  // Hold ⌘ / Ctrl to reveal the keys.
  let t;
  addEventListener('keydown', (e) => { if ((e.key === 'Meta' || e.key === 'Control') && !t) t = setTimeout(() => document.body.classList.add('show-keys'), 450); });
  const hide = () => { clearTimeout(t); t = null; document.body.classList.remove('show-keys'); };
  addEventListener('keyup', (e) => { if (e.key === 'Meta' || e.key === 'Control') hide(); });
  addEventListener('blur', hide);
}
