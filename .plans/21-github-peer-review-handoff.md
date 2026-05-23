# GitHub Peer Review App — Session Handoff

> Branch: `cursor/github-peer-review-app-2937`
> PR: https://github.com/simonbetton/reviewer/pull/1
> Status: **Vertical slice complete; intelligence and persistence layers are stubbed**

This document is for the next agent or session. It describes what was built, what is intentionally incomplete, architectural decisions, and recommended next steps.

---

## What Was Accomplished

### Product surface (end-to-end vertical slice)

- **`/review` route** is the new default/home experience (authenticated users redirect from chat index).
- **Left sidebar** (`ReviewSidebar`) shows personal and organization repo groups with open PRs, pinned state, 10-repo collapse with "More", and manual refresh.
- **Main workspace** (`ReviewWorkspace`) shows PR inbox + right-side review pane (email-app layout).
- **GitHub OAuth device flow** can be started from the UI (`beginGitHubOAuth` RPC).
- **Inbox sync** fetches viewer, repos, and open PRs from GitHub REST API when a token is available.
- **Pinning** for repos and PRs; **recent interaction** timestamps drive sort order.
- **Skills UI** with four app-default skills plus user-installed skill registration.
- **MCP connection records** can be added and associated with review runs.
- **Agent review runs** produce structured `ReviewFinding` objects locally; **submit** marks them as posted by the connected GitHub user (local state only today).

### Architecture (follows existing T3 Code patterns)

| Layer | Location | Notes |
|-------|----------|-------|
| Contracts | `packages/contracts/src/review.ts`, `rpc.ts`, `ipc.ts` | Schema-first types and RPC definitions |
| Server service | `apps/server/src/review/ReviewWorkspace.ts` | Effect service; instantiated per WS RPC layer in `ws.ts` |
| Pure logic | `apps/server/src/review/reviewWorkspaceLogic.ts` | Sorting, grouping, default skills, stub findings |
| Web store | `apps/web/src/reviewAppStore.ts` | Zustand; snapshot + selection state |
| UI | `apps/web/src/components/review/*` | Sidebar + workspace |
| Route | `apps/web/src/routes/review.tsx` | Thin route wrapper |

### Tests and quality gates

All passing at handoff time:

- `bun fmt`
- `bun lint` (10 pre-existing warnings, 0 errors)
- `bun typecheck`
- `bun run test` — 1026 passed, 4 skipped

New tests:

- `apps/server/src/review/reviewWorkspaceLogic.test.ts`
- `apps/web/src/reviewAppStore.test.ts`

---

## Architectural Decisions

### 1. Separate `review` domain (not orchestration)

The peer review app is a **new product domain** with its own contracts and service. It does not reuse the event-sourced orchestration thread model for inbox/PR state. Rationale: keeps chat/coding and review concerns decoupled; avoids polluting orchestration projections with GitHub inbox data.

**Future consideration:** If review runs need durable audit trails or multi-user collaboration, consider event-sourcing the review domain similarly to orchestration.

### 2. Route-scoped `ReviewWorkspace` service

`ReviewWorkspace.make()` is called inside the WebSocket RPC handler layer (`apps/server/src/ws.ts`), not merged into global `RuntimeCoreDependenciesLive`. Rationale: avoids leaking the service into unrelated server tests and bin entrypoints that don't need review context.

### 3. In-memory state for the vertical slice

Review workspace state lives in a `Ref<PersistedReviewWorkspaceState>` with **no disk persistence yet**. The schema `PersistedReviewWorkspaceState` exists and is ready for JSON/SQLite persistence, but load/save was deferred to keep the first slice focused on UI + RPC wiring.

### 4. GitHub OAuth via device flow

Uses GitHub's device authorization grant. Requires `T3_GITHUB_OAUTH_CLIENT_ID` env var on the server. Token is held in an in-memory `Ref` after `completeGitHubOAuth`; not yet stored in `ServerSecretStore`.

### 5. Reviews authored by GitHub user (design intent)

Agent produces **local draft findings**. `submitRun` is designed to post to GitHub **as the connected user**, not as a bot. Current implementation only updates local `ReviewRun.status` to `"posted"` — no GitHub API call yet.

### 6. Default skills are code-defined

`DEFAULT_REVIEW_SKILLS` in `reviewWorkspaceLogic.ts` ship with the app. User skills are registered via `installSkill` RPC. The `npx skills` installer is stubbed (records intent, does not execute).

---

## What Is Incomplete (TODO map)

Priority order for the next session:

### P0 — Make the app usable across restarts

