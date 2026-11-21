// Everything that explains the kitchen: the start screen, the first-ticket walkthrough, the help sheet (?), presenter mode (P),
// the frame-rate readout (`), and what "play again" does. None of it stops the kitchen.
import { $, G, on, emit, api, toast, store, arcade, ICON, atHome } from './core.js';
import { town } from './net.js';
const touchy = () => document.body.classList.contains('touch');
import { V, label, setCalm, quality, drawCalls, isSide } from './scene.js';
import { player, chefStations, passStations, hatchSt, stationById, slotOf, passSlotOf, beacon, beaconRing, local, doorSt } from './world.js';
import { ui, banner } from './panels.js';
import { state as input } from './input.js';

/* ======================= start screen ======================= */
const title = $('title');
const MODE_LINE = {
  sim: 'The chefs in this demo are simulated. In real mode each one is a real Claude agent, working in its own git worktree.',
  mixed: 'Some of these chefs are real Claude agents and the rest are simulated. Only the real ones cost money.',
  claude: 'Each chef is a real Claude agent, working in its own git worktree of your repo.',
};
$('titleGuide').checked = store.get('guide') !== 'done';
function titleText() {
  const S = G.S; if (!S) return;
  const line = MODE_LINE[S.driver] || MODE_LINE.claude;
  if ($('titleMode').textContent !== line) { $('titleMode').textContent = line; $('helpMode').textContent = line; }
  const go = S.shift.mode === 'focus' ? 'Back to the kitchen' : 'Open the kitchen';
  if ($('titleGo').textContent !== go) $('titleGo').textContent = go;
}
function openKitchen() {
  if (!title.classList.contains('open')) return;
  title.classList.remove('open');
  emit('sfx', 'start');
  if ($('titleGuide').checked) startGuide(); else store.set('guide', 'done');
  document.activeElement?.blur?.();
}
$('titleStart').onclick = openKitchen;

/* ======================= the walkthrough: your first ticket, from the window to main ======================= */
const KITCHEN_STEPS = [['take', 'Take'], ['give', 'Give'], ['answer', 'Answer'], ['review', 'Review'], ['ship', 'Ship']];
// In a town the one customer you start with never asks anything: the lesson in its place is the door. Questions come later,
// with the customers you bring home, and the walkthrough still points at the first one if it is on.
const TOWN_STEPS = [['take', 'Take'], ['give', 'Give'], ['out', 'Outside'], ['review', 'Review'], ['ship', 'Ship']];
const steps = () => (town.on ? TOWN_STEPS : KITCHEN_STEPS);
export const guide = { on: false, done: {}, step: null, target: null, line: '' };
let questSig = '';
function startGuide() { guide.on = true; guide.done = {}; guide.step = null; questSig = ''; }
const relayout = () => setTimeout(() => emit('layout'), 0);   // the steps take a row of their own on a phone
function endGuide(finished) {
  if (!guide.on) return;
  guide.on = false; ui.guideAnswer = false; guide.step = null; guide.target = null; guide.line = ''; input.guide = null;
  store.set('guide', 'done'); $('titleGuide').checked = false;
  beacon.visible = beaconRing.visible = false; $('rGuide').hidden = true;
  if (finished) { guide.done = Object.fromEntries(steps().map(([k]) => [k, true])); renderQuest(); $('quest').classList.add('finished'); setTimeout(() => { $('quest').hidden = true; $('quest').classList.remove('finished'); }, 3200); banner('You know the line', 'Now keep all four chefs cooking', 'go'); emit('sfx', 'star'); }
  else { $('quest').hidden = true; toast(touchy() ? 'Walkthrough skipped. The menu has help' : 'Walkthrough skipped. Press ? any time for help'); }
  setTimeout(relayout, finished ? 3300 : 0);
  $('stage').classList.remove('guided');
}
$('questSkip').onclick = () => endGuide(false);
function mark(step) {
  if (!guide.on || guide.done[step]) return;
  guide.done[step] = true; emit('sfx', 'yes');
  if (steps().every(([k]) => guide.done[k])) endGuide(true);
}
on('zone', mode => { if (mode === 'park') mark('out'); });
/** Called with every new server state: lessons are ticked off by what really happened, not by which key was pressed. */
export function guideApply(prev, next) {
  titleText();
  if (!prev || !guide.on) return;
  const was = id => prev.orders.find(o => o.id === id);
  for (const o of next.orders) {
    const p = was(o.id); if (!p) continue;
    if (p.state === 'waiting' && o.chefId && o.state !== 'waiting' && o.state !== 'planning') { mark('take'); mark('give'); }
    if (!p.approved && o.approved) mark('review');
    if (p.state !== 'shipped' && o.state === 'shipped') { mark('review'); mark('ship'); }
  }
  // answered by you: a question that is gone while its order is still on the line
  for (const q of prev.questions) if (!next.questions.some(x => x.id === q.id) && !['binned'].includes(next.orders.find(o => o.id === q.orderId)?.state)) mark('answer');
}

