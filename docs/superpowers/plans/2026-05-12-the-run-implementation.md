# The Run — Implementation Plan

> **Spec:** [docs/superpowers/specs/2026-05-12-the-run-design.md](../specs/2026-05-12-the-run-design.md)
> **For agentic workers:** REQUIRED — Use `superpowers:subagent-driven-development` (if subagents available) or `superpowers:executing-plans` to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking. Do **not** check a box until the code is written, tests pass, and a commit is made for that step.
> **Status:** Drafted 2026-05-12. Awaiting kickoff.
> **Companion:** Doc 2 (sidebar IA + URL migration) is **not yet written**. This plan is structured so the URL/sidebar pieces are last; if Doc 2 lands first they replace Chunk 12. If Doc 2 slips, Chunk 12 ships a minimal "in-place redirect" fallback that preserves today's URLs.

**Goal:** Land the spec at `docs/superpowers/specs/2026-05-12-the-run-design.md` — make the Run a first-class polymorphic entity (chat ⇄ method-driven ⇄ mixed), with a live `/now` grid, an adaptive 3-pane `/runs/:id` viewer, full event transparency (T2 default, T3 on drill), I2 default interventions + I3 power tools behind a toggle, and the Scratch-project invariant.

**Strategy:** Additive. The new tables (`runs`, `run_phases`, `run_messages`, `run_events`) coexist with today's `workbench_sessions` / `workbench_pipelines` / `conversations` / `messages`. A thin adapter layer translates legacy events into `run_events` so the new UI works against real data from day one. The legacy URLs (`/chat/:id`, `/workbench/:id`, `/agents/:id/run`) keep working through Chunk 11; Chunk 12 introduces redirects (Doc 2 dictates the final shape).

**Out of scope (deferred to spec §9 / Doc 2):**
- Final sidebar IA.
- Auto-archival policy.
- WebSocket migration (keeps SSE — `pipelines.py` already uses it).
- Branch picker / fork-diff UI (fork creates a new top-level Run only).
- E2E Playwright suite (no harness in repo yet; deferred per spec §8.2).

---

## File map (new + modified)

```
backend/
├── alembic/versions/
│   └── 007_runs_and_projects.py                  NEW  (migration)
├── app/
│   ├── models/
│   │   ├── project.py                            NEW  (Project DB model)
│   │   └── run.py                                NEW  (Run, RunPhase, RunMessage, RunEvent)
│   ├── schemas/
│   │   └── run.py                                NEW  (Pydantic in/out shapes)
│   ├── services/
│   │   ├── runs.py                               NEW  (Run service: CRUD, state machine, fork)
│   │   ├── run_events.py                         NEW  (event emitter + SSE fan-out)
│   │   ├── projects_sync.py                      NEW  (projects.json ⇄ DB mirror; Scratch invariant)
│   │   └── pipelines_to_runs_adapter.py          NEW  (legacy pipeline events → run_events)
│   ├── routes/
│   │   ├── runs.py                               NEW  (/v1/runs/* incl. /stream)
│   │   ├── pipelines.py                          MOD  (emit through run_events adapter)
│   │   └── projects.py                           MOD  (write-through to DB mirror)
│   ├── main.py                                   MOD  (include runs_router; startup: ensure Scratch row)
│   └── tests/
│       ├── test_run_state_machine.py             NEW
│       ├── test_run_event_contract.py            NEW
│       ├── test_run_fork.py                      NEW
│       ├── test_scratch_invariant.py             NEW
│       └── test_runs_power_tools_gate.py         NEW
│
frontend/
├── src/
│   ├── lib/
│   │   ├── runs/
│   │   │   ├── types.ts                          NEW
│   │   │   ├── api.ts                            NEW  (REST client)
│   │   │   ├── runStream.ts                      NEW  (SSE subscription + reconnect)
│   │   │   ├── eventContract.ts                  NEW  (normalizer; mirrors backend kinds)
│   │   │   └── breakpoints.ts                    NEW  (≥1400 logic)
│   │   └── modelRuntimeReadiness.ts              (existing — reused)
│   ├── hooks/
│   │   ├── useRun.ts                             NEW
│   │   ├── useRuns.ts                            NEW
│   │   └── useRunEvents.ts                       NEW
│   ├── components/
│   │   ├── now/
│   │   │   ├── NowLive.tsx                       MOD  (use real RunSummary + Scratch row)
│   │   │   └── NowGrid.tsx                       NEW  (cards-by-project grid for /now)
│   │   ├── run/
│   │   │   ├── RunViewer.tsx                     NEW  (adaptive 3-pane shell)
│   │   │   ├── RunTopStrip.tsx                   NEW  (title, phase chips, lifecycle)
│   │   │   ├── RunRail.tsx                       NEW  (left 130px active list)
│   │   │   ├── RunChatPane.tsx                   NEW
│   │   │   ├── RunEventTimeline.tsx              NEW  (T2 + click-to-T3 drawer)
│   │   │   ├── RunLiveAgents.tsx                 NEW
│   │   │   ├── RunApprovalBanner.tsx             NEW
│   │   │   └── PowerToolsToggle.tsx              NEW
│   │   └── RunPanel.tsx                          (existing — leave; deprecated path)
│   └── app/(main)/
│       ├── now/page.tsx                          NEW  (/now grid)
│       ├── runs/
│       │   ├── page.tsx                          MOD  (index → redirect to /now)
│       │   ├── new/page.tsx                      NEW  (POST + redirect)
│       │   └── [id]/
│       │       ├── page.tsx                      NEW  (RunViewer host)
│       │       └── events/[eventId]/page.tsx     NEW  (deep-link drawer)
│       └── (legacy)/                             see Chunk 12 — redirect shims
└── tests/
    ├── runViewerBreakpoint.test.tsx              NEW
    └── runEventContract.test.ts                  NEW
```

