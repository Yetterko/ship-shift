// HUD, the focus card, speech bubbles, the docked review panel, and the two dialogs.
// Nothing here stops the kitchen: the only <dialog>s are New order and the shift report.
import { $, G, fx, esc, mmss, nowS, orderOf, chefName, api, getJson, toast, emit, ICON, modelName, escalation, quiet, arcade, can, kpath, whyNot, atHome } from './core.js';
import { V, label, setDock, popup, spawn } from './scene.js';
import { createBoard } from './board.js';
import { player, local, stationState, stateWords, plateLook, chefStations, chefIndex, passSlotOf, chefChar, kick, JARS, orderPos } from './world.js';

export const ui = {
  taste: null, wip: null, wipAt: 0,           // station id being tasted, and its last live diff
  input: null,                                // { mode: 'steer'|'answer', id } while the one-line input is open
  review: null, hunks: 0, cur: 0,             // order id in the docked panel
  reviewRemote: false,                        // opened from the board, so it does not close when you are not at the pass
  board: false,                               // the board drawer is open
  qFor: null, qStep: 0, qAnswers: {},
  binChef: null,
};
const seen = new Map();                       // "id:rounds" -> { total, seen:Set }
const seenKey = o => `${G.visit ? G.visit.of : 'home'}:${o.id}:${o.rounds}`;
/** Another kitchen is about to be drawn: nothing that pointed at an order of the old one survives. */
export function resetPanels() {
  closeReview(); closeInput();
  seen.clear();
  Object.assign(ui, { taste: null, wip: null, qFor: null, qStep: 0, qAnswers: {}, qShown: null, binChef: null });
}
/** True once every hunk of the plate's diff has been looked at. Shipping without it is a blind ship. */
export function diffSeen(o) { const s = seen.get(seenKey(o)); return !!s && s.seen.size >= s.total; }

for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = ICON[el.dataset.icon] || '';
// A hint for one real key is also a button that presses it (input.js listens for data-k), so every action works by tap or click.
const PRESSABLE = /^(E|Q|F|R|X|T|J|K|B|Tab|Shift|Enter|\?|[1-4])$/;
const kbd = (k, text) => `<span class="k"${PRESSABLE.test(k) ? ` data-k="${k}" role="button"` : ''}><kbd>${k}</kbd>${text}</span>`;
const secs = ms => { const s = ms / 1000; return s >= 10 ? String(Math.round(s)) : String(Math.round(s * 10) / 10); };

/* ======================= HUD ======================= */
let lastScore = null;
export function hud() {
  const S = G.own || G.S; if (!S) return;      // the HUD is always your own kitchen's, wherever you are standing
  const t = nowS(), sh = S.shift;
  const arc = arcade();
  if (!hud.minutes) { hud.minutes = true; $('focusMin').value = sh.focusMin; $('breakMin').value = sh.breakMin; }
  // an arcade round is service, not a quiet focus block: nothing is dimmed or held back
  document.body.dataset.shift = sh.mode === 'focus' && arc ? 'service' : sh.mode;
  $('shiftMode').textContent = sh.mode === 'focus' ? `Shift ${sh.no} · ${arc ? 'service' : 'focus'}` : sh.mode === 'break' ? (arc ? 'Shift over · run the pass' : 'Break · run the pass') : arc ? 'Take a ticket to start' : 'Start a shift';
  const left = sh.endsAt ? sh.endsAt - t : 0;
  $('shiftClock').textContent = sh.endsAt ? mmss(left) : mmss((Number($('focusMin').value) || 25) * 60000);
  $('clockBtn').classList.toggle('last', sh.mode === 'focus' && left < 30000);
  $('shiftBtn').textContent = sh.mode === 'off' ? 'Start shift' : 'End shift';
  const live = S.questions.reduce((n, q) => n + (t - q.createdAt), 0);
  $('mBlocked').textContent = mmss(S.stats.blockedMs + live);
  $('mBlockedBox').classList.toggle('hot', S.questions.length > 0);
  $('mShipped').textContent = S.stats.shipped;
  $('mSpend').textContent = `$${S.stats.costUsd.toFixed(2)}`;
  if (S.stats.score !== lastScore) {
    $('mScore').textContent = S.stats.score;
    if (lastScore !== null) { const el = $('scoreBox'); el.classList.remove('bump', 'drop'); void el.offsetWidth; el.classList.add(S.stats.score > lastScore ? 'bump' : 'drop'); }
    lastScore = S.stats.score;
  }
  const streak = S.stats.streak ?? 1;
  $('mStreak').textContent = `×${streak.toFixed(1)}`;
  $('mStreak').classList.toggle('on', streak > 1);
  if (ui.board) board.render(S);
}
setInterval(hud, 500);

$('clockBtn').onclick = () => { $('shiftPop').hidden = !$('shiftPop').hidden; };
$('shiftBtn').onclick = async () => {
  try {
    if (G.S.shift.mode === 'off') await api('/api/shift/start', { focusMin: Number($('focusMin').value), breakMin: Number($('breakMin').value) });
    else await api('/api/shift/stop');
    $('shiftPop').hidden = true;
  } catch { /* toasted */ }
};
$('newOrderBtn').onclick = () => { $('orderForm').reset(); $('orderDialog').showModal(); $('oTitle').focus(); };
$('orderCancel').onclick = () => $('orderDialog').close();
$('orderForm').addEventListener('submit', async e => {
  e.preventDefault();
  const size = document.querySelector('input[name="oSize"]:checked')?.value || 'M';
  try { await api('/api/orders', { title: $('oTitle').value, body: $('oBody').value, size }); $('orderDialog').close(); } catch { /* toasted */ }
});