function renderQuest() {
  if ($('quest').hidden) { $('quest').hidden = false; relayout(); }
  $('questSteps').innerHTML = steps().map(([k, name], i) => `<li class="${guide.done[k] ? 'done' : guide.step === k ? 'cur' : ''}"><span>${guide.done[k] ? ICON.tick : i + 1}</span><b>${name}</b></li>`).join('');
}
const chefOf = id => chefStations.find(s => s.chefId === id);
const chefName = id => G.S.chefs.find(c => c.id === id)?.name || 'A chef';
const dist = st => Math.hypot(st.ring.x - player.g.position.x, st.ring.z - player.g.position.z);
/** Works out the one thing worth pointing at right now. Returns { step, st, far, near, sub } or a passive { hint } with no arrow. */
function nextMove(S) {
  const d = guide.done, c = player.carry, first = !d.ship;
  const q = [...S.questions].sort((a, b) => a.createdAt - b.createdAt)[0];
  if (q && !d.answer) {
    const kind = q.kind === 'question';
    return { step: 'answer', st: chefOf(q.chefId), far: `${chefName(q.chefId)} is stuck and waiting on you`, sub: 'Walk over and answer', near: kind ? 'Pick an answer' : 'Allow it, or say no', key: kind ? '1' : '1', nearSub: 'The agent is paused until you do' };
  }
  // the door: once a ticket is cooking there is nothing to do in here but wait, and the rest of the backlog is outside
  const outside = town.on && !d.out && !c && !ui.review ? { step: 'out', st: doorSt, far: d.give ? 'Step outside while they cook' : 'Step outside', sub: 'The park is your team\'s backlog', near: 'Step outside', key: 'E' } : null;
  if (!first) return outside;                  // after the first ship, only the lesson that has not come up yet is left
  const atPass = S.orders.filter(o => o.state === 'at_pass' && passSlotOf.has(o.id)).sort((a, b) => (a.atPassAt || 0) - (b.atPassAt || 0));
  if (c?.type === 'plate') return { step: 'ship', st: hatchSt, far: 'Carry it to the hatch', sub: 'Shipping is a real git merge into main', near: 'Ship it', key: 'E' };
  if (ui.review) return { step: 'review', st: null };
  const approved = atPass.find(o => o.approved);
  if (!c && approved) return { step: 'ship', st: passStations[passSlotOf.get(approved.id)], far: 'Approved. Pick up the plate', sub: 'Then carry it to the hatch', near: 'Pick up the plate', key: 'E' };
  const ready = atPass.find(o => !o.approved);
  if (!c && ready) return { step: 'review', st: passStations[passSlotOf.get(ready.id)], far: 'A plate is ready. Review it at the pass', sub: ready.tests?.ok === false ? 'Its tests failed in the oven' : 'It passed its tests in the oven', near: 'Open the review', key: 'E' };
  if (c?.type === 'ticket') {
    const free = chefStations.filter(s => !S.chefs.find(ch => ch.id === s.chefId)?.orderId).sort((a, b) => dist(a) - dist(b))[0];
    if (!free) return { step: 'give', st: null };
    return { step: 'give', st: free, far: 'Give it to a free chef', sub: 'Each chef is a Claude agent', near: `Give it to ${chefName(free.chefId)}`, key: 'E' };
  }
  const waiting = S.orders.filter(o => o.state === 'waiting' && slotOf.has(o.id) && local.board !== o.id).sort((a, b) => a.id - b.id)[0];
  if (!c && waiting && S.chefs.some(ch => !ch.orderId)) {
    return { step: 'take', st: stationById(`slot${slotOf.get(waiting.id)}`), far: d.give ? 'Take the next ticket while they cook' : 'Take a ticket from the window', sub: d.give ? 'Your agents work in parallel' : 'Each ticket is a coding task', near: 'Take the ticket', key: 'E' };
  }
  if (outside && d.give) return outside;
  // nothing to do but watch: say what is happening, without an arrow
  const testing = S.orders.find(o => o.state === 'testing');
  if (testing) return { step: null, hint: stationById('oven'), far: 'The oven is running the tests', sub: 'Then the plate goes to the pass' };
  const cooking = S.orders.find(o => o.state === 'cooking' && !S.questions.some(x => x.orderId === o.id));
  if (cooking) return { step: null, hint: chefOf(cooking.chefId), far: `${chefName(cooking.chefId)} is writing the code`, sub: 'The plate comes to the pass on its own' };
  if (town.on && !c) return { step: null, hint: doorSt, far: 'More customers wait in the park', sub: 'Step outside and bring one home' };
  return null;
}

