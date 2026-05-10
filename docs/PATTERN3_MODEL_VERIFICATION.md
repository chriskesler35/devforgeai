# Pattern 3: Deterministic Model Reliability — Implementation Plan

**Start Date:** May 10, 2026  
**Status:** Diagnosis Phase  
**Priority:** Unblocks Patterns 1 & 2

---

## PART 1: ROOT CAUSE DIAGNOSIS

### 1.1 Current State Analysis

**Existing Infrastructure:**
- Model schema has `validation_status` (unverified | validated | failed)
- `validated_at`, `validation_source`, `validation_warning`, `validation_error` fields
- Provider schema with `is_active` flag and `api_base_url`
- Runtime resolver exists: `runtime_model_resolver.py`

**Known Gaps:**
- No detailed test results stored (only pass/fail status)
- No per-capability verification (chat, vision, streaming, embeddings, functions)
- No provider health check endpoint or background monitoring
- No credential isolation per provider
- No fallback chain configuration
- No model selection logging for debugging

### 1.2 Diagnosis Methodology

We need to systematically test each model to understand what's failing. Create a diagnostic test matrix:

```
Model: gpt-4o
Provider: openai
Test Suite:
├─ chat_basic: PASS/FAIL (text in → text out)
├─ chat_streaming: PASS/FAIL (streaming chunks)
├─ vision: PASS/FAIL (image + text → description)
├─ embeddings: SKIP (not supported)
├─ function_calling: PASS/FAIL (system prompt + functions)
├─ error_handling: PASS/FAIL (invalid input → correct error)
├─ timeout: PASS/FAIL (respects max timeout)
├─ rate_limiting: PASS/FAIL (handles 429 correctly)
├─ auth: PASS/FAIL (credential validity check)
├─ connectivity: PASS/FAIL (endpoint reachable)
└─ diagnostic_notes: [Any observations about edge cases]
```

### 1.3 Hypothesis Matrix

Test these hypotheses for each failed model:

| Hypothesis | Test | Verification |
|-----------|------|--------------|
| Credential missing/invalid | `GET /health` with creds → 401 | Provider auth endpoint responds with 401 |
| Schema mismatch | Chat with wrong format (XML vs JSON) | Model rejects with clear error |
| Provider switching | Same model_id under multiple providers | Query DB: duplicates found |
| Cold-start / connection pooling | First call fails, retry succeeds | Load test + retry logic |
| Rate limiting | Too many calls in short time | Get 429 → check Retry-After header |
| Partial API migration | New endpoint deployed, old still active | Compare endpoint responses |
| Streaming vs non-streaming | Model fails only with streaming=true | Test both modes independently |
| Context window | Prompt > context_window | Truncate and retry |
| Vision schema | Vision model expects specific image format | Test different formats (base64, URL) |
| Function calling | Wrong schema for functions | Validate schema against model spec |

---

## PART 2: DATABASE SCHEMA UPDATES

### 2.1 New Table: `model_verifications`

```sql
CREATE TABLE model_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Reference to model
    model_id UUID NOT NULL UNIQUE REFERENCES models(id) ON DELETE CASCADE,
    
    -- Verification state
    verification_status VARCHAR(20) NOT NULL DEFAULT 'unverified',
    -- ENUM: unverified, pending, verified, failed, degraded
    
    verified_at TIMESTAMP NULL,
    verified_by VARCHAR(100) NULL,
    -- 'test_suite_v1', 'manual', 'regression_test_v2', etc.
    
    -- Test results (JSON)
    test_results JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Schema:
    -- {
    --   "chat_basic": {"status": "pass", "duration_ms": 234, "error": null},
    --   "chat_streaming": {"status": "pass", ...},
    --   "vision": {"status": "skip", "reason": "Model does not support vision"},
    --   "embeddings": {"status": "skip", ...},
    --   "function_calling": {"status": "fail", "error": "Invalid function schema"},
    --   ...
    -- }
    
    -- Capability summary (JSON)
    capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Schema:
    -- {
    --   "chat": true,
    --   "streaming": true,
    --   "vision": false,
    --   "embeddings": false,
    --   "function_calling": true,
    --   "image_generation": false
    -- }
    
    -- Known issues / notes
    notes TEXT NULL,
    fallback_recommendations TEXT NULL,
    -- E.g., "If vision needed, use gpt-4-vision. If speed needed, use gpt-4o-mini."
    
    -- Last verified timestamp (for staleness detection)
    last_verified_at TIMESTAMP NULL,
    days_since_verified INT GENERATED ALWAYS AS (
        EXTRACT(DAY FROM (CURRENT_TIMESTAMP - last_verified_at))
    ) STORED,
    
    CONSTRAINT check_status CHECK (verification_status IN (
        'unverified', 'pending', 'verified', 'failed', 'degraded'
    ))
);

CREATE INDEX idx_model_verifications_status 
    ON model_verifications(verification_status);
CREATE INDEX idx_model_verifications_verified_at 
    ON model_verifications(verified_at DESC);
```

