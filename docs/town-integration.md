# Ship Shift Town: wiring the town into the game (Builder C)

Draft of the Phase 2 edits to the existing client files. Nothing here is applied yet. It is written against `docs/town-protocol.md` and Builder B's `net.js` and `presence.js` as they stand. `park.js`, `parkinput.js`, `townboard.js` and `world.css` had not landed when this was written, so every line that touches them is marked **(B)** and gets reconciled with the integration note at the top of `park.js` first.

## Decisions

- **The test hook is `__ship.town`, not `__ship.world`.** `__ship.world` is already the kitchen's `{ cooking, fires, smoking, cheer, side }` and `test/game.mjs` reads `world.fires`.
- **`G.S` is the kitchen being drawn.** `G.own` is always your own kitchen. `G.visit` is `{ of, relation, rights }` while you stand in somebody else's, else `null`. The HUD, the shift report and the L board read `G.own`; the room reads `G.S`.
- **Three modes:** `kitchen` (your own), `park`, `visit`. `document.body.dataset.zone` carries the mode so CSS can swap the touch pad and hide kitchen-only HUD parts.
- **One new module, `public/game/town.js`, holds the glue** (mode switch, visit state, door, bounce, Start over dialog, the hook). The existing files get small hooks only. That keeps the diff in files other agents have touched short.
- **The Door is a low gate in the front wall, left of the prep island** (`x −3.3, z 3.62`, standing spot `(−3.3, 3.05)`). The left wall is all order window and the bin owns the front-left corner. It is built hidden and only becomes a station when a town exists, so `test/game.mjs` and `SHIP_WORLD=0` see the kitchen they see today.
- **Town-only menu buttons are created from script**, not written in `index.html`: `test/mobile.mjs` counts exactly five `.rb` in `#tools` with the town off.
- **M stays "mute".** The plan gives M to the whole-town overview, but M already mutes. The overview goes on `V` (view) unless B's `parkinput.js` has already claimed a different key **(B)**.

## The hook the test drives

`window.__ship.town`, defined in `town.js` and attached in `game.js`:

| Member | Meaning |
|---|---|
| `on`, `mode`, `zone` | Town exists; `kitchen` / `park` / `visit`; `park` or `k:<plot>` |
| `snap`, `you` | Latest world snapshot (`net.town.world`) and its `you` |
| `home` | Your own kitchen's state (`G.own`), wherever you stand |
| `visiting` | `G.visit` |
| `pos()` | `{x, z}` of your avatar in the current zone |
| `enterPark()`, `goHome()`, `visit(plot)` | Walk to the door or doormat and press E; from the wrong zone they leave first. Promise of the zone |
| `walkTo(x, z)` | Park only. Promise that resolves on arrival |
| `take(id)`, `put(id, plot\|null)` | Walk up, wait for the position to reach the server, then `net.take` / `net.put`. Resolve `{ok, code, error, card}` and retry once on `far` |
| `accept(id)`, `decline(id)`, `bell()` | Straight through to `net.js` |
| `players()` | Avatars drawn in this zone, not you: `[{pid, name, x, z, full}]`. `full` is true for a full character, false for a pawn |
| `cards()` | Park customers being drawn: `[{id, state, x, z}]` |
| `screenOf(x, z)` | Screen point of a ground position in the current scene |
| `drawCalls()`, `labels()` | Whole-frame draw calls (both outline passes), and visible `.lbl` count |
| `overview(on)` | The whole-town camera |

DOM the test relies on: station id `door`; `#visitBanner` (with `hidden`), `#visitLeave`; `#startOverBtn` in `#tools`; `<dialog id="startOver">` with `#freshGo`, `#resetToken` (`type=password`, `autocomplete=off`), `#resetGo`, `#resetMsg`; `guide.step === 'out'`, `guide.target === 'door'`, `guide.done.out`; a visitor's review panel hides `#rBack` and `#rBin`.

## `public/game/core.js`

- `G` gains `own: null, visit: null`.
- `export const can = right => !G.visit || !!G.visit.rights?.[right];`
- `export const kpath = path => …` maps an own-kitchen route to the visitor route while `G.visit` is set, and returns it unchanged otherwise:
  - `/api/questions/:id/answer` → `/api/world/kitchens/:of/questions/:id/answer`
  - `/api/orders/:id/review` → `/api/world/kitchens/:of/orders/:id/review`
  - `/api/orders/:id/diff` → `/api/world/kitchens/:of/orders/:id/diff`

## `public/game/scene.js`