const at = V();
export function guideFrame(t, near) {
  const S = G.S; if (!S) return;
  roundStart(S);
  perfFrame();
  // the walkthrough is about your own kitchen: it waits while you are in the park or in somebody else's
  if (!guide.on || title.classList.contains('open') || !atHome()) { beacon.visible = beaconRing.visible = false; input.guide = null; return; }
  if (player.carry?.type === 'ticket') mark('take');
  if (!guide.on) return;
  const m = nextMove(S);
  guide.step = m?.step || null; guide.target = m?.st?.id || null; guide.line = m ? (near === m.st && m.near ? m.near : m.far) || '' : '';
  $('stage').classList.add('guided');

  const st = m?.st || null, here = !!st && near === st;
  input.guide = st && !here ? st : null;
  beacon.visible = !!st && !here; beaconRing.visible = !!st;
  if (st) {
    const bob = Math.abs(Math.sin(t * 4.2)) * 0.32;
    beacon.position.set(st.ring.x, 1.0 + bob, st.ring.z); beacon.rotation.y = t * 2.2;
    beaconRing.position.set(st.ring.x, 0.027, st.ring.z); beaconRing.rotation.z = -t * 1.4; beaconRing.scale.setScalar(1 + Math.sin(t * 5) * 0.09);
    beaconRing.material.opacity = here ? 0.5 : 1;
  }
  // one line, hung just below the spot to stand on
  const where = st || m?.hint;
  const small = document.body.classList.contains('narrow');   // a phone has no room for remarks: only the arrow's own line
  if (where && guide.line && !(m.step === 'answer' && here) && (st || !small)) {
    const html = here ? `<div class="gd near"><kbd>${touchy() ? 'USE' : m.key}</kbd><b>${m.near}</b></div>` : `<div class="gd ${st ? '' : 'soft'}"><b>${m.far}</b>${m.sub ? `<i>${m.sub}</i>` : ''}</div>`;
    // "below the spot" depends on the camera: from the street end, down the screen is towards the window, where there is no room
    // and the door is at the front edge of the room, with only the focus card below it
    const side = isSide(), door = where.type === 'door', above = door || (side && where.ring.x < -2.5), gap = here ? 0.75 : 0.62;
    if (door && !side) at.set(where.ring.x, 2.3, where.ring.z);
    else if (!side) at.set(where.ring.x, 0, where.ring.z + gap); else at.set(where.ring.x + (above ? 1.0 : -gap), above ? 0.4 : 0, where.ring.z);
    label('guide', html.replace('class="gd', `class="gd${above ? ' up' : ''}`), at, { pri: 9, anchor: above ? 'bottom' : 'top', click: st ? st.id : null });
  }
  $('rGuide').hidden = !(ui.review && !guide.done.review);
  ui.guideAnswer = m?.step === 'answer';

  const sig = steps().map(([k]) => (guide.done[k] ? 'd' : guide.step === k ? 'c' : '-')).join('');
  if (sig !== questSig) { questSig = sig; renderQuest(); }
}