/* ======================= speech bubble over a blocked chef ======================= */
function bubble(st, q, chef) {
  if (ui.qFor !== q.id) { ui.qFor = q.id; ui.qStep = 0; ui.qAnswers = {}; }
  // what this wait has cost so far rides on the corner of the bubble, where the eyes already are
  if (ui.qShown !== q.id) { ui.qShown = q.id; ui.qAt = performance.now(); }
  const cost = (q.charged ? `<span class="cost" title="Points this wait has cost you">−${q.charged}</span>` : '')
    + (ui.guideAnswer ? `<div class="bhint">Your chef is paused until you answer. ${document.body.classList.contains('touch') ? 'Tap one.' : 'Click one, or press its number.'}</div>` : '');
  const fresh = performance.now() - ui.qAt < 350;
  // a visitor who may not answer sees the question and its options, and why they are not theirs to press
  const ro = !can('answer'), key = k => (ro ? '' : ` data-key="${k}"`), num = k => (ro ? '' : `<kbd>${k}</kbd>`);
  const foot = keys => (ro ? `<div class="bf why">${esc(whyNot('answer'))}</div>` : `<div class="bf">${keys}</div>`);
  let html;
  if (q.kind === 'question') {
    const cur = q.questions[ui.qStep] || q.questions[0] || { question: 'Needs an answer', options: [] };
    html = `<div class="bq">${q.questions.length > 1 ? `<small>${ui.qStep + 1}/${q.questions.length}</small> ` : ''}${esc(cur.question)}</div><ol>${(cur.options || []).slice(0, 4).map((op, i) => `<li${key(i + 1)}>${num(i + 1)}<span><b>${esc(op.label)}</b>${op.description ? `<small>${esc(op.description)}</small>` : ''}</span></li>`).join('')}</ol>${foot(kbd('X', 'your call') + kbd('T', 'type it'))}`;
  } else {
    const detail = String(q.input?.command ?? q.reason ?? q.toolName ?? '').slice(0, 140);
    // "Always" is a grant for the whole shift, and grants are the owner's
    const jar = G.visit ? null : JARS.find(j => j.cls === q.grantClass);
    html = `<div class="bq">May I run this?</div><code>${esc(detail)}</code><ol><li${key(1)}>${num(1)}<span><b>Once</b></span></li>${jar ? `<li data-key="2"><kbd>2</kbd><span><b>Always this shift</b><small>${esc(jar.name)} jar for everyone</small></span></li>` : ''}<li${key(3)}>${num(3)}<span><b>No</b><small>find another way</small></span></li></ol>${foot(kbd('T', 'no, with a note'))}`;
  }
  if (ro) html = html.replace('<ol>', '<ol class="ro">');
  const right = st.j < 2;
  // on a phone there is no room for a bubble beside the chef: the same question is a sheet at the bottom, with fat options to tap
  if (document.body.classList.contains('narrow')) {
    const sheet = `<div class="bub sheet${q.charged ? ' costly' : ''}"><small class="who">${esc(chef.name)} asks${G.visit ? ` ${esc(G.visit.owner)}` : ''}</small>${cost}${html}</div>`;
    if (sheet !== sheetHtml) { $('qsheet').innerHTML = sheet; sheetHtml = sheet; }
    ui.sheet = true;
    return;
  }
  label('bubble', `<div class="bub ${right ? 'tl' : 'tr'}${q.charged ? ' costly' : ''}${fresh ? ' in' : ''}">${cost}${html}</div>`, V(st.stand.x + (right ? 0.75 : -0.75), 2.0, st.stand.z), { pri: 10, anchor: right ? 'tl' : 'tr', cls: 'solid' });
}

export async function answerKey(q, k) {
  if (!can('answer')) { toast(whyNot('answer'), 'bad'); return; }
  if (G.visit && k === '2') return;
  const post = body => { const chef = chefChar(q.chefId); if (chef) kick(chef, 0.4); emit('sfx', body.allow ? 'yes' : 'no'); spawn('star', chefStations[chefIndex(q.chefId)].potPos, ['#ffd75e', '#fff1d6'], { n: 8, up: 1.6, out: 1.6, life: 0.6, grow: 0 }); return api(kpath(`/api/questions/${q.id}/answer`), body).catch(() => {}); };
  if (k === 'x') { if (q.kind !== 'question') return; return post({ allow: false, message: 'Skipped by the head chef. Use your best judgement and say what you assumed.' }); }
  if (q.kind === 'question') {
    const cur = q.questions[ui.qStep]; const op = cur?.options?.[Number(k) - 1]; if (!op) return;
    ui.qAnswers[cur.question] = op.label;
    if (ui.qStep + 1 < q.questions.length) { ui.qStep++; emit('sfx', 'pick'); return; }
    return post({ allow: true, answers: ui.qAnswers });
  }
  if (k === '1') return post({ allow: true });
  if (k === '2' && q.grantClass) return post({ allow: true, always: true });
  if (k === '3') return post({ allow: false });
}
function typedAnswer(q, text) {
  if (q.kind === 'question') {
    const cur = q.questions[ui.qStep]; ui.qAnswers[cur.question] = text;
    if (ui.qStep + 1 < q.questions.length) { ui.qStep++; return; }
    emit('sfx', 'yes');
    return api(kpath(`/api/questions/${q.id}/answer`), { allow: true, answers: ui.qAnswers }).catch(() => {});
  }
  emit('sfx', 'no');
  return api(kpath(`/api/questions/${q.id}/answer`), { allow: false, message: text }).catch(() => {});
}

