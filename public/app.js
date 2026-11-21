const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let S = null;            // latest kitchen snapshot
let offset = 0;          // server clock minus client clock
let selected = null;     // order id picked up by click
let reviewing = null;    // order id open in the review dialog
let soundOn = true;
let lastReportShown = 0;
const drafts = {};       // question id -> { picks: {question: Set}, other: {question: text}, message }
const peek = new Set();  // question ids revealed during focus
const cache = {};        // container key -> last html
const nowS = () => Date.now() + offset;

/* ---------- connection ---------- */
function connect() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.type === 'state') apply(m.state); };
  ws.onclose = () => { toast('Lost the kitchen. Reconnecting…', 'bad'); setTimeout(connect, 1500); };
}

async function api(path, body = {}) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { toast(data.error || `Request failed (${res.status})`, 'bad'); sfx('err'); throw new Error(data.error); }
  return data;
}

/* ---------- sound ---------- */
let AC = null;
function sfx(name) {
  if (!soundOn) return;
  try { AC ||= new AudioContext(); } catch { return; }
  const seqs = {
    ask: [[392, .12, 'square', .04], [330, .16, 'square', .04]],
    plate: [[988, .1, 'sine', .07], [1319, .22, 'sine', .06]],
    ship: [[523, .08, 'triangle', .08], [659, .08, 'triangle', .08], [784, .2, 'triangle', .08]],
    back: [[220, .14, 'sawtooth', .04], [180, .18, 'sawtooth', .04]],
    bell: [[1568, .5, 'sine', .07], [1175, .7, 'sine', .05]],
    err: [[150, .16, 'sawtooth', .035]],
  };
  let t = AC.currentTime;
  for (const [f, d, type, v] of seqs[name] || []) {
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.value = f; g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(1e-4, t + d);
    o.connect(g).connect(AC.destination); o.start(t); o.stop(t + d + .02); t += d * .8;
  }
}
$('soundBtn').onclick = () => { soundOn = !soundOn; $('soundBtn').textContent = soundOn ? 'Sound on' : 'Sound off'; $('soundBtn').setAttribute('aria-pressed', String(soundOn)); };

function toast(msg, kind = '') {
  const el = document.createElement('div'); el.className = `toast ${kind}`; el.textContent = msg;
  $('toasts').append(el);
  setTimeout(() => el.classList.add('out'), 3200); setTimeout(() => el.remove(), 3600);
}

/* ---------- state diffing for sounds ---------- */
function apply(next) {
  offset = next.now - Date.now();
  const prev = S; S = next;
  const focus = S.shift.mode === 'focus';
  if (prev) {
    const oldQ = new Set(prev.questions.map(q => q.id));
    const newQ = S.questions.filter(q => !oldQ.has(q.id));
    if (newQ.length && !focus) { sfx('ask'); toast(`${chefName(newQ[0].chefId)} is stuck and needs you`, 'bad'); }
    const oldPass = new Set(prev.orders.filter(o => o.state === 'at_pass').map(o => o.id));
    const arrived = S.orders.filter(o => o.state === 'at_pass' && !oldPass.has(o.id));
    if (arrived.length && !focus) { sfx('plate'); toast(`Plate up at the pass: #${arrived[0].id} ${arrived[0].title}`); }
    for (const o of S.orders) {
      const was = prev.orders.find(x => x.id === o.id);
      if (was && was.state !== 'shipped' && o.state === 'shipped') { sfx('ship'); toast(`Shipped #${o.id} to ${S.mainBranch}`, 'good'); }
    }
    if (prev.shift.mode === 'focus' && S.shift.mode === 'break') sfx('bell');
  }
  if (S.shift.mode === 'break' && S.shift.report && S.shift.report.shift !== lastReportShown) { lastReportShown = S.shift.report.shift; showReport(S.shift.report); }
  render();
  if (reviewing) syncReview();
}

const chefName = id => S.chefs.find(c => c.id === id)?.name || id;
const orderOf = id => S.orders.find(o => o.id === id);

