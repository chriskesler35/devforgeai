# DevForgeAI Completion Gap Checklist

Updated: 2026-05-10
Baseline commit: 11286bf
Scope source: REQUIREMENTS.md (Pattern 1, Pattern 2, Pattern 3 acceptance criteria)

## Status Legend

- DONE: implemented and wired in runtime behavior
- PARTIAL: implemented in backend or docs only; missing UI, persistence, or full acceptance behavior
- MISSING: not implemented yet

## Pattern 3: Deterministic Model Reliability

1. DONE - Diagnosis suite endpoint + frontend dashboard now surface root-cause signals from verification status, provider health, and selection failures
2. DONE - Verification test suite covers chat, streaming, vision, embeddings, functions, error handling
3. DONE - Verification state stored in DB with status, capabilities, test results
4. DONE - Verification report is downloadable per model (markdown/json) and exposed in Models diagnose modal
5. DONE - Runtime selection logic prioritizes verified models
6. DONE - Fallback chain is ordered and user-configurable via persisted runtime fallback order settings and Models dashboard controls
7. DONE - Session-level model pinning now includes Workbench Pin/Unpin UI wiring with live pin status
8. DONE - Model Health Dashboard now has frontend views for real-time metrics, provider health, and degraded alerts
9. DONE - Selection decisions are durably logged and now surfaced in frontend diagnostics view
10. DONE - Provider health check endpoint exists and works
11. DONE - Provider credential management UI now shows live per-provider health status, credential/connectivity signals, and refresh action
12. DONE - Background health monitoring runs periodically
13. DONE - Degraded provider auto-disabled in model selection with freshness threshold policy and explicit runtime diagnostics/remediation
14. DONE - Global provider-health warning banner includes direct Fix credentials action into Settings -> API Keys with provider focus
15. PARTIAL - Model capability schema is JSON and enforced for model CRUD with key/value validation; broader sync/import enforcement remains
16. PARTIAL - Frontend syncs capability catalog on startup (cached); broader feature consumers still pending
17. PARTIAL - Schema enforcement now returns explicit capability key/type errors for model CRUD; some non-CRUD paths still need harmonized errors
18. DONE - Marketplace install flow now enforces verified trust-level gate (non-verified entries are visible but install-blocked with explicit messaging)
19. DONE - Frontend now performs version-based cache invalidation (periodic + on-focus) against backend catalog version metadata, so webhook-triggered backend updates propagate without waiting full TTL
20. DONE - Provider webhook ingestion now supports external integration hardening (auth token, provider/source normalization, idempotent event handling) with incremental provider refresh

### Pattern 3 Remaining Work Packs

- P3-W1: Durable selection audit trail
  - Add table for selection decisions
  - Persist every resolution attempt (feature, candidates, winner, result)
  - Add query endpoint for diagnostics
- P3-W2: Pin model by session
  - Add endpoint and session persistence
  - Ensure resolver honors session pin ahead of normal chain
- P3-W3: Capability catalog contract and sync
  - Unified backend catalog endpoint with version/hash
  - Frontend startup sync and TTL cache
- P3-W4: Dashboard completion
  - Frontend dashboard views for health and verification
  - Alerts for degraded credentials/providers
- P3-W5: Marketplace gate and webhook
  - Certification requirement before listing
  - Provider webhook ingestion and incremental catalog refresh

## Pattern 1: Agent Transparency and Control

Current summary: foundational agent streams/events exist in workbench and pipeline runtime, but required observability and intervention UX from acceptance criteria is not fully delivered.

1. PARTIAL - Real-time agent state updates exist in runtime event streams; full state badge matrix and lifecycle UX incomplete
2. MISSING - Execution graph (DAG) with live parent-child visualization and animation
3. MISSING - Prompt inspector with full context diff view
4. MISSING - Searchable complete inter-agent transcript UI
5. MISSING - Pause all agents control with guaranteed halting semantics
6. MISSING - Override result flow feeding parent agent
7. MISSING - Retry with modified prompt UX
8. MISSING - Approval gates before spawn (configurable per method/agent)
9. MISSING - Kill cascade impact UX + safe execution
10. MISSING - Confidence scoring + low-confidence verification flow
11. MISSING - Alternative result selection UX
12. MISSING - Dedicated Agent Monitor view and Agent Detail tabs
13. MISSING - Live feed with filter/search and deep-linking

### Pattern 1 Remaining Work Packs

- P1-W1: Canonical agent event model and state machine contract
- P1-W2: Agent Monitor + Agent Detail core views
- P1-W3: Prompt inspector and transcript search
- P1-W4: Intervention controls (pause, override, retry, kill)
- P1-W5: Execution graph + live feed + confidence/alternatives

## Pattern 2: Methods-First Workflows

Current summary: method/workflow concepts exist in backend and UI areas, but acceptance-level flow shaping and UX parity are not complete.

1. PARTIAL - Method entities and workflow machinery exist; method-first UI shaping incomplete
2. MISSING - Complete method selector UX (Chat, GSD, BMAD, gtrack, Custom, Marketplace) with metadata cards
3. PARTIAL - Chat immediate path exists; not fully isolated from run/session complexity in all entry flows
4. MISSING - Full GSD guided flow with live roadmap build experience
5. MISSING - Full BMAD staged flow UI with explicit milestones
6. MISSING - gtrack issue import/mapping/execution UX
7. MISSING - Home page CTA redesign around method-first entry
8. MISSING - Method picker search + installed + marketplace segmentation
9. MISSING - Interactive project creation Q&A with rich progress/breadcrumb/next steps
10. MISSING - Method switching with context handoff guarantees
11. MISSING - Marketplace UX depth (categories, preview, ratings, install loop)
12. MISSING - Post-method feedback collection/aggregation

### Pattern 2 Remaining Work Packs

- P2-W1: Method launcher redesign and information architecture
- P2-W2: Method-specific run surfaces (Chat, GSD, BMAD, gtrack)
- P2-W3: Interactive kickoff/Q&A and roadmap live generation UX
- P2-W4: Method switching and context handoff protocol
- P2-W5: Marketplace and feedback loops

## Completion Order (Recommended)

1. Finish Pattern 3 remaining gaps (P3-W1 through P3-W5) to lock reliability guarantees
2. Build Pattern 1 transparency baseline (P1-W1 through P1-W3)
3. Add Pattern 1 intervention controls and graph/feed (P1-W4 through P1-W5)
4. Deliver Pattern 2 method-first launcher and flows (P2-W1 through P2-W5)

## Immediate Next Sprint (Start Now)

1. Implement P3-W1 durable selection audit trail
2. Implement P3-W2 session-level model pin endpoint and resolver support
3. Implement P3-W3 capability catalog endpoint and frontend startup sync
4. Add tests for Pattern 3 resolver + provider health monitor + verification routes

## Definition of Fully Completed

All acceptance items in REQUIREMENTS.md for Pattern 1, Pattern 2, and Pattern 3 are demonstrably satisfied with:

- backend implementation
- frontend UX implementation where required
- automated test coverage for core behaviors
- docs updated with operational runbooks