### 2.2 New Table: `provider_health`

```sql
CREATE TABLE provider_health (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Reference to provider
    provider_id UUID NOT NULL UNIQUE REFERENCES providers(id) ON DELETE CASCADE,
    
    -- Health state
    health_status VARCHAR(20) NOT NULL DEFAULT 'unknown',
    -- ENUM: ok, degraded, failed, unknown
    
    last_checked_at TIMESTAMP NULL,
    last_check_duration_ms INT NULL,
    
    -- Credential check
    credential_status VARCHAR(20) DEFAULT 'unchecked',
    -- ENUM: valid, invalid, unknown
    
    credential_last_checked_at TIMESTAMP NULL,
    credential_error_message TEXT NULL,
    
    -- Connectivity check
    connectivity_status VARCHAR(20) DEFAULT 'unchecked',
    connectivity_last_checked_at TIMESTAMP NULL,
    connectivity_error_message TEXT NULL,
    
    -- Rate limit info
    rate_limit_remaining INT NULL,
    rate_limit_reset_at TIMESTAMP NULL,
    
    -- Notes
    notes TEXT NULL,
    
    CONSTRAINT check_health CHECK (health_status IN (
        'ok', 'degraded', 'failed', 'unknown'
    )),
    CONSTRAINT check_credential_status CHECK (credential_status IN (
        'valid', 'invalid', 'unknown'
    )),
    CONSTRAINT check_connectivity_status CHECK (connectivity_status IN (
        'ok', 'error', 'unchecked'
    ))
);

CREATE INDEX idx_provider_health_status 
    ON provider_health(health_status);
CREATE INDEX idx_provider_health_last_checked 
    ON provider_health(last_checked_at DESC);
```

### 2.3 Extend `models` Table

Add optional fields for:
- `is_pinned_default` (BOOLEAN): Is this model a user-preferred default?
- `fallback_priority` (INT): Order in fallback chain (lower = higher priority)

```sql
ALTER TABLE models
    ADD COLUMN is_pinned_default BOOLEAN DEFAULT FALSE,
    ADD COLUMN fallback_priority INT DEFAULT 999,
    ADD INDEX idx_fallback_priority (fallback_priority);
```

---

## PART 3: VERIFICATION TEST SUITE

### 3.1 Service: `model_verification.py`

**Location:** `backend/app/services/model_verification.py`

**Responsibilities:**
1. Run test suite against a model
2. Store results in `model_verifications` table
3. Generate capability matrix
4. Produce downloadable verification report

**Core Methods:**

```python
async def verify_model(
    model: Model,
    provider: Provider,
    test_suite_version: str = "v1"
) -> ModelVerificationResult:
    """
    Run full verification suite on a model.
    Returns: ModelVerificationResult with status, test_results, capabilities.
    """
    
async def verify_models_batch(
    models: list[Model],
    concurrency: int = 5,
    timeout_per_model: int = 300
) -> dict[str, ModelVerificationResult]:
    """
    Verify multiple models in parallel.
    """
    
async def regression_test_all_verified_models() -> dict[str, ModelVerificationResult]:
    """
    Re-verify all currently-verified models (run before each deploy).
    """
    
def get_verification_report(
    verification: ModelVerification
) -> VerificationReportDTO:
    """
    Generate a human-readable report.
    """
```

**Test Cases:**

```python
# Each test is async, returns (status: 'pass'|'skip'|'fail', details: dict)

async def test_chat_basic(model, provider) -> TestResult:
    """Test basic text chat: "Hello" → response."""
    
async def test_chat_streaming(model, provider) -> TestResult:
    """Test streaming chat: streaming=true → chunks."""
    
async def test_chat_non_streaming(model, provider) -> TestResult:
    """Test non-streaming: streaming=false → single response."""
    
async def test_vision(model, provider) -> TestResult:
    """Test vision (if supported): image + "describe this" → description."""
    
async def test_embeddings(model, provider) -> TestResult:
    """Test embeddings (if supported): text → vector."""
    
async def test_function_calling(model, provider) -> TestResult:
    """Test function calling (if supported): system + functions → calls."""
    
async def test_error_handling(model, provider) -> TestResult:
    """Test error handling: invalid input → correct error format."""
    
async def test_timeout(model, provider) -> TestResult:
    """Test timeout: long prompt → respects timeout."""
    
async def test_rate_limiting(model, provider) -> TestResult:
    """Test rate limiting: burst requests → handles 429."""
    
async def test_auth(model, provider, api_key: str) -> TestResult:
    """Test auth: missing/invalid key → 401."""
    
async def test_connectivity(model, provider) -> TestResult:
    """Test connectivity: endpoint reachable."""
```