/* ---------- render ---------- */
function put(key, el, html, after) {
  if (cache[key] === html) return false;
  const active = document.activeElement;
  const restore = active && el.contains(active) && active.id ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null;
  el.innerHTML = html; cache[key] = html;
  after?.();
  if (restore) { const r = document.getElementById(restore.id); if (r) { r.focus(); try { r.setSelectionRange(restore.start, restore.end); } catch { /* not a text field */ } } }
  return true;
}

function render() {
  $('driverHint').textContent = S.driver === 'sim' ? 'Simulated chefs (free). Set SHIP_SIM=0 for real Claude agents.' : `Real Claude agents · tests: ${S.testCmd}`;
  renderTickets(); renderStations(); renderPass(); renderServed(); tick();
}

function renderTickets() {
  const list = S.orders.filter(o => o.state === 'waiting' || o.state === 'planning');
  const html = list.length ? list.map(o => `
    <article class="ticket ${o.state} ${selected === o.id ? 'selected' : ''}" draggable="${o.state === 'waiting'}" data-order="${o.id}">
      <div class="tno"><span>#${o.id}</span><span class="size">${o.size}</span></div>
      <div class="ttl">${esc(o.title)}</div>
      ${o.body ? `<div class="body">${esc(o.body)}</div>` : ''}
      ${o.state === 'planning' ? `<div class="plan">Planning… ${esc(o.activity.at(-1)?.text || '')}</div>` : o.plan ? `<div class="plan">${esc(o.plan)}</div>` : ''}
      ${o.error ? `<div class="err">${esc(o.error)}</div>` : ''}
      <div class="patience" data-created="${o.createdAt}" data-target="${o.targetMin}"><i></i></div>
      <div class="acts">
        ${o.state === 'waiting' && !o.plan ? `<button type="button" data-act="plan" data-id="${o.id}">Plan first</button>` : ''}
        <button type="button" data-act="bin" data-id="${o.id}">Bin</button>
      </div>
    </article>`).join('') : '<div class="empty">No orders waiting. Add one with New order.</div>';
  put('tickets', $('tickets'), html);
}

const AVATAR_COLORS = { pixel: '#5d9de0', router: '#f2a33a', query: '#4fb37a' };
function avatar(chef, mood) {
  const c = AVATAR_COLORS[chef.id] || '#c08ad6';
  const mouth = mood === 'blocked' ? '<path d="M18 36 q5 -4 10 0" stroke="#222" stroke-width="2" fill="none"/>' : '<path d="M18 34 q5 4 10 0" stroke="#222" stroke-width="2" fill="none"/>';
  return `<svg viewBox="0 0 46 46" aria-hidden="true">
    <circle cx="23" cy="40" r="14" fill="#f4f4ef" stroke="#222" stroke-width="2"/>
    <path d="M16 31 L30 31 L23 39 Z" fill="${c}"/>
    <circle cx="23" cy="26" r="10" fill="#efc7a2" stroke="#222" stroke-width="2"/>
    <circle cx="19" cy="25" r="1.6" fill="#222"/><circle cx="27" cy="25" r="1.6" fill="#222"/>${mouth}
    <rect x="15" y="12" width="16" height="6" fill="#fff" stroke="#222" stroke-width="2"/>
    <circle cx="17" cy="10" r="5" fill="#fff"/><circle cx="29" cy="10" r="5" fill="#fff"/><circle cx="23" cy="7" r="6" fill="#fff"/>
  </svg>`;
}

