# DevForgeAI Interactive Agentic UI Requirements

**Brainstorm Date:** May 10, 2026  
**Status:** Under Development  
**Priority:** Pattern 1 → Pattern 2 → Pattern 3

---

## TABLE OF CONTENTS

1. [Overview](#overview)
2. [Pattern 1: Agent Transparency & Control](#pattern-1-agent-transparency--control)
3. [Pattern 2: Methods-First Workflows](#pattern-2-methods-first-workflows)
4. [Pattern 3: Deterministic Model Reliability](#pattern-3-deterministic-model-reliability)
5. [Technical Dependencies](#technical-dependencies)
6. [Success Criteria](#success-criteria)

---

## OVERVIEW

DevForgeAI is built on multi-agent orchestration (BMAD, GSD, gtrack, SuperPowers). Currently, end users cannot:
- See if the system is truly running agentically
- Watch agents spawn and interact
- View inter-agent conversations
- Intervene when needed

This document specifies the requirements to transform the UI into a transparent, interactive, agentic experience where **end users always have the final say**.

---

## PATTERN 1: AGENT TRANSPARENCY & CONTROL

### 1.1 AGENT LIFECYCLE VISIBILITY

**Requirement:** Users can see each spawned agent's state in real-time.

#### 1.1.1 Agent State Badges
- States: `IDLE`, `THINKING`, `WAITING_FOR_TOOL`, `YIELDED`, `ERROR`, `PAUSED`, `KILLED`
- Display: Badge on agent card (color-coded, text label)
- Update: Real-time push from backend (WebSocket or Server-Sent Events)
- Timestamp: When agent entered current state

#### 1.1.2 Agent Lifecycle Timeline
- Visual representation: Timeline or waterfall view
- Events: SPAWN → INIT → RECEIVE_PROMPT → EXECUTE → YIELD_RESULT → CLEANUP
- Details per event: timestamp, duration, status (success/error)
- User action: Click event to see details (context injected, model used, tool calls made)

#### 1.1.3 Agent Execution Graph
- Visual: DAG (directed acyclic graph) of agents
- Nodes: Each agent (with ID, method, state badge)
- Edges: Parent → child relationships (labeled with prompt context size or summary)
- Animation: Light pulse or glow when agent is active
- Interaction: Hover to see full prompt; click for conversation transcript

---

### 1.2 PROMPT & CONVERSATION TRANSPARENCY

**Requirement:** Users can see exactly what context and instructions each agent received.

#### 1.2.1 Prompt Inspector
- Button on each agent card: "Show Prompt"
- Display modal or sidebar with:
  - **System Prompt:** Exact text sent to agent
  - **Context Injected:** User context, codebase context, history, etc. (show size and summary)
  - **Diff View:** What changed from parent agent's prompt?
  - **Copy Button:** Export raw prompt to clipboard

#### 1.2.2 Agent Conversation Transcript
- Agent chat history: all turns (user → agent, agent → tool, tool → agent, agent → result)
- Grouped by agent (like Slack threads)
- Syntax highlighting: tool calls vs. text vs. structured data
- Search: "Find which agent made decision X"
- Export: Per-agent or full-session transcript (Markdown or JSON)

#### 1.2.3 Inter-Agent Message Log
- Log of messages between parent and child agents
- Format: `[HH:MM:SS] ParentAgent → ChildAgent: "Prompt summary..." (context_bytes)`
- Filter by agent ID, method, message type
- Expandable rows: Click to see full prompt/result

#### 1.2.4 Context Isolation View
- Question: "What did THIS agent get that the parent didn't?"
- Diff: Context delta between parent and child
- Use case: Debug why an agent made an unexpected decision

---

### 1.3 USER INTERVENTION & CONTROL

**Requirement:** Users can pause, override, retry, and approve agent actions.

#### 1.3.1 Pause & Resume
- Global button: "Pause All Agents"
- Effect: All running agents halt immediately; results in-flight are discarded
- UI feedback: "Paused — [resume]/[reset]/[end session]"
- Per-agent pause: Pause a specific agent while others continue

#### 1.3.2 Override Result
- Button: "Override Result" on yielded agent
- Action: User provides manual input (text, JSON, file) to replace agent's output
- Effect: Parent agent receives overridden result as if agent produced it
- Logging: Record override and reason (user can add annotation)

#### 1.3.3 Retry with Modified Prompt
- Button: "Retry" on failed or unsatisfactory agent
- UI: Text editor with current prompt pre-filled
- User can: Edit prompt, adjust parameters (temperature, max tokens)
- Effect: Re-run agent with modified prompt; old result is discarded

#### 1.3.4 Approval Gates
- Config per method: "Require approval before spawning [agent_type]"
- UI: Modal before agent is spawned: "Spawn Agent X? [Prompt preview] [Approve] [Reject] [Edit]"
- Rejection: Agent is not spawned; parent is notified of rejection

#### 1.3.5 Kill Agent
- Button: "Kill" on any running agent
- Effect: Immediate termination; cascade: determine what fails if killed
- Modal: "Killing Agent X will also kill Y, Z. Proceed? [Yes] [No]"
- Logging: Record kill reason

#### 1.3.6 Undo Last Agent
- Button: "Undo last agent's work"
- Effect: Revert codebase/state to before that agent ran
- Parent: Provided with retry UI to adjust delegation prompt

---

### 1.4 BEHAVIORAL FEEDBACK & ALTERNATIVES

**Requirement:** Users can see agent confidence and choose between alternatives.

#### 1.4.1 Confidence Scoring
- Display: `Confidence: 87%` on agent result
- Basis: Agent self-assessment (model can provide in structured output)
- Color: Green (80+), yellow (60-80), red (<60)
- Action: Low confidence → prompt user for verification

#### 1.4.2 Alternative Results
- If agent generates 3+ alternatives, show them
- UI: Tabs or collapsible list: "Alternative 1", "Alternative 2", "Alternative 3"
- User picks one; non-selected alternatives are discarded
- Logging: Record which alternative was chosen

#### 1.4.3 Result Verification Prompt
- For low-confidence results: Modal before accepting
- "Agent is uncertain (62% confidence). Accept? [Yes] [No] [Show Alternatives] [Override]"

---

### 1.5 AGENT TRANSPARENCY UI COMPONENTS

**Requirement:** Dedicated UI views for agent observability.

#### 1.5.1 Agent Monitor View
- Full-screen or sidebar view: Real-time list of all agents
- Columns: ID, Method, State, Started, Elapsed, Result (preview)
- Sort/filter: By state, method, elapsed time
- Click row: Open agent detail modal

#### 1.5.2 Agent Detail Modal
- Tabs: Lifecycle | Prompt | Conversation | Results | Logs
- Lifecycle: Timeline of events with durations
- Prompt: System + context + diff
- Conversation: Full transcript
- Results: Final output + alternatives + confidence
- Logs: Any debug/trace output

#### 1.5.3 Execution Graph View
- DAG visualization (Mermaid or similar)
- Animated: Pulse when agent is active
- Hover: Show prompt summary
- Click: Open agent detail
- Color coding: By state (idle=gray, active=blue, error=red, yielded=green)

#### 1.5.4 Live Feed
- Timeline feed (like Twitter, newest first)
- Entries: Agent spawned, agent yielded, user overrode result, agent errored
- Expandable: Click to jump to agent detail
- Search: Filter by agent ID, method, keyword

---

### 1.6 PATTERN 1 ACCEPTANCE CRITERIA

- [ ] Agent state badge visible on all running agents
- [ ] Execution graph rendered in real-time with correct parent-child relationships
- [ ] Prompt Inspector shows exact system prompt + context + diff
- [ ] Agent conversation transcripts are complete and searchable
- [ ] Pause All Agents works (all agents halt, no partial results)
- [ ] Override Result modal accepts user input and feeds parent agent
- [ ] Retry with Modified Prompt works (user can edit and re-run)
- [ ] Approval gates fire before agent spawn
- [ ] Kill Agent cascade is correctly calculated
- [ ] Confidence scores display and trigger verification prompts
- [ ] Alternative results are selectable
- [ ] Agent Monitor view shows all agents in real-time
- [ ] Agent Detail modal has all 5 tabs and correct data
- [ ] Execution Graph is animated and color-coded correctly
- [ ] Live Feed updates in real-time and is searchable

---

## PATTERN 2: METHODS-FIRST WORKFLOWS

### 2.1 METHODS AS THE ORGANIZING PRINCIPLE

**Requirement:** Workflows are shaped by user's chosen method, not by CRUD artifacts.

#### 2.1.1 Method Selection
- User action: Click "New Project" or "New Work"
- UI: Show available methods:
  - Chat (no agents, linear conversation)
  - GSD (roadmap-driven phased development)
  - BMAD (discovery → ideation → planning → handoff → dev)
  - gtrack (issue/project mapping to agents)
  - Custom (user-chained methods)
  - Marketplace-installed methods

#### 2.1.2 Method Card Display
- Icon: Visual representation of method
- Title: Method name
- Description: One-liner
- Estimated Duration: "30 min – 2 hours"
- Required Context: "Codebase + Project Goal"
- Sample Roadmap: Collapsible preview of expected phases/steps
- CTA: "Use This Method"

#### 2.1.3 Chat (No Methods)
- Immediate, no overhead
- No Run / Session / Project creation UI
- User chats naturally; model responds
- Backend treats as single-agent conversation
- No inter-agent spawning unless user explicitly asks

#### 2.1.4 GSD Method Flow
1. **Brief Context Gathering:** Agent asks 3–5 high-level questions
   - Project name, goal, scope, constraints
2. **Auto-Build Roadmap:** Agent produces GSD roadmap (phases + success criteria)
   - Show in real-time (not "working..." → dump)
3. **User Review:** "Does this roadmap match your intent? [Yes] [Modify] [Restart]"
4. **Phase-by-Phase Execution:**
   - One phase at a time (GSD per-phase design)
   - Progress indicator: "Phase 3 of 8"
   - User can jump to a step or rewind

#### 2.1.5 BMAD Method Flow
1. **Discovery:** Agent gathers product/domain context
2. **Ideation:** Agent brainstorms solutions
3. **Planning:** Agent produces specs (PRD, UX, architecture, epics)
4. **Handoff:** Agent prepares dev-ready artifacts
5. **Dev:** User picks which spec to implement first

#### 2.1.6 gtrack Method Flow
1. **Issue/Project Import:** User selects existing issue or project
2. **Auto-Map:** Agent maps issue to BMAD/GSD/custom agents
3. **Execution:** Follow agent-driven flow

#### 2.1.7 Custom Method Chains
- User selects 2+ methods to chain: "GSD Discovery → BMAD Design → Marketplace Agent for testing"
- Backend builds meta-agent that orchestrates the chain
- Flow shows progress across all methods
- Clear handoff points between methods

---

### 2.2 WORKFLOW-SPECIFIC UI SHAPES

**Requirement:** Each method has a tailored UI, not one-size-fits-all.

#### 2.2.1 Chat UI
- Familiar: Text input, response output
- No Run / Session / Project overhead
- Optional: Toggle "show advanced" for agentic controls (rarely used)

#### 2.2.2 GSD UI
- Left sidebar: Roadmap with phases
- Main panel: Current phase details + execution
- Right panel: Agent Monitor (showing current phase agents)
- Control: Play (start phase) / Pause / Jump to phase
- Progress: Visual indicator of phase completion

#### 2.2.3 BMAD UI
- Multi-panel: Discovery | Ideation | Planning | Handoff | Dev
- Current panel highlighted
- Prev/Next buttons (can skip ahead)
- Right panel: Agent Monitor
- Button to export specs

#### 2.2.4 gtrack UI
- Sidebar: Issue list + current issue detail
- Main panel: Agent-driven execution for current issue
- Mapping view: Issue → Agents (visual)
- Bulk actions: Batch-process multiple issues

---

### 2.3 PROJECT ENTRY POINT REDESIGN

**Requirement:** Clean separation of Chat vs. Agentic workflows.

#### 2.3.1 Home / Dashboard
- Three big CTAs:
  1. **"Chat"** (icon: speech bubble) → Immediate chat, no overhead
  2. **"Pick a Method"** (icon: puzzle piece) → Method selection
  3. **"Use Template"** (icon: template) → Pre-built workflows

#### 2.3.2 Pick a Method Flow
- Modal or new page showing all methods
- Search / filter: By domain (web, game, data, etc.)
- Browse installed: Built-in methods (Chat, GSD, BMAD, gtrack)
- Browse marketplace: Community methods
- Install new: One-click install + auto-use

#### 2.3.3 Method → Project Creation
- User picks method
- System spawns agent with method context
- Agent asks wizard-style questions (but interactive, not form-based)
- User answers in rich UI (text, file upload, GitHub repo selector, etc.)
- Agent builds roadmap/plan in real-time
- "Ready to start" CTA appears when context is sufficient

#### 2.3.4 Execution Start
- "Start Building" button reveals method-specific UI
- First agent spawns with context + method
- Agent Monitor appears automatically

---

### 2.4 VISUAL GUIDANCE & PROGRESS

**Requirement:** Users always know where they are and what happens next.

#### 2.4.1 Progress Indicator
- Per-method: Show current step in method flow
- GSD: "Phase 3 of 8 (38%)" with visual bar
- BMAD: "Planning stage (step 3 of 5)"
- Ability to expand: See all phases/steps at once

#### 2.4.2 Context Persistence
- Current method/goal visible in header
- Breadcrumb: Chat > New Project > GSD > Phase 3
- Easy to jump back to previous context

#### 2.4.3 Next Steps UI
- "What Happens Next?" section
- Shows preview of next phase/step
- Expected duration, what agent will do, user inputs needed
- "Skip ahead" or "restart" options

#### 2.4.4 Method Switching
- Users can switch methods mid-project (e.g., GSD discovery → BMAD design)
- Confirmation: "Switch to BMAD? Current phase progress will be saved."
- Seamless handoff: Next agent receives all prior context

---

### 2.5 MARKETPLACE & METHOD DISCOVERY

**Requirement:** Users can discover, install, and use custom methods.

#### 2.5.1 Marketplace Browse
- Dedicated UI: "Method Marketplace"
- Categories: Web, Game, Data, APIs, Testing, etc.
- Cards: Icon, title, description, ratings, install count, "Preview" + "Install" buttons

#### 2.5.2 Method Preview
- Sample roadmap / flow diagram
- Video walkthrough (if provided by author)
- Real example: "See how this method was used to build X"
- Reviews / feedback: "This method helped me ship faster"

#### 2.5.3 Install & Auto-Use
- One-click install
- Auto-opens "Use This Method?" modal
- "Install + Start" is one action
- Installed methods appear in method picker on next new project

#### 2.5.4 Feedback Loop
- After using a method: "How was this method? [Excellent] [Good] [OK] [Poor]"
- Optional: Leave review
- Star rating aggregated on marketplace card

---

### 2.6 PATTERN 2 ACCEPTANCE CRITERIA

- [ ] Method selector shows Chat, GSD, BMAD, gtrack, Custom, Marketplace options
- [ ] Method cards display icon, description, duration, required context, sample roadmap
- [ ] Chat method is immediate with no Run/Session overhead
- [ ] GSD flow: context gather → roadmap → review → phase execution
- [ ] BMAD flow: discovery → ideation → planning → handoff → dev
- [ ] gtrack flow: import issue → map to agents → execute
- [ ] Custom chains: 2+ methods can be chained with clear handoff points
- [ ] Chat UI: Text input/output only (no agentic overhead)
- [ ] GSD UI: Sidebar roadmap, main panel phase details, right panel agent monitor
- [ ] BMAD UI: Multi-panel (Discovery | Ideation | Planning | Handoff | Dev)
- [ ] gtrack UI: Sidebar issues, main execution, mapping view
- [ ] Home page has three big CTAs: Chat, Pick Method, Use Template
- [ ] Method picker has search, installed list, marketplace list
- [ ] Method → project creation is interactive (agent asks questions in rich UI)
- [ ] Roadmap builds in real-time (not "working..." → dump)
- [ ] Progress indicator visible and accurate
- [ ] Breadcrumb shows current context
- [ ] "Next Steps" preview shows what's coming
- [ ] Method switching mid-project works with context handoff
- [ ] Marketplace has categories, cards, preview, install, ratings
- [ ] Post-method feedback is collected and aggregated

---

## PATTERN 3: DETERMINISTIC MODEL RELIABILITY

### 3.1 ROOT CAUSE DIAGNOSIS

**Requirement:** Understand why model behavior is inconsistent before fixing it.

#### 3.1.1 Diagnosis Checklist
Document current hit-or-miss behavior by testing:

- **Credential Injection Timing:** Are env vars / DB creds available at request time?
- **Schema Mismatch:** Model expects JSON but receives XML? Streaming vs. non-streaming mismatch?
- **Provider Switching:** Is the same model_id available under multiple providers? Is selection deterministic?
- **Cold-Start / Connection:** Does first call fail, retry succeeds? Connection pooling issues?
- **Rate Limiting:** Are we hitting rate limits and misattributing to "model doesn't work"?
- **Partial API Migration:** Is the new endpoint partially deployed? Old vs. new schema?
- **Model Capabilities:** Is the selected model actually capable of the requested feature (vision, functions, streaming)?

**Action:** Run diagnostic suite on all models in catalog. Document findings per model.

---

### 3.2 DETERMINISTIC MODEL VERIFICATION

**Requirement:** Verification = deterministic, repeatable model testing.

#### 3.2.1 Verification Test Suite
- Tests per model:
  - **Basic Chat:** Text input → text output
  - **Streaming:** Request streaming=true → receive streamed chunks
  - **Non-Streaming:** Request streaming=false → receive single response
  - **Vision:** Image input → description (if model supports)
  - **Embeddings:** Text → vector output (if model supports)
  - **Function Calling:** System prompt + functions → structured calls
  - **Error Handling:** Invalid input → correct error format
  - **Timeout:** Long prompt → respects timeout
  - **Rate Limiting:** Repeat calls → correct 429 handling

#### 3.2.2 Verification State in Database
- Table: `model_verifications`
- Columns:
  - `model_id` (text)
  - `provider` (text) 
  - `verification_status` (VERIFIED | FAILED | PENDING | DEGRADED)
  - `verified_at` (timestamp)
  - `verified_by` (test suite version or manual)
  - `capabilities` (JSON: {chat, streaming, vision, embeddings, functions})
  - `test_results` (JSON: {test_name: passed/failed})
  - `notes` (text, e.g., "Vision support broken since API change")

#### 3.2.3 Verification Report
- Downloadable / viewable per model
- Shows:
  - Test results (passed/failed with details)
  - Capability matrix (chat ✓, vision ✗, streaming ✓)
  - Timestamps
  - Known limitations
  - Fallback recommendations

#### 3.2.4 Verification Lifecycle
- **On Add:** Run full test suite before adding to catalog
- **On Deploy:** Re-verify all models in regression test
- **Periodically:** Weekly background verification of active models
- **On Error:** If model fails in production, trigger verification

---

### 3.3 HARDENED RUNTIME MODEL SELECTION

**Requirement:** Once verified, always use verified model. Fail gracefully if not.

#### 3.3.1 Selection Logic
```
1. Requested feature (e.g., "need vision model")
2. User preference (pinned model, prior successful model)
3. Query verified models: WHERE capability matches AND status = VERIFIED
4. If no match: Query DEGRADED models (with warning to user)
5. If still no match: Fallback chain (prioritized list of known-good models)
6. All fails: Show user which models were tried and why each failed
```

#### 3.3.2 Fallback Chain
- Per-feature (vision, chat, embeddings):
  - Primary: [model A]
  - Secondary: [model B]
  - Tertiary: [model C]
  - User-configurable: Can reorder fallback chain

#### 3.3.3 Pin Model
- UI button: "Pin this model for this session"
- Effect: Always use THIS model, bypass selection logic
- Use case: "I know GPT-4 works for me, use it"
- Session-level: Does not affect other sessions

#### 3.3.4 Model Health Dashboard
- Real-time metrics per model:
  - Success rate (last 24h, 7d, 30d)
  - Avg latency
  - Error count (by type: timeout, rate_limit, invalid_auth, etc.)
  - Last verified: timestamp + status
- UI:
  - List view with status indicators (green=healthy, yellow=degraded, red=failing)
  - Click for detailed metrics
  - Filter by provider, status, feature

#### 3.3.5 Runtime Selection Logging
- Log every model selection decision:
  - Requested feature
  - Available candidates
  - Selection winner + reason
  - Result (success/failure)
- Use for: Debugging "model selection behaves differently than expected"

---

### 3.4 PROVIDER CREDENTIAL ISOLATION

**Requirement:** Each provider's credentials are isolated and monitored independently.

#### 3.4.1 Provider Health Check Endpoint
- Per provider: `GET /v1/providers/{provider_id}/health`
- Checks:
  - Credential validity (can authenticate?)
  - API reachability
  - Rate limit status
  - Known incidents (query provider status page?)
- Returns: `{status: "ok" | "degraded" | "failed", message, last_checked}`

#### 3.4.2 Credential Management UI
- Dedicated page per provider: "OpenAI", "Anthropic", "OpenRouter", etc.
- Shows:
  - Current credential (masked): "sk-...abcd"
  - Health: Green / Yellow / Red
  - Last verified: timestamp
  - Actions: "Test Credential" | "Update Credential" | "Remove"
- "Test Credential" → runs health check, shows result

#### 3.4.3 Background Health Monitoring
- Periodic check (every 5 min or configurable):
  - Ping each provider's health endpoint
  - If status changes (ok → degraded): Alert user
  - If degraded > 1 hour: Auto-disable provider in model selection

#### 3.4.4 Credential Failure Handling
- If credential fails:
  - Mark provider as DEGRADED
  - Remove from model selection pool (unless user pins a model from that provider)
  - Show banner: "OpenAI credentials invalid; OpenAI models removed from selection. [Fix Credentials]"
  - Allow override: "I know my credentials are good, use anyway"

#### 3.4.5 Credential Secrets Management
- Credentials stored encrypted in DB
- Rotation: Support credential rotation without rebuilding
- Scope: Per-provider (one credential per provider, or multiple if provider supports it)

---

### 3.5 CATALOG CONSISTENCY

**Requirement:** Single source of truth for model capabilities; enforce schema consistency.

#### 3.5.1 Model Capability Declaration
- JSON schema per model:
  ```json
  {
    "model_id": "gpt-4",
    "provider": "openai",
    "capabilities": {
      "chat": true,
      "streaming": true,
      "vision": true,
      "embeddings": false,
      "function_calling": true
    },
    "limits": {
      "max_tokens": 128000,
      "context_window": 128000
    }
  }
  ```

#### 3.5.2 Frontend Capability Awareness
- Frontend syncs capability catalog on startup
- Frontend queries locally before asking backend
- Example: "User requests vision → check frontend catalog → only show models where vision=true"
- Reduces backend load + faster feedback

#### 3.5.3 Schema Enforcement
- Backend enforces: "You requested vision from a non-vision model"
- Returns clear error: `{error: "Model gpt-3.5-turbo does not support vision. Try: [gpt-4, claude-3-vision, ...]}"`
- No silent failures or degraded-mode behavior

#### 3.5.4 Marketplace Model Certification
- Models added to marketplace must:
  - Pass full verification suite
  - Declare capabilities accurately
  - Provide provider API documentation link
  - Include fallback recommendations
- Listing: Only after certification passes

#### 3.5.5 Catalog Sync Protocol
- Backend: Source of truth
- Frontend: Syncs on startup + periodic refresh (30 min)
- Webhook: Provider sends "new model available" → backend updates catalog → frontend syncs
- Client-side cache: Catalog stored in IndexedDB with TTL

---

### 3.6 PATTERN 3 ACCEPTANCE CRITERIA

- [ ] Diagnosis suite identifies root cause of hit-or-miss behavior
- [ ] Verification test suite covers chat, streaming, vision, embeddings, functions, error handling
- [ ] Verification state stored in DB with status, capabilities, test results
- [ ] Verification report is downloadable per model
- [ ] Runtime selection logic prioritizes verified models
- [ ] Fallback chain is ordered and user-configurable
- [ ] Pin Model button works (session-level override)
- [ ] Model Health Dashboard shows real-time metrics
- [ ] Selection decisions are logged (feature, candidates, winner, result)
- [ ] Provider health check endpoint exists and works
- [ ] Provider credential management UI shows status and actions
- [ ] Background health monitoring runs periodically
- [ ] Degraded provider is auto-disabled in model selection
- [ ] Credential failure shows alert + fix action
- [ ] Model capability schema is JSON and enforced
- [ ] Frontend syncs capability catalog on startup
- [ ] Schema enforcement returns clear error messages
- [ ] Marketplace models require verification + capability declaration
- [ ] Catalog sync protocol works (backend source → frontend cache)
- [ ] Provider webhook triggers catalog update

---

## TECHNICAL DEPENDENCIES

### Pattern 1 → Pattern 2 → Pattern 3

**Pattern 1 (Agent Transparency):**
- Requires: WebSocket or SSE for real-time agent state updates
- Requires: Agent lifecycle event stream from backend
- Requires: Prompt + context storage per agent execution
- Requires: Agent result + alternatives storage

**Pattern 2 (Methods-First):**
- Requires: Method registry (CRUD for methods)
- Requires: Method → workflow schema (GSD, BMAD, etc.)
- Requires: Agent spawning with method context
- Requires: Project / Session / Workspace model refinement (may not need all three)
- Depends on: Pattern 1 (agent transparency UI components)

**Pattern 3 (Model Reliability):**
- Requires: Model verification test suite infrastructure
- Requires: Verification state DB schema
- Requires: Provider health check endpoints
- Requires: Credential management endpoints + UI
- Does not depend on: Patterns 1 or 2 (can be built in parallel)

### Recommended Build Order

1. **Pattern 3 (Model Reliability)** — run in parallel
   - Root cause diagnosis
   - Verification test suite
   - DB schema updates
   - Provider health checks
   - *Unblocks all downstream work by ensuring models are reliable*

2. **Pattern 1 (Agent Transparency)**
   - WebSocket / SSE infrastructure
   - Agent event stream
   - UI components (Agent Monitor, Execution Graph, Prompt Inspector)
   - Control actions (Pause, Override, Retry)

3. **Pattern 2 (Methods-First)**
   - Method registry
   - Workflow schemas (GSD, BMAD, gtrack)
   - UI shape-shifting per method
   - Home page redesign

---

## SUCCESS CRITERIA

### Overall
- [ ] End users can see all spawned agents in real-time
- [ ] End users can see inter-agent conversations
- [ ] End users can intervene at any point (pause, override, retry, kill)
- [ ] Models work reliably once verified (no hit-or-miss)
- [ ] Project creation is method-driven, not CRUD-driven
- [ ] Chat users are not forced into Run/Session complexity

### Pattern 1
- [ ] Agent Monitor shows all active agents
- [ ] Execution Graph is animated and correct
- [ ] Pause All halts all agents
- [ ] Override Result feeds parent agent
- [ ] Confidence scores and alternatives work
- [ ] Agent transcripts are complete and searchable

### Pattern 2
- [ ] Method picker has 6+ methods (Chat, GSD, BMAD, gtrack, Custom, Marketplace)
- [ ] GSD flow produces roadmap in real-time
- [ ] BMAD flow shows all 5 stages
- [ ] Chat method requires no Run/Session
- [ ] Method-specific UI shapes are distinct and usable
- [ ] Method switching mid-project works

### Pattern 3
- [ ] All models in catalog pass verification
- [ ] Model selection is deterministic
- [ ] Degraded providers are auto-disabled
- [ ] Fallback chains work
- [ ] Provider credentials are manageable per provider
- [ ] Model capability schema is enforced

---

## REFERENCES

- Repository: [DevForgeAI GitHub](https://github.com/chriskesler35/devforgeai)
- Current runtime resolver: `backend/app/services/runtime_model_resolver.py`
- Current workbench: `backend/app/routes/workbench.py` + `frontend/src/app/(main)/workbench/`
- Documentation: `docs/index.md`

---

**Last Updated:** 2026-05-10
