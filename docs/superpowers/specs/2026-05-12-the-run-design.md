# Design — The Run (Doc 1 of 2)

> **Date:** 2026-05-12
> **Status:** Approved (full doc) — 2026-05-13. **Implementation: Chunks 1-13 complete (2026-05-13).** Phase B cleanup deferred 30 days.
> **Implementation plan:** [docs/superpowers/plans/2026-05-12-the-run-implementation.md](../plans/2026-05-12-the-run-implementation.md)
> **Progress tracker:** [docs/superpowers/plans/2026-05-13-the-run-progress.md](../plans/2026-05-13-the-run-progress.md)
> **Companion:** Doc 2 — [Sidebar IA + URL Migration](./2026-05-12-sidebar-ia-design.md).
> **Slot:** E (from the audit menu — "5-item sidebar brainstorm," reframed to "the Run as the unit of work").

---

## 1. Context

### What this design replaces

DevForgeAI today has parallel surfaces for what users perceive as one concept:

- `/chat` — conversation with an LLM (sometimes with image gen, sometimes with persona switching).
- `/workbench/:id` — method-driven multi-agent runs with phase orchestration, intervention controls, event monitoring.
- `/agents/:id/run` — single-agent task execution.
- `/runs` — an alias / index that points to one of the above depending on context.

These surfaces share the same conceptual primitive (a unit of AI work) but expose it through different page shapes, different intervention models, different state machines, and different chat affordances. A user wanting to "work several items at once" has to pick which surface each item lives on, then juggle their context across tabs.

The user's stated North-Star (verbatim, captured during brainstorm):

> "I want the end user to be able to spin up a project but be able to see everything happening while agents are running, which agents are running, what they're doing, how they're doing it, I don't want any 'black box' processes happening. Each Run needs it's own chat in case the end user wants to work several items at once and still have chat to do LLM type interactions like create images or ask questions."

This document defines the **Run** as a single first-class entity that subsumes chat, workbench, and agent-run, and the UX through which the user interacts with one or many Runs.

### Why this is Doc 1 of 2

The original audit framed this as a "5-item sidebar consolidation." The user's vision is bigger — it's a rethink of the work model, not just the chrome. The brainstorm decomposed the work into two design docs:

- **Doc 1 (this file):** The Run as a model + the Run viewer UX + concurrent Run management.
- **Doc 2 (pending):** Sidebar IA + URL migration plan — depends on Doc 1.

Doc 1 must land first because Doc 2's IA decisions depend on what surfaces a Run can appear in.

### Roadmap dependency

`docs/SESSION_HANDOFF.md` documents the active roadmap as `F → D1 → D2 → M2 → Implement → UI consolidation`. F is closed (this session). D1 is closed. D2 is in progress. UI consolidation has been "blocked on above." This design is the spec the UI consolidation step will execute against — written now so it's ready when D2 lifts.

---

## 2. Decisions (the brainstorm log)

Each row is a binding decision. Override requires reopening the brainstorm.

| # | Decision | Choice | Rationale |
|---|---|---|---|
| Q1 | Run ↔ Chat ontology | **A — Run *is* a chat (polymorphic)** | Every chat is a Run with no method scaffold; complexity grows as user invokes methods. Matches "each Run needs its own chat" directly. |
| Q2 | Concurrency UX | **D — Hybrid: rail + grid** | Rail (always-visible "Active runs") for cheap mid-work switching. `/now` grid for bird's-eye glance across all runs. |
| Q3 | Run viewer layout | **L3 — Adaptive 3-pane** | Wide screens (≥1400px): chat \| event timeline \| live agents. Narrow: live-agents collapses to a slide-over. |
| Q4 | Transparency depth | **T4 — Layered (T2 default, T3 on drill)** | Clean default scannable timeline; click any event to expand full prompt + response + raw I/O. Storage is full-depth regardless. |
| Q5 | Intervention scope | **I4 — I2 default, I3 power-tools** | Most users get lifecycle + per-agent controls + approval gates. Edit-and-retry / fork gated behind a "Power tools" toggle. |
| Q6a | Distinguish `awaiting_input` vs `awaiting_approval`? | **Yes — distinct** | Operationally different (chat reply vs. button click). Better signal in cards/badges. |
| Q6b | Forks = new Run or child branch? | **New Run with `forked_from_event_id`** | Keeps the rail/grid model uniform. No branch picker. Diff-between-branches is YAGNI for v1. |
| Q7 | Run ↔ Project relationship | **C — Default "Scratch" project always exists** | `run.project_id NOT NULL` invariant. Casual chats land in Scratch (capability-gated; no shell, no write outside `data/scratch/`). |

