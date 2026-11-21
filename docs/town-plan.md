# Ship Shift Town: shared-world plan

Fable 5.2 wrote this design on 2026-11-21. Fable builders implement it. The user's decisions on the open questions are at the end.

## The experience

### The world
- **Park:** a lawn 40×18 with a fountain at the centre, a kanban chalkboard, a leaderboard board, and a bus stop at the west gate. It is a second `THREE.Scene`.
- **Plots:** 24 plots of 4.5 width (8 north, 8 south, 4 east, 4 west). They fill from the fountain outward, so demo players are neighbours. Empty plots show a "For lease" sign.
- **Spawn:** you start in your own kitchen with one customer already at your door, so the tutorial and `test/game.mjs` keep working.
- **Entering and leaving:** a new Door station sits on the kitchen's street side. E there gives a 0.3 s iris wipe to the park, outside your door. E on your own doormat goes back in.
- **Visiting:** E on someone else's doormat puts you in the same kitchen room, rendering their snapshot, read-only, with a banner "Visiting Ana's kitchen".

### The kanban
A card is a customer. The columns are places:

| Column | Place | Card state |
|---|---|---|
| Backlog | Loose in the park, around the fountain and bus stop | `backlog` |
| In someone's hands | Following a player in a conga line, at most 2 | `held` |
| To do (per person) | Queue lane outside a restaurant door, at most 6 | `queued` |
| Accepted | At that kitchen's order window; it is now a Kitchen order | `seated` |
| In progress / review | Inside; shown outside as status lights | `cooking`, `review` |
| Done | Leaves happy and adds to the fountain counter | `served` |

- **Acceptance:** a queued customer walks in only while the owner is inside and a window slot is free. The patience clock starts then. An owner in the park shows a "Back soon" sign.
- **Claim:** E on a backlog customer and they follow you; E on your doormat queues them.
- **Send:** the same, on another player's doormat. The card records `from`.
- **Bounce:** E on a customer in your queue then Q anywhere returns them to the backlog. Inside, carry a `waiting` ticket to the Door and press E.
- **Lock:** once a ticket is handed to a chef, the card can no longer move.
- **Demo-only rule:** a restaurant refuses a dish it already has or has served ("Ana already serves that"), which makes trading worthwhile.
- **Chalkboard:** E at it opens a DOM board with the same columns and a "Send to…" button for cards in your own queue. It doubles as the keyboard-accessible path.

### Presence
- **Avatars:** the existing chef character with a per-player hat-band and apron colour, plus a name label.
- **Names:** generated ("Chef Basil"), editable, 14 characters, filtered.
- **Emotes:** keys 1–4 for wave, cheer, help and heart.
- **Chat:** eight canned phrases on a wheel (C). No free-text chat on the public link.
- **Feed:** bottom left, for example "Ben sent 'Sunday penalty rate' to Ana".

### Rules in someone else's kitchen
- **Visitors can:** walk, emote, see every station icon, cheer (+5 to the owner, limited to 5 a minute), and leave customers at the door.
- **Visitors cannot:** take tickets, assign, answer, grant, review, ship or bin.
- **Enforcement:** every mutating route resolves the Kitchen from the caller's own cookie, so no route reaches another kitchen.
- **Stretch:** a "Help wanted" sign that lets visitors answer `?` bubbles.

### Shared goals
- **Restaurant score:** the kitchen's existing score plus world bonuses kept in the World.
- **Referral:** +25 to the sender when a card they sent ships.
- **Town score:** the total shipped, on the fountain, with a goal bar.
- **Leaderboard:** a board in the park.
- **Trouble visible from outside:** a blocked chef makes that restaurant's chimney smoke, then burn.
- **Lunch rush:** anyone rings the fountain bell (3-minute cooldown, needs at least 2 players). A bus drops 2 customers per player. If nobody is left standing in the park after 45 s, everyone gets +100 "Full house". Ships during the 90 s rush score ×1.5.

## Architecture

### World server
New `server/world.mjs`, a `World` class with no fs or git: plots, players, cards, feed, rush.

It talks to kitchens only through a link, in-process in public mode:

`{ summary(), admit(card) -> orderId, withdraw(orderId), has(title), on('change') }`

That link is the seam for real mode.

