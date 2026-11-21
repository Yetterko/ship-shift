# Ship Shift

Ship Shift is a development environment for running several Claude coding agents at once, played as a top-down 3D kitchen. You are the head chef. You walk around the kitchen, take tickets from customers at the window, carry them to agent chefs, answer chefs when they get stuck, carry finished plates to the pass, review the real diff there, and ship it to main.

The agents are real Claude Agent SDK sessions, and each one works in its own git worktree of your repo. Every bubble, plate and score point comes from actual agent events, test runs and git merges.

Controls: walk with WASD or the arrow keys, press E to act and Q to put down what you're carrying. You can also click anything and your chef walks there. For a flat list of the same kitchen, open `/board.html`.

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

## Phones and tablets

Open the same link on a phone. Tap a ticket, a chef, a plate or the hatch to walk there and use it; a tap takes the nearest thing, so aim does not have to be exact. Drag anywhere to steer with a thumb stick. Four thumb buttons do the rest: the big one does whatever E would do here and says so (Take, Give, Taste, Review, Carry, Ship), and the others are Put down, Call out and Urgent (the next thing that needs you).

- **Upright:** the whole kitchen sits at the top, seen from steeper above. The focus card, a chef's question with full-width answers, and review as a bottom sheet are all laid out under it, so nothing covers the room.
- **On its side:** the kitchen fills the left of the screen, with the card and the thumbs in a column on the right. Review docks on the right with the diff at full height.
- **Tablets:** upright they use the phone's layout; on their side, the desktop's with the thumbs added.

The page does not scroll or zoom, keeps clear of the notch, and shrinks to the room and the line you are typing while the keyboard is up. `?touch=1` forces the touch controls on a desktop browser and `?quality=low` draws at pixel ratio 1.

## Checks

```
npm run check            # syntax of every script in server/, test/ and public/
npm run smoke            # end to end with simulated chefs, about a minute
npm run game             # headless run of the 3D kitchen: walk, carry, plan, answer, review, ship
npm run mobile           # the same loop by touch on a phone, upright and on its side, plus a glance at a tablet
node test/ui.mjs [dir]   # headless run of the list view
```

The smoke test costs nothing. It runs the four starter orders through real worktrees, test runs and merges: the failing Overtime run and its fix, the Overtime and CSV conflict predicted and then resolved, grants, call-outs, the oven lever, a blind ship, the waiting penalty and the demo's order arrivals.