### 3.2 Service: `provider_health.py`

**Location:** `backend/app/services/provider_health.py`

**Responsibilities:**
1. Check provider credential validity
2. Check provider connectivity
3. Monitor rate limit status
4. Run background health checks

**Core Methods:**

```python
async def check_provider_health(
    provider: Provider
) -> ProviderHealthStatus:
    """
    Full health check: auth + connectivity + rate limit.
    """
    
async def check_credential_validity(provider: Provider) -> CredentialStatus:
    """
    Verify API key is valid (provider-specific).
    """
    
async def check_connectivity(provider: Provider) -> ConnectivityStatus:
    """
    Verify endpoint is reachable.
    """
    
async def start_background_monitor(interval_seconds: int = 300):
    """
    Background task: periodically check all provider health.
    """
    
async def on_provider_degraded(provider: Provider):
    """
    Callback when provider becomes degraded.
    Removes models from selection pool, alerts user.
    """
```

---

## PART 4: PROVIDER HEALTH CHECK ENDPOINTS

### 4.1 New Routes: `provider_health.py`

**Location:** `backend/app/routes/provider_health.py`

```python
@router.get("/v1/providers/{provider_id}/health")
async def get_provider_health(provider_id: UUID, db: AsyncSession) -> ProviderHealthDTO:
    """
    GET /v1/providers/{provider_id}/health
    
    Returns:
    {
        "provider_id": "...",
        "provider_name": "openai",
        "health_status": "ok" | "degraded" | "failed",
        "credential_status": "valid" | "invalid",
        "connectivity_status": "ok" | "error",
        "last_checked_at": "2026-05-10T12:00:00Z",
        "rate_limit_remaining": 3000,
        "rate_limit_reset_at": "2026-05-10T13:00:00Z",
        "message": "All systems operational",
        "remediation": []
    }
    """

@router.post("/v1/providers/{provider_id}/health/check")
async def check_provider_health(
    provider_id: UUID,
    db: AsyncSession,
    current_user: User = Depends(verify_api_key)
) -> ProviderHealthDTO:
    """
    POST /v1/providers/{provider_id}/health/check
    
    Manually trigger health check for a provider.
    """

@router.get("/v1/providers/health/all")
async def get_all_provider_health(db: AsyncSession) -> list[ProviderHealthDTO]:
    """
    GET /v1/providers/health/all
    
    Returns health status for all providers.
    """

@router.put("/v1/providers/{provider_id}/credential")
async def update_provider_credential(
    provider_id: UUID,
    credential_update: ProviderCredentialUpdate,
    db: AsyncSession
) -> ProviderHealthDTO:
    """
    PUT /v1/providers/{provider_id}/credential
    
    Update provider API key and immediately check health.
    """
```

### 4.2 New Routes: `model_verification.py`

**Location:** `backend/app/routes/model_verification.py`

```python
@router.get("/v1/models/{model_id}/verification")
async def get_model_verification(model_id: UUID, db: AsyncSession) -> ModelVerificationDTO:
    """
    GET /v1/models/{model_id}/verification
    
    Returns:
    {
        "model_id": "...",
        "model_name": "gpt-4o",
        "provider": "openai",
        "verification_status": "verified" | "failed",
        "verified_at": "2026-05-10T10:00:00Z",
        "days_since_verified": 0,
        "capabilities": {
            "chat": true,
            "streaming": true,
            "vision": true,
            "embeddings": false,
            "function_calling": true
        },
        "test_results": {
            "chat_basic": {"status": "pass", "duration_ms": 234},
            "chat_streaming": {"status": "pass", ...},
            ...
        },
        "fallback_recommendations": "If vision needed, use gpt-4-vision...",
        "notes": "..."
    }
    """

@router.post("/v1/models/{model_id}/verify")
async def verify_model(
    model_id: UUID,
    db: AsyncSession,
    current_user: User = Depends(verify_api_key)
) -> ModelVerificationDTO:
    """
    POST /v1/models/{model_id}/verify
    
    Manually trigger verification for a model.
    """

@router.post("/v1/models/verify-all")
async def verify_all_models(
    db: AsyncSession,
    current_user: User = Depends(verify_api_key)
) -> dict[str, ModelVerificationDTO]:
    """
    POST /v1/models/verify-all
    
    Run regression test on all verified models.
    (Run before each deploy.)
    """

@router.get("/v1/models/health-dashboard")
async def get_model_health_dashboard(db: AsyncSession) -> ModelHealthDashboardDTO:
    """
    GET /v1/models/health-dashboard
    
    Returns:
    {
        "total_models": 50,
        "verified": 45,
        "failed": 3,
        "degraded": 2,
        "by_provider": {
            "openai": {"verified": 5, "failed": 0, ...},
            "anthropic": {...},
            ...
        },
        "models": [
            {
                "model_id": "gpt-4o",
                "provider": "openai",
                "verification_status": "verified",
                "success_rate_24h": 0.98,
                "avg_latency_ms": 450,
                "error_count_24h": 1
            },
            ...
        ]
    }
    """
```

