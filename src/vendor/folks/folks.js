// folks design system 1.0.0 · copied from src/folks.js by build.py
// folks design system · behaviors for the web.
// The CSS does the look; this does what CSS can't: rolling numbers, hold to confirm, a button that
// becomes its own progress bar, toasts with undo, the segmented thumb, sound and haptics.
// No dependencies. Import what you need:
//   import { shake, roll, hold, toast, sound } from './folks.js';
import { springs } from './folks.tokens.js';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

/* ---------- theme ---------- */

/** 'light', 'dark' or 'auto' (follows the system). Remembered. */
export function theme(mode) {
  if (mode === undefined) return store.get('folks.theme', 'auto');
  const root = document.documentElement;
  if (mode === 'auto') delete root.dataset.theme; else root.dataset.theme = mode;
  store.set('folks.theme', mode);
  return mode;
}
theme.restore = () => theme(theme());

/* ---------- haptics ---------- */

const PATTERNS = { tap: 8, tick: 4, lift: 12, drop: 14, success: [10, 40, 14], error: [18, 40, 18, 40, 18] };
/** The haptic vocabulary. Vibrates where the browser can (Android); a no-op elsewhere. */
export function haptic(name) {
  if (navigator.vibrate && PATTERNS[name] !== undefined) navigator.vibrate(PATTERNS[name]);
}

/* ---------- sound ---------- */

// Rules: only state changes make sound; every cue is under 250ms; rising means yes, falling means undo;
// wood and paper, not metal (noise transients and soft mallets, no pings); never twice the same
// (a little pitch and timing drift); one switch mutes everything, and it's remembered.
let ctx;
const audio = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());
const drift = (x, amount = 0.03) => x * (1 + (Math.random() * 2 - 1) * amount);

function noise(a, t, { dur = 0.03, freq = 2500, q = 1.2, gain = 0.25, type = 'bandpass' } = {}) {
  const len = Math.ceil(a.sampleRate * dur), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = buf; f.type = type; f.frequency.value = drift(freq); f.Q.value = q; g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination); src.start(t);
}
function mallet(a, t, { freq = 660, dur = 0.12, gain = 0.18, type = 'triangle' } = {}) {
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.value = drift(freq, 0.012);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  noise(a, t, { dur: 0.012, freq: freq * 3, q: 2, gain: gain * 0.6 });
}
const CUES = {
  tap:     (a, t) => noise(a, t, { dur: 0.025, freq: 2600, gain: 0.22 }),
  tick:    (a, t) => noise(a, t, { dur: 0.012, freq: 4200, gain: 0.1 }),
  lift:    (a, t) => noise(a, t, { dur: 0.07, freq: 1200, q: 0.8, gain: 0.12 }),
  drop:    (a, t) => { mallet(a, t, { freq: 190, dur: 0.09, gain: 0.3, type: 'sine' }); noise(a, t, { dur: 0.02, freq: 900, gain: 0.25, type: 'lowpass' }); },
  success: (a, t) => { mallet(a, t, { freq: 659 }); mallet(a, t + drift(0.075, 0.1), { freq: 988 }); },
  undo:    (a, t) => { mallet(a, t, { freq: 988, gain: 0.14 }); mallet(a, t + drift(0.075, 0.1), { freq: 659, gain: 0.14 }); },
  error:   (a, t) => { mallet(a, t, { freq: 150, dur: 0.08, gain: 0.28, type: 'sine' }); mallet(a, t + 0.09, { freq: 118, dur: 0.1, gain: 0.28, type: 'sine' }); },
  // The one sound the brand owns, kept for the rare moment: the bill is split. Four heads count off.
  split:   (a, t) => [523, 659, 784, 1047].forEach((f, i) => mallet(a, t + i * drift(0.055, 0.08), { freq: f, dur: 0.16, gain: 0.15 })),
};
export const sound = {
  get muted() { return store.get('folks.muted', false); },
  set muted(v) { store.set('folks.muted', !!v); },
  cues: Object.keys(CUES),
  /** Plays a cue unless muted. Needs one user gesture first (browsers' rule). */
  play(name) {
    if (this.muted || !CUES[name]) return;
    try { const a = audio(); if (a.state === 'suspended') a.resume(); CUES[name](a, a.currentTime + 0.005); } catch {}
  },
};