---

## 3. Core Concept

A **Run** is the unit of work. It is polymorphic across three observable shapes:

1. **Empty Run** — just a chat thread. Equivalent to today's `/chat`. No phases, no agents, no method.
2. **Method-driven Run** — a chat thread plus an attached method (BMAD, GSD, Superpowers, custom). The method spawns phases and agents on demand.
3. **Mixed Run** — both the chat and the method-driven scaffolding are active. The chat panel lets the user ask LLM questions or generate images alongside the agent work.

A Run is *cheap by default*. Typing into an unattached chat surface creates a Run in Scratch with no method. Saying `/bmad` (or picking a method from the picker) attaches the method *to the existing Run* and grows the scaffold in-place. Cancellation of the method leaves the Run as a plain chat.

Every Run belongs to a Project. The Scratch project always exists. It is a real database row, not a sentinel — UIs never write `WHERE project_id IS NULL`. Scratch is capability-gated: no shell tools, no file writes outside `data/scratch/`, no git snapshots.

Forks (from the "Edit & retry" or "Fork from here" power-tool actions) create a **new top-level Run** with `forked_from_event_id` pointing at the event the fork branched off. The fork inherits the parent's `project_id` and `method_id`. No branch picker UI ships in v1; the fork relationship is queryable via the API for users who want to reconstruct lineage.

---

## 4. Data Model

### 4.1 Tables

```text
runs
  id                        uuid          PK
  title                     text          (auto from first message; user-editable)
  project_id                text          FK → projects.id  NOT NULL  (String(64) — not UUID, to allow id='scratch')
  method_id                 text          nullable          ('bmad' | 'gsd' | 'superpowers' | <custom-id> | NULL)
  state                     text          NOT NULL          enum (see §4.2)
  current_phase_id          uuid          nullable          FK → run_phases.id
  forked_from_event_id      uuid          nullable          FK → run_events.id
  power_tools_enabled       boolean       NOT NULL DEFAULT false
  created_at                timestamptz   NOT NULL
  updated_at                timestamptz   NOT NULL
  completed_at              timestamptz   nullable

run_phases
  id                        uuid          PK
  run_id                    uuid          FK → runs.id  NOT NULL  ON DELETE CASCADE
  index                     int           NOT NULL          (0-based order within run)
  name                      text          NOT NULL
  agent_role                text          nullable
  model_id                  uuid          nullable          FK → models.id
  status                    text          NOT NULL          enum: queued | running | done | failed | skipped
  started_at                timestamptz   nullable
  ended_at                  timestamptz   nullable

run_messages
  id                        uuid          PK
  run_id                    uuid          FK → runs.id  NOT NULL  ON DELETE CASCADE
  role                      text          NOT NULL          ('user' | 'assistant' | 'system')
  content                   text          NOT NULL
  image_url                 text          nullable
  created_at                timestamptz   NOT NULL
  -- index hint for migration: btree (run_id, created_at) — chat pane queries
  -- always paginate by recency within a single run.

run_events
  -- index hint for migration: btree (run_id, created_at) — timeline render
  -- + btree (run_id, phase_id) — phase-anchor jumps from the top strip.

run_events                  -- (see also: index hints above)
  id                        uuid          PK
  run_id                    uuid          FK → runs.id  NOT NULL  ON DELETE CASCADE
  phase_id                  uuid          nullable          FK → run_phases.id
  kind                      text          NOT NULL          enum (see §4.3)
  summary                   text          NOT NULL          (T2 view — short label)
  payload                   jsonb         NOT NULL          (T3 view — prompts, responses, tool I/O)
  duration_ms               int           nullable
  tokens_in                 int           nullable
  tokens_out                int           nullable
  cost_usd                  numeric(10,4) nullable
  created_at                timestamptz   NOT NULL          (event timestamp)

projects (existing table — Scratch row guaranteed)
  id = 'scratch'  is_system = true  is_active = true  sandbox_mode = 'restricted'
```

