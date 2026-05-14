# DevForgeAI Gap Closure Log

Updated: 2026-05-14

This file tracks gaps found during the May 2026 laptop sync/review. It is intentionally evidence-based: a gap is only marked closed when the repo has code and verification to back it up.

## Closed In This Pass

1. **Frontend production build was broken**
   - Finding: `npm run build` failed on JSX syntax, TypeScript mismatches, and missing Suspense boundaries for `useSearchParams()`.
   - Fixes:
     - Escaped JSX arrow text in BMAD/GSD/gtrack/method pages.
     - Removed an extra interface-closing brace in Settings.
     - Fixed the Workbench detail conditional JSX block.
     - Fixed type mismatches in Workbench launch, pipeline SSE init, and chat model capabilities.
     - Wrapped Settings and Agent Sessions search-param consumers in Suspense.
   - Verification:
     - `cd frontend && npx tsc --noEmit --pretty false` -> pass
     - `cd frontend && npm run test:contract` -> 4 passed
     - `cd frontend && npm run build` -> pass

2. **Codex OAuth was reported as usable without a compatible HTTP transport**
   - Finding: a Codex/ChatGPT OAuth access token was being treated as an OpenAI API key in credential helpers and model validation. That could make Settings report a usable OpenAI/Codex runtime even when actual calls would fail.
   - Fixes:
     - Codex OAuth now counts as runtime-usable only when a supported, reachable OpenAI-compatible proxy exists.
     - A real `OPENAI_API_KEY` remains a valid direct route for OpenAI/OpenAI-Codex provider calls.
     - Runtime status copy now tells the user to configure a proxy or set `OPENAI_API_KEY` instead of saying direct OAuth-token routing works.
   - Verification:
     - `backend/tests/test_codex_oauth_connectivity.py`
     - Focused backend suite -> 15 passed

3. **Runtime resolver depended on schema/model fields that were not consistently present**
   - Finding: resolver code ordered by `Model.fallback_priority`, but the ORM and runtime SQLite migration did not define it.
   - Fixes:
     - Added `is_pinned_default` and `fallback_priority` to `backend/app/models/model.py`.
     - Added idempotent runtime migrations for those columns and index in `backend/app/migrate.py`.
   - Verification:
     - Workbench and pipeline resolver tests pass.

4. **Verification-aware resolver ignored legacy capability data**
   - Finding: `resolve_with_verification(...)` and fallback selection required `model_verifications` rows and ignored existing `models.capabilities` for otherwise-valid rows.
   - Fix:
     - Added shared `_model_supports_feature(...)` fallback logic: verified records win when present; otherwise existing model capabilities keep legacy rows usable.
   - Verification:
     - Runtime resolver, Workbench runtime resolution, and pipeline failover tests pass.

5. **CI allowed important checks to fail**
   - Finding: backend lint/tests and frontend lint/type-check steps used `|| true`, so regressions could merge while CI stayed green.
   - Fixes:
     - Removed `|| true` from backend lint/test and frontend lint/type-check.
     - CI now installs `requirements.postgres.txt` for PostgreSQL-backed test/migration jobs.
     - Migration test now uses `DATABASE_URL` so Alembic actually targets the temporary DB it creates.

6. **Alembic revision graph had multiple heads**
   - Finding: `001_add_verification_tables.py` and `add_user_profile.py` were independent base revisions.
   - Fixes:
     - Chained `add_user_profile` after `001`.
     - Chained `add_verification_tables` after `005_remaining_tables`.
   - Verification:
     - `cd backend && ..\.venv\Scripts\python.exe -m alembic heads` -> single head: `add_verification_tables`.

7. **Responses-only Codex models could be silently remapped into chat-completions**
   - Finding: `gpt-5-codex` was treated as an alias for `gpt-5`, which hides an endpoint mismatch instead of making transport requirements explicit.
   - Fixes:
     - Added OpenAI/OpenAI-Codex endpoint metadata in `backend/app/services/model_capabilities.py`.
     - Removed `gpt-5-codex -> gpt-5` aliasing in resolver/client code.
     - `ModelClient` now fails closed with a clear Responses API message for Responses-only models.
     - Model validation marks Responses-only models as metadata-only until a Responses transport exists.
   - Verification:
     - `backend/tests/test_codex_oauth_connectivity.py`

8. **Dev launcher could hang or misreport backend status on Windows**
   - Finding: backend/frontend child processes inherited attached handles, backend reload mode triggered Windows multiprocessing permission failures, and `status` used `tasklist`, which can return access denied in restricted shells even while the backend is healthy.
   - Fixes:
     - Detached backend/frontend child processes and redirected stdout/stderr to `logs/*_stdout.log` and `logs/*_stderr.log`.
     - Closed parent-side log handles after spawning children.
     - Made backend reload opt-in via `DEVFORGEAI_BACKEND_RELOAD=1`.
     - Replaced Windows PID liveness checks with `OpenProcess`/`GetExitCodeProcess`.
     - Made `start backend` output only backend URLs.
   - Verification:
     - `.\.venv\Scripts\python.exe -m py_compile devforgeai.py` -> pass
     - `.\.venv\Scripts\python.exe devforgeai.py start backend` -> backend running
     - `Invoke-WebRequest http://127.0.0.1:19001/health` -> 200
     - `.\.venv\Scripts\python.exe devforgeai.py status` -> backend running, frontend stopped

