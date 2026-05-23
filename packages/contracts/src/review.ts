import * as Schema from "effect/Schema";
import { IsoDateTime, NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { GitCommandError } from "./git.ts";
import { SourceControlProviderKind } from "./sourceControl.ts";
import { VcsError } from "./vcs.ts";

export const ReviewDiffPreviewInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  baseRef: Schema.optional(TrimmedNonEmptyString),
  ignoreWhitespace: Schema.optionalKey(Schema.Boolean),
});
export type ReviewDiffPreviewInput = typeof ReviewDiffPreviewInput.Type;

export const ReviewDiffPreviewSourceKind = Schema.Literals(["working-tree", "branch-range"]);
export type ReviewDiffPreviewSourceKind = typeof ReviewDiffPreviewSourceKind.Type;

export const ReviewDiffPreviewSource = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: ReviewDiffPreviewSourceKind,
  title: TrimmedNonEmptyString,
  baseRef: Schema.NullOr(TrimmedNonEmptyString),
  headRef: Schema.NullOr(TrimmedNonEmptyString),
  diff: Schema.String,
  diffHash: TrimmedNonEmptyString,
  truncated: Schema.Boolean,
});
export type ReviewDiffPreviewSource = typeof ReviewDiffPreviewSource.Type;

export const ReviewDiffPreviewResult = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  generatedAt: Schema.DateTimeUtc,
  sources: Schema.Array(ReviewDiffPreviewSource),
});
export type ReviewDiffPreviewResult = typeof ReviewDiffPreviewResult.Type;

export const ReviewDiffPreviewError = Schema.Union([VcsError, GitCommandError]);
export type ReviewDiffPreviewError = typeof ReviewDiffPreviewError.Type;

export const ReviewIntegrationProvider = Schema.Literal("github");
export type ReviewIntegrationProvider = typeof ReviewIntegrationProvider.Type;

export const ReviewOAuthStatus = Schema.Literals([
  "not_configured",
  "disconnected",
  "pending",
  "connected",
  "error",
]);
export type ReviewOAuthStatus = typeof ReviewOAuthStatus.Type;

export const ReviewGitHubUser = Schema.Struct({
  id: Schema.String,
  login: TrimmedNonEmptyString,
  name: Schema.NullOr(Schema.String),
  avatarUrl: Schema.NullOr(Schema.String),
  profileUrl: Schema.String,
});
export type ReviewGitHubUser = typeof ReviewGitHubUser.Type;

export const ReviewGitHubAuthState = Schema.Struct({
  provider: ReviewIntegrationProvider,
  status: ReviewOAuthStatus,
  user: Schema.NullOr(ReviewGitHubUser),
  scopes: Schema.Array(TrimmedNonEmptyString),
  connectedAt: Schema.NullOr(IsoDateTime),
  detail: Schema.NullOr(Schema.String),
});
export type ReviewGitHubAuthState = typeof ReviewGitHubAuthState.Type;

export const ReviewGitHubBeginOAuthInput = Schema.Struct({
  scopes: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
});
export type ReviewGitHubBeginOAuthInput = typeof ReviewGitHubBeginOAuthInput.Type;

export const ReviewGitHubBeginOAuthResult = Schema.Struct({
  status: ReviewOAuthStatus,
  deviceCode: Schema.NullOr(TrimmedNonEmptyString),
  userCode: Schema.NullOr(TrimmedNonEmptyString),
  verificationUri: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(IsoDateTime),
  intervalSeconds: PositiveInt,
  detail: Schema.NullOr(Schema.String),
});
export type ReviewGitHubBeginOAuthResult = typeof ReviewGitHubBeginOAuthResult.Type;

export const ReviewGitHubCompleteOAuthInput = Schema.Struct({
  deviceCode: TrimmedNonEmptyString,
});
export type ReviewGitHubCompleteOAuthInput = typeof ReviewGitHubCompleteOAuthInput.Type;

export const ReviewMcpConnection = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  args: Schema.Array(Schema.String),
  env: Schema.Record(Schema.String, Schema.String),
  enabled: Schema.Boolean,
  trusted: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ReviewMcpConnection = typeof ReviewMcpConnection.Type;

export const ReviewUpsertMcpConnectionInput = Schema.Struct({
  id: Schema.optional(TrimmedNonEmptyString),
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  args: Schema.optional(Schema.Array(Schema.String)),
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  enabled: Schema.optional(Schema.Boolean),
  trusted: Schema.optional(Schema.Boolean),
});
export type ReviewUpsertMcpConnectionInput = typeof ReviewUpsertMcpConnectionInput.Type;