/* ======================= the one-line input: call out (F) and typed answers (T) ======================= */
export function openInput(mode, id, placeholder) {
  ui.input = { mode, id };
  $('lineForm').hidden = false; $('lineInput').value = ''; $('lineInput').placeholder = placeholder;
  $('lineInput').focus();
}
export function closeInput() { ui.input = null; $('lineForm').hidden = true; $('lineInput').blur(); }
$('lineForm').addEventListener('submit', async e => {
  e.preventDefault();
  const text = $('lineInput').value.trim(), inp = ui.input;
  if (!inp || !text) return closeInput();
  closeInput();
  if (inp.mode === 'steer') {
    const o = orderOf(inp.id);
    try {
      await api(`/api/orders/${inp.id}/steer`, { note: text });
      emit('sfx', 'shout'); const ch = chefChar(o?.chefId); if (ch) kick(ch, 0.5);
      popup('Heard, chef!', orderPos(o), 'good');
    } catch { /* toasted */ }
  } else { const q = G.S.questions.find(x => x.id === inp.id); if (q) typedAnswer(q, text); }
});
$('lineInput').addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeInput(); } });

/* ======================= focus card: detail for the one station you are standing at ======================= */
const feed = (o, n) => o.activity.slice(-n).reverse().map(a => `<li class="${a.kind}">${esc(a.text)}</li>`).join('');
const chips = o => [
  o.plan ? '<span class="chip2 plan">planned</span>' : '',
  ...(o.grants || []).map(c => `<span class="chip2 ${c}">${esc(c)}</span>`),
  o.refires ? `<span class="chip2 warn">re-fired ${o.refires}×</span>` : '',
  o.rounds ? `<span class="chip2 warn">round ${o.rounds + 1}</span>` : '',
].join('');
function overlapsOf(o) {
  return (G.S.overlaps || []).filter(([a, b]) => a === o.id || b === o.id).map(([a, b, files, conflicts]) => (conflicts || []).length
    ? `<div class="warnline hard">${ICON.flame} Conflicts with #${a === o.id ? b : a} in ${esc(conflicts.slice(0, 3).join(', '))}. Whichever ships second goes cold.</div>`
    : `<div class="warnline">${ICON.link} Edits the same files as #${a === o.id ? b : a}: ${esc((files || []).slice(0, 3).join(', '))}.</div>`).join('');
}
function patience(o) {
  const frac = Math.max(0, 1 - (nowS() - o.createdAt) / (o.targetMin * 60000));
  return `<div class="pbar ${frac < 0.2 ? 'late' : frac < 0.5 ? 'warn' : ''}"><i style="width:${Math.round(frac * 100)}%"></i></div>`;
}
/** The card for a station in a kitchen you are visiting: the same facts, and only the keys the owner's door sign gives you. */
function describe(st) {
  const d = describeOwn(st), v = G.visit;
  if (!d || !v || st.type === 'door') return d;
  d.eyebrow = d.eyebrow ? `${v.owner}'s kitchen · ${d.eyebrow}` : `${v.owner}'s kitchen`;
  d.keys = ''; d.wide = false;
  if (st.type === 'chef') {
    const { question: q, chef } = stationState(st);
    if (q) { d.extra = ''; d.sub = can('answer') ? `${chef.name} is paused until somebody answers. You can: pick one in the bubble.` : whyNot('answer'); d.keys = !can('answer') ? '' : q.kind === 'question' ? kbd('1–4', 'answer') + kbd('T', 'type') : kbd('1', 'once') + kbd('3', 'no'); }
    else if (!stationState(st).order) d.sub = `Waiting for ${v.owner} to bring a ticket.`;
  } else if (st.type === 'pass') {
    const { order: o } = stationState(st);
    if (o) { d.sub = !can('approve') ? whyNot('approve') : o.approved ? `Approved. Only ${v.owner} carries it to the hatch.` : `You can review this plate for ${v.owner}.`; d.keys = can('approve') && !o.approved ? kbd('E', 'review') : ''; }
  } else if (st.type === 'slot' && stationState(st).order) d.sub = `Only ${v.owner} hands out tickets here.`;
  return d;
}
function describeOwn(st) {
  const S = G.S, c = player.carry, jar = c?.type === 'jar' ? JARS.find(j => j.cls === c.id) : null;
  switch (st.type) {
    case 'door': {
      if (G.visit) return { eyebrow: `${G.visit.owner}'s kitchen`, title: 'Door to the park', sub: 'Step back outside.', keys: kbd('E', 'leave') };
      if (c?.type === 'ticket') {
        const o = orderOf(c.id);
        return o?.cardId ? { eyebrow: `#${o.id} · ${o.size} · in your hands`, title: 'Send this customer back to the park?', sub: 'They rejoin your team\'s backlog, for you or a teammate to pick up later.', keys: kbd('E', 'back to the backlog') + kbd('Q', 'keep it') }
          : { title: 'Door to the park', sub: 'This order was written here, so it has no customer to send back.', keys: kbd('Q', 'put it back') };
      }
      if (c) return { title: 'Door to the park', sub: 'Put that down before you go out.', keys: kbd('Q', 'put it back') };
      return { eyebrow: 'The town', title: 'Door to the park', sub: 'Your team\'s backlog waits outside. While you are out your door says "Back soon" and nobody new is seated.', keys: kbd('E', 'step outside') };
    }
    case 'slot': {
      const { order: o } = stationState(st);
      if (!o) return { title: 'Order window', sub: 'No ticket in this spot.', keys: '' };
      if (c?.type === 'ticket' && c.id === o.id) return { eyebrow: `#${o.id} · ${o.size} · in your hands`, title: o.title, sub: 'Carry it to a free chef, or to the prep board to plan it first.', extra: patience(o) + chips(o), keys: kbd('Q', 'put it back') };
      const keys = jar ? kbd('E', `shake ${jar.name} on #${o.id}`) : c ? kbd('Q', 'put that down first') : kbd('E', 'take the ticket');
      return { eyebrow: `#${o.id} · ${o.size} · ${stateWords(o)}`, title: o.title, sub: o.body, extra: patience(o) + chips(o) + overlapsOf(o), keys };
    }
    case 'chef': {
      const { chef, order: o, question: q } = stationState(st);
      if (!chef) return null;
      const who = `${chef.name} · ${modelName(chef.model)}`;
      if (q) {
        const every = secs(S.escalation?.everyMs ?? 10000 / (S.pace || 1)), grace = secs(escalation().smokeMs);
        const costLine = q.charged ? `<div class="costline"><b>−${q.charged}</b><span>Keeping ${chef.name} waiting has cost you ${q.charged} point${q.charged === 1 ? '' : 's'}, and costs one more every ${every} s.</span></div>` : '';
        return { tone: 'bad', eyebrow: `${who} · blocked ${mmss(nowS() - q.createdAt)}`, title: `#${o?.id ?? ''} ${o?.title ?? ''}`, sub: q.charged ? '' : quiet() ? 'Held for your break, but the clock is still counting.' : `Answer in the bubble. After ${grace} s a waiting chef costs a point every ${every} s.`, extra: costLine, keys: q.kind === 'question' ? kbd('1–4', 'answer') + kbd('X', 'your call') + kbd('T', 'type') : kbd('1', 'once') + (q.grantClass ? kbd('2', 'always') : '') + kbd('3', 'no') };
      }
      if (!o) return { eyebrow: who, title: `${chef.name} is free`, sub: c?.type === 'ticket' ? (orderOf(c.id)?.plan ? 'The ticket is planned: fewer questions.' : 'Unplanned: quicker to start, more likely to ask or miss.') : 'Bring a ticket from the window.', keys: c?.type === 'ticket' ? kbd('E', `give #${c.id} to ${chef.name}`) : '' };
      if (o.state === 'stalled') return { tone: 'bad', eyebrow: `${who} · stalled`, title: `#${o.id} ${o.title}`, sub: o.error || 'The agent stopped.', keys: kbd('E', 'resume') + kbd('X', ui.binChef === o.id ? 'press again to bin' : 'bin it') };
      if (o.state === 'cooking') {
        const tools = o.activity.filter(a => a.kind === 'tool').length;
        const tasting = ui.taste === st.id;
        let extra = `<ul class="feed">${feed(o, tasting ? 5 : 2)}</ul>` + chips(o) + overlapsOf(o);
        if (tasting) extra = wipHtml() + extra;
        const keys = jar ? kbd('E', `shake ${jar.name} into the pot`) : kbd('E', tasting ? 'stop tasting' : 'taste: live diff') + kbd('F', 'call out');
        return { eyebrow: `${who} · cooking ${mmss(nowS() - o.assignedAt)} · ${tools} tools${(o.touched || []).length ? ` · ${o.touched.length} files` : ''}`, title: `#${o.id} ${o.title}`, extra, keys, wide: tasting };
      }
      return { eyebrow: who, title: `#${o.id} ${o.title}`, sub: `${stateWords(o)}.`, keys: '' };
    }
    case 'prep': {
      const { order: o } = stationState(st);
      if (o?.state === 'planning') return { eyebrow: `Prep board · planning #${o.id}`, title: o.title, extra: `<ul class="feed">${feed(o, 3)}</ul>`, keys: '' };
      if (o) return { eyebrow: `Prep board · plan ready for #${o.id}`, title: o.title, extra: `<pre class="plan">${esc(o.plan || '')}</pre>`, keys: c ? '' : kbd('E', 'pick it up'), wide: true };
      if (c?.type === 'ticket') return orderOf(c.id)?.plan ? { title: 'Prep board', sub: 'This ticket already has a plan. Give it to a chef.', keys: '' } : { title: 'Prep board', sub: 'Plan first: a read-only pass that writes the steps. Slower to start, fewer questions and send-backs.', keys: kbd('E', `prep #${c.id}`) };
      return { title: 'Prep board', sub: 'Drop a ticket here to plan it before a chef cooks it.', keys: '' };
    }
    case 'jar': {
      const always = (S.grants || []).includes(st.cls);
      if (c?.type === 'jar' && c.id === st.cls) return { title: `${st.def.name} jar`, sub: 'Carry it to a ticket or a chef and shake it on.', keys: kbd('E', 'put it back') };
      return { eyebrow: always ? 'Granted to every chef this shift' : 'Spice rack', title: `${st.def.name} jar`, sub: `Pre-grants ${st.def.what}, so the chef never stops to ask.`, keys: c ? '' : kbd('E', 'pick it up') };
    }
    case 'oven': {
      const { orders } = stationState(st), on = !!S.rules?.autoRefire;
      return { eyebrow: orders.length ? `Testing ${orders.map(o => `#${o.id}`).join(', ')} with ${esc(S.testCmd || 'the tests')}` : 'The oven runs the tests', title: `Re-fire once on fail: ${on ? 'ON' : 'OFF'}`, sub: on ? 'A failing plate goes straight back to its chef once, with the test output, at no penalty.' : 'Failing plates come to the pass burnt, for you to send back.', keys: kbd('E', 'flip the lever') };
    }
    case 'pass': {
      const { order: o } = stationState(st);
      if (!o) return { title: 'The pass', sub: 'Plates arrive here on their own once the oven is done.', keys: '' };
      const look = plateLook(o);
      const facts = [
        o.tests ? `<span class="chip2 ${o.tests.ok ? 'ok' : 'bad'}">tests ${o.tests.ok ? 'pass' : 'fail'}</span>` : '',
        o.diff?.stat ? `<span class="chip2">${o.diff.stat.files} files +${o.diff.stat.added} −${o.diff.stat.removed}</span>` : '',
        look.cold ? `<span class="chip2 cold">cold: conflicts in ${esc((o.merge.conflicts || []).join(', ') || 'main')}</span>` : o.merge ? '<span class="chip2 ok">merges clean</span>' : '',
        look.approved ? '<span class="chip2 gold">approved</span>' : '',
      ].join('');
      const keys = c ? kbd('Q', 'hands full') : look.approved ? kbd('E', 'carry to the hatch') + kbd('R', 'look again') : kbd('E', 'review');
      return { tone: look.cold ? 'cold' : look.burnt ? 'bad' : '', eyebrow: `#${o.id} · cooked by ${chefName(o.chefId)} · ${stateWords(o)}`, title: o.title, extra: facts + overlapsOf(o), keys };
    }
    case 'hatch': {
      if (c?.type !== 'plate') return { title: `Hatch to ${S.mainBranch || 'main'}`, sub: 'Carry an approved plate here to merge it. You choose the order.', keys: '' };
      const o = orderOf(c.id), look = plateLook(o), blind = !diffSeen(o);
      return { tone: look.cold ? 'cold' : '', eyebrow: `Ship #${o.id} to ${S.mainBranch || 'main'}`, title: o.title, sub: look.cold ? 'This plate went cold: main moved under it. Shipping will spoil it and send it back.' : blind ? 'Blind ship: you have not seen the whole diff, so no bonus.' : 'Seen and approved.', keys: kbd('E', 'ship it') };
    }
    case 'bin':
      if (!c || c.type === 'jar') return { title: 'Bin', sub: 'Carry a ticket or plate here to throw the order away.', keys: '' };
      return { tone: 'bad', title: `Bin #${c.id}?`, sub: 'Stops its chef and deletes its branch.', keys: kbd('E', local.binConfirm?.id === c.id ? 'press again to confirm' : 'bin it') };
  }
  return null;
}
function wipHtml() {
  const w = ui.wip;
  if (!w) return '<div class="wip"><div class="file">Tasting…</div></div>';
  if (w.error) return '<div class="wip"><div class="file">Nothing to taste yet.</div></div>';
  const stat = w.stat ? `${w.stat.files} files, +${w.stat.added} −${w.stat.removed}` : 'work in progress';
  return `<div class="wip"><div class="file">Live diff · ${esc(stat)}</div>${w.patch ? diffLines(w.patch, 60) : '<div class="ln">No changes on disk yet.</div>'}</div>`;
}
function diffLines(patch, max = 1e9) {
  const out = [];
  for (const l of patch.split('\n')) {
    if (out.length >= max) { out.push('<div class="ln hh">…</div>'); break; }
    if (l.startsWith('diff --git')) { out.push(`<div class="file">${esc(l.replace(/^diff --git a\/(.*) b\/.*/, '$1'))}</div>`); continue; }
    if (/^(index |--- |\+\+\+ |new file|deleted file|similarity|rename |\\ No newline)/.test(l)) continue;
    out.push(`<div class="ln ${l.startsWith('@@') ? 'hh' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : ''}">${esc(l) || ' '}</div>`);
  }
  return out.join('');
}

let cardHtml = '', sheetHtml = '';
const idleCard = () => {
  const c = player.carry;
  if (c) return `<div class="row1"><b>Carrying ${c.type === 'jar' ? `the ${esc(JARS.find(j => j.cls === c.id)?.name)} jar` : `${c.type} #${c.id}`}</b><span class="keys">${kbd('Q', 'put it back')}</span></div>`;
  return `<div class="keys idle">${kbd('WASD', 'or click to walk')}${kbd('E', 'use')}${kbd('Shift', 'dash')}${kbd('Tab', 'most urgent')}${kbd('?', 'help')}</div>`;
};
export function frame(near) {
  const S = G.S;
  // tasting follows your feet: step away and the lid goes back on
  if (ui.taste && near?.id !== ui.taste) { ui.taste = null; ui.wip = null; }
  if (ui.taste) {
    const o = stationState(near).order;
    if (!o || o.state !== 'cooking') { ui.taste = null; ui.wip = null; }
    else if (performance.now() - ui.wipAt > 1500) {
      ui.wipAt = performance.now();
      getJson(`/api/orders/${o.id}/wip`).then(w => { if (ui.taste) ui.wip = w; }, () => { if (ui.taste) ui.wip = { error: true }; });
    }
  }
  if (ui.input && (!near || near.type !== 'chef')) closeInput();
  if (ui.binChef && near?.type !== 'chef') ui.binChef = null;

  let d = null;
  ui.sheet = false;
  if (near) {
    d = describe(near);
    if (near.type === 'chef') { const { question: q, chef } = stationState(near); if (q) bubble(near, q, chef); }
  }
  const html = d ? `<div class="row1">${d.eyebrow ? `<small>${esc(d.eyebrow)}</small>` : ''}<b>${esc(d.title || '')}</b></div>${d.sub ? `<p>${esc(String(d.sub).slice(0, 220))}</p>` : ''}${d.extra ? `<div class="facts">${d.extra}</div>` : ''}${d.keys ? `<div class="keys">${d.keys}</div>` : ''}` : idleCard();
  const cls = `card ${d?.tone || ''} ${d?.wide ? 'wide' : ''} ${d ? '' : 'quiet'}`;
  if (html !== cardHtml) { $('cardBody').innerHTML = html; cardHtml = html; }
  if ($('card').className !== cls) $('card').className = cls;
  if ($('qsheet').hidden === ui.sheet) { $('qsheet').hidden = !ui.sheet; document.body.classList.toggle('asking', ui.sheet); if (!ui.sheet) sheetHtml = ''; }

  // the review panel closes itself when you walk off or the plate leaves the pass
  if (ui.review) {
    const o = orderOf(ui.review);
    if (!o || o.state !== 'at_pass' || (!ui.reviewRemote && near?.type !== 'pass')) closeReview(); else syncReview(o);
  }
  if (!S) return;
}

/* ======================= review, docked on the right while the kitchen keeps running ======================= */
export async function openReview(id, { remote = false } = {}) {
  const o = orderOf(id); if (!o) return;
  if (ui.board) setBoard(false);
  ui.review = id; ui.reviewRemote = remote; ui.cur = 0; ui.hunks = 0;
  $('review').classList.add('open'); $('stage').classList.add('docked'); redock();
  $('rEyebrow').textContent = `#${o.id} · cooked by ${chefName(o.chefId)} · round ${o.rounds + 1}`;
  $('rTitle').textContent = o.title;
  $('rSummary').textContent = o.summary || '(no summary)';
  $('rComment').value = '';
  $('rDiff').innerHTML = '<div class="file">Loading the diff…</div>';
  $('rDiff').scrollTop = 0;
  syncReview(o);
  emit('sfx', 'open');
  try {
    const d = await getJson(kpath(`/api/orders/${id}/diff`));
    if (ui.review !== id) return;
    const { html, hunks } = renderDiff(d.patch);
    $('rDiff').innerHTML = html; ui.hunks = hunks;
    const key = seenKey(o);
    if (!seen.has(key)) seen.set(key, { total: hunks, seen: new Set() });
    seen.get(key).total = hunks;
    setHunk(0, false); markSeen();
  } catch { $('rDiff').innerHTML = '<div class="file">Could not load the diff.</div>'; }
}
/** The panel docks on the right, or as a sheet across the bottom on an upright phone; the kitchen fits into what is left. */
export function redock() {
  $('stage').classList.toggle('docked', !!ui.review || ui.board);
  if (!ui.review && !ui.board) return setDock(0, 0);
  const m = document.body.dataset.layout;
  if (m === 'portrait') setDock(0, ui.board ? 0.66 : 0.6); else setDock(ui.board || m === 'landscape' ? 0.5 : 0.44, 0);
}
export function closeReview() {
  if (!ui.review) return;
  ui.review = null; ui.reviewRemote = false; $('review').classList.remove('open'); redock();
  if (document.activeElement === $('rComment')) $('rComment').blur();
}
function syncReview(o) {
  const look = plateLook(o), meta = [];
  if (o.tests) meta.push(`<span class="chip2 ${o.tests.ok ? 'ok' : 'bad'}">tests ${o.tests.ok ? 'pass' : 'fail'} · ${(o.tests.ms / 1000).toFixed(1)}s</span>`);
  if (o.diff?.stat) meta.push(`<span class="chip2">${o.diff.stat.files} files, +${o.diff.stat.added} −${o.diff.stat.removed}</span>`);
  if (look.cold) meta.push(`<span class="chip2 cold">cold: conflicts with main in ${esc((o.merge.conflicts || []).join(', ') || 'some files')}</span>`);
  else if (o.merge) meta.push('<span class="chip2 ok">merges clean</span>');
  else if (o.behind) meta.push(`<span class="chip2 warn">${o.behind} behind ${esc(G.S.mainBranch)}</span>`);
  if (o.refires) meta.push(`<span class="chip2 warn">re-fired ${o.refires}×</span>`);
  if (o.feedback?.length) meta.push(`<span class="chip2">last note: “${esc(o.feedback.at(-1).comment.slice(0, 80))}”</span>`);
  if (o.costUsd) meta.push(`<span class="chip2">$${o.costUsd.toFixed(2)}</span>`);
  const html = meta.join('') + (G.S.overlaps || []).filter(([a, b]) => a === o.id || b === o.id).map(([a, b, f, cf]) => (cf || []).length ? `<span class="chip2 bad">conflicts with #${a === o.id ? b : a} in ${esc(cf.join(', '))}</span>` : `<span class="chip2 warn">shares ${esc((f || []).join(', '))} with #${a === o.id ? b : a}</span>`).join('');
  if ($('rMeta').innerHTML !== html) $('rMeta').innerHTML = html;
  const tests = o.tests?.output || 'No test run.';
  if ($('rTests').textContent !== tests) { $('rTests').textContent = tests; $('rTestsBox').open = !!(o.tests && !o.tests.ok); $('rTestsLabel').textContent = o.tests ? `Test output (${o.tests.ok ? 'pass' : 'fail'})` : 'Tests'; }
  const s = seen.get(seenKey(o)), n = s ? s.seen.size : 0, total = s?.total ?? 0;
  $('rSeen').textContent = total ? `${n}/${total} hunks seen` : 'no hunks';
  $('rSeen').classList.toggle('all', !total || n >= total);
  $('rApprove').innerHTML = o.approved ? 'Approved' : `<kbd>Enter</kbd> ${look.burnt ? 'Approve anyway' : 'Approve'}${total && n < total ? '<span class="blind"> (blind)</span>' : ''}`;
  $('rApprove').disabled = !!o.approved;
  $('rCold').hidden = true;
  $('rColdNote').hidden = !look.cold;
  // a visiting teammate approves; sending back and binning are the owner's
  for (const id of ['rBack', 'rBin', 'rComment']) if ($(id).hidden !== !!G.visit) $(id).hidden = !!G.visit;
  $('rBack').textContent = look.cold ? 'Send back to merge main' : 'Send back';
  const byTouch = document.body.classList.contains('touch');
  $('rComment').placeholder = look.cold ? 'Cold plate: no note needed' : byTouch ? 'What to fix, then Send back' : 'B: write what to fix, then Enter sends it back';
}
function renderDiff(patch) {
  if (!patch) return { html: '<div class="file">No changes. The chef did not change any files. Send it back with what you expected.</div>', hunks: 0 };
  let html = '', hunks = 0, open = false;
  for (const l of patch.split('\n')) {
    if (l.startsWith('diff --git')) { if (open) { html += '</div>'; open = false; } html += `<div class="file">${esc(l.replace(/^diff --git a\/(.*) b\/.*/, '$1'))}</div>`; continue; }
    if (/^(index |--- |\+\+\+ |new file|deleted file|similarity|rename |\\ No newline)/.test(l)) continue;
    if (l.startsWith('@@')) { if (open) html += '</div>'; html += `<div class="hunk" data-h="${hunks++}"><div class="ln hh">${esc(l)}</div>`; open = true; continue; }
    if (!open) continue;
    html += `<div class="ln ${l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : ''}">${esc(l) || ' '}</div>`;
  }
  if (open) html += '</div>';
  return { html, hunks };
}
function markSeen(force = null) {
  const o = orderOf(ui.review); if (!o) return;
  const s = seen.get(seenKey(o)); if (!s) return;
  const box = $('rDiff'), top = box.scrollTop, bottom = top + box.clientHeight;
  for (const el of box.querySelectorAll('.hunk')) {
    const i = Number(el.dataset.h);
    if (i === force || (el.offsetTop >= top - 4 && el.offsetTop + el.offsetHeight <= bottom + 4)) { s.seen.add(i); el.classList.add('seen'); }
  }
}
function setHunk(i, deliberate = true) {
  const els = $('rDiff').querySelectorAll('.hunk'); if (!els.length) return;
  // stepping on from a change counts as having read it, however little of it a small screen could show at once
  if (deliberate && i !== ui.cur) markSeen(ui.cur);
  ui.cur = Math.max(0, Math.min(els.length - 1, i));
  els.forEach((el, k) => el.classList.toggle('cur', k === ui.cur));
  const el = els[ui.cur];
  $('rDiff').scrollTop = Math.max(0, el.offsetTop - 34);
  markSeen(deliberate ? ui.cur : null);
}
$('rDiff').addEventListener('scroll', () => markSeen());
// a sideways swipe across the diff is J or K
let swipe = null;
$('rDiff').addEventListener('touchstart', e => { const t = e.touches[0]; swipe = { x: t.clientX, y: t.clientY }; }, { passive: true });
$('rDiff').addEventListener('touchend', e => {
  if (!swipe) return;
  const t = e.changedTouches[0], dx = t.clientX - swipe.x, dy = t.clientY - swipe.y; swipe = null;
  if (Math.abs(dx) > 60 && Math.abs(dy) < 40) setHunk(ui.cur + (dx < 0 ? 1 : -1));
}, { passive: true });
export async function approve() {
  const o = orderOf(ui.review); if (!o || o.approved) return;
  try {
    await api(kpath(`/api/orders/${o.id}/review`), { verdict: 'approve' });
    emit('sfx', 'approve'); const seenIt = diffSeen(o);
    closeReview();
    // once the kitchen has slid back to full size, so the word lands on the plate
    setTimeout(() => popup(seenIt ? 'Approved' : 'Approved blind', orderPos(o), seenIt ? 'good' : 'warn'), 450);
  } catch { /* toasted */ }
}
export async function sendBack() {
  const o = orderOf(ui.review); if (!o || G.visit) return;
  const comment = $('rComment').value.trim();
  // a cold plate needs no note: the chef just merges main
  if (!comment && o.merge?.clean !== false) { toast('Write what the chef should fix', 'bad'); $('rComment').focus(); return; }
  try { await api(`/api/orders/${o.id}/review`, { verdict: 'send_back', comment }); emit('sfx', 'back'); closeReview(); } catch { /* toasted */ }
}
/** Keys while the panel is open. Returns true when it used the key. */
export function reviewKey(e) {
  if (!ui.review) return false;
  switch (e.code) {
    case 'KeyJ': setHunk(ui.cur + 1); return true;
    case 'KeyK': setHunk(ui.cur - 1); return true;
    case 'Enter': approve(); return true;
    case 'KeyB': if (!G.visit) $('rComment').focus(); return true;
    case 'Escape': closeReview(); return true;
  }
  return false;
}
$('rComment').addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.stopPropagation(); $('rComment').blur(); }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBack(); }
});
$('rApprove').onclick = approve;
$('rBack').onclick = sendBack;
$('rClose').onclick = closeReview;
$('rCold').onclick = sendBack;
$('rBin').onclick = async () => {
  if (G.visit) return;
  if ($('rBin').dataset.arm !== '1') { $('rBin').dataset.arm = '1'; $('rBin').textContent = 'Really bin it?'; setTimeout(() => { $('rBin').dataset.arm = ''; $('rBin').textContent = 'Bin the order'; }, 3000); return; }
  const id = ui.review; closeReview();
  try { await api(`/api/orders/${id}/bin`); } catch { /* toasted */ }
};

