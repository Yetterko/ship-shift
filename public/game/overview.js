// The town overview: one card per restaurant. The Spectator's first screen and what the projector shows while the room plays.
//
//   initOverview({ shell, walkIn, toPark, toLanding, goHome, openMenu })
//   showOverview() / hideOverview()
//   renderOverview(building)      called on every `building` message while it is open
import { esc } from './core.js';
import { net } from './net.js';
import { roles, leaveQueue } from './roles.js';

let host = null, opt = null, el = null, lastKey = '';

export function initOverview(o) { host = o.shell; opt = o; }
export const overviewOpen = () => !!el;

export function showOverview() {
  if (el) return;
  el = document.createElement('section'); el.className = 'sh-over';
  el.innerHTML = `
    <header class="sh-bar">
      <div class="sh-brand">SHIP<span>SHIFT</span></div>
      <div class="sh-seg" role="group" aria-label="View"><button type="button" class="on" aria-pressed="true">Overview</button><button type="button" id="ovPark" aria-pressed="false">Walk the park</button></div>
      <span class="sh-gap"></span>
      <button type="button" class="sh-btn small" id="ovMain"></button>
      <button type="button" class="sh-icon" id="ovMenu" aria-label="All restaurants" title="All restaurants"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14" fill="none" stroke="currentColor" stroke-width="2.800" stroke-linecap="round"/></svg></button>
    </header>
    <div class="sh-over-body">
      <div class="sh-over-head"><h1>The town</h1><p id="ovSlots"></p></div>
      <div class="sh-queue" id="ovQueue" hidden>You are in the queue for a live kitchen. <button type="button" class="sh-link" id="ovLeaveQ">Leave the queue</button></div>
      <div class="sh-cards" id="ovCards"></div>
    </div>`;
  host.append(el);
  el.querySelector('#ovPark').onclick = () => opt.toPark();
  el.querySelector('#ovMenu').onclick = () => opt.openMenu();
  el.querySelector('#ovMain').onclick = () => (net.homeId ? opt.goHome() : opt.toLanding());
  el.querySelector('#ovLeaveQ').onclick = () => leaveQueue();
  el.querySelector('#ovCards').addEventListener('click', e => { const c = e.target.closest('[data-floor]'); if (c) opt.walkIn(c.dataset.floor); });
  lastKey = '';
  renderOverview(net.building);
}
export function hideOverview() { el?.remove(); el = null; }

const eye = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.500 12c2.500-4.500 5.700-6.500 9.500-6.500s7 2 9.500 6.500c-2.500 4.500-5.700 6.500-9.500 6.500s-7-2-9.500-6.500z" fill="none" stroke="currentColor" stroke-width="2.400" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>';
const PHASE = { break: 'On a break', called_back: 'Called back' };

function card(f) {
  const home = f.id === net.homeId, live = f.mode === 'live';
  const l = f.lights || {}, busy = [l.cooking ? `${l.cooking} cooking` : '', l.onPass ? `${l.onPass} on the pass` : '', l.waiting ? `${l.waiting} waiting` : ''].filter(Boolean).join(' · ');
  return `<button type="button" class="sh-cardf${home ? ' home' : ''}${f.kind === 'showcase' ? ' showcase' : ''}" data-floor="${esc(f.id)}" aria-label="No. ${f.number}, ${esc(f.name)}. ${live ? 'Live' : 'Demo'}. Score ${f.score}. ${f.shipped} shipped. ${f.watchers} watching. Walk in.">
    <span class="top"><b class="no">No. ${f.number}</b><span class="mode ${live ? 'live' : 'demo'}"><i></i>${live ? 'LIVE' : 'DEMO'}</span></span>
    <span class="name">${esc(f.name)}</span>
    <span class="nums"><span><b>${f.score}</b><small>score</small></span><span><b>${f.shipped}</b><small>shipped</small></span><span class="w">${eye}<b>${f.watchers}</b><small>watching</small></span></span>
    <span class="foot">${home ? '<u>Yours</u>' : ''}${f.ownerRole === 'judge' ? '<u class="j">Judge</u>' : ''}<em>${esc(PHASE[f.phase] || busy || 'Open')}</em><span class="go">Walk in</span></span>
  </button>`;
}

export function renderOverview(b = net.building) {
  if (!el) return;
  const main = el.querySelector('#ovMain');
  main.textContent = net.homeId ? 'Go to my kitchen' : net.role === 'spectator' || !net.role ? 'Start a kitchen' : 'Start a kitchen';
  el.querySelector('#ovQueue').hidden = !roles.queued;
  const floors = [...(b?.floors || [])].sort((x, y) => y.score - x.score || x.number - y.number);
  const s = b?.slots;
  el.querySelector('#ovSlots').textContent = !b ? 'Looking for kitchens…'
    : `${floors.length} ${floors.length === 1 ? 'kitchen' : 'kitchens'} open${s ? ` · ${s.liveUsed} of ${s.liveMax} live` : ''}${s?.queued ? ` · ${s.queued} waiting for a live one` : ''}`;
  const key = JSON.stringify([floors.map(f => [f.id, f.number, f.name, f.mode, f.score, f.shipped, f.watchers, f.phase, f.lights, f.ownerRole]), net.homeId]);
  if (key === lastKey) return;
  lastKey = key;
  const box = el.querySelector('#ovCards');
  const focus = document.activeElement?.dataset?.floor;
  box.innerHTML = floors.length ? floors.map(card).join('')
    : `<div class="sh-empty"><b>${b ? 'No kitchens are open yet.' : 'Looking for kitchens…'}</b>${b ? '<span>Be the first: tap Start a kitchen.</span>' : ''}</div>`;
  if (focus) box.querySelector(`[data-floor="${CSS.escape(focus)}"]`)?.focus({ preventScroll: true });
}
