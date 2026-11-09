// Street-level detail from OpenStreetMap (Overpass API) for close-up maps: roads, rivers and
// towns with their Arabic names. Public servers get busy, so several are tried in turn.
// Data © OpenStreetMap contributors, ODbL — credited on the exported map.

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const STAGGER = 5000; // start the next server if the previous hasn't answered by then
const AR = /[؀-ۿ]/;
const r5 = (n) => Math.round(n * 1e5) / 1e5;

export const MAX_AREA = 4; // square degrees

export async function fetchDetail([w, s, e, n], onStatus = () => {}) {
  const area = (e - w) * (n - s);
  if (area > MAX_AREA) throw new Error('too-big');
  const bb = `${s.toFixed(4)},${w.toFixed(4)},${n.toFixed(4)},${e.toFixed(4)}`;
  const roads = area < 0.6 ? 'motorway|trunk|primary|secondary|tertiary' : 'motorway|trunk|primary|secondary';
  const places = area < 1.2 ? 'city|town|village' : 'city|town';
  const q = `[out:json][timeout:60];(way["highway"~"^(${roads})$"](${bb});way["waterway"~"^(river|canal)$"](${bb});node["place"~"^(${places})$"](${bb}););out geom qt;`;
  // Hedged requests: servers start a few seconds apart; the first good answer wins, the rest are cancelled.
  const controllers = [];
  let done = false, started = 0;
  const attempt = (ep, i) => new Promise((resolve, reject) => {
    setTimeout(async () => {
      if (done) return reject(new Error('cancelled'));
      started = Math.max(started, i + 1);
      onStatus(`جارٍ السؤال: ${started} من ${ENDPOINTS.length} خوادم…`);
      const ac = new AbortController();
      controllers.push(ac);
      const t = setTimeout(() => ac.abort(), 75000);
      try {
        const r = await fetch(ep, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ac.signal });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        resolve(parse(j, [w, s, e, n]));
      } catch (err) { reject(err); } finally { clearTimeout(t); }
    }, i * STAGGER);
  });
  try {
    return await Promise.any(ENDPOINTS.map(attempt));
  } catch {
    throw new Error('overpass');
  } finally {
    done = true;
    controllers.forEach((c) => c.abort());
  }
}

function parse(j, bbox) {
  const roads = [], rivers = [], places = [];
  const cls = { motorway: 1, trunk: 1, primary: 2, secondary: 2, tertiary: 3 };
  for (const el of j.elements || []) {
    const t = el.tags || {};
    if (el.type === 'way' && el.geometry) {
      const g = el.geometry.map((p) => [r5(p.lon), r5(p.lat)]);
      if (t.highway) roads.push({ c: cls[t.highway] || 3, g });
      else if (t.waterway) rivers.push(g);
    } else if (el.type === 'node' && t.place) {
      const name = t.name || '';
      places.push({
        id: el.id, lon: r5(el.lon), lat: r5(el.lat),
        ar: t['name:ar'] || (AR.test(name) ? name : ''), en: t['name:en'] || (!AR.test(name) ? name : ''),
        r: t.place === 'city' ? 1 : t.place === 'town' ? 2 : 3, pop: +t.population || 0,
      });
    }
  }
  places.sort((a, b) => a.r - b.r || b.pop - a.pop);
  return { at: Date.now(), bbox, roads, rivers, places: places.slice(0, 400) };
}