| Item | File(s) | Notes |
|------|---------|-------|
| Persist workspace state | `ReviewWorkspace.ts` | Load/save `review-workspace.json` under `config.stateDir`; use `atomicWrite` pattern from existing server code |
| Persist OAuth token | `ReviewWorkspace.ts` | Store token in `ServerSecretStore` (`apps/server/src/auth/`), reload on startup |
| Complete OAuth device flow in UI | `ReviewWorkspace.tsx` | UI calls `beginGitHubOAuth` but never polls `completeGitHubOAuth` with `deviceCode` |
| Background inbox polling | `ReviewWorkspace.ts` or reactor | Periodic `refreshInboxWithToken` (e.g. every 60s) while connected |

### P1 — Real agent review intelligence

| Item | File(s) | Notes |
|------|---------|-------|
| Replace stub findings | `reviewWorkspaceLogic.ts` `createReviewFindings` | Wire to Codex/provider runtime; fetch PR diff/files from GitHub |
| Streaming review runs | contracts + server + UI | `startRun` currently completes synchronously with placeholder findings |
| Skill prompt injection | `ReviewWorkspace.ts` `startRun` | Load skill definitions (default + installed) into agent context |
| MCP runtime wiring | new module | Spawn/manage MCP processes from `ReviewMcpConnection` records; pass tools to agent |
| Execute `npx skills install` | `runSkillsInstaller` in `ReviewWorkspace.ts` | Use `VcsProcess` with timeout and bounded output |

### P2 — GitHub integration depth

| Item | File(s) | Notes |
|------|---------|-------|
| Post review to GitHub | `submitRun` | `POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews` with user's token |
| Fetch human reviews | new RPC + UI section | `GET .../pulls/{n}/reviews` and review comments |
| Rich PR metadata | `refreshInboxWithToken` | Populate `additions`, `deletions`, `changedFiles`, `reviewDecision`, `checksState` |
| Pagination | `refreshInboxWithToken` | `parseGitHubLinkNext` exists but is unused |
| Reuse SourceControlProvider | `GitHubSourceControlProvider.ts` | Align with existing `gh` CLI layer where appropriate |

### P3 — UX polish

| Item | Notes |
|------|-------|
| PR diff viewer | Reuse orchestration diff components or GitHub compare API |
| Finding accept/dismiss/edit | UI controls before submit |
| Category picker for runs | Currently hardcoded `DEFAULT_RUN_CATEGORIES` |
| Human review display | "Reviews from other users" section in right pane |
| OAuth disconnect / re-auth | No RPC yet |
| Screenshots for PR | Required before merging draft PR |

---

## Environment Setup

```bash
# Required for GitHub OAuth
export T3_GITHUB_OAUTH_CLIENT_ID=<github-oauth-app-client-id>

# Standard dev
bun install
bun run dev   # or follow existing README for server + web
```

Create a GitHub OAuth App with **Device Flow** enabled: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow

---

## Key Files Reference

```
packages/contracts/src/review.ts          # All review domain schemas
packages/contracts/src/rpc.ts             # REVIEW_WS_METHODS + WsReview* RPC defs
apps/server/src/review/ReviewWorkspace.ts # Server service (OAuth, sync, runs)
apps/server/src/review/reviewWorkspaceLogic.ts
apps/server/src/ws.ts                     # RPC handler registration (~line 200)
apps/web/src/reviewAppStore.ts
apps/web/src/components/review/ReviewSidebar.tsx
apps/web/src/components/review/ReviewWorkspace.tsx
apps/web/src/routes/review.tsx
```

---

## Blockers and Known Issues

1. **OAuth incomplete in UI** — User sees device code but app never calls `completeGitHubOAuth`. Without this, inbox stays empty unless token is injected another way.
2. **State lost on server restart** — All repos, PRs, pins, runs, and tokens are in-memory only.
3. **Agent reviews are placeholders** — Findings are generated from category names, not PR content.
4. **Submit does not hit GitHub** — "Posted as user" is local metadata only.
5. **Chat app still present** — `/review` is default but chat routes remain; no product decision yet on removing or hiding chat entirely.

---

## Suggested Next Session Plan

1. **Persistence + OAuth completion** — Highest user-visible impact; unblocks real GitHub testing.
2. **PR diff fetch + provider-backed review run** — Use existing Codex/provider infrastructure from `apps/server/src/provider/`.
3. **GitHub review submission** — Implement `submitRun` against GitHub Reviews API.
4. **Human reviews panel** — Fetch and display existing PR reviews/comments.
5. **Integration tests** — Mock GitHub API; test OAuth → sync → run → submit flow.

---

## Related Existing Docs

- `.plans/20-version-control-phase-2-source-control-provider-foundation.md` — Source control provider abstraction (GitHub via `gh` CLI)
- `AGENTS.md` — Project conventions and quality gates
- Codex App Server docs: https://developers.openai.com/codex/sdk/#app-server
- CodexMonitor reference: https://github.com/Dimillian/CodexMonitor