- **Identity:** each session gets a public `pid` (6 hex). `ship_sid` never leaves the server.
- **Presence:** the client is authoritative for position; the server clamps speed and bounds. A 12 Hz tick sends each zone (`park` or `k:<plot>`) only its own players. Changed players go every tick, the full set every 2 s.
- **Authority:** card moves are HTTP POSTs, validated against the server's last known position (within 2.2 units), card state, carry limit, queue cap and the dish rule.
- **Dealing:** each joining player adds their 7 dishes to a supply that arrives at the bus stop on the `DEMO_ARRIVALS_S` schedule. The first, small dish goes straight to their door. This replaces `seatCustomers` in world mode.
- **Leaving:** on session end, queued and unfinished cards return to the backlog and the plot is freed.
- **Idle:** inbound presence touches `s.lastSeen`.

### Wire protocol
Reuse the one `/ws` per session, with its 4096-byte payload limit. Add an inbound limit of 30 messages a second.

| Direction | Message |
|---|---|
| C→S | `{t:'p', x, z, r, m}`: centimetre ints, yaw ×100, flags for moving, dash, carrying. 12 Hz while changed, 1 Hz heartbeat |
| C→S | `{t:'go', z:'park' \| 'k:<plot>'}`: changes zone and kitchen subscription; needs door proximity |
| C→S | `{t:'emote', e}` and `{t:'say', q}`: indexes only |
| S→C | `{type:'state', state, of:<plot>}`: existing message plus `of`; a visitor gets the visited kitchen's snapshot, without `repo` and `questions[].input` |
| S→C | `{type:'world', world}`: on connect and on structural change, debounced 250 ms |
| S→C | `{type:'p', z, ps:[[pid,x,z,r,m,e],…]}` |

World snapshot:

```
{ v, now, mode:'demo'|'team', you:{pid, plot},
  plots:[{id, slot, owner, name, color, open, queue:[cardId],
          lights:{cooking, oven, pass, blocked, fire, stalled}, score, bonus, shipped, stars}],
  players:[{pid, name, look, plot, zone, x, z, r, carry:[cardId]}],
  cards:[{id, title, size, state, plot, heldBy, by, from, x, z, movedAt}],
  team:{score, shipped, goal}, rush:{endsAt, seatBy, left}|null, feed:[{t, text}] }
```

Endpoints go through the existing public `handle` context, so origin checks, the 16 KB body limit, `tidy()` and 300 requests a minute all apply:
- `GET /api/world`
- `POST /api/world/me {name, look}`
- `POST /api/world/cards/:id/take`
- `POST /api/world/cards/:id/put {plot|null}`
- `POST /api/world/cards/:id/send {plot}` (board shortcut, own queue only)
- `POST /api/orders/:id/bounce {plot?}` (own `waiting` order)
- `POST /api/world/cheer {plot}`
- `POST /api/world/bell`
- `/healthz` gains `players`

Switch and cap: `SHIP_WORLD=0` restores private-only behaviour. In world mode the default session cap becomes 24.

### Scale (24 players)
- **Presence:** about 6 KB/s per client.
- **World snapshot:** under 12 KB, sent on change.
- **Real limit:** CPU from 24 kitchens running `npm test` and git. Add a global semaphore of 4 around `G.runTests`.
- **Load testing:** `SHIP_WORLD_BOTS=n` adds wandering bot players with no kitchens, for tests only.

### Rendering
- **Scenes:** the park is its own scene and only the active scene renders. `scene.js` gains `setScene()` and a follow-camera mode (same angle, about 16×9 units visible, clamped to the park, M for a whole-town overview).
- **Shadows:** no shadow maps in the park, blob shadows only.
- **Plot exteriors:** `InstancedMesh` per part (walls, roof, awning, door, chimney, lamp) with instance colours, about 8 draw calls for all plots. Status lights are one instanced mesh. Names are HTML labels through the existing collision system.
- **Characters:** the full `character()` only for the 8 nearest. Everyone else, and all park customers, are a 3-part instanced pawn.
- **Interpolation:** remote players render 100 ms behind.
- **Visiting:** a `resetWorld()` in `world.js` is needed, because order ids collide across kitchens.
- **Budget:** at most 250 draw calls in the park with outlines, at most 16 visible labels, and the existing `adapt()` ladder.

