# The Run — Implementation Progress

> **Plan:** [2026-05-12-the-run-implementation.md](./2026-05-12-the-run-implementation.md)
> **Spec:** [2026-05-12-the-run-design.md](../specs/2026-05-12-the-run-design.md)
> **Last updated:** 2026-05-13

---

## Summary

Chunks 1–10 of the 14-chunk implementation plan are complete or near-complete.
The Run is now a first-class entity with a full backend (DB, service layer, API)
and a mostly-complete frontend (data layer, live grid, 3-pane viewer, power tools,
error rendering). TypeScript compiles clean.

---

## Chunk Status

| Chunk | Description | Status | Notes |
|-------|------------|--------|-------|
| 1 | DB foundations (migration 007, models) | **Done** | Tables: projects, runs, run_phases, run_messages, run_events. Scratch seed. |
| 2 | Service layer | **Done** | State machine, fork, CRUD, SSE fan-out, event emitter. |
| 3 | REST API (17 endpoints) | **Done** | Full CRUD, lifecycle, messages, events, approval, fork, SSE stream. |
| 4 | Method attachment + slash commands | **Done** | Built-in + CustomMethod validation, phase creation, `/method` command. |
| 5 | Frontend data layer | **Done** | TypeScript types, REST client, SSE stream, hooks (useRun, useRuns, useRunEvents). |
| 6 | `/now` grid | **Done** | NowGrid with filter chips (Active/Awaiting/Recent/All), project grouping, search, inline actions (Approve/Skip/Resume/Acknowledge). |
| 7 | `/runs/:id` adaptive 3-pane viewer | **Done** | RunViewer (wide/narrow/mobile layouts), RunTopStrip (title edit, phase chips, lifecycle buttons), RunRail (active list + recent), RunChatPane (messages + input), RunEventTimeline (T2 list + T3 drawer), RunLiveAgents + RunApprovalBanner. |
| 8 | Invocation flows | **Done** | `/runs/new` (POST + redirect), `/runs` index → `/now` redirect, `+ New Run` button, TODO marker on project detail page. |
| 9 | Power tools | **Done** | Backend: `POST /edit-retry`, `POST /swap-model` with 403 gating. Frontend: PowerToolsToggle in top strip, drawer buttons wired, `editRetry`/`swapModel` API functions. |
| 10 | Error handling polish | **~90%** | Error event rendering with recovery candidates done in RunEventTimeline. `useOptimisticAction` hook created. Minor: not yet wired into all action sites (NowGrid uses its own inline pattern which works). |
| 11 | Tests | **Not started** | Backend: test_run_state_machine, test_run_event_contract, test_run_fork, test_scratch_invariant, test_runs_power_tools_gate. Frontend: breakpoint test, event contract test. |
| 12 | Legacy redirects (Doc 2 §6.1) | **Not started** | `/chat/:id` → `/runs/:id`, sidebar IA. |
| 13 | Legacy adapter wiring | **Not started** | Hook `pipelines_to_runs_adapter` into `pipelines.py._push()`. `/by-legacy` endpoint stub exists. |
| 14 | Post-deprecation cleanup | **Not started** | Doc 2 §6.3, 30 days after Chunk 12. |

---

## Files Created This Session (Chunks 6–10)

### Frontend — Components
- `frontend/src/components/now/NowGrid.tsx` — Live `/now` grid with filter chips, project grouping, inline actions
- `frontend/src/components/run/RunViewer.tsx` — Adaptive 3-pane viewer shell (wide/narrow/mobile)
- `frontend/src/components/run/RunTopStrip.tsx` — Title edit, phase chips, lifecycle buttons, power tools toggle
- `frontend/src/components/run/RunRail.tsx` — Left 130px rail with active + recent runs
- `frontend/src/components/run/RunChatPane.tsx` — Message list + input with slash command support
- `frontend/src/components/run/RunEventTimeline.tsx` — T2 summary list + T3 detail drawer with power tool buttons
- `frontend/src/components/run/RunLiveAgents.tsx` — Live agent cards derived from events
- `frontend/src/components/run/RunApprovalBanner.tsx` — Approval gate UI (approve/skip/edit brief)
- `frontend/src/components/run/PowerToolsToggle.tsx` — Per-Run power tools toggle button

### Frontend — Pages
- `frontend/src/app/(main)/now/page.tsx` — `/now` server-component shell
- `frontend/src/app/(main)/runs/[id]/page.tsx` — `/runs/:id` viewer page
- `frontend/src/app/(main)/runs/[id]/events/[eventId]/page.tsx` — Event deep-link
- `frontend/src/app/(main)/runs/new/page.tsx` — Create run + redirect
- `frontend/src/app/(main)/runs/page.tsx` — **Replaced** with redirect to `/now`

### Frontend — Hooks & Lib
- `frontend/src/hooks/useOptimisticAction.ts` — Optimistic action helper with toast on error
- `frontend/src/lib/runs/breakpoints.ts` — **Updated** with `useIsWide`, `useViewerLayout`, grid template constants

### Frontend — API
- `frontend/src/lib/runs/api.ts` — **Updated** with `editRetry()`, `swapModel()` functions

### Backend
- `backend/app/services/runs.py` — **Updated** with `edit_retry()`, `swap_model()`, `_require_power_tools()`
- `backend/app/routes/runs.py` — **Updated** with `POST /edit-retry`, `POST /swap-model` endpoints
- `backend/app/schemas/run.py` — **Updated** with `RunEditRetry`, `RunSwapModel` schemas

### Other
- `frontend/src/app/(main)/projects/[id]/page.tsx` — **Updated** with TODO marker for Chunk 12

---

## Known Gaps / Next Session Pickup

1. **Chunk 10 minor**: `useOptimisticAction` hook exists but NowGrid uses its own inline optimistic pattern (works fine, just not unified). Low priority.
2. **Chunk 11 (Tests)**: All backend and frontend tests are unwritten. The plan specifies 5 backend test files and 2 frontend test files.
3. **Chunk 12 (Legacy redirects)**: `/chat/:id` → `/runs/:id` redirect, sidebar IA from Doc 2 §6.1.
4. **Chunk 13 (Legacy adapter wiring)**: `pipelines_to_runs_adapter.py` exists but is not wired into `pipelines.py._push()`. The `/by-legacy` stub returns placeholder.
5. **Projects route write-through**: `projects_sync.py` syncs from JSON → DB on startup, but no write-through route exists yet for creating projects via API.
6. **Navigation update**: The sidebar `NowLauncher` still uses legacy session/pipeline fetching. It should be updated to use the Run API (deferred to Chunk 12 sidebar IA work).

---

## Architecture Quick Reference

- **State machine**: `awaiting_input → running → awaiting_approval/paused/completed/failed/cancelled → archived`
- **Breakpoints**: Wide ≥ 1400px (4-pane), Narrow ≥ 900px (3-pane), Mobile < 900px (tabbed)
- **Grid templates**:
  - Wide: `130px minmax(360px, 1.1fr) minmax(420px, 1.2fr) minmax(260px, 0.9fr)`
  - Narrow: `130px minmax(360px, 1.1fr) minmax(420px, 1.2fr)`
- **SSE**: No-auth EventSource at `GET /v1/runs/{id}/stream`, exponential backoff 1s → 30s
- **Power tools**: Gated per-Run via `power_tools_enabled` boolean, 403 when disabled
- **DB**: SQLite at `C:\Users\chris\DevForgeAI\model_mesh\data\devforgeai.db`
- **API key**: `modelmesh_local_dev_key` (Bearer auth)
