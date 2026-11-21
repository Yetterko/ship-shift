# Ship Shift rebuild plan

Fable 5.2 wrote this plan after auditing the game on 2026-11-21. Opus implements it. The contract between server and client is at the end; both halves must match it exactly.

## Principle: your position is your attention

You can attend to one station at a time, and three kinds of thing compete for you: blocked chefs, cooling plates and impatient customers. Detail shows only where you stand; everything else must be readable as an icon from across the room. Trips are at most about 1.2 s (smaller room, dash), and nothing pauses.

| Physical action | Real decision |
|---|---|
| Carry a ticket to a chef | Which model and cost, and how many to run in parallel |
| Drop a ticket on the prep island first | Plan first or code straight away |
| Shake a spice jar (Install, Network, Delete) onto a ticket or chef | Pre-grant a permission class so the agent won't block later |
| Taste a cooking chef's pot (E) | See the live work-in-progress diff and tool feed |
| Call out (F) and type one line | Interrupt and resume the session with a correction |
| Answer a ? with 1/2/3, or X for "your call", in a bubble over the chef | Unblock it. Permissions offer Once, Always this shift, or No |
| Plates ride chef → oven → pass on their own | None, so you don't carry it |
| Flip the oven lever, "re-fire once on fail" | Automatically resume with the test output |
| Review at the pass while the kitchen keeps running | Approve or send back with a note |
| Carry an approved plate to the hatch | Choose the merge order. Overlapping plates are joined by a red string, and a plate that no longer merges goes cold |
| Tab | Go to the most urgent thing |

**Pressure, all from real events**
- A blocked ? escalates: bounce, then smoke at 20 s, then flames and an alarm at 60 s. It costs 1 point per 10 s after the first 20 s.
- Plates go cold as main moves.
- Customer patience pays a tip.
- A streak multiplier builds on right-first-time ships.
- Shipping without scrolling the diff counts as a "blind ship" and earns no bonus.
- In focus mode, pots get lids and the alarm is silent, but blocked time is still counted.

## Build items

