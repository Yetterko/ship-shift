// The preset Customer Line: five Customers, their Orders (mock GitHub Issues and Jira tickets) and quick picks (spec 8.2).
// Plain data, loadable by the server and by the browser (fixtures). Scripted Meals and Feedback live in server/scripted.mjs.
const S = 1000;

export const CUSTOMERS = [
  {
    id: 'c1', name: 'Priya the PM', persona: 'Friendly product manager. Warm, practical, happy when the feature simply works.', strictness: 1, look: 0,
    order: {
      id: 'o1', number: 1, source: 'GitHub Issue #3', title: "Show each person's total weekly hours",
      description: 'Managers add up hours by hand every Friday. Show a weekly total for each staff member on the roster.',
      acceptanceCriteria: ['A function returns the total hours for one staff member across the week', "The roster table has a Total column showing each person's hours", 'Existing self-checks still pass'],
      difficulty: 1, size: 'S',
      quickPicks: [
        { id: 'o1-a', label: 'Backend: totalHours()', prompt: 'Backend: add `totalHours(staffId, shifts)` to api.js that returns the summed hours for one staff member', station: 'backend', estCookMs: 40 * S, scriptedMealId: 'o1-a' },
        { id: 'o1-b', label: 'Frontend: Total column', prompt: "Frontend: add a Total column to the roster table showing each person's weekly hours", station: 'frontend', estCookMs: 45 * S, scriptedMealId: 'o1-b' },
      ],
    },
  },
  {
    id: 'c2', name: 'Dev the Designer', persona: 'Designer, picky about looks. Notices spacing, contrast and anything that flickers.', strictness: 2, look: 1,
    order: {
      id: 'o2', number: 2, source: 'Jira ROS-7', title: 'Add a dark mode toggle that remembers the choice',
      description: 'People check the roster at night. Add a dark theme with a toggle in the header, and remember the choice between visits.',
      acceptanceCriteria: ['A toggle in the header switches between light and dark', 'Colours come from CSS variables, with readable contrast in both themes', 'The choice is saved in localStorage and applied on load', 'A self-check proves the toggle switches the theme'],
      difficulty: 1, size: 'S',
      quickPicks: [
        { id: 'o2-a', label: 'Frontend: dark theme + toggle', prompt: 'Frontend: add a dark theme with CSS variables and a header toggle whose choice is saved in localStorage', station: 'frontend', estCookMs: 50 * S, scriptedMealId: 'o2-a' },
        { id: 'o2-b', label: 'Integration: toggle self-check', prompt: 'Integration: add a self-check to checks.js that the toggle switches the theme', station: 'integration', estCookMs: 35 * S, scriptedMealId: 'o2-b' },
      ],
    },
  },
  {
    id: 'c3', name: 'Quinn from QA', persona: 'Strict QA engineer. Checks every acceptance criterion and quotes the one that is missing.', strictness: 3, look: 2,
    order: {
      id: 'o3', number: 3, source: 'GitHub Issue #9', title: 'Flag overlapping shifts for the same person',
      description: 'Two shifts for the same person can overlap and nobody notices until the day. Detect the clashes and make them obvious on the roster.',
      acceptanceCriteria: ['`findOverlaps(shifts)` returns the pairs of clashing shifts for the same staff member', 'Clashing cells are highlighted red on the roster', 'A tooltip on a clashing cell names the shift it clashes with', 'The seed data contains one overlap so the feature can be seen'],
      difficulty: 2, size: 'M',
      quickPicks: [
        { id: 'o3-a', label: 'Database: seed an overlap', prompt: 'Database: add one overlapping shift to the seed data in data/shifts.json', station: 'database', estCookMs: 25 * S, scriptedMealId: 'o3-a' },
        { id: 'o3-b', label: 'Backend: findOverlaps()', prompt: 'Backend: add `findOverlaps(shifts)` to api.js returning the clashing pairs', station: 'backend', estCookMs: 45 * S, scriptedMealId: 'o3-b' },
        { id: 'o3-c', label: 'Frontend: red clashing cells', prompt: 'Frontend: highlight clashing cells red with a tooltip', station: 'frontend', estCookMs: 40 * S, scriptedMealId: 'o3-c' },
      ],
    },
  },
  {
    id: 'c4', name: 'Morgan the Manager', persona: 'Busy shift manager. Wants to find the right people fast and has no patience for clutter.', strictness: 2, look: 3,
    order: {
      id: 'o4', number: 4, source: 'Jira ROS-12', title: 'Add a role to each staff member and filter the roster by role',
      description: 'Morgan needs to see only the baristas, or only the cooks. Give every staff member a role and let the roster be filtered by it.',
      acceptanceCriteria: ['Every staff member has a `role` field and schema.md describes it', 'There are 5 staff members', 'A dropdown above the roster filters rows by role, with an "All roles" option', 'A self-check covers the filter'],
      difficulty: 2, size: 'M',
      quickPicks: [
        { id: 'o4-a', label: 'Database: role field + 5th person', prompt: 'Database: add a `role` field to every staff member and a 5th staff member; update schema.md', station: 'database', estCookMs: 30 * S, scriptedMealId: 'o4-a' },
        { id: 'o4-b', label: 'Frontend: role filter dropdown', prompt: 'Frontend: add a role filter dropdown above the roster', station: 'frontend', estCookMs: 45 * S, scriptedMealId: 'o4-b' },
        { id: 'o4-c', label: 'Integration: wire filter + check', prompt: 'Integration: wire the role filter to the API in main.js and add a self-check', station: 'integration', estCookMs: 35 * S, scriptedMealId: 'o4-c' },
      ],
    },
  },
  {
    id: 'c5', name: 'Sam the Startup Founder', persona: 'Excited, vague startup founder. Speaks in vibes; delighted by anything bold.', strictness: 1, look: 4,
    order: {
      id: 'o5', number: 5, source: 'GitHub Issue #15', title: '"Make it pop"',
      description: 'The roster looks like a spreadsheet. Investors are coming on Thursday. Make it pop!',
      acceptanceCriteria: ['The header looks bolder and uses a brand colour', "Cells react on hover and today's column stands out", 'Nothing about the data or the totals changes'],
      difficulty: 3, size: 'L',
      quickPicks: [
        { id: 'o5-a', label: 'Frontend: bold header + brand colour', prompt: 'Frontend: give the header a bolder look and a brand colour', station: 'frontend', estCookMs: 40 * S, scriptedMealId: 'o5-a' },
        { id: 'o5-b', label: 'Frontend: hover + today highlight', prompt: 'Frontend: add a hover state and a "today" highlight on roster cells', station: 'frontend', estCookMs: 45 * S, scriptedMealId: 'o5-b' },
        { id: 'o5-c', label: 'Backend: isToday() helper', prompt: 'Backend: add an `isToday(date)` helper to api.js', station: 'backend', estCookMs: 30 * S, scriptedMealId: 'o5-c' },
      ],
    },
  },
];

