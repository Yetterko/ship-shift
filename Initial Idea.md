### The Pass (Expediter)

**Core Concept:**
> "What if managing AI coding agents was like directing a busy restaurant kitchen?"
This is a gamified, Pomodoro-style agent development environment. You don't write code yourself; you act as the **expediter**, bridging the front-of-house and back-of-house to orchestrate workflows.

**Roles & Workflow:**
*   **Customer = Task/Review Agent:** They enter to order tasks; each "dish" represents a specific development task.
*   **You (Expediter) = Task Breakdown:** You split the main dish into smaller components—step-by-step progress. For example, a *"Password Reset Flow"* might be broken down into Database Schema, API Endpoint, and Testing phases. You decide which chef handles each component.
*   **Chef = Build Agent:** Each has specialized stations: Backend, Frontend, Data, or Testing. Assigning the right agent to the correct station accelerates output and ensures higher quality.
*   **You (Expediter) = Quality Control & Delivery:** At the pass, you can "taste" (inspect quality), serve it out immediately, or send it back for rework.

**Mechanics:**
*   **Iterative Review:** The customer accepts a sub-task to unlock the next step, or returns it with feedback—e.g., *"Edge cases weren't tested."* Progress moves forward only after review and approval.
*   **Patience Meter:** If agents wait too long for instructions or results, they leave, and the task is lost.

**Gameplay & Interface:**
*   Fast-paced gameplay inspired by *Overcooked*. A top-down 2D/3D kitchen interface with simple assets. You control a character moving between tables, the pass, and chef stations to accept orders, distribute tasks, inspect quality, and deliver results while monitoring multiple concurrent agents.

**Scoring:**
*   **Importance:** Points awarded per task. Review agents are stricter; difficult tasks yield higher scores.
*   **Resolution Density:** Volume of work accepted within a specific time unit (efficiency).
*   **Stamina:** Pre-shift duration selection—e.g., 25, 50, or 90 minutes. Longer shifts offer multipliers, provided the backend output matches frontend progress. The core challenge is identifying your maximum sustainable period for high-quality work.

**Long-term Value:**
*   After multiple sessions, the system identifies your true focus limits and recommends an optimal shift length—e.g., *"You are best suited for 50-minute shifts."*

---

### Architectural Context Note
This translation maps the restaurant metaphor directly to software engineering workflows:
*   **Customers** represent external or internal review agents (QA, LLM reviewers).
*   **Chefs** represent specialized AI coding agents (Backend Agent, Frontend Agent, etc.).
*   **The Pass** represents a CI/CD pipeline gate where quality assurance occurs.
*   **Pomodoro Stages** simulate time-boxed development sprints to manage agent attention and prevent hallucination or stale states.

---

### Positioning & Competitive Advantage
> Do not frame this as a replacement for Claude Code or Codex; it is an orchestration layer built on top of them. You cannot outperform the efficiency of managing a single agent in one terminal. Your competitive edge lies in how you handle running 3–5 agents simultaneously: eliminating excessive tab-switching, reducing idle waits while humans are distracted, and preventing half-hearted reviews.

### Actual Value
> Once multiple agents are running concurrently, the bottleneck shifts from model performance to human attention. Claude Code and Codex are designed for single conversations and cannot manage these states:

*   **When to Check:** Instead of interrupting you immediately upon completion or a stall, your Pomodoro gates hold everything at the "pass" until breaks, allowing protected focus time and batched reviews.
*   **Priority Queue:** A unified view lists blocked agents, items awaiting review, and expired branches, sorted by urgency. The "customer patience meter" essentially measures how long agents have been idle due to your inactivity.
*   **Review Discipline:** Nothing is considered complete until inspected at the pass. Most agent tools allow users to accept work they haven't actually read; this tool enforces review discipline.
*   **Coordination:** Assign one station per chef (agent). Expired branches spoil, and small tasks are merged into a single batch for efficiency. These insights come from Entash; standard single-agent tools do not enforce them.

### One-Sentence Pitch
> "Code is written by Claude; this tool determines when you allocate your attention to it."

### Originality
> Regarding originality:
*   **Parallel Management:** Running agents in parallel via a dashboard isn't novel. Tools like T3 Code, Kanban-style agent panels, and cloud task views already exist. If your pitch is just "parallel agents," judges have seen it.
*   **Gamification:** Gamified Pomodoro apps with pets or RPGs are common.
*   **Human Attention Focus:** Treating human attention as a managed resource and gamifying the interface is rare. Existing tools focus on agent performance; yours focuses on human focus and review quality. This is your unique point—pitch this first, not the kitchen metaphor.

### Weaknesses to Address
> Weaknesses you must address now:
*   **Fading Novelty:** Novelty fades after a week. Pros want information density, not animations. The kitchen UI should be a skin over a real queue; if removing the art breaks functionality, it's just a toy.
*   **Misaligned Rewards:** Gamification might reward incorrect behaviors (e.g., rewarding merged tasks instead of single-pass quality).
*   **Latency Risks:** Agent latency can derail demos. Use small tasks and prepare replay modes.

### How to Prove Value to Judges
> Show before/after metrics, not just claims. Run 5 tasks twice: native terminal vs. kitchen dashboard. Track blocked minutes, interruptions during focus time, and rework rates (returned dishes or missed bugs). If the dashboard wins on data, you answer "why not just Claude?" directly.

