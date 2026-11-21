# Ship Shift

Ship Shift is a development environment for running several Claude coding agents at once, played as a top-down 3D kitchen. You are the head chef. You walk around the kitchen, take tickets from customers at the window, carry them to agent chefs, answer chefs when they get stuck, carry finished plates to the pass, review the real diff there, and ship it to main.

The agents are real Claude Agent SDK sessions, and each one works in its own git worktree of your repo. Every bubble, plate and score point comes from actual agent events, test runs and git merges.

Controls: walk with WASD or the arrow keys, press E to act and Q to put down what you're carrying. You can also click anything and your chef walks there. Press L, or the board button, for every order at once as a kanban with its actions on each card. It all works by touch on a phone.

| In the kitchen | What it really is |
|---|---|
| Ticket on the rail | A task, with a size (S/M/L) and a patience bar for how long it has waited |
| Plan board ("Plan first") | A read-only agent pass that writes a plan before any code changes |
| Chef station | An Agent SDK session in `kitchen/<id>-<slug>`, its own git worktree |
| Live feed on a station | The agent's real tool calls: reads, edits, commands |
| Red **?** bubble | The agent is blocked on you. It asked a question (`AskUserQuestion`), or wants to run something outside the safe policy |
| Oven | The project's test command, run in the worktree when the agent finishes |
| The pass | Code review: the real diff, the test output and the agent's summary |
| Ship it | `git merge --no-ff` into main |
| Send it back | Resumes the same agent session with your feedback |
| Spoiled | Main moved on and the branch no longer merges. It goes back to the chef to merge main and fix the conflicts |
| Shift | A pomodoro. During focus, questions and plates wait at the pass; the break is the rush |

## Run it

```
npm install
npm run demo    # free: the three minute demo, with simulated chefs and a fast clock
npm run sim     # free: simulated chefs at normal pace, on ./demo-repo
npm start       # real Claude agents (Claude Agent SDK, claude-opus-5-5 by default)
```

Then open http://127.0.0.1:4610.

`npm run demo` is the quickest way to see the whole loop. It builds a new repo in `.kitchen/demo/repo` on every start, so each run plays out the same way. Four customers walk up over the first 45 seconds after you open the page, and the three minute shift starts when you start it. When the shift ends, run `git log --graph` in `.kitchen/demo/repo` to see what you shipped.

The simulated chefs make real changes to the demo project. Weekly hours is a one-line fix with tests. Overtime gets the sum wrong the first time, so its tests really fail until you send it back or the oven lever re-fires it. CSV export rewrites the same lines of `src/pay.js` as Overtime, so whichever ships second is a real merge conflict, and the chef really runs `git merge main` to resolve it. CSV export also asks to run `npm install csv-stringify`, unless you granted installs first.

`npm run sim` and `npm start` create `demo-repo/`, the same small shift-pay project, on the first run and put the four starter orders on the rail.

To point the kitchen at your own repo: `SHIP_REPO=/path/to/repo SHIP_TEST_CMD="npm test" npm start`. The main checkout needs to be clean, because shipping merges into it.

| Setting | Default | |
|---|---|---|
| `SHIP_REPO` | `./demo-repo` | Git repo the chefs work on. The demo ignores it |
| `SHIP_MAIN` | the repo's current branch | Branch that plates merge into |
| `SHIP_TEST_CMD` | `npm test` | The oven |
| `SHIP_MODEL` | `claude-opus-5-5` | Model for every chef that has no model of its own |
| `SHIP_CHEF_MODELS` | none | A model per chef, for example `pixel=claude-haiku-5-5,query=claude-opus-5-5` |
| `SHIP_SIM` | off | `1` uses simulated chefs |
| `SHIP_REAL_CHEFS` | none | Chef ids that are real agents while the rest are simulated, for example `query`. Works with the demo. Plans stay simulated |
| `SHIP_PACE` | `1` (`8` in the demo) | Speeds up the game clock: ticket targets and the blocked-chef timers are divided by it |
| `SHIP_SIM_SPEED` | `1` | Divides how long a simulated chef takes over each step |
| `SHIP_SIM_ASK` | unset | Chance from 0 to 1 that a simulated chef asks each question. Unset, the starter orders always ask |
| `SHIP_DEMO_DIR` | `.kitchen/demo` | Where the demo builds its repo. It is cleared on every demo start |
| `PORT` | `4610` | Listens on 127.0.0.1 only |

