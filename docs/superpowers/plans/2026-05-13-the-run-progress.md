# The Run — Implementation Progress

> **Plan:** [2026-05-12-the-run-implementation.md](./2026-05-12-the-run-implementation.md)
> **Spec:** [2026-05-12-the-run-design.md](../specs/2026-05-12-the-run-design.md)
> **Last updated:** 2026-05-13

---

## Summary

Chunks 1–13 of the 14-chunk implementation plan are complete.
The Run is a first-class entity with a full backend (DB, service layer, API,
228 passing tests), a complete frontend (data layer, live grid, 3-pane viewer,
power tools, error rendering, 29 passing contract tests), sidebar IA consolidated
per Doc 2, and all legacy URLs redirected. TypeScript compiles clean.

Chunk 14 (Phase B cleanup — delete legacy route files, move to next.config.js
rewrites) is deferred 30 days per plan.

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
| 10 | Error handling polish | **Done** | Error event rendering with recovery candidates done in RunEventTimeline. `useOptimisticAction` hook created. NowGrid uses its own inline optimistic pattern. |
| 11 | Tests | **Done** | Backend: 84 Run-specific tests (state machine, event contract, fork, scratch invariant, power tools gate). Frontend: 29 contract tests (event normalization, kind recognition, breakpoint logic). 228 total backend tests passing. |
| 12 | Legacy redirects (Doc 2 §6.1) | **Done** | Sidebar IA consolidated (WORK/BUILD/MANAGE, Chat action button, Now badge). 9 legacy redirect shims. `GET /v1/runs/by-legacy` companion lookup. `RedirectedFromBanner`. Agent "Start Run" button. Methods `?launch=` support. NowGrid `?filter=method` / `?type=chat|session` filter chips. Extension audit clean. |
| 13 | Docs handoff | **Done** | SESSION_HANDOFF.md, progress doc, spec back-link updated. |
| 14 | Post-deprecation cleanup | **Deferred** | Doc 2 §6.3 — delete legacy route files, move to next.config.js rewrites. Scheduled 30 days after Chunk 12 ships (earliest 2026-06-12). |

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

## Known Gaps / Future Work

1. **Chunk 14 (Phase B cleanup)**: Deferred 30 days. Delete legacy route files, move redirects to next.config.js rewrites. Earliest start: 2026-06-12.
2. **Projects route write-through**: `projects_sync.py` syncs from JSON → DB on startup, but no write-through route exists yet for creating projects via API.
3. **Legacy pipelines_to_runs_adapter**: `get_or_create_companion_run()` exists and works for the by-legacy endpoint, but the legacy pipeline event loop doesn't auto-push events into Run events yet. This means companion Runs created from legacy pipelines start empty — they link but don't replay.
4. **NowLauncher**: The old `NowLauncher` component (`frontend/src/components/now/NowLive.tsx`) and `ActiveRunsIndicator` are no longer mounted in the sidebar but still exist as files. Phase B can delete them.
5. **`useOptimisticAction` unification**: Hook exists but NowGrid uses its own inline optimistic pattern (works fine, just not unified). Low priority.

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
