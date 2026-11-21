# Ship Shift Town: wire protocol additions

The server builder keeps this file current. It lists everything the server does beyond the "Wire protocol" section of `docs/town-plan.md`. Where the two disagree, this file is what the server does.

World mode is on in public mode (`npm run public`, `npm run share`) unless `SHIP_WORLD=0`. With `SHIP_WORLD=0`, and in `npm start` / `sim` / `demo`, none of this exists: `GET /api/world` does not answer 200 (it is 405 today) and `state` messages have no `of`. A client should treat any answer but 200 from `GET /api/world` as "no town". Only the "Kitchen snapshot additions" section applies in every mode.

## Units and ids

- **Park axes:** x runs east, z runs south, the fountain is at (0, 0). The lawn is x −20…20, z −9…9.
- **Snapshot coordinates** (`players[].x/z`, `cards[].x/z`, `plots[].x/z`, everything in `park`) are world units with two decimals. `r` in the snapshot is radians with two decimals.
- **Presence messages** (`p`, both directions) use centimetre ints and yaw × 100, as in the plan.
- **`pid`:** 6 hex characters. **Plot id:** an integer 0…23. **Card id:** a string such as `c12`. **Team id:** `red`, `blue` or `green`.
- **Zones:** `park`, or `k:<plot id>` for the inside of that plot's kitchen. Kitchen zones use the kitchen's own room coordinates.

## World snapshot

`GET /api/world` and the `world` message carry the same object. Fields the plan does not have are marked **new**.

```
{ v, now, mode:'demo',
  you:{ pid, plot, team, name, look, zone },                      // team, name, look, zone are new
  park:{ w:40, h:18, reach:2.2, fountain:[0,0], bell:[0,0], bellReach:3.5,
         bus:[-17.5,0], board:[-5,-5.5], leaderboard:[5,-5.5] }, // new; static
  teams:[{ id, name, project, color, area:{x,z,r}, members, score, shipped }],   // new
  plots:[{ id, slot, side:'n'|'s'|'e'|'w', x, z,                  // side, x, z are new: x,z is the doormat
           owner, name, team, color, sign:'team'|'help'|'private', // team, sign are new
           open, queue:[cardId], offers:[cardId],                 // offers is new
           lights:{ cooking, oven, pass, blocked, fire, stalled, since },
           score, bonus, shipped, stars }],
  players:[{ pid, name, look, team, plot, zone, x, z, r, carry:[cardId], bot }],  // team, bot are new
  cards:[{ id, title, size, state, plot, heldBy, by, from, team, fromTeam, rush, x, z, movedAt }],
  team:{ score, shipped, goal },                                  // the whole town, as in the plan
  rush:{ endsAt, seatBy, left, bellAt }|null, bellAt,             // bellAt: when the bell can ring again
  feed:[{ t, text }] }
```

- **`plots`** always has all 24 entries. An empty plot has `owner:null`, `name:null`, `team:null`, `color:null`. `id` is the fill order (0 is nearest the fountain); `slot` is the geometric index (0–7 north west→east, 8–15 south, 16–19 east north→south, 20–23 west).
- **`plots[].color`** is the owner's team colour as `#rrggbb`. **`look`** is an int 0…7, an index into the avatar palette the client owns.
- **`plots[].open`** is true while the owner is inside their own kitchen. False means "Back soon".
- **`lights`:** `cooking`, `oven`, `pass`, `blocked`, `stalled` are counts. `fire` is true once a chef has waited past the kitchen's fire time. `since` is when the oldest open question was asked (ms), or null. Smoke is `blocked > 0`.
- **`cards[].state`:** `backlog`, `held`, `queued`, `offered` (**new**), `seated`, `cooking`, `review`, `served`.
  - `team` is the team whose backlog the card belongs to. A `backlog` card sits inside that team's `area`.
  - `plot` is set for `queued`, `offered`, `seated`, `cooking`, `review`, `served`.
  - `from` is the pid that brought the card to somebody else's door, and `fromTeam` is that player's team. Both are null when the owner queued it themselves.
  - `rush` is true for a lunch-rush customer.
  - Only the 30 newest `served` cards are kept.
