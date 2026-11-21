# Ship Shift — Project Specification

Tanda Hackathon 2026 · Nov 21, 2026 · @JM

## How to use this document

This spec is the single source of truth for building **Ship Shift** at the Tanda Hackathon 2026 (Brisbane, 20–21 November 2026). The team's own descriptions of features take priority over every suggestion in it. Decisions the team has confirmed are marked **Resolved**; anything still open has a **recommended default** and is marked as a decision. **Revision 3 (21 Nov, latest):** hosted on Render; audience floors use plain-text Messages API agents with no codebase; only the team's showcase floor runs the Claude Agent SDK on the real Rosterette codebase. Where accuracy and simplicity conflict, choose the simple stand-in and explain it on screen. Revision 2 added the Ship Shift name, 3D style, roles, visitors, the elevator building, quick picks and the prototype's stack.

**Instructions for the implementing AI agent**

1. Read the whole document before writing code. Sections 6–8 depend on the vocabulary and requirement IDs in sections 2–5.
2. Every open point is marked **DECISION Dn** and collected in the *Open decisions* table near the end. Before you build anything a decision affects, ask the team to confirm it. If nobody answers, build the recommended default, then say which default you used.
3. Do not remove or merge a feature the team defined (marked *Team-defined* or listed as Must in section 4) to save time. If time is short, propose a cut and wait for the team to agree.
4. Prefer the simplest implementation that works end to end. The kickoff judges "Execution and craft" on a core that works and is sensibly scoped, and "Technical ingenuity" on clever answers, not complexity.
5. Never commit an API key. Keys live in environment variables or in server memory only.

**Glossary: restaurant term ↔ software meaning**

| Game term | Software meaning | Notes |
| --- | --- | --- |
| Building | The whole hosted game: one shared map of floors | Only one floor is loaded on a screen at a time |
| Floor / Restaurant | One player's workspace: its agents, Orders and game state (no codebase on audience floors) | One per live or demo player |
| Elevator / Teleport menu | How anyone moves between floors | Unloads the current floor, loads the next |
| Role | What a visitor chose on arrival: Spectator (default), Player or Judge | Decides model, spend cap and whether they can act |
| Visitor | A Spectator, or a Player without a live slot | Read-only: overview or walk-in |
| Live / Demo mode | Real Claude agents / scripted agents with no API cost | Live by default; Demo after a cap is hit |
| Customer | Task Provider + Reviewer agent | Brings an Order (a ticket, like a GitHub Issue or Jira card), later reviews the result |
| Customer Line | Backlog of unstarted tasks | Queue outside the door on the left |
| Table | An active task slot | Max 2 |
| Order | The original task / ticket | Title, description, acceptance criteria, difficulty |
| Item | A sub-task prompt written by the player | Tagged with one Station |
| Quick picks / Text prompter | Pre-written, editable prompt chips / an open text box | Quick picks stand in for typing on phones |
| Ready Queue (ticket rail) | Items waiting for a free Chef | FIFO |
| Chef | Worker agent: one plain-text Messages API call per Item on audience floors; a Claude Agent SDK session in the real codebase on the team's showcase floor | Max 2 |
| Station | Work area: Frontend, Backend, Database, Integration | Adds a station-specific system prompt and file focus |
| Meal | A Chef's finished output for one Item | Summary + code: a written code answer on audience floors, a real diff on the showcase floor |
| Pass | Counter where Meals wait for player review | "Sample the Meal" happens here |
| Sample the Meal | Player reviews output; approves or sends back for Redo | Enforces review discipline |
| Serve / Deliver | Player sends approved Meals to the Customer with an optional note |  |
| Eat the Meal | Customer agent reviews the output against the Order | Produces Feedback |
| Feedback | Customer's verdict: satisfied or more work needed, with comments |  |
| Bill / Ship it | Player closes the Order; the receipt is stamped SHIPPED and the Customer leaves | Frees the Table |
| Waiter / Expediter | The player (the developer) | Moves between line, tables, pass |
| Shift / Break / Grace period | Pomodoro work phase / rest phase / user-set delay before call-back notifications | See 6.4 |
| Patience meter | Time an agent has been waiting on the player | Drains score as it falls |

## 1. Project name and tagline

**Name: Ship Shift** (Resolved, D1)

**Tagline:** *"Claude cooks the code. You run the pass, then take your break."*

**One-line pitch:** An Overcooked-style 3D kitchen game that turns your running AI coding agents into Chefs and Customers, so you manage human attention instead of chat tabs, ship real code, and take real breaks while the agents work.

**Why the name works.** *Ship* is what developers do with finished code. *Shift* is both the Pomodoro work session the game is built around and a nod to Tanda, whose product runs rosters, shifts and breaks for real workplaces. The game makes a developer work a proper shift, with breaks, while their AI staff keep cooking.

**Branding**

| Element | Use |
| --- | --- |
| Wordmark | SHIP SHIFT in a chunky rounded display font, warm yellow on a dark plum background (as in the prototype) |
| Shift clock | Top-left HUD badge: "START A SHIFT 25:00", then "SHIFT 1 · SERVICE 4:26" |
| Closing an Order | The Bill receipt is stamped **SHIPPED** and a "SHIPPED!" banner plays with confetti |
| End of shift | A "Shift report" card (section 6.6) |
| Floor names | Each restaurant is a numbered floor with a playful name, e.g. "Floor 7 · The Hungry Linter" |
| Voice | Short kitchen calls in the UI: "Order up!", "Back of house!", "Table 2 is waiting" |

## 2. Overview

Ship Shift is a 3D browser game that is also a front end for AI coding agents. It runs as **two kinds of floor**:

- **Audience floors (everyone on Render).** Each player gets their own restaurant. Chefs and Customers are plain-text Claude Messages API calls: a Chef reads the Item and the project brief and writes back a summary and a short code answer. Nothing touches a real codebase. This is a deliberate stand-in, explained on screen: *"On your phone, Chefs write their answer as text. Our stage kitchen is wired to a real repo."*
- **The team's showcase floor (presenter laptop).** The same game, with Chefs running as Claude Agent SDK sessions inside the real Rosterette codebase, real diffs and a live preview. This is the pitch: how the product is meant to work.

**The problem.** A developer working agentically often has several AI chats running at once, each on a different task. Keeping track of them is hard. Agents sit idle waiting for a reply, results get accepted without being read, and the developer either hovers over the screen or forgets to take breaks. Once several agents run in parallel, the bottleneck is the human's attention, not the model.

**The idea.** Treat the developer's attention as the scarce resource and make managing it a game:

- **Customers** are Task Provider / Reviewer agents. Each arrives with an **Order**, a task like a GitHub Issue or Jira ticket.
- **Chefs** are Worker agents. They take **Items** (sub-task prompts) to a **Station** (Frontend, Backend, Database, Integration), cook them, and put the finished **Meal** on the **Pass**.
- **The player is the Waiter / Expediter.** They seat Customers, break Orders into Items, review Meals, send weak ones back, deliver good ones with a note, hear the Customer's Feedback, and close the Order with the **Bill** ("Ship it").

**The core loop** (Team-defined, from the gameplay concept sketch):

1. A Customer comes in with an Order.
2. The player reads the Order and manually splits it into Items.
3. The player assigns each Item to a Station; Items wait on the Ready Queue.
4. A free Chef picks up an Item and works on it at that Station.
5. The Chef finishes and puts the Meal on the Pass.
6. The player reviews it (Sample the Meal), then sends it to the Customer or back to the Chef for a Redo, adding any notes.
7. The Customer tests and reviews the output against the Order and gives Feedback.
8. If more work is needed, the cycle repeats from step 2 using the Feedback.
9. When the player decides the task is complete, they give the Bill and the Customer leaves.

**The Pomodoro layer.** When all Chefs are busy (or the player hits a maximum work time) the player is allowed to take a break. A player-set grace period stops call-back notifications from arriving straight away. When an agent finishes after the grace period, the player is notified to return, and a **patience meter** starts. The longer the agent waits, the more score is lost. So the game naturally splits the session into work and rest.

**Typing vs. quick picks.** In the real product, a developer would type every prompt: the sub-tasks, the redo reasons, the notes to the reviewer. Typing is slow on a phone, so the hackathon build offers **quick picks** (pre-written prompt chips) at every step, each editable, plus a **Type it** button that switches to an open text prompter. The game says so on screen, and the pitch says it out loud.

**The building.** Every restaurant is one floor of a single tall building. Visitors (spectators, or players without a live slot) can watch a high-level overview of the building, or walk into any floor read-only. An elevator, or a quick teleport menu, moves between floors; only one floor is ever loaded on a screen.

**Why it matters (the pitch angle).** Running agents in parallel from a dashboard is not new, and gamified Pomodoro apps are common. Treating human attention and review quality as the thing being managed is rare. The kitchen is a skin over a real queue, and removing the art would still leave a working agent orchestrator.

**Look and layout.** The art style is a bright, chunky 3D cartoon in the spirit of Overcooked: rounded low-poly shapes, soft shadows, warm tile floors, big readable name badges, matching the team's prototype screenshots. Characters and assets must be original; nothing is copied from Overcooked. The layout follows the team's concept sketch, mirrored so Customers queue on the left (as in the prototype) and the kitchen runs along the top wall (D16):