### Real mode (not built now)
- **What the shared world means:** one team host runs the World: backlog, presence and scores.
- **Each member:** runs `npm start` locally with `SHIP_TEAM=<host url + token>`. Their server dials out as a kitchen link, publishes only `summary()`, and accepts `admit` and `withdraw`.
- **Privacy:** the browser still talks only to 127.0.0.1; the local server relays world messages. Agents, credentials, worktrees and diffs never leave the machine. Visiting shows the exterior and board only.
- **Cards:** unique tasks on one repo, so the dish rule is off.
- **What we ship now:** the link interface and a README section.

## Build list (three builders, no file overlap)

**Builder A, server**

| Item | Files | Key functions | Verify |
|---|---|---|---|
| A1 World core | `server/world.mjs` (new) | `join`, `leave`, `take`, `put`, `send`, `admitNext`, `deal`, `kitchenChanged`, `tick`, `snapshot`, `ring` | Unit calls in `test/world.mjs` |
| A2 Kitchen link | `server/kitchen.mjs` | `addOrder` accepts `plan` and `cardId`; `withdraw(id)` for `waiting` only; `summary()` | `npm run smoke` still green |
| A3 Wiring | `server/index.mjs`, `server/sessions.mjs`, test semaphore in `server/git.mjs` | `onEnd` hook, `pid`, WS `message` handler, zone fan-out, routes, `SHIP_WORLD`, `SHIP_WORLD_BOTS` | `test/share.mjs` passes with `SHIP_WORLD=0` |
| A4 Protocol test | `test/world.mjs` (new), `package.json` | 3 cookie jars over fetch and `ws` | See checks below |

A4 checks: take needs proximity; a second taker gets 409; the dish rule refuses; admit happens only with the owner inside; a seated card cannot be taken; bounce returns it to the backlog; leaving frees the plot; `ship_sid` never appears in any world message.

**Builder B, new client modules**

| Item | Files | Key functions | Verify |
|---|---|---|---|
| B1 Park scene | `public/game/park.js`, `public/world.css` (both new) | `buildPark`, `syncPark(world)`, `stepPark(dt,t)`, `parkBlocked`, instanced plots and pawns, chimney smoke | `?park=1` debug screenshot; draw calls |
| B2 Net and presence | `public/game/net.js`, `public/game/presence.js` (new) | `onWorld`, `sendPos`, `go`, interpolation, `syncAvatars(zone)` | Two pages see each other move |
| B3 Gestures and board | `public/game/parkinput.js`, `public/game/townboard.js` (new) | E and Q on cards and doormats, emote and say, kanban and leaderboard overlay, feed, bell | Covered by C3 |

