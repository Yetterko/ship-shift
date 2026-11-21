// ScriptedKitchen: Demo-mode Meals and Feedback. No API. One Meal per quick pick, a closest match for typed Items
// ("set menu"), and Feedback per Order. Order 3's first review is "not satisfied" (spec 8.3).
import { DEFAULT_COOK_MS } from '../content/orders.mjs';

/** @type {Record<string, {match:string, summary:string, file:string, code:string, station:string}>} */
const MEALS = {
  'o1-a': {
    station: 'backend', match: 'backend totalHours staffId shifts api.js summed hours total',
    summary: 'Added totalHours(staffId, shifts) to api.js with a small hoursOf helper. Pure functions, no DOM code.', file: 'api.js',
    code: `/**
 * Total hours one staff member works across the week.
 * @param {string} staffId
 * @param {{staffId:string,start:string,end:string}[]} shifts
 * @returns {number}
 */
export function totalHours(staffId, shifts) {
  return getShiftsFor(staffId, shifts)
    .reduce((sum, shift) => sum + hoursOf(shift), 0);
}

/** Length of one shift in hours, from "HH:MM" strings. */
function hoursOf(shift) {
  const [sh, sm] = shift.start.split(':').map(Number);
  const [eh, em] = shift.end.split(':').map(Number);
  return (eh * 60 + em - (sh * 60 + sm)) / 60;
}`,
  },
  'o1-b': {
    station: 'frontend', match: 'frontend total column roster table weekly hours person',
    summary: 'Added a Total column to the roster: one header cell and one cell per row, filled from totalHours.', file: 'ui.js',
    code: `export function renderRoster(staff, shifts) {
  const head = DAYS.map(d => \`<th>\${d}</th>\`).join('') + '<th class="total">Total</th>';
  const rows = staff.map(person => rosterRow(person, shifts)).join('');
  table.innerHTML = \`<thead><tr><th></th>\${head}</tr></thead><tbody>\${rows}</tbody>\`;
}

function rosterRow(person, shifts) {
  const cells = DAYS.map(day => \`<td>\${cellFor(person.id, day, shifts)}</td>\`).join('');
  const total = totalHours(person.id, shifts);
  return \`<tr><th>\${person.name}</th>\${cells}<td class="total">\${total} h</td></tr>\`;
}

/* styles.css */
.total { font-weight: 700; text-align: right; border-left: 2px solid #ddd; }`,
  },
  'o2-a': {
    station: 'frontend', match: 'frontend dark theme mode css variables header toggle localStorage remembers',
    summary: 'Moved the colours to CSS variables, added a dark theme, and a header toggle that saves the choice in localStorage.', file: 'styles.css',
    code: `:root { --bg: #ffffff; --ink: #1d1d24; --line: #dcdce4; --accent: #2f6fed; }
:root[data-theme="dark"] { --bg: #16161d; --ink: #f1f1f6; --line: #34343f; --accent: #8ab4ff; }
body { background: var(--bg); color: var(--ink); }
th, td { border: 1px solid var(--line); }

/* index.html, inside <header> */
<button id="themeToggle" type="button" aria-pressed="false">Dark mode</button>

// ui.js
const KEY = 'rosterette-theme';
export function initTheme() {
  const button = document.getElementById('themeToggle');
  const apply = theme => {
    document.documentElement.dataset.theme = theme;
    button.setAttribute('aria-pressed', String(theme === 'dark'));
  };
  apply(localStorage.getItem(KEY) || 'light');
  button.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(KEY, next);
    apply(next);
  });
}`,
  },
  'o2-b': {
    station: 'integration', match: 'integration self-check checks.js toggle switches theme',
    summary: 'Added a self-check that clicks the toggle and confirms the theme flips, then puts it back.', file: 'checks.js',
    code: `check('the dark mode toggle switches the theme', () => {
  const root = document.documentElement;
  const button = document.getElementById('themeToggle');
  const before = root.dataset.theme;
  button.click();
  const flipped = root.dataset.theme !== before;
  button.click(); // leave the page as we found it
  return flipped && root.dataset.theme === before;
});

// main.js
initTheme();`,
  },
  'o3-a': {
    station: 'database', match: 'database overlapping shift seed data shifts.json overlap',
    summary: 'Added one shift for Ana on Wednesday that overlaps her existing 09:00 to 15:00 shift. JSON stays valid.', file: 'data/shifts.json',
    code: `  { "id": "sh14", "staffId": "s1", "day": "Wed", "start": "09:00", "end": "15:00" },
  { "id": "sh15", "staffId": "s1", "day": "Wed", "start": "14:00", "end": "18:00" }

<!-- data/schema.md -->
Two shifts for the same staffId on the same day may overlap in the seed data
(sh14 and sh15). The app must flag them; it must not reject them.`,
  },
  'o3-b': {
    station: 'backend', match: 'backend findOverlaps shifts api.js clashing pairs overlap',
    summary: 'Added findOverlaps(shifts) to api.js. It returns every pair of shifts for the same person and day whose times cross.', file: 'api.js',
    code: `/**
 * Pairs of shifts that clash: same staff member, same day, times crossing.
 * @param {{id:string,staffId:string,day:string,start:string,end:string}[]} shifts
 * @returns {[object, object][]}
 */
export function findOverlaps(shifts) {
  const pairs = [];
  for (let i = 0; i < shifts.length; i++) {
    for (let j = i + 1; j < shifts.length; j++) {
      if (clash(shifts[i], shifts[j])) pairs.push([shifts[i], shifts[j]]);
    }
  }
  return pairs;
}

function clash(a, b) {
  return a.staffId === b.staffId && a.day === b.day
    && a.start < b.end && b.start < a.end;
}`,
  },
  'o3-c': {
    station: 'frontend', match: 'frontend highlight clashing cells red roster',
    summary: 'Clashing cells now get a red background and border. I did not get to the tooltip.', file: 'ui.js',
    code: `export function markClashes(pairs) {
  for (const [a, b] of pairs) {
    for (const shift of [a, b]) {
      const cell = document.querySelector(\`[data-shift="\${shift.id}"]\`);
      if (cell) cell.classList.add('clash');
    }
  }
}

/* styles.css */
.clash { background: #ffe1e1; outline: 2px solid #d92d2d; color: #7a0c0c; }`,
  },
  'o3-d': {
    station: 'frontend', match: 'frontend tooltip clashing cell names shift clashes with title',
    summary: 'Each clashing cell now carries a tooltip naming the shift it clashes with, and an aria-label for screen readers.', file: 'ui.js',
    code: `export function markClashes(pairs) {
  for (const [a, b] of pairs) {
    tag(a, b);
    tag(b, a);
  }
}

function tag(shift, other) {
  const cell = document.querySelector(\`[data-shift="\${shift.id}"]\`);
  if (!cell) return;
  const note = \`Clashes with \${formatShift(other)}\`;
  cell.classList.add('clash');
  cell.title = note;
  cell.setAttribute('aria-label', \`\${formatShift(shift)}. \${note}\`);
}`,
  },
  'o4-a': {
    station: 'database', match: 'database role field staff member 5th fifth schema.md',
    summary: 'Every staff member now has a role, a 5th person (Eli) joins, and schema.md describes the new field.', file: 'data/staff.json',
    code: `[
  { "id": "s1", "name": "Ana", "role": "barista" },
  { "id": "s2", "name": "Ben", "role": "cook" },
  { "id": "s3", "name": "Cleo", "role": "barista" },
  { "id": "s4", "name": "Dee", "role": "floor" },
  { "id": "s5", "name": "Eli", "role": "cook" }
]

<!-- data/schema.md -->
staff.json: { id: string, name: string, role: "barista" | "cook" | "floor" }
role is required. Add new roles here before using them in the data.`,
  },
  'o4-b': {
    station: 'frontend', match: 'frontend role filter dropdown above roster select all roles',
    summary: 'Added a labelled role dropdown above the roster with an "All roles" option. It reports the choice through onRoleChange.', file: 'ui.js',
    code: `export function renderRoleFilter(roles, onRoleChange) {
  const wrap = document.getElementById('filters');
  const options = ['<option value="">All roles</option>']
    .concat(roles.map(r => \`<option value="\${r}">\${r}</option>\`));
  wrap.innerHTML = \`<label for="roleFilter">Role</label>
    <select id="roleFilter">\${options.join('')}</select>\`;
  wrap.querySelector('select')
    .addEventListener('change', e => onRoleChange(e.target.value));
}

/* index.html, above the roster table */
<div id="filters" class="filters"></div>`,
  },
  'o4-c': {
    station: 'integration', match: 'integration wire role filter api main.js self-check',
    summary: 'Wired the dropdown to a new filterByRole in main.js and added a self-check for it. Existing checks still pass.', file: 'main.js',
    code: `const roles = [...new Set(staff.map(person => person.role))].sort();
renderRoleFilter(roles, role => {
  renderRoster(filterByRole(staff, role), shifts);
});

// api.js
export function filterByRole(staff, role) {
  return role ? staff.filter(person => person.role === role) : staff;
}

// checks.js
check('the role filter keeps only that role', () => {
  const cooks = filterByRole(staff, 'cook');
  return cooks.length > 0 && cooks.every(person => person.role === 'cook')
    && filterByRole(staff, '').length === staff.length;
});`,
  },
  'o5-a': {
    station: 'frontend', match: 'frontend bolder header brand colour color look pop',
    summary: 'Gave the header a bold brand band: plum background, warm yellow wordmark, heavier type.', file: 'styles.css',
    code: `:root { --brand: #3a1d4a; --brand-ink: #ffcf3f; }

header {
  background: var(--brand);
  color: var(--brand-ink);
  padding: 20px 24px;
  border-bottom: 4px solid var(--brand-ink);
}

header h1 {
  margin: 0;
  font-size: 2rem;
  font-weight: 800;
  letter-spacing: 0.02em;
}`,
  },
  'o5-b': {
    station: 'frontend', match: 'frontend hover state today highlight roster cells column',
    summary: 'Cells lift on hover, and today\'s column gets a soft yellow highlight with a "Today" marker in its heading.', file: 'styles.css',
    code: `tbody td { transition: background 120ms ease; }
tbody td:hover { background: #fff3c4; }

.today { background: #fff9e0; }
th.today::after { content: ' · Today'; font-weight: 400; }

// ui.js, inside renderRoster
const cls = isToday(dateOf(day)) ? ' class="today"' : '';
const head = DAYS.map(day => \`<th\${cls}>\${day}</th>\`).join('');`,
  },
  'o5-c': {
    station: 'backend', match: 'backend isToday date helper api.js',
    summary: 'Added isToday(date) to api.js. It compares calendar days, and takes an optional "now" so it can be checked.', file: 'api.js',
    code: `/**
 * Whether a date falls on today's calendar day.
 * @param {Date|string} date
 * @param {Date} [now] injectable for self-checks
 * @returns {boolean}
 */
export function isToday(date, now = new Date()) {
  const d = new Date(date);
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}`,
  },
};

