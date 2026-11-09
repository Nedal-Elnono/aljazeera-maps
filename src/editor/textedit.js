// Edit text where it sits: double-click a label, a marker's name, a frame's caption, a text box's
// title or body, a legend title or a name on the (simplified) map, and type over it. The map keeps
// redrawing under the caret, so the box, wrapping and halo grow as you type.
import { store, isElId } from '../store.js';
import { canvas } from './canvas.js';
import { LABEL_STYLES } from '../presets.js';
import { feedback } from '../vendor/folks/folks.js';

let cur = null; // { ta, id, field, part, orig, hide }

/** What text a double-click on this element edits. */
function target(el, part) {
  switch (el.type) {
    case 'label': return { field: 'text', size: el.size, color: el.color || LABEL_STYLES[el.style]?.color, multi: true, align: 'center', rotate: el.rotate || 0 };
    case 'marker': return { field: 'text', size: el.labelSize, color: LABEL_STYLES[el.labelStyle]?.color, part: 'label', align: 'center' };
    case 'frame': return { field: 'text', size: 30, color: LABEL_STYLES.light?.color, align: 'center' };
    case 'textbox': return part === 'body'
      ? { field: 'body', part: 'body', size: el.bodySize, color: el.color, lh: el.lineHeight, wrap: true, multi: true, align: el.align }
      : { field: 'title', part: 'title', size: el.titleSize, color: el.titleColor || el.color, lh: 1.35, wrap: true, multi: true, align: el.align, weight: 700 };
    case 'legend': return { field: 'title', size: el.size, color: el.color, align: 'right', weight: 700 };
    case 'region': return { field: 'name', size: el.nameSize, color: el.nameColor, align: 'center' };
    default: return null;
  }
}

export const isEditing = () => !!cur;

/** Start editing. `key` = element id or 'label:<key>' (a base-map name). */
export function editText(key, part, { selectAll = false } = {}) {
  finish();
  let el = null, t, node, get, set;
  if (isElId(key)) {
    el = store.el(key);
    if (!el || el.locked) return false;
    t = target(el, part);
    if (!t) return false;
    if (el.type === 'region' && !el.showName) store.update(() => { el.showName = true; }, { commit: false, kind: 'el' });
    get = () => el[t.field] ?? '';
    set = (v) => { el[t.field] = v; };
    node = () => canvas.svg.querySelector(`[data-el="${key}"]`);
  } else if (key?.startsWith('label:')) {
    const k = key.slice(6);
    const n0 = canvas.svg.querySelector(`[data-label="${CSS.escape(k)}"]`);
    if (!n0) return false;
    const txt = n0.querySelector('text');
    t = { field: 'text', size: +(txt?.getAttribute('font-size') || 24), color: txt?.getAttribute('fill'), align: 'center' };
    get = () => store.doc.labels[k]?.text ?? n0.textContent.trim();
    set = (v) => { store.doc.labels[k] = { ...(store.doc.labels[k] || {}), text: v }; };
    node = () => canvas.svg.querySelector(`[data-label="${CSS.escape(k)}"]`);
  } else return false;

  const scope = (n) => (t.part ? n?.querySelector(`[data-part="${t.part}"]`) || n : n);
  const first = scope(node())?.querySelector('text');
  const ta = document.createElement('textarea');
  ta.className = 'tedit';
  ta.dir = 'auto';
  ta.spellcheck = false;
  ta.value = get();
  ta.rows = 1;
  const z = store.zoom;
  Object.assign(ta.style, {
    fontFamily: first?.getAttribute('font-family') || 'inherit',
    fontWeight: first?.getAttribute('font-weight') || t.weight || 600,
    fontSize: t.size * z + 'px',
    lineHeight: String(t.lh || 1.3),
    color: t.color || first?.getAttribute('fill') || '#111',
    caretColor: t.color || first?.getAttribute('fill') || '#111',
    textAlign: t.align === 'left' ? 'left' : t.align === 'center' ? 'center' : 'right',
    whiteSpace: t.wrap ? 'pre-wrap' : 'pre',
  });
  if (t.wrap && el) ta.style.width = (el.w - el.pad * 2) * z + 'px';
  canvas.stage.append(ta);

  // Hide the drawn text being edited (the box, halo and accent stay as they are).
  const hide = document.createElement('style');
  const sel = isElId(key) ? `#art [data-el="${key}"]${t.part ? ` [data-part="${t.part}"]` : ''} text` : `#art [data-label="${CSS.escape(key.slice(6))}"] text`;
  hide.textContent = `${sel} { opacity: 0 !important; }`;
  document.head.append(hide);

  cur = { ta, key, el, t, get, set, node, scope, orig: get(), hide };
  place();
  ta.focus();
  if (selectAll) ta.select(); else ta.setSelectionRange(ta.value.length, ta.value.length);

  ta.addEventListener('input', () => {
    store.update(() => set(ta.value), { commit: false, kind: 'el' });
    place();
  });
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); finish(); }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || (!t.multi && !e.shiftKey) || (el?.type === 'label' && !e.shiftKey))) { e.preventDefault(); finish(); }
    if (e.key === 'Tab' && el?.type === 'textbox') { e.preventDefault(); const next = t.part === 'title' ? 'body' : 'title'; const id = el.id; finish(); editText(id, next, { selectAll: true }); }
  });
  ta.addEventListener('pointerdown', (e) => e.stopPropagation());
  ta.addEventListener('blur', () => setTimeout(() => { if (cur?.ta === ta) finish(); }, 0));
  canvas.stage.classList.add('is-typing');
  feedback('tick');
  return true;
}

