# Design — Sidebar IA + URL Migration (Doc 2 of 2)

> **Date:** 2026-05-12
> **Status:** **Implemented** (2026-05-13). Sections 1-5 are binding decisions; Section 6 was executed as Chunk 12 of the Run implementation plan. Phase B cleanup (§6.3) deferred 30 days.
> **Companion:** [Doc 1 — The Run](./2026-05-12-the-run-design.md). Doc 1 establishes the Run as a polymorphic first-class entity (chat ⇄ method-driven ⇄ mixed). Doc 2 decides where in the IA the Run viewer lives, what survives in the sidebar, and how today's URLs migrate without breaking deep links.
> **Implementation plan reference:** [docs/superpowers/plans/2026-05-12-the-run-implementation.md](../plans/2026-05-12-the-run-implementation.md) — Chunk 12 in that plan is the placeholder this doc replaces.

---

## 1. Context

### What the sidebar looks like today

`frontend/src/app/Navigation.tsx` ships 16 top-level items in 3 groups:

| Group  | Items |
|--------|-------|
| MAIN   | Dashboard `/`, Chat `/chat`, Runs `/runs`, Projects `/projects` |
| CREATE | Create `/create`, Agents `/agents`, Personas `/personas`, Gallery `/gallery`, Methods `/methods`, Marketplace `/marketplace`, Installed Skills `/skills/installed` |
| MANAGE | Collaborate `/collaborate`, Models `/models`, Stats `/stats`, Settings `/settings`, Help `/help` |

Plus a `NowLauncher` button (above the nav list) and an `ActiveRunsIndicator` badge.

Routes that overlap conceptually with "a Run":

- `/chat` and `/chat/:id` — conversation surface.
- `/runs` — index that today shows pipelines + workbench sessions side-by-side.
- `/workbench/:id` — multi-agent pipeline viewer.
- `/agents/:id` — single-agent run-mode page.
- `/agents/sessions` — agent run history.
- `/bmad`, `/gsd` — method launchers that ultimately create workbench pipelines.

After Doc 1 ships, **all of those are the same thing**: a Run. The sidebar must reflect that, but without nuking accreted bookmarks, deep links, and muscle memory.

### What Doc 1 already decided

- A Run is the unit of work. `/runs/:id` is the universal viewer.
- `/now` is the bird's-eye grid (cards-by-project).
- The viewer has an in-place rail; the sidebar is not the rail.
- Scratch project always exists; casual chats land there.

This doc inherits all of that.

---

## 2. Decisions (the IA log)

Each row is a binding decision. Override requires reopening the brainstorm.

| # | Decision | Choice | Rationale |
|---|---|---|---|
| Q1 | What replaces today's MAIN section? | **A — `Now` + `Projects` + `Chat shortcut`** | `Now` is the front door (grid). `Projects` stays as the persistent organizer. Chat becomes a shortcut that creates a new Scratch Run rather than its own surface. |
| Q2 | Does the sidebar keep "Runs"? | **No — fold into `Now`** | `/runs` already redirects to `/now` (Doc 1 Chunk 8). The label `Runs` plus `Now` would be two doors to the same room. |
| Q3 | Does the sidebar keep `Chat`? | **Yes — as an action, not a surface** | Clicking "Chat" creates a new empty Run in Scratch and navigates to `/runs/:id`. Users keep their mental model; the surface unifies. |
| Q4 | Where do BMAD / GSD / Methods go? | **One item: `Methods`. Method-specific launchers (`/bmad`, `/gsd`) collapse into method picker entry points.** | Two-tier nav was a smell. The picker is the right primitive. |
| Q5 | Workbench? | **Removed from sidebar; URL redirects** | Workbench was the I2/I3 implementation; in the Run viewer those affordances live in the live-agents pane and power tools. No separate destination is needed. |
| Q6 | Agents item? | **Stays — but as the catalog, not a runner** | `/agents` is the "library of agent definitions." Running an agent creates a Run. The agent detail page gets a "Start Run" button instead of being a runner itself. |
| Q7 | Redirect strategy for legacy URLs | **Hard 301-equivalent client redirect with a 30-day deprecation banner** | Doc 1 Chunk 12 placeholder used soft cross-links. We escalate to redirects because keeping two viewers in sync is a bug farm. |
| Q8 | Where does the "create something" verb live? | **`/create` stays** | Image creation, project setup wizard, model adds — these are not Runs. They stay as their own entry point. Future review can fold them in if `/now` grows a "create" affordance. |
| Q9 | Group structure | **WORK / BUILD / MANAGE (3 groups, 11 items)** | Net 5 items removed. See §3. |
| Q10 | Mobile / collapsed sidebar behavior | **Collapsed shows icons only; the `Now` icon doubles as the active-runs badge** | Reuses `ActiveRunsIndicator` glyph. No second affordance fighting for the slot. |
| Q11 | URL canonicalization timing | **Phase A: launch redirects + banner; Phase B (30 days): drop legacy route files** | Phase B is a follow-up commit, not blocked on Phase A. |