function renderStations() {
  const host = $('stations');
  if (host.children.length !== S.chefs.length) { host.innerHTML = S.chefs.map(c => `<div class="station" data-chef="${c.id}"></div>`).join(''); for (const k in cache) if (k.startsWith('chef:')) delete cache[k]; }
  for (const chef of S.chefs) {
    const el = host.querySelector(`[data-chef="${chef.id}"]`);
    const o = chef.orderId ? orderOf(chef.orderId) : null;
    const qs = S.questions.filter(q => q.chefId === chef.id);
    const mood = qs.length ? 'blocked' : o ? o.state : 'free';
    const label = { blocked: 'Waiting on you', cooking: 'Cooking', testing: 'In the oven', at_pass: 'At the pass', merging: 'Shipping', stalled: 'Stalled', free: 'Free' }[mood] || mood;
    el.className = `station ${mood} ${!o && selected ? 'pickable' : ''}`;
    const tools = o ? o.activity.filter(a => a.kind === 'tool').length : 0;
    const html = `
      <div class="chef">
        <div class="avatar">${avatar(chef, mood)}</div>
        <div><b>${esc(chef.name)}</b><small>${esc(chef.style)}</small></div>
        <span class="state ${mood}">${label}</span>
      </div>
      ${o ? `
        <div class="stove">
          <div class="on">#${o.id} ${esc(o.title)} <span class="size">${o.size}</span></div>
          <div class="facts"><span>${tools} tool calls</span><span>round ${o.rounds + 1}</span><span data-since="${o.assignedAt}">0:00</span>${o.costUsd ? `<span>$${o.costUsd.toFixed(2)}</span>` : ''}</div>
          ${mood === 'cooking' || mood === 'testing' ? '<div class="flame"></div>' : ''}
        </div>
        ${qs.map(q => bubble(q)).join('')}
        ${o.state === 'stalled' ? `<div class="bubble"><div>${esc(o.error || 'Stalled')}</div><div class="row"><button class="btn small" data-act="resume" data-id="${o.id}" type="button">Resume</button><button class="btn small ghost" data-act="bin" data-id="${o.id}" type="button">Bin it</button></div></div>` : ''}
        <ul class="feed">${o.activity.slice(-8).reverse().map(a => `<li class="${a.kind}">${esc(a.text)}</li>`).join('')}</ul>`
      : `<div class="free">${selected ? `Click to hand #${selected} to ${esc(chef.name)}` : 'Free. Drop a ticket here.'}</div>`}`;
    put('chef:' + chef.id, el, html, () => restoreDrafts(el));
  }
}

function bubble(q) {
  const focus = S.shift.mode === 'focus' && !peek.has(q.id);
  if (focus) return `<div class="bubble held"><div><span class="qmark">?</span>${q.kind === 'question' ? 'Has a question' : `Needs your OK: ${esc(q.reason)}`}</div>
    <div class="waited">Waiting <span data-since="${q.createdAt}">0:00</span>. Held until your break.</div>
    <div class="row"><button class="btn small ghost" data-act="peek" data-q="${q.id}" type="button">Answer now (breaks focus)</button></div></div>`;
  if (q.kind === 'question') {
    return `<div class="bubble" data-qbox="${q.id}">
      ${q.questions.map((x, i) => `
        <div class="q"><span class="qmark">?</span>${esc(x.question)}</div>
        <div class="opts">${(x.options || []).map(op => `<button type="button" class="opt" data-act="pick" data-q="${q.id}" data-i="${i}" data-label="${esc(op.label)}" data-multi="${x.multiSelect ? 1 : 0}">${esc(op.label)}${op.description ? `<small>${esc(op.description)}</small>` : ''}</button>`).join('')}</div>
        <input id="other-${q.id}-${i}" data-other="${q.id}" data-i="${i}" placeholder="Or type your own answer">`).join('')}
      <div class="waited">Waiting <span data-since="${q.createdAt}">0:00</span></div>
      <div class="row"><button class="btn small" data-act="answer" data-q="${q.id}" type="button">Answer</button><button class="btn small ghost" data-act="skip" data-q="${q.id}" type="button">Skip: use your judgement</button></div>
    </div>`;
  }
  const detail = q.input?.command ?? JSON.stringify(q.input ?? {}, null, 1);
  return `<div class="bubble" data-qbox="${q.id}">
    <div class="q"><span class="qmark">?</span>Needs your OK to use ${esc(q.toolName)}</div>
    <code>${esc(String(detail).slice(0, 600))}</code>
    <input id="msg-${q.id}" data-msg="${q.id}" placeholder="Optional note if you say no">
    <div class="waited">Waiting <span data-since="${q.createdAt}">0:00</span></div>
    <div class="row"><button class="btn small ship" data-act="allow" data-q="${q.id}" type="button">Allow</button><button class="btn small danger" data-act="deny" data-q="${q.id}" type="button">Say no</button></div>
  </div>`;
}