/* ======================= the round: in the demo the clock starts with your first ticket ======================= */
let roundAsked = false, hadTicket = false;
function roundStart(S) {
  const has = player.carry?.type === 'ticket';
  if (S.shift.mode !== 'off') roundAsked = false;
  else if (arcade() && has && !hadTicket && !roundAsked) {
    roundAsked = true;
    api('/api/shift/start', { focusMin: S.shift.focusMin, breakMin: S.shift.breakMin }).then(() => {
      banner('Service!', `${S.shift.focusMin} minutes on the clock. Ship what you can`, 'go'); emit('sfx', 'start');
    }, () => { roundAsked = false; });
  }
  hadTicket = has;
}

// "Play again". A server that can hand out a fresh kitchen says so in its state (restart: '/api/…'); otherwise the same
// kitchen gets new customers and the next ticket you take starts a new clock.
const ENCORE = [
  { title: 'Add a health check', body: 'Add a function that reports ok and the version, with a test.', size: 'S' },
  { title: 'Validate the public inputs', body: 'Reject bad arguments with a clear error. Tests required.', size: 'M' },
  { title: 'Tidy the README', body: 'Say how to run the tests and what each module does.', size: 'S' },
  { title: 'Log slow operations', body: 'Time the main entry points and log anything slower than 200 ms. Tests required.', size: 'M' },
  { title: 'Remove dead code', body: 'Delete what nothing calls, and keep the tests green.', size: 'S' },
  { title: 'Cache the expensive lookup', body: 'Memoise the slowest pure function. Prove it with a test.', size: 'L' },
];
let encoreAt = 0;
on('again', async () => {
  const S = G.own || G.S; if (!S) return;
  try {
    if (typeof S.restart === 'string') { await api(S.restart); banner('Fresh kitchen', 'Take a ticket to start the clock', 'go'); return; }
    if (S.shift.mode !== 'off') await api('/api/shift/stop');
    const waiting = S.orders.filter(o => o.state === 'waiting').length;
    for (let i = waiting; i < 3; i++) await api('/api/orders', ENCORE[encoreAt++ % ENCORE.length]);
    banner('Next service', 'Take a ticket to start the clock', 'go'); emit('sfx', 'start');
  } catch { /* api already toasted */ }
});

