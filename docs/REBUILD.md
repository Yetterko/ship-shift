# Ship Shift rebuild plan

> **Contract status (builder 1, live; core loop, Live via the mock, Pomodoro and scoring all green: `node test/server.mjs`, `node test/agents.mjs`).** `shared/protocol.js`, `shared/types.js`, `shared/hunks.js` and `shared/fixtures.js` are final for this round; `node server/index.mjs` serves the client, `/shared/*`, `/content/*` (fixtures import `content/orders.mjs`), health, admin and the full WebSocket protocol of section 5, with the Demo kitchen working end to end. Changes against the first draft of section 5, all additive: `welcome` also carries `liveOpen`, `queuePosition` and `defaults.live` / `defaults.demo` (each `{ gracePeriodMs, maxWorkMs, ranges }`); `FloorLine` carries `modelLabel`; an action can also be refused `shift_over` or `no_floor`; a follow-up quick pick has `followUp: true`; the water gun (`splash`, and `splashed` to the whole zone with `toId`) is added; `notify liveOff`, the `no_key` refusal and the snapshot's `demoReason` are added; an ended shift frees its live slot. `npm run check` is `node server/check.mjs` (syntax check of server, shared, content, test, public, tools, template-project). Tests start a server with `startServer(env)` from `test/helpers/server.mjs` (resolves `{ url, port, stop }`) and fake the API with `test/helpers/mock-anthropic.mjs`.

Branch `spec-rework`, worktree `C:\Users\Shane\ship-shift-spec`. `docs/SPEC.md` (revision 3) is the requirements. `docs/plan.md`, `docs/town-plan.md`, `docs/town-protocol.md` and `docs/town-integration.md` describe the old prototype and are superseded by this file.

**The one deviation from the spec:** each restaurant is its own building around a shared park, not a floor of one tall building.

| Spec term | In this build |
| --- | --- |
| Building | The town: a park with restaurant buildings around it |
| Floor N | Restaurant "No. N · The Hungry Linter"; the wire still calls it a `floor` |
| Overview (FR-46) | Town overview: one card per restaurant, the Spectator's first screen, with a "Walk the park" button |
| Walk-in (FR-47) | Walk through a building's door from the park, or tap its card; read-only |
| Elevator (FR-48) | The restaurant's front door on the right wall. Walking into it opens the door panel: "Step out to the park" plus the list of restaurants. Same 0.6 s door transition, same unload and load |
| Teleport menu (FR-49) | Side drawer listing every restaurant, plus "The park" |
| One floor loaded | One scene loaded: the park, or one restaurant |

Decisions taken here, not open: plain JavaScript; server files stay `.mjs` under `server/`, client stays under `public/` (no rename to `client/`); all traffic except static files, health and admin moves to WebSocket as the spec says; the player cap is $0.10 (the spec's HUD example says $0.25, its cap table says $0.10); the showcase floor uses Sonnet 5.5 (the spec's code sample picks Haiku for non-judges, its stack table says Sonnet); "FR-31" in spec 6.4 means FR-41; `/health` and `/healthz` both answer.

## 1. Requirement map

Keep = works as is or with renames. Adapt = the code exists but changes shape. New = nothing to reuse.

### Functional

| ID | Requirement | Status | Files (old → new) |
| --- | --- | --- | --- |
| FR-1 | Role picker, Spectator preselected | New | `public/game/roles.js` |
| FR-2 | Player: live floor on Haiku if slot and budget, else visitor + Demo offer | New | `server/roles.mjs`, `server/floors.mjs` |
| FR-3 | Judge: Sonnet, bigger budget, reserved slots | New | `server/roles.mjs`, `server/budget.mjs` |
| FR-4 | Own API key (Should) | Parked, phase 2 | `server/budget.mjs` has the `keySource` seam |
| FR-5 | 3D floor: line left, 2 tables, rail + Pass, 4 Stations, 2 Chefs top wall, door right, TV | Adapt | `public/game/world.js` → `public/game/floor.js`; `scene.js` kept |
| FR-6 | Tap opens the panel at once, Waiter runs there in 0.4 s | Adapt | `public/game/input.js` → `floorinput.js` (old code walks first) |
| FR-7 | WASD, E, Shift, Tab, ? (Should) | Keep | carried from `input.js` into `floorinput.js` |
| FR-8 | Badges, status ring, face, patience ring, ticket badges | Adapt | `floor.js` (labels via `scene.js` `label()`) |
| FR-9 | Skeuomorphic HTML panels; bottom sheets on phones | Adapt | `panels.js` rewritten; `touch.js`, `game.css` kept and trimmed |
| FR-10 | HUD: clock, score, LIVE/DEMO pill, floor name, sound, help, menu | Adapt | `public/game/hud.js` (from `panels.js` `hud()`), `pill.js` new |
| FR-11 | Presenter mode (Should) | Keep | `guide.js` |
| FR-12 | Fixed front camera on laptops; follow + pinch on portrait phones | Adapt | `scene.js` (`setLayout`, `updateCamera`, `setOverview` exist; pinch is new) |
| FR-13 | Preset line of 5 Orders | New | `content/orders.mjs` (replaces `demo-repo.mjs` `STARTER_ORDERS`) |
| FR-14 | Tap a Customer in the line to preview the Order | New | `panels.js` order pad |
| FR-15, 16 | Seat next or a chosen Customer, max 2; seating starts the task | New | `server/actions.mjs` `seat` |
| FR-17 | 1–5 Items per Order, each with a Station | New | `server/actions.mjs` `saveItems`; `panels.js` |
| FR-18, 19, 20 | Quick picks, inline edit, Type it, the stand-in note | New | `public/game/quickpicks.js` |
| FR-21, 22 | FIFO Ready Queue; idle Chef takes the oldest; max 2 | New | `server/loop.mjs` `dispatch()` |
| FR-23 | Station prompt + file focus | New | `server/agents/prompts.mjs` |
| FR-24 | Cook = Messages API call (Live), scripted (Demo), Agent SDK (showcase); released no earlier than the estimate | New (salvage `api-driver.mjs` client, `costOf`, `plain`) | `server/agents/chef.mjs`, `server/scripted.mjs`, `server/showcase/` |
| FR-25 | "Waiting for a stove" when the call queue is full | New | `server/callqueue.mjs` |
| FR-26 | Meal on the Pass, Chef idle | New | `server/loop.mjs` |
| FR-27 | Sample: summary + hunks, J/K, hunks-seen counter | Adapt | old review panel in `panels.js` → `public/game/review.js`; `shared/hunks.js` |
| FR-28 | Redo with reason, front of queue, rework counter | New | `server/actions.mjs` `redoMeal` |
| FR-29 | Deliver approved Meals with a note | New | `serveOrder` |
| FR-30 | Customer review, structured Feedback | New | `server/agents/customer.mjs`, `server/scripted.mjs` |
| FR-31, 32 | Raised hand; read Feedback; More work or Bill | New | `readFeedback`, `moreWork`; `panels.js` comment card |
| FR-33 | SHIPPED receipt, banner, confetti, table frees | Adapt | `giveBill`; `panels.js` receipt; `world.js` `shipFx`/`scene.js` `confetti` kept |
| FR-34 | TV: screenshot per Order shipped; live preview on showcase | New | `public/game/tv.js`, `public/tv/*.png`, `server/showcase/preview.mjs` |
| FR-35 | Grace period and max work time set before the shift | New | chalkboard in `roles.js`; `updateSettings` |
| FR-36, 37 | Take a break when all Chefs busy; break screen | New (old shift clock was a plain timer) | `server/loop.mjs`; `public/game/breakscreen.js` |
| FR-38 | Call-back after grace: notification, sound, title flash, vibration | New | `server/loop.mjs`; `public/game/notify.js`; `audio.js` kept |
| FR-39 | Patience meters, score drain | Adapt (old smoke/fire timers are the nearest thing) | `server/loop.mjs` |
| FR-40 | Forced break at max work time | New | `server/loop.mjs`; `breakscreen.js` |
| FR-41 | Call-back delay (Should) | New, trivial, included | `server/loop.mjs` |
| FR-42 | Scoring, floating points | Adapt | `server/scoring.mjs`; `scene.js` `popup()` kept |
| FR-43 | Shift report (Should) | Adapt, included | `server/scoring.mjs` `report()`; old report dialog in `panels.js` |
| FR-44 | Leaderboard (Could) | Parked | overview cards already sort by score |
| FR-45 | One shared map, one floor loaded | Adapt | `server/building.mjs` (plot layout from `world.mjs` `layPlots`); `public/game.js` router |
| FR-46 | Overview cards | New | `public/game/overview.js` |
| FR-47 | Read-only walk-in, "View only" | Adapt (old `G.visit` / `can()` in `core.js`) | `server/actions.mjs` owner guard; `panels.js` reads `you.canAct` |
| FR-48 | Elevator → front door + door panel + transition | Adapt (`world.js` `doorSt`, `town.js` zone change) | `floor.js` door; `public/game/teleport.js` |
| FR-49 | Teleport drawer | New | `teleport.js` |
| FR-50 | Players visit other floors; "Go home" (Should) | Included, it falls out of `subscribe` | `teleport.js`, `notify.js` |
| FR-51 | Live-floor cap; overflow become Visitors | New | `server/roles.mjs` |
| FR-52 | Budget modal: Demo kitchen or visitor | New | `server/budget.mjs`; `pill.js` |
| FR-53 | Pill always visible, switches mode | New | `pill.js`; `setMode` |
| FR-54 | Destroy after 15 min with no owner connected, or Leave | Adapt (idea from `sessions.mjs` idle sweep) | `server/floors.mjs` |