function draft(qid) { return (drafts[qid] ||= { picks: {}, other: {}, message: '' }); }
function restoreDrafts(root) {
  root.querySelectorAll('[data-other]').forEach(inp => { inp.value = draft(inp.dataset.other).other[inp.dataset.i] || ''; });
  root.querySelectorAll('[data-msg]').forEach(inp => { inp.value = draft(inp.dataset.msg).message || ''; });
  root.querySelectorAll('.opt').forEach(b => { if (draft(b.dataset.q).picks[b.dataset.i]?.has(b.dataset.label)) b.classList.add('on'); });
}

function renderPass() {
  const plates = S.orders.filter(o => o.state === 'at_pass' || o.state === 'merging');
  const focus = S.shift.mode === 'focus';
  $('plates').closest('.pass').classList.toggle('rush', S.shift.mode === 'break' && plates.length > 0);
  const html = (focus && plates.length ? `<div class="held-note">${plates.length} plate${plates.length > 1 ? 's' : ''} held for your break. You can still open one.</div>` : '') +
    (plates.length ? plates.map(o => {
      const burnt = o.tests && !o.tests.ok;
      return `<button type="button" class="plate ${burnt ? 'burnt' : ''}" data-act="review" data-id="${o.id}">
        <span class="dish" aria-hidden="true"></span>
        <b>#${o.id} ${esc(o.title)}</b>
        <span class="facts"><span>${esc(chefName(o.chefId))}</span>${o.tests ? `<span class="badge ${o.tests.ok ? 'ok' : 'bad'}">${o.tests.ok ? 'tests pass' : 'tests fail'}</span>` : ''}${o.behind ? `<span class="badge spoil">${o.behind} behind ${esc(S.mainBranch)}</span>` : ''}${o.state === 'merging' ? '<span>shipping…</span>' : ''}</span>
        <span class="facts">${o.diff ? `<span>${o.diff.stat.files} files</span><span class="pos">+${o.diff.stat.added}</span><span class="neg">−${o.diff.stat.removed}</span>` : ''}<span>round ${o.rounds + 1}</span></span>
      </button>`;
    }).join('') : '<div class="empty">Nothing at the pass yet.</div>');
  put('pass', $('plates'), html);
}

function renderServed() {
  const shipped = S.orders.filter(o => o.state === 'shipped').sort((a, b) => b.shippedAt - a.shippedAt).slice(0, 6);
  const pts = S.stats.points.slice(-6).reverse();
  const html = (shipped.length ? shipped.map(o => `<div><b>#${o.id} ${esc(o.title)}</b><span>${o.rounds ? `${o.rounds} send-back${o.rounds > 1 ? 's' : ''}` : 'first time'}</span></div>`).join('') : '<div>Nothing shipped yet.</div>') +
    (pts.length ? `<h3 class="sub">Score</h3><div class="served points">${pts.map(p => `<div><b>${esc(p.why)}</b><span class="${p.n >= 0 ? 'p' : 'n'}">${p.n >= 0 ? '+' : ''}${p.n}</span></div>`).join('')}</div>` : '');
  put('served', $('served'), html);
}

