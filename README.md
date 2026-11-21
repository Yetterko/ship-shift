# Ship Shift

*Your agents cook. You run the floor. You still get your break.*

Ship Shift is a front end for running several Claude coding agents at once, played as a restaurant. You are the waiter (the expediter). Customers are AI reviewer agents who bring a ticket. Chefs are AI coding agents who cook one small item at a time at four work stations. You break orders into items, taste every dish before it goes out, and take a real break while the kitchen is busy. A bell calls you back once something is ready.

The full project spec is in [docs/spec.md](docs/spec.md). `docs/plan.md` describes the earlier head-chef prototype; where they disagree, the spec wins.

| In the restaurant | What it really is |
|---|---|
| Customer in the line | A ticket (shaped like a GitHub issue) plus a reviewer persona. Tap one to read the docket |
| Seating a customer | Accepting the task: a `table/<id>-<slug>` branch and worktree cut from `main` |
| Order pad | Splitting the ticket into station-scoped prompts. Each demo ticket has "specials" (preset prompts) |
| Ticket rail | The work queue. Idle chefs take the oldest ticket whose station is free (one chef per station) |
| Station (Backend, Frontend, Database, Integration) | A system prompt added to the chef's instructions |
| Chef | A Claude Agent SDK session in its own worktree (`kitchen/<id>.<n>-<slug>`), or a scripted practice chef that makes the same real edits |
| Plate on the counter | The chef's commit, test run (green or red lamp) and diff against the table branch |
| Sampling the dish | Code review: the diff, hunk by hunk, with "seen" tracking. Serving unread is a blind serve |
| Send back | Resumes the same agent session with your comment |
| Serve | Merges the item into the table branch, with your note for the customer |
| Customer eats | One Claude call (structured output) that reviews everything served against the ticket, or a scripted review |
| The bill | Merges the table branch into `main`. The receipt prints the merge commit |
| Patience | Drains only while you are the bottleneck, and never during a protected break |
| Staff room and bell | The Pomodoro: break when every chef is busy, no bell during your cooldown, then the bell calls you back |

## Run it

```
npm install
npm run demo      # free: practice chefs, scripted customers, the 3 minute demo shift, a fresh repo every start
npm run sim       # free: practice chefs at Pomodoro timings
npm start         # real Claude Agent SDK chefs (Claude Haiku) on this machine's Claude credentials
npm run public    # one private restaurant per visitor, what the hosted link runs
npm run share     # public mode on this laptop behind a Cloudflare quick tunnel, with a QR code
```

Then open http://127.0.0.1:4610. Each visitor's restaurant is a fresh git copy of `examples/roster-cafe`, a small rostering and pay app for the fictional Little Wattle cafe. Five customers queue outside (CAFE-101 to CAFE-105), and each ticket fixes one of the app's planted TODOs: Sunday penalty rates, overnight closes, double bookings, Queensland public holidays and a payroll CSV. Run `git log --graph` in `.kitchen/demo/repo` after a demo to see what you shipped.

## Water fight

Every waiter carries a water gun. Press **F**, or hold the round water button at the bottom left, to spray the way you are facing.

- Everyone looking at the same restaurant gets their own waiter: open a second tab of `npm run demo`, or let people watch the team kitchen at `/watch`, and you can soak each other. The one who gets wet reports the hit, so nobody can claim splashes they did not land.
- On your own, a rival waiter from across the street walks in after your first shot and fights back. They go home 40 seconds after you stop spraying, or as soon as a real opponent shows up.
- Getting soaked slows you to half speed for 1.6 seconds. Splashes only count on the water fight scoreboard; they never touch the restaurant's score, patience or bills.
- `npm run water` checks it headless: two waiters soak each other, then one fights the rival.

## Agents, models and caps

Every agent runs on **Claude Haiku** (`claude-haiku-5-5`) unless you set `SHIP_MODEL` / `SHIP_CUSTOMER_MODEL`.

| Mode | Chefs | Customers |
|---|---|---|
| `npm run demo` / `sim` | Practice (scripted, real edits, free) | Claude if `SHIP_SHARED_KEY` or `ANTHROPIC_API_KEY` is set, otherwise scripted |
| `npm start` | Real Agent SDK chefs on this machine's credentials | Same as above |
| Public, default | Practice | Claude on `SHIP_SHARED_KEY`, capped. Scripted without it |
| Public, visitor's own key ("Hire real chefs") | Real chefs on their key | Claude on their key |
| Public, VIP code | Real chefs on the team key (`SHIP_SHARED_CHEFS=vip`) | Claude on the team key |
| Public, team kitchen (`/?owner=<token>`, watch at `/watch`) | Real chefs on the team key | Claude on the team key |