### Non-functional

| ID | Status | How |
| --- | --- | --- |
| NFR-1 Render HTTPS | Adapt | `render.yaml`, `Dockerfile` (drop git and the per-session repos) |
| NFR-2 360 px, 44 px targets, 30 fps | Keep | `scene.js` `adapt()`/`quality`, `touch.js`; DPR cap 2, one shadow light |
| NFR-3 First Order under 2 min | Adapt | `guide.js` five-step bar, quick picks |
| NFR-4 No files, code or web on audience floors | New | Messages API, one forced tool, nothing else |
| NFR-5 Caps at every level | Adapt | `server/budget.mjs` (three-level idea from `api-driver.mjs`) |
| NFR-6 Keys never leave the server | Keep | env only; snapshots are built by an allow-list |
| NFR-7 In-flight call limit | New | `server/callqueue.mjs` |
| NFR-8 Panel < 100 ms, push < 500 ms, switch < 3 s | Adapt | panels render from the last snapshot; optimistic open |
| NFR-9 Burnt → retry once → scripted Meal | New | `server/loop.mjs` |
| NFR-10 Plain model + debug ticket view | New | `public/ticket.html`, `public/ticket.js` |
| NFR-11 Stand-ins labelled | New | notes in `quickpicks.js`, `review.js`, `tv.js` |

## 2. Cut list

**Deleted** (the spec replaces them):

| What | Files | Why |
| --- | --- | --- |
| Order-per-chef kitchen: plan, cook, oven, pass, hatch | `server/kitchen.mjs` | The spec's model is Customer → Items → Chefs → Meals → Feedback → Bill |
| Git worktree per chef and per audience player, merges, test runner | `server/git.mjs`, `server/sessions.mjs`, `server/demo-repo.mjs`, `server/reset.mjs`, `server/check.mjs` | Audience floors have no codebase (NFR-4). The showcase sandbox takes a small salvage of `git()`, `commitAll`, `diffAgainst` into `server/showcase/sandbox.mjs` |
| Agent SDK driver with permission policy, simulated driver, recipes | `server/agents.mjs`, `server/sim-scripts.mjs`, `examples/roster-cafe-orders/` | Replaced by ChefWriter, ScriptedKitchen and the showcase runner |
| Haiku "voices" over scripted work | `server/api-driver.mjs` | Chefs now do the work in one call. Salvage the client setup, `costOf`, `plain` |
| Town game: teams, cards carried between doors, offers, referrals, cheers, lunch rush, bell, bus, signs, park leaderboard | `server/world.mjs`, `public/game/town.js`, `public/game/townboard.js`, most of `public/game/parkinput.js` | Not in the spec. The park survives only as the map between buildings |
| HTTP action API and session cookies | routes in `server/index.mjs` | Spec 7.7: WebSocket messages, player token in `localStorage` |
| The Roster Cafe sample and its runner | `examples/roster-cafe/`, `examples/run.mjs` | The spec's sample is Rosterette with different files and Orders (see open question 1) |
| Old tests | `test/smoke.mjs`, `game.mjs`, `mobile.mjs`, `share.mjs`, `world.mjs`, `worldgame.mjs`, `park.mjs`, `api.mjs` | They test deleted behaviour. The Chrome finder and launch flags move to `test/helpers/browser.mjs` |
| Fly config | `fly.toml` | Render is the host (D8) |

**Parked** (not built now; nothing blocks adding them later):

| What | Spec status | Note |
| --- | --- | --- |
| Hiring, ranks, wages, renaming chefs | Out of scope (D15: 2 Chefs, no levels) | Chefs are fixed: Pixel and Stack |
| Oven, Hatch, Spices (grants), Prep board | Stretch, deferred by D17 | Their stations are removed from the floor |
| Chef questions, Bin the order | D17's default adopts them; cut on the user's instruction to lock the core first | Text-only Chefs make one call and cannot ask |
| Kanban board (`public/game/board.js`) | Not in the spec | The debug ticket view covers NFR-10 |
| Score streak multiplier | FR-10 mentions it, 6.5 defines none | HUD shows score only |
| Own API key (FR-4), leaderboard (FR-44), Web Push, zip export | Should / Could / stretch | |
| Tunnel sharing (`server/share.mjs`, `tools/qr.mjs`) | Fallback 2 only | File kept untouched; fix after the core works. `qrcode-terminal` at startup stays |
| Suggestions section (minimum break, batched call-backs, last orders, long break, streaks) | Suggestions | None built |

