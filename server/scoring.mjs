// Points (spec 6.5) and the Shift report (6.6). Every score change goes through award() so it floats up as a pop.

export const POINTS = {
  orderBase: 100,          // × difficulty × Customer score ÷ 5
  firstTime: 20,           // per Meal approved with no redo, when the Customer is satisfied
  patienceStep: 1,         // per 5 % of a meter lost
  patienceMax: 20,         // per meter
  angry: 50,               // at empty
  idle: 1,                 // per 10 s per idle Chef
  rested: 10,              // break taken when eligible
};

/**
 * Changes the score and records a pop.
 * @param {object} floor @param {number} points @param {string} text @param {string} anchor e.g. 'table:0', 'meal:m3', 'chef:pixel', 'hud'
 */
export function award(floor, points, text, anchor = 'hud', now = Date.now(), { pop = true } = {}) {
  if (!points) return;
  floor.score += points;
  if (pop) {
    floor.pops.push({ id: ++floor.priv.popId, text, points, at: now, anchor });
    if (floor.pops.length > 8) floor.pops.splice(0, floor.pops.length - 8);
  }
  floor.priv.dirty = true;
}

/** Points for closing an Order: base and the right-first-time bonus. */
export function orderPoints(customer, servedItems) {
  const fb = customer.feedback;
  const base = Math.round(POINTS.orderBase * customer.order.difficulty * fb.score / 5);
  const firstTime = fb.satisfied ? servedItems.filter(it => it.redoCount === 0).length : 0;
  return { base, firstTime, bonus: firstTime * POINTS.firstTime };
}

/** Shift report numbers from the floor's stats. */
export function report(floor, now = Date.now()) {
  const s = floor.stats;
  let longest = s.longestWorkMs;
  if (floor.phase === 'working') longest = Math.max(longest, now - floor.workStretchStartedAt);
  let breakMs = s.breakMs;
  if (floor.phase !== 'working' && floor.priv.breakStartedAt) breakMs += now - floor.priv.breakStartedAt;
  const reworkRate = s.meals ? Math.round((s.redos / s.meals) * 100) / 100 : 0;
  const avgCallBackMs = s.callBacks ? Math.round(s.callBackMsTotal / s.callBacks) : 0;
  return { shipped: s.shipped, points: floor.score, reworkRate, avgCallBackMs, breakMs, longestWorkMs: longest, verdict: verdict({ shipped: s.shipped, reworkRate, avgCallBackMs, breakMs, callBacks: s.callBacks }) };
}

function verdict({ shipped, reworkRate, avgCallBackMs, breakMs, callBacks }) {
  if (!shipped) return 'Kitchen Porter: nothing shipped yet. Seat a Customer and split the Order.';
  const title = shipped >= 4 ? 'Head Expediter' : shipped >= 2 ? 'Sous Chef' : 'Line Cook';
  const reviews = reworkRate === 0 ? 'right first time' : reworkRate <= 0.3 ? 'great reviews' : 'lots of rework';
  const pace = !callBacks ? (breakMs ? 'rested well' : 'no breaks taken') : avgCallBackMs <= 15_000 ? 'fast call-backs' : 'slow call-backs';
  return `${title}: ${reviews}, ${pace}.`;
}