/* ======================= the board: this kitchen's orders, wired to this kitchen's API ======================= */
const send = (path, body) => api(path, body).catch(() => { /* api already toasted */ });
/** What a card on your own kitchen's board can do. The town's chalkboard draws the same board with the same actions. */
export const boardActions = {
  close: () => setBoard(false),
  newOrder: () => $('newOrderBtn').click(),
  shift: (start, mins) => send(start ? '/api/shift/start' : '/api/shift/stop', start ? mins : {}),
  plan: o => send(`/api/orders/${o.id}/plan`),
  assign: (o, chefId) => { emit('sfx', 'drop'); const ch = chefChar(chefId); if (ch) kick(ch, 0.35); return send(`/api/orders/${o.id}/assign`, { chefId }); },
  resume: o => send(`/api/orders/${o.id}/resume`),
  bin: o => { emit('sfx', 'back'); return send(`/api/orders/${o.id}/bin`); },
  steer: (o, note) => api(`/api/orders/${o.id}/steer`, { note }).then(() => { emit('sfx', 'shout'); if (atHome()) popup('Heard, chef!', orderPos(o), 'good'); }, () => {}),
  answer: (q, body) => { emit('sfx', body.allow ? 'yes' : 'no'); const ch = chefChar(q.chefId); if (ch) kick(ch, 0.4); return send(`/api/questions/${q.id}/answer`, body); },
  review: o => (atHome() ? openReview(o.id, { remote: true }) : toast('A review happens at your own pass. Go home first')),
  ship: o => send(`/api/orders/${o.id}/ship`, { seen: diffSeen(o) }),
};
export const board = createBoard($('board'), boardActions, { now: nowS });
export function setBoard(open) {
  if (open === ui.board) return;
  if (open) closeReview();
  ui.board = open;
  $('board').classList.toggle('open', open);
  $('boardBtn').setAttribute('aria-pressed', String(open));
  redock();
  if (open) { board.render(G.own || G.S); emit('sfx', 'open'); } else if ($('board').contains(document.activeElement)) document.activeElement.blur();
}
$('boardBtn').onclick = () => setBoard(!ui.board);

