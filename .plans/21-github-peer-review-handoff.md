# GitHub Peer Review App — Session Handoff

> Branch: `cursor/github-peer-review-app-2937`
> PR: https://github.com/simonbetton/reviewer/pull/1
> Status: **Vertical slice complete; persistence, OAuth completion, GitHub file-backed runs, and GitHub review posting are implemented**

This document is for the next agent or session. It describes what was built, what is intentionally incomplete, architectural decisions, and recommended next steps.

---

## What Was Accomplished

### Product surface (end-to-end vertical slice)

- **`/review` route** is the new default/home experience (authenticated users redirect from chat index).
- **Left sidebar** (`ReviewSidebar`) shows personal and organization repo groups with open PRs, pinned state, 10-repo collapse with "More", and manual refresh.
- **Main workspace** (`ReviewWorkspace`) shows PR inbox + right-side review pane (email-app layout).
- **GitHub OAuth device flow** can be started from Source Control settings and is polled with `completeGitHubOAuth`.
- **Inbox sync** fetches viewer, repos, and open PRs from GitHub REST API when a token is available.
- **Workspace state** is persisted to `review-workspace.json`; OAuth tokens are persisted in `ServerSecretStore`.
- **Background inbox sync** refreshes from the stored token every 60 seconds while connected.
- **Pinning** for repos and PRs; **recent interaction** timestamps drive sort order.
- **Skills UI** with four app-default skills plus user-installed skill registration.
- **MCP connection records** can be added and associated with review runs.
- **Review runs** fetch the selected PR's changed files from GitHub and produce structured `ReviewFinding` objects from file/path/patch signals.
- **Submit** posts a top-level GitHub PR review comment through the Pull Request Reviews API as the connected GitHub user, then marks local run/findings as posted.

### Architecture (follows existing T3 Code patterns)

| Layer | Location | Notes |
|-------|----------|-------|
| Contracts | `packages/contracts/src/review.ts`, `rpc.ts`, `ipc.ts` | Schema-first types and RPC definitions |
| Server service | `apps/server/src/review/ReviewWorkspace.ts` | Effect service; instantiated per WS RPC layer in `ws.ts` |
| Pure logic | `apps/server/src/review/reviewWorkspaceLogic.ts` | Sorting, grouping, default skills, file-backed finding heuristics, GitHub review body |
| Web store | `apps/web/src/reviewAppStore.ts` | Zustand; snapshot + selection state |
| UI | `apps/web/src/components/review/*` | Sidebar + workspace |
| Route | `apps/web/src/routes/review.tsx` | Thin route wrapper |

### Tests and quality gates

All passing at handoff time:

- `bun fmt`
- `bun lint` (10 pre-existing warnings, 0 errors)
- `bun typecheck`
- `bun run test` — 1030 passed, 4 skipped

New tests:

- `apps/server/src/review/reviewWorkspaceLogic.test.ts`
- `apps/server/src/review/ReviewWorkspace.test.ts`
- `apps/web/src/reviewAppStore.test.ts`

---

## Architectural Decisions

### 1. Separate `review` domain (not orchestration)

The peer review app is a **new product domain** with its own contracts and service. It does not reuse the event-sourced orchestration thread model for inbox/PR state. Rationale: keeps chat/coding and review concerns decoupled; avoids polluting orchestration projections with GitHub inbox data.

**Future consideration:** If review runs need durable audit trails or multi-user collaboration, consider event-sourcing the review domain similarly to orchestration.

### 2. Route-scoped `ReviewWorkspace` service

`ReviewWorkspace.make()` is called inside the WebSocket RPC handler layer (`apps/server/src/ws.ts`), not merged into global `RuntimeCoreDependenciesLive`. Rationale: avoids leaking the service into unrelated server tests and bin entrypoints that don't need review context.

### 3. Persisted review workspace state

