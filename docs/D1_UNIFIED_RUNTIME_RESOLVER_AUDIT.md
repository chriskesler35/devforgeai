# D1 Audit — Unified Runtime Model Resolver

Last updated: 2026-05-09
Status: Draft complete (implementation-ready)

## 1. Goal

Create a single runtime resolver that guarantees consistent behavior across:

- Chat requests
- Workbench agent runs
- Pipeline phase execution

Primary target: eliminate the "works in chat, fails agentically" class by centralizing model/provider readiness decisions.

## 2. Scope Reviewed

- `backend/app/routes/chat.py`
- `backend/app/routes/workbench.py`
- `backend/app/routes/pipelines.py`
- `backend/app/services/provider_credentials.py`
- `backend/app/services/github_copilot.py`
- `backend/app/services/model_client.py`
- `backend/app/routes/model_sync.py`

Supporting filter behavior also reviewed:

- `backend/app/routes/models.py`

## 3. Current State (What Exists Today)

### 3.1 Chat path has the richest runtime checks

Chat currently performs the most complete flow:

1. Override resolution supports UUID, provider-qualified ref, and plain model_id with ambiguity rejection.
2. Connectivity gate checks model active state, provider active state, validation status, and provider credentials.
3. GitHub Copilot special handling:
   - live model alias resolution (`resolve_supported_copilot_model`)
   - runtime model promotion via `_runtime_model_id`
4. Recovery logic:
   - fallback model
   - Copilot-specific recovery search
   - global validated recovery search
5. Provider-specific runtime preparation (`_prepare_runtime_model_for_provider`).

Evidence:
- `chat.py`: `_evaluate_model_connectivity`, `_prepare_runtime_model_for_provider`, override logic around model_override, recovery routines.

### 3.2 Workbench path now mirrors chat on validation strictness

Workbench recently relaxed validation gating (default) and added Copilot runtime alias promotion:

- `_model_is_runtime_ready`: active + credentials, validation optional unless `DEVFORGEAI_AGENTIC_REQUIRE_VALIDATION=1`
- `_resolve_model`: no strict validated gate by default, calls Copilot promotion helper
- `_build_runtime_model_chain`: collects explicit and catalog fallbacks

Evidence:
- `workbench.py`: `_model_is_runtime_ready`, `_promote_copilot_runtime_model`, `_resolve_model`, `_collect_runtime_fallbacks`, `_build_runtime_model_chain`.

### 3.3 Pipelines path delegates resolution to workbench helpers

Pipelines imports and uses workbench resolver helpers inside phase execution:

- Uses `_resolve_model` for model ref normalization and persona/agent mapping
- Uses `_build_runtime_model_chain` for failover
- Does failover based on `_should_failover_error`

Evidence:
- `pipelines.py`: `_run_phase` imports from workbench, builds model chain, failover loop.

### 3.4 Model client duplicates provider-specific logic

`ModelClient.call_model` independently performs transport and provider routing decisions:

- OpenAI/OpenAI-Codex + Codex proxy behavior
- Copilot token exchange + live model resolution
- Ollama local/cloud endpoint split
- Credential fallback error shaping

Evidence:
- `model_client.py`: `call_model` branch logic.

### 3.5 Provider credential semantics are split across helpers and callers

`provider_credentials.py` correctly distinguishes provider rules (notably openai vs openai-codex), but final readiness decisions still happen in multiple places.

Evidence:
- `provider_credentials.py`: `has_provider_api_key`, `get_provider_api_key`.

### 3.6 Model sync intentionally mixes live and static catalogs

`model_sync.py` does live discovery when possible, then merges static fallback, and marks validation status accordingly:

- live-discovered rows become validated
- static appendages remain unverified
- missing live models can be deactivated

Evidence:
- `model_sync.py`: `discover_provider_models`, sync/upsert and deactivation block.

## 4. Divergences and Risk Points

### D-1: Resolver logic is duplicated across chat, workbench, and model_client

Impact:
- behavior drift over time
- bug fixes applied in one path but missed in others

### D-2: Validation semantics differ by entrypoint and provider

Current effective behavior:
- Chat: strict validated requirement for non-Copilot paths (unless recovered)
- Workbench/Pipeline: validation gate relaxed by default

Impact:
- inconsistent model availability by surface

### D-3: Copilot live-model handling appears in multiple layers

Copilot resolution currently happens in:
- Chat preflight
- Workbench preflight
- ModelClient at call time

Impact:
- repeated network checks
- inconsistent failure messages
- harder caching strategy

### D-4: Fallback selection criteria are not centralized

Chat and workbench both choose fallbacks, but with different heuristics and context (cloud preference, quality ranking, provider affinity).

Impact:
- non-deterministic user experience

### D-5: `validated_only=true` list filtering can hide runtime-usable models

`/v1/models` now filters to validated only when requested, but runtime may still succeed for certain unverified rows (especially with live probe).