---

## Chunk 1: Database foundations

> Goal: tables exist, migration is reversible, models import cleanly, Scratch row exists after migration.

### Task 1.1: Add `Project` DB model

**Files:** Create `backend/app/models/project.py`; modify `backend/app/models/__init__.py`.

- [ ] **Step 1 — model.** Mirror today's file-backed project fields: `id` (`String(64)` PK so the literal `'scratch'` is a valid id — spec §4.1 uses `id = 'scratch'`, which forces a string PK rather than UUID; this resolves the type ambiguity between the two snippets in §4.1), `name` (text), `path` (text, nullable), `description` (text, nullable), `template` (text, nullable), `sandbox_mode` (`String(20)`, default `'full'`, enum `'restricted'|'full'`), `is_system` (`Boolean`, default false), `is_active` (`Boolean`, default true), `extra_data` (`JSON`, default dict), timestamps.
- [ ] **Step 2 — register.** Import + export from `backend/app/models/__init__.py`.
- [ ] **Step 3 — verify import.** `python -c "from app.models import Project"` from `backend/`. No errors.
- [ ] **Step 4 — commit.** `feat(models): add Project DB model`.

### Task 1.2: Add Run-family models

**Files:** Create `backend/app/models/run.py`; modify `backend/app/models/__init__.py`.

- [ ] **Step 1 — `Run`.** Columns per spec §4.1: `id` (UUID PK), `title` (text), `project_id` (`String(64)`, FK→`projects.id`, **NOT NULL**), `method_id` (text, nullable), `state` (text, NOT NULL, default `'running'`), `current_phase_id` (UUID, nullable, FK→`run_phases.id` — use `use_alter=True` to break the cycle), `forked_from_event_id` (UUID, nullable, FK→`run_events.id`, `use_alter=True`), `power_tools_enabled` (bool, default false), timestamps incl. `completed_at` (nullable).
- [ ] **Step 2 — `RunPhase`.** Per spec §4.1. `run_id` FK cascade delete. Add a `UniqueConstraint(run_id, index)`.
- [ ] **Step 3 — `RunMessage`.** Per spec §4.1. Index `(run_id, created_at)`.
- [ ] **Step 4 — `RunEvent`.** Per spec §4.1 + §4.3. Indexes `(run_id, created_at)` and `(run_id, phase_id)`. `kind` is text (no DB enum — kinds list lives in code so adding a kind is a one-file change).
- [ ] **Step 5 — relationships.** `Run.phases`, `Run.messages`, `Run.events` with `cascade="all, delete-orphan"`, `order_by`.
- [ ] **Step 6 — register + verify import.**
- [ ] **Step 7 — commit.** `feat(models): add Run, RunPhase, RunMessage, RunEvent`.

### Task 1.3: Alembic migration

**Files:** Create `backend/alembic/versions/007_runs_and_projects.py`.