Review workspace state lives in a `Ref<PersistedReviewWorkspaceState>` and is saved to `review-workspace.json` under the server state directory with atomic writes. The persisted schema is tolerant of older records via contract defaults for newly added fields.

### 4. GitHub OAuth via device flow

Uses GitHub's device authorization grant. Requires `T3_GITHUB_OAUTH_CLIENT_ID` env var on the server. Token is stored in `ServerSecretStore` after `completeGitHubOAuth` and reloaded when the review workspace service starts.

### 5. Reviews authored by GitHub user (design intent)

Review runs produce **local draft findings**. `submitRun` posts a review-level GitHub comment **as the connected user**, not as a bot, using `POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews` with `event: "COMMENT"`.

### 6. Default skills are code-defined

`DEFAULT_REVIEW_SKILLS` in `reviewWorkspaceLogic.ts` ship with the app. User skills are registered via `installSkill` RPC. The `npx skills` installer is stubbed (records intent, does not execute).

---

## What Is Incomplete (TODO map)

Priority order for the next session:

### P0 — Real agent review intelligence

| Item | File(s) | Notes |
|------|---------|-------|
| Replace heuristic findings | `reviewWorkspaceLogic.ts` `createReviewFindings` | Wire to Codex/provider runtime for semantic review; current run uses real GitHub file list and patch snippets |
| Streaming review runs | contracts + server + UI | `startRun` currently completes synchronously after fetching PR files |
| Skill prompt injection | `ReviewWorkspace.ts` `startRun` | Load skill definitions (default + installed) into agent context |
| MCP runtime wiring | new module | Spawn/manage MCP processes from `ReviewMcpConnection` records; pass tools to agent |
| Execute `npx skills install` | `runSkillsInstaller` in `ReviewWorkspace.ts` | Use `VcsProcess` with timeout and bounded output |

### P1 — GitHub integration depth

| Item | File(s) | Notes |
|------|---------|-------|
| Inline review comments | `submitRun` | Current implementation posts a review-level comment; inline comments need diff positions |
| Fetch human reviews | new RPC + UI section | `GET .../pulls/{n}/reviews` and review comments |
| Rich PR metadata | `refreshInboxWithToken` | Populate `additions`, `deletions`, `changedFiles`, `reviewDecision`, `checksState` |
| Pagination | `refreshInboxWithToken` | `parseGitHubLinkNext` exists but is unused |
| Reuse SourceControlProvider | `GitHubSourceControlProvider.ts` | Align with existing `gh` CLI layer where appropriate |

### P2 — UX polish

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

1. **Review intelligence is heuristic** — Findings use real GitHub changed files and patch snippets, but are not yet produced by Codex/provider semantic analysis.
2. **Submit posts review-level comments only** — GitHub receives a Pull Request Review with `event: "COMMENT"` and a markdown body; inline comments need diff positions.
3. **Skill installer is still stubbed** — User skill records are saved, but `npx skills install` is not executed yet.
4. **Chat app still present** — `/review` is default but chat routes remain; no product decision yet on removing or hiding chat entirely.

---

## Suggested Next Session Plan

1. **Provider-backed review run** — Use existing Codex/provider infrastructure from `apps/server/src/provider/` to replace file-signal heuristics.
2. **Inline GitHub comments** — Map findings to diff positions and include review comments in the Reviews API request.
3. **Human reviews panel** — Fetch and display existing PR reviews/comments.
4. **Skill installer + prompt injection** — Execute `npx skills install` and load skill instructions into review prompts.
5. **Pagination + richer metadata** — Page through repos/files and fetch checks/review decision/diff stats where GitHub REST does not include enough data.

---

## Related Existing Docs

- `.plans/20-version-control-phase-2-source-control-provider-foundation.md` — Source control provider abstraction (GitHub via `gh` CLI)
- `AGENTS.md` — Project conventions and quality gates
- Codex App Server docs: https://developers.openai.com/codex/sdk/#app-server
- CodexMonitor reference: https://github.com/Dimillian/CodexMonitor
