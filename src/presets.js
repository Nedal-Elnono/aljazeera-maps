// Everything a designer picks from a list: sizes, map looks, colors, fonts, label looks.

export const ARTBOARDS = [
  { id: 'ig45', label: '4:5', name: 'إنستغرام', w: 1080, h: 1350 },
  { id: 'sq', label: '1:1', name: 'مربّع', w: 1080, h: 1080 },
  { id: 'tv', label: '16:9', name: 'شاشة', w: 1920, h: 1080 },
  { id: 'story', label: '9:16', name: 'ستوري', w: 1080, h: 1920 },
  { id: '4k', label: '4K', name: 'بث 4K', w: 3840, h: 2160 },
];

/** The post size an artboard stands for — also when the post frame is off (free), so type and
 *  markers keep the size they'd have in that post. */
export const refSize = (a) => {
  if (a && !a.free) return { w: a.w, h: a.h };
  if (a?.refW && a?.refH) return { w: a.refW, h: a.refH };   // a custom size, remembered when the frame went off
  const p = ARTBOARDS.find((x) => x.id === a?.preset);
  return p ? { w: p.w, h: p.h } : { w: 1080, h: 1350 };
};
/** The size new things are sized for: the post, or (frame off) the post it stands for. */
export const designSize = (a) => (a?.free ? refSize(a) : { w: a.w, h: a.h });
/** How big a post shows in a stage of SW×SH (room around it, and for the dock below). */
export const fitZoom = (w, h, SW, SH) => Math.min(4, Math.max(0.05, Math.min((SW - 64) / w, (SH - 148) / h)));

// The map looks, read off the newsroom's own maps.
export const STYLES = {
  light: {
    name: 'رمادي فاتح', sea: '#cad9e4', land: '#ebebeb', border: '#ffffff', borderWidth: 1.6, coast: 'none', coastWidth: 0,
    label: '#8e8e8e', seaLabel: '#7f97aa', river: '#cad9e4', lake: '#cad9e4', admin1: '#ffffff', city: '#555555',
    highlight: '#6b6b6b', texture: 'none', vignette: 0,
  },
  dark: {
    name: 'ليلي', sea: '#0c0c0c', land: '#1f1f1f', border: '#3a3a3a', borderWidth: 1.2, coast: '#2c2c2c', coastWidth: 1,
    label: '#6a6a6a', seaLabel: '#4d4d4d', river: '#2a2a2a', lake: '#0c0c0c', admin1: '#3a3a3a', city: '#bdbdbd',
    highlight: '#7a7a7a', texture: 'grain', vignette: 0.55,
  },
  ocean: {
    name: 'بحر أزرق', sea: '#97c3dc', land: '#f1f1f1', border: '#8f8f8f', borderWidth: 1.4, coast: 'none', coastWidth: 0,
    label: '#555555', seaLabel: '#4f7f9c', river: '#97c3dc', lake: '#97c3dc', admin1: '#bdbdbd', city: '#333333',
    highlight: '#d9d9d9', texture: 'none', vignette: 0,
  },
  navy: {
    name: 'كحلي', sea: '#1d3349', land: '#cdd1d7', border: '#9aa3ad', borderWidth: 1.4, coast: 'none', coastWidth: 0,
    label: '#78838f', seaLabel: '#5d7690', river: '#1d3349', lake: '#1d3349', admin1: '#aeb5bd', city: '#3a3f45',
    highlight: '#aab1ba', texture: 'none', vignette: 0,
  },
  paper: {
    name: 'ورقي', sea: '#dde5ea', land: '#f5f2ec', border: '#d4ccbf', borderWidth: 1.4, coast: 'none', coastWidth: 0,
    label: '#9b9185', seaLabel: '#8ba0ad', river: '#c9d6de', lake: '#dde5ea', admin1: '#e3ddd3', city: '#5d554b',
    highlight: '#8c8275', texture: 'none', vignette: 0,
  },
  mono: {
    name: 'أحادي', sea: '#f6f6f6', land: '#dcdcdc', border: '#ffffff', borderWidth: 1.6, coast: 'none', coastWidth: 0,
    label: '#8a8a8a', seaLabel: '#b3b3b3', river: '#f6f6f6', lake: '#f6f6f6', admin1: '#ececec', city: '#444444',
    highlight: '#1c1c1c', texture: 'none', vignette: 0,
  },
  ember: {
    name: 'جمر', sea: '#120b0c', land: '#271a1c', border: '#3f2a2d', borderWidth: 1.2, coast: '#33232600', coastWidth: 0,
    label: '#6e5558', seaLabel: '#4d393b', river: '#2b1d1f', lake: '#120b0c', admin1: '#3a2729', city: '#d9c4c6',
    highlight: '#8a3a41', texture: 'grain', vignette: 0.6,
  },
  // Apple Maps' colors (the same ones as the real map's Apple themes).
  apple: {
    name: 'أبل فاتح', sea: '#8ddbf6', land: '#f5edd6', border: '#d49cbc', borderWidth: 1.4, coast: 'none', coastWidth: 0,
    label: '#7b345e', seaLabel: '#4f96ba', river: '#8ddbf6', lake: '#8ddbf6', admin1: '#e0b9cd', city: '#1c1c1c',
    highlight: '#cdebb0', texture: 'none', vignette: 0,
  },
  appleDark: {
    name: 'أبل داكن', sea: '#1f3580', land: '#747660', border: '#a07892', borderWidth: 1.3, coast: 'none', coastWidth: 0,
    label: '#bb98ad', seaLabel: '#5d88c8', river: '#1f3580', lake: '#1f3580', admin1: '#8a6c80', city: '#dae4ed',
    highlight: '#316756', texture: 'none', vignette: 0,
  },
};

