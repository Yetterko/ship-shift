// The HTML panels over the 3D floor (FR-9): the order pad, the comment card, the receipt, the rail, the Stations, the
// Chefs, help and the shift report. The review panel is review.js. One panel is open at a time, docked on the right on
// a laptop and a bottom sheet on a phone. Every panel draws from the last snapshot, so it opens the moment it is tapped.
import { esc, mmss, toast, emit } from './core.js';
import { setDock } from './scene.js';
import { isMuted, setMuted } from './audio.js';
import { F, now, stationDef, customerById, chefWords, patienceLeft } from './floor.js';
import { renderMeal, mealSig } from './review.js';
import { itemEditor, wireEditor, toggleTyping, addTyped, textStep, wireTextStep, chipRow } from './quickpicks.js';
import { CODES, LIMITS, STATION_LABEL, STATION_FILES } from '/shared/protocol.js';

/* ======================= the host ======================= */
const P = { el: null, inner: null, key: null, states: new Map(), sig: null, opened: 0, lastOpenMs: 0 };
export const panelKey = () => P.key;
export const panelOpen = () => !!P.key;
/** State a panel keeps across redraws (drafts, the hunk you are on, a half-written reason). One per key. */
export function panelState(key = P.key) { if (!P.states.has(key)) P.states.set(key, { __key: key }); return P.states.get(key); }

export function initPanels(ui) {
  const el = document.createElement('aside');
  el.className = 'fl-panel'; el.id = 'flPanel'; el.hidden = true; el.setAttribute('aria-live', 'polite');
  el.innerHTML = '<button type="button" class="fl-close" aria-label="Close">×</button><div class="fl-inner"></div>';
  ui.append(el);
  el.querySelector('.fl-close').onclick = () => closePanel();
  P.el = el; P.inner = el.querySelector('.fl-inner'); P.key = null; P.states.clear(); P.sig = null;
}
export function disposePanels() { P.el?.remove(); P.el = P.inner = null; P.key = null; P.states.clear(); setDock(0, 0); }

/** The line a refusal code reads as. */
export const say = r => r?.message || CODES[r?.code] || 'That did not work.';
/** Sends an action through the shell and says why when it is refused. */
export async function doAct(name, args = {}, { quiet = false } = {}) {
  if (!F.ctx) return { ok: false, code: 'bad_state' };
  if (!F.you.canAct) { toast(CODES.view_only, 'bad'); return { ok: false, code: 'view_only' }; }
  let r;
  try { r = await F.ctx.act(name, args); } catch (e) { r = { ok: false, code: 'bad_state', message: e?.message }; }
  r ||= { ok: false };
  if (!r.ok && !quiet) { toast(say(r), 'bad'); emit('sfx', 'err'); }
  if (r.ok) emit('acted', name, args);
  return r;
}
export const viewOnly = () => '<span class="fl-viewonly"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12c2.5-4.5 5.7-6.5 9.5-6.5s7 2 9.5 6.5c-2.5 4.5-5.7 6.5-9.5 6.5s-7-2-9.5-6.5z" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>View only</span>';
/**
 * A button. act: an action name sent with args; goto: a panel to open instead; handler: a name looked up in wireActs.
 * Visitors see "View only" in place of anything that acts.
 */
export function actBtn(label, act, args, cls = '', goto = null, handler = null, disabled = false) {
  if (!goto && !F.you.canAct) return viewOnly();
  const data = goto ? `data-goto-panel="${esc(goto)}"` : handler ? `data-do="${esc(handler)}"` : `data-do="act:${esc(act)}" data-args="${esc(JSON.stringify(args || {}))}"`;
  return `<button type="button" class="fl-btn ${cls}" ${data} ${disabled ? 'disabled' : ''}>${label}</button>`;
}
/** Wires every [data-do] and [data-goto-panel] button in el. handlers: name -> async fn. */
export function wireActs(el, handlers = {}) {
  el.querySelectorAll('[data-do]').forEach(b => {
    if (b.__wired) return; b.__wired = true;
    b.onclick = async () => {
      const d = b.dataset.do;
      b.disabled = true;
      try {
        if (handlers[d]) await handlers[d]();
        else if (d.startsWith('act:')) await doAct(d.slice(4), JSON.parse(b.dataset.args || '{}'));
      } finally { if (b.isConnected) b.disabled = false; }
    };
  });
  el.querySelectorAll('[data-goto-panel]').forEach(b => { if (!b.__wired) { b.__wired = true; b.onclick = () => openPanel(b.dataset.gotoPanel); } });
}