The chefs are `pixel`, `router`, `query` and `stack`. Real chefs use whatever Claude credentials the Agent SDK finds: `ANTHROPIC_API_KEY`, or your Claude Code login. Only real chefs cost money.

## Example project

The project the chefs cook in is `examples/roster-cafe`: rostering and pay for a fictional Brisbane café, with staff, shifts, a weekly roster, weekend penalty rates and a timesheet CSV for payroll. It is about 400 lines with no dependencies, its 13 tests pass, and it is wrong in ways you can see on its roster page. `npm run demo`, `npm run sim` and `npm start` all copy it into a new git repo and put its menu on the rail.

To watch a change land in the app, run the roster next to the kitchen and refresh it after each ship:

```
cd .kitchen/demo/repo    # or demo-repo, or .kitchen/example/repo
npm start                # the roster at http://127.0.0.1:4620, restarting when main changes
```

| Order | Size | What it exercises |
|---|---|---|
| Close shift shows negative hours | S | A one-function bug fix that is right first time. Raj's Thursday close goes from −15.5 hours to 8.5 |
| Overtime after 8 hours | M | The chef asks a real question: does 1.5x replace the Saturday loading or stack on it? The answer changes the code and its tests. The first attempt pays overtime hours twice, so its own tests fail until you send it back or the oven lever re-fires it |
| Sunday penalty rate | S | Rewrites `loadingFor()` in `src/pay.js`, the same lines as Public holiday rate. Whichever ships second is a real merge conflict, and its chef runs `git merge main` and resolves it |
| Timesheet export for payroll | L | Asks to run `npm install csv-stringify` (the Install jar), then writes the quoting by hand. Rewrites the export and its tests |
| Public holiday rate | M | Asks to run `curl` for the holiday dates (the Network jar), then checks the dates in. Conflicts with Sunday penalty rate |
| Daily wage cost on the roster | M | Visible in the app: a new footer row on the roster page |
| Double-booked staff warning | S | Visible in the app: a red warning above the roster. Shares `src/roster.js` with Daily wage cost and merges cleanly |

Four orders change `src/pay.js`, and only Sunday and Public holiday conflict. Overtime and Close shift overlap with them and still merge, so the red string between two plates means something.

In the demo the orders walk up at 0, 10, 25, 45, 70, 95 and 120 seconds (`DEMO_ARRIVALS_S` in `server/demo-repo.mjs`).

### Real agents on the example

```
npm run example             # real Claude agents; they cost money
npm run example -- --sim    # the same kitchen with simulated chefs, free
npm run example -- --fresh  # throw the last copy away and start from the example again
```

This copies `examples/roster-cafe` to `.kitchen/example/repo` as its own git repo, starts the kitchen on it and puts the seven orders on the rail. The copy and its orders are kept between runs. The orders are written as tasks for a real agent: each one names the symptom and where to look, and asks for tests. The simulated chefs' recipes are in `server/sim-scripts.mjs`, and the whole files they write are in `examples/roster-cafe-orders`. Real agents never see either.

`SHIP_REAL_CHEFS=query npm run demo` is a cheaper middle: one real chef in the demo and three simulated ones.

## Share it

Public mode lets other people play on their own laptops. Everyone who opens the link gets a private kitchen: their own copy of the example repo, the demo's customers walking up, and simulated chefs at demo pace. Nobody sees anybody else's orders.

```
npm run share            # public mode on this laptop, plus a public https link and a QR code
npm run share -- --lan   # no tunnel: a link for people on the same Wi-Fi
npm run public           # public mode only, on 0.0.0.0:$PORT (4610 by default)
```

`npm run share` opens a free [Cloudflare quick tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/), which needs `cloudflared` but no account. If it isn't installed, the command prints the one-line install for your system and shares on the local network in the meantime:

| System | Install `cloudflared` |
|---|---|
| Windows | `winget install --id Cloudflare.cloudflared` |
| macOS | `brew install cloudflared` |
| Linux | `sudo curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared && sudo chmod +x /usr/local/bin/cloudflared` |

The link works for as long as the command runs, and changes every time you start it.

**Real agents cannot run in public mode.** Every chef is simulated, `SHIP_REAL_CHEFS`, `SHIP_SIM`, `SHIP_REPO` and `SHIP_CHEF_MODELS` are ignored, and the server drops `ANTHROPIC_*` and `CLAUDE_*` from its environment at start. The Docker image does not contain the Agent SDK at all. Public mode is free to run and never touches your repos.

