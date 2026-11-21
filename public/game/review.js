// Sample the Meal: the right-docked review panel at the Pass. The Chef's summary, then the code hunk by hunk (J/K),
// with a "hunks seen" counter. Approve stays shut until every hunk has been seen; Send back takes a reason.
import { esc } from './core.js';
import { F, stationDef, customerOfOrder } from './floor.js';
import { actBtn, doAct, viewOnly, panelState, openPanel, wireActs } from './panels.js';
import { textStep, wireTextStep } from './quickpicks.js';
import { LIMITS } from '/shared/protocol.js';

const sampled = new Set();      // meals this client has already asked the server to mark sampled

export function mealSig(S, id) {
  const m = S.meals[id], it = m && S.items[m.itemId];
  return m ? `${id}|${m.hunksSeen}|${it?.status}|${S.pass.join(',')}|${F.you.canAct}` : 'gone';
}

/** The panel for one Meal. st: per-panel state kept across redraws: { cur, seen, redo, reason } */
export function renderMeal(el, S, id) {
  const m = S.meals[id], st = panelState();
  if (!m) { el.innerHTML = `<div class="fl-head"><h2>Served</h2></div><p>This Meal has left the Pass.</p>`; return; }
  const item = S.items[m.itemId] || {}, def = stationDef(item.station), cu = customerOfOrder(m.orderId);
  const chef = S.chefs.find(c => c.id === item.chefId) || null;
  const who = (cu?.name || 'the reviewer').split(' ')[0];
  st.cur ??= 0; st.seen = Math.max(st.seen || 0, m.hunksSeen || 0);
  const total = m.hunks.length, all = st.seen >= total;
  const others = S.pass.filter(x => x !== id);
  const hunks = m.hunks.map((h, i) => `
    <section class="fl-hunk${i < st.seen ? ' seen' : ''}${i === st.cur ? ' cur' : ''}" data-hunk="${i}">
      <header><b>${esc(h.file || m.changedFiles[0] || '')}</b><span>${esc(h.header)}</span>${i < st.seen ? '<i>seen</i>' : ''}</header>
      <pre>${h.lines.map(l => `<span class="ln ${l.t === '+' ? 'add' : l.t === '-' ? 'del' : ''}">${esc(l.t)} ${esc(l.text)}</span>`).join('')}</pre>
    </section>`).join('');
  const status = item.status === 'approved' ? '<span class="fl-tag ok">Approved</span>' : item.status === 'sampled' ? '<span class="fl-tag">Sampling</span>' : '<span class="fl-tag new">New on the Pass</span>';
  const redoChips = S.chips?.redo || [];
  el.innerHTML = `
    <div class="fl-head">
      <small>Order #${esc(cu?.order.number ?? '?')} · ${esc(cu?.name ?? '')}${cu?.table != null ? ` · Table ${cu.table + 1}` : ''}</small>
      <h2>Sample the Meal</h2>
      <div class="fl-meta"><span class="fl-st on st-${esc(item.station)}">${esc(def.name)}</span>${status}${m.setMenu ? '<span class="fl-tag warn" title="A typed Item in the Demo kitchen gets the closest pre-cooked Meal">set menu</span>' : ''}${m.ranOut ? '<span class="fl-tag warn">ran out of time</span>' : ''}${item.redoCount ? `<span class="fl-tag bad">redo ${item.redoCount}</span>` : ''}</div>
    </div>
    <div class="fl-body">
      <p class="fl-prompt"><b>Ticket</b> ${esc(item.prompt || '')}</p>
      <div class="fl-summary"><b>${esc(chef?.name ? `Chef ${chef.name}` : 'The Chef')} says</b><p>${esc(m.summary)}</p><small>Changed: ${m.changedFiles.map(esc).join(', ')}</small></div>
      ${m.real ? '' : '<p class="fl-note">On your phone, Chefs write their answer as text, shown here as added lines. Our stage kitchen is wired to a real repo.</p>'}
      <div class="fl-hunks">${hunks}</div>
    </div>
    <div class="fl-foot">
      <div class="fl-row"><span class="fl-seen${all ? ' all' : ''}" data-seen>${Math.min(st.seen, total)} of ${total} seen</span>
        <span class="fl-hints"><kbd>J</kbd> next <kbd>K</kbd> back</span>
        <button type="button" class="fl-btn ghost sm" data-step="-1" aria-label="Previous hunk">‹</button><button type="button" class="fl-btn ghost sm" data-step="1" aria-label="Next hunk">›</button></div>
      ${F.you.canAct ? (item.status === 'approved' ? `<div class="fl-row"><span class="fl-ok">Reviewed. It goes to ${esc(who)} with the rest of the ticket.</span></div>` : st.redo ? `
        <div class="fl-redo"><b>Send back: why?</b>${textStep(redoChips, st.reason, { keep: 'reason', placeholder: 'Tell the Chef what to fix', max: LIMITS.reason, name: 'why' })}
        <div class="fl-row">${actBtn('Send back for a Redo', 'redoMeal', { mealId: id }, 'bad', null, 'sendBack')}<button type="button" class="fl-btn ghost" data-cancel-redo>Cancel</button></div></div>` : `
        ${all ? `<div class="fl-servenote"><b>Note for the reviewer</b> <small>(optional)</small>${textStep(S.chips?.serve || [], st.note, { keep: 'note', placeholder: 'What should the reviewer check?', max: LIMITS.note, name: 'note' })}</div>` : ''}
        <div class="fl-row fl-decide">${actBtn('Send back', null, null, 'bad', null, 'openRedo')}${actBtn(all ? `Serve to ${esc(who)}` : `Read ${total - Math.min(st.seen, total)} more to serve`, 'serveMeal', { mealId: id }, 'ok', null, 'approve', !all)}</div>`) : viewOnly()}
      ${others.length ? `<div class="fl-others"><small>Also on the Pass:</small>${others.map(o => { const om = S.meals[o], oi = om && S.items[om.itemId]; return `<button type="button" class="fl-btn ghost sm" data-goto-panel="meal:${o}">${esc(stationDef(oi?.station).name)}${oi?.status === 'approved' ? ' ✓' : ''}</button>`; }).join('')}</div>` : ''}
    </div>`;
  // a Meal that is opened is a Meal being sampled
  if (F.you.canAct && item.status === 'ready' && !sampled.has(id)) {
    sampled.add(id);
    doAct('sampleMeal', { mealId: id }).then(r => { if (r.ok) markSeen(id, 0); });
  } else if (F.you.canAct && item.status !== 'approved' && st.seen < 1 && total) markSeen(id, 0);
  el.querySelectorAll('[data-step]').forEach(b => b.onclick = () => step(+b.dataset.step));
  el.querySelectorAll('[data-hunk]').forEach(s => s.onclick = () => go(+s.dataset.hunk));
  el.querySelectorAll('[data-goto-panel]').forEach(b => b.onclick = () => openPanel(b.dataset.gotoPanel));
  const cancel = el.querySelector('[data-cancel-redo]'); if (cancel) cancel.onclick = () => { st.redo = false; openPanel(`meal:${id}`, { keepState: true, force: true }); };
  wireTextStep(el, redoChips, st, 'reason', 'why');
  wireTextStep(el, S.chips?.serve || [], st, 'note', 'note');
  wireActs(el, {
    openRedo: () => { st.redo = true; openPanel(`meal:${id}`, { keepState: true, force: true }); },
    sendBack: async () => sendBack(id, st.reason),
    approve: async () => approve(id),
  });
  el.querySelector('.fl-hunk.cur')?.scrollIntoView?.({ block: 'nearest' });
}