### 4.2 Run state machine

```text
                                  ┌─────────────────┐
                                  │   awaiting_     │
                          ┌──────▶│   approval      │──────┐
                          │       └─────────────────┘      │
                          │                                │
                          │       ┌─────────────────┐      │
   (new)──▶ awaiting_input ──▶ running ──┼──▶│   awaiting_     │──────┤
                          │       │   input         │      │
                          │       └─────────────────┘      │
                          │                                │
                          │       ┌─────────────────┐      │
                          └──────▶│   paused        │──────┤
                                  └─────────────────┘      │
                                          ▲                ▼
                                          └────────── running
                                                   │
                                                   ├──▶ completed
                                                   ├──▶ failed
                                                   └──▶ cancelled

(any state) ──▶ archived  (user action; hidden from default views)
```

- `running` — at least one phase or agent is executing OR the chat thread is awaiting an LLM response.
- `awaiting_input` — chat is the gate. The Run is idle pending a user typed reply. Distinct from `awaiting_approval` per Q6a.
- `awaiting_approval` — a method phase gate is open. UI surfaces an Approve / Skip / Edit-brief affordance.
- `paused` — user pressed Pause. Agents halted at last checkpoint. Resume re-enters `running`.
- `completed` — every phase reached `done` (or method exited cleanly for empty Runs); `completed_at` set.
- `failed` — terminal error; `failed_at` is **derived** from the latest `run_event` of kind `error` (no separate column on `runs`). UIs render the diagnosis from that event. Stays in rail/grid until acknowledged.
- `cancelled` — user terminated mid-flight.
- `archived` — user-managed; removes from default views, retained in search and API.

### 4.3 RunEvent kinds (the transparency layer)