&#91;embedded content: Floor layout · line, tables, rail and Pass, kitchen, elevator\]

The flow reads as in the sketch: Customers come in from the left, sit at the tables, their tickets go up to the rail, Chefs cook along the top wall, and Meals come back down to the Pass. On phones in portrait, the camera follows the Waiter instead of showing the whole floor.

## 3. Objectives and user stories

The project has four objectives. Each is judged against the kickoff criteria: Idea and imagination, Execution and craft, Interactivity, Technical ingenuity, Presentation and demo.

| ID | Objective | How the design meets it | Kickoff criterion |
| --- | --- | --- | --- |
| O1 | Make managing several AI agents easier to follow than parallel chat tabs | One spatial 3D view of every agent's state: line, tables, rail, stations, pass | Idea and imagination |
| O2 | Protect the developer's focus and rest | Break eligibility, grace period, delayed call-back, patience meter, max-work safety net | Idea and imagination |
| O3 | Enforce review discipline on real agent output | Real Agent SDK Chefs edit a real sandbox; nothing reaches a Customer without passing the player at the Pass; the Customer re-checks against the Order | Technical ingenuity |
| O4 | Let the whole room take part on their own phones within 2 minutes | Hosted link, role picker, own floor per player, quick picks, visitors who can watch or walk in, elevator between floors | Interactivity, Presentation and demo |

**User stories**

*Everyone on arrival*

- **US1.** As anyone opening the link, I want to choose Spectator, Player or Judge in one tap (Spectator preselected), so I land in the right experience without reading instructions. *(O4)*

*Player (developer / audience member with a live or demo floor)*

- **US2.** As a player, I want to preview each Customer in the line and see their Order, so I can choose which task to start. *(O1)*
- **US3.** As a player, I want to seat the next Customer or a specific one, so I control priority. *(O1)*
- **US4.** As a player, I want to break an Order into Items tagged with a Station using quick picks I can edit, or switch to typing, so I can delegate quickly on a phone. *(O1, O4)*
- **US5.** As a player, I want tapping any station or object to open its panel straight away while my Waiter runs there, so the game never makes me wait for walking. *(O1)*
- **US6.** As a player, I want free Chefs to pick up Items automatically, so the kitchen keeps moving without micromanagement. *(O1)*
- **US7.** As a player, I want to Sample a Meal (read the summary and every diff hunk) before it goes out, and send it back for a Redo with a reason, so I never pass on unread work. *(O3)*
- **US8.** As a player, I want to deliver Meals to the Customer with my own note, so the reviewer has context. *(O3)*
- **US9.** As a player, I want to read the Customer's Feedback and either create follow-up Items or ship it with the Bill, so I decide when a task is done. *(O1, O3)*
- **US10.** As a player, I want to see the sample app change live, so I know the agents did real work. *(O3, O4)*
- **US11.** As a player, I want to be told I can take a break when every Chef is busy, and be called back only after my grace period, so my break is not interrupted straight away. *(O2)*
- **US12.** As a player, I want a forced break after a maximum work time, so I rest even if the kitchen never fills up. *(O2)*
- **US13.** As a player, I want a score and an end-of-shift report of focus and review metrics, so I can see how well I managed my attention. *(O2, O3)*
- **US14.** As a player, I want to always see whether I am in Live or Demo mode and how much of my live budget is left, and be asked clearly before switching to Demo when it runs out, so I am never confused about what is real. *(O3, O4)*

*Judge*

- **US15.** As a judge, I want a live floor on a stronger model with a bigger budget and a guaranteed slot, so I can test the real thing properly before scoring. *(O3, O4)*

*Visitor (Spectator, or a Player without a live slot)*

- **US16.** As a visitor, I want a high-level overview of every floor in the building, so I can see what is happening at a glance. *(O4)*
- **US17.** As a visitor, I want to walk into someone else's floor and look around read-only, opening tickets and diffs, so I can follow their game up close. *(O4)*
- **US18.** As a visitor, I want to take the elevator, or use a quick teleport menu, to move between floors. *(O4)*

*Team / host*

- **US19.** As the host team, I want each floor isolated in its own sandbox and every model call capped in spend and concurrency, so one player cannot break another's project, overload the server or drain the key. *(O4)*
- **US20.** As the presenter, I want a reliable Demo mode with scripted agents and compressed timers, so the demo works even if the network or the API is slow. *(O4)*

## 4. Functional and non-functional requirements

Priorities use MoSCoW: **Must** = required for the demo; **Should** = build if the Musts are done and stable; **Could** = stretch. *Team-defined* marks features from the team's own brief, which must not be dropped without the team's agreement.

### 4.1 Functional requirements

**Arrival and roles**

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-1 | On arrival, a role picker asks "Who's here?" with three big buttons: **Spectator** (preselected default), **Player**, **Judge**. | Must, Team-defined |
| FR-2 | A Player gets a live floor on Claude Haiku 5.5 if a live slot and budget remain. Otherwise they become a Visitor and are offered the Demo kitchen (D21). | Must, Team-defined |
| FR-3 | A Judge gets a live floor on Claude Sonnet 5.5 with a larger budget, from a pool of reserved judge slots (D20). | Must, Team-defined |
| FR-4 | Players and Judges can paste their own Anthropic API key. Their spend then skips the house caps, but they still need a live slot. | Should, Team-defined |