/* ======================= help sheet ======================= */
const help = $('help');
const KEYS = [
  ['W A S D', 'Walk. The arrow keys work too'],
  ['Click', 'Click or tap anything: you walk there and use it'],
  ['E', 'Use the station you are standing at'],
  ['Q', 'Put down what you are carrying'],
  ['Shift', 'Dash'],
  ['Tab', 'Walk to whatever needs you most'],
  ['1 – 4', 'Answer a chef. X is "your call", T types an answer'],
  ['F', 'Call out one line to a chef who is cooking'],
  ['J K', 'In a review: next and previous change. Enter approves, B writes a send-back note'],
  ['L', 'The board: every order at once, with its actions on the card'],
  ['?', 'This sheet'], ['P', 'Presenter mode: big labels, calm camera'], ['M', 'Sound on and off'],
];
const REAL = [
  ['ticket', 'Order window', 'A task waiting to be done. S, M or L is its size; the bar is how long the customer will wait.'],
  ['hat', 'Chef at a stove', 'A Claude agent with its own branch and git worktree. Four chefs work in parallel.'],
  ['q', 'Question bubble', 'The agent is paused on you: it asked a question, or wants to run something outside its safe list. Waiting costs points: smoke first, then fire.'],
  ['pencil', 'Prep board', 'A read-only planning pass. The agent writes a plan before it changes any code, so it asks less later.'],
  ['install', 'Spice jars', 'Permissions granted up front (install, network, delete), so the chef never stops to ask.'],
  ['oven', 'Oven', 'Runs the project\'s tests on the chef\'s branch. The lever re-fires a failing plate once, at no cost.'],
  ['eye', 'The pass', 'Code review: the real diff, the test output and the agent\'s summary. Approve it, or send it back with a note.'],
  ['rocket', 'Hatch', 'A real git merge into main. You choose the order plates go out.'],
  ['snow', 'Cold plate', 'Main moved on and the branch no longer merges. Send it back and the chef merges main.'],
  ['link', 'Red string', 'Two chefs are changing the same files. A thick string means they will conflict.'],
  ['delete', 'Bin', 'Stops the agent and deletes its branch.'],
];
$('helpKeys').innerHTML = KEYS.map(([k, what]) => `<dt>${k.split(' ').map(x => (x === '–' ? '–' : `<kbd>${x}</kbd>`)).join('')}</dt><dd>${what}</dd>`).join('');
$('helpReal').innerHTML = REAL.map(([icon, name, what]) => `<dt><span class="ico">${ICON[icon]}</span>${name}</dt><dd>${what}</dd>`).join('');
function setHelp(open) {
  if (title.classList.contains('open')) return;
  help.classList.toggle('open', open);
  if (open) { emit('sfx', 'open'); $('helpDone').focus(); } else document.activeElement?.blur?.();
}
on('help', () => setHelp(!help.classList.contains('open')));
$('helpBtn').onclick = () => setHelp(true);
$('helpClose').onclick = $('helpDone').onclick = () => setHelp(false);
help.addEventListener('pointerdown', e => { if (e.target === help) setHelp(false); });
$('helpGuide').onclick = () => { setHelp(false); startGuide(); toast('Walkthrough on: follow the gold arrow'); };
$('helpPresent').onclick = () => { setHelp(false); emit('presenter'); };
$('presentBtn').onclick = () => emit('presenter');

// These overlays own the keyboard while they are up. Capture, so the kitchen's own key handler never sees the key that closed one.
addEventListener('keydown', e => {
  if (title.classList.contains('open')) {
    if (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') { e.preventDefault(); e.stopPropagation(); openKitchen(); }
    return;
  }
  if (help.classList.contains('open') && (e.code === 'Escape' || e.key === '?' || e.code === 'KeyH')) { e.preventDefault(); e.stopPropagation(); setHelp(false); }
}, true);

/* ======================= presenter mode ======================= */
export const presenter = { on: false };
function setPresenter(v, quietly = false) {
  presenter.on = v;
  document.body.classList.toggle('presenter', v);
  setCalm(v, v ? 78 : 58);
  if (v) $('perf').hidden = true;
  $('helpPresent').textContent = v ? 'Leave presenter mode' : 'Presenter mode';
  if (!quietly) toast(v ? 'Presenter mode: big labels, calm camera. P leaves it' : 'Presenter mode off');
}
on('presenter', () => setPresenter(!presenter.on));
if (new URLSearchParams(location.search).has('present')) setPresenter(true, true);

/* ======================= frame-rate readout, for checking a laptop before a demo ======================= */
on('debug', () => { if (!presenter.on) $('perf').hidden = !$('perf').hidden; });
let perfT = 0;
function perfFrame() {
  if ($('perf').hidden || performance.now() - perfT < 500) return;
  perfT = performance.now();
  $('perf').textContent = `${quality.fps} fps · ${drawCalls()} draws · pixel ratio ${quality.pr}${quality.level ? ` · saving power (${quality.level})` : ''}`;
}
