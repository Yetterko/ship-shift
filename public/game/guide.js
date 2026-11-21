// The walkthrough: a five-step bar (SEAT · SPLIT · REVIEW · SERVE · SHIP) that lights each step as the player does it,
// with a pointer over the thing to tap next and a Skip button (spec 6.1 step 6). Presenter mode (P): big labels, calm camera.
import { esc, store, emit } from './core.js';
import { setCalm } from './scene.js';
import { F } from './floor.js';

const STEPS = [
  { id: 'seat', name: 'SEAT', tip: 'Tap a Customer in the line, then Seat them.' },
  { id: 'split', name: 'SPLIT', tip: 'At the table, add Items with quick picks and send them to the kitchen.' },
  { id: 'review', name: 'REVIEW', tip: 'A Meal is on the Pass. Sample it: read every hunk, then Approve.' },
  { id: 'serve', name: 'SERVE', tip: 'Take the approved Meals to the table and Serve them.' },
  { id: 'ship', name: 'SHIP', tip: 'Read the Feedback, then Bring the bill to ship it.' },
];
const Gd = { el: null, skipped: store.get('guideSkipped') === '1', step: null, presenter: false };
export const guide = Gd;

export function initGuide(ui) {
  const el = document.createElement('nav');
  el.className = 'fl-guide'; el.id = 'flGuide'; el.setAttribute('aria-label', 'Walkthrough');
  el.innerHTML = `<ol>${STEPS.map((s, i) => `<li data-step="${s.id}"><span>${i + 1}</span><b>${s.name}</b></li>`).join('')}</ol><button type="button" class="fl-tip" title="Show me"></button><button type="button" class="fl-skip">Skip</button>`;
  el.querySelector('.fl-tip').onclick = () => { if (F.guideTarget) emit('tapTarget', F.guideTarget); };
  el.querySelector('.fl-skip').onclick = () => { Gd.skipped = true; store.set('guideSkipped', '1'); el.hidden = true; F.guideTarget = null; };
  ui.append(el); Gd.el = el; Gd.step = null; Gd.doneAt = 0;
}
export function disposeGuide() { Gd.el?.remove(); Gd.el = null; F.guideTarget = null; }

/** Lights the steps from the snapshot's guide flags and points at the next thing to tap. */
export function guideApply(S) {
  if (!Gd.el || !S) return;
  const show = F.you.canAct && !Gd.skipped && S.shift.status === 'running';
  Gd.el.hidden = !show;
  if (!show) { F.guideTarget = null; return; }
  const cur = STEPS.find(s => !S.guide[s.id]);
  for (const li of Gd.el.querySelectorAll('li')) { li.classList.toggle('done', !!S.guide[li.dataset.step]); li.classList.toggle('cur', li.dataset.step === cur?.id); }
  if (!cur) { if (!Gd.doneAt) { Gd.doneAt = Date.now(); setTimeout(() => { if (Gd.el) Gd.el.hidden = true; }, 5000); } Gd.el.hidden = Date.now() - Gd.doneAt > 5000; Gd.el.classList.add('done'); Gd.el.querySelector('.fl-tip').textContent = 'First Order shipped. You run the pass now.'; F.guideTarget = null; Gd.step = 'done'; return; }
  Gd.step = cur.id; Gd.el.classList.remove('done');
  const waiting = cur.id === 'review' && !S.pass.length;
  Gd.el.querySelector('.fl-tip').textContent = waiting ? 'The Chefs are cooking. Their Meals come to the Pass; both busy means you may take a break.' : cur.tip;
  F.guideTarget = targetFor(cur.id, S);
}
function targetFor(step, S) {
  const tables = S.tables.map((c, i) => [c, i]).filter(([c]) => c);
  if (step === 'seat') return S.line[0] ? `customer:${S.line[0].id}` : null;
  if (step === 'split') { const t = tables.find(([c]) => c.status === 'seated'); return t ? `table:${t[1]}` : null; }
  if (step === 'review') { const m = S.pass.find(id => S.items[S.meals[id]?.itemId]?.status !== 'approved'); return m ? `meal:${m}` : 'pass'; }
  if (step === 'serve') { const t = tables.find(([c]) => c.order.itemIds.some(i => S.items[i]?.status === 'approved')); return t ? `table:${t[1]}` : 'pass'; }
  if (step === 'ship') { const t = tables.find(([c]) => c.status === 'awaiting_player' || c.status === 'eating'); return t ? `table:${t[1]}` : null; }
  return null;
}

/** Presenter mode: bigger labels and HUD, a camera that keeps still. */
export function presenter(on = !Gd.presenter) {
  Gd.presenter = on;
  document.body.classList.toggle('presenter', on);
  setCalm(on, on ? 84 : 58);
  emit('layout');
}
export const STEP_NAMES = STEPS.map(s => esc(s.name));