**Floor scene and Waiter**

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-5 | Render each floor as a 3D cartoon scene (Three.js) with the layout in section 2: Customer Line outside the left door, 2 tables in the centre, ticket rail and Pass in front of the kitchen, 4 Stations and 2 Chefs along the top wall, elevator on the right wall, dining-room TV showing the live preview. | Must, Team-defined |
| FR-6 | Tapping any station, table, Customer or counter opens its panel immediately. At the same moment the Waiter runs there fast (about 0.4 s); the panel never waits for the walk. | Must, Team-defined |
| FR-7 | Desktop controls as in the prototype: WASD or click to walk, E use, Shift dash, Tab jumps to the most urgent thing, ? help. | Should |
| FR-8 | Every agent shows its state: a name badge with model and a status ring (idle, cooking with progress, waiting, done), a happy/unhappy face, and a patience ring when waiting. Customers in the line carry ticket badges (#1 with S/M/L size). | Must |
| FR-9 | Panels are HTML overlays on the 3D canvas, styled skeuomorphically: a bottom context card (what is in your hands plus key hints), a right-docked review panel for diffs, an order pad, kitchen tickets, a plate/cloche, a comment card and a receipt. On phones, panels become bottom sheets. | Must, Team-defined |
| FR-10 | HUD: shift clock; score with multiplier; a **LIVE / DEMO** pill showing model and spend (e.g. "LIVE · Haiku 5.5 · $0.04 of $0.25"); floor name; sound; help; menu. | Must, Team-defined |
| FR-11 | Presenter mode (P): big labels, calm camera, as in the prototype. | Should |
| FR-12 | Camera: a fixed, angled front view of the whole floor on laptops; on phones in portrait, a tighter view that follows the Waiter, with pinch to zoom out. | Must |

**Customers and Orders**

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-13 | On floor start, the Customer Line holds the preset Orders (section 8). | Must, Team-defined |
| FR-14 | Tapping a Customer in the line previews their Order (title, description, acceptance criteria, difficulty, source label such as "GitHub Issue #12"). | Must, Team-defined |
| FR-15 | The player can seat the next Customer or a specific one at a free table. Max 2 seated at once. | Must, Team-defined |
| FR-16 | Seating a Customer accepts the Order and starts the task. | Must |

**Items, prompts, Ready Queue and Chefs**

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-17 | At a seated Customer the player creates 1–5 Items, each with a prompt and one Station (Frontend, Backend, Database, Integration). | Must, Team-defined |
| FR-18 | **Quick picks:** every step that needs words (Items, redo reasons, serve notes, follow-ups, and Chef questions if D17 adds them) offers 3–5 context-specific pre-written chips. One tap adds a chip; each can be edited inline before sending. | Must, Team-defined |
| FR-19 | **Type it:** a button (T on desktop) switches the panel to an open text prompter (multi-line, full width), and back. | Must, Team-defined |
| FR-20 | The prompt panel carries a small note: "Quick picks stand in for typing. In the real tool you write these prompts yourself." | Must, Team-defined |
| FR-21 | Sent Items go on the Ready Queue (tickets on the rail), FIFO. | Must, Team-defined |
| FR-22 | Any idle Chef automatically takes the oldest Item, walks to its Station and starts cooking. Max 2 Chefs per floor. | Must, Team-defined |
| FR-23 | The Station adds its system prompt and file focus to the Item before the agent runs (section 7.3). | Must, Team-defined |
| FR-24 | **On audience floors, cooking is one Messages API call that returns a summary and a short code answer as text (Live), or a scripted Meal (Demo). On the showcase floor, it is a Claude Agent SDK session in the real Rosterette codebase. In every case** the Meal is released no earlier than the Item's estimated cook time, so completions stagger. | Must, Team-defined |
| FR-25 | If the server's queue of in-flight API calls is full, the Chef shows "waiting for a stove" and starts as soon as a slot frees. Time spent waiting for a stove never counts against the player. | Must |
| FR-26 | When finished, the Chef places the Meal on the Pass and returns to idle. | Must, Team-defined |

**Pass, review and shipping**

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-27 | Sample the Meal: the right-docked panel shows the Chef's summary and code hunk by hunk (the code answer shown as added lines on audience floors; the real diff on the showcase floor) (J/K to step), with a "hunks seen" counter as in the prototype. | Must, Team-defined |
| FR-28 | Redo: the player sends a Meal back with a reason (quick pick or typed). It returns to the front of the Ready Queue with the reason attached, and the rework counter rises. | Must, Team-defined |
| FR-29 | Deliver: the player sends one or more approved Meals for the same Order to its Customer, with an optional note. | Must, Team-defined |
| FR-30 | Eat the Meal: the Customer agent reviews the delivered work against the original Order and returns structured Feedback (satisfied yes/no, score 1–5, comments, suggested follow-ups). | Must, Team-defined |
| FR-31 | When Feedback is ready the Customer raises a hand; the player visits the table to read it. | Must, Team-defined |
| FR-32 | After Feedback the player either creates follow-up Items (suggested follow-ups become quick picks) or gives the Bill. | Must, Team-defined |
| FR-33 | The Bill prints a receipt stamped **SHIPPED**: Items, redo count, time taken, Customer score, points earned. A "SHIPPED!" banner plays, the Customer leaves and the table frees. | Must, Team-defined |
| FR-34 | The dining-room TV shows the sample app. On audience floors it is a stand-in: a pre-made "after" screenshot appears for each Order shipped. On the showcase floor it is the real app, refreshing when files change. Tapping it opens it full screen. | Must |

**Shift, breaks and patience (Pomodoro)**

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-35 | Before a shift the player sets: grace period (cooldown before call-backs) and maximum work time. Defaults in section 6.4. | Must, Team-defined |
| FR-36 | When all Chefs are busy (or the configured number of agents are working), a "Take a break" button becomes available. | Must, Team-defined |
| FR-37 | During a break the scene dims and a break screen shows elapsed time. No call-back fires before the grace period ends. | Must, Team-defined |
| FR-38 | After the grace period, the first Meal or Feedback that becomes ready triggers a call-back: browser notification + sound + tab-title flash + vibration on supported phones. If nothing is ready, the break continues. | Must, Team-defined |
| FR-39 | A patience meter starts on every waiting agent when the call-back fires (or immediately, if the player is not on break). Score drains as it falls. | Must, Team-defined |
| FR-40 | When the maximum work time is reached, the player must take a break (the game warns, then locks actions behind the break screen). | Must, Team-defined |
| FR-41 | Optional short delay on call-backs ("slightly delayed"), so they feel batched. | Should |

**Scoring and report**

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-42 | Points per shipped Order, scaled by difficulty and Customer score; bonus for Meals approved first time; penalties for patience lost and Chef idle time. Points float up from the action, as in the prototype ("+50 RIGHT FIRST TIME"). | Must |
| FR-43 | End-of-shift Shift report: Orders shipped, points, rework rate, average call-back response time, break time, longest unbroken work stretch. | Should |
| FR-44 | Shared leaderboard across floors. | Could |

**Building, visitors and Live/Demo modes**

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-45 | All floors belong to one tall building (one shared map). Each screen loads only one floor at a time. | Must, Team-defined |
| FR-46 | **Overview:** visitors can open a high-level spectator view of the building: one card per floor with name, score, Orders shipped, LIVE/DEMO and number of watchers. Tapping a floor walks in. | Must, Team-defined |
| FR-47 | **Walk-in:** visitors appear as an avatar on any floor and can walk around and open tickets, diffs and feedback, read-only. Every action button is replaced by a "View only" label. | Must, Team-defined |
| FR-48 | **Elevator:** every floor has an elevator on the right wall. Walking in hides the floor and shows a floor-button panel. Choosing a floor closes the doors, unloads the current floor (scene disposed, updates unsubscribed), loads the next, and opens the doors. | Must, Team-defined |
| FR-49 | **Teleport menu:** a side drawer lists every floor; choosing one runs the same unload/load with a short door transition. | Must, Team-defined |
| FR-50 | Players can also visit other floors; their own kitchen keeps running and call-backs still bring them home (D22). | Should |
| FR-51 | At most N live floors run at once (D19). Further Players become Visitors (and are offered the Demo kitchen, D21). | Must, Team-defined |
| FR-52 | Every floor starts in **Live** mode. When the player's own cap or the global cap is reached, a modal says so plainly and offers **Continue in Demo kitchen** or **Become a visitor**. | Must, Team-defined |
| FR-53 | The LIVE / DEMO pill is always visible. Tapping it switches mode; Demo to Live is allowed only while budget and a live slot remain. | Must, Team-defined |
| FR-54 | A floor is destroyed after 15 minutes with no connected player, or when the player taps Leave. Rejoining starts fresh. | Must, Team-defined |

### 4.2 Non-functional requirements

| ID | Requirement | Target |
| --- | --- | --- |
| NFR-1 | Reachable from a phone on mobile data. The auditorium has its own network and not everyone will be on it. | Public HTTPS URL on Render; tested on 4G before demos |
| NFR-2 | Playable on phones in portrait and on laptops, with smooth 3D. | 360 px wide and up; tap targets ≥ 44 px; ≥ 30 fps on a mid-range phone (device pixel ratio capped at 2, one shadow-casting light, low-poly models, one floor loaded) |
| NFR-3 | First-time players understand the loop without instructions. | First Order shipped in under 2 minutes |
| NFR-4 | Audience floors cannot touch files, run code or reach the web. | Plain-text Messages API calls only; no tools except the structured-output tool |
| NFR-5 | API spend is capped at every level. | Per-floor, per-judge and global caps (section 7.5) |
| NFR-6 | API keys are never committed, logged, or sent to the browser. A player's own key stays in server memory for their session only. | Render environment variable + in-memory only |
| NFR-7 | The server never floods the API. | Global limit on in-flight API calls with a queue ("waiting for a stove") |
| NFR-8 | Responsiveness. | Panel opens < 100 ms after a tap; state pushed over WebSocket < 500 ms; floor switch < 3 s |
| NFR-9 | Resilience: an API error never breaks the game. | Failed cook → Chef shows "burnt", Item returns to rail, retry once, then fall back to the scripted Meal |
| NFR-10 | The kitchen is a skin over a real queue: all state lives in a plain server-side model, independent of the art. | Same state shown in a debug "ticket view" |
| NFR-11 | Stand-ins are labelled, never passed off as real. | On-screen notes for text-only Chefs, quick picks and the TV screenshots |

## 5. Scope

The hackathon build is one 3D web game hosted on Render. Every audience player runs their own floor with plain-text Claude agents, and everyone else watches or walks around read-only. The team's showcase floor, run from the presenter's laptop, adds real Claude Agent SDK Chefs editing the real Rosterette codebase. Anything that touches a visitor's own repositories or accounts is out of scope.

**In scope (hackathon build)**

- The full core loop in section 2, steps 1–9, on every floor.
- Audience floors: Chefs and Customers as plain-text Messages API calls (Live), or scripted (Demo).
- Showcase floor: Agent SDK Chefs in the real Rosterette codebase, real diffs, live preview.
- 3D cartoon floor in Three.js with the section 2 layout; 2 tables, 2 Chefs, 4 Stations.
- Role picker (Spectator, Player, Judge); Haiku 5.5 for Players, Sonnet 5.5 for Judges.
- Quick picks at every input step, editable, plus the Type it text prompter.
- Preset Orders written as mock GitHub Issues / Jira tickets (displayed, not fetched).
- Pomodoro layer: break eligibility, grace period, delayed call-backs, patience meters, maximum work time.
- Scoring, SHIPPED receipts, Shift report.
- The building: overview, read-only walk-in, elevator and teleport menu, one floor loaded at a time.
- Live by default, Demo after a cap, with the LIVE/DEMO pill and switch.
- Spend caps, live-floor cap and the API call queue.

**Out of scope (pitch as future work)**

- A real codebase sandbox for every audience player (only the showcase floor has one).
- Real GitHub, Jira or Linear integration (pulling issues, opening PRs).
- Connecting to a player's own local codebase or running inside Claude Code itself.
- Shell, test-runner or web access for any agent.
- User accounts, login, persistent saves, history across sessions.
- Long-term focus analytics ("you work best in 50-minute shifts").
- More than 2 tables or 2 Chefs per floor (D15), Chef levels, upgrades or progression.
- Real co-op inside one floor (visitors are read-only).
- Native mobile apps.

**Stretch, only if all Musts are stable**

- Leaderboard (FR-44).
- Prototype extras not yet adopted (D17): Oven (runs tests), Hatch (git merge to main), Spices (permission prompts), Prep board (plan first).
- A one-button "export my sandbox as a zip" so a player can keep what their agents built.
- Web Push, so call-backs reach a player even when the tab is closed.

## 6. User workflow

A session runs: open link → pick a role → (Player or Judge) set up a shift on your own floor, or (Spectator) explore the building → repeat the Order loop and break cycle → Shift report. All game state lives on the server. The browser sends player actions and renders the state the server pushes back.

### 6.1 Entering the game

1. **Landing.** The player opens the public URL on a phone or laptop. The SHIP SHIFT wordmark and a one-line pitch sit above the role picker: **Spectator** (preselected), **Player**, **Judge**.
2. **Spectator** goes straight to the building overview (6.7).
3. **Player.** The server checks for a free live slot and remaining global budget.
   - Slot free: the **Kitchen setup chalkboard** opens with a random floor name (e.g. "The Hungry Linter"), grace period, maximum work time, and a collapsed "Use my own API key" field. The floor starts in **Live** mode on Haiku 5.5.
   - No slot: "All live kitchens are busy." Options: **Play the Demo kitchen**, **Look around as a visitor**, or **Join the queue for a live kitchen** (D21).
4. **Judge.** Same as Player, but on Sonnet 5.5 with the judge budget, drawn from the reserved judge slots (D20).
5. **Server creates the floor:** an ID and floor number in the building, 2 idle Chefs, 2 empty tables and the preset Customer Line.
6. The floor loads. A five-step guide bar like the prototype's (SEAT · SPLIT · REVIEW · SERVE · SHIP) lights each step as the player completes it, with a Skip button.

### 6.2 The Order lifecycle

&#91;embedded content: Order lifecycle · 11 steps, 2 decisions, 2 loops\]

Every Meal passes the player at the Pass before a Customer sees it. Customer Feedback either loops back to new Items or ends with the Bill.

Step by step, with what happens behind the scenes:

| # | Player does | Scene shows | Server / agents do |
| --- | --- | --- | --- |
| 1 | Taps a Customer in the line | Order pad: ticket title, description, acceptance criteria, difficulty stars, "GitHub Issue #…" label | Nothing; Order data is already loaded |
| 2 | Taps **Seat** (or **Seat next**) | Customer walks to a free table, sits, menu icon appears | Order status → `seated`; Customer patience paused until there is something to wait for |
| 3 | Taps the table, adds Items: preset chips or free text, picks a Station for each | Kitchen tickets being written on the order pad | Items created with status `draft` |
| 4 | Taps **Send to kitchen** | Tickets clip onto the rail above the Pass | Items → `queued` on the Ready Queue (FIFO) |
| 5 | (automatic) | Idle Chef grabs the oldest ticket, walks to the Station, progress bar fills | Item → `cooking`. Server builds the prompt (station system prompt + Order context + Item prompt + any redo reason) and starts the agent call; release timer set to the Item's estimated cook time |
| 6 | (automatic) | Chef carries a covered plate to the Pass; bell rings | When both the agent call and the release timer finish: Meal stored (summary, changed files, diff); Item → `ready`. If the player is on break, the call-back rules in 6.4 apply |
| 7 | Taps the Pass, picks a plate | Plate opens: Chef's note, changed files, diff with green/red lines | Meal → `sampled` (counts toward review discipline) |
| 8a | Taps **Send back** with a reason | Chef frowns, ticket returns to the front of the rail | Item → `queued` with `redoReason`; rework counter +1; sandbox changes from that Meal are kept, and the redo prompt asks the Chef to fix them |
| 8b | Taps **Approve**; when the Order has the Meals they want, taps the table and **Serve** with an optional note | Waiter carries plates to the table | Meals → `served`; Customer → `eating`; Customer review call starts (Order + Items + Meals' summaries and diffs + player note + current file contents) |
| 9 | (automatic) | Customer eats, then raises a hand with a speech bubble | Feedback stored: `satisfied`, `score 1–5`, `comments`, `suggestedFollowUps[]`. Customer → `awaiting_player`; patience starts (call-back rules apply) |
| 10 | Taps the table, reads the comment card | Comment card with stars and comments | — |
| 11a | Taps **More work** | Order pad reopens, suggested follow-ups pre-filled as Items | Back to step 3 |
| 11b | Taps **Bring the bill** | Receipt prints; Customer pays, waves and leaves; table cleared | Order → `closed`; points awarded; table freed |

The player can work on two Orders at once and do steps in any order. For example, they can Sample a Meal for table 1 while table 2's Customer is eating.

### 6.3 State machines

The server is the only place state changes. Each transition is triggered by a player action or a timer/agent event.

| Entity | States, in order | Notes |
| --- | --- | --- |
| Customer / Order | `in_line` → `seated` → `waiting_food` → `eating` → `awaiting_player` → (`waiting_food` again, or `paying`) → `left` | `waiting_food` starts when the first Item is sent |
| Item | `draft` → `queued` → `cooking` → `ready` → `sampled` → (`queued` on redo, or `approved`) → `served` | A failed agent call sets `burnt`, then back to `queued` (NFR-9) |
| Chef | `idle` → `walking` → `cooking` → `plating` → `idle` | Takes a new ticket as soon as it is idle and the rail is not empty |
| Player phase | `working` ↔ `break` (→ `called_back` → `working`) | See 6.4 |

### 6.4 Shift, break and patience rules (Team-defined)

**Break eligibility.** The **Take a break** button lights up when every Chef is cooking (default: 2 of 2; configurable as "maximum number of agents working"). It also appears, and then becomes compulsory, when the player's continuous work time reaches the **maximum work time**.

**During a break:**

1. The scene dims and a break screen shows a calm animation, break time elapsed, and how many agents are still working.
2. For the **grace period** (set by the player), no call-back can fire, even if Meals become ready. They wait silently on the Pass and their patience does not drain yet.
3. After the grace period, the first thing that becomes ready (or anything already waiting) triggers a **call-back**, after an optional short delay (FR-31): browser notification "Table 2's order is up!", a bell sound, tab title flashing, phone vibration.
4. If nothing is ready when the grace period ends, the break simply continues until something is.
5. From the moment of the call-back, patience meters drain on everything waiting for the player: Meals on the Pass and Customers with Feedback.
6. The player taps **Back to work** (or any game action), which ends the break and records the call-back response time.

**When the player is not on break,** patience meters start as soon as something is waiting.

**Patience meter.** It drains from full to empty over the patience duration. Points drain with it (see scoring). At empty, the agent becomes angry: a big score penalty, a red face, and steam (D6 decides whether the Customer also walks out).

**Default timings.** Live mode uses real-world Pomodoro values; Demo mode compresses time so a full cycle fits inside a 2-minute demo.

| Setting | Live default | Demo default | Player can change? |
| --- | --- | --- | --- |
| Grace period | 5 min | 10 s | Yes (0–15 min) |
| Maximum work time | 25 min | 90 s | Yes (10–60 min) |
| Patience duration (Meal on Pass) | 5 min | 30 s | No |
| Patience duration (Customer feedback) | 5 min | 30 s | No |
| Item cook time | Max of real agent time and preset estimate | Preset estimate ÷ 4 | No |
| Call-back delay (FR-31) | 10 s | 2 s | No |

### 6.5 Scoring

Scoring rewards quality on the first pass and fast call-back response, not raw volume. This avoids the "misaligned rewards" weakness raised in the original idea.

| Event | Points |
| --- | --- |
| Order closed | 100 × difficulty (1–3) × Customer score ÷ 5 |
| Meal approved with no redo and the Customer is satisfied | +20 per Meal |
| Meal served without being sampled | Not possible: the Pass requires sampling (review discipline) |
| Patience draining | −1 per 5 % of meter lost (max −20 per meter) |
| Agent reaches empty patience | −50 |
| Chef idle while the rail is empty and the player is working (not on break) | −1 per 10 s per Chef |
| Break taken when eligible | +10 ("Rested chef bonus") |

The HUD shows score, a happiness face per agent, and the shift clock.

### 6.6 End of shift

A shift ends when the player taps **Close up**, when the Customer Line is empty and all tables are cleared, or (Demo) after 5 minutes. The summary card shows: Orders closed, total points, rework rate (redos ÷ Meals), average call-back response time, total break time, longest unbroken work stretch, and a one-line verdict such as "Head Expediter: great reviews, slow call-backs". **Play again** resets the restaurant and the sandbox.

### 6.7 Visitors, the building and the elevator (Team-defined)

The building is one shared map: every floor is a restaurant. A screen only ever holds one floor, or the overview.

**Overview (default for Spectators).** A stylised cutaway of the building with one card per floor: floor number and name, score, Orders shipped, a LIVE or DEMO dot and how many people are watching. The projector shows this during the play part of the demo. Tapping a card walks the visitor into that floor.

**Walk-in (read-only).** The visitor appears as a small avatar at that floor's elevator and can walk around exactly like a Waiter. Tapping a ticket, a plate or a table opens the same panels the player sees, read-only. Every action button is replaced by a "View only" label, and the player sees a small eye icon with the number of watchers.

**Elevator.**

1. The visitor (or a player) walks into the elevator on the right wall, or taps it.
2. The floor view hides and the elevator interior shows a panel of floor buttons, each with number, name and a LIVE/DEMO dot. A "Back" button returns to the same floor.
3. Choosing a floor closes the doors (about 0.6 s animation).
4. Behind the doors, the client unsubscribes from the current floor's updates and disposes its 3D scene.
5. It subscribes to the new floor, receives its snapshot and builds the scene.
6. The doors open on the new floor, with the avatar standing at its elevator.

**Teleport menu.** The menu button opens a side drawer listing every floor. Choosing one runs steps 3–6 with the same door transition, without walking to the elevator.

**Players away from home (D22).** A player can ride the elevator to watch others. Their own kitchen keeps running. Call-backs still fire, with a "Go home" button that takes them straight back to their floor.

**Server side.** Each connection subscribes to at most one floor's detailed state. Everyone also receives a light building summary (one line per floor) every 2 seconds for the overview and the elevator panel.

### 6.8 Live and Demo modes (Team-defined)

- Every floor starts **Live**. The HUD pill shows mode, model and spend, e.g. "LIVE · Haiku 5.5 · $0.04 of $0.25".
- When the floor's cap, the judge cap or the global stop is reached, any Item already cooking finishes. Then a modal says: *"That's the end of your live budget. Your Chefs can keep cooking in the Demo kitchen with pre-cooked results, or you can look around as a visitor."* Buttons: **Continue in Demo kitchen** and **Become a visitor**.
- In Demo, the pill reads "DEMO · pre-cooked" and new Items use scripted Meals. A free-text Item maps to the closest preset Meal and is labelled "set menu".
- Tapping the pill opens a small sheet to switch modes. Demo to Live is allowed only while budget and a live slot remain.

### 6.9 Quick picks vs. typed prompts (Team-defined)

Every step where a real developer would type now offers quick picks, an inline edit, and the **Type it** prompter. The panel always shows the note from FR-20, and the pitch says it out loud (section 8.4).

| Step | Quick picks (examples, Order 3) | In the real tool |
| --- | --- | --- |
| Split the Order into Items | "Backend: add `findOverlaps(shifts)` to api.js returning clashing pairs" · "Frontend: highlight clashing cells red with a tooltip" · "Database: add one overlapping shift to the seed data" | The developer writes each sub-task prompt |
| Send back for Redo | "Missing the tooltip" · "Keep the change smaller" · "Add a self-check" · "Match the existing style" | A typed review comment |
| Serve with a note | "Check each acceptance criterion" · "Only the overlap logic changed" · "The UI change is in the roster table" | A typed hand-off message |
| Follow-up after Feedback | The Customer's suggested follow-ups, as chips | The developer turns review comments into new prompts |
| Answer a Chef's question (if D17 adopts it) | The Chef's own options, as numbered chips (as in the prototype) | A typed reply |

## 7. Technical details

Ship Shift is a **hosted 3D web game** on the team's prototype stack: a Node.js server using `ws` for WebSockets, and a Three.js client with HTML overlay panels. **One Render web service** holds every audience floor in memory and calls the Claude Messages API directly. No sandboxes or subprocesses run there. The same code, started on the presenter's laptop with `SHOWCASE=1`, runs one floor whose Chefs use the **Claude Agent SDK** on the real Rosterette codebase.

### 7.1 Stack (aligned with the prototype)

| Layer | Choice | Version in prototype | Notes |
| --- | --- | --- | --- |
| Language | Plain JavaScript (ES modules) with JSDoc types, Node ≥ 20 | `engines.node >= 20` |  |
| 3D scene | `three` | 0.187.0 | One floor loaded at a time |
| UI panels and HUD | Plain HTML/CSS overlays over the canvas | — | No framework |
| Realtime | `ws` server + a small client wrapper (floor subscriptions, heartbeat, auto-reconnect) | 8.23.0 | Render supports WebSockets on web services |
| HTTP | Node's built-in `http` module | — | Client files, stand-in screenshots, health, admin |
| Audience Chefs and all Customers | `@anthropic-ai/sdk` Messages API, one call per Item or review, structured output | 1.12.0 | Text only: no files, no tools |
| Showcase Chefs (laptop only) | `@anthropic-ai/claude-agent-sdk` with git diffs and a live preview | 0.3.330 | Enabled by `SHOWCASE=1` |
| Models | Players: Haiku 5.5 (`claude-haiku-5-5`). Judges and showcase: Sonnet 5.5 (`claude-sonnet-5-5`) | — |  |
| Join QR code | `qrcode-terminal` | 0.12.0 | Prints the URL as a QR code at startup |
| Testing | `playwright-core` (dev) | 1.65.1 | Smoke test and a 20-player load test |
| Art | Three.js primitives plus original low-poly models; CC0 packs allowed | — | Nothing copied from Overcooked |
| Hosting | Render web service, single instance, always on (7.10) | — |  |

### 7.2 Architecture

&#91;embedded content: System architecture · browser, game server, Anthropic API, sandboxes\]

The browser only sends actions and draws state. On Render, every agent is one Messages API call through a capped queue. Only the showcase build adds the sandbox and the Agent SDK (the diagram shows both; the sandbox boxes exist only on the presenter's laptop).

**Server components**

- **FloorManager.** A `Map<floorId, Floor>`: create (floor number, name, preset line), look up, destroy on timeout.
- **Roles and slots.** Live-floor cap, reserved judge slots, the queue for live slots, visitor subscriptions.
- **Game loop.** Ticks 4 times a second per floor: cook release, grace period, call-back delay, patience, max work time, score.
- **Action handlers.** One per player action; check role (visitors cannot act) and the state machine in 6.3.
- **CallQueue.** A global limit on in-flight API calls (e.g. 20) with a FIFO queue; Chefs waiting show "waiting for a stove"; judges and the showcase floor jump the queue.
- **ChefWriter.** One Messages API call per Item (7.4) returning `{summary, file, code}`.
- **CustomerReviewer.** One Messages API call per review with structured output.
- **BudgetGuard and KeyVault.** House key from the environment, player keys in memory only, caps from 7.5.
- **ScriptedKitchen.** Demo-mode Meals and Feedback for every quick pick.
- **Building broadcaster.** One-line-per-floor summary every 2 seconds.
- **Showcase only (`SHOWCASE=1`):** Sandbox (Rosterette copy, git snapshots, diffs), Agent SDK ChefRunner, and the live preview at `/preview/showcase/`.

**Client components:** Three.js floor scene, overlay panels, HUD with LIVE/DEMO pill, role picker, building overview, elevator and teleport loader, `ws` client, notifications, and the dining-room TV (stand-in screenshots, or the live preview on the showcase floor).

### 7.3 The sample project the agents work on

Rosterette is a small, **fully static** web app (HTML + CSS + vanilla JS + JSON data). **Only the showcase floor has the real files**: its Agent SDK Chefs edit them and the preview reloads. **Audience floors get a written project brief instead**: the file list, each file's purpose and the key function signatures, about 400 tokens in every Chef's system prompt. Chefs answer as if editing those files, and their code is shown but never run. The dining-room TV on audience floors shows a pre-made "after" screenshot for each Order shipped.

**Chosen theme (Resolved, D9): "Rosterette", a tiny shift-roster app** (a nod to Tanda's workforce roots). It shows a week of shifts for 4–5 staff, loaded from a JSON file. The sample project and its Orders are in section 8.2.

Stations map onto the project like this:

| Station | Files it focuses on | Station prompt (appended to the Chef's system prompt) |
| --- | --- | --- |
| Frontend | `index.html`, `styles.css`, `ui.js` | You build UI: semantic HTML, tidy CSS, accessible controls. Do not change data shapes. |
| Backend | `api.js` (pure business-logic functions: totals, validation, filtering) | You write pure, well-named JS functions with JSDoc. No DOM code. |
| Database | `data/staff.json`, `data/shifts.json`, `data/schema.md` | You own data shape and seed data. Keep JSON valid; update `schema.md` when fields change. |
| Integration | `main.js` (wires UI to API), `checks.js` (in-browser self-checks shown on the page) | You connect modules and add a self-check for each feature. Keep existing checks passing. |

The Station gives a file focus, not a hard lock. A Chef may touch another file if the Item really needs it, and must say so in its summary.

### 7.4 Agent design

**Audience Chef (Worker): one Messages API call per Item**

- *System prompt* = base Chef prompt ("You are Chef Pixel at the Frontend station. You cannot see or change files; answer as if editing the project described below. Make the smallest change that completes the ticket.") + Station prompt + the Rosterette brief.
- *User message* = Order title and acceptance criteria, the Item prompt, any redo reason or player note.
- *Output:* a forced tool call `serve_meal` returning `{summary (1–2 sentences), file (e.g. api.js), code (≤ 40 lines)}`. The panel shows `code` as added lines, split into hunks for the hunk-by-hunk review.
- Model: Haiku 5.5 for Players, Sonnet 5.5 for Judges. Up to about 1,500 output tokens.
- No tools, files, shell or web: nothing to isolate.

**Showcase Chef (presenter laptop only): one Claude Agent SDK session per Item**

On the showcase floor each Item starts a fresh `query()` in the Rosterette working copy. Recommended options (check exact shapes against the installed SDK's reference):

```js
import { query } from '@anthropic-ai/claude-agent-sdk';

const run = query({
  prompt: chefPrompt, // Order title + acceptance criteria, the Item prompt, any redo reason or player note
  options: {
    cwd: floor.sandboxDir,                       // this floor's copy of Rosterette
    model: floor.isJudge ? 'claude-sonnet-5-5' : 'claude-haiku-5-5',
    systemPrompt: { type: 'preset', preset: 'claude_code', append: baseChefPrompt + stationPrompt },
    settingSources: [],                          // load no user/project settings or CLAUDE.md
    allowedTools: ['Read', 'Glob', 'Grep', 'Edit', 'Write'],
    disallowedTools: ['Bash', 'WebFetch', 'WebSearch', 'Agent', 'NotebookEdit'],
    permissionMode: 'dontAsk',                   // anything not allowed is denied, never prompted
    maxTurns: 10,
    maxBudgetUsd: floor.isJudge ? 0.50 : 0.05,   // per-Item safety cap
    hooks: { PreToolUse: [{ hooks: [denyPathsOutsideSandbox] }] },
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: floor.apiKey,           // house key or the player's own key
      CLAUDE_CONFIG_DIR: floor.configDir,        // per-floor config, nothing shared between floors
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    },
  },
});
```

- **Why each option.** `allowedTools` alone does not restrict anything: unlisted tools stay available. So shell, web and subagent tools are removed with `disallowedTools`, and `permissionMode: 'dontAsk'` denies anything else instead of prompting. The `PreToolUse` hook rejects any path outside the sandbox, because hooks run before every other permission step.
- **Progress.** Stream the SDK messages: each tool use ("Reading api.js", "Editing ui.js") moves the Chef's progress bar and shows as a thought bubble.
- **Finish.** On the result message, the server records its cost, runs `git diff` against the pre-cook commit, and builds the Meal: `{summary, changedFiles[], diff, hunks[]}`. The summary is the agent's final text. The preview reloads.
- **Caps hit.** A result with subtype `error_max_turns` or `error_max_budget_usd` still produces a Meal from whatever changed, marked "ran out of time".
- **Chef questions (D17).** If adopted, a Chef can ask the player a question (like the prototype's ANSWER step) through Claude Code's question tool, surfaced in the `canUseTool` callback. The question pauses the Chef and shows numbered quick picks. In that case use `permissionMode: 'default'` with a callback that denies everything except the question tool.

**Customer (Task Provider / Reviewer): Messages API (D18)**

- Customers' Orders are preset data (no call needed to bring them in).
- The review runs when the player serves: one Messages API call on the floor's model, with the Customer persona (name, personality, strictness 1–3), the Order and acceptance criteria, each served Meal's summary and diff, the player's note, and (showcase floor only) the current contents of the changed files.
- A forced tool call `submit_review` returns `{satisfied, score 1-5, comments (≤ 60 words, in character), suggestedFollowUps: [{prompt, station}]}`. Suggested follow-ups become quick picks.
- Stricter Customers fail work that misses any acceptance criterion; lenient ones fail only obvious gaps.

### 7.5 Models, budget and caps

The team's key has US$150, and every visitor spends from it unless they bring their own key. Plain-text calls on Haiku 5.5 cost a fraction of a cent, so the caps mostly guard against abuse. The real limit is the API's rate limits, handled by the CallQueue.

**Current prices** (per million tokens, [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing), checked 21 Nov 2026):

| Model | Input | 5-min cache write | Cache read | Output |
| --- | --- | --- | --- | --- |
| Claude Haiku 5.5 (prompts up to 100k tokens) | $0.10 | $0.125 | $0.01 | $0.50 |
| Claude Haiku 5.5 (prompts over 100k tokens) | $0.50 | $0.625 | $0.05 | $2.50 |
| Claude Sonnet 5.5 | $2.00 | $2.50 | $0.10 | $10.00 |

**Rough cost (estimate).** Assumptions: about 2,500 input and 700 output tokens per Chef call, about 3,000 input and 300 output per review, a 10-minute session of about 15 cooks and 5 reviews.

| Who | Per Chef call | Per 10-minute session | Expected total |
| --- | --- | --- | --- |
| Player (Haiku 5.5) | under $0.001 | about $0.01 | about $1–2 for 100 players |
| Judge (Sonnet 5.5) | about $0.01 | about $0.25 | about $4 for 15 judges |
| Showcase floor (Agent SDK, Sonnet 5.5) | about $0.15 per Item | — | about $10–20 including rehearsals |

Run one Order on each model and check the real usage before the demo; set the caps from that.

**Recommended caps**

| Cap | Player | Judge |
| --- | --- | --- |
| Per floor (whole visit) | $0.10 | $1.00 |
| Pool | Everything not reserved | $15 reserved for judges |
| Global stop | Key balance at feature freeze minus a $20 reserve | (shared) |

At these prices the global stop is unlikely to be reached. If it is, floors switch to Demo with the 6.8 message.

Keep every Haiku request under 100,000 prompt tokens (NFR-11), because above that line every Haiku rate is five times higher. A small sample project, `maxTurns: 10` and one fresh session per Item keep requests well under it.

### 7.6 Capacity and isolation

- **Audience floors are just state in memory** plus API calls, so one small Render instance holds many. The live-floor cap protects the budget and the API rate limits, not memory: default `MAX_LIVE_FLOORS=60`, with 6 reserved judge slots (D19).
- **CallQueue:** at most about 20 API calls in flight (`MAX_INFLIGHT_CALLS`); adjust if the API returns rate-limit errors. Retries back off and the Chef shows "waiting for a stove".
- **Isolation is simple:** audience agents have no file, shell or web access, so there is nothing to sandbox. The showcase floor runs only on the team's laptop, with the Agent SDK options shown above.
- Load test with `playwright-core`: 20 headless players running the loop against the Render URL.

**IDs and access.** Floor IDs are random 21-character strings. The creating browser gets a player token (in `localStorage`) needed for every action. Visitors never receive tokens or keys.

**Lifetime.** A floor survives disconnects (phones drop sockets when the screen locks, which is exactly what happens on a break). It is destroyed after 15 minutes with no connected player, when the player taps Leave, or at end of shift + 5 minutes. Destroying a floor aborts its running sessions and frees its live slot for the next person in the queue.

**Keys.** The house key comes from `ANTHROPIC_API_KEY` on the server, is never sent to the browser and never logged. A player's own key is sent once over HTTPS, held in memory for that floor only, passed to its sessions through `env`, and dropped on teardown.

### 7.7 Client–server interface

**HTTP:** `GET /` (client), `GET /preview/:floorId/*` (showcase build only), `GET /health`, `GET /admin/usage` (secret header: spend by pool, live slots, agent pool use, queue length).

**WebSocket messages** (JSON with a `type` field).

| Direction | Messages |
| --- | --- |
| Client → server | `hello {token?}` · `chooseRole {role}` · `createFloor {name, settings, ownKey?}` · `subscribe {floorId}` (walk-in, elevator, teleport) · `unsubscribe` · `action {name, args}` for seat, saveItems, sendItems, sampleMeal, seeHunk, redoMeal, approveMeal, serveOrder, readFeedback, moreWork, giveBill, startBreak, endBreak, updateSettings, setMode, closeShift, leave |
| Server → client | `welcome {role, token, floorId?}` · `floor` (full snapshot of the subscribed floor, sent on subscribe and after every change) · `building` (summary every 2 s) · `notify {kind}` (mealReady, feedbackReady, callBack, burnt, stoveWait, budgetSpent, slotFree) · `error {code, message}` |

### 7.8 Core data model

Written as TypeScript types for clarity; implement as JSDoc `@typedef`s in `shared/types.js`.

```ts
type Station = 'frontend' | 'backend' | 'database' | 'integration';
type Role = 'spectator' | 'player' | 'judge';

interface Floor {
  id: string; number: number; name: string;
  ownerRole: 'player' | 'judge'; mode: 'live' | 'demo'; model: string;
  keySource: 'house' | 'own';
  budget: { spentUsd: number; capUsd: number };
  settings: { gracePeriodMs: number; maxWorkMs: number; maxAgentsForBreak: number };
  phase: 'working' | 'break' | 'called_back';
  phaseStartedAt: number; workStretchStartedAt: number; ownerAway: boolean;
  line: Customer[]; tables: (Customer | null)[];   // length 2
  chefs: Chef[];                                    // length 2
  readyQueue: string[];                             // item ids, FIFO
  pass: string[];                                   // meal ids awaiting review
  items: Record<string, Item>; meals: Record<string, Meal>;
  score: number; stats: ShiftStats; watchers: number;
}

interface Customer {
  id: string; name: string; persona: string; strictness: 1 | 2 | 3;
  order: Order;
  status: 'in_line' | 'seated' | 'waiting_food' | 'eating' | 'awaiting_player' | 'paying' | 'left';
  feedback?: Feedback; patience?: Patience;
}

interface Order {
  id: string; source: string;                       // e.g. "GitHub Issue #12"
  title: string; description: string; acceptanceCriteria: string[];
  difficulty: 1 | 2 | 3; size: 'S' | 'M' | 'L';
  quickPicks: QuickPick[]; itemIds: string[];
}

interface QuickPick { label: string; prompt: string; station: Station; estCookMs: number; scriptedMealId: string }

interface Item {
  id: string; orderId: string; prompt: string; station: Station; estCookMs: number;
  status: 'draft' | 'queued' | 'waiting_stove' | 'cooking' | 'ready' | 'sampled' | 'approved' | 'served' | 'burnt';
  typed: boolean;                                   // false = built from quick picks
  redoReason?: string; redoCount: number; chefId?: string; mealId?: string; costUsd?: number;
}

interface Meal { id: string; itemId: string; summary: string; changedFiles: string[]; diff: string; hunks: Hunk[]; hunksSeen: number; readyAt: number; patience?: Patience }
interface Feedback { satisfied: boolean; score: 1 | 2 | 3 | 4 | 5; comments: string; suggestedFollowUps: { prompt: string; station: Station }[] }
interface Chef { id: string; name: string; status: 'idle' | 'walking' | 'waiting_stove' | 'cooking' | 'plating'; itemId?: string; idleSince?: number }
interface Patience { startedAt: number; durationMs: number }
interface Connection { id: string; role: Role; floorId?: string; subscribedFloorId?: string }
```

### 7.9 Suggested repository layout

```text
ship-shift/
  package.json         three, ws, @anthropic-ai/claude-agent-sdk, qrcode-terminal; dev: playwright-core
  server/
    index.js           http + ws bootstrap, static, preview, health, admin; prints join QR
    floors.js          FloorManager, lifetime, floor numbers
    roles.js           role picker, live slots, judge slots, queue
    loop.js            per-floor tick: timers, patience, score
    actions.js         action handlers + role and state-machine guards
    building.js        building summary broadcaster
    agents/            pool.js, chef.js (Agent SDK), customer.js (Messages API), prompts.js, hooks.js
    sandbox.js         template copy, git snapshots, diff, hunks
    budget.js          caps, usage, key vault
    scripted/          Demo-mode Meals and Feedback per quick pick
  client/
    index.html, main.js, net.js, notify.js
    scene/             floor.js, characters.js, camera.js, elevator.js, assets/
    ui/                hud.js, roles.js, overview.js, teleport.js, panels/
  shared/types.js      JSDoc typedefs shared by client and server
  content/orders.js    preset Customers, Orders, quick picks, cook times
  template-project/    the Rosterette sample app (section 8.2)
  tests/               smoke.js, load.js (playwright-core)
```

### 7.10 Hosting on Render and demo-day access

- **Render web service** (Node), deployed from the GitHub repo. Build: `npm ci`. Start: `node server/index.js`. Health check path: `/health`.
- Use a **paid, always-on instance** for demo day: free instances sleep when idle, and a cold start in front of judges looks broken.
- Run exactly **one instance**, because all state is in memory. Render provides HTTPS (needed for notifications and vibration) and supports WebSockets.
- Environment variables in the Render dashboard: `ANTHROPIC_API_KEY`, `ADMIN_SECRET`, `MAX_LIVE_FLOORS`, `JUDGE_SLOTS`, `MAX_INFLIGHT_CALLS`, `PLAYER_CAP_USD`, `JUDGE_CAP_USD`, `JUDGE_POOL_USD`, `GLOBAL_STOP_USD`, `DEFAULT_MODE`. Leave `SHOWCASE` unset on Render.
- **Showcase floor:** on the presenter's laptop, run `SHOWCASE=1 node server/index.js` with the team's key, and open it in presenter mode on the projector. It is a separate local instance; it does not appear in the Render building (D26).
- The auditorium has its own network and not everyone will be on it. Test the Render URL on two phones on mobile data and one laptop on the venue Wi-Fi.
- Put a big QR code and short URL on slide 2.
- **Known limitation:** browsers only notify while the page is open (background tabs are fine). Ask players to leave the tab open during breaks.

## 8. Demonstration

The demo has two parts. First, a 2-minute pitch on the **showcase floor** (presenter laptop, projector): real Agent SDK Chefs change the real Rosterette codebase. Second, 2 minutes in which the room scans a QR code for the **Render** build, picks a role, and either runs their own floor (text-only Chefs) or watches the building. The pitch says plainly that phones get a lighter stand-in of what the stage shows.

### 8.1 Event constraints (from the kickoff)

- Post the link in #showcase by 4:30 pm Saturday; demos start at 5:00 pm (90-minute cap for all teams).
- Each team gets 2 slides, about 2 minutes to pitch and 2 minutes to play. The judges try every project themselves before deciding.
- "Brought to life" means a link the judges open on their own phone and something that works end to end. Slides, screenshots or a recorded video do not count, and neither does something only the team can run.
- One API key per team with US$150; app users spend it too, so requests must be capped. Never commit the key.
- About 200 participants are at the event; plan for about 100 trying the app during the demo, about 5 judges, and some participants choosing Judge anyway.

### 8.2 Initial state of every floor

**Scene:** the section 2 layout. 2 empty tables, 2 idle Chefs named **Pixel** and **Stack** (badges show their model), 4 Stations, an empty rail and Pass, score 0, phase `working`, five Customers queued outside the left door, the elevator closed. The dining-room TV shows Rosterette's starting screenshot (audience floors) or the live app (showcase floor).

**Rosterette (template-project/).** Real files on the showcase floor only; audience floors get the written brief from 7.3 and one pre-made "after" screenshot per Order:

| File | Starting content |
| --- | --- |
| `index.html` | Header "Rosterette", a weekly roster table (Mon–Sun columns, one row per staff member), a self-checks panel at the bottom |
| `styles.css` | Plain light theme, simple table styling |
| `ui.js` | `renderRoster(staff, shifts)` builds the table |
| `api.js` | `getShiftsFor(staffId, shifts)`, `formatShift(shift)`; no totals, no validation |
| `main.js` | Loads the JSON, calls the API and UI functions |
| `checks.js` | 2 passing self-checks (roster renders; every shift has a staff member) shown as green ticks on the page |
| `data/staff.json` | 4 staff: name and id (no role field yet) |
| `data/shifts.json` | About 14 shifts across the week, no overlaps yet |
| `data/schema.md` | Describes both JSON shapes |

**Customer Line (preset Orders, in queue order).** Live cook-time estimates are shown; Demo mode divides them by 4. Each Order has 2–3 quick-pick Items, which the player can edit, replace or type from scratch.

| # | Customer (strictness) | Source | Order | Size, difficulty | Quick-pick Items: Station, estimated cook time |
| --- | --- | --- | --- | --- | --- |
| 1 | Priya the PM (1, friendly) | GitHub Issue #3 | Show each person's total weekly hours | S, 1 | Backend: add `totalHours(staffId, shifts)` to api.js, 40 s · Frontend: add a Total column to the roster, 45 s |
| 2 | Dev the Designer (2, picky about looks) | Jira ROS-7 | Add a dark mode toggle that remembers the choice | S, 1 | Frontend: dark theme with CSS variables + header toggle saved in localStorage, 50 s · Integration: self-check that the toggle switches theme, 35 s |
| 3 | Quinn from QA (3, strict) | GitHub Issue #9 | Flag overlapping shifts for the same person | M, 2 | Database: add one overlapping shift to the seed data, 25 s · Backend: `findOverlaps(shifts)`, 45 s · Frontend: highlight clashing cells red with a tooltip, 40 s |
| 4 | Morgan the Manager (2) | Jira ROS-12 | Add a role to each staff member and filter the roster by role | M, 2 | Database: add `role` field + a 5th staff member, 30 s · Frontend: role filter dropdown, 45 s · Integration: wire filter to the API + self-check, 35 s |
| 5 | Sam the Startup Founder (1, vague) | GitHub Issue #15 | "Make it pop" | L, 3 | Frontend: bolder header and brand colour, 40 s · Frontend: hover and "today" highlight on cells, 45 s · Backend: `isToday(date)` helper, 30 s |

Order 5 is deliberately vague. It shows the player's real job: turning a fuzzy ticket into clear Items.

### 8.3 What is real and what is simulated

| Element | Audience floor, Live (default) | Audience floor, Demo | Showcase floor (team) |
| --- | --- | --- | --- |
| Customer Orders | Preset tickets | Preset tickets | Preset tickets |
| Chef work | Real Claude call; writes a summary and code as text, no files | Scripted Meal | Real Agent SDK session editing the real codebase |
| Review panel | Code answer shown as added lines | Pre-written code | Real git diff |
| Dining-room TV | Stand-in: pre-made "after" screenshot per Order shipped | Same | Real app, live preview |
| Customer review | Real Claude call, structured output | Scripted (first review of Order 3 is "not satisfied") | Real Claude call, reads the changed files |
| Prompts | Quick picks or typed | Quick picks or typed | Quick picks or typed |
| Pomodoro timers | Real-world defaults (6.4) | Short demo timings | Short demo timings |
| Roles, building, elevator, visitors | Real | Real | Local only (not in the Render building) |
| Notifications | Real | Real | Real |

### 8.4 The 4-minute demo script

**Pitch (2 minutes, projector, the team's showcase floor in presenter mode, Live agents with short timings)**

| Time | Presenter says / does | Screen |
| --- | --- | --- |
| 0:00 | "Hands up if you have more than two Claude chats running right now. The bottleneck isn't the model anymore, it's you." | Slide 1: four chat tabs vs. one kitchen |
| 0:20 | "So we made your agents a kitchen. Customers bring tickets, Chefs are real Claude agents, and you run the pass." Taps Quinn, shows the GitHub-style ticket, taps Seat | Game |
| 0:35 | Adds the 3 quick-pick Items in two taps, sends them. "On a laptop you'd type these prompts. On your phone, we pre-wrote quick picks you can edit, or tap Type it." Both Chefs start cooking | Tickets fly to the rail |
| 0:50 | "Both Chefs are busy, so the game tells me to take a break." Taps Take a break | Break screen, 10 s grace |
| 1:05 | Bell and notification: "Order up!" | Patience ring appears |
| 1:10 | Samples a Meal, steps through the real diff hunk by hunk. Sends one back: "Missing the tooltip." Approves the other | Right-docked review panel |
| 1:30 | Serves Quinn. Quinn reviews: "Overlaps flagged, but no tooltip." Taps More work | Comment card |
| 1:40 | The dining-room TV shows red clashing cells. "That's a real file a Claude agent just wrote." | Preview full screen |
| 1:50 | "Claude cooks the code. You run the pass, then take your break. Scan in, judges pick Judge." | Slide 2: QR code + URL |

At the hand-off to the room, the presenter says the stand-in line: *"On your phones the Chefs are real Claude, but they write their answer as text instead of editing a repo, so 100 of you can play at once. What you just saw on stage is the real thing."* If a showcase cook is slow, the presenter taps the LIVE pill and flips to Demo; the loop carries on.

**Play (2 minutes, audience phones)**

- The audience scans the Render QR code and lands on the role picker. Judges tap **Judge** (Sonnet); players tap **Player** (Haiku); anyone can stay a **Spectator**.
- Players get a floor in about 2 seconds. The guide bar steers them to seat Priya (the easiest Order) and send the quick-pick Items.
- When the live floors fill, latecomers become visitors and can play the Demo kitchen or watch.
- The projector switches from the showcase laptop to the Render building overview; the presenter rides the elevator into a volunteer's floor.

### 8.5 Before the demo: checklist and fallbacks

- [ ] Run one Order on Haiku and on Sonnet against the Render build; check usage and set the caps in 7.5.
- [ ] Rehearse the showcase floor end to end on the presenter laptop (`SHOWCASE=1`), with Rosterette reset to its starting state.
- [ ] Run the `playwright-core` load test with 20 headless players against the Render URL.
- [ ] Restart the Render service about 15 minutes before demos, so every floor starts clean and usage counters reset.
- [ ] Check `/admin/usage`: global stop set from the key balance, judge pool reserved.
- [ ] Test the URL and QR code on two phones on mobile data and one on the venue Wi-Fi.
- [ ] Fallback 1: if the API is slow or erroring, switch the Render default to Demo with one admin toggle. The game still works end to end.
- [ ] Fallback 2: if Render goes down, run the server on a second team laptop behind a tunnel; `qrcode-terminal` prints the new QR code.
- [ ] Fallback 3: a 20-second recording of the showcase loop, only if everything else fails.

### 8.6 Build order

Build in this order. Each phase ends with something playable, so the team always has a demo.

1. **Skeleton.** `http` + `ws` server, floor model, plain-list "ticket view" client. Done when one browser can seat, add Items and see state change.
2. **Full loop in Demo mode.** ScriptedKitchen with scripted Meals and Feedback; Orders 1–5 shippable end to end.
3. **3D floor.** Re-lay the prototype's Three.js scene to the section 2 layout, with instant panels, bottom sheets and the HUD.
4. **Live audience agents.** Messages API Chef and Customer calls, CallQueue, caps, Live/Demo modal and pill. Deploy to Render now and keep deploying.
5. **Pomodoro layer.** Break, grace period, call-backs, patience, max work time, scoring, Shift report.
6. **Roles and building.** Role picker, live and judge slots, overview, walk-in, elevator, teleport.
7. **Showcase mode.** `SHOWCASE=1`: Rosterette sandbox, Agent SDK Chefs, git diffs, live preview, on the presenter laptop.
8. **Polish.** Sounds, presenter mode, guide bar, stand-in screenshots for the TV, load test.

Freeze features about an hour before the 4:30 pm showcase deadline, and spend that hour on the checklist above.

## Decisions

Revision 3 resolved D3, D8, D18 and D19 (Render, plus text-only audience agents). The implementing agent should confirm each open decision with the team before building the part it affects; if nobody answers, build the recommended default and say so.

**Open decisions**

| ID | Decision | Recommended default | Options | Affects |
| --- | --- | --- | --- | --- |
| D15 | Chefs per floor: 2 (team brief) or 4 (prototype) | 2 | 4, one per Station | FR-22 |
| D16 | Kitchen on the top wall or the right wall | Top wall, as in the prototype | Right wall (exact mirror of the sketch) | Section 2, FR-5 |
| D17 | Which prototype mechanics to carry over | Adopt: presenter mode, guide bar, hunk-by-hunk review, score popups, spend in the HUD, Bin the order, Chef questions. Defer: Oven, Hatch, Spices, Prep board | More or fewer | FR-7 to FR-11, FR-18 |
| D20 | Judge access | Open Judge button, 6 reserved slots, judge budget pool, queue priority; no passcode | A short code for judges only | FR-3, 7.5 |
| D21 | When live floors are full | Offer the Demo kitchen and a queue, or watching | Visitor only | FR-2, FR-51 |
| D22 | Can players visit other floors? | Yes; call-backs offer "Go home" | Stay on own floor | FR-50 |
| D23 | Language | Plain JavaScript with JSDoc, as in the prototype | TypeScript | 7.1 |
| D24 | Showcase floor during the pitch | Live Agent SDK with short timings; flip to Demo if slow | Demo throughout | 8.4 |
| D25 | Spend caps | Player $0.10, Judge $1, $15 judge pool, global stop = key balance − $20 | Other values after the cost check | 7.5 |
| D26 | Where the showcase floor runs | Presenter laptop only, separate from the Render building | Also on Render as a visible floor (needs the Agent SDK and enough memory there) | 7.10 |
| D27 | Audience Chef output | Summary + one short code snippet, shown as added lines | Summary and a plan only, no code | 7.4 |
| D28 | Dining-room TV on audience floors | Pre-made "after" screenshot per Order shipped | Hide the TV on audience floors | FR-34 |

**Resolved**

| ID | Decision | Resolution |
| --- | --- | --- |
| D1 | Project name | **Ship Shift** |
| D2 | Scene renderer | Three.js 3D cartoon scene, as in the prototype |
| D3 | How Chefs run | Audience floors: one plain-text Messages API call per Item. Showcase floor: Claude Agent SDK in the real codebase |
| D4 | Models | Haiku 5.5 for Players; Sonnet 5.5 for Judges and the showcase floor |
| D5 | Default mode | Live by default; at a cap, a clear message offers Demo; LIVE/DEMO pill with a switch |
| D6 | Patience hits zero | −50 points and an angry face; the Customer stays |
| D7 | Live-floor cap | Kept; everyone over it becomes a visitor |
| D8 | Host | One always-on Render web service |
| D9 | Sample project | Rosterette (real files on the showcase floor; a written brief on audience floors) |
| D10 | Waiter movement | Walks fast; tapping opens the panel instantly |
| D11 | Break eligibility | All Chefs busy (2 of 2) |
| D12 | Station file scope | A focus in the prompt, not a lock |
| D13 | Redo | Keep the previous answer; the redo prompt asks for fixes |
| D14 | Spectator lobby | One tall building, one floor loaded at a time, elevator and teleport |
| D18 | How Customers review | Messages API everywhere |
| D19 | Live-floor cap size | 60 by default, set by budget and rate limits, not memory |

## Suggestions and alternative approaches

None of these replace a team-defined feature. They are options for the team to consider.

**Making the Pomodoro layer feel more natural.** Each idea below can sit on top of the grace period and max work time:

- **Minimum break length.** Once a break starts, no call-back for at least N minutes, even if the grace period is shorter. That protects the rest, not just its first few minutes.
- **Batched call-backs.** Wait until 2 things are ready, or a maximum wait has passed, before calling the player back. That turns several small interruptions into one return to work.
- **"Last orders" warning.** Two minutes before the maximum work time, the HUD warns the player to wrap up instead of locking them out mid-review.
- **Long break after four shifts,** as in classic Pomodoro.
- **Break streaks.** Show how many breaks were taken when eligible, instead of rewarding endless work.

**Pitch angle for Tanda.** Tanda's core product is workforce management: rosters, shifts and break compliance. The name carries the parallel: *"Tanda makes sure staff take their breaks. Ship Shift makes sure developers do too, while their AI staff keep working."* The Rosterette sample app makes the same nod. Lead with human attention as the managed resource, and treat the kitchen as the hook.

**Say the honest limits out loud.** Judges reward clear scoping. One line in the pitch covers both: real agents edit a real sandbox, and quick picks stand in for the typing you would do at a desk.

**Prove the value with numbers.** Run the same 5 tasks twice, once in plain terminal chats and once in Ship Shift, and compare blocked minutes, interruptions during focus time and rework. Even one quick run makes a strong second slide. Without time for that, show a Shift report as the evidence of what the game measures.

**If the API rate limits bite.** Keep Live mode for Judges and the team's showcase floor, and run audience floors in Demo. The room still plays, and the judges still test the real thing.

**Prototype extras for later (D17).** The Oven (run the sandbox's tests), the Hatch (merge approved work to a main branch, with a conflict warning when two Meals touch the same file) and Spices (surface agent permission prompts to the player) all fit the metaphor well. They need either a safe test runner or git merges on the server, so they are deferred unless the core is solid early.

**Future work to mention in the pitch.**

- Pull real GitHub Issues or Jira tickets into the Customer Line, and open a pull request when an Order ships.
- Run on the developer's real repository, one git worktree per Chef, driven by Claude Code itself.
- Learn each developer's sustainable shift length across sessions ("you work best in 50-minute shifts").
- A plain information-dense view with the same queue and no art, for pros, since the kitchen is a skin over a real queue.
