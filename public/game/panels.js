// Panels that look like the things they are: a ticket docket, an order pad, a plate, a feedback card, a receipt.
// Plus the HUD, the start screen, the staff room (breaks and the bell) and the end-of-night till report.
import { $, G, esc, mmss, nowS, api, getJson, toast, emit, ICON, modelName, customerById, itemById, chefById, stationName, STATION, watching, store } from './core.js';
import { setDock } from './scene.js';

export const ui = { spec: null, mode: null, cid: null, itemId: null, station: null, key: '', pad: [], padKey: '', seen: new Map(), wipAt: 0, wip: null, plateKey: '' };
const panel = $('panel'), pBody = $('pBody');
for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = ICON[el.dataset.icon] || '';

const STRICT = { 1: 'Relaxed', 2: 'Fair', 3: 'Strict' };
const DIFF = { S: 'Small', M: 'Medium', L: 'Large' };
const stationChip = id => `<span class="stamp" style="--c:${STATION.find(s => s.id === id)?.color || '#888'}">${esc(stationName(id))}</span>`;
const patienceBar = v => `<div class="pbar ${v < 0.25 ? 'late' : v < 0.55 ? 'warn' : ''}"><i style="width:${Math.round(v * 100)}%"></i></div>`;
const itemsOf = c => G.S.items.filter(i => i.customerId === c.id && i.state !== 'binned');
const stateWord = it => ({ ready: 'on the rail', cooking: it.chefId ? `cooking · ${chefById(it.chefId)?.name || ''}` : 'cooking', plated: it.tests?.ok === false ? 'on the counter · tests fail' : 'on the counter', serving: 'being served', served: 'served', stalled: 'stalled', binned: 'binned' }[it.state] || it.state);
const busy = new Set();
async function act(key, fn) { if (busy.has(key)) return; busy.add(key); try { return await fn(); } catch { /* api toasted */ } finally { busy.delete(key); } }

/* ======================= opening and closing ======================= */
export const panelIsOpen = () => !!ui.mode;
export function closePanel() {
  if (!ui.mode) return;
  ui.mode = null; ui.spec = null; ui.key = ''; ui.padKey = ''; ui.plateKey = '';
  panel.classList.remove('open'); document.body.classList.remove('paneled'); setDock(0);
}
function show(mode, extra = {}) {
  Object.assign(ui, { mode, key: '', padKey: '', plateKey: '' }, extra);
  panel.classList.add('open'); document.body.classList.add('paneled');
  setDock(innerWidth > innerHeight && innerWidth > 700 ? 0.42 : 0);
  pBody.scrollTop = 0;
  emit('sfx', 'open');
  renderPanel(true);
}

/** Opens what a spec names: 'door', 'line:3', 'table:1', 'counter', 'rail', 'station:backend'. */
export function openSpec(spec) {
  const S = G.S; if (!S) return;
  ui.spec = spec;
  if (spec === 'door' || spec.startsWith('line:')) {
    const line = S.customers.filter(c => c.state === 'in_line').sort((a, b) => a.lineOrder - b.lineOrder);
    const c = spec === 'door' ? line[0] : customerById(spec.slice(5));
    if (!c) return toast('Nobody is waiting outside');
    return show('docket', { cid: c.id });
  }
  if (spec.startsWith('table:')) {
    const t = S.tables.find(x => x.id === Number(spec.slice(6)));
    if (t?.reserved) return toast('That table is reserved: two tables keep the demo short');
    const c = t?.customerId ? customerById(t.customerId) : null;
    if (!c) return toast('A free table. Tap someone in the line to seat them');
    if (watching()) return show('table', { cid: c.id });
    if (c.state === 'feedback_ready') { api(`/api/customers/${c.id}/ack`).catch(() => {}); return show('feedback', { cid: c.id }); }
    if (c.state === 'seated' && !itemsOf(c).length) return openPad(c);
    return show('table', { cid: c.id });
  }
  if (spec === 'counter') {
    if (!S.counter.length) return toast('Nothing on the counter yet');
    return show('plate', { itemId: S.counter[0] });
  }
  if (spec === 'rail') return show('rail');
  if (spec.startsWith('station:')) return show('peek', { station: spec.slice(8), wip: null, wipAt: 0 });
}

function openPad(c) {
  // start the pad with the first special nobody has ordered yet, so a first-timer only has to press Send
  const ordered = new Set(itemsOf(c).map(i => i.presetId).filter(Boolean));
  const fresh = c.presets.filter(p => !ordered.has(p.id));
  const sug = (c.suggestions || []).filter(m => !itemsOf(c).some(i => i.prompt === m.prompt && i.state !== 'binned'));
  ui.pad = itemsOf(c).length === 0 && fresh[0] ? [{ station: fresh[0].station, prompt: fresh[0].prompt, presetId: fresh[0].id }] : [];
  if (!ui.pad.length && sug[0]) { const match = fresh.find(p => p.station === sug[0].station); ui.pad = [match ? { station: match.station, prompt: match.prompt, presetId: match.id } : { station: sug[0].station, prompt: sug[0].prompt, presetId: null }]; }
  show('pad', { cid: c.id });
}