---

## 3. The new sidebar IA

### 3.1 Item set

| Group  | Item | Path | Replaces / changes |
|--------|------|------|--------------------|
| WORK   | **Now**      | `/now`            | Doc 1's grid. Active-runs badge attaches to this icon. |
| WORK   | **Projects** | `/projects`       | Unchanged surface; Scratch is always pinned at top of the list. |
| WORK   | **Chat**     | action button     | Posts `POST /v1/runs {project_id: 'scratch'}` and navigates to `/runs/:id`. NO standalone surface. |
| BUILD  | **Create**   | `/create`         | Unchanged. |
| BUILD  | **Agents**   | `/agents`         | Catalog only; detail page replaces "Run" button with "Start Run". |
| BUILD  | **Personas** | `/personas`       | Unchanged. |
| BUILD  | **Methods**  | `/methods`        | Catalog only; `/bmad`, `/gsd` redirect to `/methods?launch=bmad|gsd`. |
| BUILD  | **Gallery**  | `/gallery`        | Unchanged. |
| BUILD  | **Marketplace** | `/marketplace` | Unchanged. (Installed Skills moves under it as nested — already nested today.) |
| MANAGE | **Models**   | `/models`         | Unchanged. |
| MANAGE | **Collaborate** | `/collaborate` | Unchanged. |
| MANAGE | **Stats**    | `/stats`          | Unchanged. |
| MANAGE | **Settings** | `/settings`       | Unchanged. |
| MANAGE | **Help**     | `/help`           | Unchanged. |

**Items removed from the sidebar (NOT from the app — still reachable via deep link / search):**

- `/runs` (folds into `Now`).
- `/workbench` (Run viewer is the workbench).
- `/bmad`, `/gsd` (collapse into `Methods`).
- `/agents/sessions` (the per-agent history view; reachable from the agent detail page + filtered `/now` queries).
- `/skills/installed` as a top-level (stays nested under Marketplace, just not in the top group list).

**Net change:** sidebar drops from 16 items to 14 visible (Chat is an action button below the nav list, not a list item). The WORK group is now 2 items + 1 action; the visual weight matches its priority.

### 3.2 The Chat action button

Renders below WORK group, above BUILD. Visually distinct (filled background, accent color) to signal "this does something" vs. "this navigates." Implementation:

```tsx
<button
  onClick={async () => {
    const run = await createRun({ project_id: 'scratch' })
    router.push(`/runs/${run.id}`)
  }}
  className="..."
>
  💬 New chat
</button>
```

When `collapsed = true`, the button shrinks to the `💬` glyph with the same behavior.

### 3.3 The Now badge

`Now` is the only nav item that carries a live counter (active non-terminal Runs not in `awaiting_input` — i.e., runs that need user attention OR are actively working). Reuses `ActiveRunsIndicator`'s data source but renders inline as a pill to the right of the label (or as a dot on the icon when collapsed). The current `ActiveRunsIndicator` component (rendered separately above the nav) is removed — its job moves into the `Now` nav cell.

### 3.4 Mobile / collapsed behavior

Collapsed sidebar (`w-[60px]`) shows icons only. No tooltips change semantically. The `Now` icon's count badge becomes a dot when collapsed (matching today's `ActiveRunsIndicator` pattern).

---

## 4. URL migration matrix

This is the canonical table the implementation references. **Every legacy route gets exactly one action** — redirect (301-equivalent client redirect), preserve, or remove.