- **Scenes.** `const scenes = { kitchen: scene }; let active = scene;` `export function addScene(name, s)`, `export function setScene(name, { follow = null } = {})`. `render()` draws `active`.
- **Whole-frame draw calls.** `renderer.info.autoReset = false;` and `renderer.info.reset()` at the top of `render()`. Today `drawCalls()` reports only the outline pass, because `OutlineEffect` renders twice and the counter resets between.
- **Follow camera.** `view.follow = { x0, x1, z0, z1 } | null`, `view.wide`.
  - `updateCamera(dt, focus)`: with `view.follow`, `DIR` is always `DIRS.front`; the distance is solved once per resize so about 16 units of lawn span a landscape screen and about 9 span an upright phone; `look` eases to `focus` clamped so the view never leaves the park; the view offset only centres the lawn between the HUD and the touch pad.
  - `setOverview(on)`: fits the four park corners with the existing `solveFit`, fed park fit points.
  - `isSide()` becomes `view.side && !view.follow`, so the thumb stick is not rotated on the lawn.
- **Particles** stay in the kitchen scene. `spawn(..., { parent })` is added only if B's chimney smoke wants the shared pool **(B)**.
- Labels, popups and `toScreen` are shared as they are: a label nobody re-issues this frame is removed, which is what clears kitchen labels in the park.

## `public/game/world.js`

- **Exports:** `character` (new `parent = scene` option, and it returns `tint`: the apron, band and scarf meshes), `pose`, and `setLook(ch, { color, skin })`.
- **`resetWorld()`**: removes customers, leaving customers, tickets, plates, coins, strings and agent chefs from the scene; clears `slotOf`, `passSlotOf`, `backOf`; `local.board = local.hatch = local.binConfirm = null`; `local.booted = false`; `setCarry(null)`; zeroes each stove's `heat`, `burn`, `tools`; hides flames and alarms. Order ids collide across kitchens, so this runs on every change of kitchen and on `fresh`.
- **Door station.** Gate posts, a swing gate, a doormat and a small hanging sign, built `visible = false`. `export function enableDoor()` shows them, adds a `DOOR / to the park` floor stencil and pushes `station({ id: 'door', type: 'door', top: V(-3.3, 0.95, 3.62), access: [V(-3.3, 0, 3.05)], ring: V(-3.3, 0, 3.05) })`. `export const doorSt`.
- **`placePlayer(at)`**: puts the player on a spot and clears path, velocity and carry: used when you come in through the door.
- **`avatarKit`** for `presence.syncAvatars`: `make({ look, name, pid })` builds a chef with that look, `pose` is the kitchen's `pose`, `remove` takes it out of the scene, `label` hangs the name over the hat with `label()`.
- `animateWorld`: the player's own apron follows `you.look` through `setLook`.

## `public/game/input.js`