- **`team`** is the town total (the plan's name). Per-team totals are in `teams`.
- **`feed`:** the 20 newest lines, oldest first.

## Teams (user decision 1)

- There are two teams by default, Red ("Payroll") and Blue ("Rosters"). `SHIP_TEAMS=3` adds Green ("Timesheets"); `SHIP_TEAMS=1` leaves only Red.
- A player joins the team with the fewest members. They change it with `POST /api/world/me {team}`.
- A player's seven dishes are dealt into their team's backlog. Changing team drops what you are carrying, and the customers already at your door come with you.

| Move | Same team (or your own) | Another team |
|---|---|---|
| `take` a `backlog` card | Yes | 403 `team` |
| `take` a `queued` card from a door | Yes, until it is seated | 403 `team` |
| `put` / `send` to a door | Queued at once; `from` records the sender | Becomes `offered`; the owner accepts or declines |

- An `offered` card waits at the door for up to 120 s. Then it goes back to the offering team's backlog.
- A door holds at most 6 queued cards and 4 offers.
- Accepting an offer makes the card `queued` and moves it to the owner's team. `from` is kept, so the sender still earns the referral.

## HTTP

Every route below needs the session cookie unless it says otherwise, and goes through the public limits (origin check, JSON content type, 16 KB, 300 requests a minute). A refusal is `{ error, code }` where `error` is a sentence for the player and `code` is one of the codes in the last table.

| Route | Body | Result |
|---|---|---|
| `GET /api/world` | | The snapshot |
| `POST /api/world/me` | `{name?, look?, team?}` | `{ok, you}`. The name is trimmed to 14 characters and filtered; a refused name keeps the old one and answers 400 `name` |
| `POST /api/world/cards/:id/take` | | `{ok, card}`. Needs you within `reach` of the card (backlog) or of the door (queued). Carry limit 2 |
| `POST /api/world/cards/:id/put` | `{plot}` or `{plot:null}` | `{ok, card}`. `null` drops it into its team's backlog from anywhere. A plot needs you within `reach` of its doormat. Result state is `queued` or `offered` |
| `POST /api/world/cards/:id/send` | `{plot}` | `{ok, card}`. A card in your own queue only, from anywhere |
| `POST /api/world/cards/:id/accept` | | **New.** `{ok, card}`. The owner of the door, from anywhere |
| `POST /api/world/cards/:id/decline` | | **New.** `{ok, card}`. The owner of the door, or the player who offered it (to withdraw) |
| `POST /api/orders/:id/bounce` | `{plot?}` | `{ok, card}`. Your own `waiting` order goes back to the backlog, or to that plot's door |
| `POST /api/world/sign` | `{sign}` | **New.** `{ok, sign}`. Sets your door sign |
| `POST /api/world/cheer` | `{plot}` | `{ok, bonus}`. +5 to that plot. You must be inside that kitchen. 5 a minute |
| `POST /api/world/bell` | | `{ok, rush}`. Needs you within `bellReach` of the fountain, 2 players, and the cooldown |
| `GET /api/world/kitchens/:plot` | | **New.** `{of, relation, rights, state}` for the kitchen you are standing in |
| `POST /api/world/kitchens/:plot/questions/:qid/answer` | `{allow, message, answers}` | **New.** A visitor answers a `?` bubble. `always` is ignored |
| `POST /api/world/kitchens/:plot/orders/:id/review` | `{verdict:'approve'}` | **New.** A visitor approves a plate at the pass. A visitor cannot send back |
| `GET /api/world/kitchens/:plot/orders/:id/diff` | | **New.** The diff, for a visitor who may approve |
| `POST /api/demo/restart` | | **New.** `{ok}`. A fresh kitchen for you. "Fresh kitchen" and "Play again" are this one route: see below |
| `POST /api/world/reset` | `{token}` | **New.** No cookie needed. `{ok}`. Resets the town: see below |
| `GET /healthz` | | Gains `players` and `world:true` |

The plan's own-cookie kitchen routes (`/api/orders/...`, `/api/questions/...`, `/api/grants`, `/api/rules`, `/api/shift/...`) are unchanged and always act on your own kitchen.

## Visitor rights (user decision 3)

`relation` is `owner`, `team` or `stranger`. `rights` is what the server will accept from you in that kitchen right now:

| | `watch` | `cheer` | `answer` | `approve` |
|---|---|---|---|---|
| Stranger, sign `team` | yes | yes | no | no |
| Stranger, sign `help` | yes | yes | yes | no |
| Teammate, sign `team` or `help` | yes | yes | yes | yes |
| Anyone but the owner, sign `private` | yes | no | no | no |
| Owner | yes | n/a | yes | yes |

- A visitor must be in zone `k:<plot>` for `cheer`, `answer`, `approve` and the diff.
- Shipping, binning, assigning, planning, sending back, grants and rules are the owner's only. There is no visitor route for them.
- A `private` door also refuses offers from other teams (403 `sign`). Teammates can still queue customers there.
- Entering a kitchen is always allowed, whatever the sign.

## WebSocket

Client to server, beyond the plan:

- `{t:'go', z}`: entering `k:<plot>` needs you in the park within `reach` of that plot's doormat. Going to `park` is always allowed; the client gates it with the Door station. The server answers every `go` with a `zone` message.
- `{t:'emote', e}`: `e` is 1…4. `{t:'say', q}`: `q` is 0…7.
- More than 30 messages a second from one socket are dropped.

Server to client, beyond the plan:

| Message | When |
|---|---|
| `{type:'state', state, of, relation, rights}` | Your own kitchen always (`of` is your plot, `relation:'owner'`). While you are inside somebody else's kitchen you also get theirs, with their plot in `of`, without `repo` and `questions[].input` |
| `{type:'zone', zone, x, z, refused?}` | **New.** After every `go`, and when the server moves you (the kitchen you were visiting closed). `x`, `z` are world units: where you now stand. Both are null when you enter a kitchen. `refused` is a code when the `go` was turned down |
| `{type:'p', z, ps}` | As in the plan. The sixth entry `e` is 0, an emote 1…4, or 10 + a phrase index, and it clears after 2.5 s. Your own pid is included; ignore it |
| `{type:'fresh'}` | **New.** Your kitchen was replaced. Drop everything you know about orders; a `state` follows |
| `{type:'reset'}` | **New.** The town was reset. Reload the page. The socket then closes with code 4002 |

## Fresh kitchen and reset (user decision 4)

- **Every server start** is a new town: the sessions directory is cleared and old cookies open nothing.
- **`POST /api/demo/restart`** replaces your kitchen with a new one: new repo, no orders, score 0. Your sockets get `{type:'fresh'}` first and a `state` when the new kitchen is ready; the request answers `{ok}` then too. Limited to 3 a minute (429 `cooldown`).
  - **In the town** you keep your pid, plot, name, team and sign. Your queued and unfinished customers go back to your team's backlog, your first dish walks up to your door again, and your world bonus goes to 0. Dishes the bus has not brought yet stay on their schedule.
  - **Without the town** (`SHIP_WORLD=0`, and `npm run demo`) the demo repo is rebuilt and the arrivals start again from 0 s.
  - There is no `/api/world/fresh`. The kitchen snapshot advertises the route as `restart`: see the next section.
- **`POST /api/world/reset {token}`** closes every kitchen, deletes every repo and starts a new world. Every socket gets `{type:'reset'}` and closes with 4002. A wrong token answers 403 `token`. Limited to 10 attempts a minute for the whole server.
- **The token** is never in any response, message, page or log line a player can see. `npm run share` prints it in the presenter's terminal, and `npm run public` prints it at start. `npm run reset` reads it from `.kitchen/town.json` on the presenter's machine. A presenter control in the page asks the presenter to type it and posts it to `/api/world/reset`; the client must not store it.

## Kitchen snapshot additions

These are in every `state` message and `GET /api/state`, in every mode, town or not.

| Field | |
|---|---|
| `restart` | The string `'/api/demo/restart'` when this kitchen can be replaced with a fresh one: `npm run demo`, and every public kitchen. Absent otherwise (`npm start`, `npm run sim`, `npm run example`). POST to it with an empty JSON body |
| `commits` | The number of commits on main. Counted when the kitchen opens and whenever a plate reaches the pass, ships or is binned. `null` until the first count |
| `escalation.everyMs` | **New**, next to `smokeMs` and `fireMs`: how often a waiting chef costs a point once the grace has passed |
| `orders[].cardId` | The town card this order came from, or `null` for an order typed into the kitchen |

**Renaming a chef.** `POST /api/chefs/:id {name}` renames a chef in your own kitchen, in every mode. It answers `{ok, chef:{id, name}}`, and the new name arrives in `chefs[].name` in the next `state`.

- The name is trimmed and must be 1 to 14 characters after trimming. It goes through the player-name filter, and no two chefs in one kitchen may share a name (compared without case). A name over 14 characters is refused, not cut.
- Refusals are `{error, code}`: 400 `name` (empty, too long, rude, or not a string), 409 `taken` (another chef has it), 404 `gone` (no such chef). Renaming a chef to the name it already has is 200.
- It is an own-cookie route like the other kitchen routes, so it always acts on the caller's kitchen. There is no visitor route for it under `/api/world/kitchens/`, whatever the relation or door sign.
- The name is saved with the kitchen state. A fresh kitchen (`/api/demo/restart`) and a town reset put the default names back.
- When the chef has an order, that order's activity gets "Pixel is now Basil". In the town, the feed gets "Ana's chef Pixel is now Basil".

### Ranks, hiring and letting go

Every chef has a rank. A rank is a model and a wage. All of this is in every mode; build the menus from `ranks`, not from this table.

| `ranks[].id` | `label` | `model` | `wage` |
|---|---|---|---|
| `head` | Head Chef | `claude-fable-5-2` | 0.4 |
| `sous` | Sous Chef (the default) | `claude-opus-5-5` | 0.2 |
| `line` | Line Cook | `claude-sonnet-5-5` | 0.1 |
| `commis` | Commis | `claude-haiku-5-5` | 0.005 |

Snapshot fields:

| Field | |
|---|---|
| `ranks` | `[{id, label, model, wage}]`, dearest first |
| `chefs[].rank`, `chefs[].model`, `chefs[].wage` | The chef's rank id, the model they cook with, and their rank's wage |
| `chefs[].hired` | True for a chef the player hired. The four a kitchen starts with are false |
| `hiring` | `{max: 6, cost, defaultRank: 'sous'}`. `cost` is the score a hire costs: 50 in public mode, 0 otherwise |
| `stats.spendByRank` | `{head, sous, line, commis}` in dollars. Also in the shift report (`shift.report.spendByRank`), for that shift only |
| `stats.apiUsd` | Real API dollars alone. `stats.costUsd` stays the spend meter: real dollars plus simulated wages |
| `stats.hires` | Chefs hired, also in the shift report |
| `orders[].model` | The model the order's session started with |

Routes, on your own kitchen only. They are own-cookie routes, so there is no visitor form of them under `/api/world/kitchens/`:

| Route | Body | Result |
|---|---|---|
| `POST /api/chefs` | `{rank?, name?}` | Hires a chef. `{ok, chef:{id, name, rank}}`. `rank` defaults to `sous`. Without a name the chef gets the next free one of Cache, Lambda, Vector, Kernel, Socket, Buffer, Token, Daemon. Ids are `hire1`, `hire2`, … |
| `POST /api/chefs/:id/rank` | `{rank}` | Promotes or demotes. `{ok, chef:{id, name, rank}}` |
| `DELETE /api/chefs/:id` or `POST /api/chefs/:id/dismiss` | none, or `{}` | Lets a chef go. `{ok, chef:{id, name}}` |
| `POST /api/chefs/:id` | `{name}` | Renames, as above |

Refusals are `{error, code}`:

| `code` | HTTP | |
|---|---|---|
| `rank` | 400 | Not one of the rank ids |
| `full` | 409 | The kitchen already has 6 chefs. Nothing is charged |
| `busy` | 409 | Dismiss: the chef has an order on. Only an idle chef can go |
| `last` | 409 | Dismiss: a kitchen keeps at least 1 chef |
| `name`, `taken`, `gone` | 400, 409, 404 | As for renaming |

Rules:

- **Hiring cost.** In public mode a hire takes 50 points off the score, as a `points` entry "Hired Dill, Commis". A refused hire costs nothing, and letting a chef go refunds nothing.
- **Rank changes.** A new rank's wage and simulated behaviour count from the chef's next run. An order's agent session keeps the model it started with (`orders[].model`), because resuming a session under another model is not known to be safe; the new model cooks the chef's next order. When the chef has an order, its activity gets "Pixel is now a Commis. It counts from their next run".
- **`SHIP_CHEF_MODELS`** still wins: a chef whose model was set there keeps that model at any rank. `SHIP_MODEL` replaces the Sous Chef model only.
- **Public mode stays simulated.** A rank's model is a label there. Hired chefs use the kitchen's own driver, which in public mode is always the simulation.
- **Wages.** `wage` is dollars per game minute of cooking (real minutes × `pace`). It is the model's output price per million tokens divided by 100 ($40, $20, $10 and $0.50), so the ratios are the real ones. A simulated chef is paid only while their order is `cooking` and they are not waiting on a question: not in the oven and not at the pass. A real chef earns no wage; their real bill goes on the meter and under their rank instead.
- **Simulated chefs by rank.** These are the trade-off, and they cost nothing real:

  | Rank | Each step takes | Scripted questions | An extra question before starting | First attempt leaves a failing test |
  |---|---|---|---|---|
  | Head Chef | 1.5× as long | 40% as likely | Never | Never. Overtime is right first time |
  | Sous Chef | As today | As today | Never | Never, except the scripted Overtime failure |
  | Line Cook | 0.8× | As today | 30% | 25% |
  | Commis | 0.55× | As today | 80% | 60% |

  The scripted Overtime failure happens for every rank below Head Chef, and the Sunday / Public holiday conflict is the same at every rank. A junior chef's slip is one real failing test, `test/slip.test.js`, which their next run removes: send the plate back, or let the oven lever re-fire it.
- **Fresh kitchen and reset** return to the default four Sous Chefs. On your own machine the roster is saved with the kitchen state.
- **Town feed.** A hire, a rank change and a dismissal are named in the feed: "Ana hired Dill as a Commis".

**Smoke grace.** A demo kitchen (`npm run demo`, and every public kitchen) stretches the three blocked-chef timings by 2.4. At the demo pace of 8 a chef smokes after 6 s (was 2.5 s), burns after 18 s (was 7.5 s) and costs a point every 3 s (was 1.25 s), still at most 30 points a question. `npm start`, `npm run sim` and `npm run example` keep 20 s, 60 s and 10 s divided by the pace. Read the three values from `escalation`; do not work them out from `pace`.

## Scores

- **Plot `score`** is the kitchen's own score. **`bonus`** is kept by the world: referral +25 to the sender's plot when a card they brought ships, applause +5 per cheer, rush ships +50 per size point (the ×1.5), and "Full house" +100 to every plot.
- **Team `score`** is the sum of its plots' `score + bonus`. **Town `team.score`** is the sum of all plots.
- **Rush:** the bell drops 2 walk-in customers per player into the teams' backlogs. `rush.left` counts those still `backlog` or `held`. At `seatBy`, `left === 0` pays Full house. `rush` is null after `endsAt`.

## Error codes

| `code` | HTTP | Meaning |
|---|---|---|
| `far` | 409 | You are not close enough, or not in the right zone |
| `taken` | 409 | Somebody else has that card, or it has moved on |
| `locked` | 409 | The card is seated or further on and cannot move |
| `hands` | 409 | You are already carrying 2 |
| `full` | 409 | That door's queue or offers are full |
| `dish` | 409 | That restaurant already has or has served the dish |
| `team` | 403 | Only that customer's team may do this |
| `sign` | 403 | The door sign, or your relation to the owner, does not allow it |
| `owner` | 403 | Only the owner may do this |
| `cooldown` | 429 | The bell, cheers or fresh kitchens are limited |
| `players` | 409 | The bell needs at least 2 players |
| `name` | 400 | The name was refused |
| `token` | 403 | Wrong reset token |
| `gone` | 404 | No such card, plot, order or question |
| `bad` | 400 | The request is malformed |

## Test and tuning settings

| Setting | Default | |
|---|---|---|
| `SHIP_WORLD` | on in public mode | `0` turns the town off |
| `SHIP_TEAMS` | `2` | 1 to 3 teams |
| `SHIP_WORLD_BOTS` | `0` | Wandering bot players with no kitchen, for load tests |
| `SHIP_RESET_TOKEN` | random | The presenter's reset token. `npm run share` sets it |
| `SHIP_TOWN_FILE` | `.kitchen/town.json` | Where the server writes `{port, token}` for `npm run reset` |
| `SHIP_RUSH_S` | `90` | Rush length; the seating deadline is half of it |
| `SHIP_BELL_S` | `180` | Bell cooldown |