/** A state change, felt and heard together. */
export function feedback(name) {
  haptic(name);
  sound.play(name === 'lift' ? 'lift' : name);
}

/* ---------- motion ---------- */

const restart = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); el.addEventListener('animationend', () => el.classList.remove(cls), { once: true }); };

/** "Not yet." Shake instead of a disabled button that explains nothing; say why next to it. */
export function shake(el) { restart(el, 'f-shake'); feedback('error'); }
/** Something arrived: a quick pop. */
export function bounce(el) { restart(el, 'f-bounce'); }

/** Animates with one of the system's springs (press, lift, pop, settle, page). Interruptible. */
export function spring(el, keyframes, name = 'settle') {
  const s = springs[name];
  return el.animate(keyframes, { duration: reduced() ? 1 : s.ms, easing: CSS.supports('transition-timing-function', 'linear(0, 1)') ? s.css : s.fallback.easing, fill: 'both' });
}

/** Siblings enter one after another, 45ms apart. */
export function stagger(container, cls = 'f-rise') {
  [...container.children].forEach((c, i) => { c.style.setProperty('--i', i); c.classList.remove(cls); void c.offsetWidth; c.classList.add(cls); });
}

/** Moves list items to their new places (FLIP): reorders keep their identity instead of popping. */
export function reorder(container, change) {
  const before = new Map([...container.children].map(c => [c, c.getBoundingClientRect()]));
  change();
  for (const c of container.children) {
    const a = before.get(c); if (!a) continue;
    const b = c.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
    if (dx || dy) spring(c, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], 'settle');
  }
}

/* ---------- rolling numbers ---------- */

/** Each digit rolls to its new value. Call again with a new string; non-digits sit still. */
export function roll(el, text) {
  text = String(text);
  if (!el.classList.contains('f-roll')) el.classList.add('f-roll');
  const cells = [...el.children];
  const same = cells.length === text.length && cells.every((c, i) => (c.dataset.d !== undefined) === /\d/.test(text[i]));
  if (!same) {
    el.textContent = '';
    for (const ch of text) {
      if (/\d/.test(ch)) {
        const d = document.createElement('span'); d.className = 'f-roll__d'; d.dataset.d = '0';
        const s = document.createElement('span'); s.className = 'f-roll__s';
        for (let i = 0; i < 10; i++) { const n = document.createElement('span'); n.textContent = i; s.append(n); }
        d.append(s); el.append(d);
      } else { const sp = document.createElement('span'); sp.className = 'f-roll__sep'; sp.textContent = ch; el.append(sp); }
    }
    void el.offsetWidth;
  }
  [...el.children].forEach((c, i) => {
    if (c.dataset.d === undefined) { c.textContent = text[i]; return; }
    c.dataset.d = text[i];
    c.firstChild.style.transform = `translateY(${-Number(text[i]) * 1.2}em)`;
  });
  el.setAttribute('aria-label', text);
}

/* ---------- hold to confirm ---------- */

/** For actions that remove something: the button fills while held and acts when full. */
export function hold(el, { duration = 900, onConfirm } = {}) {
  let start = 0, raf = 0;
  const set = p => el.style.setProperty('--p', p);
  const tick = now => {
    const p = Math.min(1, (now - start) / duration); set(p);
    if (p < 1) raf = requestAnimationFrame(tick);
    else { stop(); feedback('success'); onConfirm?.(); setTimeout(() => set(0), 250); }
  };
  const begin = e => { e.preventDefault(); el.setPointerCapture?.(e.pointerId); el.classList.add('is-pressing'); start = performance.now(); feedback('tap'); raf = requestAnimationFrame(tick); };
  const stop = () => { cancelAnimationFrame(raf); el.classList.remove('is-pressing'); };
  const cancel = () => { if (!el.classList.contains('is-pressing')) return; stop(); set(0); };
  el.addEventListener('pointerdown', begin);
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onConfirm?.(); } });
  return () => stop();
}

/* ---------- a button that does the work in place ---------- */

/** idle → working (the button fills as progress) → done → idle. One button, three states.
    `work` gets a report(p) callback and returns a promise. */
