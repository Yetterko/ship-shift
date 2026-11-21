# Ship Shift

*Claude cooks the code. You run the pass, then take your break.*

A 3D kitchen game that is also a front end for AI coding agents. Customers bring Orders (tickets), you split them into Items for two Chefs, review every Meal hunk by hunk at the Pass, serve, hear the Customer's Feedback and ship it with the Bill. The Pomodoro layer tells you when to take a break and calls you back when something is ready. `docs/SPEC.md` is the requirements; `docs/REBUILD.md` is how this build maps onto them.

Every visitor picks a role: **Spectator** (watch the town overview, walk the park, walk into any restaurant read-only), **Player** (your own restaurant, Chefs on Claude Haiku 5.5) or **Judge** (Claude Sonnet 5.5, a bigger budget, reserved slots). Each restaurant is a building around a shared park.

## Run it

```
npm install
npm start          # http://localhost:4610 ; without ANTHROPIC_API_KEY every kitchen runs in Demo (scripted, free)
```

With `ANTHROPIC_API_KEY` set, audience Chefs and Customers are one plain-text Messages API call each, capped per floor, per judge pool and globally. The settings are in `docs/REBUILD.md` section 5.5 (`MAX_LIVE_FLOORS`, `PLAYER_CAP_USD`, `LIVE_TIMINGS`, `DEFAULT_MODE`, `ADMIN_SECRET` and the rest).

## The showcase floor (presenter laptop only)

```
ANTHROPIC_API_KEY=... npm run showcase      # SHOWCASE=1: one floor, Agent SDK Chefs on the real Rosterette code
```

The one floor's Chefs are Claude Agent SDK sessions (Sonnet 5.5) working in a git copy of `template-project/` (Rosterette) under your temp folder (`ship-shift-showcase/rosterette`). Each Item is one `query()` with Read, Glob, Grep, Edit and Write only: no shell, no web, a PreToolUse hook that denies any path outside the copy, 10 turns and $0.50 at most. The Meal is the real `git diff`, and the dining-room TV shows the live app at `/preview/showcase/`. The copy is rebuilt from the template on every start. Never set `SHOWCASE` on Render.

## Tests

All headless, never a visible window, and no real API calls: the server tests use a local mock of the Messages API, and the showcase test injects a fake `query()`.

```
npm run check            # syntax check of every source file
npm test                 # every suite below, in order
npm run test:world       # landing, roles, overview, park, walk-in, doors, teleport, pill, water gun (fake town, then the real server)
npm run test:world-mobile
npm run test:showcase
npm run tv               # re-renders public/tv/*.png, the TV stand-ins, from template-project/
```

Screenshots from the world tests land in `test/shots/`.

## Deploy

`render.yaml` and the `Dockerfile` run one always-on instance (all state is in memory) with the health check at `/health` and `LIVE_TIMINGS=short` for demo day. Set `ANTHROPIC_API_KEY` and `ADMIN_SECRET` in the Render dashboard. The image has no git and no Agent SDK.