/* ---------- once a second: clocks, patience, waiting meters ---------- */
const mmss = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function tick() {
  if (!S) return;
  const t = nowS();
  document.querySelectorAll('[data-since]').forEach(el => { el.textContent = mmss(t - Number(el.dataset.since)); });
  document.querySelectorAll('.patience').forEach(el => {
    const frac = Math.max(0, 1 - (t - Number(el.dataset.created)) / (Number(el.dataset.target) * 60000));
    el.firstElementChild.style.width = `${frac * 100}%`;
    el.classList.toggle('warn', frac < .5); el.classList.toggle('late', frac < .2);
  });
  const sh = S.shift, box = $('shift');
  box.className = `shift ${sh.mode}`;
  $('shiftMode').textContent = sh.mode === 'focus' ? `Shift ${sh.no} · focus` : sh.mode === 'break' ? `Shift ${sh.no} · break: run the pass` : 'Kitchen idle';
  $('shiftClock').textContent = sh.endsAt ? mmss(sh.endsAt - t) : `${$('focusMin').value || 25}:00`;
  $('shiftBtn').textContent = sh.mode === 'off' ? 'Start shift' : 'End shift';
  const live = S.questions.reduce((n, q) => n + (t - q.createdAt), 0);
  $('mBlocked').textContent = mmss(S.stats.blockedMs + live);
  $('mBlockedBox').classList.toggle('hot', S.questions.length > 0);
  $('mScore').textContent = S.stats.score;
  $('mShipped').textContent = S.stats.shipped;
  $('mSpend').textContent = `$${S.stats.costUsd.toFixed(2)}`;
  const banner = $('banner');
  if (sh.mode === 'focus') { banner.hidden = false; banner.className = 'banner focus'; banner.textContent = `Focus time. Questions and plates wait at the pass until your break. ${S.questions.length ? `${S.questions.length} chef${S.questions.length > 1 ? 's are' : ' is'} waiting.` : ''}`; }
  else if (sh.mode === 'break') { banner.hidden = false; banner.className = 'banner break'; banner.textContent = `Break. Run the pass: ${S.questions.length} question${S.questions.length === 1 ? '' : 's'}, ${S.orders.filter(o => o.state === 'at_pass').length} plate${S.orders.filter(o => o.state === 'at_pass').length === 1 ? '' : 's'} waiting.`; }
  else banner.hidden = true;
}
setInterval(tick, 1000);

/* ---------- interactions ---------- */
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  const station = e.target.closest('.station');
  if (!b && station && selected) {
    const chef = S.chefs.find(c => c.id === station.dataset.chef);
    if (chef && !chef.orderId) { const id = selected; selected = null; await api(`/api/orders/${id}/assign`, { chefId: chef.id }).catch(() => {}); render(); }
    return;
  }
  const ticket = e.target.closest('.ticket');
  if (!b && ticket && ticket.classList.contains('waiting')) { const id = Number(ticket.dataset.order); selected = selected === id ? null : id; cache.tickets = null; render(); return; }
  if (!b) return;
  const { act, id, q } = b.dataset;
  try {
    if (act === 'plan') await api(`/api/orders/${id}/plan`);
    else if (act === 'bin') { if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Really bin?'; return; } await api(`/api/orders/${id}/bin`); }
    else if (act === 'resume') await api(`/api/orders/${id}/resume`);
    else if (act === 'review') openReview(Number(id));
    else if (act === 'peek') { peek.add(q); delete cache['chef:' + S.questions.find(x => x.id === q)?.chefId]; render(); }
    else if (act === 'pick') {
      const d = draft(q), i = b.dataset.i, set = (d.picks[i] ||= new Set());
      if (b.dataset.multi !== '1') set.clear();
      set.has(b.dataset.label) ? set.delete(b.dataset.label) : set.add(b.dataset.label);
      b.closest('.opts').querySelectorAll('.opt').forEach(x => x.classList.toggle('on', set.has(x.dataset.label)));
    } else if (act === 'answer') {
      const qq = S.questions.find(x => x.id === q); if (!qq) return;
      const d = draft(q), answers = {};
      qq.questions.forEach((x, i) => { const typed = (d.other[i] || '').trim(); const picked = [...(d.picks[i] || [])]; answers[x.question] = typed || picked.join(', '); });
      if (Object.values(answers).some(v => !v)) { toast('Pick an option or type an answer for each question', 'bad'); return; }
      await api(`/api/questions/${q}/answer`, { allow: true, answers }); delete drafts[q];
    } else if (act === 'skip') await api(`/api/questions/${q}/answer`, { allow: false, message: 'Skipped by the head chef. Use your best judgement and say what you assumed.' });
    else if (act === 'allow') await api(`/api/questions/${q}/answer`, { allow: true });
    else if (act === 'deny') await api(`/api/questions/${q}/answer`, { allow: false, message: draft(q).message || undefined });
  } catch { /* toast already shown */ }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.other) draft(t.dataset.other).other[t.dataset.i] = t.value;
  if (t.dataset.msg) draft(t.dataset.msg).message = t.value;
});