1. **Kitchen, camera and look (client).** Split `game.js` into `public/game/{scene,world,input,panels,audio}.js`. Serve the three.js addons and add them to the importmap as `three/addons/` (the server half is the backend's job).
   - **Room:** 12×7 floor (x ±6, z ±3.5).
     - Left wall: order window with 4 slots.
     - Back wall: 4 chef stoves at x = −3.6, −1.2, 1.2, 3.6.
     - Centre: an island (x −1.5..1.5, z 0.4..1.4) with the prep board and spice rack.
     - Right wall: oven at z −2, pass with 3 plate spots at z −0.5..1.5.
     - Front right: the hatch and a belt out to a "MAIN" sign showing the commit count. Bin at front left.
   - **Movement:** AABB collision with sliding. Click-to-walk and `__ship.walkTo` use A* on a 0.5 grid. Shift dashes (1.8× for 0.25 s, with a dust puff).
   - **Rendering:**
     - `RoundedBoxGeometry` everywhere, `MeshToonMaterial` with a 3-step gradient map.
     - `OutlineEffect`, thickness about 0.004, dark brown.
     - `ACESFilmicToneMapping`, sRGB output.
     - Key light warm `#ffe2b8` with the shadow frustum tightened to the room; hemisphere `#fff1dc` over `#6b5a7a`.
     - A dark soft blob plane under every counter and character.
   - **Palette:** cream and terracotta floor tiles, teal wall tiles, butcher-block tops, red stoves, brass pass. Replace the void with a gradient, a street outside the window, and a CSS vignette.
   - **Characters:** scale 1.35, head radius 0.38, large eyes with a highlight, floating sphere hands, tall hat. Each chef gets a hat-band colour and a model badge.
   - **Camera:** FOV 30 at about (−0.8, 15, 10.5), eased 10% toward the player.
   - **HUD:** shrink the top bar to clock, score × streak, and three icon meters. Move the focus/break inputs into a popover. Delete `railHud`. Vendor the fonts into `public/fonts` as woff2 (or use system stacks if they can't be fetched).
   - **Verify in `test/game.mjs`:** the floor's projected width is at least 72% of the stage; a chef's head-to-foot height is at least 90px; no two `.lbl` rectangles overlap at start; zero network requests go off 127.0.0.1.

2. **Believable sim (server).** Add `server/sim-scripts.mjs`, with recipes keyed by starter-order title. Each has timed tool events and real edits.
   - **Weekly hours:** fix `<=` and add tests.
   - **Overtime:** the first attempt is wrong, so the tests really fail; the resume fixes it. It asks "per shift or per week?".
   - **Double-booked:** adds a function to `roster.js`.
   - **CSV export:** adds `export.js` and edits the same lines of `pay.js` as Overtime, so whichever ships second really conflicts. On the conflict resume it runs `git merge main` and writes the resolved file. It asks permission for `npm install csv-stringify`.
   - Unknown titles keep the generic behaviour.
   - Tool events gain a `file` field, and `cookRun` collects these into `o.touched`.
   - Add a `SHIP_PACE` divisor for `TARGET_MIN` and the escalation timings.
   - Remove `npm install|i` from `SAFE_SHELL`.

3. **Nothing pauses (client).**
   - **Questions:** shown in a speech bubble over the chef when you are adjacent, with numbered options. Keys 1–4 answer, X skips, T types an answer. Permissions offer 1 Once, 2 Always this shift (when `grantClass` is set), 3 No.
   - **Review:** a non-modal panel docked on the right 44% of the stage. Use `camera.setViewOffset` so the kitchen stays visible on the left.
     - Keys: J/K move by hunk, Enter approves, B focuses the note, Esc closes.
     - The panel tracks which hunks have been scrolled into view, so the client knows whether the diff was seen.
   - **Focus card:** one card at the bottom centre for the station you are at. Distant stations show icons only: progress ring, ?, tick, or flame.
   - `<dialog>` is used only for New order and the shift report.

4. **Pipeline motion, merge truth and serving.**
   - **Server:**
     - `G.mergeCheck` uses `git merge-tree --write-tree --name-only`.
     - `G.changedFiles` lists the files a branch changes.
     - Every `at_pass` order carries `files` and `merge`, recomputed after every ship.
     - Approve sets `approved` and does not merge; `POST /ship` merges.
   - **Client:**
     - Plates animate chef → oven (door, timer ring, a green or red lamp and a ding) → pass slot. No carrying from the chef.
     - An approved plate gets a gold cloche. E picks it up and E at the hatch ships it.
     - A cold plate (`merge.clean === false`) turns blue with frost.
     - Overlapping plates are joined by a red line.

5. **Attention mechanics.**
   - **Server:**
     - `GET /wip` returns the live diff.
     - `POST /steer` interrupts and resumes the session with a note.
     - The blocked-time score tick runs in `tick()`.
   - **Client:**
     - Smoke and flames by blocked age.
     - Lids on the pots in focus.
     - Tab triage: a floor arrow points at the most urgent target and the player auto-walks there.
     - E at a cooking chef tastes it, showing the WIP diff and feed in the focus card.
     - F calls out, as one line of input.

6. **Spice rack and oven lever.**
   - **Server:**
     - Grants (install, network, delete), shift-wide or per order.
     - A grant that matches a request resolves it immediately.
     - Answering with `always: true` adds a shift grant.
     - `rules.autoRefire` re-fires a failing run once, with no send-back penalty.
   - **Client:**
     - Three jars on the island; carry one to a ticket or chef and press E.
     - A lever at the oven.

7. **Juice, sound and the round (client).**
   - **Popups:** floating text for every `stats.points` entry, at its station.
   - **Streak:** shown as × next to the score.
   - **Feel:** squash and stretch, a 0.15 s camera shake on ship and conflict, customers hop and leave a coin.
   - **WebAudio:** a sizzle loop tied to the number of cooking chefs, an oven bell, a fire alarm, and a tick in the last 30 s.
   - **Shift end:** 1–3 stars with one line of advice.
   - **Test hook:** `__ship.fx` counters (popups, shakes, sounds).

8. **Demo mode (server).** `npm run demo`:
   - The sim with `SHIP_PACE=8`.
   - Starter orders arriving at 0, 10, 25 and 45 s.
   - A 3-minute focus shift that starts on demand.
   - `SHIP_REAL_CHEFS=query` gives a per-chef real driver.
   - `SHIP_CHEF_MODELS` sets each chef's model, for example `pixel=claude-haiku-5-5,query=claude-opus-5-5`.

## The 3-minute demo

`npm run demo`:
1. Four customers walk up.
2. Carry the small ticket straight to a chef. Prep the CSV ticket, shake Install on it, and hand it over.
3. The Overtime chef's ? smokes. Dash over and press 1.
4. Taste another pot to see the live diff. Press F: "use round2".
5. The oven shows red for Overtime and the lever re-fires it. Weekly hours shows green and slides to the pass.
6. Review at the pass with J/K and Enter, then carry the plate to the hatch: confetti and a streak.
7. Overtime and CSV are tied by a red string. Ship Overtime and CSV frosts over. Send it back; the chef merges main and it returns green. Ship it.
8. The shift bell rings and the report shows stars. Run `git log --graph` in the demo repo.

## Server ⇄ client contract (both halves must match exactly)

**Snapshot (`GET /api/state` and WebSocket `{type:'state', state}`)**
- Adds `pace` (number, 1 by default), `grants` (shift-wide grant classes, e.g. `['install']`), `rules: { autoRefire: boolean }`, and `overlaps: [[idA, idB, [files]]]` between live orders.
- `chefs[]` has 4 entries: `pixel`, `router`, `query`, `stack`, each `{ id, name, style, model, orderId, blocked }`.
- Each order adds:
  - `touched: string[]`, the files seen in tool events while cooking.
  - `files: string[]`, changed files versus main (set at the pass).
  - `merge: { clean: boolean, conflicts: string[] } | null`.
  - `approved: boolean`, `refires: number`, `grants: string[]`, `targetMin`, which is already divided by pace.
  - `stage: 'cooking'|'oven'|'pass'`, where `testing` maps to `oven`.
- `stats` adds `blindShips`, `steers`, `refires`, `streak` (a multiplier from 1.0 to 2.0), and `blockedPenalty`.
- `questions[]` items add `grantClass: 'install'|'network'|'delete'|null`. It is set for permission requests that match a class.
- `shift` keeps its shape, and the client reads `report.stars` (1–3) and `report.advice` (a string).
- Escalation thresholds for the client are in `snapshot().escalation`, as `{ smokeMs, fireMs }` already divided by pace.

**Endpoints (all POSTs take JSON)**
- `POST /api/orders/:id/review {verdict:'approve'}` sets `approved=true`. The order stays `at_pass`, and nothing merges.
- `POST /api/orders/:id/review {verdict:'send_back', comment}` behaves as before.
- `POST /api/orders/:id/ship {seen:boolean}` requires `approved`, then merges. On a conflict it resumes the agent, as before. With `seen` false it counts `blindShips++` and gives no first-time bonus.
- `GET /api/orders/:id/wip` returns `{ patch, stat }`, the worktree diff including uncommitted work, while cooking.
- `POST /api/orders/:id/steer {note}` interrupts and resumes the session with "The head chef called out: <note>". It returns 400 if the order is not cooking.
- `POST /api/questions/:id/answer {allow, message?, answers?, always?}` adds a shift grant for `q.grantClass` when `always` is true.
- `POST /api/grants {cls, orderId?}` adds a grant for that order, or shift-wide if there is no `orderId`. A pending question that now matches resolves immediately.
- `POST /api/rules {autoRefire:boolean}`.
- Existing endpoints are unchanged: orders, plan, assign, resume, bin, diff, shift start/stop.
- Static: `/vendor/addons/*` serves `node_modules/three/examples/jsm/*`.