function markSeen(id, index) {
  const st = panelState(), m = F.snap?.meals[id]; if (!m) return;
  const grew = index + 1 > (st.seen || 0);
  if (grew) st.seen = index + 1;
  if (index + 1 > (m.hunksSeen || 0) && F.you.canAct) doAct('seeHunk', { mealId: id, index }, { quiet: true });
  if (grew && st.__key === `meal:${id}`) queueMicrotask(() => openPanel(`meal:${id}`, { keepState: true, force: true }));
}
function go(i) {
  const id = currentMeal(); if (!id) return;
  const m = F.snap.meals[id], st = panelState();
  st.cur = Math.max(0, Math.min(m.hunks.length - 1, i));
  markSeen(id, st.cur);
  openPanel(`meal:${id}`, { keepState: true, force: true });
}
const currentMeal = () => { const k = panelState().__key || ''; return k.startsWith('meal:') ? k.slice(5) : null; };
export const nextHunk = () => go((panelState().cur ?? 0) + 1);
export const prevHunk = () => go((panelState().cur ?? 0) - 1);
function step(d) { go((panelState().cur ?? 0) + d); }

export async function sendBack(id, reason) {
  const text = String(reason || '').trim();
  const r = await doAct('redoMeal', { mealId: id, reason: text.slice(0, LIMITS.reason) });
  if (r.ok) { panelState().redo = false; panelState().reason = ''; }
  return r;
}
/** Review done: approve the Meal and send it to its reviewer (it waits for the rest of its ticket if any is cooking). */
export async function approve(id) {
  const st = panelState();
  const r = await doAct('serveMeal', { mealId: id, note: String(st.note || '').trim().slice(0, LIMITS.note) });
  if (r.ok) st.note = '';
  return r;
}
/** Opens a Meal's review. */
export const openMeal = meal => openPanel(`meal:${meal.id || meal}`);