Spend is capped: one global cap on the team key, plus per-restaurant caps on reviews and real chef items. When a cap is hit, that work falls back to practice chefs or scripted customers, with a "practice mode" tag in the HUD. `SHIP_REAL=off` is the kill switch. A visitor's key lives in server memory for their restaurant only and is never written, logged or sent back. Public chefs cannot ask permission for anything: any command outside the safe list is denied, and that includes `node -e`.

| Setting | Default | |
|---|---|---|
| `SHIP_MODEL` | `claude-haiku-5-5` | Model for real chefs |
| `SHIP_CUSTOMER_MODEL` | `claude-haiku-5-5` | Model for customer reviews |
| `SHIP_SHARED_KEY` | none | The team's Anthropic key (a secret: never commit it). Locally, `ANTHROPIC_API_KEY` works too |
| `SHIP_SPEND_CAP_USD` | `40` | Global cap on the team key |
| `SHIP_SESSION_REVIEWS` / `SHIP_SESSION_REVIEW_USD` | `20` / `0.5` | Claude reviews per restaurant |
| `SHIP_SESSION_CHEF_ITEMS` / `SHIP_SESSION_CHEF_USD` | `6` / `1.5` | Real chef items per restaurant |
| `SHIP_MAX_REAL_RUNS` | `3` | Real chef processes at once, server wide |
| `SHIP_SHARED_CHEFS` | `vip` | `vip`: real chefs on the team key need `SHIP_VIP_CODE`. `all`: everyone (see the key risk in the spec, 7.9). `off` |
| `SHIP_VIP_CODE` | none | Code that unlocks team-key chefs in a public restaurant |
| `SHIP_OWNER_TOKEN` | none | Turns on the team kitchen. `/?owner=<token>` runs it; `/watch` watches it read-only |
| `SHIP_FLAGSHIP_TIMINGS` | demo | `real` gives the team kitchen Pomodoro timings |
| `SHIP_REAL` | on | `off` makes every agent practice or scripted |
| `SHIP_CHEFS` / `SHIP_TABLES` | `2` / `2` | Chefs and usable tables (up to 4) |
| `SHIP_TIMINGS` | real (demo for `--demo` and public) | `demo` forces the 3 minute timings locally |
| `SHIP_SIM_SPEED` | `1` | Divides how long practice chefs take |
| `SHIP_MAX_SESSIONS` / `SHIP_IDLE_MIN` | `25` / `20` | Public restaurants at once, and idle minutes before one is deleted |
| `SHIP_REPO` | none | Local only: run on your own repo, with an empty line and the "New customer" button |
| `PORT` | `4610` | Local modes listen on 127.0.0.1; public mode on 0.0.0.0 |

## Scoring

| Event | Points |
|---|---|
| Bill paid | 100 × difficulty (S 1, M 2, L 3) × strictness (1, 1.25, 1.5), times the streak |
| Tip | Up to half the bill, from satisfaction and patience left (zero if they got furious) |
| Clean plate (read, tests pass, no redo) | +25, and the streak grows by 0.25 up to ×2 |
| Blind serve / burnt dish served | −10 / −50, and the streak resets |
| Kept waiting | −1 for every interval a customer waits on you after the grace period (capped per wait) |
| Walked out of the line | −25 (they rejoin later) |
| Proper break / forced break | +20 / −30 |

The till report at the end of the shift gives 1 to 3 stars, one line of advice, your rhythm (breaks, time back after the bell, longest stretch, bills per hour) and the leaderboard.

## Host it

The kickoff wants a link the judges open on their own phones, over mobile data.

- **Fly.io (recommended):** `fly launch --copy-config --ha=false` (Sydney, one machine kept warm), then `fly secrets set SHIP_SHARED_KEY=… SHIP_VIP_CODE=… SHIP_OWNER_TOKEN=…`, then `fly deploy`.
- **Render:** `render.yaml`. The free plan sleeps, so wake it before the demo.
- **Backup:** `npm run share` on a laptop. The link changes every run.

## Checks

```
npm run check        # syntax of every script
npm run smoke        # the restaurant end to end with practice chefs: loop, break and bell, redo, all five orders merge in any order
npm run publictest   # public mode over HTTP: private restaurants, keys, VIP, watch, owner, reset
npm run game         # headless tap-through at phone size (set SHIP_CHROME to a Chrome or Edge executable if Playwright's is missing)
```