export const STYLE_KEYS = ['sea', 'land', 'border', 'label', 'seaLabel', 'river', 'admin1', 'city', 'highlight'];

// The newsroom's working palette (from their published maps) plus neutrals.
export const PALETTE = [
  '#e8323c', '#a8303f', '#f2c230', '#d9661f', '#2f80ed', '#1fb6e8', '#8c8a2a', '#2e9e6b',
  '#111111', '#4a4a4a', '#6b6b6b', '#9b9b9b', '#d0d0d0', '#ffffff', '#1d3349', '#7a3fb0',
];

export const FONTS = [
  { family: 'IBM Plex Sans Arabic', weights: [400, 500, 700], label: 'آي بي إم بلكس' },
  { family: 'Tajawal', weights: [400, 500, 700, 800], label: 'تجوال' },
  { family: 'Cairo', weights: [400, 600, 700, 800], label: 'القاهرة' },
  { family: 'Noto Kufi Arabic', weights: [400, 600, 700, 800], label: 'نوتو كوفي' },
  { family: 'Almarai', weights: [400, 700, 800], label: 'المراعي' },
  { family: 'Readex Pro', weights: [400, 500, 700], label: 'ريدكس' },
  { family: 'Noto Naskh Arabic', weights: [400, 600, 700], label: 'نوتو نسخ' },
];
export const DEFAULT_FONT = 'IBM Plex Sans Arabic';

export const googleFontsHref = () =>
  'https://fonts.googleapis.com/css2?' +
  FONTS.map((f) => `family=${f.family.replace(/ /g, '+')}:wght@${f.weights.join(';')}`).join('&') +
  '&display=swap';

// Text looks for labels and marker captions.
export const LABEL_STYLES = {
  plain:  { name: 'عادي', bg: null, color: '#8e8e8e', weight: 500, halo: null },
  halo:   { name: 'بهالة', bg: null, color: '#111111', weight: 700, halo: '#ffffff' },
  dark:   { name: 'صندوق أسود', bg: '#111111', color: '#ffffff', weight: 700, halo: null },
  red:    { name: 'صندوق أحمر', bg: '#e8323c', color: '#ffffff', weight: 700, halo: null },
  light:  { name: 'صندوق فاتح', bg: '#f2f2f2', color: '#111111', weight: 700, halo: null },
  yellow: { name: 'صندوق أصفر', bg: '#f2c230', color: '#111111', weight: 700, halo: null },
  white:  { name: 'نص أبيض', bg: null, color: '#ffffff', weight: 700, halo: null },
};

export const MARKER_SHAPES = [
  { id: 'dot', name: 'نقطة' },
  { id: 'pulse', name: 'نبض' },
  { id: 'ring', name: 'حلقة' },
  { id: 'pin', name: 'دبوس' },
  { id: 'square', name: 'مربع' },
  { id: 'diamond', name: 'معيّن' },
  { id: 'icon', name: 'أيقونة' },
  { id: 'flag', name: 'علم' },
  { id: 'image', name: 'صورة' },
];

export const DASHES = { solid: null, dashed: '10 7', dotted: '1 6', long: '22 10' };

export const PROJECTIONS = [
  { id: 'mercator', name: 'مركاتور' },
  { id: 'equalEarth', name: 'الأرض المتساوية' },
  { id: 'naturalEarth', name: 'طبيعية' },
  { id: 'orthographic', name: 'كرة أرضية' },
];

export const WORLDVIEWS = [
  { id: 'pse', name: 'فلسطين' },
  { id: 'default', name: 'الأمر الواقع' },
  { id: 'sau', name: 'السعودية' },
  { id: 'egy', name: 'مصر' },
  { id: 'mar', name: 'المغرب' },
  { id: 'tur', name: 'تركيا' },
];