export const ReviewRemoveMcpConnectionInput = Schema.Struct({
  id: TrimmedNonEmptyString,
});
export type ReviewRemoveMcpConnectionInput = typeof ReviewRemoveMcpConnectionInput.Type;

export const ReviewCategory = Schema.Literals([
  "correctness",
  "risk",
  "security",
  "ux",
  "accessibility",
  "seo",
  "performance",
  "tests",
  "maintainability",
  "api",
  "data",
  "observability",
  "docs",
]);
export type ReviewCategory = typeof ReviewCategory.Type;

export const ReviewSkillSource = Schema.Literals(["default", "user"]);
export type ReviewSkillSource = typeof ReviewSkillSource.Type;

export const ReviewSkill = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  description: Schema.String,
  source: ReviewSkillSource,
  packageSpec: Schema.NullOr(TrimmedNonEmptyString),
  categories: Schema.Array(ReviewCategory),
  requiredMcpConnectionIds: Schema.Array(TrimmedNonEmptyString),
  enabled: Schema.Boolean,
  installedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ReviewSkill = typeof ReviewSkill.Type;

export const ReviewInstallSkillInput = Schema.Struct({
  packageSpec: TrimmedNonEmptyString,
  name: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(Schema.String),
  categories: Schema.optional(Schema.Array(ReviewCategory)),
  requiredMcpConnectionIds: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  runInstaller: Schema.optional(Schema.Boolean),
});
export type ReviewInstallSkillInput = typeof ReviewInstallSkillInput.Type;

export const ReviewSetSkillEnabledInput = Schema.Struct({
  id: TrimmedNonEmptyString,
  enabled: Schema.Boolean,
});
export type ReviewSetSkillEnabledInput = typeof ReviewSetSkillEnabledInput.Type;

export const ReviewRemoveSkillInput = Schema.Struct({
  id: TrimmedNonEmptyString,
});
export type ReviewRemoveSkillInput = typeof ReviewRemoveSkillInput.Type;

export const ReviewInstallerResult = Schema.Struct({
  status: Schema.Literals(["skipped", "succeeded", "failed"]),
  command: Schema.String,
  output: Schema.String,
});
export type ReviewInstallerResult = typeof ReviewInstallerResult.Type;

export const ReviewRepositoryOwnerKind = Schema.Literals(["personal", "organization"]);
export type ReviewRepositoryOwnerKind = typeof ReviewRepositoryOwnerKind.Type;

export const ReviewRepository = Schema.Struct({
  id: TrimmedNonEmptyString,
  provider: SourceControlProviderKind,
  ownerKind: ReviewRepositoryOwnerKind,
  ownerLogin: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  nameWithOwner: TrimmedNonEmptyString,
  url: Schema.String,
  openPullRequestCount: NonNegativeInt,
  lastProviderUpdatedAt: Schema.NullOr(IsoDateTime),
  lastInteractedAt: Schema.NullOr(IsoDateTime),
  pinned: Schema.Boolean,
});
export type ReviewRepository = typeof ReviewRepository.Type;

export const ReviewPullRequestState = Schema.Literals(["open", "closed", "merged"]);
export type ReviewPullRequestState = typeof ReviewPullRequestState.Type;

export const ReviewPullRequest = Schema.Struct({
  id: TrimmedNonEmptyString,
  repositoryId: TrimmedNonEmptyString,
  provider: SourceControlProviderKind,
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  url: Schema.String,
  authorLogin: TrimmedNonEmptyString,
  baseRefName: TrimmedNonEmptyString,
  headRefName: TrimmedNonEmptyString,
  state: ReviewPullRequestState,
  draft: Schema.Boolean,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
  changedFiles: NonNegativeInt,
  commentCount: NonNegativeInt,
  reviewDecision: Schema.NullOr(Schema.String),
  checksState: Schema.NullOr(Schema.String),
  lastProviderUpdatedAt: Schema.NullOr(IsoDateTime),
  lastInteractedAt: Schema.NullOr(IsoDateTime),
  pinned: Schema.Boolean,
});
export type ReviewPullRequest = typeof ReviewPullRequest.Type;

export const ReviewSidebarGroup = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  ownerKind: ReviewRepositoryOwnerKind,
  repositories: Schema.Array(ReviewRepository),
});
export type ReviewSidebarGroup = typeof ReviewSidebarGroup.Type;

export const ReviewFindingSeverity = Schema.Literals([
  "blocker",
  "major",
  "minor",
  "nit",
  "question",
]);
export type ReviewFindingSeverity = typeof ReviewFindingSeverity.Type;

