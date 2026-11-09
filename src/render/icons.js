// Map icons drawn in a 24×24 box. Filled shapes read best at small sizes on busy maps.
const star = (n, r1, r2, rot = -90, jitter = 0) => {
  let d = '';
  for (let i = 0; i < n * 2; i++) {
    const r = (i % 2 ? r2 : r1) * (1 + (jitter ? Math.sin(i * 2.7) * jitter : 0));
    const a = ((rot + (i * 180) / n) * Math.PI) / 180;
    d += (i ? 'L' : 'M') + (12 + r * Math.cos(a)).toFixed(2) + ' ' + (12 + r * Math.sin(a)).toFixed(2);
  }
  return d + 'Z';
};
const sector = (a0, a1, r0, r1) => {
  const p = (a, r) => [(12 + r * Math.cos((a * Math.PI) / 180)).toFixed(2), (12 + r * Math.sin((a * Math.PI) / 180)).toFixed(2)];
  const [x0, y0] = p(a0, r1), [x1, y1] = p(a1, r1), [x2, y2] = p(a1, r0), [x3, y3] = p(a0, r0);
  return `M${x0} ${y0}A${r1} ${r1} 0 0 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 0 0 ${x3} ${y3}Z`;
};

export const ICONS = {
  blast:    { name: 'انفجار', d: star(11, 11.5, 5.2, -90, 0.12) },
  fire:     { name: 'حريق', d: 'M12 1.8c1.2 4 6.6 6.3 6.6 12.4a6.6 6.6 0 0 1-13.2 0c0-3.3 2-5.5 3.3-6.6 0 2.2 1.1 3.5 2.3 3.6-.2-4.1-.6-6.4 1-9.4z' },
  plane:    { name: 'طائرة', d: 'M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z' },
  drone:    { name: 'مسيّرة', d: 'M5 3.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6zM19 3.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6zM5 17.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6zM19 17.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6zM6.3 4.9l5.7 5.3 5.7-5.3 1.4 1.4-5.3 5.7 5.3 5.7-1.4 1.4-5.7-5.3-5.7 5.3-1.4-1.4 5.3-5.7-5.3-5.7zM9.5 9.5h5v5h-5z' },
  missile:  { name: 'صاروخ', d: 'M20.5 3.5l-1.2 6.7-8.6 8.6-5.5-5.5 8.6-8.6zM5.2 13.3l-3 .6 2.3 2.3zM10.7 18.8l-.6 3-2.3-2.3zM6.6 15.4l2 2-3.6 3.6-2-2z' },
  tank:     { name: 'دبابة', d: 'M2.5 15h19l-1.8 4.6H4.3zM6 10.5h9.5V15H6zM15.5 11.6h7v1.6h-7zM5.5 17.3a.9.9 0 1 0 0 .01zM9 9.3h4v1.2H9z' },
  ship:     { name: 'سفينة', d: 'M2 14h20l-3.2 6H5.2zM6 9h8v5H6zM15 10.5h3V14h-3zM9.4 4h1.6v5H9.4z' },
  anchor:   { name: 'ميناء', d: 'M12 1.8a2.6 2.6 0 0 1 1 5v2.4h3v2h-3v8.6c2.7-.4 4.8-2.5 5.2-5.3h-2l3.3-3.6 2.5 3.6h-1.8c-.5 4.2-4.1 7.5-8.2 7.5s-7.7-3.3-8.2-7.5H2l2.5-3.6 3.3 3.6h-2c.4 2.8 2.5 4.9 5.2 5.3v-8.6H8v-2h3V6.8a2.6 2.6 0 0 1 1-5zm0 1.8a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6z' },
  oil:      { name: 'نفط', d: 'M12 1.8S4.8 10 4.8 15a7.2 7.2 0 0 0 14.4 0C19.2 10 12 1.8 12 1.8z' },
  power:    { name: 'كهرباء', d: 'M13.5 1.5L4 14h7l-1.5 8.5L20 9.5h-7z' },
  factory:  { name: 'منشأة', d: 'M2 21.5V10l6 3.6V10l6 3.6V3.5h2.6v8h1.6v-8h2.6v18z' },
  bridge:   { name: 'جسر', d: 'M1.5 7h21v2.4h-1.7V20h-2.6v-3.3a6.2 6.2 0 0 0-12.4 0V20H3.2V9.4H1.5z' },
  building: { name: 'مبنى', d: 'M4 21.5V2.5h16v19h-6V17h-4v4.5zM7 5.5v3h3v-3zm7 0v3h3v-3zm-7 5v3h3v-3zm7 0v3h3v-3z', rule: 'evenodd' },
  hospital: { name: 'مستشفى', d: 'M9 2.5h6v6.5h6.5v6H15v6.5H9V15H2.5V9H9z' },
  tent:     { name: 'مخيم', d: 'M12 2.5l10.5 18.5h-21zM12 11.5L8.3 21h7.4z', rule: 'evenodd' },
  people:   { name: 'سكان', d: 'M8.5 3.5a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4zM16.5 5a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2zM2 21c0-4.4 2.9-7.6 6.5-7.6S15 16.6 15 21zM15.9 21c0-2.7-.8-5-2.2-6.6.9-.6 1.9-.9 3-.9 3.1 0 5.3 2.9 5.3 7.5z' },
  nuclear:  { name: 'نووي', d: `M12 9.6a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8z${sector(-120, -60, 3.6, 10.5)}${sector(0, 60, 3.6, 10.5)}${sector(120, 180, 3.6, 10.5)}` },
  warning:  { name: 'تحذير', d: 'M12 1.8L23.2 21.5H.8zM10.8 8.5v6.3h2.4V8.5zm0 8.2v2.4h2.4v-2.4z', rule: 'evenodd' },
  target:   { name: 'هدف', d: 'M12 1.5a10.5 10.5 0 1 1 0 21 10.5 10.5 0 0 1 0-21zm0 2.6a7.9 7.9 0 1 0 0 15.8 7.9 7.9 0 0 0 0-15.8zM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z', rule: 'evenodd' },
  flag:     { name: 'راية', d: 'M4.5 1.5h2.2v21H4.5zM6.7 2.6h13l-3.3 5 3.3 5h-13z' },
  star:     { name: 'نجمة', d: star(5, 11, 4.6) },
};

/** A map pin (teardrop) of height h, tip at (0,0), pointing down. */
export function pinPath(h) {
  const r = h * 0.36, cy = -h + r;
  return `M0 0C${-r * 0.35} ${-h * 0.34} ${-r} ${cy + r * 0.62} ${-r} ${cy}A${r} ${r} 0 1 1 ${r} ${cy}C${r} ${cy + r * 0.62} ${r * 0.35} ${-h * 0.34} 0 0Z`;
}