**Builder C, existing client files (starts from B's export stubs)**

| Item | Files | Key functions | Verify |
|---|---|---|---|
| C1 Mode switch | `public/game.js`, `public/game/scene.js` | `setScene`, follow camera, route `world` and `p` messages, frame loop by mode, `__ship.world` hook | `npm run game` still green |
| C2 Door, visit, read-only | `public/game/world.js`, `input.js`, `panels.js`, `guide.js`, `public/index.html` | export `character` and `pose` with a parent, `resetWorld()`, Door station, `readOnly` gate in `interact`, bounce at the door, guide step "Step outside" | Visitor's E on a ticket does nothing |
| C3 Multi-client test | `test/worldgame.mjs` (new), README | Three headless Playwright contexts on `--public`; see below | Screenshots |

`test/worldgame.mjs`:
- **Setup:** three headless pages against `--public` on a spare port, with `SHIP_PACE=80`, `SHIP_SIM_SPEED=10` and `?quality=low`.
- **Driving:** through `__ship.world` (`enterPark`, `walkTo`, `take`, `put`, `visit`, `players()`, `cards()`, `drawCalls`).
- **Assertions:** A sees B's avatar within 1 s; A claims a card and B's page shows it leave the backlog; A sends a card to B and it sits in B's queue until B goes home, then becomes an order in B's kitchen; C visits B and cannot act; with `SHIP_WORLD_BOTS=27` the park stays at or under 250 draw calls.
- **Screenshots:** `park-a.png`, `queue-b.png`, `visit-c.png`, `board.png`, `rush.png`.

**P1:** lunch rush and bell; referral and applause bonuses; chalkboard "Send to…".
**P2 (stretch):** "Help wanted" answering; tourists without a kitchen when the town is full; read-only diff for visitors.

## Demo script (3 minutes, 2–4 people)
1. **0:00** The presenter runs `npm run share`; judges scan the QR code. Each lands in their own kitchen with one customer. The presenter hands the ticket to a chef.
2. **0:25** Everyone walks out the door. The park has named avatars, restaurants with lights, and a bus dropping customers. Wave.
3. **0:45** The presenter claims two customers and walks them home: "that's my to-do column".
4. **1:05** A judge's restaurant already serves Overtime, and the server refuses it. The presenter walks that customer to a teammate's door instead: "that's a handoff, before any agent has started".
5. **1:25** A neighbour's chimney smokes. Visit: their chef has a `?`. "I can see my teammate's agent is blocked, but only they can answer."
6. **1:45** Ring the bell for the lunch rush. Everyone scrambles to seat the bus within 45 s: "Full house +100".
7. **2:15** Back home: review the real diff, ship it, and the fountain counter ticks up. The leaderboard and referral bonus show.
8. **2:40** Close: "Swap the simulated chefs for real Claude agents on each laptop and this park is your team's backlog."

## User decisions (2026-11-21). These override the defaults below.

1. **Teams and projects decide poaching.** Each restaurant belongs to a team, and a team works on one project. In the demo, assign teams on join, for example 2–3 colour teams each named after a project, with a team picker on the name card. The park shows each team's own backlog area.
   - **Same team:** you can take customers from a teammate's door queue until they're accepted, and hand them back and forth freely. It's one shared backlog.
   - **Different team:** you can't take from their queue. You can offer a customer to another team's restaurant; it shows as "offered by Red team" and the owner accepts or declines it.
   - Every move is named in the feed.
2. **Chat:** canned phrases only, plus filtered names.
3. **Visitor rights depend on relation and permissions.**

   | Visitor | Default rights |
   |---|---|
   | Stranger (another team) | Watch, emote, cheer, and offer customers at the door |
   | Teammate | Everything a stranger can, plus answering `?` bubbles and approving at the pass |
   | Owner | Everything, always. Only the owner ships at the hatch, or bins |

   The owner sets the door sign, which narrows or widens those defaults:
   - **Open to team:** the defaults above.
   - **Help wanted:** a stranger can answer `?` bubbles too.
   - **Private:** visitors can only watch.

   The server enforces all of this. A mutating route acting on another kitchen checks the relation and the sign; the existing own-cookie routes stay as they are.
4. **Demo world only for now, but resets must be easy:** every demo starts from a clean slate.
   - Every server start creates a fresh world and fresh kitchens.
   - A presenter reset clears the whole town: all kitchens, repos, cards and scores. Every connected client reloads into a new kitchen. Trigger it with `npm run reset` against the running server, and with a presenter-only "Reset town" control unlocked by a token that `npm run share` prints in the terminal (never shown to players).
   - A per-player "Fresh kitchen" button resets just your own restaurant.
   - The real-mode team link is still not built; ship the interface and a README section.

5. **Completely mobile-supported.** Judges will join from phones, portrait and landscape.
   - **Every town feature works by touch:**
     - a joystick and action buttons (Act, Put down, Dash, Emote, Chat wheel, Board), with tap-to-walk and tap-to-act
     - card take, send and offer, the door sign, accepting and declining offers, the chalkboard, the leaderboard and reset controls
   - **Layout:** the park HUD, feed, board and name card fit a 360px-wide screen, respect safe areas and are readable.
   - **Performance:** the park budget holds on a mid-range phone. Use lower draw calls, fewer labels and the `adapt()` ladder.
   - **Tests:** the multi-client test includes at least one mobile-emulated page (an iPhone in portrait, with `hasTouch`) driven by touch.

## Open questions (now answered above; original recommended defaults)

| Question | Recommended default |
|---|---|
| Can players take customers from someone else's door queue? | Yes, until accepted, and every move is named in the feed |
| Free-text chat on the public link? | No: canned phrases and filtered names |
| How much can a visitor do? | Watch, emote, cheer and deliver customers |
| Build the real-mode team link now? | No: ship the interface and a README section |
| World on by default for share, and where do you spawn? | On, spawning in your own kitchen |