Impact:
- UI may present less than runtime-capable set unless list strategy is aligned with resolver strategy

## 5. Unified Contract Proposal

Introduce one shared service module, e.g.:

- `backend/app/services/runtime_model_resolver.py`

Primary function:

```python
async def resolve_model_for_runtime(
    db: AsyncSession,
    ref: str,
    *,
    intent: Literal["chat", "agentic", "pipeline", "tools"],
    use_codex_proxy: bool | None = None,
    prefer_cloud_fallback: bool = False,
    explicit_fallback_refs: list[str] | None = None,
) -> ResolveResult:
    ...
```

### 5.1 Result types

```python
@dataclass
class Ready:
    model: Model
    provider: Provider
    runtime_model_id: str
    resolved_from: str  # uuid | provider_model | plain_model | alias
    notes: list[str]

@dataclass
class NeedsLiveProbe:
    model: Model
    provider: Provider
    reason_code: str    # unverified | stale_catalog | copilot_alias_unknown
    probe_action: str   # provider probe strategy key
    notes: list[str]

@dataclass
class Unreachable:
    reason_code: str
    user_message: str
    technical_detail: str
    candidates_tried: list[str]
    remediation: list[str]
```

Return union:

```python
ResolveResult = Ready | NeedsLiveProbe | Unreachable
```

### 5.2 Required semantics

1. Deterministic reference resolution order (all surfaces):
   - UUID
   - provider/model_id
   - plain model_id exact (reject ambiguous)
2. Mandatory active checks:
   - model active
   - provider active
3. Provider readiness checks:
   - centralized through provider credential service + connectivity checks where needed
4. Copilot normalization:
   - resolve alias/live ID once per request path
   - set runtime_model_id for downstream call
5. Validation policy:
   - validation status is advisory, not absolute blocker
   - if unverified, return `NeedsLiveProbe` (unless policy toggles strict mode)
6. Fallback policy centralized:
   - explicit fallback refs first
   - then ranked catalog fallback according to intent
7. Error taxonomy centralized:
   - normalized reason codes and user-safe messages

## 6. Implicit Validation on Success Policy

When a runtime call succeeds for a model/provider pair currently marked unverified:

- mark `validation_status=validated`
- set `validation_source=runtime_success:<intent>`
- clear stale warning/error fields
- update `validated_at`

When runtime rejects with authoritative model-not-supported signals:

- mark `validation_status=failed`
- set `validation_error=model_not_supported` (or provider-specific equivalent)
- optionally set `is_active=False` only on high-confidence errors

Guardrail:
- never deactivate on transient transport/network/cache errors

## 7. Live-vs-Static Catalog Tiering

Define catalog confidence tiers and use them consistently in resolver scoring:

- Tier 1: live provider catalog hit (highest confidence)
- Tier 2: previously runtime-validated model
- Tier 3: static curated catalog only (needs probe)

Resolver should favor higher tier first, but may probe Tier 3 when required.

## 8. Integration Plan (No behavior regressions)

### Phase A — Introduce resolver service (read-only integration)

- Add `runtime_model_resolver.py`
- Wire chat path to call resolver for primary + fallback decisioning
- Keep existing model_client provider transport logic unchanged initially

### Phase B — Move workbench/pipeline onto shared resolver

- Replace direct `_resolve_model` / `_build_runtime_model_chain` logic with shared resolver API
- Keep existing failover event messages, but source reasons from resolver reason codes

### Phase C — De-duplicate provider-specific preflight

- Remove duplicated Copilot/model readiness checks from chat/workbench where resolver now owns it
- Keep provider-specific call-time constraints in model_client only (transport-level concerns)

### Phase D — Add runtime validation feedback loop

- On successful calls, persist implicit validation updates
- On authoritative model-not-supported errors, persist failure state with reason code

## 9. Open Decisions for D2 Planning

1. Strict-mode default:
   - Keep relaxed validation default for agentic, strict for chat?
   - Or unify both to advisory validation + live probe
2. Deactivation threshold:
   - Which provider errors should deactivate vs warn
3. Probe budget:
   - max live probe attempts per request
4. Fallback quality policy:
   - should chat and pipeline share the same ranking or intent-specific ranking

## 10. Acceptance Criteria for D1

- Single resolver contract defined with typed outcomes (Ready/NeedsLiveProbe/Unreachable).
- Deterministic reference resolution order documented.
- Validation strategy and implicit-validation policy documented.
- Live-vs-static catalog tiering documented.
- Migration plan from existing scattered logic documented.

## 11. Immediate D2 Inputs

Use this D1 doc as direct input to phase planning for implementation tasks:

- Create resolver service and tests
- Migrate chat path
- Migrate workbench + pipelines
- Add persistence hooks for runtime validation updates
- Standardize error codes/messages emitted to UI and logs