/* ======================= open, redraw, close ======================= */
/** Opens a panel by key ('customer:c1', 'table:0', 'pass', 'meal:m1', 'rail', 'station:backend', 'chef:pixel', 'line', 'help', 'report'). */
export function openPanel(key, { keepState = true, force = false } = {}) {
  if (!P.el || !F.snap) return false;
  const S = F.snap;
  if (key === 'pass') key = passKey(S);
  if (S.mustBreak && F.you.canAct && !['help', 'report'].includes(key)) { emit('mustBreak'); return false; }
  const changed = P.key !== key;
  if (changed && !keepState) P.states.delete(key);
  P.key = key; P.el.hidden = false; P.el.dataset.kind = key.split(':')[0];
  document.body.classList.add('fl-panel-open');
  if (changed || force) { P.sig = null; P.opened++; P.lastOpenMs = performance.now(); }
  draw(force || changed);
  if (changed) { emit('sfx', 'open'); P.inner.scrollTop = 0; }
  emit('panel', key);
  return true;
}
export function closePanel() {
  if (!P.key || !P.el) return;
  const k = P.key; P.key = null; P.el.hidden = true; document.body.classList.remove('fl-panel-open');
  P.states.get(k) && saveDraftsOnClose(k);
  setDock(0, 0); emit('panel', null);
}
/** Called on every snapshot: the open panel redraws only when what it shows changed. */
export function refreshPanel() { if (P.key && F.snap) draw(false); }

function draw(force) {
  const S = F.snap, key = P.key, [kind, id] = key.split(':');
  const def = PANELS[kind]; if (!def) return closePanel();
  const sig = `${key}|${def.sig(S, id)}|${F.you.canAct}`;
  if (!force && sig === P.sig) return;
  P.sig = sig;
  // keep the caret where it was when a redraw lands while someone types
  const a = document.activeElement, keep = a?.dataset?.keep && P.inner.contains(a) ? { k: a.dataset.keep, s: a.selectionStart, e: a.selectionEnd } : null;
  def.render(P.inner, S, id);
  wireActs(P.inner);
  if (keep) { const t = P.inner.querySelector(`[data-keep="${keep.k}"]`); if (t) { t.focus(); try { t.setSelectionRange(keep.s, keep.e); } catch { /* not text */ } } }
  P.el.dataset.kind = kind;
  // measured on the next frame, so the tap that opened the panel does no layout work
  requestAnimationFrame(() => dock());
}
/** The room slides out from under the panel: right on a laptop, up on a phone. */
export function dock() {
  if (!P.key || !P.el) return setDock(0, 0);
  const st = P.el.parentElement?.getBoundingClientRect(), r = P.el.getBoundingClientRect();
  if (!st || !st.width) return;
  if (document.body.dataset.layout === 'portrait') setDock(0, Math.min(0.7, Math.max(0, (st.bottom - r.top) / st.height)));
  else setDock(Math.min(0.55, Math.max(0, (st.right - r.left + 8) / st.width)), 0);
}
addEventListener('resize', () => dock());

/** Tapping the Pass opens the first Meal that still needs a look, else the Pass itself. */
function passKey(S) {
  const first = S.pass.find(id => !['approved'].includes(S.items[S.meals[id]?.itemId]?.status));
  return first ? `meal:${first}` : 'passlist';
}