export const ReviewFindingStatus = Schema.Literals(["open", "accepted", "dismissed", "posted"]);
export type ReviewFindingStatus = typeof ReviewFindingStatus.Type;

export const ReviewFinding = Schema.Struct({
  id: TrimmedNonEmptyString,
  category: ReviewCategory,
  severity: ReviewFindingSeverity,
  confidence: NonNegativeInt,
  title: TrimmedNonEmptyString,
  explanation: Schema.String,
  filePath: Schema.NullOr(Schema.String),
  line: Schema.NullOr(PositiveInt),
  suggestedFix: Schema.NullOr(Schema.String),
  status: ReviewFindingStatus,
  authoredBy: Schema.Literal("agent"),
  postedByGitHubUserLogin: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});
export type ReviewFinding = typeof ReviewFinding.Type;

export const ReviewRunStatus = Schema.Literals(["running", "completed", "failed", "posted"]);
export type ReviewRunStatus = typeof ReviewRunStatus.Type;

export const ReviewRun = Schema.Struct({
  id: TrimmedNonEmptyString,
  pullRequestId: TrimmedNonEmptyString,
  status: ReviewRunStatus,
  categories: Schema.Array(ReviewCategory),
  skillIds: Schema.Array(TrimmedNonEmptyString),
  mcpConnectionIds: Schema.Array(TrimmedNonEmptyString),
  findings: Schema.Array(ReviewFinding),
  summary: Schema.String,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  postedByGitHubUserLogin: Schema.NullOr(TrimmedNonEmptyString),
});
export type ReviewRun = typeof ReviewRun.Type;

export const ReviewInboxSnapshot = Schema.Struct({
  github: ReviewGitHubAuthState,
  groups: Schema.Array(ReviewSidebarGroup),
  pullRequests: Schema.Array(ReviewPullRequest),
  skills: Schema.Array(ReviewSkill),
  mcpConnections: Schema.Array(ReviewMcpConnection),
  reviewRuns: Schema.Array(ReviewRun),
  syncedAt: Schema.NullOr(IsoDateTime),
});
export type ReviewInboxSnapshot = typeof ReviewInboxSnapshot.Type;

export const ReviewRecordInteractionInput = Schema.Struct({
  repositoryId: Schema.optional(TrimmedNonEmptyString),
  pullRequestId: Schema.optional(TrimmedNonEmptyString),
});
export type ReviewRecordInteractionInput = typeof ReviewRecordInteractionInput.Type;

export const ReviewSetRepositoryPinnedInput = Schema.Struct({
  repositoryId: TrimmedNonEmptyString,
  pinned: Schema.Boolean,
});
export type ReviewSetRepositoryPinnedInput = typeof ReviewSetRepositoryPinnedInput.Type;

export const ReviewSetPullRequestPinnedInput = Schema.Struct({
  pullRequestId: TrimmedNonEmptyString,
  pinned: Schema.Boolean,
});
export type ReviewSetPullRequestPinnedInput = typeof ReviewSetPullRequestPinnedInput.Type;

export const ReviewStartRunInput = Schema.Struct({
  pullRequestId: TrimmedNonEmptyString,
  categories: Schema.Array(ReviewCategory),
  skillIds: Schema.Array(TrimmedNonEmptyString),
  mcpConnectionIds: Schema.Array(TrimmedNonEmptyString),
});
export type ReviewStartRunInput = typeof ReviewStartRunInput.Type;

export const ReviewSubmitRunInput = Schema.Struct({
  runId: TrimmedNonEmptyString,
});
export type ReviewSubmitRunInput = typeof ReviewSubmitRunInput.Type;

export const REVIEW_WS_METHODS = {
  getSnapshot: "review.getSnapshot",
  subscribe: "review.subscribe",
  githubBeginOAuth: "review.github.beginOAuth",
  githubCompleteOAuth: "review.github.completeOAuth",
  refreshInbox: "review.refreshInbox",
  recordInteraction: "review.recordInteraction",
  setRepositoryPinned: "review.setRepositoryPinned",
  setPullRequestPinned: "review.setPullRequestPinned",
  upsertMcpConnection: "review.upsertMcpConnection",
  removeMcpConnection: "review.removeMcpConnection",
  installSkill: "review.installSkill",
  setSkillEnabled: "review.setSkillEnabled",
  removeSkill: "review.removeSkill",
  startRun: "review.startRun",
  submitRun: "review.submitRun",
} as const;

export class ReviewWorkspaceError extends Schema.TaggedErrorClass<ReviewWorkspaceError>()(
  "ReviewWorkspaceError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Review workspace ${this.operation} failed: ${this.detail}`;
  }
}