/** Quick picks that are the same for every Order. */
export const CHIPS = {
  redo: ['Missing the tooltip', 'Keep the change smaller', 'Add a self-check', 'Match the existing style'],
  serve: ['Check each acceptance criterion', 'Only the logic changed', 'The UI change is in the roster table', 'Self-checks included'],
};

export const CHEFS = [{ id: 'pixel', name: 'Pixel' }, { id: 'stack', name: 'Stack' }];

export const FLOOR_NAMES = [
  'The Hungry Linter', 'Null Pointer Noodles', 'The Merge Kitchen', 'Git Grill', 'The Rubber Duck', 'Byte Bistro', 'Stack Shack',
  'The Fork & Branch', 'Cache Cafe', 'Segfault Sushi', 'The Hot Fix', 'Lambda Larder', 'Promise Pantry', 'The Daily Standup',
  'Kernel Kebab', 'Syntax Supper', 'The Green Build', 'Regex Ramen', 'Ship It Diner', 'Token Taqueria', 'Diff Dumplings',
  'The Pull Request', 'Async Appetite', 'Bug Bash Bakery', 'The Clean Commit', 'Refactor Rotisserie', 'Semicolon Supper',
];

/** A cook estimate for an Item that matches no quick pick. */
export const DEFAULT_COOK_MS = 40 * S;

/** A fresh, deep copy of the line for a new floor. */
export function freshLine() {
  return CUSTOMERS.map(c => ({
    ...c, table: null, status: 'in_line', feedbackRead: false, feedbackRound: 0,
    order: { ...c.order, acceptanceCriteria: [...c.order.acceptanceCriteria], quickPicks: c.order.quickPicks.map(q => ({ ...q })), itemIds: [] },
  }));
}
