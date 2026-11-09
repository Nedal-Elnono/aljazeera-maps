// Starting points modeled on the newsroom's own map formats. Text is placeholder to replace.
import { newDoc, baseStyle, makeElement } from './store.js';
import { fitBounds } from './geo/projection.js';
import * as D from './geo/data.js';

const at = (doc, bounds, pad = 0.12) => { doc.view = fitBounds(doc.view, bounds, doc.artboard.w, doc.artboard.h, pad); return doc; };
const E = makeElement;

export const TEMPLATES = [
  {
    id: 'street', real: true, name: 'شوارع مدينة', desc: 'خريطة حقيقية بالشوارع والأحياء — نقطة وتسمية وصندوق شرح',
    async build() {
      const d = newDoc();
      d.name = 'وسط بيروت';
      d.real = { ...d.real, theme: 'grey' };
      d.view = { projection: 'mercator', center: [35.507, 33.893], zoom: 11.6 };
      d.elements.push(
        E('marker', { at: [35.5134, 33.8959], shape: 'pulse', color: '#e8323c', size: 34, text: 'موقع الحدث', labelStyle: 'dark', labelSize: 34, side: 'left', gap: 18 }),
        E('circle', { at: [35.5134, 33.8959], radius: 0.6, fill: '#e8323c', opacity: 0.12, stroke: '#e8323c', strokeWidth: 2.5, dash: 'dashed' }),
        E('textbox', { x: 88, y: 1010, w: 904, title: 'عنوان الخبر هنا', body: 'سطر أو سطران يشرحان ما حدث وأين — **الأرقام المهمة** بخط عريض و==الكلمة المميزة== باللون.', bg: '#ffffff', bgOpacity: 0.94, titleSize: 46, bodySize: 31 }),
      );
      return d;
    },
  },
  {
    id: 'pipeline', name: 'دولة وخط', desc: 'تظليل دولة، مسار بطول محسوب، وصندوق شرح',
    async build() {
      const d = at(newDoc(), [[31, 12.5], [61, 32.5]], 0.04);
      d.name = 'خط شرق غرب';
      d.view.center = [d.view.center[0], d.view.center[1] - 2.2];
      d.labels['c:SAU'] = { dx: -70, dy: -150 };
      d.elements.push(
        E('region', { kind: 'country', a3: 'SAU', name: 'السعودية', fill: '#6b6b6b' }),
        E('line', { points: [[49.67, 25.94], [38.06, 24.09]], mode: 'arc', bend: 0.1, color: '#f2c230', width: 5, dist: true, distColor: '#bdbdbd', distOffset: 30, distSize: 30, name: 'بترو لاين' }),
        E('textbox', { x: 88, y: 805, w: 904, title: 'خط شرق - غرب السعودي (بترو لاين)', body: 'تمتلك السعودية أكبر بديل بري للمضيق عبر خط الأنابيب شرق-غرب المعروف باسم PETROLINE.\nينقل الخط النفط الخام من حقل بقيق في المنطقة الشرقية إلى ميناء ينبع على ساحل البحر الأحمر، بطاقة تصل إلى نحو **5 ملايين برميل يوميًا**.', bg: '#ececec', bgOpacity: 0.92, titleSize: 46, bodySize: 31 }),
      );
      return d;
    },
  },
  {
    id: 'hotspot', name: 'نقطة ساخنة', desc: 'دائرة تبرز موقعًا حساسًا مع نص ومصدر',
    async build() {
      const d = at(newDoc(), [[31, 13], [61, 33]], 0.04);
      d.name = 'مضيق هرمز';
      d.view.center = [d.view.center[0], d.view.center[1] - 2.4];
      d.elements.push(
        E('circle', { at: [56.35, 26.5], radius: 85, fill: '#f2c230', opacity: 0.78, stroke: '#d9661f', strokeWidth: 2, dash: 'dashed', legend: '' }),
        E('textbox', { x: 88, y: 805, w: 904, title: 'مضيق هرمز شريان الطاقة العالمي', body: 'يمر عبر مضيق هرمز يوميًا ما يقارب **20 مليون برميل** من النفط، أي نحو ==20% من الاستهلاك العالمي==.\nلذلك فإن أي تعطيل للملاحة فيه قد يسبب صدمة كبيرة لأسواق الطاقة العالمية.', bg: '#ececec', bgOpacity: 0.9, accent: '#111111', titleSize: 46, bodySize: 31 }),
        E('textbox', { x: 88, y: 1262, w: 904, title: '', body: 'المصدر: اكتب اسم المصدر هنا', bgOpacity: 0, bodySize: 22, color: '#555555', pad: 0, shadow: false }),
      );
      return d;
    },
  },
  {
    id: 'control', name: 'مناطق نفوذ — داكن', desc: 'محافظات ملوّنة حسب الجهة مع مفتاح تلقائي',
    async build() {
      const d = at(newDoc(), [[41.5, 11.5], [54, 19.5]], 0.06);
      d.style = { ...baseStyle('ember'), countryLabels: false, seaLabels: false };
      d.name = 'مناطق النفوذ';
      d.view.center = [d.view.center[0], d.view.center[1] - 1.1];
      const a = await D.loadAdmin1('YEM').catch(() => null);
      const groups = [
        { color: '#a8303f', legend: 'الجهة الأولى' }, { color: '#2f62c4', legend: 'الجهة الثانية' },
        { color: '#8c8a2a', legend: 'الجهة الثالثة' }, { color: '#d9661f', legend: 'الجهة الرابعة' },
      ];
      const used = new Set();
      for (const f of a?.features || []) {
        const { lx, ly, id, ar } = f.properties;
        const g = lx >= 45.6 ? 0 : ly < 13.25 && lx > 43.6 ? 1 : lx < 43.45 && ly < 13.1 ? 3 : 2;
        d.elements.push(E('region', { kind: 'admin1', a3: 'YEM', rid: id, name: ar, fill: groups[g].color, stroke: '#ffffff', strokeWidth: 0.6, legend: used.has(g) ? '' : groups[g].legend }));
        used.add(g);
      }
      d.elements.push(
        E('textbox', { x: 90, y: 200, w: 900, title: 'خريطة ما قبل توسع ==الجهة الثانية==', body: '30 ديسمبر 2025', align: 'center', bgOpacity: 0, color: '#ffffff', titleColor: '#e8323c', accent: '#e8323c', titleSize: 66, bodySize: 52, shadow: false }),
        E('legend', { x: 640, y: 960, bgOpacity: 0, color: '#ffffff', size: 32 }),
      );
      return d;
    },
  },
  {
    id: 'lens', name: 'عدسة على موقع', desc: 'دولة بمحافظاتها وعدسة قمر صناعي على نقطة',
    async build() {
      const d = at(newDoc(), [[43.5, 24.5], [63.5, 40]], 0.06);
      d.name = 'شارع ميرداماد';
      d.style.cities = false;
      d.elements.push(
        E('region', { kind: 'country', a3: 'IRN', name: 'إيران', fill: '#6b6b6b', inner: true, innerColor: '#858585', labelColor: 'none' }),
        E('marker', { at: [51.39, 35.69], shape: 'pulse', color: '#e8323c', size: 30, text: 'طهران', labelStyle: 'dark', labelSize: 34, side: 'left', gap: 16 }),
        E('callout', { at: [51.43, 35.758], x: 735, y: 710, r: 180, satZoom: 15.5, leader: 'elbow' }),
        E('textbox', { x: 104, y: 760, w: 430, title: 'شارع ميرداماد', body: 'العصب المالي والمصرفي السيادي لإيران ويحتضن برج البنك المركزي', bg: '#efefef', bgOpacity: 0.95, titleSize: 40, bodySize: 29, pad: 36 }),
      );
      return d;
    },
  },
  {
    id: 'frontline', real: true, name: 'منطقة مظللة وخط تماس', desc: 'خريطة حقيقية بالقرى والطرق — تخطيط مائل، خط ملوّن، نقاط ومفتاح',
    async build() {
      const d = newDoc();
      d.artboard = { preset: 'tv', w: 1920, h: 1080 };
      at(d, [[35.05, 33.0], [35.75, 33.45]], 0.04);
      d.name = 'منطقة عازلة';
      d.real = { ...d.real, theme: 'grey' };
      const zone = [[35.1, 33.09], [35.3, 33.07], [35.45, 33.08], [35.56, 33.16], [35.62, 33.27], [35.63, 33.36], [35.57, 33.37], [35.51, 33.27], [35.42, 33.18], [35.27, 33.16], [35.1, 33.17]];
      d.elements.push(
        E('area', { points: zone, fill: '#9b9b9b', opacity: 0.45, stroke: '', strokeWidth: 0, hatch: true, legend: 'المنطقة المظللة' }),
        E('line', { points: zone.slice(7).reverse().concat([[35.55, 33.3], [35.57, 33.37]]).slice(0, 5), mode: 'smooth', color: '#f2c230', width: 6, name: 'الخط الأصفر' }),
        E('marker', { at: [35.15, 33.12], shape: 'dot', size: 40, color: '#2f9cf0', stroke: '', legend: 'نقاط' }),
        E('marker', { at: [35.43, 33.12], shape: 'dot', size: 40, color: '#2f9cf0', stroke: '' }),
        E('marker', { at: [35.6, 33.31], shape: 'dot', size: 40, color: '#2f9cf0', stroke: '' }),
        E('label', { at: [35.13, 33.25], text: 'الخط الأصفر', style: 'dark', size: 36, accent: '#f2c230', leaderOn: true, to: [35.18, 33.165], leaderColor: '#111111' }),
        E('legend', { x: 1400, y: 880 }),
      );
      return d;
    },
  },
  {
    id: 'strikes', name: 'نقاط وإطار', desc: 'نقاط نابضة، إطار حول منطقة، ونص بكلمات مميّزة',
    async build() {
      const d = newDoc();
      d.artboard = { preset: 'custom', w: 1271, h: 1600 };
      at(d, [[43.5, 24.5], [63.5, 40]], 0.03);
      d.style = { ...baseStyle('navy'), land: '#f1f2f4', border: '#d5d9de', label: '#a3abb5', labelSize: 24 };
      d.name = 'خريطة الاستهدافات';
      const pts = [[51.39, 35.69], [46.29, 38.08], [47.07, 34.31], [47.0, 35.31], [51.67, 32.65], [48.67, 31.32], [45.07, 37.55], [48.51, 34.8], [48.36, 33.49], [46.42, 33.64], [52.53, 29.59]];
      d.elements.push(E('region', { kind: 'country', a3: 'IRN', name: 'إيران', fill: '#c6cbd2', inner: true, innerColor: '#a4acb6', innerNames: true, innerNameSize: 19, innerNameColor: '#8b95a1', labelColor: 'none' }));
      for (const p of pts) d.elements.push(E('marker', { at: p, shape: 'pulse', color: '#e8323c', size: 26 }));
      d.elements.push(
        E('frame', { a: [53.9, 36.2], b: [61.8, 27.3], stroke: '#ffffff', strokeWidth: 5, dash: 'dashed' }),
        E('textbox', { x: 130, y: 1020, w: 640, title: '', body: 'خريطة الاستهدافات تظهر ==طهران في الصدارة بواقع 31 استهدافًا من أصل 75== أي ما يتجاوز 40% من الإجمالي', bg: '#ffffff', bgOpacity: 1, bodySize: 46, lineHeight: 1.55, pad: 56, shadow: false }),
      );
      return d;
    },
  },
  {
    id: 'coast', name: 'مدن ساحلية', desc: 'بحر أزرق وتسميات بخطوط ربط وأعلام',
    async build() {
      const d = newDoc();
      d.artboard = { preset: 'custom', w: 1080, h: 1350 };
      at(d, [[-6.4, 34.4], [-2.2, 37.2]], 0.02);
      d.style = { ...baseStyle('ocean'), labelSize: 34 };
      d.name = 'سبتة ومليلية';
      d.elements.push(
        E('marker', { at: [-5.32, 35.89], shape: 'dot', size: 14, color: '#111111', stroke: '', text: 'سبتة', labelStyle: 'halo', labelSize: 38, side: 'right', leader: 'under', ldx: 30, ldy: -46 }),
        E('marker', { at: [-2.94, 35.29], shape: 'dot', size: 14, color: '#111111', stroke: '', text: 'مليلية', labelStyle: 'halo', labelSize: 38, side: 'right', leader: 'under', ldx: 10, ldy: -46 }),
        E('marker', { at: [-5.0, 35.84], shape: 'flag', flag: 'es', size: 30, stroke: '' }),
        E('marker', { at: [-2.75, 35.24], shape: 'flag', flag: 'es', size: 30, stroke: '' }),
      );
      return d;
    },
  },
  {
    id: 'globe', name: 'موقع على الكرة', desc: 'كرة أرضية تحدد مكان الحدث — لبداية التقرير',
    async build() {
      const d = newDoc();
      d.artboard = { preset: 'sq', w: 1080, h: 1080 };
      d.view = { projection: 'orthographic', center: [45, 24], zoom: 1.45 };
      d.style = { ...baseStyle('dark'), seaLabels: false, labelSize: 22, sea: '#121212', land: '#2a2a2a', texture: 'none', vignette: 0 };
      d.name = 'موقع الحدث';
      d.elements.push(
        E('region', { kind: 'country', a3: 'QAT', name: 'قطر', fill: '#e8323c' }),
        E('marker', { at: [51.2, 25.3], shape: 'ring', color: '#e8323c', size: 70, text: 'قطر', labelStyle: 'red', labelSize: 34, side: 'right', gap: 18 }),
      );
      return d;
    },
  },
];