| `kind` | When emitted | T2 summary example | T3 payload includes |
|---|---|---|---|
| `phase_start` | Phase enters `running` | `▶ Architect started` | `phase_id`, `agent_role`, `model_id` |
| `phase_end` | Phase reaches `done` / `failed` | `✓ Architect done (1m 18s)` | `duration_ms`, final outputs |
| `agent_start` | An agent begins work within a phase | `🤖 Architect · claude-opus-4.7` | `agent_id`, `system_prompt`, settings |
| `tool_call` | Agent invokes a tool | `└ read_file(auth/oauth.py) → 142 lines` | full args, full return |
| `tool_result` | Tool returns (separate event when slow) | `└ search_docs → 5 results` | full result body |
| `model_request` | LLM call dispatched | (folded into `agent_start`'s expansion) | full prompt, model, params |
| `model_response` | LLM call returned | (folded into `agent_start`'s expansion) | full response, tokens, cost |
| `approval_gate` | Method requires user approval | `⏸ Approval gate: Developer` | gate config, brief |
| `user_intervention` | User paused/edited/forked | `👤 paused agent: Architect` | what user did |
| `error` | Phase or agent failed | `⚠ Architect: tool error` | error class, traceback, recovery candidates |

**T4 rendering note:** the timeline renders each event's `summary` line plus a chevron when `payload` is non-trivial. Click expands inline. Power-tool action buttons (Copy, Edit & retry, Swap model, Fork from here) appear in the expansion only when `runs.power_tools_enabled = true`.

---

## 5. UI Architecture

### 5.1 Surfaces introduced by this design

| Path | Purpose | Replaces |
|---|---|---|
| `/now` | System-wide grid. Live cards grouped by project. The "no black box across the system" view. | Today's home-page method picker (Slot B made it honest, this replaces it) and the partial role of `/runs` index. |
| `/runs/:id` | Run viewer (L3 layout). Primary work surface. | `/chat/:id`, `/workbench/:id`, `/agents/:id/run` — all collapse here. |
| `/runs/:id/events/:eventId` | Deep-link to an expanded event (T4 drawer state). | New capability. |
| `/runs/new` | Invocation. POST creates an empty Run in Scratch; UI redirects to `/runs/:id`. | Implicit replacement for "New chat" / "New workbench". |

### 5.2 `/now` — the grid

Layout:

- Top: project filter chips + Status filter (Active / Awaiting / Recent / All) + search.
- Body: grid of Run cards (3 columns on wide, responsive collapse). Cards grouped by project, with project name as a sticky header. Scratch is always rendered (with its capability-restricted badge).
- Card content: status badge (`🟢 running` / `⏸ paused` / `💬 awaiting_input` / `⏸ awaiting_approval` / `⚠ failed`), title, method (or `no method`), current phase (if method-driven), last activity tail ("…drafting interface contracts"), elapsed time.
- Card inline actions for specific states: `Approve` / `Skip` (when `awaiting_approval`); `Resume` (when `paused`); `Acknowledge` (when `failed`). All actions are idempotent; the card optimistically updates and reverts on backend error.
- Completed / cancelled Runs render in a collapsible "Recent" section per project. Archived Runs do not render here.

### 5.3 `/runs/:id` — the Run viewer

#### Wide layout (≥1400px) — adaptive 3-pane plus rail

```
┌──────────────────────────────────────────────────────────────────────┐
│ 🟢 OAuth login flow · BMAD · devforgeai     [phase strip]  ⏸ ⏹       │
├────────┬───────────────────┬─────────────────────────┬───────────────┤
│ Active │  Chat (in-Run)    │  Event timeline (T4)    │  Live agents  │
│ runs   │                   │                         │               │
│        │ › what's blocked? │ [12s] 🤖 Architect ⤴    │ [Architect]   │
│ ●OAuth │  ↳ Architect mid- │   └ read_file → 142     │  opus-4.7     │
│ ⏸ Ref. │    research       │   └ search_docs → 5     │  🔧 search    │
│ 💬 Q   │                   │ [3s]  └ thinking…       │  ⏸ ✕          │
│ 💬 img │ › gen key+lock    │                         │               │
│        │   [img preview]   │                         │               │
└────────┴───────────────────┴─────────────────────────┴───────────────┘
   130px        ~38%                  ~42%                  ~20%
```

> **Note on pane widths:** the percentages above are illustrative defaults; the implementation plan should lock the CSS grid template explicitly (likely a `grid-template-columns: 130px minmax(360px, 1.1fr) minmax(420px, 1.2fr) minmax(260px, 0.9fr)` shape) and verify the breakpoint math, rather than treating "38/42/20" as a literal constraint.

**Top strip:**
- Title (editable inline).
- Project name (click → project page).
- Method chip (click → method picker to attach/swap; nullable when empty Run).
- Phase strip — only renders when `method_id IS NOT NULL`. Each phase chip color-coded by `run_phases.status`. Click → scroll event timeline to that phase's events.
- Lifecycle buttons (state-aware): Pause / Resume / Cancel. Disabled when state forbids.
- Power tools toggle (gear icon → menu): toggles `runs.power_tools_enabled`. Persisted per-Run.

**Rail (left, 130px):**
- "Active" header + list of Runs in state ∈ {`running`, `awaiting_input`, `awaiting_approval`, `paused`, `failed`}. Sorted by `updated_at desc`.
- Current Run is highlighted.
- Click another Run → in-place swap (no full page reload). URL updates via `history.pushState`.
- Below "Active": collapsed "Recent" section showing last 5 completed Runs.
- The rail uses the same data source as `/now`'s card list — one fetch, two renderings.

**Chat pane:**
- Identical input affordances to today's `/chat` (slash commands, image-gen intent detection, persona/model dropdowns gated by `modelRuntimeReadiness`).
- `messages` come from `run_messages` for this run.
- Slash commands relevant here: `/method <name>` to attach a method, `/onboard`, `/image`, `/pin`, `/export`, `/model`, `/fork` (power-tools-gated; only valid inside an expanded event drawer).
- When `state = awaiting_input`, the input is highlighted/focused.

**Event timeline pane:**
- Renders `run_events` for this run in ascending time order.
- Default view = T2 (summary line per event, depth via indentation for nested kinds like `tool_call` under `agent_start`).
- Click expands inline (T3 payload). Expansion drawer contains:
  - Full prompt (collapsible).
  - Full response (collapsible).
  - Raw tool I/O (if applicable).
  - Cost / token counts.
  - Action buttons: Copy prompt, Copy response (always visible).
  - Power-tool actions (`Edit & retry`, `Swap model`, `Fork from here`) only when `power_tools_enabled`.
- Phase headers act as anchors — clicking a phase chip in the top strip scrolls to that phase's first event.

**Live agents pane (right):**
- Lists agents whose latest `run_events` indicate they are currently mid-step (no terminal event yet for the current phase).
- Each card: agent role, model, current tool (if known), elapsed time on current step, per-agent `⏸` (pause this agent) / `✕` (kill this agent).
- When `state = awaiting_approval`, the approval banner card surfaces here with Approve / Skip / Edit-brief actions and a summary of what the gate is asking.

#### Narrow layout (<1400px) — adaptive collapse

- Rail collapses to a tab-style horizontal pill bar above the chat.
- Live agents pane folds into a "Live (N)" button in the top strip. Click → slide-over panel from the right covering ~30% of viewport.
- Chat and Event timeline retain equal width.
- Below ~900px: Event timeline collapses to a separate tab. Chat is the default tab.

### 5.4 Invocation flows

| User action | Outcome |
|---|---|
| Click `+ new Run` from `/now` | `POST /v1/runs { project_id?, method_id? }` → redirect to `/runs/:id`. Defaults to Scratch + no method. |
| Type in `/runs/:id` chat with no active Run loaded (e.g., deep link, restored session) | Creates a new empty Run in Scratch; URL replaces. |
| Type `/method bmad` (or any registered method slash) in chat | Attaches `method_id` to the current Run. Backend spawns method phases. UI grows the phase strip and live-agents pane. |
| Slash command `/fork` (power tools enabled) | If invoked inside an expanded event, creates a forked Run from that event. |

---

## 6. Concurrency Model

The user can have N Runs in any non-terminal state simultaneously. Backend enforces no global cap, but the rail/grid sort by `updated_at desc` so stale Runs naturally fall off the immediate view.

Switching between Runs is purely a client-side focus change. Backend doesn't know which Run the user is "looking at." All in-flight Runs continue executing independently. The rail subscribes to a single per-user WebSocket / SSE stream of `run_event` deltas; the client routes events into the appropriate Run's local state.

For power users running 10+ concurrent Runs, the rail's "Active" list virtualizes after 8 entries with a scroll affordance. `/now`'s grid pagination kicks in at 24 per project.

---

## 7. Error Handling

### 7.1 Backend errors during Run execution

- A failing tool / model / phase emits a `run_event` of kind `error` with the full traceback in `payload`.
- The Run transitions to `failed`. `completed_at` is **not** set (preserves `failed_at` semantics via the most recent error event).
- The error event's `payload.recovery_candidates` (when populated by the runtime resolver — see D2 work) surfaces in the expanded drawer with "Retry with X" buttons. **Render rule:** the "Retry with X" UI only renders when the field is present. The implementation plan must NOT block on D2 to ship the error-path rendering; absent the field, the drawer falls back to "Manual retry" + the raw error.

### 7.2 Frontend errors

- Network/SSE drop: client retries silently with exponential backoff; rail shows "Reconnecting…" badge.
- A Run viewer rendering crash is caught by an error boundary scoped to the viewer (not the rail) so the rail keeps working and the user can navigate elsewhere.
- Optimistic actions (Approve, Pause) revert on error and surface a toast.

### 7.3 Stale state guard (reuses `modelRuntimeReadiness`)

The chat pane's model dropdown uses the predicate added in Bug 1 (`validateModelOverride`). Same predicate is consulted by the live agents pane: if an active agent's model becomes inactive mid-run (key removed, deactivated), the agent's card surfaces a `Swap model` prompt rather than waiting for the next request to fail.

### 7.4 Recovery from session loss

Runs persist in the database. A browser refresh / crash reloads the rail from `GET /v1/runs?active=true` and the viewer from `GET /v1/runs/:id`. SSE re-subscribes. No client-only state survives reload (titles, drawer expansion are local-only and reset to defaults).

---

## 8. Testing Strategy

### 8.1 Backend

- Run state-machine transitions: `tests/test_run_state_machine.py` — every legal/illegal transition.
- Run event emission contract: `tests/test_run_event_contract.py` — each `kind` emits the documented `payload` shape.
- Scratch project guarantee: migration test asserts `projects.id = 'scratch'` exists after any fresh migration.
- Power-tools gating: API rejects fork / edit-and-retry requests when `power_tools_enabled = false`.
- `forked_from_event_id` integrity: parent event must exist and belong to a different Run.

### 8.2 Frontend

- Contract test for the SSE event normalizer (extends the existing `eventContract.test.ts`).
- Unit tests for the Run viewer's layout breakpoint logic (≥1400 = 3-pane, narrower = collapse).
- `modelRuntimeReadiness` predicates already covered.
- E2E (Playwright or equivalent — not yet adopted): one happy path that creates a Run, attaches BMAD, watches a phase complete, approves the gate, completes. Deferred to implementation plan unless prerequisite is already in place.

### 8.3 Manual verification checklist (per implementation plan)

- Multiple concurrent Runs visible in rail + grid; switching is instant.
- Chat in one Run does not bleed into another.
- Fork creates a new Run with `forked_from_event_id` linking back.
- Approval gate surfaces in both `/now` card and viewer banner; approving advances state.
- Adaptive collapse works at 1399px ↔ 1400px boundary.

---

## 9. Open Questions / Deferred

These are intentionally NOT decided in this doc — they belong to Doc 2 or the implementation plan:

1. **Sidebar IA.** Whether the rail merges with the global sidebar's "Now" item or stays as a Run-viewer-local rail. Doc 2.
2. **URL migration for `/chat/:id`, `/workbench/:id`, `/agents/:id/run`.** Redirect rules, transitional aliases, deprecation timeline. Doc 2.
3. **Project page Run list.** How the Project detail page lists its Runs (likely a filtered slice of `/now`). Doc 2 or implementation.
4. **Method picker UX inside the Run viewer.** Modal vs. inline. Implementation plan.
5. **WebSocket vs. SSE choice for the event stream.** Implementation plan; current `pipelines.py` uses SSE.
6. **Run archival policy.** Auto-archive completed Runs after N days? User-only? Implementation plan.
7. **Performance budget.** Initial render of `/now` with 50+ Runs; expand-event-drawer latency target. Implementation plan.

---

## 10. References

- Existing static mock for the "Now" surface: `frontend/src/components/now/NowMocks.tsx`. The mock contains FAKE_RUNS, RECENT_RUNS, phase strip, timeline, stalled detector — preview at `http://localhost:3001/mocks/now`. This design replaces it with the live implementation.
- Live (already-wired) Now launcher: `frontend/src/components/now/NowLive.tsx`. Reused as the data source for the `/now` grid and the rail.
- Existing workbench intervention commits the I2 default level draws from:
  - `feat(workbench): add global pause/resume agent controls`
  - `feat(workbench): add undo-last-agent control loop`
  - `feat(workbench): add spawn approval gates and controls`
  - `feat(workbench): add session intervention controls`
  - `feat(workbench): add agent monitor and detail panel`
- Predicate already deployed for stale-state gating: `frontend/src/lib/modelRuntimeReadiness.ts`.
- Roadmap: `docs/SESSION_HANDOFF.md` (canonical live-state doc).
- Slot B audit and home-page honesty fixes: commit `3c35a14`.
- Slot A F-class closure: commits `09ccf4d` → `e21544d`.

---

## 11. Brainstorm artifacts (ephemeral, not committed)

Visual companion mockups were generated during the brainstorm at `.superpowers/brainstorm/671-1778623161/`:

- `welcome.html` — kickoff
- `concurrency.html` — Q2 options (tabs / rail / grid / hybrid)
- `viewer-layout.html` — Q3 options (L1–L4)
- `transparency.html` — Q4 options (T1–T4)
- `intervention.html` — Q5 options (I1–I4)
- `design-composite.html` — assembled wireframe of Screens 1 & 2

`.superpowers/` is gitignored. These files are preserved on disk locally for reference but won't survive a clean rebuild. The text-based wireframes embedded in §5.3 of this doc are the durable reference.