/* ======================= small pieces ======================= */
const stars = (n, of = 3) => `<span class="fl-stars" aria-label="${n} of ${of}">${Array.from({ length: of }, (_, i) => `<i class="${i < n ? 'on' : ''}">★</i>`).join('')}</span>`;
const itemStatusWord = { draft: 'draft', queued: 'on the rail', waiting_stove: 'waiting for a stove', cooking: 'cooking', ready: 'on the Pass', sampled: 'being sampled', approved: 'approved', served: 'served', burnt: 'burnt, retrying' };
const freeTable = S => S.tables.findIndex(t => !t);
const orderItems = (S, c) => c.order.itemIds.map(i => S.items[i]).filter(Boolean);
function orderCard(o, { open = true } = {}) {
  return `<details class="fl-order" ${open ? 'open' : ''}><summary><span class="fl-src">${esc(o.source)}</span><b>#${o.number} ${esc(o.title)}</b></summary>
    <p>${esc(o.description)}</p>
    <ul class="fl-ac">${o.acceptanceCriteria.map(a => `<li>${esc(a)}</li>`).join('')}</ul>
    <div class="fl-row"><span>Difficulty ${stars(o.difficulty)}</span><span class="fl-size ${esc(o.size)}">${esc(o.size)}</span></div></details>`;
}
function patienceBar(p, label) {
  const f = patienceLeft(p); if (f === null) return '';
  return `<div class="fl-pat ${f < 0.34 ? 'low' : ''}"><span>${esc(label)}</span><i style="--p:${Math.round(f * 100)}%"></i></div>`;
}

