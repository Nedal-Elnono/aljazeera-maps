// Small helpers shared everywhere.

export const uid = (p = 'e') => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
export const lerp = (a, b, t) => a + (b - a) * t;

export function debounce(fn, ms = 200) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  return d;
}

export function rafThrottle(fn) {
  let id = 0, last;
  return (...a) => { last = a; if (!id) id = requestAnimationFrame(() => { id = 0; fn(...last); }); };
}

/** XML-escape for text and attribute values. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Folds Arabic spelling variants so "الإمارات", "الامارات" and "الأمارات" all match. */
export function normAr(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, '') // harakat + tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/^ال/, '')
    .replace(/\s+ال/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Arabic-Indic digits ↔ Western digits. */
export const toArDigits = (s) => String(s).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);

/** "1,200" with Arabic thousands formatting kept in Western digits (what AJ graphics use). */
export const fmtNum = (n) => Math.round(n).toLocaleString('en-US');

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const mod = (e) => (isMac ? e.metaKey : e.ctrlKey);

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

export const blobToDataURL = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = rej;
  r.readAsDataURL(blob);
});

export function pickFile(accept) {
  return new Promise((res) => {
    const i = Object.assign(document.createElement('input'), { type: 'file', accept });
    i.onchange = () => res(i.files[0] || null);
    i.click();
  });
}

/** Safe filename from an Arabic or Latin title. */
export const fileSafe = (s) => (String(s || 'map').trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '-').slice(0, 60) || 'map');

/** Color helpers. */
export function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return Number.isNaN(n) ? [0, 0, 0] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgba = (hex, a) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Black or white, whichever reads on this background. */
export const onColor = (hex) => (luminance(hex) > 0.42 ? '#111111' : '#ffffff');
export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return '#' + A.map((v, i) => Math.round(lerp(v, B[i], t)).toString(16).padStart(2, '0')).join('');
}

/** Tiny IndexedDB key-value store (projects, fonts, autosave). */
const DB = 'aj-map-studio';
let dbp;
function db() {
  dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
export const idb = {
  async get(k) { try { const d = await db(); return await new Promise((res, rej) => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); } catch { return undefined; } },
  async set(k, v) { try { const d = await db(); await new Promise((res, rej) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); return true; } catch { return false; } },
  async del(k) { try { const d = await db(); await new Promise((res) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = res; }); } catch {} },
};

export const local = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
