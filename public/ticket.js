// The debug ticket view (NFR-10): the kitchen as plain lists over the same WebSocket protocol, no art.
import { PROTOCOL, STATION_LABEL } from '/shared/protocol.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const state = { welcome: null, building: null, floor: null, you: null, seq: 0, acks: new Map() };
window.__ticket = state;

const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
const send = (type, body = {}) => ws.send(JSON.stringify({ type, ...body }));
const act = (name, args = {}) => new Promise(resolve => { const seq = ++state.seq; state.acks.set(seq, resolve); send('action', { seq, name, args }); });
const log = text => { const d = document.createElement('div'); d.textContent = `${new Date().toLocaleTimeString()} ${text}`; $('log').prepend(d); };

ws.onopen = () => send('hello', { v: PROTOCOL, ...(localStorage.getItem('ticketToken') ? { token: localStorage.getItem('ticketToken') } : {}) });
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.type === 'welcome') { state.welcome = m; if (m.token) localStorage.setItem('ticketToken', m.token); if (m.floorId && state.floor?.id !== m.floorId) send('subscribe', { floorId: m.floorId }); }
  else if (m.type === 'building') state.building = m;
  else if (m.type === 'floor') { state.floor = m.floor; state.you = m.you; }
  else if (m.type === 'ack') { state.acks.get(m.seq)?.(m); state.acks.delete(m.seq); if (!m.ok) log(`refused: ${m.code} ${m.message}`); }
  else if (m.type === 'notify') log(`${m.kind}: ${m.text}`);
  else if (m.type === 'error') log(`error ${m.code}: ${m.message}`);
  render();
};

function button(label, onClick, test) {
  const b = document.createElement('button');
  b.textContent = label;
  if (test) b.dataset.test = test;
  b.onclick = onClick;
  return b;
}

