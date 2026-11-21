// Arrival: the landing with the role picker, the "all live kitchens are busy" sheet, and the kitchen setup chalkboard.
//
//   showLanding()                 "Who's here?" with Spectator preselected
//   pickRole(role)                spectator -> the town overview; player or judge -> chalkboard, or the busy sheet
//   showBusy(options)             Demo kitchen, look around, or queue for a live kitchen
//   showChalkboard({ mode })      name, grace period, maximum work time -> createFloor
//   initRoles({ shell, go })      go.overview(), go.home() are the shell's routes
import { esc, toast, store, mmss } from './core.js';
import { net, request, send, on, buildingReady } from './net.js';

let host = null, go = null, layer = null, queued = false, busyRole = null;
export const roles = { get queued() { return queued; } };

const NAMES_A = ['Hungry', 'Sleepy', 'Flaky', 'Greedy', 'Merry', 'Tidy', 'Rusty', 'Sunny', 'Salty', 'Crispy', 'Lucky', 'Nimble'];
const NAMES_B = ['Linter', 'Compiler', 'Rebase', 'Hotfix', 'Pipeline', 'Semicolon', 'Cache', 'Diff', 'Merge', 'Stack', 'Kernel', 'Refactor'];
export const randomName = () => `The ${NAMES_A[Math.floor(Math.random() * NAMES_A.length)]} ${NAMES_B[Math.floor(Math.random() * NAMES_B.length)]}`;

export function initRoles(opts) {
  host = opts.shell; go = opts.go;
  on('notify', m => { if (m.kind === 'slotFree') slotFree(); });
}
function clear() { layer?.remove(); layer = null; }
export const closeRoles = clear;
function open(cls, html) {
  clear();
  layer = document.createElement('section'); layer.className = `sh-full ${cls}`; layer.innerHTML = html;
  host.append(layer); return layer;
}

const ROLE_INFO = {
  spectator: ['Spectator', 'Watch every kitchen in town. Walk into any of them.', 'eye'],
  player: ['Player', 'Run your own kitchen with two Claude chefs.', 'hat'],
  judge: ['Judge', 'A reserved kitchen on the stronger model.', 'star'],
};
const GLYPH = {
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12c2.5-4.500 5.700-6.500 9.500-6.500s7 2 9.500 6.500c-2.500 4.500-5.700 6.500-9.500 6.500s-7-2-9.500-6.500z" fill="none" stroke="currentColor" stroke-width="2.400" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>',
  hat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 14.500a4.200 4.200 0 0 1 1-8.200 4.600 4.600 0 0 1 8 0 4.200 4.200 0 0 1 1 8.200V19.500H7z" fill="none" stroke="currentColor" stroke-width="2.400" stroke-linejoin="round"/><path d="M7 16.500h10" stroke="currentColor" stroke-width="2"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.500l2.900 6 6.600.9-4.800 4.600 1.200 6.500L12 17.400l-5.900 3.100 1.200-6.500L2.500 9.400l6.600-.9z" fill="currentColor"/></svg>',
};

export function showLanding() {
  document.body.dataset.view = 'landing';
  const el = open('sh-landing', `
    <div class="sh-land">
      <h1 class="sh-word">SHIP<span>SHIFT</span></h1>
      <p class="sh-tag">Claude cooks the code. You run the pass, then take your break.</p>
      <p class="sh-pitch">A kitchen game where the chefs are AI coding agents and the scarce thing is your attention.</p>
      <h2 class="sh-who" id="whoTitle">Who's here?</h2>
      <div class="sh-roles" role="group" aria-labelledby="whoTitle">
        ${Object.entries(ROLE_INFO).map(([id, [name, what, glyph]]) => `
        <button type="button" class="sh-role${id === 'spectator' ? ' sel' : ''}" data-role="${id}" aria-pressed="${id === 'spectator'}">
          <span class="g">${GLYPH[glyph]}</span><b>${name}</b><small>${what}</small>${id === 'spectator' ? '<i>Start here</i>' : ''}
        </button>`).join('')}
      </div>
      <p class="sh-conn" id="landConn" aria-live="polite">${net.connected ? '' : 'Connecting…'}</p>
      <p class="sh-fine">Phones get a lighter stand-in of the stage kitchen: chefs write their answer as text instead of editing a repo.</p>
    </div>`);
  for (const b of el.querySelectorAll('.sh-role')) b.onclick = () => pickRole(b.dataset.role);
  el.querySelector('[data-role="spectator"]').focus({ preventScroll: true });
}