A kitchen opens when somebody loads the page and is found again by a session cookie. It closes after 20 idle minutes, which deletes its repo, data and worktrees from `.kitchen/sessions/<id>`. At most 25 kitchens are open at once; the next visitor gets a "kitchen is full, try again shortly" page that retries by itself. Requests are limited to 16 KB, and a kitchen takes six new orders a minute.

| Setting | Default | |
|---|---|---|
| `SHIP_PUBLIC` | off | `1` is the same as `npm run public` |
| `SHIP_MAX_SESSIONS` | `25` | How many kitchens may be open at once |
| `SHIP_IDLE_MIN` | `20` | Minutes without a request before a kitchen is closed and deleted |
| `SHIP_PUBLIC_ORIGIN` | none | Extra origins that may call the API, comma separated. The request's own Host is always accepted, so a tunnel or a host's own domain needs nothing |
| `SHIP_SESSIONS_DIR` | `.kitchen/sessions` | Where the kitchens live. It is cleared on every start |
| `SHIP_HOST` | `0.0.0.0` | Address public mode listens on |
| `SHIP_PACE` | `8` | The game clock, as in the demo |

### Host it

The `Dockerfile` runs public mode on Node 22 with git installed. To try the image on your machine:

```
docker build -t ship-shift .
docker run --rm -p 8080:8080 ship-shift    # then open http://localhost:8080
```

**Render** (free web service, from `render.yaml`). Push this repo to GitHub, put its address in the link below, and click it:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/YOUR-USER/ship-shift)

Render reads `render.yaml`, builds the Dockerfile and gives you an `https://<name>.onrender.com` address. A free instance sleeps after 15 idle minutes and takes about a minute to wake, so open the link once before you present. It is small (512 MB), so `render.yaml` sets the cap to 10 kitchens.

**Fly.io** (from `fly.toml`):

```
fly launch --copy-config --ha=false    # asks for an app name and a region, then builds and deploys
fly scale count 1                      # kitchens live in one machine's memory, so run exactly one
```

`fly launch` rewrites the `app` name in `fly.toml` to the one you choose. The machine stops when nobody is connected and starts again on the next visit.

On any host, `GET /healthz` answers `{ ok, kitchens, max }` without opening a kitchen.

Check public mode with `node test/share.mjs`: two visitors with separate cookie jars, separate repos, the cap, idle cleanup, the limits, and proof that the real-agent settings are ignored.

## Town

In public mode every kitchen opens onto one shared park. Each visitor still has a private kitchen and repo, and a restaurant on one of 24 plots around the lawn. Customers are the cards of a kanban board: they arrive by bus into a team's backlog, players lead them to a door, and a customer walks in as a kitchen order once the owner is inside and the order window has room. `SHIP_WORLD=0` turns the town off, and public mode is then private kitchens only, as in "Share it" above. `npm start`, `npm run sim` and `npm run demo` never have a town.

**Teams.** Every restaurant belongs to a team, and a team works on one project. Players are dealt into Red ("Payroll") and Blue ("Rosters") in turn and can change team on their name card. Each team has its own backlog area in the park.

| Move | Your own team | Another team |
|---|---|---|
| Take a customer from the backlog | Yes | No |
| Take a customer from a door queue, until they are seated | Yes | No |
| Leave a customer at a door | They join the queue | It is an offer ("offered by the Red team"), and the owner accepts or declines |

A restaurant refuses a dish it already has or has served, so trading is worth it. Every move is named in the feed. Once a ticket is handed to a chef, its customer stays.

**Visiting.** Anyone can walk into any kitchen and watch. What else a visitor may do depends on who they are and on the owner's door sign, and the server checks both on every request:

| Door sign | Another team | Teammate |
|---|---|---|
| Open to team (the default) | Watch, cheer, offer customers at the door | Also answer `?` bubbles and approve at the pass |
| Help wanted | Also answer `?` bubbles | The same as above |
| Private | Watch only, and no offers at the door | Watch only |

Only the owner ships at the hatch, sends a plate back, bins, assigns or grants. The kitchen routes always act on the caller's own kitchen, so there is no route by which a visitor could do those.

**Scores.** A restaurant's score is its kitchen's score plus town bonuses: +25 to whoever sent a customer when that customer's order ships, +5 for each cheer from a visitor, +100 each for a "Full house", and half as much again for a ship during the lunch rush. Anyone can ring the fountain bell when two restaurants are open: a bus brings two walk-ins per player, and if nobody is left standing in the park when it leaves, that is a Full house.

**A clean slate for every demo.** Every server start is a new town with new kitchens. During a session there are two resets:

```
npm run reset                                   # clear the whole town on this machine
npm run reset -- --url https://… --token …      # a town hosted somewhere else
```

`npm run reset` closes every kitchen, deletes every repo, card and score, and makes every open page reload into a new kitchen. The page also has a presenter-only "Reset town" control that asks for a token. `npm run share` prints that token in your terminal (`npm run public` prints it at start), and it is never sent to a player. Each player also has a "Fresh kitchen" button that replaces only their own restaurant: they keep their plot and team, and their customers go back to the backlog.

In a demo kitchen (`npm run demo` and public mode) a waiting chef gets a longer grace than the Scoring table says: the smoke, fire and waiting-penalty times are multiplied by 2.4, so at the demo pace a chef smokes after 6 s and costs a point every 3 s.

| Setting | Default | |
|---|---|---|
| `SHIP_WORLD` | on in public mode | `0` turns the town off |
| `SHIP_TEAMS` | `2` | 1 to 3 teams. The third is Green ("Timesheets") |
| `SHIP_MAX_SESSIONS` | `24` with the town | One kitchen per plot, so never more than 24 |
| `SHIP_RESET_TOKEN` | random at each start | The presenter's reset token, at least 8 characters |
| `SHIP_WORLD_BOTS` | `0` | Wandering bot players with no kitchen, for load tests |

**Real mode is not built.** The town reaches a kitchen only through a four-call link (`summary()`, `admit(card)`, `withdraw(orderId)`, `has(title)`), which `server/index.mjs` makes in `linkFor()`. A team host would speak that link over a socket to each member's own `npm start`, which would publish only the summary. Agents, credentials, worktrees and diffs would stay on each laptop.

The wire protocol is in `docs/town-protocol.md`. Check the town with `node test/world.mjs`: the `World` class on its own, then three visitors over HTTP and WebSocket covering teams, offers, visitor rights, the bell, a fresh kitchen and the reset.

## What a chef may do alone

| Action | Without asking you |
|---|---|
| Read, search, glob | Allowed |
| Edit or write files | Allowed inside its own worktree |
| Shell commands | Only safe ones: tests, `node`, `git status`/`diff`/`log`/`add`/`commit`/`merge main`, `ls`, `cat` |
| Anything else (installs, network, deleting files, push, paths outside the worktree) | Asks you, and the agent waits |

Every second an agent waits is counted on the "Agents waiting on you" meter and in the shift report.

## Scoring

| Event | Points |
|---|---|
| Shipped | +100 per size point (S=1, M=2, L=3) |
| Streak | The shipped points are multiplied by the streak, from ×1 up to ×2 |
| Right first time (no send-backs, and you read the diff) | +50, and the streak grows by 0.25 |
| Served within the ticket's target time (S 10, M 20, L 40 minutes, divided by the pace) | +25 |
| Sent back | −10. Free when the plate had gone cold and only needs main merged in |
| Spoiled by a merge conflict at the hatch | −20, and the streak resets |
| Shipped with failing tests | −150 |
| A chef kept waiting on you | −1 for every 10 s after the first 20 s, at most −30 per question. Both times are divided by the pace |

Approving a plate at the pass does not merge it. The plate ships when you carry it to the hatch, so you choose the merge order. A plate that no longer merges into main goes cold: send it back and the chef merges main, or ship it anyway and take the conflict.

A blind ship is a plate you shipped without scrolling its diff. It still earns the shipped points, but no streak multiplier and no first-time bonus, and it resets the streak. So does any ship that was sent back first.

Two things take questions off your plate. A grant (install, network or delete) pre-approves that kind of request for one order or for the rest of the shift. The oven lever re-fires a plate once when its tests fail, with no send-back penalty.

The shift report gives one to three stars. Two stars need at least one ship, no failing tests shipped and a positive score. Three stars also need three ships, no conflicts, no blind ships and at most 10 points lost to waiting chefs.

## Checks

```
npm run check            # syntax of every script in server/, test/ and public/
npm run smoke            # end to end with simulated chefs, about a minute
npm run game             # headless run of the 3D kitchen: walk, carry, plan, answer, review, ship
npm run mobile           # the same kitchen on emulated phones, by touch alone
```

The smoke test costs nothing. It runs the four starter orders through real worktrees, test runs and merges: the failing Overtime run and its fix, the Overtime and CSV conflict predicted and then resolved, grants, call-outs, the oven lever, a blind ship, the waiting penalty and the demo's order arrivals.
