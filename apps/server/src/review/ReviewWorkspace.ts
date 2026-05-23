import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import {
  ReviewGitHubAuthState,
  ReviewInboxSnapshot,
  ReviewInstallerResult,
  ReviewMcpConnection,
  ReviewPullRequest,
  ReviewRepository,
  ReviewRun,
  ReviewSkill,
  ReviewWorkspaceError,
  type ReviewGitHubBeginOAuthInput,
  type ReviewGitHubBeginOAuthResult,
  type ReviewGitHubCompleteOAuthInput,
  type ReviewInstallSkillInput,
  type ReviewRecordInteractionInput,
  type ReviewRemoveMcpConnectionInput,
  type ReviewRemoveSkillInput,
  type ReviewSetPullRequestPinnedInput,
  type ReviewSetRepositoryPinnedInput,
  type ReviewSetSkillEnabledInput,
  type ReviewStartRunInput,
  type ReviewSubmitRunInput,
  type ReviewUpsertMcpConnectionInput,
} from "@t3tools/contracts";
import {
  buildReviewSidebarGroups,
  createReviewFindings,
  DEFAULT_REVIEW_SKILLS,
  markRunPosted,
  sortReviewPullRequests,
} from "./reviewWorkspaceLogic.ts";

const DEFAULT_GITHUB_OAUTH_SCOPES = ["read:user", "user:email", "repo", "read:org"] as const;
const isReviewWorkspaceError = Schema.is(ReviewWorkspaceError);

const PersistedReviewWorkspaceState = Schema.Struct({
  github: ReviewGitHubAuthState,
  repositories: Schema.Array(ReviewRepository),
  pullRequests: Schema.Array(ReviewPullRequest),
  skills: Schema.Array(ReviewSkill),
  mcpConnections: Schema.Array(ReviewMcpConnection),
  reviewRuns: Schema.Array(ReviewRun),
  syncedAt: Schema.NullOr(Schema.String),
});
type PersistedReviewWorkspaceState = typeof PersistedReviewWorkspaceState.Type;

export interface ReviewWorkspaceShape {
  readonly getSnapshot: Effect.Effect<ReviewInboxSnapshot, ReviewWorkspaceError>;
  readonly streamSnapshots: Stream.Stream<ReviewInboxSnapshot, ReviewWorkspaceError>;
  readonly beginGitHubOAuth: (
    input: ReviewGitHubBeginOAuthInput,
  ) => Effect.Effect<ReviewGitHubBeginOAuthResult, ReviewWorkspaceError>;
  readonly completeGitHubOAuth: (
    input: ReviewGitHubCompleteOAuthInput,
  ) => Effect.Effect<ReviewInboxSnapshot, ReviewWorkspaceError>;
  readonly refreshInbox: Effect.Effect<ReviewInboxSnapshot, ReviewWorkspaceError>;
  readonly recordInteraction: (
    input: ReviewRecordInteractionInput,
  ) => Effect.Effect<ReviewInboxSnapshot, ReviewWorkspaceError>;
  readonly setRepositoryPinned: (
    input: ReviewSetRepositoryPinnedInput,
  ) => Effect.Effect<ReviewInboxSnapshot, ReviewWorkspaceError>;
  readonly setPullRequestPinned: (
    input: ReviewSetPullRequestPinnedInput,
  ) => Effect.Effect<ReviewInboxSnapshot, ReviewWorkspaceError>;
  readonly upsertMcpConnection: (
    input: ReviewUpsertMcpConnectionInput,
  ) => Effect.Effect<ReviewMcpConnection, ReviewWorkspaceError>;
  readonly removeMcpConnection: (
    input: ReviewRemoveMcpConnectionInput,
  ) => Effect.Effect<ReviewInboxSnapshot, ReviewWorkspaceError>;
  readonly installSkill: (input: ReviewInstallSkillInput) => Effect.Effect<
    {
      readonly skill: ReviewSkill;
      readonly installer: ReviewInstallerResult;
      readonly snapshot: ReviewInboxSnapshot;
    },
    ReviewWorkspaceError
  >;
  readonly setSkillEnabled: (
    input: ReviewSetSkillEnabledInput,
  ) => Effect.Effect<ReviewInboxSnapshot, ReviewWorkspaceError>;
  readonly removeSkill: (
    input: ReviewRemoveSkillInput,
  ) => Effect.Effect<ReviewInboxSnapshot, ReviewWorkspaceError>;
  readonly startRun: (input: ReviewStartRunInput) => Effect.Effect<ReviewRun, ReviewWorkspaceError>;
  readonly submitRun: (
    input: ReviewSubmitRunInput,
  ) => Effect.Effect<ReviewRun, ReviewWorkspaceError>;
}

