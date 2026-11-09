// Keyboard: tools by letter, space to pan, ⌘Z/⌘⇧Z, ⌘D, ⌘A, ⌘C/⌘X/⌘V, ⌘K, ⌘S, ⌘E, ⌘\ (panels), arrows to nudge
// (or to move the map when nothing is picked), + / − to zoom the map,
// Enter to type into the selected text, Alt+⇧+arrows / letters to align.
import { store, isElId } from '../store.js';
import { canvas } from './canvas.js';
import { keysState, finishDraft, cancelDraft } from './tools.js';
import { nudgeSel, duplicateSel, deleteSel, selectAll, restackSel, copySel, cutSel, pasteFrom, flash, alignSel } from './selection.js';
import { editText, isEditing } from './textedit.js';
import { TOOLS } from '../ui/dock.js';
import { openPalette } from '../ui/palette.js';
import { exportQuick } from '../ui/topbar.js';
import { togglePanels } from '../ui/panels.js';
import { saveProject } from '../export/export.js';
import { mod } from '../util.js';
import { feedback } from '../vendor/folks/folks.js';
import { keyPan, zoomBy } from './navigate.js';

const typing = (e) => e.target.closest?.('input, textarea, select, [contenteditable]');

export function undoRedo(redo) {
  const r = redo ? store.redo() : store.undo();
  if (!r) return;
  feedback(redo ? 'tick' : 'undo');
  flash((redo ? 'إعادة' : 'تراجع') + (typeof r === 'string' ? ': ' + r : ''));
}

export function initKeys() {
  addEventListener('keydown', (e) => {
    const m = mod(e);
    if (m && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
    if (typing(e)) { if (e.key === 'Escape') e.target.blur(); return; }

    if (m) {
      const k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); undoRedo(e.shiftKey); return; }
      if (k === 'y') { e.preventDefault(); undoRedo(true); return; }
      if (k === 'd') { e.preventDefault(); if (store.sels.length) duplicateSel(24); return; }
      if (k === 'a') { e.preventDefault(); selectAll(); return; }
      if (k === 's') { e.preventDefault(); saveProject(store.doc); return; }
      if (k === 'e') { e.preventDefault(); exportQuick(); return; }
      // No post frame to zoom: ⌘+ / ⌘− zoom the map (and keep the browser from zooming the page).
      if (k === '0') { e.preventDefault(); return; }
      if (k === '=' || k === '+') { e.preventDefault(); zoomBy(1); return; }
      if (k === '-') { e.preventDefault(); zoomBy(-1); return; }
      if (k === '\\' || e.code === 'Backslash') { e.preventDefault(); togglePanels(); return; } // both side panels
      if (k === ']' || k === '[') { e.preventDefault(); restackSel(k === ']' ? 1 : -1, e.shiftKey); return; }
      return; // ⌘C / ⌘X / ⌘V arrive as copy / cut / paste events below
    }

    if (e.key === ' ') { if (!keysState.space) { keysState.space = true; canvas.stage.classList.add('is-space'); } e.preventDefault(); return; }
    if (e.key === 'Escape') {
      if (store.draft) cancelDraft();
      else if (store.tool !== 'select') store.setTool('select');
      else store.select(null);
      return;
    }
    if (e.key === 'Enter') {
      if (store.draft) { finishDraft(); return; }
      // Enter on a selected text thing: start typing into it.
      if (store.sels.length === 1 || store.sel?.startsWith('label:')) { e.preventDefault(); editText(store.sel); return; }
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      if (store.draft) { store.draft.el.points.pop(); canvas.drawUI(); store.emit('draft'); return; }
      if (store.sel?.startsWith('label:')) { const key = store.sel.slice(6); store.update((d) => { d.labels[key] = { ...(d.labels[key] || {}), hidden: true }; }, { label: 'إخفاء اسم' }); store.select(null); return; }
      deleteSel();
      return;
    }
    if (e.key.startsWith('Arrow') && store.sels.length) {
      e.preventDefault();
      if (e.altKey && e.shiftKey) {
        // Alt+⇧+arrow: align (to each other, or one thing to the post frame).
        alignSel({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'top', ArrowDown: 'bottom' }[e.key]);
        return;
      }
      const s = e.shiftKey ? 10 : 1;
      nudgeSel(e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0);
      return;
    }
    // Nothing picked: the arrows move the map (Shift = further; hold to glide), + / − zoom.
    if (e.key.startsWith('Arrow') && !e.altKey) {
      e.preventDefault();
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (dir) keyPan(dir[0], dir[1], e.shiftKey);
      return;
    }
    if (!e.altKey && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '_')) {
      e.preventDefault();
      const step = e.repeat ? 0.4 : 1;
      zoomBy(e.key === '-' || e.key === '_' ? -step : step);
      return;
    }
    if (e.altKey || e.repeat) return;
    const t = TOOLS.find((x) => x.key && x.key.toLowerCase() === e.key.toLowerCase());
    if (t) { store.setTool(t.id); feedback('tick'); }
  });
  addEventListener('keyup', (e) => { if (e.key === ' ') { keysState.space = false; canvas.stage.classList.remove('is-space'); } });
  addEventListener('blur', () => { keysState.space = false; canvas.stage?.classList.remove('is-space'); });

  // Clipboard: our elements travel as text, so they paste across tabs and projects.
  const free = (e) => !typing(e) && !isEditing() && store.tool === 'select';
  document.addEventListener('copy', (e) => { if (free(e) && store.sels.length) copySel(e); });
  document.addEventListener('cut', (e) => { if (free(e) && store.sels.length) cutSel(e); });
  document.addEventListener('paste', (e) => { if (!typing(e) && !isEditing()) { if (store.tool !== 'select') store.setTool('select'); pasteFrom(e); } });
}

export { isElId };
