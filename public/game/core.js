// Shared state and small helpers. Everything else imports from here; this imports nothing.
export const $ = id => document.getElementById(id);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const mmss = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The latest server snapshot lives in G.S. */
/** In a town, G.S is the kitchen being drawn, G.own is always yours, and G.visit is { of, relation, rights, owner } while you stand in somebody else's. */
export const G = { S: null, offset: 0, own: null, visit: null };
/** What the server will take from you in the kitchen you are standing in. In your own, everything. */
export const can = right => !G.visit || !!G.visit.rights?.[right];
/** The route for the kitchen you are standing in: a visitor answers and approves through the town's routes. */
export function kpath(path) {
  const v = G.visit; if (!v) return path;
  let m;
  if ((m = path.match(/^\/api\/questions\/([\w-]+)\/answer$/))) return `/api/world/kitchens/${v.of}/questions/${m[1]}/answer`;
  if ((m = path.match(/^\/api\/orders\/(\d+)\/(review|diff)$/))) return `/api/world/kitchens/${v.of}/orders/${m[1]}/${m[2]}`;
  return path;
}
/** Why a visitor may not do that here, in words for a toast or a bubble. */
export function whyNot(right) {
  const v = G.visit; if (!v) return '';
  if (v.sign === 'private') return `${v.owner}'s kitchen is private: visitors can only watch.`;
  if (right === 'answer') return `Only ${v.owner}'s team can answer here, unless the door says "Help wanted".`;
  if (right === 'approve') return `Only ${v.owner}'s team can approve at this pass.`;
  return `You are visiting. Only ${v.owner} can do that.`;
}
/** True in your own kitchen: not in the park and not visiting. town.js keeps body[data-zone]. */
export const atHome = () => (document.body.dataset.zone || 'kitchen') === 'kitchen';
export const nowS = () => Date.now() + G.offset;
export const orderOf = id => G.S?.orders.find(o => o.id === id);
export const chefById = id => G.S?.chefs.find(c => c.id === id);
export const chefName = id => chefById(id)?.name || id;
export const questionFor = chefId => G.S?.questions.find(q => q.chefId === chefId);
export const escalation = () => {
  const pace = G.S?.pace || 1;
  return { smokeMs: G.S?.escalation?.smokeMs ?? 20000 / pace, fireMs: G.S?.escalation?.fireMs ?? 60000 / pace };
};
/** 'claude-opus-5-5' -> 'Opus 5.5' */
/** The demo's short shift with simulated chefs plays as one arcade round: nothing is held back for a break. */
export const arcade = () => G.S?.driver === 'sim' && (G.S.shift?.focusMin ?? 25) <= 5;
/** True while a pomodoro focus block is holding questions back. Never in an arcade round. */
export const quiet = () => G.S?.shift?.mode === 'focus' && !arcade();
/** A title card, help sheet or dialog is in front of the kitchen: the keys belong to it. */
export const modal = () => !!document.querySelector('dialog[open], .overlay.open');
/** localStorage that never throws (private windows, blocked storage). */
export const store = {
  get(k) { try { return localStorage.getItem(`shipshift.${k}`); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(`shipshift.${k}`, v); } catch { /* not kept */ } },
};
export const modelName = m => {
  const x = /claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(m || '');
  return x ? `${x[1][0].toUpperCase()}${x[1].slice(1)} ${x[2]}${x[3] && x[3].length < 3 ? '.' + x[3] : ''}` : (m || '');
};

/** Counters the headless check reads to prove the juice fired. */
export const fx = { popups: 0, shakes: 0, sounds: 0, banners: 0 };

const listeners = {};
export const on = (name, fn) => { (listeners[name] ||= []).push(fn); };
export const emit = (name, ...args) => { for (const fn of listeners[name] || []) fn(...args); };