// drag and drop tickets onto chefs
document.addEventListener('dragstart', e => { const t = e.target.closest?.('.ticket'); if (!t) return; e.dataTransfer.setData('text/plain', t.dataset.order); t.classList.add('dragging'); });
document.addEventListener('dragend', e => { e.target.closest?.('.ticket')?.classList.remove('dragging'); document.querySelectorAll('.station.drop').forEach(s => s.classList.remove('drop')); });
document.addEventListener('dragover', e => { const s = e.target.closest('.station'); if (!s) return; const chef = S.chefs.find(c => c.id === s.dataset.chef); if (chef && !chef.orderId) { e.preventDefault(); s.classList.add('drop'); } });
document.addEventListener('dragleave', e => { const s = e.target.closest('.station'); if (s && !s.contains(e.relatedTarget)) s.classList.remove('drop'); });
document.addEventListener('drop', async e => {
  const s = e.target.closest('.station'); if (!s) return; e.preventDefault(); s.classList.remove('drop');
  const id = e.dataTransfer.getData('text/plain'); if (!id) return;
  selected = null;
  await api(`/api/orders/${id}/assign`, { chefId: s.dataset.chef }).catch(() => {});
});

// shift
$('shiftBtn').onclick = async () => {
  if (S.shift.mode === 'off') await api('/api/shift/start', { focusMin: Number($('focusMin').value), breakMin: Number($('breakMin').value) }).catch(() => {});
  else await api('/api/shift/stop').catch(() => {});
};

// new order
$('newOrderBtn').onclick = () => { $('orderForm').reset(); $('orderDialog').showModal(); $('oTitle').focus(); };
$('orderCancel').onclick = () => $('orderDialog').close();
$('orderForm').addEventListener('submit', async e => {
  e.preventDefault();
  const size = document.querySelector('input[name="oSize"]:checked')?.value || 'M';
  try { await api('/api/orders', { title: $('oTitle').value, body: $('oBody').value, size }); $('orderDialog').close(); } catch { /* toast shown */ }
});