/** Keep the field over the text as it grows (and when the map or board moves). */
export function place() {
  if (!cur) return;
  const { ta, t, el } = cur;
  const n = cur.scope(cur.node());
  const texts = n ? [...n.querySelectorAll('text')] : [];
  const z = store.zoom;
  const sv = canvas.svg.getBoundingClientRect(), st = canvas.stage.getBoundingClientRect();
  let bx = null;
  // A moving map slides markers and labels with a transform on their group (see canvas.liveFrame).
  const m = cur.node()?.transform?.baseVal?.consolidate?.()?.matrix;
  const ox = m ? m.e : 0, oy = m ? m.f : 0;
  for (const x of texts) { try { const b = x.getBBox(); b.x += ox; b.y += oy; if (b.width + b.height) bx = bx ? { x0: Math.min(bx.x0, b.x), y0: Math.min(bx.y0, b.y), x1: Math.max(bx.x1, b.x + b.width), y1: Math.max(bx.y1, b.y + b.height) } : { x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height }; } catch {} }
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
  if (!t.wrap) { ta.style.width = '0px'; ta.style.width = Math.max(ta.scrollWidth + 6, t.size * z * 1.2) + 'px'; }
  const W = ta.offsetWidth, H = ta.offsetHeight;
  let x, y;
  if (t.wrap && el) {
    // Text box: the field is the text column; stack it where the part starts.
    x = sv.left - st.left + (el.x + el.pad) * z;
    y = sv.top - st.top + (bx ? bx.y0 * z : (el.y + el.pad) * z) - t.size * z * ((t.lh || 1.3) - 1) * 0.5;
  } else if (bx) {
    x = sv.left - st.left + ((bx.x0 + bx.x1) / 2) * z - W / 2;
    y = sv.top - st.top + ((bx.y0 + bx.y1) / 2) * z - H / 2;
  } else {
    // Nothing drawn yet (empty name): sit on the anchor.
    const p = el?.at && canvas.ctx?.proj(el.at);
    x = sv.left - st.left + (p ? p[0] * z : 0) - W / 2;
    y = sv.top - st.top + (p ? p[1] * z : 0) - H / 2;
  }
  ta.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)${t.rotate ? ` rotate(${t.rotate}deg)` : ''}`;
}

export function finish() {
  if (!cur) return;
  const c = cur;
  cur = null;
  c.ta.remove(); c.hide.remove();
  canvas.stage.classList.remove('is-typing');
  const v = c.ta.value;
  // An empty label is no label (as in every design tool).
  if (c.el?.type === 'label' && !v.trim()) { store.remove(c.el.id, { label: 'حذف تسمية فارغة' }); return; }
  if (v !== c.orig) store.update(() => c.set(v), { label: 'تعديل النص' });
}

/** Follow the map and the board while typing; stop when another project opens. */
export function initTextEdit() {
  store.on((k) => {
    if (!cur) return;
    if (k === 'load' || k === 'tool') finish();
    else if (k === 'viewlive' || k === 'viewend' || k === 'view' || k === 'zoom') requestAnimationFrame(place);
  });
}