export class ReviewWorkspace extends Context.Service<ReviewWorkspace, ReviewWorkspaceShape>()(
  "t3/review/ReviewWorkspace",
) {}

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

function defaultState(): PersistedReviewWorkspaceState {
  return {
    github: {
      provider: "github",
      status: "disconnected",
      user: null,
      scopes: [...DEFAULT_GITHUB_OAUTH_SCOPES],
      connectedAt: null,
      detail: null,
    },
    repositories: [],
    pullRequests: [],
    skills: [],
    mcpConnections: [],
    reviewRuns: [],
    syncedAt: null,
  };
}

function toWorkspaceError(operation: string, detail: string, cause?: unknown) {
  return new ReviewWorkspaceError({
    operation,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function snapshotFromState(state: PersistedReviewWorkspaceState): ReviewInboxSnapshot {
  return {
    github: state.github,
    groups: buildReviewSidebarGroups(state.repositories),
    pullRequests: sortReviewPullRequests(state.pullRequests),
    skills: [...DEFAULT_REVIEW_SKILLS, ...state.skills],
    mcpConnections: state.mcpConnections,
    reviewRuns: state.reviewRuns,
    syncedAt: state.syncedAt,
  };
}

function skillIdFromPackageSpec(packageSpec: string) {
  return `user-${packageSpec
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

function runSkillsInstaller(input: ReviewInstallSkillInput) {
  const command = `npx skills install ${input.packageSpec}`;
  return Effect.succeed({
    status: "skipped" as const,
    command,
    output:
      input.runInstaller === true
        ? "Installer command recorded. Configure the skills CLI runner to execute installs on this host."
        : "Installer was skipped; the skill was registered in the app.",
  });
}

function parseGitHubLinkNext(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = /<([^>]+)>;\s*rel="next"/u.exec(part.trim());
    if (match?.[1]) return match[1];
  }
  return null;
}

export const make = Effect.fn("makeReviewWorkspace")(function* () {
  const changes = yield* PubSub.unbounded<ReviewInboxSnapshot>();
  const stateRef = yield* Ref.make<PersistedReviewWorkspaceState>(defaultState());
  const tokenRef = yield* Ref.make<string | null>(null);

  const publishState = (state: PersistedReviewWorkspaceState) =>
    PubSub.publish(changes, snapshotFromState(state)).pipe(Effect.asVoid);

  const updateState = (
    operation: string,
    apply: (state: PersistedReviewWorkspaceState) => PersistedReviewWorkspaceState,
  ) =>
    Ref.updateAndGet(stateRef, apply).pipe(
      Effect.tap(publishState),
      Effect.map(snapshotFromState),
      Effect.mapError((cause) =>
        isReviewWorkspaceError(cause)
          ? cause
          : toWorkspaceError(operation, "Failed to update review workspace.", cause),
      ),
    );

  const getToken = Ref.get(tokenRef);
  const setToken = (token: string) => Ref.set(tokenRef, token);

  const githubJson = <A>(input: {
    readonly token: string;
    readonly url: string;
    readonly init?: RequestInit;
  }) =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetch(input.url, {
          ...input.init,
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${input.token}`,
            "X-GitHub-Api-Version": "2022-11-28",
            ...input.init?.headers,
          },
        });
        if (!response.ok) {
          throw new Error(`GitHub API returned ${response.status} for ${input.url}`);
        }
        return {
          json: (await response.json()) as A,
          nextUrl: parseGitHubLinkNext(response.headers.get("link")),
          scopes: response.headers.get("x-oauth-scopes"),
        };
      },
      catch: (cause) => toWorkspaceError("github.api", "GitHub API request failed.", cause),
    });

  const readViewer = (token: string) =>
    githubJson<Record<string, unknown>>({
      token,
      url: "https://api.github.com/user",
    }).pipe(
      Effect.map(({ json, scopes }) => ({
        user: {
          id: String(json.id ?? json.node_id ?? json.login ?? "github-user"),
          login: String(json.login ?? "unknown"),
          name: typeof json.name === "string" ? json.name : null,
          avatarUrl: typeof json.avatar_url === "string" ? json.avatar_url : null,
          profileUrl: typeof json.html_url === "string" ? json.html_url : "https://github.com",
        },
        scopes: scopes
          ?.split(",")
          .map((scope) => scope.trim())
          .filter(Boolean) ?? [...DEFAULT_GITHUB_OAUTH_SCOPES],
      })),
    );

  const refreshInboxWithToken = (token: string) =>
    Effect.gen(function* () {
      const viewer = yield* readViewer(token);
      const repos = yield* githubJson<ReadonlyArray<Record<string, unknown>>>({
        token,
        url: "https://api.github.com/user/repos?per_page=50&sort=pushed&affiliation=owner,collaborator,organization_member",
      });
      const previous = yield* Ref.get(stateRef);
      const previousRepos = new Map(previous.repositories.map((repo) => [repo.id, repo]));
      const previousPrs = new Map(previous.pullRequests.map((pr) => [pr.id, pr]));
      const repositories: ReviewRepository[] = [];
      const pullRequests: ReviewPullRequest[] = [];

      for (const repo of repos.json.slice(0, 50)) {
        const fullName = String(repo.full_name ?? "");
        if (!fullName.includes("/")) continue;
        const [ownerLogin = "", repoName = ""] = fullName.split("/");
        const pulls = yield* githubJson<ReadonlyArray<Record<string, unknown>>>({
          token,
          url: `https://api.github.com/repos/${encodeURIComponent(ownerLogin)}/${encodeURIComponent(repoName)}/pulls?state=open&sort=updated&direction=desc&per_page=20`,
        }).pipe(Effect.catch(() => Effect.succeed({ json: [], nextUrl: null, scopes: null })));
        if (pulls.json.length === 0) continue;
        const repoId = `github:${fullName.toLowerCase()}`;
        const existingRepo = previousRepos.get(repoId);
        repositories.push({
          id: repoId,
          provider: "github",
          ownerKind:
            ((repo.owner as Record<string, unknown> | undefined)?.type ?? "") === "Organization"
              ? "organization"
              : "personal",
          ownerLogin,
          name: repoName,
          nameWithOwner: fullName,
          url: String(repo.html_url ?? `https://github.com/${fullName}`),
          openPullRequestCount: pulls.json.length,
          lastProviderUpdatedAt: typeof repo.pushed_at === "string" ? repo.pushed_at : null,
          lastInteractedAt: existingRepo?.lastInteractedAt ?? null,
          pinned: existingRepo?.pinned ?? false,
        });
        for (const pull of pulls.json) {
          const number = Number(pull.number);
          if (!Number.isInteger(number) || number <= 0) continue;
          const prId = `${repoId}#${number}`;
          const existingPr = previousPrs.get(prId);
          pullRequests.push({
            id: prId,
            repositoryId: repoId,
            provider: "github",
            number,
            title: String(pull.title ?? `PR #${number}`),
            url: String(pull.html_url ?? `https://github.com/${fullName}/pull/${number}`),
            authorLogin: String(
              (pull.user as Record<string, unknown> | undefined)?.login ?? "unknown",
            ),
            baseRefName: String((pull.base as Record<string, unknown> | undefined)?.ref ?? "base"),
            headRefName: String((pull.head as Record<string, unknown> | undefined)?.ref ?? "head"),
            state: "open",
            draft: Boolean(pull.draft),
            additions: 0,
            deletions: 0,
            changedFiles: 0,
            commentCount: Number(pull.comments ?? 0) + Number(pull.review_comments ?? 0),
            reviewDecision: null,
            checksState: null,
            lastProviderUpdatedAt: typeof pull.updated_at === "string" ? pull.updated_at : null,
            lastInteractedAt: existingPr?.lastInteractedAt ?? null,
            pinned: existingPr?.pinned ?? false,
          });
        }
      }

      const syncedAt = yield* nowIso;
      return yield* updateState("github.refresh", (state) => ({
        ...state,
        github: {
          provider: "github",
          status: "connected",
          user: viewer.user,
          scopes: viewer.scopes,
          connectedAt: state.github.connectedAt ?? syncedAt,
          detail: null,
        },
        repositories,
        pullRequests,
        syncedAt,
      }));
    });

  return ReviewWorkspace.of({
    getSnapshot: Ref.get(stateRef).pipe(Effect.map(snapshotFromState)),
    streamSnapshots: Stream.concat(
      Stream.fromEffect(Ref.get(stateRef).pipe(Effect.map(snapshotFromState))),
      Stream.fromPubSub(changes),
    ),
    beginGitHubOAuth: (input) => {
      const clientId = process.env.T3_GITHUB_OAUTH_CLIENT_ID?.trim();
      const scopes = input.scopes?.length ? input.scopes : [...DEFAULT_GITHUB_OAUTH_SCOPES];
      if (!clientId) {
        return Effect.succeed({
          status: "not_configured" as const,
          deviceCode: null,
          userCode: null,
          verificationUri: null,
          expiresAt: null,
          intervalSeconds: 5,
          detail: "Set T3_GITHUB_OAUTH_CLIENT_ID on the server to enable GitHub OAuth.",
        });
      }
      return Effect.tryPromise({
        try: async () => {
          const body = new URLSearchParams({
            client_id: clientId,
            scope: scopes.join(" "),
          });
          const response = await fetch("https://github.com/login/device/code", {
            method: "POST",
            headers: { Accept: "application/json" },
            body,
          });
          if (!response.ok) throw new Error(`GitHub device flow returned ${response.status}`);
          const json = (await response.json()) as Record<string, unknown>;
          return {
            status: "pending" as const,
            deviceCode: String(json.device_code ?? ""),
            userCode: String(json.user_code ?? ""),
            verificationUri: String(json.verification_uri ?? "https://github.com/login/device"),
            expiresAt: null,
            intervalSeconds: Math.max(1, Number(json.interval ?? 5)),
            detail: null,
          };
        },
        catch: (cause) =>
          toWorkspaceError(
            "github.oauth.begin",
            "Failed to start GitHub OAuth device flow.",
            cause,
          ),
      });
    },
    completeGitHubOAuth: (input) =>
      Effect.gen(function* () {
        const clientId = process.env.T3_GITHUB_OAUTH_CLIENT_ID?.trim();
        if (!clientId) {
          return yield* toWorkspaceError(
            "github.oauth.complete",
            "Set T3_GITHUB_OAUTH_CLIENT_ID on the server to enable GitHub OAuth.",
          );
        }
        const token = yield* Effect.tryPromise({
          try: async () => {
            const response = await fetch("https://github.com/login/oauth/access_token", {
              method: "POST",
              headers: { Accept: "application/json" },
              body: new URLSearchParams({
                client_id: clientId,
                device_code: input.deviceCode,
                grant_type: "urn:ietf:params:oauth:grant-type:device_code",
              }),
            });
            if (!response.ok) throw new Error(`GitHub token exchange returned ${response.status}`);
            const json = (await response.json()) as Record<string, unknown>;
            if (typeof json.error === "string") {
              throw new Error(String(json.error_description ?? json.error));
            }
            const accessToken = String(json.access_token ?? "");
            if (!accessToken)
              throw new Error("GitHub token exchange did not return an access token.");
            return accessToken;
          },
          catch: (cause) =>
            toWorkspaceError(
              "github.oauth.complete",
              "Failed to complete GitHub OAuth device flow.",
              cause,
            ),
        });
        yield* setToken(token);
        return yield* refreshInboxWithToken(token);
      }),
    refreshInbox: getToken.pipe(
      Effect.flatMap((token) =>
        token
          ? refreshInboxWithToken(token)
          : updateState("github.refresh", (state) => ({
              ...state,
              github: {
                ...state.github,
                status: state.github.status === "connected" ? "error" : state.github.status,
                detail: "Connect GitHub with OAuth before refreshing the PR inbox.",
              },
            })),
      ),
    ),
    recordInteraction: (input) =>
      Effect.gen(function* () {
        const at = yield* nowIso;
        return yield* updateState("recordInteraction", (state) => ({
          ...state,
          repositories: state.repositories.map((repo) =>
            repo.id === input.repositoryId ? { ...repo, lastInteractedAt: at } : repo,
          ),
          pullRequests: state.pullRequests.map((pr) =>
            pr.id === input.pullRequestId ? { ...pr, lastInteractedAt: at } : pr,
          ),
        }));
      }),
    setRepositoryPinned: (input) =>
      Effect.gen(function* () {
        const at = yield* nowIso;
        return yield* updateState("pinRepository", (state) => ({
          ...state,
          repositories: state.repositories.map((repo) =>
            repo.id === input.repositoryId
              ? { ...repo, pinned: input.pinned, lastInteractedAt: at }
              : repo,
          ),
        }));
      }),
    setPullRequestPinned: (input) =>
      Effect.gen(function* () {
        const at = yield* nowIso;
        return yield* updateState("pinPullRequest", (state) => ({
          ...state,
          pullRequests: state.pullRequests.map((pr) =>
            pr.id === input.pullRequestId
              ? { ...pr, pinned: input.pinned, lastInteractedAt: at }
              : pr,
          ),
        }));
      }),
    upsertMcpConnection: (input) =>
      Effect.gen(function* () {
        const at = yield* nowIso;
        let saved: ReviewMcpConnection | null = null;
        yield* updateState("mcp.upsert", (state) => {
          const id = input.id ?? `mcp-${crypto.randomUUID()}`;
          const existing = state.mcpConnections.find((connection) => connection.id === id);
          saved = {
            id,
            name: input.name,
            command: input.command,
            args: input.args ?? existing?.args ?? [],
            env: input.env ?? existing?.env ?? {},
            enabled: input.enabled ?? existing?.enabled ?? true,
            trusted: input.trusted ?? existing?.trusted ?? false,
            createdAt: existing?.createdAt ?? at,
            updatedAt: at,
          };
          return {
            ...state,
            mcpConnections: [
              ...state.mcpConnections.filter((connection) => connection.id !== id),
              saved,
            ],
          };
        });
        return saved!;
      }),
    removeMcpConnection: (input) =>
      updateState("mcp.remove", (state) => ({
        ...state,
        mcpConnections: state.mcpConnections.filter((connection) => connection.id !== input.id),
        skills: state.skills.map((skill) => ({
          ...skill,
          requiredMcpConnectionIds: skill.requiredMcpConnectionIds.filter((id) => id !== input.id),
        })),
      })),
    installSkill: (input) =>
      Effect.gen(function* () {
        const installer = yield* runSkillsInstaller(input);
        const at = yield* nowIso;
        const id = skillIdFromPackageSpec(input.packageSpec);
        const skill: ReviewSkill = {
          id,
          name: input.name ?? input.packageSpec,
          description:
            input.description ??
            `Installed from ${input.packageSpec}. Review runs can include this skill as context.`,
          source: "user",
          packageSpec: input.packageSpec,
          categories: input.categories ?? ["risk"],
          requiredMcpConnectionIds: input.requiredMcpConnectionIds ?? [],
          enabled: true,
          installedAt: at,
          updatedAt: at,
        };
        const snapshot = yield* updateState("skill.install", (state) => ({
          ...state,
          skills: [...state.skills.filter((existing) => existing.id !== id), skill],
        }));
        return { skill, installer, snapshot };
      }),
    setSkillEnabled: (input) =>
      Effect.gen(function* () {
        const at = yield* nowIso;
        return yield* updateState("skill.enable", (state) => ({
          ...state,
          skills: state.skills.map((skill) =>
            skill.id === input.id ? { ...skill, enabled: input.enabled, updatedAt: at } : skill,
          ),
        }));
      }),
    removeSkill: (input) =>
      updateState("skill.remove", (state) => ({
        ...state,
        skills: state.skills.filter((skill) => skill.id !== input.id),
      })),
    startRun: (input) =>
      Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        const pullRequest = state.pullRequests.find((pr) => pr.id === input.pullRequestId);
        if (!pullRequest) {
          return yield* toWorkspaceError(
            "review.startRun",
            `Pull request ${input.pullRequestId} was not found.`,
          );
        }
        const at = yield* nowIso;
        const runId = `run-${crypto.randomUUID()}`;
        const run: ReviewRun = {
          id: runId,
          pullRequestId: input.pullRequestId,
          status: "completed",
          categories: input.categories,
          skillIds: input.skillIds,
          mcpConnectionIds: input.mcpConnectionIds,
          findings: createReviewFindings({
            runId,
            pullRequest,
            categories: input.categories,
            now: at,
          }),
          summary: `Completed ${input.categories.length} category review for #${pullRequest.number}. Findings are local drafts until submitted as the connected GitHub user.`,
          createdAt: at,
          updatedAt: at,
          postedByGitHubUserLogin: null,
        };
        yield* updateState("review.startRun", (current) => ({
          ...current,
          reviewRuns: [run, ...current.reviewRuns],
          pullRequests: current.pullRequests.map((pr) =>
            pr.id === input.pullRequestId ? { ...pr, lastInteractedAt: at } : pr,
          ),
        }));
        return run;
      }),
    submitRun: (input) =>
      Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        const run = state.reviewRuns.find((entry) => entry.id === input.runId);
        if (!run) {
          return yield* toWorkspaceError(
            "review.submitRun",
            `Review run ${input.runId} was not found.`,
          );
        }
        const userLogin = state.github.user?.login;
        if (state.github.status !== "connected" || !userLogin) {
          return yield* toWorkspaceError(
            "review.submitRun",
            "Connect GitHub with OAuth before submitting a review.",
          );
        }
        const postedRun = markRunPosted(run, userLogin, yield* nowIso);
        yield* updateState("review.submitRun", (current) => ({
          ...current,
          reviewRuns: current.reviewRuns.map((entry) =>
            entry.id === input.runId ? postedRun : entry,
          ),
        }));
        return postedRun;
      }),
  });
});

export const layer = Layer.effect(ReviewWorkspace, make());
