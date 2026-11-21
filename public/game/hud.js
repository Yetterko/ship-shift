// The HUD (FR-10): shift clock, score, the floor's name, the LIVE/DEMO pill (pill.js fills #pillSlot), watchers, Take a
// break, sound, help and the menu. One strip along the top; on an upright phone it wraps to two short rows.
import { mmss, emit } from './core.js';
import { F, now } from './floor.js';
import { isMuted, setMuted } from './audio.js';

const H = { el: null, last: '', score: null, clockText: '' };
const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const I = {
  sound: svg('<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" fill="currentColor"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
  mute: svg('<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'),
  help: svg('<path d="M8.5 9a3.6 3.6 0 1 1 5.6 3c-1.2.8-2.1 1.5-2.1 3" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="12" cy="19.3" r="1.8" fill="currentColor"/>'),
  menu: svg('<path d="M5 7h14M5 12h14M5 17h14" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/>'),
  eye: svg('<path d="M2.5 12c2.5-4.5 5.7-6.5 9.5-6.5s7 2 9.5 6.5c-2.5 4.5-5.7 6.5-9.5 6.5s-7-2-9.5-6.5z" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="12" cy="12" r="3" fill="currentColor"/>'),
  coffee: svg('<path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 10h1.5a2.5 2.5 0 0 1 0 5H16M7 3.5c0 1.5 1.5 1.5 1.5 3M11 3.5c0 1.5 1.5 1.5 1.5 3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
  star: svg('<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" fill="currentColor"/>'),
};

export function initHud(ui, ctx) {
  const el = document.createElement('header');
  el.className = 'fl-hud'; el.id = 'flHud';
  el.innerHTML = `
    <div class="fl-clock" id="flClock"><small>SHIFT 1</small><b>0:00</b></div>
    <div class="fl-score" id="flScore">${I.star}<b>0</b></div>
    <div class="fl-name" id="flName"></div>
    <div class="fl-pill" id="pillSlot"></div>
    <div class="fl-watch" id="flWatch" hidden title="People watching this floor">${I.eye}<b>0</b></div>
    <button type="button" class="fl-breakbtn" id="flBreakBtn" hidden>${I.coffee}<span>Take a break</span></button>
    <span class="fl-gap"></span>
    <button type="button" class="fl-rb" id="flSound" aria-label="Sound">${isMuted() ? I.mute : I.sound}</button>
    <button type="button" class="fl-rb" id="flHelp" aria-label="Help">${I.help}</button>
    <button type="button" class="fl-rb" id="flMenu" aria-label="Menu: other restaurants">${I.menu}</button>`;
  ui.append(el);
  if (ctx?.pillSlot) el.querySelector('#pillSlot').append(ctx.pillSlot);
  el.querySelector('#flSound').onclick = e => { setMuted(!isMuted()); e.currentTarget.innerHTML = isMuted() ? I.mute : I.sound; };
  el.querySelector('#flHelp').onclick = () => emit('help');
  el.querySelector('#flMenu').onclick = () => ctx?.openMenu?.();
  el.querySelector('#flBreakBtn').onclick = () => emit('takeBreak');
  H.el = el; H.last = ''; H.score = null;
}
export function disposeHud() { H.el?.remove(); H.el = null; }

/** Everything that changes with a snapshot. */
export function renderHud(S) {
  if (!H.el || !S) return;
  const $ = id => H.el.querySelector(id);
  const name = `No. ${S.number} · ${S.name}`;
  if ($('#flName').textContent !== name) $('#flName').textContent = name;
  if (H.score !== S.score) {
    const sc = $('#flScore'); sc.querySelector('b').textContent = String(S.score);
    if (H.score !== null) { sc.classList.remove('bump'); void sc.offsetWidth; sc.classList.add('bump'); }
    H.score = S.score;
  }
  const w = $('#flWatch'), n = S.watchers || 0;
  w.hidden = !n; w.querySelector('b').textContent = String(n);
  w.title = `${n} watching${F.you.canAct ? ' your floor' : ''}`;
  const br = $('#flBreakBtn');
  const can = F.you.canAct && S.phase === 'working' && S.shift.status === 'running' && (S.breakEligible || S.mustBreak);
  br.hidden = !can; br.classList.toggle('must', !!S.mustBreak || (S.mustBreakAt && S.mustBreakAt - now() < 20_000));
  H.el.classList.toggle('visitor', !F.you.canAct);
}
/** Every frame: the clock. "SHIFT 1 · SERVICE 4:26", the work stretch and, in Demo, the time left. */
export function tickHud() {
  const S = F.snap; if (!H.el || !S) return;
  const t = now();
  let small, big;
  if (S.shift.status === 'ended') { small = 'SHIFT OVER'; big = mmss(S.shift.endsAt - S.shift.startedAt); }
  else if (S.phase !== 'working') { small = S.phase === 'called_back' ? 'CALLED BACK' : 'ON BREAK'; big = mmss(t - S.phaseStartedAt); }
  else {
    small = `SHIFT 1 · SERVICE${S.shift.endsAt ? ` · ${mmss(S.shift.endsAt - t)} left` : ''}`;
    big = mmss(t - S.workStretchStartedAt);
  }
  const text = `${small}|${big}`;
  if (text !== H.clockText) { H.clockText = text; const c = H.el.querySelector('#flClock'); c.querySelector('small').textContent = small; c.querySelector('b').textContent = big; c.classList.toggle('late', !!(S.mustBreakAt && S.phase === 'working' && S.mustBreakAt - t < 20_000)); }
}
export const hudBottom = () => (H.el ? Math.round(H.el.getBoundingClientRect().bottom) : 58);