- `export const mode = { park: false, tap: null, key: null };` set by `town.js`.
  - `handleKey`: when `mode.park`, shared keys still work (`?`, `H`, `P`, `M`, `` ` ``, `L`, `Escape`); every other key goes to `mode.key(e)` **(B: `parkinput`)** and the kitchen's handling is skipped.
  - `pickAt`: when `mode.park`, calls `mode.tap(cx, cy)` **(B)** and returns. The thumb stick code is shared as it is.
  - `step()` is not called in the park; `export function moveVector()` hands the same keys and stick to the park's own walking **(B)**.
- **`interact`, top of the function:**
  - `door`: carrying a `waiting` ticket → bounce (below); carrying anything else → "Hands full"; otherwise `emit('door')`.
  - while `G.visit`: `door` leaves; a `pass` with a plate opens the review when `can('approve')`; a chef with a question is left to the bubble; everything else does nothing and toasts once, "You are visiting. Only {owner} can do that."
- **Bounce:** `await api(\`/api/orders/${id}/bounce\`)`, `setCarry(null)`, a puff at the gate, popup "Back to the park".
- **Keys while visiting:** digits, `X` and `T` on a bubble need `can('answer')`; `F`, `R` (unless `can('approve')`), `X` on a stalled chef and `Q` are ignored. A refused key toasts why: "Only this kitchen's team can answer" or "This kitchen is private: watching only".
- `urgent()` returns `null` while visiting.

## `public/game/panels.js`

- `hud()`, `maybeReport()` and the L board read `G.own || G.S`.
- `describe()`:
  - `door`: "Door to the park" / with a waiting ticket in hand "Send #7 back to the park" with `E`; while visiting "Back to the park".
  - while `G.visit`, every other station keeps its title and facts and loses its keys, except the pass (`E review` when `can('approve')`) and a blocked chef (answer keys when `can('answer')`).
- `bubble()`: without `can('answer')` the options render inert (`.bub.ro`, no `data-key`) over one line saying why. With it, a visitor gets the options and `T`, and never "Always this shift".
- `answerKey`, `typedAnswer`, `openReview` (diff) and `approve` post through `kpath()`.
- `openReview` while visiting hides `#rBack`, `#rBin`, `#rComment`, `#rCold`; `sendBack` and `rBin` return early.
- Popups that point at a place in the room (`orderPos`) are skipped unless you are home.

## `public/game/guide.js`

- `STEPS` becomes `steps()`: the five steps, plus `['out', 'Outside']` when a town exists.
- `nextMove()`: with a town and `!done.out`, the two passive hints ("the oven is running the tests", "{chef} is writing the code") and the end of the list point at the door instead: far "Step outside while they cook", sub "The park is your team's backlog", near "Step outside", key `E`.
- `mark('out')` when the zone becomes `park`. The walkthrough is not drawn in the park or while visiting.
- Help sheet: with a town, extra rows for the door, the park keys, visiting and the door signs **(B: the park's key list)**.

## `public/game/touch.js`

- `layout()`: in the park the camera never turns to the street end (`setLayout` is told `side: false`), and the pad padding comes from the park pad's height **(B)**.
- `touchFrame()`: in the park the kitchen's context buttons (`Urgent`, `Call out`) hide and Act and Put down follow the park's hint **(B)**; while visiting `Urgent` hides.

## `public/index.html`

- `<link rel="stylesheet" href="/world.css">` **(B)**.
- Inside `#stage`: `<div class="visit" id="visitBanner" hidden><span id="visitText"></span><button class="btn small" id="visitLeave" type="button">Leave</button></div>` and `<div class="iris" id="iris"></div>` for the 0.3 s wipe.
- `<dialog id="startOver">`: "Fresh kitchen" (`#freshGo`, yours only), and under a `<details>` "Presenter: reset the whole town" with `#resetToken`, `#resetGo`, `#resetMsg`. The token goes from the field to `net.resetTown()` and the field is cleared at once; it is never stored, logged or put in a URL.
- Whatever hosts B's modules need (feed, park HUD, wheel, chalkboard) **(B)**.
- Styles for the banner, the wipe, the dialog and `.bub.ro` go at the end of `game.css`, or in `world.css` if B prefers one town stylesheet **(B)**.

## `public/game/town.js` (new, mine)

- State: `mode`, `G.visit`, `leaving`.
- `initTown()` from `game.js` once the first `world` message arrives: `enableDoor()`, adds `#startOverBtn` to `#tools`, builds the park **(B: `buildPark`)**, `addScene('park', …)`, subscribes `onWorld` → `syncPark` and `syncAvatars`, `onZone`, `onFresh`.
- `onZone(m)`: wipe; then
  - `park`: `G.visit = null`; `setScene('park', { follow })`; park avatar at `m.x, m.z`; `mode.park = true`.
  - your own plot: `resetWorld()` if another kitchen was drawn; `G.S = G.own`; `syncWorld()`; `setScene('kitchen')`; `placePlayer(doorSt.access[0])`.
  - another plot: `resetWorld()`; `G.S = null` until the visitor `state` arrives; banner "Visiting Ana's kitchen · teammate · Open to team".
  - `refused`: a toast with the reason. A zone change the player did not ask for (the kitchen you were in closed) takes the same path.
- `on('door')`: `go('park')`. In the park, E on a doormat is B's gesture and ends in `go('k:<plot>')` **(B)**.
- `frame(dt, t)` per mode, called from `game.js`: sends `sendPos()` in every zone, so an owner and their visitors see each other.
- Start over dialog, the hook, and `visitLeave`.

## `public/game.js`

- `connect()`: `ws.onopen = () => attach(ws)`. `onmessage`: `if (route(m)) return;` then
  - own `state` (no `relation`, or `owner`): `G.own = m.state`; drawn with `apply()` when home, otherwise only the HUD, the walkthrough's ticks and the report run.
  - a visitor `state` whose `of` is the zone you stand in: `G.visit = { of, relation, rights }`; drawn with a quiet `apply` (no sounds, no score popups, no walkthrough).
- `onFresh`: `resetWorld()`, `G.own = G.S = null`, `lastPointT = Infinity`; the next `state` draws the new kitchen.
- `frame()`: `mode === 'park'` runs the park's input, `stepPark`, the follow camera and `render()`; otherwise today's loop plus `stepAvatars(dt, t)`.
- `__ship.town` from `town.js`.

## README

A "Town" section: what the park is, teams, visiting and door signs, `npm run reset` and the presenter's token, `node test/worldgame.mjs [dir]`.

## Phase 2 order

1. Read B's integration note; settle every **(B)** line above.
2. `scene.js`, `world.js`, `core.js`; run `node test/game.mjs` (the kitchen alone must be unchanged).
3. `town.js`, `game.js`, `input.js`, `panels.js`, `guide.js`, `touch.js`, `index.html`.
4. `npm run check`, `node test/game.mjs`, `node test/mobile.mjs`, `node test/worldgame.mjs <dir>`; fix until green.
5. Look at every screenshot on laptop and phone; iterate.