/** Which Meals belong to an Order, including follow-ups a Customer can ask for. */
const ORDER_MEALS = { o1: ['o1-a', 'o1-b'], o2: ['o2-a', 'o2-b'], o3: ['o3-a', 'o3-b', 'o3-c', 'o3-d'], o4: ['o4-a', 'o4-b', 'o4-c'], o5: ['o5-a', 'o5-b', 'o5-c'] };

const FEEDBACK = {
  o1: { score: 5, comments: 'Lovely! Totals for everyone, right there on the roster. Friday just got shorter.' },
  o2: { score: 4, comments: 'Clean variables, decent contrast, and it remembers me. I would nudge the toggle two pixels left, but I will live.' },
  o3: { score: 5, comments: 'Overlap detected, cell red, tooltip names the clash, seed data proves it. All four criteria pass. Approved.' },
  o4: { score: 4, comments: 'Baristas only, in one click. That is my Monday sorted. Keep the dropdown where it is.' },
  o5: { score: 5, comments: 'YES. It pops! The header slaps and today glows. The investors are going to love this.' },
};
const TOOLTIP_FOLLOW_UP = { prompt: 'Frontend: add a tooltip on each clashing cell naming the shift it clashes with', station: 'frontend' };

const words = s => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9. ]/g, ' ').split(/\s+/).filter(w => w.length > 2));
const overlap = (a, b) => { let n = 0; for (const w of a) if (b.has(w)) n++; return n; };