9. **Pytest cache permissions made verification output noisy**
   - Finding: pytest cache temp directories under the repo were created with permissions this shell could not reopen, causing cache warnings and noisy `git status` output.
   - Fix:
     - Disabled pytest's cache provider in `backend/pyproject.toml`; this does not affect test assertions.
   - Verification:
     - Focused backend suite -> 17 passed with only deprecation warnings.

10. **Model assignments drifted between launcher, personas, phases, and failover**
   - Finding: a model chosen for a run could be superseded by phase persona/default resolution, and runtime failover was only emitted as a generic info event. This made screens appear to disagree about which model was actually assigned.
   - Fixes:
     - Pipeline creation now copies the session/workflow model onto every phase unless the user explicitly overrides a phase.
     - Runtime phase execution prioritizes phase override -> session model -> persona/agent -> template default.
     - Workbench failover no longer rewrites the stored session model.
     - Backend emits explicit `model_failover` events with previous model, fallback model, reason, and error context.
     - Workbench, Pipeline, and Runs views render model failover as a warning-style event.
   - Verification:
     - `backend/tests/test_model_assignment_consistency.py`
     - Focused backend suite -> 8 passed
     - `cd frontend && npx tsc --noEmit --pretty false` -> pass

## Still Open

~~1. **Responses API transport still needs implementation**~~ → **Closed 2026-05-13**.
- `backend/app/services/model_client.py` now bridges to `litellm.aresponses` for
  Responses-only models (currently `gpt-5-codex`) via three new helpers:
  `_messages_to_responses_input` (chat-completions messages → Responses
  `instructions` + `input`), `_responses_to_chat_envelope` (Responses output →
  chat-completions-shaped object so downstream callers don't branch), and
  `_call_responses_api` (wires the two together; preserves api_key / api_base /
  extra_headers from the existing provider-config flow).
- `call_model` detects `requires_openai_responses_api(raw_model_id)` and routes
  through the bridge instead of raising; chat-completions models are unchanged.
- Verification (2026-05-13):
  - `backend/tests/test_responses_api_bridge.py` — 11 new tests covering
    translation helpers, envelope normalization, single-chunk streaming wrap,
    end-to-end routing in `call_model`, and a negative test guarding against
    accidental rerouting of chat-completions models.
  - Full regression set (`test_responses_api_bridge` +
    `test_codex_oauth_connectivity` + `test_runtime_model_resolver` +
    `test_workbench_runtime_resolution` + `test_pipeline_runtime_failover`) →
    **28 passed**.
  - `ruff check .` → all checks passed.
- ~~v1 limitation: streaming was buffered~~ → **Closed 2026-05-14.**
  Streaming now uses real server-side Responses API streaming. Delta events
  (`response.output_text.delta`) are translated into chat-completions-shaped
  delta chunks (`chunk.choices[0].delta.content`) so `_stream_response` and
  all SSE consumers work transparently. Test updated to verify incremental
  multi-chunk streaming behavior.

2. **Credentialed runtime smoke tests still need secrets/proxy availability**
   - Backend startup and `/health` are verified locally, but credentialed model calls still depend on local secrets and any configured Codex-compatible proxy.
   - Next work:
     - Run `/v1/api-keys/runtime-status`.
     - Run live model routing smoke tests for OpenAI API key path, OpenAI-Codex proxy path if configured, and fallback behavior.

~~3. **Completion checklist previously overstated readiness**~~ → **Closed 2026-05-14**.
   - Updated `COMPLETION_GAP_CHECKLIST.md`: marked Codex transport as closed, added Responses API streaming limitation, linked this gap log.
   - Verification commands already present in the "Current Required Verification Set" section below.

## Current Required Verification Set

Run before marking the current gap pack closed:

```powershell
.\.venv\Scripts\python.exe -m pytest backend\tests\test_codex_oauth_connectivity.py backend\tests\test_runtime_model_resolver.py backend\tests\test_workbench_runtime_resolution.py backend\tests\test_pipeline_runtime_failover.py -q
cd frontend
npm run test:contract
npx tsc --noEmit --pretty false
npm run build
cd ..\backend
..\.venv\Scripts\python.exe -m alembic heads
cd ..
.\.venv\Scripts\python.exe -m py_compile devforgeai.py
.\.venv\Scripts\python.exe devforgeai.py start backend
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:19001/health
```