/* ======================= rendering ======================= */
export function renderPanel(force = false) {
  if (!ui.mode || !G.S) return;
  const S = G.S;
  if (ui.mode === 'pad') return renderPad(force);
  if (ui.mode === 'plate') return renderPlate(force);
  let html = '';
  const c = ui.cid ? customerById(ui.cid) : null;
  switch (ui.mode) {
    case 'docket': {
      if (!c) return closePanel();
      if (c.state !== 'in_line') return closePanel();
      const free = S.tables.some(t => !t.reserved && !t.customerId);
      html = `<div class="docket paper torn">
        <div class="dk-top"><span class="issue">${esc(c.key)}</span>${c.labels.map(l => `<span class="lab">${esc(l)}</span>`).join('')}<span class="dif d${c.difficulty}">${DIFF[c.difficulty]}</span></div>
        <h2>${esc(c.title)}</h2>
        <div class="who"><span class="av" style="--c:${c.persona.color}">${esc(c.persona.name[0])}</span><span><b>${esc(c.persona.name)}</b><small>${esc(c.persona.role)} · ${STRICT[c.persona.strictness] || 'Fair'} reviewer</small></span></div>
        <p class="body">${esc(c.body)}</p>
        ${c.acceptance.length ? `<div class="acc"><small>Acceptance criteria</small><ul>${c.acceptance.map(a => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}
        <div class="pl"><small>Patience${c.draining ? ' · draining' : ''}</small>${patienceBar(c.patience)}</div>
      </div>
      <div class="actions">${watching() ? '' : `<button class="btn ship big" data-act="seat" ${free ? '' : 'disabled'}>${free ? 'Seat at a table' : 'No free table yet'}</button>`}<button class="btn ghost" data-act="close">Later</button></div>
      ${free || watching() ? '' : '<p class="note">Give a seated customer their bill to free a table.</p>'}`;
      break;
    }
    case 'feedback': case 'table': {
      if (!c) return closePanel();
      if (c.state === 'paid') { ui.mode = 'receipt'; return renderPanel(true); }
      const items = itemsOf(c), served = items.filter(i => i.state === 'served'), open = items.filter(i => ['ready', 'cooking', 'plated', 'stalled', 'serving'].includes(i.state));
      const r = c.reviews.at(-1);
      const fb = r ? `<div class="speech ${r.verdict}"><div class="stars-s">${[1, 2, 3, 4, 5].map(n => `<span class="${n <= r.satisfaction ? 'on' : ''}">${ICON.star}</span>`).join('')}</div>
          <p>“${esc(r.feedback)}”</p><small>${r.verdict === 'satisfied' ? 'Satisfied: ready for the bill' : 'Wants more'} · ${r.source === 'claude' ? 'reviewed by Claude' : 'scripted review'}${r.testsOk === false ? ' · tests fail on the table' : ''}</small></div>` : '';
      const list = items.length ? `<ul class="olist">${items.map(i => `<li class="${i.state}">${stationChip(i.station)}<span>${esc(i.prompt.slice(0, 90))}${i.prompt.length > 90 ? '…' : ''}</span><em>${esc(stateWord(i))}</em></li>`).join('')}</ul>` : '';
      const eating = c.state === 'eating';
      const canBill = served.length && !eating && c.state !== 'paying';
      html = `<div class="card2 paper">
        <div class="dk-top"><span class="issue">${esc(c.key)}</span><span class="tbl">Table ${c.tableId}</span></div>
        <h2>${esc(c.title)}</h2>
        <div class="who"><span class="av" style="--c:${c.persona.color}">${esc(c.persona.name[0])}</span><span><b>${esc(c.persona.name)}</b><small>${eating ? 'is tasting what you served…' : c.state === 'feedback_ready' || ui.mode === 'feedback' ? 'has feedback for you' : c.state === 'seated' ? 'is waiting for you to decide' : 'is waiting for the kitchen'}</small></span></div>
        ${eating ? '<div class="eating"><span class="spin"></span> Testing the work against the ticket…</div>' : fb}
        ${list}
        <div class="pl"><small>Patience${c.draining ? ' · draining' : ''}${c.furious ? ' · furious, no tip' : ''}</small>${patienceBar(c.patience)}</div>
      </div>
      ${watching() ? '' : `<div class="actions">
        <button class="btn" data-act="more">${r?.verdict === 'needs_more' ? 'Add what they asked for' : 'Add items'}</button>
        <button class="btn ship big" data-act="bill" ${canBill ? '' : 'disabled'}>Give the bill</button>
        <button class="btn ghost" data-act="close">Close</button></div>
      ${open.length && canBill ? `<p class="note">${open.length} item${open.length > 1 ? 's are' : ' is'} still in the kitchen. The bill bins ${open.length > 1 ? 'them' : 'it'}.</p>` : ''}
      ${!served.length ? '<p class="note">Serve at least one dish before the bill.</p>' : ''}`}`;
      break;
    }
    case 'receipt': {
      if (!c?.bill) return closePanel();
      const b = c.bill;
      html = `<div class="receipt"><div class="r-head">THE LITTLE WATTLE<br><small>${esc(G.S.name)}</small></div>
        <div class="r-line"><span>${esc(c.key)}</span><span>Table ${c.tableId}</span></div><div class="r-sep"></div>
        ${b.items.map(i => `<div class="r-item"><span>${esc(stationName(i.station))}${i.rounds ? ` ×${i.rounds + 1}` : ''}</span><span>${i.testsOk === false ? 'FAIL' : 'PASS'}${i.seen ? '' : ' (blind)'}</span></div><div class="r-desc">${esc(i.prompt.slice(0, 70))}</div>`).join('')}
        <div class="r-sep"></div>
        <div class="r-line"><span>Bill</span><span>${b.base}${b.streak > 1 ? ` ×${b.streak}` : ''} = ${b.points}</span></div>
        <div class="r-line"><span>Tip (${b.satisfaction}/5)</span><span>${b.tip}</span></div>
        <div class="r-line"><span>Waited on you</span><span>${mmss(b.waitedMs)}</span></div>
        <div class="r-sep"></div><div class="r-line r-total"><span>TOTAL</span><span>${b.total} pts</span></div>
        <div class="r-paid">PAID · merged <b>${esc(b.commit)}</b> into ${esc(G.S.mainBranch)}</div>
        <div class="r-foot">Thank you, come again!</div></div>
        <div class="actions"><button class="btn ship big" data-act="close">Next customer</button></div>`;
      break;
    }
    case 'rail': {
      const rail = S.rail.map(itemById).filter(Boolean);
      html = `<div class="card2 paper"><div class="dk-top"><span class="issue">Ticket rail</span><span class="tbl">${rail.length} waiting</span></div>
        <p class="note">Chefs take the oldest ticket whose station is free. One chef per station.</p>
        ${rail.length ? `<ul class="olist">${rail.map(i => `<li>${stationChip(i.station)}<span><b>${esc(customerById(i.customerId)?.key || '')}</b> ${esc(i.prompt.slice(0, 80))}</span>${watching() || i.priority ? '<em>next</em>' : `<button class="mini" data-act="remove" data-id="${i.id}">Remove</button>`}</li>`).join('')}</ul>` : '<p>No tickets waiting.</p>'}
        <div class="chefline">${S.chefs.map(ch => `<span class="chefpill" style="--c:${ch.color}"><b>${esc(ch.name)}</b> ${ch.state === 'idle' ? 'free' : ch.state === 'walking' ? 'walking' : `at ${esc(stationName(ch.stationId))}`}</span>`).join('')}</div></div>
        <div class="actions"><button class="btn ghost" data-act="close">Close</button></div>`;
      break;
    }
    case 'peek': {
      const st = S.stations.find(s => s.id === ui.station);
      const chef = st?.chefId ? chefById(st.chefId) : null;
      const it = chef?.itemId ? itemById(chef.itemId) : null;
      const q = chef ? S.questions.find(x => x.chefId === chef.id) : null;
      if (it && it.state === 'cooking' && performance.now() - ui.wipAt > 1500) {
        ui.wipAt = performance.now();
        getJson(`/api/items/${it.id}/wip`).then(w => { ui.wip = w; renderPanel(); }, () => {});
      }
      const feed = it ? `<ul class="feed">${it.activity.slice(-6).reverse().map(a => `<li class="${a.kind}">${esc(a.text)}</li>`).join('')}</ul>` : '';
      const wip = it && ui.wip?.patch ? `<div class="wip">${diffLines(ui.wip.patch, 50)}</div>` : '';
      const ask = q ? `<div class="ask"><b>${esc(chef.name)} needs you:</b> ${q.kind === 'question' ? esc(q.questions.map(x => x.question).join(' / ')) : esc(q.reason)}
        <div class="row">${q.kind === 'question' ? (q.questions[0]?.options || []).slice(0, 4).map((o, i) => `<button class="mini" data-act="answer" data-q="${q.id}" data-opt="${i}">${esc(o.label)}</button>`).join('') + `<button class="mini" data-act="answer" data-q="${q.id}" data-opt="x">Your call</button>` : `<button class="mini" data-act="answer" data-q="${q.id}" data-opt="yes">Allow</button><button class="mini" data-act="answer" data-q="${q.id}" data-opt="no">No</button>`}</div></div>` : '';
      html = `<div class="card2 steam"><div class="dk-top">${stationChip(ui.station)}<span class="tbl">${chef ? `${esc(chef.name)} · ${chef.driver === 'claude' ? esc(modelName(chef.model)) : 'practice chef'}` : 'nobody here'}</span></div>
        ${it ? `<h2>${esc(customerById(it.customerId)?.key || '')}: ${esc(it.prompt.slice(0, 110))}</h2><small class="meta">cooking for ${mmss(nowS() - (it.pickedAt || nowS()))}${it.rounds ? ` · round ${it.rounds + 1}` : ''}</small>${ask}${feed}${wip}` : `<p>No chef at this station. Chefs come here when a ${esc(stationName(ui.station))} ticket is on the rail.</p>`}</div>
        <div class="actions"><button class="btn ghost" data-act="close">Close</button></div>`;
      break;
    }
  }
  if (html !== ui.key) { pBody.innerHTML = html; ui.key = html; }
}

/* ---------- the order pad ---------- */
function renderPad(force) {
  const c = customerById(ui.cid);
  if (!c || !['seated', 'waiting_food', 'eating', 'feedback_ready'].includes(c.state)) return closePanel();
  const ordered = new Set(itemsOf(c).map(i => i.presetId).filter(Boolean));
  const onPad = new Set(ui.pad.map(l => l.presetId).filter(Boolean));
  const chips = c.presets.filter(p => !ordered.has(p.id) && !onPad.has(p.id));
  const sugg = (c.suggestions || []).filter(m => !c.presets.some(p => p.station === m.station && (ordered.has(p.id) || onPad.has(p.id))) && !ui.pad.some(l => l.prompt === m.prompt));
  const key = `${c.id}|${ui.pad.length}|${chips.map(p => p.id).join()}|${sugg.length}|${ui.pad.map(l => l.station + l.presetId).join()}`;
  const pb = pBody.querySelector('.pad-patience');
  if (pb) pb.innerHTML = patienceBar(c.patience);
  if (!force && key === ui.padKey) return;
  ui.padKey = key;
  const lines = ui.pad.map((l, i) => `<div class="pline" data-i="${i}">
      <select data-field="station" aria-label="Station">${STATION.map(s => `<option value="${s.id}" ${s.id === l.station ? 'selected' : ''}>${s.name}</option>`).join('')}</select>
      <textarea data-field="prompt" rows="3" maxlength="600" aria-label="Prompt for the chef"></textarea>
      <button class="x" data-act="drop" data-i="${i}" aria-label="Remove this item">×</button></div>`).join('');
  pBody.innerHTML = `<div class="pad">
      <div class="pad-head"><span class="issue">${esc(c.key)}</span><b>${esc(c.title)}</b><small>Table ${c.tableId} · ${esc(c.persona.name)}</small></div>
      ${c.reviews.length ? `<div class="lastfb">“${esc(c.reviews.at(-1).feedback)}”</div>` : `<p class="padbody">${esc(c.body)}</p>`}
      <div class="pad-lines">${lines || '<p class="empty">Tap a special below, or write your own.</p>'}</div>
      ${chips.length || sugg.length ? `<div class="specials"><small>${c.reviews.length ? 'Specials and what they asked for' : "Today's specials"}</small><div class="chips">${chips.map(p => `<button class="spc" data-act="chip" data-preset="${p.id}">${stationChip(p.station)}<span>${esc(p.prompt.slice(0, 70))}…</span></button>`).join('')}${sugg.map((m, i) => `<button class="spc sug" data-act="sug" data-i="${i}">${stationChip(m.station)}<span>${esc(m.prompt.slice(0, 70))}${m.prompt.length > 70 ? '…' : ''}</span></button>`).join('')}</div></div>` : ''}
      <button class="mini write" data-act="write">+ Write your own</button>
      <div class="pad-patience">${patienceBar(c.patience)}</div>
    </div>
    <div class="actions"><button class="btn ship big" data-act="send" ${ui.pad.length ? '' : 'disabled'}>Send ${ui.pad.length || ''} to the kitchen</button><button class="btn ghost" data-act="close">Close</button></div>`;
  pBody.querySelectorAll('.pline').forEach(el => { el.querySelector('textarea').value = ui.pad[Number(el.dataset.i)].prompt; });
  ui.sugg = sugg;
}
pBody.addEventListener('input', e => {
  const line = e.target.closest('.pline'); if (!line || ui.mode !== 'pad') return;
  const l = ui.pad[Number(line.dataset.i)]; if (!l) return;
  if (e.target.dataset.field === 'prompt') { l.prompt = e.target.value; }
  if (e.target.dataset.field === 'station') { l.station = e.target.value; }
});

/* ---------- the plate: sample the dish ---------- */
const seenKey = it => `${it.id}:${it.rounds}`;
export const diffSeen = it => { const s = ui.seen.get(seenKey(it)); return !!s && s.seen.size >= s.total; };
function renderPlate(force) {
  const it = itemById(ui.itemId);
  if (!it || it.state !== 'plated') {
    // the dish left the counter (served, sent back, binned): show the next one, or close
    const next = G.S.counter[0];
    if (next && it?.state !== 'serving') { ui.itemId = next; ui.plateKey = ''; return renderPlate(true); }
    if (it?.state === 'serving') return;
    return closePanel();
  }
  const c = customerById(it.customerId);
  const key = `${seenKey(it)}`;
  if (force || key !== ui.plateKey) {
    ui.plateKey = key;
    const idx = G.S.counter.indexOf(it.id), n = G.S.counter.length;
    const burnt = it.tests && !it.tests.ok;
    pBody.innerHTML = `<div class="plate-card ${burnt ? 'burnt' : ''}">
        <div class="cloche"></div>
        <div class="dk-top">${stationChip(it.station)}<span class="issue">${esc(c?.key || '')}</span><span class="tbl">Table ${c?.tableId ?? '–'}</span>${n > 1 ? `<span class="nav"><button class="mini" data-act="prevp" ${idx <= 0 ? 'disabled' : ''}>‹</button>${idx + 1}/${n}<button class="mini" data-act="nextp" ${idx >= n - 1 ? 'disabled' : ''}>›</button></span>` : ''}</div>
        <h2>${esc(it.prompt.slice(0, 120))}</h2>
        <div class="facts">
          <span class="lamp ${burnt ? 'bad' : 'ok'}">${burnt ? ICON.flame : ICON.tick} tests ${burnt ? 'fail' : 'pass'}</span>
          ${it.stat ? `<span class="chip2">${it.stat.files} file${it.stat.files === 1 ? '' : 's'} +${it.stat.added} −${it.stat.removed}</span>` : ''}
          <span class="chip2">${esc(chefById(it.chefId)?.name || it.cookedBy === 'claude' ? 'Claude chef' : 'practice chef')}</span>
          ${it.rounds ? `<span class="chip2 warn">round ${it.rounds + 1}</span>` : ''}
          <span class="seenpill" id="seenPill"></span>
        </div>
        <details ${it.summary ? 'open' : ''}><summary>Chef's summary</summary><p class="sum">${esc(it.summary || '(no summary)')}</p></details>
        ${it.tests ? `<details ${burnt ? 'open' : ''}><summary>Test output</summary><pre class="out">${esc(it.tests.output.slice(-2500))}</pre></details>` : ''}
        <div class="diff" id="pDiff"><div class="file">Lifting the cloche…</div></div>
      </div>
      ${watching() ? '' : `<div class="serve-box">
        <textarea id="pNote" rows="2" maxlength="300" placeholder="Note for ${esc(c?.persona.name.split(' ')[0] || 'the customer')} (optional)"></textarea>
        <div class="actions"><button class="btn ship big" data-act="serve" id="serveBtn">Serve</button><button class="btn danger" data-act="redo-open">Send back</button><button class="btn ghost" data-act="close">Close</button></div>
        <div class="redo" id="redoBox" hidden>
          <div class="chips">${['Tests are failing', 'Missed an edge case', 'Changed too much', 'Not what the ticket asked'].map(t => `<button class="mini" data-act="redo-chip">${t}</button>`).join('')}</div>
          <textarea id="pRedo" rows="2" maxlength="500" placeholder="What should the chef fix?"></textarea>
          <button class="btn danger" data-act="redo">Send it back</button>
        </div></div>`}`;
    loadDiff(it);
  }
  const s = ui.seen.get(seenKey(it)), seenN = s ? s.seen.size : 0, total = s?.total ?? 0;
  const pill = $('seenPill');
  if (pill) { pill.textContent = s ? (total ? `${seenN}/${total} hunks read` : 'no changes') : 'reading…'; pill.classList.toggle('all', !!s && seenN >= total); }
  const btn = $('serveBtn');
  if (btn) btn.textContent = `Serve to table ${customerById(it.customerId)?.tableId ?? ''}${s && seenN < total ? ' (blind)' : ''}`;
}
async function loadDiff(it) {
  try {
    const d = await getJson(`/api/items/${it.id}/diff`);
    if (ui.itemId !== it.id || ui.mode !== 'plate') return;
    const box = $('pDiff'); if (!box) return;
    const { html, hunks } = renderDiff(d.patch);
    box.innerHTML = html;
    const k = seenKey(it);
    if (!ui.seen.has(k)) ui.seen.set(k, { total: hunks, seen: new Set() });
    ui.seen.get(k).total = hunks;
    markSeen();
    renderPlate();
  } catch { const box = $('pDiff'); if (box) box.innerHTML = '<div class="file">Could not load the diff.</div>'; }
}
function renderDiff(patch) {
  if (!patch) return { html: '<div class="file">No changes: the chef did not change any files.</div>', hunks: 0 };
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
/** A hunk counts as read once it has been on screen, in the diff box and in the panel's own scroll. */
function markSeen() {
  const it = itemById(ui.itemId); if (!it) return;
  const s = ui.seen.get(seenKey(it)); if (!s) return;
  const vh = innerHeight, box = $('pDiff'); if (!box) return;
  const br = box.getBoundingClientRect();
  if (br.bottom < 0 || br.top > vh) return;
  // scrolled to the end of the diff (or it all fits): everything above has been on screen
  const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 6 && br.bottom <= vh + 8;
  for (const el of box.querySelectorAll('.hunk')) {
    const r = el.getBoundingClientRect();
    const top = Math.max(r.top, br.top, 0), bottom = Math.min(r.bottom, br.bottom, vh);
    if (atEnd || bottom - top >= Math.min(r.height, br.height * 0.4, 60) - 2) { s.seen.add(Number(el.dataset.h)); el.classList.add('seen'); }
  }
  const btn = $('serveBtn'), pill = $('seenPill');
  if (btn || pill) renderPlate();
}
pBody.addEventListener('scroll', () => { if (ui.mode === 'plate') markSeen(); }, { capture: true, passive: true });

/* ---------- panel buttons ---------- */
pBody.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const S = G.S, a = b.dataset.act, c = ui.cid ? customerById(ui.cid) : null;
  if (a === 'close') return closePanel();
  if (a === 'seat') return act('seat', async () => { await api(`/api/customers/${c.id}/seat`); emit('sfx', 'door'); const cid = c.id; closePanel(); toast(`${c.persona.name} is seated. Tap their table to take the order`, 'good'); emit('seated', cid); });
  if (a === 'chip') { const p = c.presets.find(x => x.id === b.dataset.preset); if (p) ui.pad.push({ station: p.station, prompt: p.prompt, presetId: p.id }); emit('sfx', 'pick'); return renderPad(true); }
  if (a === 'sug') { const m = ui.sugg?.[Number(b.dataset.i)]; if (m) { const p = c.presets.find(x => x.station === m.station && !itemsOf(c).some(i => i.presetId === x.id)); ui.pad.push(p ? { station: p.station, prompt: p.prompt, presetId: p.id } : { station: m.station, prompt: m.prompt, presetId: null }); } emit('sfx', 'pick'); return renderPad(true); }
  if (a === 'write') { ui.pad.push({ station: 'backend', prompt: '', presetId: null }); renderPad(true); pBody.querySelector('.pline:last-child textarea')?.focus(); return; }
  if (a === 'drop') { ui.pad.splice(Number(b.dataset.i), 1); return renderPad(true); }
  if (a === 'send') {
    const items = ui.pad.map(l => ({ station: l.station, prompt: l.prompt.trim(), presetId: l.presetId })).filter(l => l.prompt);
    if (!items.length) return toast('Write a prompt for the chef', 'bad');
    return act('send', async () => { await api(`/api/customers/${c.id}/items`, { items }); emit('sfx', 'drop'); emit('tickets'); closePanel(); toast(`${items.length} ticket${items.length > 1 ? 's' : ''} on the rail`, 'good'); });
  }
  if (a === 'more') return openPad(c);
  if (a === 'bill') {
    const open = itemsOf(c).filter(i => ['ready', 'cooking', 'plated', 'stalled'].includes(i.state)).length;
    return act('bill', async () => {
      const res = await api(`/api/customers/${c.id}/bill`, { abandon: open > 0 });
      if (res.conflict) { toast('Main moved on: a chef is merging it into this table first. Serve that, then bill again.', 'bad'); return closePanel(); }
      emit('sfx', 'ship'); emit('bill', c.id);
      show('receipt', { cid: c.id });
    });
  }
  if (a === 'remove') return act(`rm${b.dataset.id}`, () => api(`/api/items/${b.dataset.id}/remove`));
  if (a === 'prevp' || a === 'nextp') { const i = S.counter.indexOf(ui.itemId) + (a === 'nextp' ? 1 : -1); if (S.counter[i]) { ui.itemId = S.counter[i]; renderPlate(true); } return; }
  if (a === 'serve') {
    const it = itemById(ui.itemId); if (!it) return;
    const seen = diffSeen(it), note = $('pNote')?.value || '';
    return act('serve', async () => {
      const res = await api(`/api/items/${it.id}/serve`, { seen, note });
      if (res.conflict) { toast('It clashed with what is already on the table. A chef will merge it.', 'bad'); emit('sfx', 'back'); }
      else { emit('sfx', 'approve'); emit('served', it.customerId); toast(seen ? 'Served' : 'Served blind: no bonus', seen ? 'good' : ''); }
      ui.plateKey = ''; renderPlate(true);
    });
  }
  if (a === 'redo-open') { $('redoBox').hidden = !$('redoBox').hidden; if (!$('redoBox').hidden) $('pRedo').focus(); return; }
  if (a === 'redo-chip') { $('pRedo').value = b.textContent; return; }
  if (a === 'redo') {
    const it = itemById(ui.itemId), comment = $('pRedo').value.trim();
    if (!comment) return toast('Say what the chef should fix', 'bad');
    return act('redo', async () => { await api(`/api/items/${it.id}/redo`, { comment }); emit('sfx', 'back'); toast('Back to the kitchen'); ui.plateKey = ''; renderPlate(true); });
  }
  if (a === 'answer') {
    const q = S.questions.find(x => x.id === b.dataset.q); if (!q) return;
    const o = b.dataset.opt;
    const body = q.kind === 'permission' ? { allow: o === 'yes' } : o === 'x' ? { allow: false, message: 'The waiter says: your call. Use your best judgement and say what you assumed.' } : { allow: true, answers: { [q.questions[0].question]: q.questions[0].options[Number(o)].label } };
    return act('answer', () => api(`/api/questions/${q.id}/answer`, body));
  }
});

/* ======================= the coach: one line about the next useful thing ======================= */
export function coach() {
  const S = G.S; if (!S || watching()) return null;
  const sh = S.shift;
  if (sh.phase === 'off' || sh.phase === 'closed' || sh.phase === 'break' || sh.phase === 'bell') return null;
  const seated = S.customers.filter(c => c.tableId && ['seated', 'waiting_food', 'eating', 'feedback_ready'].includes(c.state));
  const fb = seated.find(c => c.state === 'feedback_ready');
  if (fb) return { spec: `table:${fb.tableId}`, text: `${fb.persona.name.split(' ')[0]} has feedback. Go to their table.`, tone: 'want' };
  if (S.counter.length) return { spec: 'counter', text: 'A dish is on the counter. Taste it before you serve it.', tone: 'want' };
  const fresh = seated.find(c => c.state === 'seated' && !S.items.some(i => i.customerId === c.id));
  if (fresh) return { spec: `table:${fresh.tableId}`, text: `Take ${fresh.persona.name.split(' ')[0]}'s order: tap their table.`, tone: 'want' };
  const decide = seated.find(c => c.state === 'seated');
  if (decide) return { spec: `table:${decide.tableId}`, text: `${decide.persona.name.split(' ')[0]} is waiting: add items or give the bill.`, tone: 'want' };
  const free = S.tables.some(t => !t.reserved && !t.customerId) && S.customers.some(c => c.state === 'in_line');
  if (free) return { spec: 'door', text: 'A table is free. Tap the first customer in the line.', tone: '' };
  if (sh.eligible) return { spec: null, text: 'Every chef is busy. Take a break: the bell will call you back.', tone: 'break' };
  return { spec: null, text: 'The kitchen is cooking. Tap a station to peek at a chef.', tone: '' };
}

/* ======================= HUD ======================= */
let lastScore = null;
export function hud() {
  const S = G.S; if (!S) return;
  const t = nowS(), sh = S.shift;
  document.body.dataset.phase = sh.phase;
  const left = sh.endsAt ? Math.max(0, sh.endsAt - t) : (sh.lengthMin || 3) * 60000;
  $('phaseName').textContent = { off: 'Closed', service: 'Service', break: 'On break', bell: 'Order up!', closed: 'Last orders' }[sh.phase] || sh.phase;
  $('shiftClock').textContent = mmss(left);
  $('clockBtn').classList.toggle('last', sh.phase === 'service' && left < 30000);
  const work = sh.phase === 'service' && sh.serviceSince ? t - sh.serviceSince : 0;
  $('workBar').style.width = `${Math.min(100, (work / (sh.maxWorkMs || 1)) * 100)}%`;
  $('workBar').parentElement.title = `Working ${mmss(work)} of a ${mmss(sh.maxWorkMs || 0)} limit`;
  const w = S.waiting;
  $('mWait').textContent = `${w.count} · ${mmss(w.ms)}`;
  $('mWaitBox').classList.toggle('hot', w.count > 0 && sh.phase === 'service');
  $('mBills').textContent = S.stats.bills;
  $('mSpend').textContent = `$${S.stats.costUsd.toFixed(S.stats.costUsd && S.stats.costUsd < 0.1 ? 3 : 2)}`;
  if (S.stats.score !== lastScore) {
    $('mScore').textContent = S.stats.score;
    if (lastScore !== null) { const el = $('scoreBox'); el.classList.remove('bump', 'drop'); void el.offsetWidth; el.classList.add(S.stats.score > lastScore ? 'bump' : 'drop'); }
    lastScore = S.stats.score;
  }
  const streak = S.stats.streak ?? 1;
  $('mStreak').textContent = `×${streak.toFixed(2).replace(/0$/, '')}`;
  $('mStreak').classList.toggle('on', streak > 1);
  const bb = $('breakBtn');
  bb.hidden = sh.phase !== 'service' || watching();
  bb.disabled = !sh.eligible;
  bb.classList.toggle('glow', !!sh.eligible);
  bb.title = sh.eligible ? 'Every chef is busy: step away, the bell will call you back' : 'Get every chef cooking first, or clear what is waiting on you';
  $('newCustBtn').hidden = !S.allowCustom || watching();
  $('keyBtn').hidden = !S.publicMode || watching();
  $('keyBtn').classList.toggle('on', S.ownKey || S.vip);
  $('modeTag').textContent = `${S.mode === 'claude' ? `Claude chefs (${modelName(S.chefs[0]?.model)})` : S.mode === 'mixed' ? 'mixed chefs' : 'practice chefs'} · ${S.reviews === 'claude' ? `Claude customers (${modelName(S.customerModel)})` : 'scripted customers'}${S.spend.practice ? ' · practice mode' : ''}`;
  $('watchTag').hidden = !watching();
  // the coach line
  const h = coach();
  const el = $('coach');
  el.hidden = !h || panelIsOpen();
  if (h) { el.className = `coach ${h.tone}`; if (el.dataset.t !== h.text) { el.dataset.t = h.text; el.innerHTML = `${h.tone === 'break' ? ICON.mug : h.tone === 'want' ? ICON.hand : ICON.hat}<span>${esc(h.text)}</span>`; } }
  staffRoom();
  startScreen();
  till();
}
setInterval(() => { hud(); renderPanel(); }, 500);

/* ======================= start screen ======================= */
let startShown = false;
function startScreen() {
  const S = G.S, el = $('start');
  const open = S.shift.phase === 'off' && !watching();
  el.classList.toggle('open', open);
  if (!open || startShown) return;
  startShown = true;
  const demo = (S.settings.timings.shiftMin || 3) < 25;
  $('startName').textContent = S.name;
  $('startMode').textContent = $('modeTag').textContent;
  document.querySelector(`input[name="len"][value="${demo ? 3 : 25}"]`).checked = true;
}
$('startBtn').onclick = () => act('start', async () => {
  const len = Number(document.querySelector('input[name="len"]:checked')?.value || 3);
  const body = { lengthMin: len };
  if (len >= 25) { body.cooldownMin = Number($('cooldownIn').value) || 5; body.maxWorkMin = Number($('maxWorkIn').value) || Math.min(50, len); }
  await api('/api/shift/start', body);
  emit('sfx', 'bell');
  $('start').classList.remove('open');
});

/* ======================= staff room: the break and the bell ======================= */
function staffRoom() {
  const S = G.S, sh = S.shift, el = $('staff');
  const open = (sh.phase === 'break' || sh.phase === 'bell') && !watching();
  el.classList.toggle('open', open);
  el.classList.toggle('bell', sh.phase === 'bell');
  if (!open) return;
  const t = nowS(), cool = Math.max(0, (sh.cooldownEndsAt || t) - t);
  const cooking = S.chefs.filter(c => c.state === 'cooking' || c.state === 'walking').length;
  const held = S.counter.length + S.customers.filter(c => c.state === 'feedback_ready').length;
  $('sTitle').textContent = sh.phase === 'bell' ? 'Order up!' : sh.forced ? 'Forced break' : 'Staff room';
  $('sTimer').textContent = mmss(t - (sh.breakStartedAt || t));
  $('sCool').style.setProperty('--p', Math.round((1 - cool / (sh.cooldownMs || 1)) * 100));
  $('sCoolText').textContent = cool > 0 ? `No bell for ${mmss(cool)}` : sh.phase === 'bell' ? 'The bell rang' : 'Bell armed: rings when something is ready';
  $('sMsg').textContent = sh.phase === 'bell'
    ? `${held || 'Something'} thing${held === 1 ? '' : 's'} need${held === 1 ? 's' : ''} you. Patience starts in ${mmss(Math.max(0, (sh.graceEndsAt || t) - t))}.`
    : sh.forced ? 'You hit your work limit. The kitchen keeps cooking; rest until the cooldown ends.'
    : `${cooking} chef${cooking === 1 ? ' is' : 's are'} cooking${held ? `, ${held} thing${held === 1 ? '' : 's'} held at the pass for you` : ''}. Stand up, stretch, have some water.`;
  const back = $('backBtn');
  back.disabled = !!(sh.forced && cool > 0);
  back.textContent = sh.phase === 'bell' ? 'Back to work' : cool > 0 ? (sh.forced ? `Rest ${mmss(cool)}` : 'Back early (no break bonus)') : 'Back to work';
}
$('backBtn').onclick = () => act('back', async () => { await api('/api/break/end'); emit('sfx', 'pick'); });
$('breakBtn').onclick = () => act('break', async () => {
  askNotify();
  await api('/api/break/start');
  emit('sfx', 'door');
  closePanel();
});

/* ---------- system notifications for the bell, through a service worker so Android shows them too ---------- */
let swReg = null;
if ('serviceWorker' in navigator && isSecureContext) navigator.serviceWorker.register('/sw.js').then(r => { swReg = r; }, () => {});
function askNotify() {
  if (!('Notification' in window) || Notification.permission !== 'default' || store.get('notifyAsked')) return;
  store.set('notifyAsked', '1');
  Notification.requestPermission().catch(() => {});
}
export function notifyBell(text) {
  try {
    if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
    if (swReg?.showNotification) swReg.showNotification('Ship Shift: order up!', { body: text, tag: 'bell', renotify: true });
    else new Notification('Ship Shift: order up!', { body: text, tag: 'bell' });
  } catch { /* not supported here */ }
}

/* ======================= the till report ======================= */
let tillShown = false;
function till() {
  const S = G.S, sh = S.shift, el = $('till');
  const open = sh.phase === 'closed' && !!sh.report && !watching() && !tillDismissed;
  el.classList.toggle('open', open);
  if (!open || tillShown) return;
  tillShown = true;
  const r = sh.report;
  $('tStars').innerHTML = [1, 2, 3].map(i => `<span class="${i <= r.stars ? 'on' : ''}" style="--i:${i}">${ICON.star}</span>`).join('');
  $('tAdvice').textContent = r.advice;
  $('tScore').textContent = r.finalScore;
  const stat = (v, l) => `<div class="stat"><b>${v}</b><small>${l}</small></div>`;
  $('tStats').innerHTML = [
    stat(r.bills, 'bills paid'), stat(r.served, 'dishes served'), stat(r.redos, 'sent back'),
    stat(r.blindServes, 'blind serves'), stat(r.burntServed, 'burnt served'), stat(r.satisfaction ? r.satisfaction.toFixed(1) : '–', 'avg satisfaction'),
    stat(mmss(r.waitedMs), 'kept waiting'), stat(`${r.breaks} · ${mmss(r.breakMs)}`, 'breaks'), stat(r.avgReturnMs != null ? mmss(r.avgReturnMs) : '–', 'back after bell'),
    stat(mmss(r.longestServiceMs), 'longest stretch'), stat(r.billsPerHour, 'bills / hour'), stat(`$${(r.costUsd || 0).toFixed(3)}`, 'Claude spend'),
  ].join('');
  emit('report', r.stars);
  getJson('/api/leaderboard').then(rows => {
    $('tBoard').innerHTML = rows.length ? `<small>Leaderboard</small><ol>${rows.map(x => `<li class="${x.you ? 'you' : ''}"><span>${esc(x.name)}${x.team ? ' (team)' : ''}</span><b>${x.score}</b></li>`).join('')}</ol>` : '';
  }, () => {});
  // a teaser of the long-term idea: the browser keeps your shifts and learns your best length
  try {
    const hist = JSON.parse(store.get('history') || '[]');
    hist.push({ t: Date.now(), len: r.lengthMin, score: r.finalScore, stars: r.stars });
    store.set('history', JSON.stringify(hist.slice(-20)));
    const by = {};
    for (const h of hist) (by[h.len] ||= []).push(h.score / Math.max(1, h.len));
    const best = Object.entries(by).sort((a, b) => b[1].reduce((x, y) => x + y, 0) / b[1].length - a[1].reduce((x, y) => x + y, 0) / a[1].length)[0];
    $('tInsight').textContent = hist.length >= 3 ? `After ${hist.length} shifts, you score best per minute in ${best[0]}-minute shifts.` : `Shift ${hist.length} saved on this device. After three, Ship Shift suggests your best shift length.`;
  } catch { $('tInsight').textContent = ''; }
}
let tillDismissed = false;
$('tAgain').onclick = () => act('again', async () => {
  try { await api('/api/session/reset'); location.reload(); }
  catch { tillDismissed = true; $('till').classList.remove('open'); }
});
$('tClose').onclick = () => { tillDismissed = true; $('till').classList.remove('open'); };

/* ======================= dialogs: hire real chefs, new customer, leaderboard ======================= */
$('keyBtn').onclick = () => { $('keyMsg').textContent = G.S.ownKey ? 'Your key is in use for this restaurant. It is forgotten when the restaurant closes.' : G.S.vip ? 'VIP: real chefs on the team key.' : ''; $('keyDlg').showModal(); };
$('keyCancel').onclick = () => $('keyDlg').close();
$('keySave').onclick = () => act('key', async () => {
  const k = $('keyIn').value.trim(); if (!k) return;
  $('keyMsg').textContent = 'Checking the key…';
  try { await api('/api/session/key', { apiKey: k }); $('keyIn').value = ''; $('keyDlg').close(); toast('Real Claude chefs hired for this restaurant', 'good'); }
  catch (e) { $('keyMsg').textContent = e.message; }
});
$('vipSave').onclick = () => act('vip', async () => {
  try { await api('/api/session/vip', { code: $('vipIn').value }); $('vipIn').value = ''; $('keyDlg').close(); toast('VIP: real chefs on the team key', 'good'); }
  catch (e) { $('keyMsg').textContent = e.message; }
});
$('keyClear').onclick = () => act('kclear', async () => { await api('/api/session/key/clear'); $('keyDlg').close(); toast('Back to practice chefs'); });
$('newCustBtn').onclick = () => { $('custForm').reset(); $('custDlg').showModal(); };
$('custCancel').onclick = () => $('custDlg').close();
$('custForm').addEventListener('submit', e => {
  e.preventDefault();
  act('cust', async () => {
    const difficulty = document.querySelector('input[name="cSize"]:checked')?.value || 'M';
    await api('/api/customers', { title: $('cTitle').value, body: $('cBody').value, difficulty });
    $('custDlg').close(); toast('A new customer joins the line', 'good');
  });
});
$('boardBtn').onclick = async () => {
  try {
    const rows = await getJson('/api/leaderboard');
    $('lbList').innerHTML = rows.length ? rows.map(x => `<li class="${x.you ? 'you' : ''}"><span>${esc(x.name)}${x.team ? ' (team)' : ''}</span><b>${x.score}</b><small>${x.bills} bills</small></li>`).join('') : '<li>No restaurants yet</li>';
    $('lbDlg').showModal();
  } catch { /* offline */ }
};
$('lbClose').onclick = () => $('lbDlg').close();