---

## PART 5: RUNTIME SELECTION HARDENING

### 5.1 Update: `runtime_model_resolver.py`

**New Methods:**

```python
async def resolve_with_verification(
    model_ref: str,
    feature_required: str,  # "chat", "vision", "embeddings", "streaming"
    db: AsyncSession
) -> ResolveResult:
    """
    Resolve model with verification check.
    
    1. Query verified models matching feature
    2. If none, query degraded models (with warning)
    3. If none, return fallback chain
    4. Log decision (feature, candidates, winner, result)
    """

async def get_verified_models_for_feature(
    feature: str,
    db: AsyncSession
) -> list[Model]:
    """
    Query: WHERE verification_status = 'verified' 
           AND capabilities->'feature' = true
    """

def get_fallback_chain(feature: str) -> list[str]:
    """
    Get prioritized fallback models for feature.
    
    Example:
    get_fallback_chain("vision") 
    → ["gpt-4o", "claude-opus-4-5", "gemini-2.5-pro"]
    """

async def log_selection_decision(
    feature: str,
    candidates: list[Model],
    selected: Model,
    result: "success" | "failure",
    db: AsyncSession
):
    """
    Log model selection decision for debugging.
    """
```

### 5.2 Pin Model Feature

**New Endpoint:**

```python
@router.post("/v1/models/{model_id}/pin-session")
async def pin_model_for_session(
    model_id: UUID,
    session_id: UUID,
    db: AsyncSession
) -> PinResult:
    """
    POST /v1/models/{model_id}/pin-session/{session_id}
    
    User says: "Use this model for this session, don't auto-select."
    """
```

**In Chat / Workbench:** Check if model is pinned before calling resolver.

---

## PART 6: IMPLEMENTATION ROADMAP

### Phase 1: Database & Diagnostics (Week 1)
- [ ] Create migration: `model_verifications` table
- [ ] Create migration: `provider_health` table
- [ ] Extend `models` table with pinning fields
- [ ] Write diagnostic script to test all models
- [ ] Document root cause findings

### Phase 2: Verification Test Suite (Week 2)
- [ ] Implement `model_verification.py` service
- [ ] Implement all 10 test cases
- [ ] Create `ModelVerificationResult` dataclass
- [ ] Write regression test script

### Phase 3: Provider Health Monitoring (Week 2-3)
- [ ] Implement `provider_health.py` service
- [ ] Create provider-specific health check logic
- [ ] Implement background monitor (async task)
- [ ] Wire degradation callbacks

### Phase 4: API & Endpoints (Week 3)
- [ ] Create `provider_health.py` routes
- [ ] Create `model_verification.py` routes
- [ ] Implement model health dashboard
- [ ] Add UI endpoints

### Phase 5: Runtime Hardening (Week 3-4)
- [ ] Update `runtime_model_resolver.py` for verification
- [ ] Implement pin-model feature
- [ ] Add selection decision logging
- [ ] Update chat/workbench to use hardened resolver

### Phase 6: Testing & Validation (Week 4)
- [ ] Run regression test on all models
- [ ] Verify fallback chains work
- [ ] Test credential update flow
- [ ] Stress test with concurrent requests

---

## PART 7: SUCCESS CRITERIA

- [ ] All models in catalog pass verification or are marked as failed
- [ ] Verification state is queryable per model
- [ ] Provider health is monitored in background
- [ ] Model selection is deterministic (same request → same model)
- [ ] Degraded providers are auto-disabled in selection pool
- [ ] Fallback chains work (if primary fails, try secondary)
- [ ] Users can pin a model for a session
- [ ] Model health dashboard shows real-time metrics
- [ ] Selection decisions are logged and queryable
- [ ] Certification process blocks unverified models from marketplace

---

## REFERENCES

- REQUIREMENTS.md (full spec)
- `backend/app/models/model.py` (current schema)
- `backend/app/models/provider.py` (current schema)
- `backend/app/services/runtime_model_resolver.py` (runtime selection)