| Legacy URL | Action | Target | Notes |
|------------|--------|--------|-------|
| `/runs` (index)              | Redirect | `/now` | Already redirected per Doc 1 Chunk 8. |
| `/runs/:id`                  | **Preserve** | (no change) | This is the Run viewer per Doc 1. |
| `/runs/new`                  | **Preserve** | (no change) | Invocation page per Doc 1. |
| `/runs/:id/events/:eventId`  | **Preserve** | (no change) | Deep link to T3 drawer per Doc 1. |
| `/chat`                      | Redirect | `/runs/new?project=scratch` | The `/runs/new` page handles the POST + onward redirect to `/runs/:id`. |
| `/chat/:id`                  | Redirect | `/runs/:companionRunId` | Via `GET /v1/runs/by-legacy?type=chat&id=:id`. If no companion exists yet (chat created before adapter), backend creates one on-demand. |
| `/workbench`                 | Redirect | `/now?filter=method` | Filter pre-applied to highlight method-driven Runs. |
| `/workbench/:id`             | Redirect | `/runs/:companionRunId` | Via `GET /v1/runs/by-legacy?type=pipeline&id=:id`. |
| `/workbench/pipelines`       | Redirect | `/now?filter=method` | Same as `/workbench`. |
| `/workbench/builder`         | Redirect | `/methods` | "Build a method" → method catalog. |
| `/agents`                    | **Preserve** | (no change) | Now a catalog page. |
| `/agents/:id`                | **Preserve** with internal change | (no change) | Adds "Start Run" button; removes inline runner UI in a separate commit. |
| `/agents/:id/run` (if exists)| Redirect | `/runs/new?agent=:id` | Creates a Run pre-attached to that agent's default behavior. |
| `/agents/sessions`           | Redirect | `/now?type=session` | Filter chip for single-agent Runs. |
| `/bmad`                      | Redirect | `/methods?launch=bmad` | The Methods page opens the launcher modal pre-filled to BMAD. |
| `/gsd`                       | Redirect | `/methods?launch=gsd` | Same pattern. |
| `/conversations`             | Redirect | `/now?type=chat` | Filter chip for chat-shaped Runs. |
| `/conversations/:id`         | Redirect | `/runs/:companionRunId` | Same as `/chat/:id`. |
| `/skills/installed`          | **Preserve** | (no change) | Reachable from Marketplace + direct link. |
| `/projects`, `/projects/:id` | **Preserve** | (no change) | |
| All other routes             | **Preserve** | (no change) | Settings, Stats, Models, Help, etc. |

### 4.1 Companion-Run lookup contract

`GET /v1/runs/by-legacy?type=<chat|pipeline|session>&id=<legacy_id>` — already added in Doc 1 plan Chunk 12 as `Task 12.1 Step 3`. Doc 2 promotes this from "soft cross-link helper" to **a load-bearing redirect mechanism** with these guarantees:

1. **Always returns a Run.** If a companion doesn't exist (legacy row pre-dates the adapter), the endpoint creates one synchronously by replaying the legacy row's persisted events into `run_events`. The replay is idempotent — repeated calls return the same `run_id`.
2. **404 only when the legacy id itself is unknown.** Frontend then renders a "This link is no longer valid" page with a button to `/now`.
3. **Caching.** Response is cacheable for 1h client-side (it's immutable once created). Send `Cache-Control: private, max-age=3600`.

### 4.2 Deprecation banner

When a user lands on the new URL via a redirect, the destination page shows a sticky banner at top for the duration of the session:

> 💡 You followed an old link. **Chat / Workbench / etc.** now lives under **the Run** at this URL — bookmark this one going forward. [Dismiss]

Implementation: a `<RedirectedFromBanner>` component that reads `?from=<legacyPath>` query param (set by the redirect shim) and renders accordingly. Dismissing sets a per-`legacyPath` flag in `localStorage` so subsequent redirects of the same shape stay silent.

After 30 days (Phase B — §6.3), the legacy route files are deleted entirely; the redirect happens via `next.config.js` rewrites, not page-level shims. The banner stays.

---

## 5. Edge cases and non-decisions

### 5.1 Cases handled explicitly

1. **A legacy URL is visited offline / backend down.** Page shim shows a friendly "Try again when online" with a link to `/now` (which has its own offline shell).
2. **Companion-Run creation fails mid-replay.** Surface the error on the destination page; do NOT fail-closed to a 404. User can still navigate to `/now`.
3. **External integrations that POST to legacy backend routes** (`/v1/pipelines`, `/v1/workbench/sessions`) are NOT changed by Doc 2. Backend route surface is API surface — backward compatibility is the contract. Doc 2 changes only the **frontend URL surface**.
4. **Search engine indexing.** This is an authenticated app; no public crawling. No SEO concern. Skip canonical link tags.
5. **VS Code extension** (`extension/`). The extension constructs links via `frontend.openRun(runId)` helpers (or equivalent). If it constructs `/chat/:id` URLs directly, update those call sites — Chunk 4 task below.
6. **Browser back button across a redirect.** Implementation uses `router.replace` (not `router.push`) for the redirect so Back doesn't loop user back into the redirector.

### 5.2 Intentionally NOT decided here

- **`/conversations` long-term fate.** Today the surface is essentially a "saved chats" list. After redirect to `/now?type=chat`, the surface is gone. If users miss a non-grid list view, a future change can add a list toggle to `/now`. Not blocking.
- **`/create` deeper integration.** Could become a launcher modal triggered from `/now`. Out of scope for this doc.
- **Search box in the sidebar.** A long-standing wishlist item; orthogonal to IA shape. Defer.
- **Per-project pinned chats.** Replacing what the old `/conversations` "pinned" surface offered. Folds into the Run model via `runs.metadata.pinned` (future change).

---

## 6. Migration plan (handoff to implementation)

This section is the **executable spec** the implementation plan (Chunk 12 of [the Run plan](../plans/2026-05-12-the-run-implementation.md)) replaces wholesale. Each numbered phase corresponds to a chunk of work; the implementer adds checkbox steps.

### 6.1 Phase A — Redirects + banner + sidebar change (one PR)

Goal: legacy URLs all forward, sidebar reflects new IA, no legacy route files deleted yet.

1. **Backend.** Promote `GET /v1/runs/by-legacy` from optional helper to documented endpoint. Add the on-demand companion-Run replay path. Cover with a test that calls it for an existing-pipeline id, a never-replayed pipeline id, and an unknown id.
2. **Frontend redirect shims.** For each legacy route in §4 marked "Redirect," replace the page body with a tiny client component that:
   - Reads route params.
   - Calls `by-legacy` if needed.
   - Calls `router.replace(target + '?from=<legacyPath>')`.
   - Renders a one-line "Redirecting…" while in flight.
3. **`RedirectedFromBanner` component.** New shared component, mounted in the `(main)` layout. Reads `?from=` once, persists dismissal in `localStorage`.
4. **Sidebar update.** Modify `Navigation.tsx` per §3.1:
   - Drop `Runs` item; rename `NowLauncher` semantics to a full nav item.
   - Replace top-level `Chat` link with a Chat action button.
   - Drop `Skills/Installed` from top-level group list (it's already aliased under Marketplace via `NESTED_UNDER`).
   - Remove `ActiveRunsIndicator` standalone; render its count inside the new `Now` nav cell.
   - Update `ACTIVE_ALIASES` so `/now` is the canonical active route for everything Run-flavored: `'/now': ['/runs', '/workbench', '/chat', '/conversations', '/bmad', '/gsd', '/agents/sessions']`.
5. **`/agents/:id` page update.** Replace any inline "Run" controls with a "Start Run" button that calls `POST /v1/runs {method_id: null, project_id: <user-pick>, agent_id: <id>}` (extend Run create body if needed) and navigates to the new Run.
6. **`/methods` page launcher.** Read `?launch=<methodId>` query param on mount; if present, open the method launcher modal pre-filled to that method.
7. **Extension audit.** Grep `extension/src` for hard-coded `/chat/`, `/workbench/`, `/bmad`, `/gsd`. Replace with `/runs/...` constructors. Bump extension version.
8. **Smoke test.** Manual checklist:
   - Visit every legacy URL listed in §4; confirm correct destination and banner.
   - Sidebar renders 14 visible items + Chat button. Active-runs badge appears on `Now`.
   - "New chat" button creates a Scratch Run and lands on `/runs/:id`.
   - Old bookmarks (a `/workbench/:pipelineId` link from a colleague's Slack message) work.
9. **Docs.** Update `docs/SESSION_HANDOFF.md` to note Doc 2 shipped. Update `README.md` if it mentions any of the deprecated routes. Update the docstring at the top of `Navigation.tsx`.

Phase A commit message convention: `feat(ia): consolidate sidebar around Run; redirect legacy URLs`.

### 6.2 Phase A acceptance criteria

- Every URL in §4 returns the documented behavior.
- No 404s for previously-valid legacy URLs (except truly unknown ids, which 404 the destination page only).
- `/v1/runs/by-legacy` test suite green.
- Sidebar manual smoke: all 14 items + Chat button visible; collapsed mode shows icons + Now badge dot.
- Banner appears exactly once per `legacyPath` per browser (dismissal sticks).

### 6.3 Phase B — Cleanup (30 days after Phase A)

Goal: delete the redirect shim page files, replace with `next.config.js` rewrites, simplify.

1. **Audit dismissal logs** (if telemetry available) — skip if not instrumented; default to "30 days is enough."
2. **Move redirects to `next.config.js`.** Add a `redirects()` block listing every entry from §4 marked "Redirect." Static targets stay static; dynamic ones (`/chat/:id` → `/runs/:companionRunId`) require a server route handler in `app/api/legacy-redirect/[type]/[id]/route.ts` that does the `by-legacy` lookup and returns a 307.
3. **Delete legacy page files.** `frontend/src/app/chat/`, `frontend/src/app/(main)/workbench/`, `frontend/src/app/(main)/conversations/`, `frontend/src/app/(main)/bmad/page.tsx`, `frontend/src/app/(main)/gsd/page.tsx`. Keep `/agents/[id]/` (kept per §4). Keep `/agents/sessions/` ONLY if Phase A's `?type=session` filter on `/now` is verified working — otherwise leave another release.
4. **Backend.** `GET /v1/runs/by-legacy` stays. It's not deprecated — the legacy ids are forever queryable.
5. **Banner.** Stays. Eventually a third phase can remove it; this doc doesn't schedule that.

Phase B commit: `chore(ia): remove legacy route shims, fold redirects into next.config`.

### 6.4 Rollback plan

Phase A is reversible with a single revert commit:

- Sidebar change: pure component swap; revert restores prior nav.
- Redirect shims: each legacy page file's prior content lives in git history; revert restores it.
- Banner: standalone component; deleting its mount restores prior layout.
- `by-legacy` endpoint: keep deployed; harmless if unused.

Phase B is harder to rollback (deleted files). Do not attempt Phase B until Phase A has been live 30 days with no rollback.

---

## 7. Interactions with Doc 1 plan

This doc replaces **Chunk 12** of the Run implementation plan. The other chunks of that plan are unaffected. Specifically:

- Chunk 2.3 (legacy pipeline adapter) becomes a **hard dependency** of Doc 2 Phase A — the `metadata.legacy_*_id` columns must be populated for `by-legacy` lookup to work without on-demand replay.
- Chunk 3.1 endpoint set: add `GET /v1/runs/by-legacy` here instead of in Chunk 12.
- Chunk 6 (`/now` grid) gains the filter chips described in §4: `?filter=method`, `?type=chat`, `?type=session`. Implement these as part of NowGrid's filter row rather than as a follow-up.
- Chunk 7 (RunViewer) is unchanged.
- Chunk 13 (docs handoff) absorbs the §6.1 step 9 documentation updates.

When the Run plan is next opened for execution, the executor should:

1. Strike Chunk 12 entirely.
2. Insert this doc's §6.1 as the new Chunk 12.
3. Add §6.3 as a new Chunk 14 (post-deprecation cleanup), scheduled 30 days after Chunk 12 ships.

---

## 8. Open questions / deferred

1. **Telemetry for redirect frequency.** Would tell us when Phase B is safe. Not blocking; if absent, use the 30-day timer.
2. **`/conversations` list-view replacement.** See §5.2. Track as a backlog item; revisit if user feedback surfaces.
3. **Sidebar search.** See §5.2. Backlog.
4. **Mobile-first nav (drawer pattern).** Today's nav collapses to icons but does not pivot to a hamburger drawer below a breakpoint. Out of scope for this doc; orthogonal.
5. **Renaming the WORK group to something less corporate** (e.g., "DO" or "FOCUS"). Bikeshed; keep WORK until a stakeholder objects.

---

## 9. References

- Doc 1: [docs/superpowers/specs/2026-05-12-the-run-design.md](./2026-05-12-the-run-design.md)
- Doc 1 plan: [docs/superpowers/plans/2026-05-12-the-run-implementation.md](../plans/2026-05-12-the-run-implementation.md)
- Current sidebar source: `frontend/src/app/Navigation.tsx`
- Active runs indicator: `frontend/src/components/ActiveRunsIndicator.tsx`
- Now launcher (becomes nav item): `frontend/src/components/now/NowLive.tsx` (the `NowLauncher` export)
- `/runs/by-legacy` placeholder (Doc 1 plan Chunk 12 Task 12.1 Step 3) — promoted here to load-bearing.

---

## 10. Brainstorm artifacts (ephemeral, not committed)

No visual mocks were generated for this doc — it's pure IA / URL surgery. The §3.1 table and §4 matrix are the durable reference.
