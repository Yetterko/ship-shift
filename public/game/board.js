// The board: every order in every state at once, as a kanban, with each card's actions on the card.
// It is the fast and accessible path for everything the walking does: plan, send to a chef, answer, call out, review, ship,
// resume, bin, new order, and the shift clock. Nothing here stops the kitchen.
//
// createBoard(el, actions) knows nothing about this page: it draws whatever state it is given and calls the actions it was
// handed. An action that is missing leaves its button off the card, so the same board can show a kitchen you may only look at
// (the town's chalkboard) by passing fewer actions.
import { esc, mmss, modelName } from './core.js';

const LANES = [
  ['waiting', 'Waiting', 'Tickets at the window'],
  ['planning', 'Planning', 'On the prep board'],
  ['cooking', 'Cooking', 'A chef is writing the code'],
  ['blocked', 'Blocked', 'A chef needs you'],
  ['oven', 'Oven', 'Tests are running'],
  ['pass', 'Pass', 'Ready for your review'],
  ['shipped', 'Shipped', 'Merged into main'],
];
const laneOf = (o, S) => (o.state === 'waiting' ? 'waiting' : o.state === 'planning' ? 'planning' : o.state === 'stalled' || S.questions.some(q => q.orderId === o.id) ? 'blocked'
  : o.state === 'cooking' ? 'cooking' : o.state === 'testing' ? 'oven' : o.state === 'at_pass' || o.state === 'merging' ? 'pass' : o.state === 'shipped' ? 'shipped' : null);