/** The scripted Meal id closest to this Item: its quick pick's Meal, or the best word overlap within the Order. */
export function closestMealId(order, item) {
  const pick = order.quickPicks.find(q => q.id === item.quickPickId);
  const ids = ORDER_MEALS[order.id] || Object.keys(MEALS);
  const asked = words(`${item.station} ${item.prompt}`);
  let best = null, bestScore = -1;
  for (const id of ids) {
    const m = MEALS[id];
    const score = overlap(asked, words(m.match)) + (m.station === item.station ? 1.5 : 0);
    if (score > bestScore) { best = id; bestScore = score; }
  }
  // An untouched quick pick is its own Meal. An edited one may have become something else (e.g. the tooltip follow-up).
  if (pick?.scriptedMealId && (!item.typed || bestScore < 3)) return pick.scriptedMealId;
  return best;
}

/**
 * The scripted Meal for an Item.
 * @returns {{summary:string, file:string, code:string, setMenu:boolean, mealKey:string}}
 */
export function scriptedMeal(order, item, { forceSetMenu = false } = {}) {
  const id = closestMealId(order, item);
  const m = MEALS[id];
  const pick = order.quickPicks.find(q => q.id === item.quickPickId);
  // As written: the untouched quick pick, or a follow-up that repeats a quick pick's prompt word for word.
  const asWritten = (Boolean(pick) && !item.typed && pick.scriptedMealId === id)
    || order.quickPicks.some(q => q.scriptedMealId === id && q.prompt.trim() === String(item.prompt).trim());
  const followUp = id === 'o3-d' && /tooltip/i.test(item.prompt);
  const summary = item.redoReason ? `Second pass after "${item.redoReason}": ${m.summary}` : m.summary;
  return { summary, file: m.file, code: m.code, setMenu: forceSetMenu || !(asWritten || followUp), mealKey: id };
}

