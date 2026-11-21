// Kitchen calls (FR-38): the call-back after the grace period is a browser notification, a bell, a flashing tab title and
// a buzz on a phone. Every other `notify` is a short toast with its own sound.
import { toast, emit, esc, fx } from './core.js';
import { F } from './floor.js';

/** The "SHIPPED!" banner across the stage (FR-33). */
export function shipBanner(sub = '') {
  fx.banners++;
  let host = document.getElementById('banners');
  if (!host) { host = document.createElement('div'); host.id = 'banners'; host.className = 'banners'; (document.getElementById('stage') || document.body).append(host); }
  const el = document.createElement('div'); el.className = 'banner ship fl-shipped';
  el.innerHTML = `<b>SHIPPED!</b>${sub ? `<i>${esc(sub)}</i>` : ''}`;
  host.append(el); setTimeout(() => el.remove(), 2600);
  return el;
}

const N = { flashT: null, baseTitle: null, calledAt: new Set() };

/** Asked from a tap (Take a break), because browsers only show the prompt after a gesture. */
export function askNotify() {
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch?.(() => {}); } catch { /* not offered */ }
}

/** The call-back itself. text: what is waiting. key: one call-back per firing, however it arrives. */
export function callBack(kind = 'callBack', text = 'Your order is up!', key = null) {
  if (key && N.calledAt.has(key)) return false;
  if (key) N.calledAt.add(key);
  emit('sfx', 'bell'); setTimeout(() => emit('sfx', 'bell'), 700);
  try { if ('Notification' in window && Notification.permission === 'granted') new Notification('Ship Shift', { body: text, tag: 'shipshift-callback', renotify: true }); } catch { /* blocked */ }
  try { navigator.vibrate?.([180, 90, 180, 90, 320]); } catch { /* no motor */ }
  flashTitle(text);
  toast(text, 'call');
  emit('calledBack', kind);
  return true;
}
function flashTitle(text) {
  stopFlash();
  N.baseTitle = document.title;
  let on = false, n = 0;
  N.flashT = setInterval(() => {
    on = !on; n++;
    document.title = on ? `● ${text}` : N.baseTitle;
    if (n > 40) stopFlash();
  }, 700);
}
export function stopFlash() { if (N.flashT) { clearInterval(N.flashT); N.flashT = null; if (N.baseTitle) document.title = N.baseTitle; } }
addEventListener('focus', () => setTimeout(stopFlash, 1500));

const TEXT = {
  mealReady: ['Order up!', 'ding'], feedbackReady: ['Feedback is ready.', 'ask'], burnt: ['Something burnt. The Chef is trying again.', 'spoil'],
  stoveWait: ['Waiting for a stove: the kitchen is busy.', 'tick'], liveOff: ['Live cooking is off: the Demo kitchen takes over.', 'no'], mustBreak: ['Time for a break.', 'buzz'], slotFree: ['A live kitchen is free.', 'yes'],
};
/** A `notify` message for the floor on screen. */
export function handleNotify(msg) {
  if (!msg) return;
  if (msg.kind === 'callBack') { callBack('callBack', msg.text || 'Back of house!', F.snap?.callBack?.firedAt || msg.text); return; }
  if (msg.kind === 'shipped') { if (!F.you.canAct) shipBanner(msg.text); return; }
  if (msg.kind === 'budgetSpent' || msg.kind === 'floorClosed') return;      // the shell's modal and the shell's door
  if (!F.you.canAct) return;
  if (F.snap?.phase === 'break') return;                                       // a break is quiet until the call-back
  const [line, cue] = TEXT[msg.kind] || [msg.text, 'tick'];
  if (cue) emit('sfx', cue);
  if (msg.kind === 'mustBreak') emit('mustBreak');
  if (msg.text || line) toast(msg.text || line, msg.kind === 'burnt' ? 'bad' : '');
}

/** The snapshot shows a call-back that the socket's notify may have missed (a reconnect, a locked phone). */
export function notifyFromSnapshot(prev, S) {
  if (!F.you.canAct) return;
  if (S.phase === 'called_back' && S.callBack?.firedAt && (!prev || prev.phase !== 'called_back')) callBack('callBack', 'Back of house! Something is waiting.', S.callBack.firedAt);
  if (S.phase === 'working' && prev?.phase !== 'working') stopFlash();
}
export function disposeNotify() { stopFlash(); N.calledAt.clear(); }