let picking = false;
export async function pickRole(role) {
  if (picking) return; picking = true;
  try {
    for (const b of layer?.querySelectorAll('.sh-role') || []) { b.classList.toggle('sel', b.dataset.role === role); b.setAttribute('aria-pressed', String(b.dataset.role === role)); b.disabled = true; }
    const res = await request('chooseRole', { role });
    if (res.type === 'error') { toast(res.message || 'Could not join. Try again.', 'bad'); for (const b of layer?.querySelectorAll('.sh-role') || []) b.disabled = false; return; }
    store.set('role', role);
    if (role === 'spectator') { clear(); go.overview(); return; }
    // No key on the server (or the admin flipped the default): every kitchen is a Demo kitchen and needs no live slot.
    if (net.welcome?.defaults?.mode === 'demo') { showChalkboard({ mode: 'demo' }); return; }
    // welcome.liveOpen says whether a live floor could start now for this role; an older server leaves it to the summary
    let free = res.liveOpen;
    if (typeof free !== 'boolean') {
      const b = await buildingReady();
      const s = b?.slots; free = !b ? true : role === 'judge' ? (b.liveOpen || (s && s.judgeUsed < s.judgeMax)) : b.liveOpen;
    }
    if (free) showChalkboard({ mode: 'live' }); else showBusy(['demo', 'visit', 'queue'], role);
  } finally { picking = false; }
}

export function showBusy(options = ['demo', 'visit', 'queue'], role = net.role) {
  busyRole = role;
  document.body.dataset.view = 'landing';
  const has = o => options.includes(o);
  const el = open('sh-busy', `
    <div class="sh-card">
      <h2>All live kitchens are busy.</h2>
      <p>Every live kitchen in town has a cook in it right now. You can still play: the Demo kitchen has pre-cooked results and the same game.</p>
      <div class="sh-stack">
        ${has('demo') ? '<button type="button" class="sh-btn big" data-do="demo">Play the Demo kitchen</button>' : ''}
        ${has('visit') ? '<button type="button" class="sh-btn" data-do="visit">Look around as a visitor</button>' : ''}
        ${has('queue') ? '<button type="button" class="sh-btn" data-do="queue">Join the queue for a live kitchen</button>' : ''}
      </div>
    </div>`);
  el.querySelector('[data-do="demo"]')?.addEventListener('click', () => showChalkboard({ mode: 'demo' }));
  el.querySelector('[data-do="visit"]')?.addEventListener('click', () => { clear(); go.overview(); });
  el.querySelector('[data-do="queue"]')?.addEventListener('click', () => { joinQueue(); clear(); go.overview(); });
}

export function joinQueue() { queued = true; send('joinQueue', {}); toast('You are in the queue for a live kitchen. We will call you.', 'good'); go.queueChanged?.(); }
export function leaveQueue() { if (!queued) return; queued = false; send('leaveQueue', {}); go.queueChanged?.(); }
function slotFree() {
  queued = false; go.queueChanged?.();
  const el = document.createElement('div'); el.className = 'sh-sheet';
  el.innerHTML = `<div class="sh-card" role="dialog" aria-modal="true" aria-label="A live kitchen is free">
    <h2>A live kitchen is free!</h2><p>It is held for you for 30 seconds.</p>
    <div class="sh-stack"><button type="button" class="sh-btn big" data-do="take">Take it</button><button type="button" class="sh-btn" data-do="no">Not now</button></div></div>`;
  host.append(el);
  const gone = setTimeout(() => el.remove(), 30000);
  el.querySelector('[data-do="take"]').onclick = () => { clearTimeout(gone); el.remove(); showChalkboard({ mode: 'live' }); };
  el.querySelector('[data-do="no"]').onclick = () => { clearTimeout(gone); el.remove(); };
}