export async function api(path, body = {}, { quiet = false } = {}) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { emit('gone'); throw new Error('The kitchen has closed'); }
  if (!res.ok && quiet) throw new Error(data.error || String(res.status));
  if (!res.ok) { toast(data.error || `Request failed (${res.status})`, 'bad'); emit('sfx', 'err'); throw new Error(data.error || String(res.status)); }
  return data;
}
export async function getJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

let lastToast = { m: '', t: 0 };
export function toast(msg, kind = '') {
  if (msg === lastToast.m && performance.now() - lastToast.t < 1500) return;
  lastToast = { m: msg, t: performance.now() };
  const el = document.createElement('div'); el.className = `toast ${kind}`; el.textContent = msg;
  $('toasts').append(el);
  while ($('toasts').children.length > 2) $('toasts').firstChild.remove();
  setTimeout(() => el.classList.add('out'), 2600); setTimeout(() => el.remove(), 3000);
}

/** Inline icons, so nothing depends on an emoji font. */
const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}>${d}</svg>`;
export const ICON = {
  q: svg('<path d="M8 8.5a4 4 0 1 1 6.2 3.3c-1.3.9-2.2 1.6-2.2 3.2" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/><circle cx="12" cy="19.6" r="1.9" fill="currentColor"/>'),
  tick: svg('<path d="M5 12.5l4.6 4.6L19 7.6" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>'),
  flame: svg('<path d="M12 2c1 4 5 5.500 5 10.500a5 5 0 0 1-10 0c0-2 1-3.200 2-4.200.3 1.700 1 2.500 1.800 2.700C10.300 8 10.800 5 12 2z" fill="currentColor"/>'),
  smoke: svg('<circle cx="8" cy="14" r="5" fill="currentColor"/><circle cx="15" cy="15" r="4.500" fill="currentColor"/><circle cx="12.500" cy="8.500" r="4.500" fill="currentColor"/>'),
  install: svg('<path d="M12 3v10m0 0l-4-4m4 4l4-4M5 17v3h14v-3" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>'),
  network: svg('<circle cx="12" cy="12" r="8.500" fill="none" stroke="currentColor" stroke-width="2.400"/><path d="M3.500 12h17M12 3.500c3 3 3 14 0 17M12 3.500c-3 3-3 14 0 17" fill="none" stroke="currentColor" stroke-width="2"/>'),
  delete: svg('<path d="M5 7h14M10 7V4.500h4V7M7 7l1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="2.600" stroke-linecap="round" stroke-linejoin="round"/>'),
  snow: svg('<path d="M12 3v18M4.200 7.500l15.600 9M19.800 7.500l-15.600 9" fill="none" stroke="currentColor" stroke-width="2.600" stroke-linecap="round"/>'),
  star: svg('<path d="M12 2.500l2.900 6 6.600.9-4.800 4.600 1.200 6.500L12 17.400l-5.900 3.100 1.200-6.500L2.500 9.400l6.600-.9z" fill="currentColor"/>'),
  wait: svg('<path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9" fill="none" stroke="currentColor" stroke-width="2.400" stroke-linecap="round"/>'),
  plate: svg('<ellipse cx="12" cy="14" rx="9.500" ry="5" fill="none" stroke="currentColor" stroke-width="2.400"/><path d="M6.500 12.500a5.500 5.500 0 0 1 11 0" fill="currentColor"/>'),
  coin: svg('<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.400"/><path d="M14.800 9.200c-.5-1-1.500-1.500-2.800-1.500-1.600 0-2.800.8-2.800 2.100 0 3 5.800 1.300 5.800 4.300 0 1.300-1.300 2.200-3 2.200-1.400 0-2.600-.6-3.100-1.700M12 5.800v12.400" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  plus: svg('<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="3.200" stroke-linecap="round"/>'),
  sound: svg('<path d="M4 9.500v5h3.500L12 18.500v-13L7.500 9.500z" fill="currentColor"/><path d="M15.500 9a4.500 4.500 0 0 1 0 6M18 6.500a8 8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2.200" stroke-linecap="round"/>'),
  mute: svg('<path d="M4 9.500v5h3.500L12 18.500v-13L7.500 9.500z" fill="currentColor"/><path d="M16 9.500l5 5M21 9.500l-5 5" fill="none" stroke="currentColor" stroke-width="2.400" stroke-linecap="round"/>'),
  list: svg('<path d="M5 7h14M5 12h14M5 17h14" fill="none" stroke="currentColor" stroke-width="2.800" stroke-linecap="round"/>'),
  oven: svg('<rect x="4" y="4" width="16" height="16" rx="2.500" fill="none" stroke="currentColor" stroke-width="2.400"/><rect x="7.500" y="10" width="9" height="6.500" rx="1" fill="currentColor"/><path d="M7.500 7h9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  link: svg('<path d="M9.500 14.500l5-5M8 11l-2 2a3.500 3.500 0 0 0 5 5l2-2M16 13l2-2a3.500 3.500 0 0 0-5-5l-2 2" fill="none" stroke="currentColor" stroke-width="2.600" stroke-linecap="round"/>'),
  help: svg('<path d="M8.500 9a3.600 3.600 0 1 1 5.600 3c-1.200.8-2.100 1.500-2.100 3" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="12" cy="19.300" r="1.800" fill="currentColor"/>'),
  screen: svg('<rect x="3" y="4.500" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2.400"/><path d="M8 20.500h8M12 16.500v4" fill="none" stroke="currentColor" stroke-width="2.400" stroke-linecap="round"/>'),
  ticket: svg('<path d="M6 3.500h12v17l-3-2-3 2-3-2-3 2z" fill="none" stroke="currentColor" stroke-width="2.400" stroke-linejoin="round"/><path d="M9 8.500h6M9 12.500h4" stroke="currentColor" stroke-width="2.200" stroke-linecap="round"/>'),
  hat: svg('<path d="M7 14.500a4.200 4.200 0 0 1 1-8.200 4.600 4.600 0 0 1 8 0 4.200 4.200 0 0 1 1 8.200V19.500H7z" fill="none" stroke="currentColor" stroke-width="2.400" stroke-linejoin="round"/><path d="M7 16.500h10" stroke="currentColor" stroke-width="2"/>'),
  eye: svg('<path d="M2.500 12c2.500-4.500 5.700-6.500 9.500-6.500s7 2 9.500 6.500c-2.500 4.500-5.700 6.500-9.500 6.500s-7-2-9.500-6.500z" fill="none" stroke="currentColor" stroke-width="2.400" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="currentColor"/>'),
  rocket: svg('<path d="M12 2.500c3.500 2.500 5 6 5 9.500l-2 4H9l-2-4c0-3.500 1.500-7 5-9.500z" fill="none" stroke="currentColor" stroke-width="2.400" stroke-linejoin="round"/><circle cx="12" cy="10" r="1.900" fill="currentColor"/><path d="M10 19.500l2 2.500 2-2.500" fill="none" stroke="currentColor" stroke-width="2.400" stroke-linecap="round" stroke-linejoin="round"/>'),
  board: svg('<rect x="3.500" y="4" width="4.600" height="16" rx="1.300" fill="currentColor"/><rect x="9.700" y="4" width="4.600" height="10.500" rx="1.300" fill="currentColor"/><rect x="15.900" y="4" width="4.600" height="13.500" rx="1.300" fill="currentColor"/>'),
  restart: svg('<path d="M5.500 12a6.500 6.500 0 1 0 2.200-4.900" fill="none" stroke="currentColor" stroke-width="2.800" stroke-linecap="round"/><path d="M4.500 4.500v4.200h4.200" fill="none" stroke="currentColor" stroke-width="2.800" stroke-linecap="round" stroke-linejoin="round"/>'),
  pencil: svg('<path d="M4 20l1-4.500L16.500 4l3.500 3.500L8.500 19z" fill="none" stroke="currentColor" stroke-width="2.400" stroke-linejoin="round"/>'),
};