- [ ] **Step 1 — `upgrade()`.** Create `projects` table (idempotent guard via `op.get_bind().dialect.has_table` is unnecessary in alembic; use `if not table_exists` pattern only if existing installs already have a `projects` table — they don't per `models/__init__.py`). Create `run_phases`, `run_messages`, `runs`, `run_events` in dependency order. Add the deferred FKs (`runs.current_phase_id`, `runs.forked_from_event_id`) via `op.create_foreign_key` after both sides exist.
- [ ] **Step 2 — Scratch row.** Inside `upgrade()`, `op.bulk_insert` one row into `projects`: `id='scratch'`, `name='Scratch'`, `is_system=True`, `is_active=True`, `sandbox_mode='restricted'`, `path=None`, `description='Casual chat & ad-hoc Runs. No shell, no writes outside data/scratch/.'`.
- [ ] **Step 3 — `downgrade()`.** Drop in reverse order. Drop deferred FKs first.
- [ ] **Step 4 — run migration locally.** `alembic upgrade head`, inspect tables, `alembic downgrade -1`, `alembic upgrade head`.
- [ ] **Step 5 — commit.** `feat(db): add runs and projects tables (migration 007)`.

### Task 1.4: Backfill from `data/projects.json`

**Files:** Create `backend/app/services/projects_sync.py`; modify `backend/app/main.py` (startup hook).

- [ ] **Step 1 — `sync_projects_from_json_to_db()`.** Read `data/projects.json`. For each entry: upsert into `projects` table. Leave the JSON file as the write-through source-of-truth for now (the routes in `projects.py` keep writing it; we mirror to DB so FKs work). Idempotent — safe to run on every startup.
- [ ] **Step 2 — `ensure_scratch_project()`.** Guarantee the Scratch row exists with `is_system=True`. Called from migration AND from startup as belt-and-suspenders.
- [ ] **Step 3 — wire into startup.** In `main.py` lifespan (or wherever DB init runs), call both. Log warning on each upsert.
- [ ] **Step 4 — modify `routes/projects.py`.** After `_save_projects(...)` calls, also call `projects_sync.upsert_project_to_db(...)`. After delete calls, soft-delete (`is_active=False`) in DB (don't hard-delete — preserves `runs.project_id` integrity).
- [ ] **Step 5 — commit.** `feat(projects): mirror data/projects.json into DB; ensure Scratch row`.

---

## Chunk 2: Backend service layer

### Task 2.1: Run service — CRUD + state machine

**Files:** Create `backend/app/services/runs.py`, `backend/app/schemas/run.py`.

- [ ] **Step 1 — schemas.** `RunCreate`, `RunOut`, `RunUpdate` (allow `title`, `power_tools_enabled`), `RunStateTransition` (string enum of all states), `RunMessageIn/Out`, `RunPhaseOut`, `RunEventOut` (split into `RunEventSummary` for T2 and `RunEventFull` for T3 — `payload` only in the full variant).
- [ ] **Step 2 — `create_run(project_id, method_id=None, title=None) -> Run`.** Defaults `project_id` to `'scratch'`. Validates project exists + `is_active`. Initial state `'running'` only if method attached or chat started; for an empty/new Run created via "+ new" the initial state is `'awaiting_input'` (per spec — chat gates the Run when idle). Auto-titles from first message (placeholder until first message arrives).
- [ ] **Step 3 — state machine.** Implement `transition(run, new_state)` enforcing the legal transitions in spec §4.2 graph:
  - From `running`: → `awaiting_approval`, `awaiting_input`, `paused`, `completed`, `failed`, `cancelled`.
  - From `awaiting_*`/`paused`: → `running` (resume).
  - From any non-archived: → `archived`.
  - `completed`/`failed`/`cancelled`/`archived` are terminal except `archived` is reachable from any.
  - Raise `InvalidRunStateTransition` on illegal moves.
  - Set `completed_at` on `completed`. Do **not** set a `failed_at` column — derive from latest `error` event per spec §4.2.
- [ ] **Step 4 — `attach_method(run, method_id)`.** Validates `method_id` against registered methods (reuse `pipelines.py`'s method registry). Spawns phases via existing pipeline machinery — calls into `pipelines.py` create-pipeline flow under the hood, then mirrors the resulting phase records into `run_phases`.
- [ ] **Step 5 — `fork_run(source_run, event_id) -> Run`.** Per spec: new top-level Run with `forked_from_event_id`; inherits `project_id` and `method_id`. Asserts source event exists and belongs to `source_run`. Asserts `source_run.power_tools_enabled` is True (per spec §8.1 power-tools gating test).
- [ ] **Step 6 — `list_runs(project_id=None, states=None, limit, cursor)`.** Used by `/now` and the rail. Returns ordered by `updated_at desc`. Supports `active=true` shortcut for non-terminal states.
- [ ] **Step 7 — `get_run_view(run_id)`.** Returns hydrated shape: `run`, `phases`, last N messages, last N events. N defaults: messages 50, events 100. Cursors for paging.
- [ ] **Step 8 — unit-test the service.** Cover one happy-path test inline in `tests/test_run_state_machine.py`. (Full state machine tests come in Chunk 11.)
- [ ] **Step 9 — commit.** `feat(runs): add Run service with state machine and fork`.

### Task 2.2: Event emitter + SSE fan-out

**Files:** Create `backend/app/services/run_events.py`.

- [ ] **Step 1 — `emit(run_id, kind, summary, payload=None, phase_id=None, **metrics)`.** Inserts a `run_events` row. Validates `kind` ∈ the §4.3 list. Fans out to subscribed SSE listeners.
- [ ] **Step 2 — in-process pub/sub.** A `defaultdict[run_id, set[asyncio.Queue]]`. Subscribers register a queue; emitter pushes the serialized event to every queue for that `run_id`. Use the same pattern as today's `pipelines._push` (see `pipelines.py` line 400) so a future worker-process migration only touches this module.
- [ ] **Step 3 — stream helper.** `async def stream(run_id) -> AsyncIterator[str]`: yields `data: <json>\n\n` SSE frames; sends a `: ping` every 25s to keep proxies happy; cleans up on disconnect.
- [ ] **Step 4 — message persistence.** `record_message(run_id, role, content, image_url=None)` writes to `run_messages` AND emits a `model_response` (assistant) or no event (user — implicit from the chat pane; the message itself streams to viewers via a separate `run_message` SSE channel — add a synthetic `run_message` SSE type that is **not** a `RunEvent` row).
- [ ] **Step 5 — commit.** `feat(runs): event emitter and SSE stream`.

### Task 2.3: Legacy pipeline adapter

**Files:** Create `backend/app/services/pipelines_to_runs_adapter.py`; modify `backend/app/routes/pipelines.py`.

- [ ] **Step 1 — mapping table.** Map each pipeline event type emitted by `pipelines._push` to a `RunEvent.kind` per spec §4.3 (`phase_start`, `phase_end`, `agent_start`, `tool_call`, `tool_result`, `model_request`, `model_response`, `approval_gate`, `user_intervention`, `error`). Document each mapping in the file's docstring.
- [ ] **Step 2 — companion-Run creation.** When a pipeline is created via the legacy API, also create a Run (state `running`, `method_id` set, `project_id` from session → project lookup, fallback Scratch) and store the new `run_id` on the pipeline's row (add a column or stash in `metadata` JSON — choose `metadata` to avoid a second migration). The pipeline keeps running through its own state machine; the adapter mirrors events.
- [ ] **Step 3 — wrap `_push`.** Replace direct in-memory broadcast with a call that ALSO invokes `run_events.emit(run_id, kind=mapping[type], summary=..., payload=...)`. Existing `pipelines/{id}/stream` consumers keep working. New consumers use `runs/{id}/stream`.
- [ ] **Step 4 — workbench_sessions adapter.** Same idea for `WorkbenchSession`-only runs: at session start, create a companion Run with `method_id=None`, state `running`. The single agent emits `agent_start` + `tool_call`s + `model_response` events through the adapter.
- [ ] **Step 5 — feature flag.** Gate the adapter behind `app_settings.runs_unified_enabled` (default True; the kill-switch lets us disable adapter writes if backfill misbehaves).
- [ ] **Step 6 — commit.** `feat(runs): mirror legacy pipeline + workbench events into run_events`.

---

## Chunk 3: REST + SSE API

### Task 3.1: Routes module

**Files:** Create `backend/app/routes/runs.py`; modify `backend/app/main.py` to include it.

- [ ] **Step 1 — router scaffolding.** `APIRouter(prefix="/v1/runs", tags=["runs"], dependencies=[Depends(verify_api_key)])`.
- [ ] **Step 2 — endpoints.** Implement all of:
  - `POST /v1/runs` — body `{project_id?, method_id?, title?}` → `RunOut`.
  - `GET /v1/runs` — query: `project_id`, `state`, `active=true`, `limit`, `cursor`. Returns paginated list.
  - `GET /v1/runs/{id}` — hydrated view.
  - `PATCH /v1/runs/{id}` — title, `power_tools_enabled`.
  - `POST /v1/runs/{id}/messages` — body `{role: 'user', content, image_url?}` → persists + emits.
  - `GET /v1/runs/{id}/messages` — paginated.
  - `GET /v1/runs/{id}/events` — paginated; query `?phase_id=`, `?since=<created_at>`.
  - `GET /v1/runs/{id}/events/{event_id}` — full payload (T3).
  - `POST /v1/runs/{id}/attach-method` — body `{method_id}`.
  - `POST /v1/runs/{id}/pause` / `/resume` / `/cancel` / `/archive`.
  - `POST /v1/runs/{id}/approve` (body `{phase_id, action: 'approve'|'skip'|'edit_brief', edit_payload?}`). Proxies into pipelines approve/skip.
  - `POST /v1/runs/{id}/fork` — body `{event_id}` → new `RunOut`. **403** if `power_tools_enabled` is False.
  - `POST /v1/runs/{id}/agents/{agent_id}/pause` and `/kill` — per-agent intervention.
  - `GET /v1/runs/{id}/stream` — SSE (no `verify_api_key` because EventSource can't send headers; reuse the cookie-auth pattern at `pipelines.py:3332` `/{pipeline_id}/stream`).
- [ ] **Step 3 — `POST /v1/runs/new`-flavor convenience.** Skip — spec uses `POST /v1/runs`. The frontend route `/runs/new` page redirects.
- [ ] **Step 4 — wire router in `main.py`.** `app.include_router(runs_router)` alongside `pipelines_router`.
- [ ] **Step 5 — manual smoke.** `curl POST /v1/runs` → expect 201 with Scratch project, state `awaiting_input`. `curl GET /v1/runs?active=true` → list contains it.
- [ ] **Step 6 — commit.** `feat(api): /v1/runs CRUD, lifecycle, and SSE stream`.

### Task 3.2: OpenAPI / response shapes

- [ ] **Step 1 — annotate.** Every endpoint returns a typed Pydantic model. The OpenAPI doc at `/docs` lists every shape. No `dict[str, Any]` returns.
- [ ] **Step 2 — error responses.** Use the existing error response model pattern from `chat.py` for 4xx/5xx. `403` for power-tools-gated paths includes `{detail: 'Power tools disabled for this Run'}`.
- [ ] **Step 3 — commit.** `chore(api): tighten run response schemas`.

---

## Chunk 4: Method attachment + slash command

### Task 4.1: `/method <name>` slash command

**Files:** modify `backend/app/services/runs.py` chat handling path; verify in `frontend/src/lib/runs/api.ts` (Chunk 5).

- [ ] **Step 1 — parser.** When a user message starts with `/method `, the message handler in `runs.py` does NOT persist the slash command verbatim. It calls `attach_method(run, method_id)`, emits a synthetic `user_intervention` event with `summary="👤 attached method: <id>"`, and returns 200.
- [ ] **Step 2 — supported methods.** Resolve `method_id` against `pipelines.py` registered methods + CustomMethod table (existing). Unknown id → 400.
- [ ] **Step 3 — empty Run → method-driven Run transition.** No new state needed; phases simply appear. UI re-renders phase strip.
- [ ] **Step 4 — `/fork` slash command.** Only valid when invoked from inside an expanded event drawer; the frontend sends `POST /v1/runs/:id/fork {event_id}` (Chunk 9) — backend stays the same. Document this in the docstring.
- [ ] **Step 5 — commit.** `feat(runs): support /method slash command for in-run method attachment`.

---

## Chunk 5: Frontend data layer

### Task 5.1: Types + REST client

**Files:** Create `frontend/src/lib/runs/types.ts`, `frontend/src/lib/runs/api.ts`.

- [ ] **Step 1 — `types.ts`.** TypeScript mirrors of the Pydantic shapes: `Run`, `RunPhase`, `RunMessage`, `RunEventSummary`, `RunEventFull`, `RunState` literal union, `RunEventKind` literal union (must stay in sync with backend; lint rule TBD).
- [ ] **Step 2 — `api.ts`.** Functions: `createRun`, `listRuns`, `getRun`, `patchRun`, `postMessage`, `listMessages`, `listEvents`, `getEvent`, `attachMethod`, `pause/resume/cancel/archive`, `approve`, `forkRun`, `pauseAgent`, `killAgent`. All use `API_BASE` + `AUTH_HEADERS` from `@/lib/config` (the existing pattern in `NowLive.tsx`).
- [ ] **Step 3 — commit.** `feat(frontend): runs API client and types`.

### Task 5.2: SSE client with reconnect

**Files:** Create `frontend/src/lib/runs/runStream.ts`, `frontend/src/lib/runs/eventContract.ts`.

- [ ] **Step 1 — `runStream.ts`.** Wraps `EventSource('/v1/runs/:id/stream')`. Exposes `subscribe(runId, handler)` returning unsubscribe. Implements exponential backoff (1s → 2 → 4 → 8 → 30 max) on reconnect. Emits a `reconnecting` signal handler can render.
- [ ] **Step 2 — `eventContract.ts`.** Normalizer: validates incoming SSE frame shape matches `RunEventSummary` schema; warns on unknown `kind` (forward-compat). Used by every consumer.
- [ ] **Step 3 — extend existing tests.** If `frontend/tests/eventContract.test.ts` exists (spec §8.2 references it), append cases for the new kinds. If it doesn't exist, create `frontend/tests/runEventContract.test.ts` (Chunk 11).
- [ ] **Step 4 — commit.** `feat(frontend): SSE client and event normalizer for runs`.

### Task 5.3: React hooks

**Files:** Create `frontend/src/hooks/useRun.ts`, `useRuns.ts`, `useRunEvents.ts`.

- [ ] **Step 1 — `useRuns({active?, projectId?})`.** Initial fetch + auto-refresh every 10s; merges in SSE deltas pushed via a single multiplexed channel (Chunk 7 will optimize; for now one EventSource per Run subscribed by viewers — the rail polls).
- [ ] **Step 2 — `useRun(runId)`.** Initial fetch of hydrated view; subscribes to SSE for that Run; reducer updates `messages`, `events`, `phases`, `state` deltas.
- [ ] **Step 3 — `useRunEvents(runId, {phaseId?})`.** Paginated event timeline source; appends from SSE; dedup by `event.id`.
- [ ] **Step 4 — commit.** `feat(frontend): useRun, useRuns, useRunEvents hooks`.

---

## Chunk 6: `/now` grid

### Task 6.1: NowGrid component

**Files:** Create `frontend/src/components/now/NowGrid.tsx`; create `frontend/src/app/(main)/now/page.tsx`.

- [ ] **Step 1 — page.** `/now` server-component shell loads NowGrid inside the existing `(main)` layout.
- [ ] **Step 2 — NowGrid.** Top filter chips (Active / Awaiting / Recent / All), project filter, search box. Body: grid of Run cards grouped by `project.name`, project name sticky header, 3-col responsive collapse. Scratch project is always rendered (with the "restricted" badge from `project.sandbox_mode`).
- [ ] **Step 3 — Card content.** Per spec §5.2: status badge, title, method chip (or "no method"), current phase (if any), last activity tail (last event's `summary`), elapsed.
- [ ] **Step 4 — Inline actions.** `Approve`/`Skip` when `awaiting_approval`, `Resume` when `paused`, `Acknowledge` when `failed`. Optimistic UI: action locks the card visually, calls API, on error toasts + reverts.
- [ ] **Step 5 — Recent section.** Per project, collapsible. Renders completed/cancelled. Archived hidden.
- [ ] **Step 6 — Data source.** `useRuns({})` — fetches all non-archived. Rail (Chunk 7) reuses the same hook.
- [ ] **Step 7 — Replace mock route note.** Leave `/mocks/now` alone (it's the static comparison reference). Mark `NowMocks.tsx` with a top-of-file comment: "// PRESERVED — see docs/superpowers/specs/2026-05-12-the-run-design.md §10."
- [ ] **Step 8 — Manual smoke.** Visit `/now`. Cards visible. Approval action works.
- [ ] **Step 9 — commit.** `feat(now): live /now grid backed by /v1/runs`.

---

## Chunk 7: `/runs/:id` viewer — adaptive 3-pane

### Task 7.1: Shell + breakpoint

**Files:** Create `frontend/src/lib/runs/breakpoints.ts`, `frontend/src/components/run/RunViewer.tsx`, `frontend/src/app/(main)/runs/[id]/page.tsx`.

- [ ] **Step 1 — `breakpoints.ts`.** Export `useIsWide()` hook returning `width >= 1400`. Export `RUN_VIEWER_GRID_WIDE` and `RUN_VIEWER_GRID_NARROW` constants (CSS `grid-template-columns` strings exactly per spec §5.3 note: `'130px minmax(360px, 1.1fr) minmax(420px, 1.2fr) minmax(260px, 0.9fr)'` wide; narrow drops the live-agents column).
- [ ] **Step 2 — RunViewer shell.** Uses `useRun(runId)` and renders RunTopStrip + four panes via the wide grid template; below 1400 switches to a 3-col (no live-agents column, replaced with the "Live (N)" button in the top strip that opens a slide-over); below 900 the event timeline collapses behind a tab.
- [ ] **Step 3 — Loading + error boundary.** Error boundary scoped to the viewer per spec §7.2 — rail keeps working if viewer crashes.
- [ ] **Step 4 — page.** `[id]/page.tsx` renders `<RunViewer runId={params.id} />`.
- [ ] **Step 5 — commit.** `feat(runs): adaptive 3-pane viewer shell with 1400px breakpoint`.

### Task 7.2: RunTopStrip

**Files:** Create `frontend/src/components/run/RunTopStrip.tsx`.

- [ ] **Step 1 — Layout.** Title (inline editable, saves on blur via `patchRun`), project name (click → `/projects/:id`), method chip (click → method picker modal — placeholder until Chunk 4 picker UX is built; for now opens a dropdown that posts `/attach-method`).
- [ ] **Step 2 — Phase strip.** Only when `run.method_id`. Renders one chip per phase color-coded by `status`. Click → emits a custom DOM event the event timeline listens to and scrolls to that phase's first event.
- [ ] **Step 3 — Lifecycle buttons.** State-aware: `Pause` shown when state in {`running`}; `Resume` when in {`paused`, `awaiting_input`, `awaiting_approval`}; `Cancel` always shown until terminal. Disabled per state.
- [ ] **Step 4 — Power tools toggle.** Gear icon menu containing the `power_tools_enabled` switch. Persisted via `patchRun`.
- [ ] **Step 5 — commit.** `feat(runs): RunTopStrip with title, phase chips, lifecycle controls`.

### Task 7.3: RunRail (left 130px)

**Files:** Create `frontend/src/components/run/RunRail.tsx`.

- [ ] **Step 1 — Active list.** `useRuns({active: true})`; ordered by `updated_at desc`. Each entry: status icon + truncated title. Current Run highlighted via the URL.
- [ ] **Step 2 — In-place swap.** Click another Run: replace `[id]` segment via `router.replace` (client) — no full page reload (Next.js handles this automatically with the App Router; document the expectation in a code comment).
- [ ] **Step 3 — Recent (collapsed).** Last 5 completed Runs, click expands.
- [ ] **Step 4 — Virtualization.** If active count > 8, render only first 8 + a scroll affordance. Use a lightweight CSS `overflow-y: auto` container with `max-height` rather than introducing a virtualization library.
- [ ] **Step 5 — Reconnect badge.** Subscribe to `runStream` reconnecting signal for the current Run; show "Reconnecting…" in the rail header during retries (per spec §7.2).
- [ ] **Step 6 — commit.** `feat(runs): RunRail with active list, recent section, virtualization`.

### Task 7.4: RunChatPane

**Files:** Create `frontend/src/components/run/RunChatPane.tsx`.

- [ ] **Step 1 — Borrow from `/chat`.** Reuse the message rendering + input affordances from `frontend/src/app/chat/` (slash commands, image-gen intent, persona/model dropdowns). Encapsulate the parts that are useful into the new component — do NOT delete the legacy `/chat` route yet (Chunk 12).
- [ ] **Step 2 — Data source.** `useRun(runId).messages`.
- [ ] **Step 3 — Slash commands recognized.** `/method <id>`, `/onboard`, `/image`, `/pin`, `/export`, `/model <id>`, `/fork` (only inside expanded event drawer — Chunk 9). Unknown slashes get a friendly error inline.
- [ ] **Step 4 — Model dropdown stale-state guard.** Use the existing `validateModelOverride` predicate from `frontend/src/lib/modelRuntimeReadiness.ts` (per spec §7.3). Show "Model unavailable — refresh keys" when stale.
- [ ] **Step 5 — Input focus.** Auto-focus when `run.state === 'awaiting_input'`.
- [ ] **Step 6 — commit.** `feat(runs): RunChatPane with slash commands and model readiness gating`.

### Task 7.5: RunEventTimeline (T2 + T3)

**Files:** Create `frontend/src/components/run/RunEventTimeline.tsx`; also create `frontend/src/app/(main)/runs/[id]/events/[eventId]/page.tsx` (deep-link).

- [ ] **Step 1 — T2 rendering.** One row per event from `useRunEvents`. Display: timestamp delta, icon by `kind`, `summary` string. Nest `tool_call`/`tool_result` under their parent `agent_start` via 2-space indentation.
- [ ] **Step 2 — T3 drawer.** Click event → inline expand → fetch `getEvent(eventId)` for full payload. Shows: full prompt (collapsible), full response (collapsible), tool I/O (if present), cost/tokens.
- [ ] **Step 3 — Always-on actions.** Copy prompt, Copy response buttons inside the drawer.
- [ ] **Step 4 — Power-tool actions.** `Edit & retry`, `Swap model`, `Fork from here` buttons — rendered only when `run.power_tools_enabled`. Wired in Chunk 9.
- [ ] **Step 5 — Phase anchor scroll.** Listen for the custom DOM event from RunTopStrip; smooth-scroll to the first event with matching `phase_id`.
- [ ] **Step 6 — Deep-link page.** `/runs/:id/events/:eventId` renders RunViewer with that event drawer initially open.
- [ ] **Step 7 — commit.** `feat(runs): RunEventTimeline with T2 default and T3 drawer`.

### Task 7.6: RunLiveAgents

**Files:** Create `frontend/src/components/run/RunLiveAgents.tsx`, `frontend/src/components/run/RunApprovalBanner.tsx`.

- [ ] **Step 1 — Derive active agents.** From recent events, an agent is "live" when its latest event is `agent_start`, `tool_call`, or `tool_result` (any tool event mid-step) with no `phase_end` or `error` after it in the current phase. Compute on the client from `useRunEvents`.
- [ ] **Step 2 — Card.** Agent role, model id, current tool (last `tool_call.summary`), elapsed time since `agent_start`. Buttons: `⏸` (call `pauseAgent`), `✕` (call `killAgent`).
- [ ] **Step 3 — Approval banner.** When `run.state === 'awaiting_approval'`, render a sticky banner at top of the live-agents pane with the gate's brief (read the latest `approval_gate` event's `payload`), Approve / Skip / Edit-brief actions. Edit-brief opens a small textarea + retry. Power-tool gating doesn't apply to gate actions (they're I2-default).
- [ ] **Step 4 — Narrow layout slide-over.** Below 1400px the pane lives in a slide-over launched by the Top Strip's "Live (N)" button. Implement using a portal + CSS transform.
- [ ] **Step 5 — commit.** `feat(runs): RunLiveAgents pane and approval banner`.

---

## Chunk 8: Invocation flows + projects integration

### Task 8.1: `/runs/new` invocation

**Files:** Create `frontend/src/app/(main)/runs/new/page.tsx`.

- [ ] **Step 1 — Page logic.** Server-side: parse `?project=<id>&method=<id>` (both optional). Calls `POST /v1/runs` then redirects to `/runs/:id`.
- [ ] **Step 2 — `/runs/index` redirect.** Modify `frontend/src/app/(main)/runs/page.tsx` to redirect to `/now`. (Existing page becomes a thin shim; preserve the old file's source by overwriting — git history retains it.)
- [ ] **Step 3 — `+ new Run` button on `/now`.** Wire to `/runs/new`.
- [ ] **Step 4 — commit.** `feat(runs): /runs/new invocation page and /runs index → /now redirect`.

### Task 8.2: Project page Run list note

> Per spec §9.3 this is deferred — leave a TODO comment in `frontend/src/app/(main)/projects/.../page.tsx` (find existing detail page) pointing at this section. No code changes here.

- [ ] **Step 1 — Drop TODO comment** in the project detail page where the legacy "Pipelines / Sessions" list lives.
- [ ] **Step 2 — commit.** `chore(projects): TODO marker for Run list integration (Doc 2)`.

---

## Chunk 9: Power tools (I3)

### Task 9.1: Backend power-tool actions

**Files:** modify `backend/app/services/runs.py`, `backend/app/routes/runs.py`.

- [ ] **Step 1 — Edit & retry.** Endpoint `POST /v1/runs/{id}/events/{eventId}/edit-retry` with body `{new_prompt}`. Validates `power_tools_enabled`. Creates a `user_intervention` event, then re-invokes the agent/phase that produced the original event with the new prompt. Reuses the pipeline retry path under the hood (existing `pipelines.py` has phase retry plumbing at line 2794).
- [ ] **Step 2 — Swap model.** Endpoint `POST /v1/runs/{id}/agents/{agentId}/swap-model` body `{model_id}`. Validates power tools + `modelRuntimeReadiness` server-side via existing model_validate path. Updates the phase's `model_id` and emits `user_intervention`.
- [ ] **Step 3 — Fork** already exists from Chunk 3 — verify the 403-when-disabled guard.
- [ ] **Step 4 — Tests.** Add to `tests/test_runs_power_tools_gate.py`: each endpoint returns 403 when `power_tools_enabled` is false.
- [ ] **Step 5 — commit.** `feat(runs): power tools (edit&retry, swap model, fork) with gating`.

### Task 9.2: Frontend wiring

**Files:** modify `RunEventTimeline.tsx`, create `frontend/src/components/run/PowerToolsToggle.tsx` (referenced from `RunTopStrip` in Chunk 7).

- [ ] **Step 1 — Drawer buttons.** Wire `Edit & retry` (opens textarea), `Swap model` (opens model picker filtered by `validateModelOverride`), `Fork from here` (calls `forkRun`, navigates to new Run).
- [ ] **Step 2 — Persistence.** PowerToolsToggle calls `patchRun({power_tools_enabled})`. Per-Run, persisted on the server (no localStorage).
- [ ] **Step 3 — commit.** `feat(runs): power tool actions in the event drawer`.

---

## Chunk 10: Error handling polish

### Task 10.1: Error event rendering

**Files:** modify `RunEventTimeline.tsx`.

- [ ] **Step 1 — `error` kind.** Renders with red marker. T3 drawer shows: error class, traceback, and IF `payload.recovery_candidates` is present, a list of "Retry with X" buttons calling `editRetry` with the candidate's prompt. **Render rule (per spec §7.1):** the recovery section is hidden when the field is absent — UI must NOT block waiting for D2 to land. Show "Manual retry" + raw error instead.
- [ ] **Step 2 — `failed` state visible.** Failed Run card on `/now` shows the last error's summary inline. Acknowledge button transitions state to `archived` (or to a new ack flag — pick `archived` to keep state count tight).
- [ ] **Step 3 — commit.** `feat(runs): render error events with optional recovery candidates`.

### Task 10.2: Optimistic action revert + toasts

**Files:** modify NowGrid, RunApprovalBanner, RunTopStrip.

- [ ] **Step 1 — Common pattern.** Each action button uses a tiny `useOptimisticAction(apiCall)` helper that flips local UI state immediately, awaits the API, reverts on error, and shows a toast via the existing `ToastProvider`.
- [ ] **Step 2 — commit.** `feat(runs): optimistic actions with revert on error`.

---

## Chunk 11: Tests

### Task 11.1: Backend tests

**Files:** Create the five files in `backend/tests/` listed in the file map.

- [ ] **Step 1 — `test_run_state_machine.py`.** One test per legal transition; one test per illegal transition (`raises InvalidRunStateTransition`).
- [ ] **Step 2 — `test_run_event_contract.py`.** For every `kind` in the §4.3 table, emit one and assert the persisted row has the documented payload keys. Use a parametrized test.
- [ ] **Step 3 — `test_run_fork.py`.** Fork inherits `project_id` and `method_id`; `forked_from_event_id` set; parent event must belong to source Run; 403 when source's `power_tools_enabled` is false.
- [ ] **Step 4 — `test_scratch_invariant.py`.** After fresh migration, `projects` table contains `id='scratch'` with `is_system=True`. Run `ensure_scratch_project()` twice — idempotent.
- [ ] **Step 5 — `test_runs_power_tools_gate.py`.** Per Task 9.1 step 4.
- [ ] **Step 6 — Run suite.** `pytest backend/tests/test_run_*.py test_scratch_invariant.py` → all green.
- [ ] **Step 7 — commit.** `test(runs): backend unit tests for state machine, events, fork, scratch, gating`.

### Task 11.2: Frontend tests

**Files:** Create `frontend/tests/runViewerBreakpoint.test.tsx`, `frontend/tests/runEventContract.test.ts`.

- [ ] **Step 1 — breakpoint.** Render `RunViewer` at width 1399 → narrow grid; at 1400 → wide grid. Use the test runner already configured in `frontend/package.json` (check `npm test` script first; if Jest, use jsdom + a width mock).
- [ ] **Step 2 — event contract.** For every `RunEventKind` literal, an SSE-shaped fixture parses cleanly. Unknown kind logs a warning, does not throw.
- [ ] **Step 3 — Run.** `npm test` → green.
- [ ] **Step 4 — commit.** `test(runs): frontend breakpoint and event contract tests`.

### Task 11.3: Manual verification checklist (spec §8.3)

- [ ] **Step 1 — Concurrent Runs.** Spin up 3 Runs (one chat-only, one BMAD, one GSD). Rail + grid show all three. Switch between them — instant, no full reload.
- [ ] **Step 2 — Chat isolation.** Messages in Run A do not appear in Run B.
- [ ] **Step 3 — Fork.** Enable power tools on Run A, fork from an event. New Run appears in rail with `forked_from_event_id` set (verify via `GET /v1/runs/:id`).
- [ ] **Step 4 — Approval gate.** Method-driven Run reaches a gate. Card on `/now` shows Approve. Viewer banner shows Approve/Skip/Edit-brief. Approve advances state.
- [ ] **Step 5 — Adaptive collapse.** Resize browser across 1399 ↔ 1400 boundary. Live-agents pane appears/collapses, live (N) button toggles correctly.
- [ ] **Step 6 — Stale model.** Deactivate an in-use model mid-run; live-agents card shows Swap model prompt; chat pane's model dropdown hides the deactivated model.
- [ ] **Step 7 — SSE reconnect.** Kill the backend briefly; rail shows "Reconnecting…"; restart backend; stream resumes without page reload.
- [ ] **Step 8 — Document results.** Append a "Verification log" section to this plan with date + outcomes.
- [ ] **Step 9 — commit.** `docs(runs): manual verification log`.

---

## Chunk 12: Legacy URL handling (placeholder for Doc 2)

> **Read this first:** This chunk is intentionally minimal. The spec defers final URL migration to Doc 2 (§9.2). If Doc 2 lands before this chunk, **replace these steps with Doc 2's plan and skip the fallback.** If Doc 2 has not landed, ship the fallback below so the new viewer works without breaking deep links.

### Task 12.1: Soft redirects (fallback only)

**Files:** modify `frontend/src/app/chat/page.tsx`, `frontend/src/app/(main)/workbench/[id]/page.tsx`, `frontend/src/app/(main)/agents/[id]/...` (locate via search).

- [ ] **Step 1 — Detect companion Run.** Each legacy page calls a new helper `GET /v1/runs/by-legacy?type=chat|workbench|agent&id=<legacyId>` returning the companion `run_id` created by the adapter (Chunk 2.3 Task 2.3 Step 2/4).
- [ ] **Step 2 — Add a "Open in new Run viewer" banner.** Sticky banner with a link to `/runs/:id`. Do NOT auto-redirect — Doc 2 owns the redirect timing decision.
- [ ] **Step 3 — Backend helper.** `GET /v1/runs/by-legacy` queries `runs.metadata` for `legacy_pipeline_id` / `legacy_session_id` / `legacy_chat_conversation_id`.
- [ ] **Step 4 — commit.** `feat(runs): soft cross-link from legacy surfaces to new viewer (Doc 2 placeholder)`.

---

## Chunk 13: Docs + handoff

### Task 13.1: Update canonical docs

**Files:** modify `docs/SESSION_HANDOFF.md`, `README.md`.

- [ ] **Step 1 — SESSION_HANDOFF.md.** Add a Run-shipped entry to the roadmap section: mark UI consolidation step. Note that Doc 2 (sidebar IA) is the next gate.
- [ ] **Step 2 — README.md.** Add a "The Run" subsection in the Features list with a link to `/now`.
- [ ] **Step 3 — Spec back-link.** In the spec doc, add a line at the very top under Status: "Implementation plan: `docs/superpowers/plans/2026-05-12-the-run-implementation.md`".
- [ ] **Step 4 — commit.** `docs(runs): handoff updates and spec back-link`.

### Task 13.2: Push

- [ ] **Step 1 — Verify clean state.** `git status` clean. All tests green.
- [ ] **Step 2 — Push.** Push the feature branch (or per repo convention, the working branch) to origin. Per user pref: changes get pushed to GitHub after completing + validating.
- [ ] **Step 3 — Open PR / mark ready** — per repo conventions.

---

## Risks & decisions to confirm during execution

| # | Risk / question | Resolution path |
|---|---|---|
| R1 | `projects.id` typing. Spec §4.1 shows `id = 'scratch'` (string) but `runs.project_id uuid FK`. | **Resolved in Task 1.1**: PK is `String(64)`; `runs.project_id` is `String(64)` not UUID. Spec §4.1 narrative inconsistency noted. |
| R2 | Existing `workbench_sessions` + `workbench_pipelines` duplicate the Run concept. | Keep both; adapter (Task 2.3) mirrors events. Hard deprecation lives in Doc 2 + a future cleanup phase. |
| R3 | Polling rail vs. multiplexed SSE. | Initial impl polls + per-Run SSE for the viewer. If perf budget (spec §9.7) shows >50 concurrent Runs causing lag, revisit with a single user-scoped multiplex channel. |
| R4 | `data/projects.json` as source-of-truth. | Keep file-backed for now; DB is mirror. Future phase can flip. Don't block this plan on it. |
| R5 | Power-tool retry mutates audit trail. | All retries emit a `user_intervention` event. Original events stay. Verify in `test_run_event_contract.py`. |
| R6 | Auth on `/v1/runs/:id/stream` (EventSource can't send headers). | Reuse the same cookie/auth pattern used by `/v1/pipelines/{id}/stream` (see `pipelines.py` line 3332). |
| R7 | Adapter creates duplicate events when both legacy + new code emit. | Adapter is the **only** emitter for legacy paths. Direct `run_events.emit` calls live only in new-code paths (`runs.py`, message handler). Verified by code review of `pipelines.py` after Task 2.3. |

---

## Glossary alignment

This plan inherits all terms from the spec verbatim. When in doubt, the spec is authoritative; deviate only by amending the spec with a tracked decision.
