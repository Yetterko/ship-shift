// The break (FR-36, FR-37, FR-40): the dimmed scene and the break screen with the time away, how many Chefs are still
// working and whether call-backs are still held. At the maximum work time the same screen locks the floor until the
// player takes the break.
import { mmss, toast } from './core.js';
import { F, now } from './floor.js';
import { doAct, closePanel } from './panels.js';
import { askNotify } from './notify.js';

const B = { el: null, mode: null, warned: false };

export function initBreak(ui) {
  const el = document.createElement('div');
  el.className = 'fl-break'; el.id = 'flBreak'; el.hidden = true; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
  el.innerHTML = `<div class="fl-break-card">
    <div class="fl-cup" aria-hidden="true"><i></i><i></i><i></i><b></b></div>
    <small class="fl-break-kind"></small><h2 class="fl-break-title"></h2>
    <p class="fl-break-time"></p><p class="fl-break-info"></p>
    <button type="button" class="fl-btn ok big fl-break-go"></button></div>`;
  el.querySelector('.fl-break-go').onclick = () => (B.mode === 'must' ? takeBreak() : backToWork());
  ui.append(el); B.el = el; B.mode = null; B.warned = false;
}
export function disposeBreak() { B.el?.remove(); B.el = null; document.body.classList.remove('fl-onbreak'); }

export async function takeBreak() {
  if (!F.you.canAct) return;
  askNotify();
  const r = await doAct('startBreak', {});
  if (r.ok) closePanel();
  return r;
}
export async function backToWork() { return doAct('endBreak', {}); }

/** Shows, updates or hides the break screen. Called on every snapshot and every frame (for the time). */
export function showBreak(S = F.snap) {
  if (!B.el || !S) return;
  const owner = F.you.canAct;
  const mode = S.phase === 'break' ? 'break' : S.phase === 'called_back' ? 'called' : owner && S.mustBreak ? 'must' : null;
  if (S.shift.status !== 'running' && mode !== 'must') { hide(); return; }
  // the 20 second warning before the break becomes compulsory
  if (owner && S.phase === 'working' && S.mustBreakAt && !S.mustBreak) {
    const left = S.mustBreakAt - now();
    if (left < 20_000 && left > 0 && !B.warned) { B.warned = true; toast(`Maximum work time in ${Math.ceil(left / 1000)} s. Take a break soon.`, 'bad'); }
    if (left > 20_000) B.warned = false;
  }
  if (!mode) { hide(); return; }
  B.mode = mode;
  B.el.hidden = false; B.el.dataset.mode = mode;
  document.body.classList.add('fl-onbreak');
  const cooking = S.chefs.filter(c => c.status === 'cooking' || c.status === 'waiting_stove' || c.status === 'walking').length;
  const waiting = S.pass.filter(id => S.items[S.meals[id]?.itemId]?.status !== 'approved').length + S.tables.filter(c => c?.status === 'awaiting_player' && !c.feedbackRead).length;
  const q = s => B.el.querySelector(s);
  const t = now();
  if (mode === 'must') {
    q('.fl-break-kind').textContent = 'Maximum work time reached';
    q('.fl-break-title').textContent = 'Time for a break';
    q('.fl-break-time').textContent = `You have worked ${mmss(t - S.workStretchStartedAt)} without a break.`;
    q('.fl-break-info').textContent = 'The kitchen keeps cooking while you rest. Everything else waits until you take it.';
    q('.fl-break-go').textContent = 'Take a break';
  } else {
    const grace = S.callBack?.graceEndsAt, held = grace && grace > t;
    q('.fl-break-kind').textContent = mode === 'called' ? 'Call-back' : 'On a break';
    q('.fl-break-title').textContent = mode === 'called' ? callLine(S) : 'Step away from the pass';
    q('.fl-break-time').textContent = `Break ${mmss(t - S.phaseStartedAt)}`;
    q('.fl-break-info').textContent = mode === 'called'
      ? `${waiting} thing${waiting === 1 ? '' : 's'} waiting for you. Patience is draining.`
      : `${cooking} Chef${cooking === 1 ? '' : 's'} still working. ${held ? `Call-backs are held for ${mmss(grace - t)}.` : waiting ? 'Something is ready: calling you back shortly.' : "We'll call you back when something is ready."}`;
    q('.fl-break-go').textContent = 'Back to work';
    q('.fl-break-go').hidden = !owner;
  }
}
function callLine(S) {
  const m = S.pass.map(id => S.meals[id]).find(Boolean);
  if (m) { const c = [...S.tables].find(x => x?.order.id === m.orderId); if (c) return `Table ${c.table + 1}'s order is up!`; }
  const c = S.tables.find(x => x?.status === 'awaiting_player');
  return c ? `Table ${c.table + 1} is waiting` : 'Back of house!';
}
function hide() { if (!B.el || B.el.hidden) return; B.el.hidden = true; B.mode = null; document.body.classList.remove('fl-onbreak'); }
export const breakMode = () => B.mode;