/** A cook estimate for an Item that came from no quick pick: its closest Meal's. */
export function estimateFor(order, item) {
  const pick = order.quickPicks.find(q => q.id === item.quickPickId);
  if (pick) return pick.estCookMs;
  const id = closestMealId(order, item);
  return order.quickPicks.find(q => q.scriptedMealId === id)?.estCookMs || DEFAULT_COOK_MS;
}

/**
 * Scripted Feedback. `servedKeys` are the scripted Meal keys served so far for this Order; `round` starts at 1.
 * @returns {import('../shared/types.js').Feedback}
 */
export function scriptedFeedback(customer, round, servedKeys = []) {
  const order = customer.order;
  const served = new Set(servedKeys);
  const missing = order.quickPicks.filter(q => !served.has(q.scriptedMealId));
  if (order.id === 'o3' && !served.has('o3-d')) {
    return {
      satisfied: false, score: 3,
      comments: missing.length
        ? 'Not yet. I am ticking criteria one by one and several are still open, the tooltip among them.'
        : 'Overlaps are flagged and the cells go red, but criterion 3 fails: there is no tooltip naming the clashing shift.',
      suggestedFollowUps: [TOOLTIP_FOLLOW_UP, ...missing.map(q => ({ prompt: q.prompt, station: q.station }))].slice(0, 3),
    };
  }
  if (missing.length && round < 3) {
    return {
      satisfied: false, score: missing.length > 1 ? 2 : 3,
      comments: `Good start, but the ticket is not done. Still missing: ${missing.map(q => q.label.replace(/^[A-Za-z]+: /, '')).join('; ')}.`,
      suggestedFollowUps: missing.map(q => ({ prompt: q.prompt, station: q.station })).slice(0, 3),
    };
  }
  const f = FEEDBACK[order.id] || { score: 4, comments: 'That does the job. Thank you!' };
  return { satisfied: true, score: f.score, comments: f.comments, suggestedFollowUps: [] };
}