/* ======================= shift report ======================= */
let lastReport = '';
/** The big line across the room when a plate reaches main. */
let bannerFree = 0;
export function banner(big, small = '', cls = '') {
  fx.banners++;
  // one at a time: a second banner waits for the first to finish instead of wiping it out
  const wait = Math.max(0, bannerFree - performance.now());
  bannerFree = performance.now() + wait + 2300;
  setTimeout(() => {
    const el = document.createElement('div'); el.className = `banner ${cls}`;
    el.innerHTML = `<b>${esc(big)}</b>${small ? `<i>${esc(small)}</i>` : ''}`;
    $('banners').replaceChildren(el);
    setTimeout(() => el.remove(), 2500);
  }, wait);
}
function countUp(el, to, ms = 900) {
  const t0 = performance.now(), sign = to > 0 ? '+' : '';
  const tick = () => { const f = Math.min(1, (performance.now() - t0) / ms), e = 1 - (1 - f) ** 3; el.textContent = `${sign}${Math.round(to * e)}`; if (f < 1) requestAnimationFrame(tick); };
  tick();
}
export function maybeReport() {
  const S = G.own || G.S, sh = S.shift;
  // keyed on when the shift started, so a kitchen that is reset and plays "shift 1" again still gets its report
  const key = sh.report ? `${sh.report.shift}:${sh.startedAt}` : '';
  if (sh.mode !== 'break' || !sh.report || key === lastReport) return;
  lastReport = key;
  const r = sh.report;
  const stars = r.stars ?? (r.shipped >= 2 && !r.burntShipped && r.blockedMs < escalation().fireMs ? 3 : r.shipped >= 1 ? 2 : 1);
  const advice = r.advice ?? (r.blockedMs > escalation().fireMs ? `Your chefs waited ${mmss(r.blockedMs)} on you. Prep big tickets and shake a jar on them so they ask less.`
    : r.burntShipped ? 'A burnt plate went out. Flip the oven lever so failing plates re-fire on their own.'
    : r.sentBack > 1 ? 'Several plates went back. Prep tickets first, and call out early when a chef drifts.'
    : r.shipped ? 'Clean shift. Run more chefs at once next time.' : 'Nothing shipped. Hand out small tickets first to get the line moving.');
  const arc = arcade(), main = S.mainBranch || 'main';
  $('repKicker').textContent = `Shift ${r.shift} is over`;
  $('repTitle').textContent = ['', 'Rough service', 'Good service', 'Clean service!'][stars] || 'Shift report';
  $('repStars').innerHTML = [1, 2, 3].map(i => `<span class="${i <= stars ? 'on' : ''}" style="--i:${i}">${ICON.star}</span>`).join('');
  $('repStars').setAttribute('aria-label', `${stars} of 3 stars`);
  $('repLine').textContent = r.shipped ? `${r.shipped} change${r.shipped === 1 ? '' : 's'} merged into ${main}, ${r.firstTime} of them right first time.` : `Nothing reached ${main} this shift.`;
  $('repAdvice').innerHTML = `<b>Next time</b>${esc(advice)}`;
  const stat = (v, l, cls = '') => `<div class="stat ${cls}"><b>${v}</b><small>${l}</small></div>`;
  $('repBody').innerHTML = [
    stat('0', 'points', 'pts'), stat(r.shipped, 'shipped', r.shipped ? 'good' : ''), stat(r.firstTime, 'right first time', r.firstTime ? 'good' : ''),
    stat(mmss(r.blockedMs), 'chefs kept waiting', r.blockedPenalty > 10 ? 'bad' : ''), stat(r.sentBack, 'sent back'), stat(r.conflicts, 'spoiled', r.conflicts ? 'bad' : ''),
  ].join('');
  $('repFoot').textContent = [`${r.blindShips ?? 0} blind ship${r.blindShips === 1 ? '' : 's'}`, `${r.steers ?? 0} call-out${r.steers === 1 ? '' : 's'}`, `${r.refires ?? 0} re-fire${r.refires === 1 ? '' : 's'}`, `$${(r.costUsd || 0).toFixed(2)} spent`].join(' · ');
  $('repAgain').hidden = !arc;
  $('repClose').textContent = arc ? 'Keep cooking' : 'Run the pass';
  $('repClose').className = arc ? 'btn ghost' : 'btn';
  $('reportDialog').showModal();
  (arc ? $('repAgain') : $('repClose')).focus();
  countUp($('repBody').querySelector('.pts b'), r.score);
  emit('report', stars);
}
$('repClose').onclick = () => $('reportDialog').close();
$('repAgain').onclick = () => { $('reportDialog').close(); emit('again'); };
