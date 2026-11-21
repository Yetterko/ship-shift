// Quick picks: pre-written, editable prompt chips at every step that needs words, and the Type it prompter.
// Quick picks stand in for typing on a phone (FR-18 to FR-20); the note says so wherever they appear.
import { esc } from './core.js';
import { STATIONS, STATION_LABEL, LIMITS } from '/shared/protocol.js';

export const STAND_IN = 'Quick picks stand in for typing. In the real tool you write these prompts yourself.';
export const standInNote = () => `<p class="fl-note">${esc(STAND_IN)}</p>`;

/** A row of chips. picks: [{ id?, label, prompt, station? }]. used: set of ids already taken (drawn ticked). */
export function chipRow(picks, { used = new Set(), name = 'pick', disabled = false } = {}) {
  if (!picks.length) return '';
  return `<div class="fl-chips" role="list">${picks.map((p, i) => {
    const on = used.has(p.id ?? p.prompt);
    return `<button type="button" class="fl-qp${on ? ' on' : ''}${p.station ? ` st-${p.station}` : ''}" data-${name}="${i}" ${disabled || on ? 'disabled' : ''}>${p.station ? `<i>${esc(STATION_LABEL[p.station] || p.station)}</i>` : ''}<span>${esc(p.label || p.prompt)}</span></button>`;
  }).join('')}</div>`;
}

/** The Station picker for one Item: four small buttons. */
export function stationPicker(current, idx, disabled = false) {
  return `<div class="fl-stations" role="radiogroup" aria-label="Station">${STATIONS.map(s => `<button type="button" role="radio" aria-checked="${s === current}" class="fl-st st-${s}${s === current ? ' on' : ''}" data-station="${idx}:${s}" ${disabled ? 'disabled' : ''}>${esc(STATION_LABEL[s])}</button>`).join('')}</div>`;
}

/**
 * The Item editor of the order pad: the drafts as editable tickets, the chips that add one, and Type it.
 * state: { drafts: [{ prompt, station, quickPickId?, typed }], typing: boolean, typed: string, typedStation }
 */
export function itemEditor(state, picks, { canAct = true } = {}) {
  const used = new Set(state.drafts.map(d => d.quickPickId).filter(Boolean));
  const full = state.drafts.length >= LIMITS.items;
  const tickets = state.drafts.map((d, i) => `
    <li class="fl-draft st-${d.station || 'none'}">
      <div class="fl-draft-top"><b>Item ${i + 1}</b>${canAct ? `<button type="button" class="fl-x" data-remove="${i}" aria-label="Remove Item ${i + 1}">Remove</button>` : ''}</div>
      <textarea class="fl-inline" data-keep="draft${i}" data-edit="${i}" rows="2" maxlength="${LIMITS.prompt}" ${canAct ? '' : 'readonly'} aria-label="Item ${i + 1} prompt">${esc(d.prompt)}</textarea>
      ${stationPicker(d.station, i, !canAct)}
    </li>`).join('');
  const typeBox = `
    <div class="fl-typeit">
      <textarea data-keep="typed" data-typed rows="4" maxlength="${LIMITS.prompt}" placeholder="Write a sub-task for one Chef: what to change, and where." aria-label="Type an Item">${esc(state.typed || '')}</textarea>
      ${stationPicker(state.typedStation, 'typed')}
      <div class="fl-row"><button type="button" class="fl-btn" data-act="addTyped" ${full ? 'disabled' : ''}>Add Item</button><button type="button" class="fl-btn ghost" data-act="typeit">Back to quick picks <kbd>T</kbd></button></div>
    </div>`;
  const chips = canAct ? `${chipRow(picks, { used, disabled: full })}<div class="fl-row"><button type="button" class="fl-btn ghost" data-act="typeit">Type it <kbd>T</kbd></button><small class="fl-count">${state.drafts.length} of ${LIMITS.items} Items</small></div>` : '';
  return `
    <ol class="fl-drafts">${tickets || `<li class="fl-empty">${canAct ? 'No Items yet. Tap a quick pick to add one, or Type it.' : 'No Items written yet.'}</li>`}</ol>
    ${canAct ? (state.typing ? typeBox : chips) : ''}
    ${standInNote()}`;
}

/** Wires an editor's events. onChange runs after every edit so the caller can redraw or save. */
export function wireEditor(root, state, picks, onChange) {
  root.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => {
    const p = picks[+b.dataset.pick]; if (!p || state.drafts.length >= LIMITS.items) return;
    state.drafts.push({ prompt: p.prompt, station: p.station, quickPickId: p.id, typed: false });
    onChange('add');
  });
  root.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => { state.drafts.splice(+b.dataset.remove, 1); onChange('remove'); });
  root.querySelectorAll('[data-edit]').forEach(t => t.oninput = () => {
    const d = state.drafts[+t.dataset.edit]; if (!d) return;
    d.prompt = t.value.slice(0, LIMITS.prompt);
    // an edited quick pick is still a quick pick on the server's side (its scripted Meal), but it is now the player's words
    d.edited = true;
    onChange('edit', false);
  });
  root.querySelectorAll('[data-station]').forEach(b => b.onclick = () => {
    const [i, s] = b.dataset.station.split(':');
    if (i === 'typed') state.typedStation = s; else if (state.drafts[+i]) state.drafts[+i].station = s;
    onChange('station');
  });
  const typed = root.querySelector('[data-typed]');
  if (typed) typed.oninput = () => { state.typed = typed.value.slice(0, LIMITS.prompt); };
  root.querySelectorAll('[data-act="typeit"]').forEach(b => b.onclick = () => toggleTyping(state, onChange));
  const add = root.querySelector('[data-act="addTyped"]');
  if (add) add.onclick = () => addTyped(state, onChange);
}
export function toggleTyping(state, onChange) {
  state.typing = !state.typing; onChange('typing');
  if (state.typing) setTimeout(() => document.querySelector('[data-typed]')?.focus(), 0);
}
export function addTyped(state, onChange) {
  const text = (state.typed || '').trim();
  if (!text || state.drafts.length >= LIMITS.items) return false;
  state.drafts.push({ prompt: text, station: state.typedStation || 'backend', typed: true });
  state.typed = ''; onChange('add');
  return true;
}

/** A single-text step (a redo reason, a serve note): chips that fill the box, and the box itself. */
export function textStep(chips, value, { keep, placeholder, max = 300, canAct = true, name = 'say' } = {}) {
  if (!canAct) return '';
  return `${chipRow(chips.map(c => ({ label: c, prompt: c })), { name })}
    <textarea class="fl-inline" data-keep="${keep}" data-${name}-box rows="2" maxlength="${max}" placeholder="${esc(placeholder)}">${esc(value || '')}</textarea>
    ${standInNote()}`;
}
export function wireTextStep(root, chips, state, field, name = 'say') {
  const box = root.querySelector(`[data-${name}-box]`);
  root.querySelectorAll(`[data-${name}]`).forEach(b => b.onclick = () => {
    const c = chips[+b.dataset[name]]; if (!c) return;
    // one tap adds a chip; a second chip joins the first, and the box stays editable
    state[field] = state[field] && !state[field].includes(c) ? `${state[field].replace(/[.\s]*$/, '')}. ${c}` : c;
    if (box) { box.value = state[field]; box.focus(); }
  });
  if (box) box.oninput = () => { state[field] = box.value; };
}