const stepOf = (max) => (max <= 300000 ? 5000 : 60000);
const human = ms => (ms < 60000 ? `${Math.round(ms / 1000)} s` : ms % 60000 ? mmss(ms) : `${ms / 60000} min`);

export function showChalkboard({ mode = 'live' } = {}) {
  document.body.dataset.view = 'landing';
  const D = net.welcome?.defaults || {};
  const d = D[mode] || D.settings || { gracePeriodMs: 300000, maxWorkMs: 1500000 };
  // Short timings (the Demo kitchen, or a server started with LIVE_TIMINGS=short) use seconds; real timings use minutes.
  const short = mode === 'demo' || d.maxWorkMs <= 300000;
  const rg = d.ranges?.gracePeriodMs || (short ? [0, 60000] : [0, 900000]), rm = d.ranges?.maxWorkMs || (short ? [30000, 300000] : [600000, 3600000]);
  const R = { g: [rg[0], rg[1], d.gracePeriodMs ?? (short ? 10000 : 300000)], m: [rm[0], rm[1], d.maxWorkMs ?? (short ? 90000 : 1500000)] };
  const judge = net.role === 'judge';
  const what = mode === 'demo' ? 'DEMO · pre-cooked results, no API cost' : `LIVE · ${judge ? 'Sonnet 5.5' : 'Haiku 5.5'} · real Claude chefs`;
  const el = open('sh-chalk', `
    <form class="sh-board" novalidate>
      <h2>Kitchen setup</h2>
      <label class="row"><span>Restaurant name</span>
        <span class="nm"><input id="cbName" maxlength="24" autocomplete="off" spellcheck="false" value="${esc(randomName())}"><button type="button" class="dice" id="cbDice" title="Another name" aria-label="Another name">↻</button></span></label>
      <label class="row"><span>Grace period <b id="cbGraceV"></b></span>
        <input type="range" id="cbGrace" min="${R.g[0]}" max="${R.g[1]}" step="${stepOf(R.g[1])}" value="${R.g[2]}">
        <small>No call-back reaches you this soon after a break starts.</small></label>
      <label class="row"><span>Maximum work time <b id="cbWorkV"></b></span>
        <input type="range" id="cbWork" min="${R.m[0]}" max="${R.m[1]}" step="${stepOf(R.m[1])}" value="${R.m[2]}">
        <small>After this long without a break, the kitchen makes you take one.</small></label>
      <p class="mode ${mode}"><i></i>${esc(what)}</p>
      <div class="sh-stack">
        <button type="submit" class="sh-btn big" id="cbGo">Open the kitchen</button>
        <button type="button" class="sh-btn ghost" id="cbBack">Back</button>
      </div>
    </form>`);
  const q = id => el.querySelector(`#${id}`);
  const show = () => { q('cbGraceV').textContent = human(Number(q('cbGrace').value)); q('cbWorkV').textContent = human(Number(q('cbWork').value)); };
  q('cbGrace').oninput = show; q('cbWork').oninput = show; show();
  q('cbDice').onclick = () => { q('cbName').value = randomName(); };
  q('cbBack').onclick = () => showLanding();
  el.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    q('cbGo').disabled = true; q('cbGo').textContent = 'Opening…';
    const name = q('cbName').value.trim().slice(0, 24) || randomName();
    const res = await request('createFloor', { name, mode, settings: { gracePeriodMs: Number(q('cbGrace').value), maxWorkMs: Number(q('cbWork').value) } });
    if (res.type === 'error') {
      if (res.code === 'no_slot') { showBusy(res.options || ['demo', 'visit', 'queue']); return; }
      toast(res.message || 'Could not open a kitchen. Try again.', 'bad');
      if (res.code === 'full') { clear(); go.overview(); return; }
      q('cbGo').disabled = false; q('cbGo').textContent = 'Open the kitchen'; return;
    }
    if (!res.floorId) { toast('The kitchen did not open. Try again.', 'bad'); q('cbGo').disabled = false; q('cbGo').textContent = 'Open the kitchen'; return; }
    leaveQueue(); clear(); go.home({ fresh: true });
  };
}