## 3. Target architecture

### 3.1 Server

One Node process, `http` + `ws`, all state in memory. `SHOWCASE=1` adds the sandbox, the Agent SDK runner and the preview.

| Module | Job |
| --- | --- |
| `server/index.mjs` | HTTP (static, `/shared/`, `/vendor/`, `/health`, `/healthz`, `/admin/usage`, `/preview/showcase/*`), WebSocket upgrade, message routing, per-connection rate limit, QR at startup |
| `server/game.mjs` | The core without HTTP: message routing, the 4 Hz tick, floor pushes, `building`, `peers`; tests drive it with an injected clock |
| `server/config.mjs` | Reads env once: caps, slots, timings, models, prices |
| `server/floors.mjs` | `FloorManager`: `create`, `get`, `destroy`, idle sweep, floor numbers and names, `snapshot(floor, conn)` |
| `server/roles.mjs` | Connections, roles, live slots, judge slots, live-slot queue, owner tokens |
| `server/actions.mjs` | One handler per action; owner guard, state-machine guard, input clamps |
| `server/loop.mjs` | 4 Hz tick per floor: dispatch, cook release, grace, call-back, patience, max work, idle penalty, shift end |
| `server/scoring.mjs` | Point rules and `report(floor)` |
| `server/callqueue.mjs` | Global in-flight limit, FIFO, priority lane for judges and showcase |
| `server/budget.mjs` | Price table, `reserve`/`settle`, floor cap, judge pool, global stop, usage for admin |
| `server/agents/chef.mjs` | ChefWriter: one Messages API call, forced `serve_meal` tool |
| `server/agents/customer.mjs` | CustomerReviewer: one call, forced `submit_review` tool |
| `server/agents/prompts.mjs` | Base Chef prompt, Station prompts, Rosterette brief, Customer persona prompt |
| `server/scripted.mjs` | ScriptedKitchen: Meal per quick pick, closest-match for typed Items ("set menu"), Feedback per Order (Order 3's first review is "not satisfied") |
| `server/building.mjs` | Plot layout (from `world.mjs` `layPlots`), building summary every 2 s |
| `server/presence.mjs` | Avatar positions per zone, relayed at 5 Hz |
| `server/showcase/` | Sandbox, Agent SDK runner, preview. Loaded only when `SHOWCASE=1` |
| `content/orders.mjs` | The 5 Customers, Orders, quick picks, cook estimates, redo and serve-note chips |
| `shared/protocol.js`, `shared/types.js`, `shared/hunks.js`, `shared/fixtures.js` | Constants, JSDoc typedefs, hunk splitter, canned snapshots for client harnesses |

**Floor kinds and modes.** `kind: 'audience' | 'showcase'`. `mode: 'live' | 'demo'`. `timings: 'real' | 'short'` is separate from mode, because the showcase floor is Live with short timings. Demo always uses short.

| Setting | real | short |
| --- | --- | --- |
| Grace period | 5 min | 10 s |
| Max work time | 25 min | 90 s |
| Patience, Meal and Feedback | 5 min | 30 s |
| Cook release | max(agent time, estimate) | estimate ÷ 4 (and at least the agent time when Live) |
| Call-back delay | 10 s | 2 s |
| Shift length | until Close up or the line is cleared | same, plus a 5 min limit in Demo |

**State machines** (the server is the only writer):

| Entity | States | Transitions |
| --- | --- | --- |
| Customer | `in_line` → `seated` → `waiting_food` → `eating` → `awaiting_player` → `waiting_food` or `paying` → `left` | `seat`; first `sendItems`; `serveOrder`; review done; `sendItems` after `moreWork`; `giveBill` then 3 s |
| Item | `draft` → `queued` → (`waiting_stove`) → `cooking` → `ready` → `sampled` → `approved` → `served`; `sampled` → `queued` on redo; `cooking` → `burnt` → `queued` | `saveItems`; `sendItems`; loop; call + release timer both done; `sampleMeal`; `approveMeal`; `serveOrder`; `redoMeal`; agent error |
| Chef | `idle` → `walking` (0.8 s) → `waiting_stove` or `cooking` → `plating` (0.8 s) → `idle` | loop only |
| Phase | `working` ↔ `break` → `called_back` → `working` | `startBreak`; call-back fires; `endBreak` or any action |
| Shift | `running` → `ended` | starts at `createFloor`; `closeShift`, line empty and tables clear, or the Demo limit |

Rules the builders must not reinterpret:

- `approveMeal` needs `hunksSeen === hunks.length`. `serveOrder` takes only `approved` Meals. That is the review discipline.
- `giveBill` needs at least one Feedback on that Order. Points use the latest Feedback score.
- Redo keeps the previous answer: the redo prompt carries the earlier `code` and the reason. `redoCount` rises; the Item goes to the front of the queue.
- Patience on a Meal runs from `ready` (or from the call-back, when on break) until `sampleMeal`. Patience on a Customer runs from Feedback ready until `readFeedback`. −1 per 5 % lost, at most −20 a meter, −50 at empty; the Customer stays (D6).
- Break is offered when every Chef is `cooking` or `waiting_stove`, and when work time passes the max. At the max, a 20 s warning, then every action but `startBreak` is refused with `must_break`.
- A forced break ends on `endBreak` like any other; work stretch resets.
- Chef idle penalty (−1 per 10 s per Chef) only counts once the first Items have been sent, never during `break`, and never while `waiting_stove`.
- Failure: first error → `burnt` for 2 s, back to the front of the queue. Second error on the same Item → the scripted Meal, labelled "set menu". An API error never reaches the player as an error.
- Budget: `reserve(estimate)` before a call, `settle(actual)` after. If a reserve fails, cooking Items finish, queued Items stay on the rail, `budgetBlocked` is set, and `notify budgetSpent` goes to the owner. `setMode demo` or `leave` clears it.
- Slots: `MAX_LIVE_FLOORS` (60) of which `JUDGE_SLOTS` (6) are held for Judges. Demo floors do not use a live slot; `MAX_FLOORS` (200) bounds memory. A live floor that switches to Demo, or whose shift ends, frees its slot; switching back, or Play again after the end, needs a slot and budget (else Play again runs in Demo with `notify liveOff`).
- Lifetime: destroyed 15 min after the owner's last socket closes, on `leave`, or 5 min after the shift ends. Destroy aborts in-flight calls and gives the slot to the head of the queue (`notify slotFree`).

### 3.2 Agents

**Live audience Chef** (`server/agents/chef.mjs`): one `messages.create` per Item.

- Model: `claude-haiku-5-5` for Players, `claude-sonnet-5-5` for Judges. `max_tokens` 1500.
- System: base Chef prompt + Station prompt + Rosterette brief (about 400 tokens).
- User: Order title and acceptance criteria, the Item prompt, and on a redo the earlier code and the reason. Player text is passed as quoted data, clamped to 600 characters.
- Output: `tools: [serve_meal]`, `tool_choice: { type: 'tool', name: 'serve_meal' }` → `{ summary, file, code }`. `code` is cut to 40 lines. No other tools.
- **Per model (checked against the current API, Nov 2026):** Haiku 5.5 takes the forced `tool_choice` with `thinking: { type: 'disabled' }`. Sonnet 5.5 answers a forced `tool_choice` with a 400, so Judges' calls send `tool_choice: { type: 'auto', disable_parallel_tool_use: true }`, the `strict` tool, `thinking: { type: 'between_tools' }` (thinking off) and a system prompt that names the tool; a reply without the call is an error like any other (burnt, retry, set menu). The Customer call does the same. Code: `server/agents/chef.mjs` `toolFields()`.
- Meal: `changedFiles: [file]`, `diff` = every line prefixed `+`, `hunks` = `splitHunks(code)` (blank-line blocks, at most 12 lines each).
- Timeout 30 s, `maxRetries: 0`; a refusal or a missing tool call counts as an error.

**Live Customer** (`server/agents/customer.mjs`): one call on the floor's model, everywhere including the showcase.

- System: persona, strictness 1–3, the rule for that strictness.
- User: Order + acceptance criteria, each served Meal's summary and code, the player's note, and on the showcase floor the current contents of the changed files.
- Output: forced `submit_review` → `{ satisfied, score, comments, suggestedFollowUps: [{ prompt, station }] }`. At most 3 follow-ups; comments cut to 60 words.
- On error: the scripted Feedback for that Order.

**Demo** (`server/scripted.mjs`): no API. `scriptedMeal(order, item)` picks by `scriptedMealId`; a typed Item maps to the closest quick pick by word overlap and gets `setMenu: true`. `scriptedFeedback(order, round)`.

**Showcase** (`server/showcase/`, `SHOWCASE=1`, presenter laptop only): one Agent SDK `query()` per Item in the Rosterette working copy, with the options in spec 7.4, model Sonnet 5.5. Tool-use messages become `chef.thought` and progress. On the result: record cost, `git diff` against the pre-cook commit, build the Meal with real hunks, commit, bump the preview version. `error_max_turns` and `error_max_budget_usd` still give a Meal with `ranOut: true`.

The seam between the core and the showcase, coded by builder 1 and implemented by builder 3:

```js
// server/showcase/index.mjs
export async function createShowcase({ root, config, queryFn }) // queryFn defaults to the SDK's query; tests inject a fake
// returns:
{
  async cook({ floor, order, item, chef, prompt, systemAppend, signal, onProgress }),
  // -> { summary, changedFiles, diff, hunks, costUsd, ranOut }
  async fileContents(paths),          // -> { [path]: text } for the Customer review
  preview(req, res, subpath),         // serves the working copy at /preview/showcase/
  version(),                          // int, rises on every file change; goes in floor.tv.version
  async reset(), async close(),
}
```

With `SHOWCASE=1`: `MAX_LIVE_FLOORS=1`, the one floor has `kind: 'showcase'`, `timings: 'short'`, it jumps the call queue, and the floor cap is `SHOWCASE_CAP_USD` (default $5).

**The stove.** Every model call, of every kind, goes through `callqueue.run(fn, { priority })`. Every call checks `budget.reserve` first.

**No test or builder ever calls the real API.** The server reads `ANTHROPIC_BASE_URL`; tests point it at `test/helpers/mock-anthropic.mjs`, a local HTTP server that answers `/v1/messages` with a `tool_use` block and a `usage` object, and can be told to fail, stall or rate-limit. The test server helper refuses to start if a key is set without that base URL. Showcase tests inject `queryFn`.

Builder 1 should load the `claude-api` skill before writing the two calls, to confirm the current request shape.

### 3.3 Client

One page, one WebGL renderer, one scene mounted at a time.

```
landing + role picker ──► overview (cards) ◄──► park (walk) ──► restaurant (read-only)
        │ Player/Judge                                             ▲
        └─► chalkboard ─► own restaurant (can act) ── door / drawer ┘
```

| Scene or layer | Module | Mounts into |
| --- | --- | --- |
| App shell: socket, routing, door transition | `public/game.js`, `net.js`, `teleport.js` | `#shell` |
| Landing, role picker, "all kitchens busy" sheet, chalkboard | `roles.js` | `#shell` |
| Town overview | `overview.js` | `#shell` |
| Park | `park.js`, `parkinput.js`, `presence.js` | `#stage` canvas |
| Restaurant | `floorapp.js` → `floor.js`, `floorinput.js`, `panels.js`, `quickpicks.js`, `review.js`, `hud.js`, `guide.js`, `breakscreen.js`, `notify.js`, `tv.js` | `#stage` canvas, `#floorUi` |
| LIVE/DEMO pill, mode sheet, budget modal | `pill.js` | `#pillSlot` inside the HUD |

The contract between the shell (builder 3) and the floor (builder 2):

```js
// public/game/floorapp.js
export function mountFloor(ctx)   // builds the 3D floor and its UI; returns nothing
export function updateFloor(msg)  // every `floor` message while mounted
export function floorNotify(msg)  // every `notify` message for this floor
export function floorPeers(list)  // visitors' avatars
export function floorFrame(dt, t) // called by the shell's one animation loop
export function unmountFloor()    // disposes geometries, materials, textures, labels, DOM, listeners
// ctx = { act(name, args) -> Promise<{ok, code?, message?}>, sendPos(x, z, r),
//         openDoor(), openMenu(), goHome(), pillSlot: HTMLElement, ui: HTMLElement }
```

The floor reads `msg.you.canAct`. When false, every action button renders as a "View only" label and the Waiter is a visitor avatar that starts at the door.

`scene.js` keeps every export it has today; builder 2 adds `disposeTree(object3d)` and pinch zoom. `core.js` keeps `$`, `esc`, `mmss`, `clamp`, `reduceMotion`, `on`, `emit`, `store`, `toast`, `modal`, `ICON`, `fx`; builder 3 removes the HTTP helpers (`api`, `getJson`, `kpath`, `can`, `whyNot`, `G.visit`).

### 3.4 What survives

| Module | Fate |
| --- | --- |
| `public/game/scene.js` | Kept: renderer, toon materials, primitives, labels, popups, particles, quality adaptation |
| `public/game/world.js` | Split: `character`, `pose`, `setLook`, `kick`, `avatarKit`, `findPath`, `blocked` kept in `characters.js` and `floor.js`; the layout is re-laid; jars, prep, oven, hatch, bin removed |
| `public/game/input.js` | Reworked into `floorinput.js`: keys and pointer kept, station actions rewritten |
| `public/game/panels.js` | Rewritten; the review panel, receipt and report markup and CSS are the starting point |
| `public/game/guide.js`, `touch.js`, `audio.js`, `core.js` | Kept, trimmed |
| `public/game/park.js`, `presence.js` | Kept, trimmed to buildings and avatars |
| `public/game/net.js` | Rewritten around the new messages; reconnect logic kept |
| `public/game.css`, `public/world.css`, `public/fonts/` | Kept, trimmed |
| `server/index.mjs` | Rewritten; static serving, MIME table and the origin check kept |
| `server/world.mjs` | Only `layPlots`, `cleanName` and the name lists move to `building.mjs` |
| `server/api-driver.mjs` | Only `costOf`, `plain` and the client setup move to `budget.mjs` and `agents/` |
| Test launch code (`findChrome`, swiftshader flags, device emulation) | Moves to `test/helpers/browser.mjs` |

## 4. Build list

Three builders, no shared files. A builder who needs a change in another's file asks the lead; they do not edit it. Each deletes the old files in their own area. Tests are headless only (`chromium.launch({ headless: true })` with the headless shell, as today), on desktop 1440×900 and phone emulation (iPhone 13 and 360×640). No visible windows. No real API calls.

Order of work: builder 1 lands B1.1 first (target: 20 minutes), because it holds `shared/` and the fixtures. Builders 2 and 3 start at once on harness pages fed by `shared/fixtures.js`, then switch to the real server.

### Builder 1: server core

Owns: `server/*.mjs` and `server/agents/` (not `server/showcase/`), `content/`, `shared/`, `public/ticket.html`, `public/ticket.js`, `test/server.mjs`, `test/agents.mjs`, `test/helpers/mock-anthropic.mjs`, `test/helpers/server.mjs`. Deletes: `server/kitchen.mjs`, `agents.mjs`, `sim-scripts.mjs`, `git.mjs` (after builder 3 has copied what the sandbox needs), `sessions.mjs`, `world.mjs`, `demo-repo.mjs`, `api-driver.mjs`, `reset.mjs`, `check.mjs`.

| # | Item | Files | Key functions | Verify |
| --- | --- | --- | --- | --- |
| B1.1 | Contract files and skeleton | `shared/protocol.js`, `shared/types.js`, `shared/hunks.js`, `shared/fixtures.js`, `server/index.mjs`, `server/config.mjs`, `test/helpers/server.mjs` | `splitHunks(text)`, `fixtureFloor(stage)`, `fixtureBuilding(n)`, `startServer(env) -> { url, stop }` | `node test/server.mjs`: server starts, `/health` 200, `hello` → `welcome` |
| B1.2 | Floors, roles, slots, queue, tokens, lifetime | `server/floors.mjs`, `server/roles.mjs` | `FloorManager.create/get/destroy/sweep`, `snapshot(floor, conn)`, `chooseRole`, `claimSlot(role)`, `joinQueue`, `resume(token)` | Unit, with an injected clock: 61st player gets `no_slot`; judge slots held; destroy at 15 min; a reconnect with the token regains the floor; the snapshot JSON never contains a key or token |
| B1.3 | Actions and state machines | `server/actions.mjs` | `seat`, `saveItems`, `sendItems`, `sampleMeal`, `seeHunk`, `redoMeal`, `approveMeal`, `serveOrder`, `readFeedback`, `moreWork`, `giveBill`, `startBreak`, `endBreak`, `updateSettings`, `setMode`, `closeShift`, `playAgain`, `leave` | Every illegal transition answers the right code; a visitor's action answers `view_only`; approve before all hunks seen answers `unread` |
| B1.4 | Loop, ScriptedKitchen, content | `server/loop.mjs`, `server/scripted.mjs`, `content/orders.mjs` | `tick(floor, now)`, `dispatch`, `releaseMeal`, `scriptedMeal`, `scriptedFeedback` | All 5 Orders ship end to end in Demo over WebSocket; FIFO holds; 2 Chefs at most; Order 3's first review is not satisfied; a typed Item gets `setMenu` |
| B1.5 | Pomodoro and scoring | `server/loop.mjs`, `server/scoring.mjs` | `breakEligible`, `fireCallBack`, `drainPatience`, `forceBreak`, `award(floor, event)`, `report(floor)` | Clock-driven: no call-back inside grace; call-back after grace + delay; patience starts at call-back; −20 cap then −50; forced break locks actions; report numbers match a scripted run |
| B1.6 | Live agents, stove, budget | `server/agents/*.mjs`, `server/callqueue.mjs`, `server/budget.mjs` | `cookLive(ctx)`, `reviewLive(ctx)`, `CallQueue.run`, `reserve`, `settle`, `usage()` | `node test/agents.mjs` against the mock: request has one forced tool and the right model per role; cost is settled from `usage`; limit 2 in flight makes the third Chef `waiting_stove`; one failure → `burnt` → retry; two → scripted; cap reached → `budgetSpent`, `setMode demo` continues |
| B1.7 | Building, presence, admin, ticket view | `server/building.mjs`, `server/presence.mjs`, `public/ticket.*` | `summary()`, `assignPlot`, `relay(zone)` | `building` every 2 s to every socket; watchers count; `/admin/usage` needs the secret; the ticket view plays a full Order in a headless browser |
| B1.8 | Showcase seam | `server/index.mjs`, `server/loop.mjs` | dynamic `import('./showcase/index.mjs')` when `SHOWCASE=1` | With a stub showcase module: cook goes through `showcase.cook`, review gets `fileContents` |

### Builder 2: floor client

Owns: `public/game/scene.js`, `characters.js`, `floor.js`, `floorinput.js`, `floorapp.js`, `panels.js`, `quickpicks.js`, `review.js`, `hud.js`, `guide.js`, `breakscreen.js`, `notify.js`, `tv.js`, `touch.js`, `audio.js`, `public/game.css`, `public/floor-test.html`, `test/floor.mjs`, `test/floor-mobile.mjs`, `test/helpers/browser.mjs`. Deletes: `public/game/world.js`, `input.js`, `board.js`.

| # | Item | Files | Key functions | Verify |
| --- | --- | --- | --- | --- |
| B2.0 | Test helper and harness (first 10 minutes) | `test/helpers/browser.mjs`, `public/floor-test.html` | `launch()`, `desktopPage()`, `phonePage(device)`; harness mounts the floor on `fixtureFloor(stage)` from the query string | Harness renders the fixture with no console errors |
| B2.1 | Floor scene | `characters.js`, `floor.js`, `scene.js` | `buildFloor()`, `syncFloor(snapshot)`, `animateFloor(dt, t)`, `disposeFloor()`, `disposeTree()` | Layout probes via `window.__floor`: line left, 2 tables, rail, Pass, 4 Stations and 2 Chefs on the top wall, door right, TV. Mount and unmount 10 times: `renderer.info.memory` returns to baseline |
| B2.2 | Agent state | `floor.js` | `chefBadge`, `statusRing`, `patienceRing`, `ticketBadge` | Each fixture stage shows the right badge text, ring and face; "waiting for a stove" appears |
| B2.3 | Waiter and input | `floorinput.js` | `tap(target)` opens the panel then `runTo(target, 0.4)`, `urgent()`, key map | Panel visible within 100 ms of the tap (measured); Waiter arrives in about 0.4 s; WASD, E, Tab, ? work |
| B2.4 | Order pad and quick picks | `panels.js`, `quickpicks.js` | `openPreview(customer)`, `openTable(customer)`, `chipRow(picks, onPick)`, `typeIt()`, `stationPicker()` | Seat, add 2 chips, edit one inline, Type it and back, send: the right `saveItems` and `sendItems` go out; the stand-in note is present; 1–5 Items enforced |
| B2.5 | Pass and review | `review.js` | `openMeal(meal)`, `nextHunk`, `prevHunk`, `sendBack(reason)`, `approve()` | J/K step; counter reads "2 of 3 seen"; Approve is disabled until all are seen; redo chips send `redoMeal` |
| B2.6 | Serve, Feedback, Bill | `panels.js` | `openServe`, `openFeedback`, `openReceipt`, `shippedBanner()` | Serve note chips; comment card with stars; follow-ups appear as chips after More work; receipt shows SHIPPED, Items, redos, time, score, points; confetti fires |
| B2.7 | HUD and guide | `hud.js`, `guide.js` | `renderHud(snapshot)`, `guideApply(snapshot)`, `presenter()` | Clock, score, floor name, `#pillSlot` present; the five steps light in order; Skip hides the bar |
| B2.8 | Break, call-back, report | `breakscreen.js`, `notify.js`, `panels.js` | `showBreak`, `callBack(kind)` (Notification, bell, title flash, vibrate), `openReport(report)` | Take a break appears only when eligible; break screen dims; with `Notification` and `navigator.vibrate` stubbed, a call-back calls both and flashes the title; forced break blocks panels |
| B2.9 | Read-only, TV, mobile | `panels.js`, `tv.js`, `touch.js`, `game.css` | `viewOnly()`, `showShot(orderId)`, `openTvFull()` | `canAct: false`: no action buttons, "View only" labels, eye icon with the watcher count. TV swaps to `/tv/order-N.png` on ship; iframe to `/preview/showcase/` when `kind` is showcase. Phone: bottom sheets, targets ≥ 44 px (measured), no horizontal scroll at 360 px, camera follows, pinch zooms out |
| B2.10 | Full loop on the real server | `test/floor.mjs`, `test/floor-mobile.mjs` | | Demo mode: seat Priya → ship, desktop and phone, by clicks and taps only; then one Live loop against the mock API |

### Builder 3: world, roles and showcase

Owns: `public/index.html`, `public/game.js`, `public/game/core.js`, `net.js`, `roles.js`, `overview.js`, `teleport.js`, `pill.js`, `park.js`, `parkinput.js`, `presence.js`, `public/world.css`, `public/shell.css`, `public/park-test.html`, `public/tv/`, `server/showcase/`, `template-project/`, `package.json`, `package-lock.json`, `render.yaml`, `Dockerfile`, `.dockerignore`, `README.md`, `test/world.mjs`, `test/world-mobile.mjs`, `test/showcase.mjs`, `test/load.mjs`. Deletes: `public/game/town.js`, `townboard.js`, `examples/`, `fly.toml`, the eight old tests.

`package.json` scripts, fixed now so nobody else edits the file: `start`, `showcase` (`SHOWCASE=1`), `test:server`, `test:agents`, `test:floor`, `test:floor-mobile`, `test:world`, `test:world-mobile`, `test:showcase`, `test:load`, and `test` running them all in that order.

| # | Item | Files | Key functions | Verify |
| --- | --- | --- | --- | --- |
| B3.1 | Shell and socket | `index.html`, `game.js`, `net.js`, `core.js`, `shell.css` | `connect()`, `send(type, body)`, `act(name, args)` (seq + `ack`), `subscribe(floorId)`, `on(type, fn)`, `route(view)`, the single animation loop | Mount nodes `#stage`, `#shell`, `#floorUi` exist; reconnect resends `hello {token}` and resubscribes |
| B3.2 | Landing and roles | `roles.js` | `showLanding()`, `pickRole(role)`, `showBusy(options)`, `showChalkboard()` → `createFloor` | Spectator is preselected and lands on the overview; Player gets the chalkboard then a floor; with slots full, the busy sheet offers Demo kitchen, look around, queue; Judge shows Sonnet in the pill |
| B3.3 | Overview | `overview.js` | `renderOverview(building)`, `walkIn(floorId)` | One card per floor with number, name, score, shipped, LIVE/DEMO dot, watchers; updates on each `building`; a tap walks in read-only |
| B3.4 | Park | `park.js`, `parkinput.js`, `presence.js` | `buildPark()`, `syncBuildings(building.floors)`, `enterDoor(plot)`, `disposePark()` | A building per floor with a plot; name sign and LIVE/DEMO lamp; walking onto a doormat enters; other visitors' avatars move; no cards, teams, bell or bus remain |
| B3.5 | Door, teleport, one scene loaded | `teleport.js`, `game.js` | `travel(target)`: doors close 0.6 s → `unsubscribe` → unmount → `subscribe` → mount → doors open; `openDoorPanel()`, `openDrawer()`, `goHome()` | Floor A → B: only B's `floor` messages arrive afterwards; one scene mounted; switch under 3 s; the door panel's Back returns; a player away from home gets "Go home" on a call-back |
| B3.6 | Pill and budget modal | `pill.js` | `renderPill(floor)`, `openModeSheet()`, `budgetModal()` | "LIVE · Haiku 5.5 · $0.04 of $0.10" from the snapshot; "DEMO · pre-cooked"; `budgetSpent` opens the modal with both buttons; Demo → Live is disabled without a slot or budget |
| B3.7 | Rosterette and TV shots | `template-project/`, `public/tv/` | The 9 files of spec 8.2; `start.png` and `order-1.png` … `order-5.png`, rendered headlessly from hand-made "after" variants | Rosterette loads with 2 green self-checks in a headless page; six images exist under 60 KB each |
| B3.8 | Showcase | `server/showcase/index.mjs`, `sandbox.mjs`, `runner.mjs`, `preview.mjs`, `hooks.mjs` | `createShowcase`, `snapshotCommit()`, `diffSince(commit)`, `denyPathsOutsideSandbox`, `cook()` | `node test/showcase.mjs` with a fake `queryFn` that edits `api.js`: the Meal carries the real diff and hunks; a path outside the sandbox is denied; the preview serves the changed file; `reset()` restores the template; the SDK is never imported in the test |
| B3.9 | Deploy and load | `render.yaml`, `Dockerfile`, `.dockerignore`, `package.json`, `README.md`, `test/load.mjs` | Env list from spec 7.10; health `/health`; no git in the image; Agent SDK left out of the image | `docker build` succeeds if Docker is present, else `node server/index.mjs` under `NODE_ENV=production`; load test: 20 headless players ship one Order each against the mock API on a local server |

## 5. The contract

Constants live in `shared/protocol.js`; types in `shared/types.js`. `PROTOCOL = 1`.

### 5.1 HTTP

| Route | Answer |
| --- | --- |
| `GET /` and static files under `public/` | The client |
| `GET /shared/*` | `shared/` as ES modules |
| `GET /content/*` | `content/` as ES modules (`shared/fixtures.js` imports `../content/orders.mjs`) |
| `GET /vendor/*` | `three` build and addons (as today) |
| `GET /tv/*` | Stand-in screenshots |
| `GET /health`, `GET /healthz` | `200 {"ok":true}` |
| `GET /admin/usage` (header `x-admin-secret`) | `{ spentUsd: { house, judges, total }, caps, floors: { live, demo, judges }, queue: { inflight, waiting }, liveQueue }` |
| `POST /admin/mode` (same header) `{ defaultMode }` | Flips the default for new floors (fallback 1) |
| `GET /preview/showcase/*` | Showcase only; 404 otherwise |
| WebSocket at `/ws` | Everything else |

### 5.2 Client → server

Every message is JSON with `type`.

| Type | Body | Notes |
| --- | --- | --- |
| `hello` | `{ v: 1, token? }` | First message. A valid token resumes ownership of that floor |
| `chooseRole` | `{ role }` | `spectator`, `player` or `judge`. Answered by `welcome` |
| `createFloor` | `{ name?, settings?: { gracePeriodMs, maxWorkMs }, mode?: 'live' \| 'demo' }` | Answered by `welcome` with `token` and `floorId`, or `error no_slot` |
| `joinQueue` / `leaveQueue` | `{}` | For a live slot; `notify slotFree` when one opens, held 30 s |
| `subscribe` | `{ floorId }` | Replaces any earlier subscription. Answered by a `floor` message |
| `unsubscribe` | `{}` | Back to the park and overview |
| `action` | `{ seq, name, args }` | Answered by `ack` with the same `seq`. Owner only |
| `p` | `{ x, z, r }` | Avatar position in the current zone, at most 10 a second |
| `splash` | `{ to }` | The water gun. `to` is the target's `connId` (the `id` in `peers`). Sent on only when both stand in the same zone (the park, or the same floor) within 6 units of each other's last `p`; 1 a second per sender, 1.5 s cooldown per target; otherwise dropped silently. Answered by `splashed` to the whole zone. No score or other effect |

Actions and their `args`:

| Name | Args | Refusal codes |
| --- | --- | --- |
| `seat` | `{ customerId, table? }` | `no_table`, `bad_state` |
| `saveItems` | `{ customerId, items: [{ id?, prompt, station, quickPickId?, typed }] }` (replaces that Order's drafts; 1–5) | `too_many`, `bad_station`, `empty` |
| `sendItems` | `{ customerId }` | `no_items` |
| `sampleMeal` | `{ mealId }` | `bad_state` |
| `seeHunk` | `{ mealId, index }` | |
| `redoMeal` | `{ mealId, reason }` | `bad_state`, `empty` |
| `approveMeal` | `{ mealId }` | `unread` |
| `serveOrder` | `{ customerId, mealIds?, note? }` (default: every approved Meal of that Order) | `nothing_approved` |
| `readFeedback` | `{ customerId }` | |
| `moreWork` | `{ customerId }` (turns `suggestedFollowUps` into drafts) | `bad_state` |
| `giveBill` | `{ customerId }` | `no_feedback` |
| `startBreak`, `endBreak` | `{}` | `not_eligible` |
| `updateSettings` | `{ gracePeriodMs?, maxWorkMs? }` (0–15 min, 10–60 min; in short timings 0–60 s, 30–300 s) | |
| `setMode` | `{ mode }` | `no_slot`, `no_budget`, `no_key` (the server has no API key) |
| `closeShift`, `playAgain`, `leave` | `{}` | |

Any action while a forced break is due answers `must_break` (except `startBreak`, `leave`, `closeShift`, `setMode`). Any action from a non-owner, or from an owner while subscribed to another floor, answers `view_only`; from a connection with no floor at all, `no_floor`. After the shift has ended every action but `playAgain`, `leave`, `closeShift`, `setMode` and `updateSettings` answers `shift_over`. Any action but `endBreak` during a break also ends the break. Text limits: prompt 600, reason 300, note 300, floor name 24 characters.

### 5.3 Server → client

| Type | Body |
| --- | --- |
| `welcome` | `{ v, connId, role, name, look, token?, floorId, serverNow, showcase: boolean, defaults: { settings, mode, live, demo }, limits: { items: 5 }, liveOpen, queuePosition }`. `floorId` is `null` when the connection owns no floor (a stale token). `settings`, `live` and `demo` are each `{ gracePeriodMs, maxWorkMs, ranges: { gracePeriodMs: [min, max], maxWorkMs: [min, max] } }`: `settings` for the default mode. `liveOpen` = a live floor could start now for this role. `queuePosition` is −1 when not queued. Sent after `hello`, `chooseRole`, `createFloor` and `joinQueue` |
| `floor` | `{ floor: FloorSnapshot, you: { isOwner, canAct }, now }`: sent on subscribe and after every change, at most 10 a second per floor |
| `building` | `{ now, floors: FloorLine[], slots: { liveUsed, liveMax, judgeUsed, judgeMax, queued }, liveOpen: boolean, park: { w, h } }`: every 2 s, to everyone |
| `peers` | `{ zone, peers: [{ id, name, look, role, x, z, r }] }`: 5 a second, only to zones with more than one connection; at most 30 |
| `notify` | `{ kind, floorId, customerId?, mealId?, table?, text }`: kinds `mealReady`, `feedbackReady`, `callBack`, `burnt`, `stoveWait`, `budgetSpent`, `slotFree`, `mustBreak`, `shipped`, `floorClosed`, `liveOff` (the owner asked for Live and got Demo: no key, or no slot or budget on Play again; `text` says which). To the owner wherever they are; `shipped` and `floorClosed` also to watchers |
| `ack` | `{ seq, ok, code?, message? }` |
| `splashed` | `{ from: name, fromId: connId, toId: connId, dir: { x, z } }`: to everyone in the zone, so all see the target drip; the client shows the splash overlay only when `toId` is its own `connId`. `dir` is the unit vector from the shooter to the target |
| `error` | `{ code, message }`: `bad_message`, `no_slot` (with `options: ['demo', 'visit', 'queue']`), `no_floor`, `full`, `rate` |

A zone is the subscribed `floorId`, or `park` when not subscribed.

### 5.4 Snapshots

All times are server epoch ms; the client corrects with `now`. Nothing here ever holds a key or a token.

```ts
interface FloorLine {            // one per floor, in `building`
  id: string; number: number; name: string; plot: number | null;   // plot 0–23, null = not on the park
  kind: 'audience' | 'showcase'; ownerRole: 'player' | 'judge'; mode: 'live' | 'demo'; model: string; modelLabel: string;
  score: number; shipped: number; watchers: number; phase: Phase;
  lights: { cooking: number; onPass: number; waiting: number };
}

interface FloorSnapshot {
  id: string; number: number; name: string; plot: number | null;
  kind: 'audience' | 'showcase'; ownerRole: 'player' | 'judge';
  mode: 'live' | 'demo'; timings: 'real' | 'short';
  model: string; modelLabel: string;                 // 'claude-haiku-5-5', 'Haiku 5.5'
  keySource: 'house';
  budget: { spentUsd: number; capUsd: number; blocked: boolean; canGoLive: boolean };
  settings: { gracePeriodMs: number; maxWorkMs: number; maxAgentsForBreak: number };
  phase: 'working' | 'break' | 'called_back';
  phaseStartedAt: number; workStretchStartedAt: number;
  breakEligible: boolean; mustBreakAt: number | null; mustBreak: boolean;
  callBack: { graceEndsAt: number | null; firedAt: number | null };
  ownerAway: boolean; ownerConnected: boolean;
  demoReason: 'no_key' | 'no_slot' | 'no_budget' | null;   // why a floor that wanted Live runs in Demo; null once Live
  shift: { status: 'running' | 'ended'; startedAt: number; endsAt: number | null; report: ShiftReport | null };
  line: Customer[];                                   // in queue order
  tables: (Customer | null)[];                        // length 2
  chefs: Chef[];                                      // length 2
  readyQueue: string[];                               // item ids, FIFO
  pass: string[];                                     // meal ids awaiting review
  items: Record<string, Item>; meals: Record<string, Meal>;
  score: number; stats: ShiftStats; watchers: number;
  guide: { seat: boolean; split: boolean; review: boolean; serve: boolean; ship: boolean };
  tv: { shots: string[]; version: number };           // shipped order ids in order; version for the showcase preview
  chips: { redo: string[]; serve: string[] };         // quick picks that are the same for every Order
  pops: { id: number; text: string; points: number; at: number; anchor: string }[];   // last 8 score events
}

interface Customer {
  id: string; name: string; persona: string; strictness: 1 | 2 | 3; look: number;
  order: Order; table: number | null;
  status: 'in_line' | 'seated' | 'waiting_food' | 'eating' | 'awaiting_player' | 'paying' | 'left';
  feedback?: Feedback; feedbackRead: boolean; feedbackRound: number;
  patience?: Patience; seatedAt?: number;
  receipt?: { items: number; redos: number; tookMs: number; score: number; points: number };
}
interface Order {
  id: string; number: number; source: string; title: string; description: string;
  acceptanceCriteria: string[]; difficulty: 1 | 2 | 3; size: 'S' | 'M' | 'L';
  quickPicks: QuickPick[]; itemIds: string[];
}
interface QuickPick { id: string; label: string; prompt: string; station: Station; estCookMs: number; followUp?: true }   // followUp: added by moreWork from the Feedback
interface Item {
  id: string; orderId: string; customerId: string; prompt: string; station: Station; estCookMs: number;
  status: 'draft' | 'queued' | 'waiting_stove' | 'cooking' | 'ready' | 'sampled' | 'approved' | 'served' | 'burnt';
  typed: boolean; quickPickId?: string; redoReason?: string; redoCount: number;
  chefId?: string; mealId?: string; cookStartedAt?: number; cookEndsAt?: number;   // cookEndsAt = earliest release
}
interface Meal {
  id: string; itemId: string; orderId: string; summary: string; changedFiles: string[];
  diff: string; hunks: Hunk[]; hunksSeen: number; readyAt: number;
  setMenu: boolean; ranOut: boolean; real: boolean;   // real = a git diff from the showcase floor
  patience?: Patience;
}
interface Hunk { file: string; header: string; lines: { t: '+' | '-' | ' '; text: string }[] }
interface Feedback { satisfied: boolean; score: 1 | 2 | 3 | 4 | 5; comments: string; suggestedFollowUps: { prompt: string; station: Station }[] }
interface Chef {
  id: string; name: string; modelLabel: string;
  status: 'idle' | 'walking' | 'waiting_stove' | 'cooking' | 'plating';
  itemId?: string; station?: Station; idleSince?: number; thought?: string;
}
interface Patience { startedAt: number; durationMs: number; lost: number; angry: boolean }
interface ShiftStats { shipped: number; meals: number; redos: number; firstTime: number; callBacks: number; callBackMsTotal: number; breakMs: number; longestWorkMs: number; patienceLost: number; idlePenalty: number }
interface ShiftReport { shipped: number; points: number; reworkRate: number; avgCallBackMs: number; breakMs: number; longestWorkMs: number; verdict: string }
```

Not in the snapshot: `costUsd` per Item, `scriptedMealId`, connection ids, the owner token, any key.

### 5.5 Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | 4610 | |
| `ANTHROPIC_API_KEY` | none | Without it, every floor is Demo and the pill says so |
| `ANTHROPIC_BASE_URL` | none | Tests only: the mock |
| `ADMIN_SECRET` | none | Without it, admin routes answer 404 |
| `MAX_LIVE_FLOORS`, `JUDGE_SLOTS`, `MAX_FLOORS` | 60, 6, 200 | |
| `MAX_INFLIGHT_CALLS` | 20 | |
| `PLAYER_CAP_USD`, `JUDGE_CAP_USD`, `JUDGE_POOL_USD`, `GLOBAL_STOP_USD` | 0.10, 1.00, 15, 100 | |
| `DEFAULT_MODE` | `live` | |
| `LIVE_TIMINGS` | `real` | `short` gives Live floors the short timings (open question 2) |
| `SHOWCASE`, `SHOWCASE_CAP_USD` | unset, 5 | |
| `SHIP_PACE` | 1 | Tests only: divides every timer |

## 6. Open questions

Each has a default the builders use until told otherwise.

| # | Question | Recommended default |
| --- | --- | --- |
| 1 | The sample project: build Rosterette as spec 8.2 describes (9 small static files), or keep the prototype's `examples/roster-cafe` and rewrite the 5 Orders around it? | Build Rosterette. The spec's Orders, quick picks, Station file focus and Chef brief all name its files, and a static app needs no server for the preview. Roster Cafe is deleted |
| 2 | Live timings on Render during the 2-minute play: the spec's real values (5 min grace, 5 min patience, 25 min max work) mean nobody in the room sees a call-back. Use short timings for Live on demo day? | Yes: set `LIVE_TIMINGS=short` on Render for the demo; the chalkboard still lets a player choose. The code default stays `real` as the spec says |
| 3 | The park draws 24 buildings, but there can be 60 live floors plus Demo floors. What happens to the rest? | The first 24 floors get a plot. Later floors have no building and are reached from the overview and the teleport drawer, which list every floor. A freed plot goes to the oldest floor without one |
| 4 | D17's default carries over Chef questions and "Bin the order"; this plan parks both to lock the core. Agreed? | Parked. Text-only Chefs make a single call and have nothing to ask |
| 5 | Judge access: open button (D20 default) or a short code? An open button lets anyone take a Sonnet floor until the 6 slots or $15 pool run out | Open button, as the spec recommends; the pool and the $1 cap bound the cost |
