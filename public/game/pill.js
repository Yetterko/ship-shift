// The LIVE / DEMO pill, its mode sheet, and the "end of your live budget" modal.
//
//   initPill({ shell, becomeVisitor })
//   pillElement()            the button; the shell hands it to the restaurant's HUD (#pillSlot)
//   renderPill(msg)          every `floor` message: "LIVE · Haiku 5.5 · $0.04 of $0.10" or "DEMO · pre-cooked"
//   openModeSheet()          switch mode; Demo -> Live only while budget and a live slot remain
//   budgetModal()            Continue in Demo kitchen, or Become a visitor
import { esc, toast, usd } from './core.js';
import { net, act } from './net.js';

let host = null, opt = null, btn = null, sheet = null, modalEl = null, last = null;
/** Why a kitchen that wanted Live runs in Demo (snapshot `demoReason`). */
export const WHY = {
  no_key: 'Live Chefs are off on this server (it has no API key), so this kitchen runs in Demo.',
  no_slot: 'Every live kitchen is taken right now, so this one runs in Demo.',
  no_budget: 'Your live budget is spent, so this kitchen runs in Demo.',
};

export function initPill(o) { host = o.shell; opt = o; }
export function pillElement() {
  if (!btn) {
    btn = document.createElement('button'); btn.type = 'button'; btn.className = 'sh-pill'; btn.id = 'modePill';
    btn.onclick = () => openModeSheet();
  }
  return btn;
}
export function pillText(floor) {
  if (!floor) return '';
  if (floor.mode !== 'live') return 'DEMO · pre-cooked';
  return `LIVE · ${floor.modelLabel || floor.model || 'Claude'} · ${usd(floor.budget?.spentUsd)} of ${usd(floor.budget?.capUsd)}`;
}
export function renderPill(msg) {
  const b = pillElement(), f = msg?.floor;
  last = msg || null;
  if (!f) { b.hidden = true; return; }
  const live = f.mode === 'live', mine = !!msg.you?.canAct || !!msg.you?.isOwner;
  const text = pillText(f);
  b.hidden = false;
  b.className = `sh-pill ${live ? 'live' : 'demo'}${mine ? '' : ' ro'}${f.budget?.blocked ? ' spent' : ''}`;
  b.disabled = !mine;
  b.setAttribute('aria-label', `${text}. ${mine ? 'Switch mode' : 'This kitchen\'s mode'}`);
  b.title = mine ? 'Switch between Live and Demo' : '';
  const html = live ? `<i></i><b>LIVE</b><span>${esc(f.modelLabel || '')}</span><em>${usd(f.budget?.spentUsd)} of ${usd(f.budget?.capUsd)}</em>` : '<i></i><b>DEMO</b><span>pre-cooked</span>';
  if (b.dataset.h !== html) { b.innerHTML = html; b.dataset.h = html; }
  if (sheet) fillSheet();
}
export function hidePill() { if (btn) btn.hidden = true; closeModeSheet(); last = null; }

export function openModeSheet() {
  if (sheet || !last?.floor || !(last.you?.canAct || last.you?.isOwner)) return;
  sheet = document.createElement('div'); sheet.className = 'sh-sheet sh-mode';
  sheet.innerHTML = '<div class="sh-card" role="dialog" aria-modal="true" aria-label="Kitchen mode"><h2>Kitchen mode</h2><div id="msBody"></div><button type="button" class="sh-btn ghost" data-do="close">Close</button></div>';
  host.append(sheet);
  sheet.addEventListener('click', e => {
    if (e.target === sheet || e.target.closest('[data-do="close"]')) return closeModeSheet();
    const m = e.target.closest('[data-mode]'); if (m && !m.disabled) setMode(m.dataset.mode);
  });
  fillSheet();
}
function fillSheet() {
  const f = last?.floor; if (!sheet || !f) return;
  const live = f.mode === 'live', can = !!f.budget?.canGoLive;
  const why = WHY[f.demoReason] || (f.budget?.spentUsd >= f.budget?.capUsd ? WHY.no_budget : 'No live kitchen is free right now, or the house budget is spent.');
  const note = !live && f.demoReason ? `<p class="sh-why">${esc(WHY[f.demoReason] || '')}</p>` : '';
  const html = `${note}
    <button type="button" class="sh-opt${live ? ' on' : ''}" data-mode="live" aria-pressed="${live}" ${!live && !can ? 'disabled' : ''}>
      <b><i class="live"></i>Live</b><span>Real Claude chefs on ${esc(f.modelLabel || 'Claude')}. ${usd(f.budget?.spentUsd)} of ${usd(f.budget?.capUsd)} used.</span>
      ${!live && !can ? `<small>${esc(why)}</small>` : ''}</button>
    <button type="button" class="sh-opt${live ? '' : ' on'}" data-mode="demo" aria-pressed="${!live}">
      <b><i class="demo"></i>Demo</b><span>Pre-cooked results and short timers. No API cost. A typed ticket gets the closest set-menu meal.</span></button>`;
  const body = sheet.querySelector('#msBody');
  if (body.dataset.h !== html) { body.innerHTML = html; body.dataset.h = html; }
}
export function closeModeSheet() { sheet?.remove(); sheet = null; }
async function setMode(mode) {
  if (last?.floor?.mode === mode) return closeModeSheet();
  const r = await act('setMode', { mode });
  if (!r.ok) { toast(r.code === 'no_slot' ? 'No live kitchen is free right now.' : r.code === 'no_budget' ? 'The live budget is spent.' : r.code === 'no_key' ? 'Live Chefs are off on this server: it has no API key.' : r.message || 'Could not switch.', 'bad'); return; }
  closeModeSheet();
  toast(mode === 'live' ? 'Live kitchen: real Claude chefs.' : 'Demo kitchen: pre-cooked results.', 'good');
}

export function budgetModal() {
  if (modalEl) return;
  closeModeSheet();
  modalEl = document.createElement('div'); modalEl.className = 'sh-sheet sh-budget';
  modalEl.innerHTML = `<div class="sh-card" role="alertdialog" aria-modal="true" aria-labelledby="bmTitle">
    <h2 id="bmTitle">That's the end of your live budget.</h2>
    <p>Your Chefs can keep cooking in the Demo kitchen with pre-cooked results, or you can look around as a visitor.</p>
    <div class="sh-stack"><button type="button" class="sh-btn big" data-do="demo">Continue in Demo kitchen</button><button type="button" class="sh-btn" data-do="visit">Become a visitor</button></div></div>`;
  host.append(modalEl);
  const close = () => { modalEl?.remove(); modalEl = null; };
  modalEl.querySelector('[data-do="demo"]').onclick = async e => {
    e.target.disabled = true;
    const r = await act('setMode', { mode: 'demo' });
    if (!r.ok && last?.floor?.mode !== 'demo') { e.target.disabled = false; toast(r.message || 'Could not switch. Try again.', 'bad'); return; }
    close(); toast('Demo kitchen: pre-cooked results.', 'good');
  };
  modalEl.querySelector('[data-do="visit"]').onclick = async e => { e.target.disabled = true; close(); opt.becomeVisitor(); };
  modalEl.querySelector('[data-do="demo"]').focus({ preventScroll: true });
}
export const budgetModalOpen = () => !!modalEl;