export async function working(btn, work, { busy = 'Working', done = 'Done', after = 1400 } = {}) {
  if (btn.classList.contains('is-working')) return;
  const idle = btn.innerHTML;
  const label = html => { btn.innerHTML = `<span class="f-btn__state">${html}</span>`; };
  btn.classList.add('is-working'); btn.style.setProperty('--p', 0); label(busy);
  try {
    await work(p => btn.style.setProperty('--p', p));
    btn.style.setProperty('--p', 1); label(done); feedback('success');
  } catch (e) {
    btn.classList.remove('is-working'); btn.style.setProperty('--p', 0); btn.innerHTML = idle; shake(btn); return;
  }
  setTimeout(() => { btn.classList.remove('is-working'); btn.style.setProperty('--p', 0); btn.innerHTML = idle; }, after);
}

/* ---------- toasts ---------- */

let host;
/** An ink capsule at the bottom. With onUndo it offers Undo and stays 6s instead of 2.6s.
    Toasts that arrive within a moment of each other fold into one ("3 items removed"). */
export function toast(message, { onUndo, actionTitle = 'Undo', duration } = {}) {
  host ||= Object.assign(document.createElement('div'), { className: 'f-toasts f' });
  if (!host.isConnected) document.body.append(host);
  host.style.background = 'none';
  const el = document.createElement('div');
  el.className = 'f-toast'; el.setAttribute('role', 'status');
  const text = document.createElement('span'); text.textContent = message; el.append(text);
  if (onUndo) {
    const b = document.createElement('button'); b.textContent = actionTitle;
    b.onclick = () => { onUndo(); feedback('undo'); close(); };
    el.append(b);
  }
  const close = () => { el.classList.add('is-out'); setTimeout(() => el.remove(), 300); };
  el.onclick = e => { if (e.target === el || e.target === text) close(); };
  [...host.children].forEach(c => { c.classList.add('is-out'); setTimeout(() => c.remove(), 300); });
  host.append(el);
  setTimeout(close, duration ?? (onUndo ? 6000 : 2600));
  return close;
}

/* ---------- controls ---------- */

/** A switch: <button class="f-toggle" role="switch" aria-checked="false">. */
export function toggle(el, onChange) {
  el.addEventListener('click', () => {
    const on = el.getAttribute('aria-checked') !== 'true';
    el.setAttribute('aria-checked', on); feedback('tick'); onChange?.(on);
  });
}

/** A segmented control: <div class="f-seg"><span class="f-seg__thumb"></span><button>…</button>…</div>. */
export function segmented(el, onChange) {
  const buttons = [...el.querySelectorAll('button')];
  el.style.setProperty('--n', buttons.length);
  const pick = (i, quiet) => {
    el.style.setProperty('--i', i);
    buttons.forEach((b, j) => b.setAttribute('aria-selected', i === j));
    if (!quiet) { feedback('tick'); onChange?.(i, buttons[i]); }
  };
  buttons.forEach((b, i) => b.addEventListener('click', () => pick(i)));
  pick(Math.max(0, buttons.findIndex(b => b.getAttribute('aria-selected') === 'true')), true);
  return pick;
}

/** A sheet from the bottom over a scrim. Returns close(). */
export function sheet(content) {
  const scrim = Object.assign(document.createElement('div'), { className: 'f-scrim' });
  const el = Object.assign(document.createElement('div'), { className: 'f-sheet f', role: 'dialog' });
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = '<div class="f-grab"></div>';
  el.append(content);
  // No page jump: the scrollbar's room is kept while the page can't scroll.
  const gap = innerWidth - document.documentElement.clientWidth;
  document.documentElement.style.overflow = 'hidden';
  document.documentElement.style.paddingRight = gap + 'px';
  document.body.append(scrim, el);
  const close = () => {
    scrim.classList.add('is-out'); el.classList.add('is-out');
    setTimeout(() => { scrim.remove(); el.remove(); document.documentElement.style.overflow = ''; document.documentElement.style.paddingRight = ''; }, 300);
    removeEventListener('keydown', esc);
  };
  const esc = e => e.key === 'Escape' && close();
  scrim.onclick = close; addEventListener('keydown', esc);
  return close;
}

export default { theme, haptic, sound, feedback, shake, bounce, spring, stagger, reorder, roll, hold, working, toast, toggle, segmented, sheet };
