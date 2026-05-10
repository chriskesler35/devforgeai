# D2 Plan — Unified Runtime Resolver Implementation

Last updated: 2026-05-09
Input: docs/D1_UNIFIED_RUNTIME_RESOLVER_AUDIT.md
Status: Ready to execute

## 1. Objective

Implement a single shared runtime resolver service so chat, workbench, and pipeline paths resolve models with one contract and one policy surface.

Target outcome:
- No behavior split between chat and agentic paths for model readiness
- Deterministic reference resolution across all entrypoints
- Centralized fallback and error taxonomy
- Runtime success/failure feedback updates model validation state

## 2. Scope

In scope:
- New shared resolver service and types
- Integration in chat, workbench, pipelines
- Runtime validation persistence hooks
- Resolver-focused tests

Out of scope for D2 implementation:
- Full UI redesign
- Marketplace or unrelated model sync changes
- Large refactors of model_client transport internals beyond resolver boundaries

## 3. Deliverables

1. Shared resolver module:
- backend/app/services/runtime_model_resolver.py

2. Shared result models:
- Ready
- NeedsLiveProbe
- Unreachable

3. Unified API:
- resolve_model_for_runtime(db, ref, intent, use_codex_proxy, prefer_cloud_fallback, explicit_fallback_refs)

4. Integrations:
- chat uses shared resolver for primary + override + fallback
- workbench uses shared resolver instead of local duplicated readiness checks
- pipelines use shared resolver chain for phase model selection/failover

5. Runtime validation feedback:
- successful runtime call can promote unverified to validated
- authoritative model-not-supported failures can mark failed safely

6. Test suite additions:
- resolver reference resolution
- ambiguity rejection
- Copilot live alias mapping path
- fallback ranking behavior
- validation feedback persistence

## 4. Execution Sequence

### Task 1: Create Resolver Types and Core API

Files:
- backend/app/services/runtime_model_resolver.py

Actions:
- Add dataclasses for Ready, NeedsLiveProbe, Unreachable
- Implement resolve_model_for_runtime entry function
- Implement deterministic ref resolution order:
  - UUID
  - provider/model_id
  - plain model_id exact with ambiguity rejection
- Implement provider/model active checks

Verification:
- Static import check from chat and workbench modules
- Unit tests for reference parsing and deterministic outcomes

Commit message:
- feat(resolver): add shared runtime model resolver contract and result types

### Task 2: Centralize Provider Readiness + Copilot Live Resolution

Files:
- backend/app/services/runtime_model_resolver.py
- backend/app/services/provider_credentials.py (only if helper extension required)
- backend/app/services/github_copilot.py (reuse existing helpers, avoid duplication)

Actions:
- Move readiness gating logic into resolver helper functions
- Reuse existing provider credential helpers
- Reuse Copilot live model resolution and runtime alias normalization
- Return NeedsLiveProbe when advisory validation requires a probe path

Verification:
- Resolver tests for:
  - inactive model/provider
  - missing creds
  - copilot alias resolution
  - copilot unavailable catalog path

Commit message:
- feat(resolver): centralize provider readiness and copilot live model normalization

### Task 3: Integrate Resolver in Chat Path

Files:
- backend/app/routes/chat.py

Actions:
- Replace local readiness/fallback decision tree with resolver calls
- Keep chat-specific concerns (workflow dispatch, tool loop, vram guard) intact
- Normalize override handling to resolver API and reason codes
- Preserve existing response structure and error response schema

Verification:
- Existing chat tests pass
- Manual checks:
  - model override by UUID
  - provider/model override
  - ambiguous plain model_id rejection
  - fallback message integrity

Commit message:
- refactor(chat): use shared runtime resolver for model selection and fallback

### Task 4: Integrate Resolver in Workbench and Pipelines

Files:
- backend/app/routes/workbench.py
- backend/app/routes/pipelines.py

Actions:
- Replace local _resolve_model and runtime chain building where practical with resolver service
- Keep runtime failover event streaming, but consume resolver reason codes
- Ensure pipeline phase model selection normalizes via shared resolver
- Remove duplicated readiness checks after parity verification

Verification:
- Run targeted phase execution flow on active method pipeline
- Confirm no regression in phase failover behavior
- Confirm previous NameError family path remains fixed

Commit message:
- refactor(agentic): route workbench and pipelines through shared runtime resolver

### Task 5: Runtime Validation Feedback Hooks

Files:
- backend/app/services/runtime_model_resolver.py
- backend/app/services/model_client.py (minimal hook points)
- backend/app/services/router.py or route callers (where authoritative errors are caught)

Actions:
- On successful runtime call for unverified model:
  - mark validated with source runtime_success:intent
- On authoritative not-supported errors:
  - mark failed with reason model_not_supported
- Add safeguards against deactivation on transient transport/cache errors

Verification:
- Tests for promotion and demotion paths
- Manual one-shot validation with known unverified model row

Commit message:
- feat(resolver): add runtime validation promotion and authoritative rejection demotion

### Task 6: Test and Regression Sweep

Files:
- backend/tests/test_runtime_model_resolver.py (new)
- backend/tests existing chat/pipeline/model tests (touch as required)

Actions:
- Add focused resolver unit tests
- Add route-level regression tests for chat override and pipeline model chain
- Run targeted backend tests

Verification commands:
- g:/Model_Mesh/.venv/Scripts/python.exe -m pytest backend/tests/test_runtime_model_resolver.py -q
- g:/Model_Mesh/.venv/Scripts/python.exe -m pytest backend/tests/test_agentic_state_machine.py backend/tests/test_agentic_events.py -q
- g:/Model_Mesh/.venv/Scripts/python.exe -m pytest tests/test_remote.py -q

Commit message:
- test(resolver): add unified runtime resolver coverage and route regressions

## 5. Risk Controls

1. Behavior drift during migration
- Mitigation: migrate chat first, then workbench/pipelines with parity checks

2. Copilot catalog instability (token scope/cache)
- Mitigation: preserve refreshed catalog retry path and avoid permanent deactivation on transient misses

3. Fallback regressions
- Mitigation: codify deterministic ranking and assert in tests

4. Over-refactor blast radius
- Mitigation: preserve model_client transport logic in place during this phase

## 6. Definition of Done

- Shared resolver service exists and is used by chat/workbench/pipelines
- No duplicated resolver decision trees remain in route code paths
- Runtime validation promotion/demotion is implemented with safeguards
- Resolver and regression tests pass
- Session handoff updated with D2 completion and execution notes

## 7. Immediate Next Action

Start Task 1 and Task 2 in one implementation wave:
- scaffold runtime_model_resolver.py
- add reference parsing + readiness helpers + Copilot normalization
- add initial unit tests for Ready and Unreachable outcomes