function render() {
  const top = $('top');
  top.replaceChildren();
  const w = state.welcome;
  top.append(Object.assign(document.createElement('span'), { textContent: w ? `${w.name} · ${w.role}` : 'connecting…' }));
  for (const r of ['spectator', 'player', 'judge']) top.append(button(r, () => send('chooseRole', { role: r }), `role-${r}`));
  top.append(button('New Demo floor', () => send('createFloor', { mode: 'demo' }), 'create-demo'));
  top.append(button('New Live floor', () => send('createFloor', { mode: 'live' }), 'create-live'));
  for (const fl of state.building?.floors || []) top.append(button(`Watch No. ${fl.number} ${fl.name}`, () => send('subscribe', { floorId: fl.id }), `watch-${fl.number}`));
  const f = state.floor;
  const root = $('state');
  root.replaceChildren();
  if (!f) return;
  const can = state.you?.canAct;
  const sec = (title, test) => { const s = document.createElement('section'); s.dataset.test = test; s.innerHTML = `<h2>${esc(title)}</h2>`; root.append(s); return s; };
  const row = (parent, html) => { const d = document.createElement('div'); d.className = 'row'; d.innerHTML = html; parent.append(d); return d; };
  const actBtn = (parent, label, name, args, test) => { if (can) parent.append(button(label, () => act(name, args), test)); };

  const head = sec(`No. ${f.number} · ${f.name}`, 'head');
  row(head, `<b>${f.mode.toUpperCase()}</b> · ${esc(f.modelLabel)} · $${f.budget.spentUsd.toFixed(4)} of $${f.budget.capUsd} ${f.budget.blocked ? '<span class="bad">budget spent</span>' : ''}`);
  row(head, `Score <b data-test="score">${f.score}</b> · shipped ${f.stats.shipped} · phase <b data-test="phase">${f.phase}</b> · shift ${f.shift.status} · watchers ${f.watchers} ${can ? '' : '· <b>View only</b>'}`);
  const ctl = row(head, '');
  if (f.breakEligible) actBtn(ctl, 'Take a break', 'startBreak', {}, 'break');
  if (f.phase !== 'working') actBtn(ctl, 'Back to work', 'endBreak', {}, 'endbreak');
  actBtn(ctl, f.mode === 'live' ? 'Switch to Demo' : 'Switch to Live', 'setMode', { mode: f.mode === 'live' ? 'demo' : 'live' }, 'mode');
  actBtn(ctl, 'Close up', 'closeShift', {}, 'close');
  actBtn(ctl, 'Play again', 'playAgain', {}, 'again');
  if (f.shift.report) row(head, `<pre data-test="report">${esc(JSON.stringify(f.shift.report, null, 1))}</pre>`);

  const line = sec(`Customer line (${f.line.length})`, 'line');
  for (const c of f.line) {
    const r = row(line, `<b>${esc(c.name)}</b> <span class="tag">${esc(c.order.source)}</span> <span class="tag">${c.order.size} · ${'★'.repeat(c.order.difficulty)}</span><br>${esc(c.order.title)}`);
    actBtn(r, 'Seat', 'seat', { customerId: c.id }, `seat-${c.id}`);
  }

  const tables = sec('Tables', 'tables');
  f.tables.forEach((c, i) => {
    if (!c) return row(tables, `Table ${i + 1}: empty`);
    const items = c.order.itemIds.map(id => f.items[id]).filter(Boolean);
    const r = row(tables, `Table ${i + 1}: <b>${esc(c.name)}</b> · <span data-test="cstatus-${c.id}">${c.status}</span>${c.patience ? ` · patience lost ${c.patience.lost}` : ''}<br>${esc(c.order.title)}
      ${items.map(it => `<div>· <span class="tag">${STATION_LABEL[it.station]}</span> ${esc(it.prompt)} <i>${it.status}</i>${it.redoCount ? ` (redo ${it.redoCount})` : ''}</div>`).join('')}
      ${c.feedback ? `<div class="${c.feedback.satisfied ? 'good' : 'bad'}">Feedback round ${c.feedbackRound}: ${'★'.repeat(c.feedback.score)} ${esc(c.feedback.comments)}</div>` : ''}
      ${c.receipt ? `<div class="good">SHIPPED · ${c.receipt.points} points</div>` : ''}`);
    const drafts = items.filter(it => it.status === 'draft');
    if (['seated', 'waiting_food', 'awaiting_player'].includes(c.status)) {
      actBtn(r, 'Add quick picks', 'saveItems', { customerId: c.id, items: [...drafts.map(d => ({ id: d.id, prompt: d.prompt, station: d.station, quickPickId: d.quickPickId, typed: d.typed })), ...c.order.quickPicks.filter(q => !items.some(it => it.quickPickId === q.id)).map(q => ({ prompt: q.prompt, station: q.station, quickPickId: q.id }))].slice(0, 5) }, `picks-${c.id}`);
      if (drafts.length) actBtn(r, 'Send to kitchen', 'sendItems', { customerId: c.id }, `send-${c.id}`);
      if (Object.values(f.meals).some(m => m.orderId === c.order.id && f.items[m.itemId]?.status === 'approved')) actBtn(r, 'Serve', 'serveOrder', { customerId: c.id, note: f.chips.serve[0] }, `serve-${c.id}`);
    }
    if (c.feedback && !c.feedbackRead) actBtn(r, 'Read feedback', 'readFeedback', { customerId: c.id }, `read-${c.id}`);
    if (c.status === 'awaiting_player') { actBtn(r, 'More work', 'moreWork', { customerId: c.id }, `more-${c.id}`); actBtn(r, 'Bring the bill', 'giveBill', { customerId: c.id }, `bill-${c.id}`); }
  });

  const kitchen = sec('Rail and Chefs', 'kitchen');
  row(kitchen, `Rail: ${f.readyQueue.map(id => esc(f.items[id]?.prompt?.slice(0, 30))).join(' → ') || 'empty'}`);
  for (const ch of f.chefs) row(kitchen, `<b>${esc(ch.name)}</b> (${esc(ch.modelLabel)}) <span data-test="chef-${ch.id}">${ch.status}</span> ${ch.station ? `at ${STATION_LABEL[ch.station]}` : ''} ${ch.thought ? `· ${esc(ch.thought)}` : ''}`);

  const pass = sec(`Pass (${f.pass.length})`, 'pass');
  for (const id of f.pass) {
    const m = f.meals[id], it = f.items[m.itemId];
    const r = row(pass, `<b>${esc(m.changedFiles.join(', '))}</b> <i>${it?.status}</i> ${m.setMenu ? '<span class="tag">set menu</span>' : ''} · hunks seen ${m.hunksSeen} of ${m.hunks.length}${m.patience ? ` · patience lost ${m.patience.lost}` : ''}<br>${esc(m.summary)}<pre>${esc(m.hunks.map(h => h.lines.map(l => l.t + l.text).join('\n')).join('\n\n'))}</pre>`);
    if (can) r.append(button('Sample every hunk', async () => { await act('sampleMeal', { mealId: id }); for (let h = 1; h < m.hunks.length; h++) await act('seeHunk', { mealId: id, index: h }); }, `sample-${id}`));
    actBtn(r, 'Approve', 'approveMeal', { mealId: id }, `approve-${id}`);
    actBtn(r, `Send back: ${f.chips.redo[1]}`, 'redoMeal', { mealId: id, reason: f.chips.redo[1] }, `redo-${id}`);
  }
}
render();
