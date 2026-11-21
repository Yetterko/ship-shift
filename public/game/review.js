// Sample the Meal: the right-docked review panel at the Pass. The Chef's summary leads and is enough to decide on;
// the code is folded under "Review the code" for anyone who wants to read it hunk by hunk (J/K opens it and steps).
// Serve is open from the start; Send back takes a reason. Either one closes the panel.
import { esc, toast, emit } from './core.js';
import { F, stationDef, customerOfOrder } from './floor.js';
import { actBtn, doAct, viewOnly, panelState, panelKey, openPanel, closePanel, wireActs } from './panels.js';
import { textStep, wireTextStep } from './quickpicks.js';
import { LIMITS } from '/shared/protocol.js';

const sampled = new Set();      // meals this client has already asked the server to mark sampled

export function mealSig(S, id) {
  const m = S.meals[id], it = m && S.items[m.itemId];
  return m ? `${id}|${m.hunksSeen}|${it?.status}|${S.pass.join(',')}|${F.you.canAct}` : 'gone';
}

/** The panel for one Meal. st: per-panel state kept across redraws: { cur, seen, code, noteOpen, redo, reason, note } */
export function renderMeal(el, S, id) {
  const m = S.meals[id], st = panelState();
  if (!m) { el.innerHTML = `<div class="fl-head"><h2>Served</h2></div><p>This Meal has left the Pass.</p>`; return; }
  const item = S.items[m.itemId] || {}, def = stationDef(item.station), cu = customerOfOrder(m.orderId);
  const chef = S.chefs.find(c => c.id === item.chefId) || null;
  const who = (cu?.name || 'the reviewer').split(' ')[0];
  st.cur ??= 0; st.seen = Math.max(st.seen || 0, m.hunksSeen || 0);
  const total = m.hunks.length, seen = Math.min(st.seen, total);
  const lines = m.hunks.flatMap(h => h.lines), adds = lines.filter(l => l.t === '+').length, dels = lines.filter(l => l.t === '-').length;
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
      ${total ? `<details class="fl-code" data-code${st.code ? ' open' : ''}>
        <summary><b>Review the code</b><small>optional · ${total} hunk${total > 1 ? 's' : ''} · <span class="add">+${adds}</span> <span class="del">−${dels}</span></small></summary>
        <div class="fl-codebody">
          ${m.real ? '' : '<p class="fl-note">On your phone, Chefs write their answer as text, shown here as added lines. Our stage kitchen is wired to a real repo.</p>'}
          <div class="fl-row"><span class="fl-seen${seen >= total ? ' all' : ''}" data-seen>${seen} of ${total} seen</span>
            <span class="fl-hints"><kbd>J</kbd> next <kbd>K</kbd> back</span>
            <button type="button" class="fl-btn ghost sm" data-step="-1" aria-label="Previous hunk">‹</button><button type="button" class="fl-btn ghost sm" data-step="1" aria-label="Next hunk">›</button></div>
          <div class="fl-hunks">${hunks}</div>
        </div>
      </details>` : ''}
    </div>
    <div class="fl-foot">
      ${F.you.canAct ? (item.status === 'approved' ? `<div class="fl-row"><span class="fl-ok">Reviewed. It goes to ${esc(who)} with the rest of the ticket.</span></div>` : st.redo ? `
        <div class="fl-redo"><b>Send back: why?</b>${textStep(redoChips, st.reason, { keep: 'reason', placeholder: 'Tell the Chef what to fix', max: LIMITS.reason, name: 'why' })}
        <div class="fl-row">${actBtn('Send back for a Redo', 'redoMeal', { mealId: id }, 'bad', null, 'sendBack')}<button type="button" class="fl-btn ghost" data-cancel-redo>Cancel</button></div></div>` : `
        <details class="fl-servenote" data-notebox${st.noteOpen || st.note ? ' open' : ''}><summary><b>Add a note for the reviewer</b><small>optional</small></summary>
          <div class="fl-notebody">${textStep(S.chips?.serve || [], st.note, { keep: 'note', placeholder: 'What should the reviewer check?', max: LIMITS.note, name: 'note' })}</div></details>
        <div class="fl-row fl-decide">${actBtn('Send back', null, null, 'bad', null, 'openRedo')}${actBtn(`Serve to ${esc(who)}`, 'serveMeal', { mealId: id }, 'ok', null, 'approve')}</div>`) : viewOnly()}
      ${others.length ? `<div class="fl-others"><small>Also on the Pass:</small>${others.map(o => { const om = S.meals[o], oi = om && S.items[om.itemId]; return `<button type="button" class="fl-btn ghost sm" data-goto-panel="meal:${o}">${esc(stationDef(oi?.station).name)}${oi?.status === 'approved' ? ' ✓' : ''}</button>`; }).join('')}</div>` : ''}
    </div>`;
  // a Meal that is opened is a Meal being sampled
  if (F.you.canAct && item.status === 'ready' && !sampled.has(id)) {
    sampled.add(id);
    doAct('sampleMeal', { mealId: id }).then(r => { if (r.ok) markSeen(id, 0); });
  } else if (F.you.canAct && item.status !== 'approved' && st.seen < 1 && total) markSeen(id, 0);
  // the folds remember whether they are open across redraws; opening the code counts the hunk you land on as seen
  const code = el.querySelector('[data-code]');
  if (code) code.ontoggle = () => { st.code = code.open; if (code.open && code.isConnected) markSeen(id, st.cur); };
  const note = el.querySelector('[data-notebox]');
  if (note) note.ontoggle = () => { st.noteOpen = note.open; };
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
  if (st.code) el.querySelector('.fl-hunk.cur')?.scrollIntoView?.({ block: 'nearest' });
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
  if (!m?.hunks.length) return;
  st.code = true;
  st.cur = Math.max(0, Math.min(m.hunks.length - 1, i));
  markSeen(id, st.cur);
  openPanel(`meal:${id}`, { keepState: true, force: true });
}
const currentMeal = () => { const k = panelState().__key || ''; return k.startsWith('meal:') ? k.slice(5) : null; };
/** J and K: the first press unfolds the code on the hunk you were on, the next ones step. */
const stepOrOpen = d => { const st = panelState(); go((st.cur ?? 0) + (st.code ? d : 0)); };
export const nextHunk = () => stepOrOpen(1);
export const prevHunk = () => stepOrOpen(-1);
function step(d) { go((panelState().cur ?? 0) + d); }

/** Closes the review once it is decided, unless the player has already moved on to another panel. */
const closeIfOn = id => { if (panelKey() === `meal:${id}`) closePanel(); };

export async function sendBack(id, reason) {
  const text = String(reason || '').trim();
  const r = await doAct('redoMeal', { mealId: id, reason: text.slice(0, LIMITS.reason) });
  if (r.ok) {
    panelState(`meal:${id}`).redo = false; panelState(`meal:${id}`).reason = '';
    emit('sfx', 'back'); toast('Sent back. The Chef is on the Redo.', '');
    closeIfOn(id);
  }
  return r;
}
/** Review done: approve the Meal and send it to its reviewer (it waits for the rest of its ticket if any is cooking). */
export async function approve(id) {
  const st = panelState(`meal:${id}`), S = F.snap, m = S?.meals[id], item = m && S.items[m.itemId];
  const cu = m && customerOfOrder(m.orderId), who = (cu?.name || 'the reviewer').split(' ')[0];
  // the same test the server makes: the ticket goes out with this Meal unless the rest of it is still in the kitchen
  const waits = !!item && (!['seated', 'waiting_food', 'awaiting_player'].includes(cu?.status) || Object.values(S.items)
    .some(i => i.id !== item.id && i.customerId === item.customerId && ['queued', 'cooking', 'ready', 'sampled'].includes(i.status)));
  const r = await doAct('serveMeal', { mealId: id, note: String(st.note || '').trim().slice(0, LIMITS.note) });
  if (r.ok) {
    st.note = ''; st.noteOpen = false;
    emit('sfx', 'approve');
    toast(waits ? `Approved. It goes to ${who} with the rest of the ticket.` : `Served! ${who} is tasting.`, '');
    closeIfOn(id);
  }
  return r;
}
/** Opens a Meal's review. */
export const openMeal = meal => openPanel(`meal:${meal.id || meal}`);