export function createBoard(el, act = {}, { now = () => Date.now(), title = 'The board' } = {}) {
  let S = null;
  const cards = new Map();        // order id -> { el, html, lane }
  const steps = new Map();        // question id -> { step, answers } for questions with several parts
  const armed = new Map();        // order id -> time its Bin button stops being armed
  const btn = (name, label, cls = '') => (act[name] ? `<button class="btn small ${cls}" type="button" data-act="${name}">${label}</button>` : '');

  el.innerHTML = `
    <div class="board-head">
      <h2>${esc(title)}</h2>
      <span class="board-tools">
        ${act.newOrder ? '<button class="btn small" type="button" data-act="newOrder">New order</button>' : ''}
        ${act.shift ? '<span class="shiftbox"><label>Focus <input data-min="focus" type="number" min="1" max="90" inputmode="numeric"></label><label>Break <input data-min="break" type="number" min="1" max="30" inputmode="numeric"></label><button class="btn small" type="button" data-act="shift">Start shift</button></span>' : ''}
        <button class="rb" type="button" data-act="close" title="Close (Esc)" aria-label="Close the board">×</button>
      </span>
    </div>
    <nav class="board-tabs" aria-label="Jump to a column">${LANES.map(([k, name]) => `<button type="button" data-lane="${k}">${name}<b data-count="${k}">0</b></button>`).join('')}</nav>
    <div class="lanes">${LANES.map(([k, name, what]) => `<section class="lane" data-lane="${k}" aria-label="${name}"><header><h3>${name}</h3><small>${what}</small></header><div class="lane-body" data-body="${k}"></div></section>`).join('')}</div>
    <div class="board-foot"><b>Score feed</b><ol data-feed></ol></div>`;
  const q$ = sel => el.querySelector(sel);

  /* ---------- one card ---------- */
  function questionHtml(q) {
    if (q.kind === 'question') {
      const st = steps.get(q.id) || { step: 0, answers: {} };
      const cur = q.questions[st.step] || q.questions[0] || { question: 'Needs an answer', options: [] };
      return `<div class="bq">${q.questions.length > 1 ? `<small>${st.step + 1}/${q.questions.length}</small> ` : ''}${esc(cur.question)}</div>
        ${act.answer ? `<div class="opts">${(cur.options || []).slice(0, 4).map((op, i) => `<button class="opt" type="button" data-act="pick" data-i="${i}"><b>${esc(op.label)}</b>${op.description ? `<small>${esc(op.description)}</small>` : ''}</button>`).join('')}</div>
        <form class="line" data-form="typed"><input name="text" maxlength="300" placeholder="Or type your answer" aria-label="Type your answer"><button class="btn small" type="submit">Send</button></form>
        <div class="acts"><button class="btn small ghost" type="button" data-act="skip">Your call</button></div>` : ''}`;
    }
    const detail = String(q.input?.command ?? q.reason ?? q.toolName ?? '').slice(0, 160);
    return `<div class="bq">May I run this?</div>${detail ? `<code>${esc(detail)}</code>` : ''}
      ${act.answer ? `<div class="acts"><button class="btn small ship" type="button" data-act="allow">Once</button>${q.grantClass ? `<button class="btn small" type="button" data-act="always">Always this shift</button>` : ''}<button class="btn small danger" type="button" data-act="deny">No</button></div>
      <form class="line" data-form="typed"><input name="text" maxlength="300" placeholder="No, with a note" aria-label="Say no with a note"><button class="btn small" type="submit">Send</button></form>` : ''}`;
  }
  function cardHtml(o, lane) {
    const chef = S.chefs.find(c => c.id === o.chefId), q = S.questions.find(x => x.orderId === o.id);
    const last = o.activity.at(-1)?.text || '';
    const chips = [
      o.plan ? '<span class="chip2 plan">planned</span>' : '',
      ...(o.grants || []).map(g => `<span class="chip2 ${esc(g)}">${esc(g)}</span>`),
      o.tests ? `<span class="chip2 ${o.tests.ok ? 'ok' : 'bad'}">tests ${o.tests.ok ? 'pass' : 'fail'}</span>` : '',
      o.merge?.clean === false ? '<span class="chip2 cold">cold</span>' : '',
      o.approved ? '<span class="chip2 gold">approved</span>' : '',
      o.rounds ? `<span class="chip2 warn">round ${o.rounds + 1}</span>` : '',
      o.refires ? `<span class="chip2 warn">re-fired</span>` : '',
    ].join('');
    const since = lane === 'waiting' ? o.createdAt : lane === 'pass' ? o.atPassAt : lane === 'shipped' ? 0 : q ? q.createdAt : o.assignedAt;
    const bin = act.bin && lane !== 'shipped' ? `<button class="btn small ghost" type="button" data-act="bin">${armed.has(o.id) ? 'Really bin?' : 'Bin'}</button>` : '';
    let body = '', acts = '';
    if (lane === 'waiting') {
      const free = S.chefs.filter(c => !c.orderId);
      const send = act.assign ? `<select data-act="assign" aria-label="Send #${o.id} to a chef"${free.length ? '' : ' disabled'}><option value="">${free.length ? 'Send to chef ▾' : 'Every chef is busy'}</option>${S.chefs.map(c => `<option value="${esc(c.id)}"${c.orderId ? ' disabled' : ''}>${esc(c.name)}${c.orderId ? ` (busy with #${c.orderId})` : ''}</option>`).join('')}</select>` : '';
      body = o.body ? `<p>${esc(o.body.slice(0, 160))}</p>` : '';
      if (o.error) body += `<p class="err">${esc(o.error)}</p>`;
      acts = (o.plan ? '' : btn('plan', 'Plan')) + send + bin;
    } else if (lane === 'planning') {
      body = `<p class="feedline"><span class="spin"></span>${esc(last)}</p>`; acts = bin;
    } else if (lane === 'cooking') {
      body = `<p class="feedline">${esc(last)}</p>${act.steer ? `<form class="line" data-form="steer"><input name="text" maxlength="300" placeholder="Call out one line" aria-label="Call out to ${esc(chef?.name || 'the chef')}"><button class="btn small" type="submit">Call out</button></form>` : ''}`;
      acts = bin;
    } else if (lane === 'blocked') {
      if (q) body = questionHtml(q);
      else { body = `<p class="err">${esc(o.error || 'The agent stopped.')}</p>`; acts = btn('resume', 'Resume', 'ship'); }
      acts += bin;
    } else if (lane === 'oven') {
      body = `<p class="feedline"><span class="spin"></span>Running ${esc(S.testCmd || 'the tests')}</p>`; acts = bin;
    } else if (lane === 'pass') {
      const merging = o.state === 'merging';
      body = o.diff?.stat ? `<p>${o.diff.stat.files} files, +${o.diff.stat.added} −${o.diff.stat.removed}</p>` : '';
      acts = merging ? '<span class="feedline"><span class="spin"></span>Merging</span>' : btn('review', o.approved ? 'Look again' : 'Review', o.approved ? 'ghost' : '') + (o.approved ? btn('ship', o.merge?.clean === false ? 'Ship cold' : 'Ship it', 'ship') : '') + bin;
    } else if (lane === 'shipped') {
      const pts = S.stats.points.filter(p => p.orderId === o.id).reduce((n, p) => n + p.n, 0);
      body = `<p>${pts ? `${pts > 0 ? '+' : ''}${pts} points` : 'Served'}${o.rounds ? ` · ${o.rounds + 1} rounds` : ' · first time'}</p>`;
    }
    return `<div class="bc-head"><b>#${o.id}</b><span class="sz ${o.size}">${o.size}</span>${chef ? `<span class="who">${esc(chef.name)}<i>${esc(modelName(chef.model))}</i></span>` : ''}${since ? `<i class="age" data-since="${since}"></i>` : ''}</div>
      <h4>${esc(o.title)}</h4>${chips ? `<div class="chips">${chips}</div>` : ''}${body}${acts ? `<div class="acts">${acts}</div>` : ''}`;
  }

  /* ---------- drawing: a card is only touched when it changed, and never while you are typing in it ---------- */
  function render(state) {
    S = state; if (!S) return;
    const t = now();
    for (const [id, until] of armed) if (t > until) armed.delete(id);
    const seen = new Set(), counts = Object.fromEntries(LANES.map(([k]) => [k, 0]));
    const shipped = S.orders.filter(o => o.state === 'shipped').sort((a, b) => (b.shippedAt || 0) - (a.shippedAt || 0));
    const order = [...S.orders.filter(o => o.state !== 'shipped').sort((a, b) => a.id - b.id), ...shipped.slice(0, 12)];
    counts.shipped = shipped.length;
    for (const o of order) {
      const lane = laneOf(o, S); if (!lane) continue;
      if (lane !== 'shipped') counts[lane]++;
      seen.add(o.id);
      const html = cardHtml(o, lane);
      let c = cards.get(o.id);
      if (!c) { c = { el: document.createElement('article'), html: '', lane: '' }; c.el.className = 'bcard'; c.el.dataset.order = o.id; cards.set(o.id, c); }
      const typing = c.el.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
      if (c.html !== html && !typing) { c.el.innerHTML = html; c.html = html; c.el.className = `bcard ${lane}${S.questions.some(q => q.orderId === o.id) ? ' asks' : ''}`; }
      if (c.lane !== lane && !typing) { c.lane = lane; }
      const body = q$(`[data-body="${c.lane || lane}"]`);
      if (c.el.parentNode !== body) body.append(c.el);
    }
    // keep each lane in order: lowest number first, newest ship first
    for (const [k] of LANES) { const body = q$(`[data-body="${k}"]`); let prev = null; for (const o of order) { const c = cards.get(o.id); if (!c || c.el.parentNode !== body) continue; if (prev ? prev.nextSibling !== c.el : body.firstChild !== c.el) body.insertBefore(c.el, prev ? prev.nextSibling : body.firstChild); prev = c.el; } }
    for (const [id, c] of cards) if (!seen.has(id)) { c.el.remove(); cards.delete(id); }
    for (const [k] of LANES) {
      const n = counts[k]; q$(`[data-count="${k}"]`).textContent = n;
      q$(`section[data-lane="${k}"]`).classList.toggle('empty', !n);
      q$(`.board-tabs [data-lane="${k}"]`).classList.toggle('some', n > 0);
      q$(`.board-tabs [data-lane="${k}"]`).classList.toggle('hot', k === 'blocked' && n > 0);
    }
    for (const a of el.querySelectorAll('[data-since]')) { const s = mmss(t - Number(a.dataset.since)); if (a.textContent !== s) a.textContent = s; }
    const feed = S.stats.points.slice(-6).reverse().map(p => `<li class="${p.n >= 0 ? 'good' : 'bad'}"><b>${p.n > 0 ? '+' : ''}${p.n}</b> ${esc(p.why)}</li>`).join('') || '<li>Nothing scored yet</li>';
    if (q$('[data-feed]').innerHTML !== feed) q$('[data-feed]').innerHTML = feed;
    if (act.shift) {
      const sh = S.shift, b = q$('[data-act="shift"]'), label = sh.mode === 'off' ? 'Start shift' : `End shift (${mmss(Math.max(0, (sh.endsAt || t) - t))})`;
      if (b.textContent !== label) b.textContent = label;
      for (const [k, v] of [['focus', sh.focusMin], ['break', sh.breakMin]]) { const i = q$(`[data-min="${k}"]`); if (!i.value && document.activeElement !== i) i.value = v; }
    }
  }

  /* ---------- actions ---------- */
  const orderOf = t => { const id = Number(t.closest('.bcard')?.dataset.order); return S?.orders.find(o => o.id === id); };
  const done = () => render(S);
  el.addEventListener('click', e => {
    const lane = e.target.closest('.board-tabs [data-lane]');
    if (lane) { q$(`section[data-lane="${lane.dataset.lane}"]`).scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' }); return; }
    const b = e.target.closest('button[data-act]'); if (!b || !S) return;
    const name = b.dataset.act;
    if (name === 'close' || name === 'newOrder') return act[name]?.();
    if (name === 'shift') return act.shift(S.shift.mode === 'off', { focusMin: Number(q$('[data-min="focus"]').value), breakMin: Number(q$('[data-min="break"]').value) });
    const o = orderOf(b); if (!o) return;
    const q = S.questions.find(x => x.orderId === o.id);
    if (name === 'bin') { if (!armed.has(o.id)) { armed.set(o.id, now() + 4000); return done(); } armed.delete(o.id); return act.bin(o); }
    if (name === 'plan' || name === 'resume' || name === 'review' || name === 'ship') return act[name](o);
    if (!q) return;
    if (name === 'allow') return act.answer(q, { allow: true });
    if (name === 'always') return act.answer(q, { allow: true, always: true });
    if (name === 'deny') return act.answer(q, { allow: false });
    if (name === 'skip') return act.answer(q, { allow: false, message: 'Skipped by the head chef. Use your best judgement and say what you assumed.' });
    if (name === 'pick') {
      const st = steps.get(q.id) || { step: 0, answers: {} }, cur = q.questions[st.step], op = cur?.options?.[Number(b.dataset.i)]; if (!op) return;
      st.answers[cur.question] = op.label;
      if (st.step + 1 < q.questions.length) { st.step++; steps.set(q.id, st); return done(); }
      steps.delete(q.id); return act.answer(q, { allow: true, answers: st.answers });
    }
  });
  el.addEventListener('change', e => {
    const s = e.target.closest('select[data-act="assign"]'); if (!s || !s.value) return;
    const o = orderOf(s), chefId = s.value; s.value = ''; s.blur();
    if (o) act.assign(o, chefId);
  });
  el.addEventListener('submit', e => {
    const f = e.target.closest('form[data-form]'); if (!f) return;
    e.preventDefault();
    const text = f.elements.text.value.trim(), o = orderOf(f); if (!text || !o) return;
    f.elements.text.value = ''; f.elements.text.blur();
    if (f.dataset.form === 'steer') return act.steer(o, text);
    const q = S.questions.find(x => x.orderId === o.id); if (!q) return;
    if (q.kind !== 'question') return act.answer(q, { allow: false, message: text });
    const st = steps.get(q.id) || { step: 0, answers: {} }, cur = q.questions[st.step];
    st.answers[cur.question] = text;
    if (st.step + 1 < q.questions.length) { st.step++; steps.set(q.id, st); return done(); }
    steps.delete(q.id); return act.answer(q, { allow: true, answers: st.answers });
  });
  return { render, el };
}
