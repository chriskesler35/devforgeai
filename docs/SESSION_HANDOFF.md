# DevForgeAI — Session Handoff (Live)

**Last updated:** 2026-05-14
**Active branch:** main
**Backend:** `:19001` (launcher startup and status verified)
**Frontend:** `:3001`
**Python:** repo venv `.\.venv`, backend launcher venv `backend\venv`
**DB:** local SQLite DB under `data\`

> Keep this file updated as work progresses. It is the canonical resume point if context is lost.

---

## North-Star Goal (user's words)

1. **Clean up the interface** — too many paths to the same info, not enough visibility into what agents are actually doing.
2. **Unify model routing** — providers/models that work in chat must also work agentically. End the "works in chat, fails agentically" divergence.

Current gap pack: see `docs/GAP_CLOSURE_LOG.md` for the May 2026 pull/review closure log.

User accepted roadmap: **F → D1 → D2 → M2 → implement.**

---

## Roadmap Status

| Step | Description | Status |
|------|-------------|--------|
| F | Fix bleeding bugs (NameErrors, validation-gate divergence) | ✅ Complete |
| D1 | Audit doc: unified `resolve_model_for_runtime` resolver spec (no code) | ✅ Complete — see `docs/D1_UNIFIED_RUNTIME_RESOLVER_AUDIT.md` |
| D2 | Phase plan via `/gsd-plan-phase` for resolver implementation | ✅ Complete — all 6 tasks shipped (resolver + chat/workbench/pipeline integrations + validation feedback + regression suite) |
| M2 | Provider-state card mock (extend `frontend/src/components/now/NowMocks.tsx`) | ✅ Complete (static mock implemented) |
| Implement | Build unified resolver per D2 plan | ✅ Complete — `backend/app/services/runtime_model_resolver.py` (1233 LOC) is wired into chat, workbench, pipelines. Verification (2026-05-13): `pytest tests/test_runtime_model_resolver.py tests/test_workbench_runtime_resolution.py tests/test_pipeline_runtime_failover.py tests/test_codex_oauth_connectivity.py` → **17 passed**. |
| UI | The Run (Doc 1 + Doc 2) — polymorphic work entity + sidebar IA | ✅ **Complete** — Chunks 1-13 shipped. 228 backend tests, 29 frontend contract tests. Phase B cleanup deferred 30 days. |

---

## F-Class Bugs (NameError family — missing imports)

Pattern: symbol used inside file but never imported. Same root cause repeating.

| # | File | Symbol | Status |
|---|------|--------|--------|
| 1 | `backend/app/routes/workbench.py` | `func` (sqlalchemy) | ✅ Fixed |
| 2 | `backend/app/services/model_client.py` | `is_codex_proxy_reachable` | ✅ Fixed and restart/log check clean on 2026-05-09 |
| 3 | `backend/app/routes/pipelines.py` | (originally suspected here, but actual call site is `model_client.py`) | N/A — error message attributed to `pipelines` because it was the caller logging it |

**Verification command after restart:**
```powershell
C:\Python313\python.exe devforgeai.py stop
C:\Python313\python.exe devforgeai.py start backend
Start-Sleep 5
Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:19001/health' | Select-Object StatusCode
Get-Content C:\Users\chris\DevForgeAI\model_mesh\logs\backend_stderr.log -Tail 30
```
Look for: NO occurrences of `name 'is_codex_proxy_reachable' is not defined`. Then ask user to retry pipeline `f88a7392-aa4a-4bd7-8f29-1a4bc4eacc18`.

---

## Fix-F Already Applied (workbench.py)

- Loosened `_model_is_runtime_ready` — drops `validation_status='validated'` gate; checks `is_active` + provider creds. Env override `DEVFORGEAI_AGENTIC_REQUIRE_VALIDATION` restores strict mode.
- Added `_promote_copilot_runtime_model(model_orm, provider_orm)` — sets `_runtime_model_id` attribute via `resolve_supported_copilot_model` if live alias differs.
- `_resolve_model` (line ~486) now calls the helper before returning.

This mirrors the chat.py path so agentic resolution behaves like chat resolution.

---

## Known Live Bugs Still Open

1. **Chat dropdown sends inactive model UUID** — log: `Model '8f75a054-4148-4d5d-aaaa-4f9d0d80b8ba' matched but is inactive`. Likely stale localStorage. Fix in `frontend/src/app/chat/page.tsx`: validate selected model on submit; clear if inactive. Backend already filters via `?usable_only=true&active_only=true&validated_only=true&chat_only=true`.
2. **Copilot 404 token-exchange** — "lacks copilot scope". Only 7 live Copilot models, 23 static appended. No UI distinction. Should surface in M2 provider-state card.

---

## Code Map (key files for this work)

### Backend
- `backend/app/routes/chat.py` — **reference impl** for unified resolver pattern
  - L24: imports Copilot bypass
  - L361-395: live-resolve + `_runtime_model_id`
  - L425-475: fallback w/ strict validated gate
  - L980-1075: user-override 3-step lookup
- `backend/app/routes/workbench.py` — patched this session (F)
  - L15: `from sqlalchemy import select, desc, cast, func, String`
  - L19+: imports `get_copilot_auth_token, resolve_supported_copilot_model`
  - L128-152: `_model_is_runtime_ready`
  - L153-176: `_promote_copilot_runtime_model`
  - L486: `_resolve_model`
- `backend/app/routes/pipelines.py` — phase orchestration; `_run_phase` at L707; chat→pipeline helper added earlier
- `backend/app/services/model_client.py` — **just patched (F #2)**; LiteLLM call site
- `backend/app/services/codex_oauth.py` — defines `is_codex_proxy_reachable` (L164)
- `backend/app/services/provider_credentials.py` — `has_provider_api_key`, `get_provider_api_key`
- `backend/app/services/github_copilot.py` — `get_copilot_auth_token`, `resolve_supported_copilot_model`
- `backend/app/main.py` — lifespan ~L199 has orphan-recovery (flips running/pending → failed on startup)

### Frontend
- `frontend/src/components/now/NowMocks.tsx` — `NowPill` + `NowPanel` static mocks (FAKE_RUNS, RECENT_RUNS, phase strip, timeline, stalled detector)
- `frontend/src/app/(main)/mocks/now/page.tsx` — preview at http://localhost:3001/mocks/now
- `frontend/src/app/Navigation.tsx` — WORK (Now + Projects + Chat action) / BUILD (Create, Agents, Personas, Methods, Gallery, Marketplace) / MANAGE (Models, Collaborate, Stats, Settings, Help). Now badge shows active-runs count. Chat button creates scratch Run.
- `frontend/src/app/chat/page.tsx` — model dropdown sends UUID
- Duplicate session-fetch sites (consolidation targets):
  - `agents/sessions/page.tsx:73`
  - `projects/[id]/page.tsx:491,512,555`
  - `workbench/[id]/page.tsx:444`

---

## UX Audit Findings (already done)

**5 duplications** + **6 blind spots** in current 16-route nav. Consolidation proposal: **5-item sidebar** (Now / Chat / Projects / Configure / System) plus a unified Run viewer. Static mocks built at `/mocks/now`. Pending steps: M2 provider-state card mock, then real implementation contingent on D1/D2 sign-off.

---

## D1 Deliverable Spec (when we get there)

Audit doc only — **no code changes**. Read these fully:
- `backend/app/routes/chat.py`
- `backend/app/routes/workbench.py`
- `backend/app/routes/pipelines.py`
- `backend/app/services/provider_credentials.py`
- `backend/app/services/github_copilot.py`
- `backend/app/services/model_client.py`
- `backend/app/routes/model_sync.py`

Output:
- Spec for `resolve_model_for_runtime(ref, *, intent, use_codex_proxy) -> Ready | NeedsLiveProbe | Unreachable`
- Implicit-validation-on-success policy
- Live-vs-static catalog tiering

---

## Operational Notes

- **Always `stop` then `start backend`** — launcher skips start if port already listening (stale process risk).
- Setup: `python devforgeai.py bootstrap` (first run) / `sync` (after pull). No `restart` subcommand.
- Logs: `logs/backend_stderr.log`, `logs/backend_stdout.log`.
- Active pipeline being tested by user: `f88a7392-aa4a-4bd7-8f29-1a4bc4eacc18` (method=superpowers).

---

## Immediate Next Action (when resuming)

### Most recent session (2026-05-12) — major progress

**Slot A (F-class closure) — COMPLETE.** ruff lint clean (229 → 0), alembic migration chain fixed, 7 real bugs closed (dead-code overrides, missing imports, dropped params, sandbox gap, orphan operator block). Pre-commit hook added. Commits: `09ccf4d` → `e12873e` → `e21544d`.

**Bug 1 + Bug 2 (chat dropdown stale UUID + Copilot static-catalog gating) — COMPLETE.** Predicate module `frontend/src/lib/modelRuntimeReadiness.ts` is the single source of truth for "is this model usable right now?" Wired into chat dropdown, persona forms (new + edit), agent form. Commits: `32d0587` → `ad9679b`.

**Slot B (audit Bucket 2 — "stop lying to users") — COMPLETE.** Home page Status card wired to `/v1/health`, method "installed" relabeled and dynamicized, first-run banner added when identity is unset, Settings Reset-Onboarding navigates to chat instead of telling user to refresh, dead `skillsMarketplaceAlpha` flag removed, `project-context.md` + `CHARTER.md` refreshed to match SQLite + post-Phase-8 reality. Commit: `3c35a14`.

**Slot E Doc 1 (The Run — work model + viewer UX) — DESIGN DOC WRITTEN, AWAITING USER REVIEW.** See `docs/superpowers/specs/2026-05-12-the-run-design.md`. All 7 brainstorm decisions logged in §2 of that doc. Wireframes for the assembled design are embedded in §5.3 as text. Visual companion mockups preserved locally at `.superpowers/brainstorm/671-1778623161/` but gitignored.

### Session 2026-05-14 — gap audit + doc cleanup

- **Gap audit complete.** Conversations/[id] redirect shim confirmed present (false negative in earlier search). Stale `COMPLETION_GAP_CHECKLIST.md` updated (Codex transport marked closed, streaming limitation added). Stale `Python314` path fixed to `Python313`. GAP_CLOSURE_LOG item #3 closed.
- Settings page refactor pulled from upstream (7 tab components extracted).
- Responses API bridge + 11 tests pulled from upstream.

### To pick up

1. **Chunk 14 (Phase B cleanup)** — deferred 30 days from 2026-05-13. Earliest start: 2026-06-12. Delete legacy page files (`NowLive.tsx`, `NowMocks.tsx`, `mocks/now/page.tsx`), move redirects to `next.config.js` rewrites.
2. **Live smoke test** — start backend + frontend, visit every legacy URL listed in Doc 2 §4, verify redirects and banner behavior. Must be done interactively (sandbox blocks localhost).
3. **Credentialed runtime smoke tests** — hit `/v1/api-keys/runtime-status`, test OpenAI key path, Codex proxy path, fallback behavior. Requires real API keys — user must run manually.
4. **Responses API streaming** — `gpt-5-codex` responses are buffered as single chunk. Follow-up if streaming UX matters.
5. **Legacy pipeline → Run event replay** — companion Runs from legacy pipelines start empty (link only, no event replay).
6. **Projects write-through API** — no route for creating/updating projects programmatically yet.
7. **Background provider health monitor** — `ProviderHealthService.start_background_monitor()` not wired into app lifespan.
8. **Selection decision audit logging** — `log_selection_decision()` logs to stdout, not DB. No frontend audit trail.

## M2 Execution Delta (2026-05-09)

- Added provider runtime-state card section to `frontend/src/components/now/NowMocks.tsx`:
  - provider connection method (`oauth`, `api-key`, `local`)
  - connection status (`connected`, `degraded`, `disconnected`)
  - selected model
  - live vs static-only catalog counts
  - refreshed timestamp
  - action buttons (Reconnect / Refresh / Disconnect)
  - degraded Copilot note for token-scope/catalog mismatch visibility
- Updated copy on mock page `frontend/src/app/(main)/mocks/now/page.tsx` to include provider-state visibility in panel scope.
- Validation:
  - no Problems errors in both updated frontend files.

## Post-M2 Resolver Hardening Delta (2026-05-09)

- Centralized additional runtime fallback/error helpers in `backend/app/services/runtime_model_resolver.py`:
  - `find_validated_runtime_recovery_model(...)`
  - `should_failover_on_runtime_error(...)`
  - `should_deactivate_model_from_runtime_error(...)`
  - `humanize_runtime_model_error(...)`
- Expanded local-provider normalization set in resolver (`ollama`, `comfyui-local`, `local`, `lm-studio`, `lmstudio`, `llamacpp`) to align runtime cloud/local decisions.
- `backend/app/routes/workbench.py` now delegates runtime failover/error classification + user-facing error humanization to shared resolver helpers.
- `backend/app/routes/chat.py` recovery lookup now delegates validated candidate selection to shared resolver helper:
  - `_find_recovery_model(...)` now uses `find_validated_runtime_recovery_model(..., cloud_only=False)`
  - `_find_cloud_recovery_model(...)` now uses `find_validated_runtime_recovery_model(..., cloud_only=True)`
  - `_find_copilot_recovery_model(...)` keeps Copilot live-catalog ordering but now validates candidates through `resolve_model_for_runtime(...)`.
- Removed redundant chat-local connectivity/evaluation helper path used only by old recovery logic.

### Verification

- `g:/Model_Mesh/.venv/Scripts/python.exe -m pytest backend/tests/test_runtime_model_resolver.py -q` → **7 passed**
- `g:/Model_Mesh/.venv/Scripts/python.exe -m pytest backend/tests/test_workbench_runtime_resolution.py -q` → **3 passed**
- `g:/Model_Mesh/.venv/Scripts/python.exe -m pytest tests/test_chat.py -q` → **6 passed**

## Post-M2 Runtime Chain Centralization Delta (2026-05-09)

- Added shared chain-building and fallback-selection APIs in `backend/app/services/runtime_model_resolver.py`:
  - `resolve_runtime_model_row_for_lookup(...)`
  - `collect_runtime_fallback_candidates(...)`
  - `build_runtime_model_chain_for_runtime(...)`
- `backend/app/routes/workbench.py` now uses resolver-owned chain construction (agentic intent) rather than route-local candidate scoring.
- `backend/app/routes/pipelines.py` now uses resolver-owned failover and messaging helpers directly during phase execution:
  - `build_runtime_model_chain_for_runtime(...)`
  - `should_failover_on_runtime_error(...)`
  - `humanize_runtime_model_error(...)`
- This removes remaining pipeline dependence on workbench-local failover/chain helper internals for runtime execution path.

### New Regression Coverage

- Added `backend/tests/test_pipeline_runtime_failover.py`:
  - verifies phase failover info event includes switch message + humanized quota guidance
  - verifies terminal phase failure event includes humanized timeout text

### Verification (post-centralization)

- `g:/Model_Mesh/.venv/Scripts/python.exe -m pytest backend/tests/test_pipeline_runtime_failover.py -q` → **1 passed**
- `g:/Model_Mesh/.venv/Scripts/python.exe -m pytest backend/tests/test_runtime_model_resolver.py -q` → **7 passed**
- `g:/Model_Mesh/.venv/Scripts/python.exe -m pytest backend/tests/test_workbench_runtime_resolution.py -q` → **3 passed**
- `g:/Model_Mesh/.venv/Scripts/python.exe -m pytest tests/test_chat.py -q` → **6 passed**

## Post-Centralization Cleanup Delta (2026-05-09)

- Removed remaining duplicated model-lookup and fallback candidate code from `backend/app/routes/workbench.py`.
- Workbench now retains thin runtime wrappers only (`_build_runtime_model_chain`, `_resolve_model`) delegating behavior to shared resolver APIs.
- Deleted obsolete workbench-local helpers previously duplicated from resolver concerns:
  - provider credential gate helper
  - model runtime-ready helper
  - model-ref normalization helper
  - DB lookup helper for refs/fuzzy fallback
  - fallback candidate collector/capability scorer
- Updated workbench runtime-resolution tests to monkeypatch provider credential checks at shared resolver layer (`runtime_model_resolver.has_provider_api_key`) after helper removal.

### Verification (post-cleanup)

- `g:/Model_Mesh/.venv/Scripts/python.exe -m pytest backend/tests/test_workbench_runtime_resolution.py -q` → **3 passed**
- `g:/Model_Mesh/.venv/Scripts/python.exe -m pytest backend/tests/test_pipeline_runtime_failover.py -q` → **1 passed**
- `g:/Model_Mesh/.venv/Scripts/python.exe -m pytest backend/tests/test_runtime_model_resolver.py -q` → **7 passed**
- `g:/Model_Mesh/.venv/Scripts/python.exe -m pytest tests/test_chat.py -q` → **6 passed**

## Pipeline Decoupling Delta (2026-05-09)

- Removed remaining pipeline runtime-model resolution dependency on `app.routes.workbench` internals.
- Added local pipeline wrapper ` _resolve_runtime_model_ref(...)` in `backend/app/routes/pipelines.py` that delegates to shared resolver API:
  - `runtime_model_resolver.resolve_runtime_model_row_for_lookup(...)`
- Replaced all former pipeline uses of `workbench._resolve_model` with shared-resolver-backed wrapper for:
  - phase preview resolution
  - phase execution model resolution and normalization
  - manual phase-model update endpoint
- Result: pipeline runtime model resolution now depends on shared resolver service, not workbench route helper internals.

### Verification (post-pipeline decoupling)

- `g:/Model_Mesh/.venv/Scripts/python.exe -m pytest backend/tests/test_pipeline_runtime_failover.py -q` → **1 passed**
- `g:/Model_Mesh/.venv/Scripts/python.exe -m pytest backend/tests/test_workbench_runtime_resolution.py -q` → **3 passed**
- `g:/Model_Mesh/.venv/Scripts/python.exe -m pytest backend/tests/test_runtime_model_resolver.py -q` → **7 passed**
- `g:/Model_Mesh/.venv/Scripts/python.exe -m pytest tests/test_chat.py -q` → **6 passed**

## UI Wiring Delta (2026-05-09)

- Wired a live Now launcher into main navigation using backend data instead of static mocks.
- Added `frontend/src/components/now/NowLive.tsx`:
  - polls and aggregates live data from:
    - `/v1/workbench/sessions`
    - `/v1/workbench/pipelines`
    - `/v1/providers?active_only=false`
    - `/v1/runtime/provider-capabilities`
    - `/v1/models?limit=500&active_only=false`
  - renders active run summaries + selected run detail (pipeline phase runs / session event log)
  - renders provider runtime state cards from live capability/model data
  - wires user actions:
    - Refresh re-fetches live data
    - Reconnect/Disconnect route user to Settings for credential management
- Updated `frontend/src/app/Navigation.tsx`:
  - integrated `NowLauncher` into sidebar top shortcut area
  - removed redundant active-session polling logic superseded by live Now launcher

### Verification (UI wiring)

- VS Code Problems check: no TypeScript/editor errors in
  - `frontend/src/components/now/NowLive.tsx`
  - `frontend/src/app/Navigation.tsx`

## D2 Execution Delta (2026-05-09)

- Added `backend/app/services/runtime_model_resolver.py` with shared result types:
  - `Ready`
  - `NeedsLiveProbe`
  - `Unreachable`
- Added `resolve_model_for_runtime(...)` initial implementation:
  - deterministic reference resolution (UUID, provider/model, plain model with ambiguity rejection)
  - provider readiness checks
  - Copilot live alias normalization
  - strict validation env gate compatibility
- Added tests: `backend/tests/test_runtime_model_resolver.py`
  - ambiguous plain model ref rejection
  - unverified model returns `NeedsLiveProbe`
  - Copilot alias resolves to runtime live model ID
- Verification:
  - `g:/Model_Mesh/.venv/Scripts/python.exe -m pytest backend/tests/test_runtime_model_resolver.py -q`
  - Result: 3 passed

- Integrated shared resolver into chat path (`backend/app/routes/chat.py`):
  - model override resolution now uses `resolve_model_for_runtime(...)`
  - primary/fallback readiness now uses shared resolver outcomes (`Ready`, `NeedsLiveProbe`, `Unreachable`)
- Integrated shared resolver into workbench core resolution (`backend/app/routes/workbench.py`):
  - `_resolve_model(...)` now routes through `resolve_model_for_runtime(...)`
  - pipelines inherit this via existing import of workbench resolver helper
- Additional verification after integration:
  - `g:/Model_Mesh/.venv/Scripts/python.exe -m pytest tests/test_chat.py -q` → 6 passed
  - `g:/Model_Mesh/.venv/Scripts/python.exe -m pytest tests/test_remote.py -q` → 16 passed

- Added runtime validation feedback hooks in shared resolver service (`backend/app/services/runtime_model_resolver.py`):
  - `mark_runtime_validation_success(...)` promotes unverified -> validated after runtime success
  - `mark_runtime_validation_failure(...)` demotes to failed only for authoritative not-supported errors
  - `is_authoritative_model_not_supported_error(...)` guard avoids demotion on transient failures
- Wired chat sync/stream paths to call feedback hooks (`backend/app/routes/chat.py`):
  - success path marks runtime validation success
  - exception path attempts authoritative failure demotion
- Expanded resolver tests (`backend/tests/test_runtime_model_resolver.py`):
  - promotion test for unverified model
  - authoritative-only demotion safeguard test
- Latest verification:
  - `g:/Model_Mesh/.venv/Scripts/python.exe -m pytest backend/tests/test_runtime_model_resolver.py -q` → 5 passed
  - `g:/Model_Mesh/.venv/Scripts/python.exe -m pytest tests/test_chat.py -q` → 6 passed

- Added D2 Task 6 route-facing regressions:
  - `backend/tests/test_workbench_runtime_resolution.py`
    - ambiguous plain model id rejected in workbench `_resolve_model`
    - provider-qualified unverified model accepted
    - runtime model chain keeps selected model first for agentic execution path
- Focused regression suite after Task 6:
  - `g:/Model_Mesh/.venv/Scripts/python.exe -m pytest backend/tests/test_workbench_runtime_resolution.py -q` → pass
  - `g:/Model_Mesh/.venv/Scripts/python.exe -m pytest backend/tests/test_runtime_model_resolver.py -q` → pass
  - `g:/Model_Mesh/.venv/Scripts/python.exe -m pytest tests/test_chat.py -q` → pass