/* ======================= the panels ======================= */
const PANELS = {
  /* ---- a Customer in the line: their Order, and Seat ---- */
  customer: {
    sig: (S, id) => { const c = customerById(id); return `${c?.status}|${c?.table}|${S.tables.map(t => t?.id).join()}|${S.line.map(c => c.id).join()}`; },
    render(el, S, id) {
      const c = customerById(id);
      if (!c) { el.innerHTML = '<div class="fl-head"><h2>Gone</h2></div><p>That Customer has left.</p>'; return; }
      if (c.status !== 'in_line' && c.table != null) return PANELS.table.render(el, S, String(c.table));
      const ft = freeTable(S), pos = S.line.findIndex(x => x.id === id);
      el.innerHTML = `
        <div class="fl-head"><small>In the line · ${pos === 0 ? 'next up' : `${pos + 1}${['st', 'nd', 'rd'][pos] || 'th'} in line`}</small><h2>${esc(c.name)}</h2><p class="fl-persona">${esc(c.persona)}</p></div>
        <div class="fl-body fl-pad">${orderCard(c.order)}</div>
        <div class="fl-foot"><div class="fl-row">${ft < 0 ? `<span class="fl-warn">${esc(CODES.no_table)}</span>` : actBtn(`Seat at Table ${ft + 1}`, null, null, 'ok big', null, 'seat')}</div></div>`;
      wireActs(el, { seat: async () => { const r = await doAct('seat', { customerId: id, table: ft }); if (r.ok) openPanel(`table:${ft}`); } });
    },
  },

  /* ---- the whole line ---- */
  line: {
    sig: S => `${S.line.map(c => c.id).join()}|${S.tables.map(t => t?.id).join()}`,
    render(el, S) {
      const ft = freeTable(S);
      el.innerHTML = `<div class="fl-head"><small>The line · tasks not started</small><h2>${S.line.length} waiting</h2></div>
        <div class="fl-body"><ol class="fl-list">${S.line.map(c => `<li><button type="button" class="fl-rowbtn" data-goto-panel="customer:${c.id}"><span class="fl-size ${c.order.size}">${c.order.size}</span><b>#${c.order.number} ${esc(c.order.title)}</b><small>${esc(c.name)} · ${esc(c.order.source)}</small></button></li>`).join('') || '<li class="fl-empty">The line is empty.</li>'}</ol></div>
        <div class="fl-foot">${S.line.length && ft >= 0 ? actBtn(`Seat next at Table ${ft + 1}`, null, null, 'ok', null, 'seatNext') : ft < 0 ? `<span class="fl-warn">${esc(CODES.no_table)}</span>` : ''}</div>`;
      wireActs(el, { seatNext: async () => { const c = S.line[0]; const r = await doAct('seat', { customerId: c.id, table: ft }); if (r.ok) openPanel(`table:${ft}`); } });
    },
  },

  /* ---- a table: the order pad, the serve tray, the comment card or the receipt, by where the Order is ---- */
  table: {
    sig(S, id) {
      const c = S.tables[+id];
      if (!c) return `free|${S.line[0]?.id}`;
      const its = orderItems(S, c).map(i => `${i.id}:${i.status}:${i.redoCount}`).join();
      return `${c.id}|${c.status}|${c.feedbackRead}|${c.feedbackRound}|${its}|${!!c.receipt}|${Math.round((patienceLeft(c.patience) ?? 1) * 20)}`;
    },
    render(el, S, id) {
      const t = +id, c = S.tables[t], st = panelState();
      if (!c) {
        if (st.receipt) return receipt(el, st.receipt, t, S);
        el.innerHTML = `<div class="fl-head"><small>Table ${t + 1}</small><h2>A free table</h2></div><div class="fl-body"><p>Seat a Customer from the line to start their Order.</p></div>
          <div class="fl-foot">${S.line.length ? actBtn(`Seat ${esc(S.line[0].name)}`, null, null, 'ok', null, 'seatNext') : '<span>The line is empty.</span>'}</div>`;
        wireActs(el, { seatNext: async () => { await doAct('seat', { customerId: S.line[0].id, table: t }); } });
        return;
      }
      if (c.status === 'paying') { st.receipt = { c: JSON.parse(JSON.stringify(c)) }; return receipt(el, st.receipt, t, S); }
      st.receipt = null;
      const items = orderItems(S, c), drafts = items.filter(i => i.status === 'draft');
      if (c.status === 'awaiting_player' && !st.more && !drafts.length) return feedbackCard(el, S, c, t, st);
      if (c.status === 'seated' || drafts.length || st.more) return orderPad(el, S, c, t, st, drafts);
      return tray(el, S, c, t, st, items);
    },
  },

  /* ---- the Pass when everything on it is approved, or nothing is ---- */
  passlist: {
    sig: S => S.pass.map(id => `${id}:${S.items[S.meals[id]?.itemId]?.status}`).join(),
    render(el, S) {
      el.innerHTML = `<div class="fl-head"><small>The Pass · review before it goes out</small><h2>${S.pass.length ? `${S.pass.length} on the Pass` : 'Nothing on the Pass'}</h2></div>
        <div class="fl-body">${S.pass.length ? `<ol class="fl-list">${S.pass.map(mid => { const m = S.meals[mid], it = S.items[m.itemId], cu = customerById(it?.customerId); return `<li><button type="button" class="fl-rowbtn" data-goto-panel="meal:${mid}"><span class="fl-st on st-${it?.station}">${esc(stationDef(it?.station).name)}</span><b>${esc(it?.status === 'approved' ? 'Approved' : 'To sample')}</b><small>Table ${(cu?.table ?? 0) + 1} · ${esc(cu?.name || '')}</small></button></li>`; }).join('')}</ol><p>Approved Meals wait here until you serve them at their table.</p>` : '<p>Chefs put finished Meals here. You sample each one before a Customer sees it.</p>'}</div>`;
    },
  },
  meal: { sig: mealSig, render: renderMeal },

  /* ---- the ticket rail ---- */
  rail: {
    sig: S => `${S.readyQueue.join()}|${Object.values(S.items).filter(i => ['cooking', 'waiting_stove', 'burnt'].includes(i.status)).map(i => i.id + i.status).join()}`,
    render(el, S) {
      const row = (it, word) => `<li class="fl-ticket st-${it.station}"><span class="fl-st on st-${it.station}">${esc(STATION_LABEL[it.station])}</span><p>${esc(it.prompt)}</p><small>${esc(word)}${it.redoCount ? ` · redo ${it.redoCount}: ${esc(it.redoReason || '')}` : ''}</small></li>`;
      const busy = Object.values(S.items).filter(i => ['cooking', 'waiting_stove', 'burnt'].includes(i.status));
      el.innerHTML = `<div class="fl-head"><small>Ticket rail · the Ready Queue</small><h2>${S.readyQueue.length} waiting for a Chef</h2></div>
        <div class="fl-body"><p>Oldest first. A free Chef takes the next ticket automatically.</p>
        <ol class="fl-list">${S.readyQueue.map((iid, n) => row(S.items[iid], n === 0 ? 'next up' : `${n + 1} in queue`)).join('') || '<li class="fl-empty">No tickets waiting.</li>'}</ol>
        ${busy.length ? `<h3>With the Chefs</h3><ol class="fl-list">${busy.map(i => row(i, itemStatusWord[i.status])).join('')}</ol>` : ''}</div>`;
    },
  },

  /* ---- a Station, and who cooks there ---- */
  station: {
    sig: (S, id) => S.chefs.map(c => `${c.status}${c.station}${c.thought}`).join() + S.readyQueue.join(),
    render(el, S, id) {
      const d = stationDef(id), chef = S.chefs.find(c => c.station === id && c.status !== 'idle');
      const item = chef?.itemId ? S.items[chef.itemId] : null;
      const waiting = S.readyQueue.map(i => S.items[i]).filter(i => i?.station === id);
      el.innerHTML = `<div class="fl-head"><small>Station</small><h2><span class="fl-st on st-${id}">${esc(d.name)}</span></h2></div>
        <div class="fl-body"><p>${esc(d.does)}</p><p class="fl-files"><b>File focus</b> ${(STATION_FILES[id] || []).map(f => `<code>${esc(f)}</code>`).join(' ')}</p>
        ${chef ? `<div class="fl-summary"><b>Chef ${esc(chef.name)} · ${esc(chefWords(chef, S))}</b>${item ? `<p>${esc(item.prompt)}</p>${progress(item)}` : ''}${chef.thought ? `<small>${esc(chef.thought)}</small>` : ''}</div>` : '<p>Nobody is cooking here right now.</p>'}
        ${waiting.length ? `<p>${waiting.length} ticket${waiting.length > 1 ? 's' : ''} for this Station on the rail.</p>` : ''}</div>`;
    },
  },
  chef: {
    sig: (S, id) => { const c = S.chefs.find(x => x.id === id); return `${c?.status}|${c?.itemId}|${c?.thought}`; },
    render(el, S, id) {
      const c = S.chefs.find(x => x.id === id); if (!c) { el.innerHTML = '<p>No such Chef.</p>'; return; }
      const item = c.itemId ? S.items[c.itemId] : null;
      el.innerHTML = `<div class="fl-head"><small>Chef · ${esc(c.modelLabel)}</small><h2>${esc(c.name)}</h2></div>
        <div class="fl-body"><p class="fl-big">${esc(chefWords(c, S))}</p>${item ? `<div class="fl-summary"><b>${esc(STATION_LABEL[item.station])} ticket</b><p>${esc(item.prompt)}</p>${progress(item)}</div>` : '<p>Idle Chefs take the oldest ticket on the rail by themselves.</p>'}
        ${c.status === 'waiting_stove' ? '<p class="fl-note">Waiting for a stove: the server is at its limit of model calls in flight. This time never counts against you.</p>' : ''}
        ${c.thought ? `<p><i>${esc(c.thought)}</i></p>` : ''}</div>`;
    },
  },

  /* ---- help: the keys, the loop, Close up ---- */
  help: {
    sig: S => `${S.shift.status}`,
    render(el, S) {
      el.innerHTML = `<div class="fl-head"><small>How to play</small><h2>Run the pass</h2></div>
        <div class="fl-body"><ol class="fl-loop"><li><b>Seat</b> a Customer from the line on the left.</li><li><b>Split</b> their Order into Items at the table, one Station each.</li><li><b>Review</b> each Meal at the Pass, hunk by hunk. Approve or send it back.</li><li><b>Serve</b> the approved Meals with a note.</li><li><b>Ship</b> it with the Bill once the Customer is happy.</li></ol>
        <p>When both Chefs are cooking you may <b>take a break</b>. You are called back after your grace period.</p>
        <dl class="fl-keys"><dt>WASD / click</dt><dd>walk</dd><dt>E</dt><dd>use what is near</dd><dt>Shift</dt><dd>dash</dd><dt>Tab</dt><dd>the most urgent thing</dd><dt>T</dt><dd>Type it</dd><dt>J / K</dt><dd>next / previous hunk</dd><dt>P</dt><dd>presenter mode</dd><dt>Esc</dt><dd>close</dd></dl></div>
        <div class="fl-foot"><div class="fl-row">${S.shift.status === 'running' ? actBtn('Close up for the day', 'closeShift', {}, 'bad') : ''}<button type="button" class="fl-btn ghost" data-sound>${isMuted() ? 'Sound on' : 'Sound off'}</button><button type="button" class="fl-btn ghost" data-presenter>Presenter mode <kbd>P</kbd></button></div></div>`;
      el.querySelector('[data-presenter]').onclick = () => emit('presenter');
      el.querySelector('[data-sound]').onclick = e => { setMuted(!isMuted()); e.currentTarget.textContent = isMuted() ? 'Sound on' : 'Sound off'; };
    },
  },

  /* ---- the shift report ---- */
  report: {
    sig: S => JSON.stringify(S.shift.report),
    render(el, S) {
      const r = S.shift.report || {}; const st = S.stats || {};
      el.innerHTML = `<div class="fl-head"><small>${esc(S.name)} · end of shift</small><h2>Shift report</h2></div>
        <div class="fl-body"><p class="fl-verdict">${esc(r.verdict || 'Shift over.')}</p>
        <div class="fl-stats">
          <div><b>${r.shipped ?? st.shipped ?? 0}</b><small>Orders shipped</small></div><div><b>${r.points ?? S.score}</b><small>points</small></div>
          <div><b>${Math.round((r.reworkRate || 0) * 100)}%</b><small>rework rate</small></div><div><b>${r.avgCallBackMs ? `${(r.avgCallBackMs / 1000).toFixed(1)} s` : '-'}</b><small>avg call-back response</small></div>
          <div><b>${mmss(r.breakMs || 0)}</b><small>break time</small></div><div><b>${mmss(r.longestWorkMs || 0)}</b><small>longest work stretch</small></div>
        </div></div>
        <div class="fl-foot"><div class="fl-row">${actBtn('Play again', 'playAgain', {}, 'ok big')}${actBtn('Leave', 'leave', {}, 'ghost')}</div></div>`;
    },
  },
};

function progress(item) {
  if (!item?.cookStartedAt || !item.cookEndsAt) return '';
  const f = Math.max(0, Math.min(1, (now() - item.cookStartedAt) / Math.max(1, item.cookEndsAt - item.cookStartedAt)));
  return `<div class="fl-prog"><i style="--p:${Math.round(f * 100)}%"></i></div>`;
}

/* ---------- the order pad: split the Order into Items ---------- */
function draftsFromServer(S, c) { return orderItems(S, c).filter(i => i.status === 'draft').map(i => ({ id: i.id, prompt: i.prompt, station: i.station, quickPickId: i.quickPickId, typed: i.typed })); }
function orderPad(el, S, c, t, st, drafts) {
  const sig = drafts.map(d => d.id).join();
  if (!st.drafts || (st.draftSig !== sig && !st.dirty)) { st.drafts = draftsFromServer(S, c); st.draftSig = sig; }
  st.typedStation ||= 'backend';
  const follow = (c.feedback?.suggestedFollowUps || []).map((f, i) => ({ id: `fu${c.feedbackRound}-${i}`, label: f.prompt, prompt: f.prompt, station: f.station }));
  // the server may already have added the follow-ups to the Order's quick picks (followUp: true): each prompt once, follow-ups first
  const seen = new Set(), picks = [];
  for (const q of [...c.order.quickPicks.filter(q => q.followUp), ...(c.status === 'awaiting_player' || st.more ? follow : []), ...c.order.quickPicks.filter(q => !q.followUp)]) if (!seen.has(q.prompt)) { seen.add(q.prompt); picks.push(q); }
  const sent = orderItems(S, c).filter(i => i.status !== 'draft');
  el.innerHTML = `
    <div class="fl-head"><small>Table ${t + 1} · ${esc(c.name)} · order pad</small><h2>${st.more ? 'More work' : 'Split the Order'}</h2></div>
    <div class="fl-body fl-pad">
      ${orderCard(c.order, { open: !sent.length && !st.more && !st.drafts.length })}
      ${st.more && c.feedback ? `<p class="fl-quote">“${esc(c.feedback.comments)}”</p>` : ''}
      <h3>Items <small>1 to ${LIMITS.items}, one Station each</small></h3>
      ${itemEditor(st, picks, { canAct: F.you.canAct })}
      ${sent.length ? `<h3>Already sent</h3><ol class="fl-list">${sent.map(i => `<li class="fl-ticket st-${i.station}"><span class="fl-st on st-${i.station}">${esc(STATION_LABEL[i.station])}</span><p>${esc(i.prompt)}</p><small>${esc(itemStatusWord[i.status])}</small></li>`).join('')}</ol>` : ''}
    </div>
    <div class="fl-foot"><div class="fl-row">${actBtn(`Send ${st.drafts.length || ''} to the kitchen`, null, null, 'ok big', null, 'send', !st.drafts.length)}</div></div>`;
  const redraw = (why, full = true) => { st.dirty = true; if (full) openPanel(`table:${t}`, { force: true }); };
  wireEditor(el, st, picks, redraw);
  st.__typeit = () => toggleTyping(st, redraw);
  st.__addTyped = () => addTyped(st, redraw);
  wireActs(el, { send: () => sendItems(c, st, t) });
}
async function saveDrafts(c, st) {
  const items = st.drafts.map(d => ({ ...(d.id ? { id: d.id } : {}), prompt: d.prompt.trim().slice(0, LIMITS.prompt), station: d.station, ...(d.quickPickId ? { quickPickId: d.quickPickId } : {}), typed: !!(d.typed || d.edited) }));
  if (!items.length) return { ok: true };
  if (items.some(i => !i.prompt)) { toast(CODES.empty, 'bad'); return { ok: false, code: 'empty' }; }
  const r = await doAct('saveItems', { customerId: c.id, items });
  if (r.ok) st.dirty = false;
  return r;
}
async function sendItems(c, st, t) {
  if (!st.drafts.length) { toast(CODES.no_items, 'bad'); return; }
  const r = await saveDrafts(c, st); if (!r.ok) return;
  const s = await doAct('sendItems', { customerId: c.id });
  if (s.ok) { st.drafts = []; st.dirty = false; st.more = false; st.typing = false; emit('sfx', 'clink'); toast('Order in! Tickets are on the rail.', ''); closePanel(); }
}
function saveDraftsOnClose(key) {
  const st = P.states.get(key); if (!st?.dirty || !key.startsWith('table:') || !F.you.canAct) return;
  const c = F.snap?.tables[+key.slice(6)]; if (c && st.drafts?.length) saveDrafts(c, st);
}
/** T and Enter in the order pad, for the keys. */
export function typeItKey() { const st = P.key?.startsWith('table:') ? P.states.get(P.key) : null; if (st?.__typeit) { st.__typeit(); return true; } return false; }

/* ---------- the tray: what is cooking, and Serve ---------- */
function tray(el, S, c, t, st, items) {
  const approved = items.filter(i => i.status === 'approved');
  const eating = c.status === 'eating';
  el.innerHTML = `
    <div class="fl-head"><small>Table ${t + 1} · ${esc(c.name)}</small><h2>${eating ? 'Tasting your work…' : approved.length ? 'Ready to serve' : 'Waiting for food'}</h2></div>
    <div class="fl-body">
      ${orderCard(c.order, { open: false })}
      <ol class="fl-list">${items.map(i => `<li class="fl-ticket st-${i.station} is-${i.status}"><span class="fl-st on st-${i.station}">${esc(STATION_LABEL[i.station])}</span><p>${esc(i.prompt)}</p><small>${esc(itemStatusWord[i.status])}${i.status === 'ready' || i.status === 'sampled' ? ' · sample it at the Pass' : ''}</small>${i.mealId && ['ready', 'sampled', 'approved'].includes(i.status) ? `<button type="button" class="fl-btn ghost sm" data-goto-panel="meal:${i.mealId}">Open</button>` : ''}</li>`).join('')}</ol>
      ${eating ? `<p>${esc(c.name)} is checking the work against the Order. Feedback comes next.</p>` : ''}
      ${approved.length && !eating ? `<h3>Serve ${approved.length} approved Meal${approved.length > 1 ? 's' : ''}</h3><p>Add a note for the reviewer (optional).</p>${textStep(S.chips?.serve || [], st.note, { keep: 'note', placeholder: 'A note for the Customer', max: LIMITS.note, name: 'note' })}` : ''}
    </div>
    ${approved.length && !eating ? `<div class="fl-foot"><div class="fl-row">${actBtn(`Serve ${approved.length} to ${esc(c.name.split(' ')[0])}`, null, null, 'ok big', null, 'serve')}${items.some(i => ['queued', 'cooking', 'ready', 'sampled', 'waiting_stove'].includes(i.status)) ? '<small>Other Items are still in the kitchen. You can serve now and the rest later.</small>' : ''}</div></div>` : ''}`;
  wireTextStep(el, S.chips?.serve || [], st, 'note', 'note');
  wireActs(el, {
    serve: async () => {
      const r = await doAct('serveOrder', { customerId: c.id, note: String(st.note || '').trim().slice(0, LIMITS.note) });
      if (r.ok) { st.note = ''; emit('sfx', 'drop'); toast(`Served! ${c.name.split(' ')[0]} is tasting.`, ''); }
    },
  });
}

/* ---------- the comment card: Feedback ---------- */
function feedbackCard(el, S, c, t, st) {
  const fb = c.feedback;
  if (!fb) { el.innerHTML = `<div class="fl-head"><h2>${esc(c.name)}</h2></div><p>Thinking…</p>`; return; }
  if (!c.feedbackRead && F.you.canAct && st.readFor !== c.feedbackRound) { st.readFor = c.feedbackRound; doAct('readFeedback', { customerId: c.id }, { quiet: true }); }
  el.innerHTML = `
    <div class="fl-head"><small>Table ${t + 1} · round ${c.feedbackRound || 1} · comment card</small><h2>${esc(c.name)}</h2></div>
    <div class="fl-body">
      <div class="fl-comment ${fb.satisfied ? 'good' : 'bad'}">
        <div class="fl-stars big" aria-label="${fb.score} of 5">${[1, 2, 3, 4, 5].map(n => `<i class="${n <= fb.score ? 'on' : ''}">★</i>`).join('')}</div>
        <b class="fl-verdict">${fb.satisfied ? 'Satisfied' : 'More work needed'}</b>
        <p>“${esc(fb.comments)}”</p>
        ${fb.suggestedFollowUps?.length ? `<h3>Suggested follow-ups</h3><ul>${fb.suggestedFollowUps.map(f => `<li><span class="fl-st on st-${f.station}">${esc(STATION_LABEL[f.station])}</span> ${esc(f.prompt)}</li>`).join('')}</ul>` : ''}
      </div>
      ${patienceBar(c.patience, `${c.name.split(' ')[0]} is waiting on you`)}
    </div>
    <div class="fl-foot"><div class="fl-row">${actBtn('More work', null, null, fb.satisfied ? 'ghost' : 'ok', null, 'more')}${actBtn('Bring the bill', null, null, fb.satisfied ? 'ok big' : 'ghost', null, 'bill')}</div></div>`;
  wireActs(el, {
    more: async () => { const r = await doAct('moreWork', { customerId: c.id }); if (r.ok) { st.more = true; st.drafts = null; openPanel(`table:${t}`, { force: true }); } },
    bill: async () => { const r = await doAct('giveBill', { customerId: c.id }); if (r.ok) emit('sfx', 'coin'); },
  });
}

/* ---------- the receipt ---------- */
function receipt(el, { c }, t, S) {
  const r = c.receipt || {};
  el.innerHTML = `<div class="fl-head"><small>Table ${t + 1}</small><h2>The Bill</h2></div>
    <div class="fl-body"><div class="fl-receipt">
      <h3>${esc(S.name)}</h3><p>#${c.order.number} ${esc(c.order.title)}<br><small>${esc(c.order.source)} · ${esc(c.name)}</small></p>
      <dl><dt>Items</dt><dd>${r.items ?? c.order.itemIds.length}</dd><dt>Redos</dt><dd>${r.redos ?? 0}</dd><dt>Time taken</dt><dd>${mmss(r.tookMs || 0)}</dd><dt>Customer score</dt><dd>${r.score ?? '-'} / 5</dd></dl>
      <p class="fl-total"><span>Points</span><b>+${r.points ?? 0}</b></p>
      <div class="fl-stamp" aria-label="Shipped">SHIPPED</div>
    </div></div>
    <div class="fl-foot"><div class="fl-row">${S.tables[t] ? '' : '<span>The table is free again.</span>'}${S.line.length && !S.tables[t] && F.you.canAct ? actBtn(`Seat ${esc(S.line[0].name)}`, null, null, 'ok', null, 'seatNext') : ''}</div></div>`;
  wireActs(el, { seatNext: async () => { panelState().receipt = null; await doAct('seat', { customerId: S.line[0].id, table: t }); } });
}

export const panelStats = () => ({ key: P.key, opened: P.opened, lastOpenMs: P.lastOpenMs });