/* ---------- review at the pass ---------- */
async function openReview(id) {
  reviewing = id;
  const o = orderOf(id);
  $('rEyebrow').textContent = `Order #${o.id} · cooked by ${chefName(o.chefId)} · round ${o.rounds + 1}`;
  $('rTitle').textContent = o.title;
  $('rSummary').textContent = o.summary || '(no summary)';
  $('rComment').value = '';
  $('rDiff').innerHTML = '<div class="file">Loading the diff…</div>';
  syncReview();
  $('reviewDialog').showModal();
  try {
    const d = await (await fetch(`/api/orders/${id}/diff`)).json();
    if (reviewing === id) $('rDiff').innerHTML = renderDiff(d.patch);
  } catch { $('rDiff').innerHTML = '<div class="file">Could not load the diff.</div>'; }
}
function syncReview() {
  const o = orderOf(reviewing);
  if (!o || !['at_pass', 'merging'].includes(o.state)) { if ($('reviewDialog').open) $('reviewDialog').close(); reviewing = null; return; }
  const meta = [];
  if (o.tests) meta.push(`<span class="badge ${o.tests.ok ? 'ok' : 'bad'}">${o.tests.ok ? 'Tests pass' : 'Tests fail'} · ${(o.tests.ms / 1000).toFixed(1)}s</span>`);
  if (o.diff) meta.push(`<span>${o.diff.stat.files} files, +${o.diff.stat.added} −${o.diff.stat.removed}</span>`);
  if (o.behind) meta.push(`<span class="badge spoil">${o.behind} commit${o.behind > 1 ? 's' : ''} behind ${esc(S.mainBranch)}: may not merge cleanly</span>`);
  if (o.feedback.length) meta.push(`<span>Last feedback: “${esc(o.feedback.at(-1).comment.slice(0, 120))}”</span>`);
  if (o.costUsd) meta.push(`<span>$${o.costUsd.toFixed(2)} spent</span>`);
  $('rMeta').innerHTML = meta.join('');
  $('rTestsLabel').textContent = o.tests ? `Test output (${o.tests.ok ? 'pass' : 'fail'})` : 'Tests';
  $('rTests').textContent = o.tests?.output || 'No test run.';
  $('rTestsBox').open = !!(o.tests && !o.tests.ok);
  $('rShip').disabled = $('rBack').disabled = o.state === 'merging';
  $('rShip').textContent = o.tests && !o.tests.ok ? 'Ship it anyway (tests fail)' : `Ship it: merge to ${S.mainBranch}`;
}
function renderDiff(patch) {
  if (!patch) return '<div class="file">No changes. The chef did not change any files. Send it back with what you expected.</div>';
  return patch.split('\n').map(l => {
    if (l.startsWith('diff --git')) return `<div class="file">${esc(l.replace(/^diff --git a\/(.*) b\/.*/, '$1'))}</div>`;
    if (/^(index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(l)) return '';
    const cls = l.startsWith('@@') ? 'hunk' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : '';
    return `<div class="ln ${cls}">${esc(l) || ' '}</div>`;
  }).join('');
}
$('rClose').onclick = () => { $('reviewDialog').close(); };
$('reviewDialog').addEventListener('close', () => { reviewing = null; });
$('rShip').onclick = async () => { const id = reviewing; try { await api(`/api/orders/${id}/review`, { verdict: 'approve' }); } catch { /* toast */ } };
$('rBack').onclick = async () => {
  const comment = $('rComment').value.trim();
  if (!comment) { toast('Write what the chef should fix', 'bad'); $('rComment').focus(); return; }
  const id = reviewing;
  try { await api(`/api/orders/${id}/review`, { verdict: 'send_back', comment }); sfx('back'); $('reviewDialog').close(); } catch { /* toast */ }
};

/* ---------- shift report ---------- */
function showReport(r) {
  $('repTitle').textContent = `Shift ${r.shift} report`;
  $('repEyebrow').textContent = `${r.focusMin}-minute focus block over. Take your break and run the pass`;
  const stat = (v, l) => `<div class="stat"><b>${v}</b><small>${l}</small></div>`;
  const notes = [];
  if (r.blockedMs > 60000) notes.push(`Your agents spent ${mmss(r.blockedMs)} waiting on you this shift. Plan big tickets first so they ask less.`);
  if (r.focusBreaks > 0) notes.push(`You broke focus ${r.focusBreaks} time${r.focusBreaks > 1 ? 's' : ''} to act mid-shift.`);
  if (r.burntShipped > 0) notes.push(`${r.burntShipped} plate${r.burntShipped > 1 ? 's' : ''} shipped with failing tests.`);
  if (!notes.length) notes.push('Clean shift. Now clear the pass.');
  $('repBody').innerHTML = [
    stat(r.score >= 0 ? `+${r.score}` : r.score, 'Points this shift'), stat(r.shipped, 'Shipped to main'), stat(r.firstTime, 'Right first time'),
    stat(r.sentBack, 'Sent back'), stat(r.conflicts, 'Spoiled (merge conflicts)'), stat(mmss(r.blockedMs), 'Agents blocked on you'),
    stat(r.focusBreaks, 'Times you broke focus'), stat(`$${r.costUsd.toFixed(2)}`, 'Spend'), stat(`${r.waiting} / ${r.atPass}`, 'Questions / plates waiting now'),
    ...notes.map(n => `<div class="note">${esc(n)}</div>`),
  ].join('');
  $('reportDialog').showModal();
}
$('repClose').onclick = () => $('reportDialog').close();

connect();
