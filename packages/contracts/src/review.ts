import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { IsoDateTime, NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { GitCommandError } from "./git.ts";
import { ModelSelection } from "./orchestration.ts";
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
  hidden: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
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
  headSha: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
  lastProviderUpdatedAt: Schema.NullOr(IsoDateTime),
  pinned: Schema.Boolean,
  hidden: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  tracked: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
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
  headSha: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
  summaryDraftId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
  commentDraftIds: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
  modelSelection: Schema.NullOr(ModelSelection).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  postedByGitHubUserLogin: Schema.NullOr(TrimmedNonEmptyString),
});
export type ReviewRun = typeof ReviewRun.Type;

export const ReviewCommentSide = Schema.Literals(["LEFT", "RIGHT"]);
export type ReviewCommentSide = typeof ReviewCommentSide.Type;

export const ReviewSubmitEvent = Schema.Literals(["COMMENT", "REQUEST_CHANGES", "APPROVE"]);
export type ReviewSubmitEvent = typeof ReviewSubmitEvent.Type;

export const ReviewCodeBlockLineKind = Schema.Literals(["context", "addition", "deletion"]);
export type ReviewCodeBlockLineKind = typeof ReviewCodeBlockLineKind.Type;

export const ReviewCodeBlockLine = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: ReviewCodeBlockLineKind,
  content: Schema.String,
  oldLine: Schema.NullOr(PositiveInt),
  newLine: Schema.NullOr(PositiveInt),
});
export type ReviewCodeBlockLine = typeof ReviewCodeBlockLine.Type;

export const ReviewCodeBlock = Schema.Struct({
  id: TrimmedNonEmptyString,
  pullRequestId: TrimmedNonEmptyString,
  filePath: TrimmedNonEmptyString,
  status: Schema.String,
  patch: Schema.NullOr(Schema.String),
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
  startLine: Schema.NullOr(PositiveInt),
  endLine: Schema.NullOr(PositiveInt),
  lines: Schema.Array(ReviewCodeBlockLine),
});
export type ReviewCodeBlock = typeof ReviewCodeBlock.Type;

export const ReviewCommentDraftStatus = Schema.Literals(["draft", "dismissed", "posted", "failed"]);
export type ReviewCommentDraftStatus = typeof ReviewCommentDraftStatus.Type;

export const ReviewCommentDraft = Schema.Struct({
  id: TrimmedNonEmptyString,
  runId: TrimmedNonEmptyString,
  pullRequestId: TrimmedNonEmptyString,
  findingId: Schema.NullOr(TrimmedNonEmptyString),
  body: Schema.String,
  filePath: TrimmedNonEmptyString,
  line: PositiveInt,
  side: ReviewCommentSide,
  startLine: Schema.NullOr(PositiveInt),
  startSide: Schema.NullOr(ReviewCommentSide),
  status: ReviewCommentDraftStatus,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  postedGitHubCommentId: Schema.NullOr(Schema.String),
  postedByGitHubUserLogin: Schema.NullOr(TrimmedNonEmptyString),
  failureDetail: Schema.NullOr(Schema.String),
});
export type ReviewCommentDraft = typeof ReviewCommentDraft.Type;

export const ReviewSummaryDraftStatus = Schema.Literals(["draft", "posted", "failed"]);
export type ReviewSummaryDraftStatus = typeof ReviewSummaryDraftStatus.Type;

export const ReviewSummaryDraft = Schema.Struct({
  id: TrimmedNonEmptyString,
  runId: TrimmedNonEmptyString,
  pullRequestId: TrimmedNonEmptyString,
  body: Schema.String,
  event: ReviewSubmitEvent,
  status: ReviewSummaryDraftStatus,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  postedGitHubReviewId: Schema.NullOr(Schema.String),
  postedByGitHubUserLogin: Schema.NullOr(TrimmedNonEmptyString),
  failureDetail: Schema.NullOr(Schema.String),
});
export type ReviewSummaryDraft = typeof ReviewSummaryDraft.Type;

export const ReviewGitHubReview = Schema.Struct({
  id: TrimmedNonEmptyString,
  pullRequestId: TrimmedNonEmptyString,
  authorLogin: TrimmedNonEmptyString,
  body: Schema.String,
  state: Schema.String,
  commitId: Schema.NullOr(Schema.String),
  submittedAt: Schema.NullOr(IsoDateTime),
  url: Schema.NullOr(Schema.String),
});
export type ReviewGitHubReview = typeof ReviewGitHubReview.Type;

export const ReviewGitHubReviewComment = Schema.Struct({
  id: TrimmedNonEmptyString,
  pullRequestId: TrimmedNonEmptyString,
  reviewId: Schema.NullOr(Schema.String),
  authorLogin: TrimmedNonEmptyString,
  body: Schema.String,
  path: TrimmedNonEmptyString,
  line: Schema.NullOr(PositiveInt),
  side: Schema.NullOr(ReviewCommentSide),
  startLine: Schema.NullOr(PositiveInt),
  startSide: Schema.NullOr(ReviewCommentSide),
  diffHunk: Schema.NullOr(Schema.String),
  inReplyToId: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
  createdAt: Schema.NullOr(IsoDateTime),
  updatedAt: Schema.NullOr(IsoDateTime),
});
export type ReviewGitHubReviewComment = typeof ReviewGitHubReviewComment.Type;

export const ReviewConversationRole = Schema.Literals(["user", "agent"]);
export type ReviewConversationRole = typeof ReviewConversationRole.Type;

export const ReviewConversationMessage = Schema.Struct({
  id: TrimmedNonEmptyString,
  pullRequestId: TrimmedNonEmptyString,
  role: ReviewConversationRole,
  body: Schema.String,
  modelSelection: Schema.NullOr(ModelSelection),
  createdAt: IsoDateTime,
});
export type ReviewConversationMessage = typeof ReviewConversationMessage.Type;

export const ReviewPullRequestDetail = Schema.Struct({
  pullRequestId: TrimmedNonEmptyString,
  headSha: Schema.NullOr(Schema.String),
  codeBlocks: Schema.Array(ReviewCodeBlock),
  githubReviews: Schema.Array(ReviewGitHubReview),
  githubReviewComments: Schema.Array(ReviewGitHubReviewComment),
  summaryDrafts: Schema.Array(ReviewSummaryDraft),
  commentDrafts: Schema.Array(ReviewCommentDraft),
  conversationMessages: Schema.Array(ReviewConversationMessage),
  syncedAt: Schema.NullOr(IsoDateTime),
});
export type ReviewPullRequestDetail = typeof ReviewPullRequestDetail.Type;

export const ReviewInboxSnapshot = Schema.Struct({
  github: ReviewGitHubAuthState,
  groups: Schema.Array(ReviewSidebarGroup),
  pullRequests: Schema.Array(ReviewPullRequest),
  pullRequestDetails: Schema.Array(ReviewPullRequestDetail).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
  skills: Schema.Array(ReviewSkill),
  mcpConnections: Schema.Array(ReviewMcpConnection),
  reviewRuns: Schema.Array(ReviewRun),
  syncedAt: Schema.NullOr(IsoDateTime),
});
export type ReviewInboxSnapshot = typeof ReviewInboxSnapshot.Type;

export const ReviewSetPullRequestPinnedInput = Schema.Struct({
  pullRequestId: TrimmedNonEmptyString,
  pinned: Schema.Boolean,
});
export type ReviewSetPullRequestPinnedInput = typeof ReviewSetPullRequestPinnedInput.Type;

export const ReviewSetRepositoryHiddenInput = Schema.Struct({
  repositoryId: TrimmedNonEmptyString,
  hidden: Schema.Boolean,
});
export type ReviewSetRepositoryHiddenInput = typeof ReviewSetRepositoryHiddenInput.Type;

export const ReviewSetPullRequestHiddenInput = Schema.Struct({
  pullRequestId: TrimmedNonEmptyString,
  hidden: Schema.Boolean,
});
export type ReviewSetPullRequestHiddenInput = typeof ReviewSetPullRequestHiddenInput.Type;

export const ReviewTrackPullRequestInput = Schema.Struct({
  provider: ReviewIntegrationProvider,
  ownerLogin: TrimmedNonEmptyString,
  repositoryName: TrimmedNonEmptyString,
  number: PositiveInt,
});
export type ReviewTrackPullRequestInput = typeof ReviewTrackPullRequestInput.Type;

export const ReviewStartRunInput = Schema.Struct({
  pullRequestId: TrimmedNonEmptyString,
  categories: Schema.Array(ReviewCategory),
  skillIds: Schema.Array(TrimmedNonEmptyString),
  mcpConnectionIds: Schema.Array(TrimmedNonEmptyString),
  modelSelection: Schema.optional(ModelSelection),
});
export type ReviewStartRunInput = typeof ReviewStartRunInput.Type;

export const ReviewSubmitRunInput = Schema.Struct({
  runId: TrimmedNonEmptyString,
  event: Schema.optional(ReviewSubmitEvent),
});
export type ReviewSubmitRunInput = typeof ReviewSubmitRunInput.Type;

export const ReviewRefreshPullRequestDetailInput = Schema.Struct({
  pullRequestId: TrimmedNonEmptyString,
});
export type ReviewRefreshPullRequestDetailInput = typeof ReviewRefreshPullRequestDetailInput.Type;

export const ReviewUpdateSummaryDraftInput = Schema.Struct({
  summaryDraftId: TrimmedNonEmptyString,
  body: Schema.optional(Schema.String),
  event: Schema.optional(ReviewSubmitEvent),
});
export type ReviewUpdateSummaryDraftInput = typeof ReviewUpdateSummaryDraftInput.Type;

export const ReviewDeleteSummaryDraftInput = Schema.Struct({
  summaryDraftId: TrimmedNonEmptyString,
});
export type ReviewDeleteSummaryDraftInput = typeof ReviewDeleteSummaryDraftInput.Type;

export const ReviewUpdateCommentDraftInput = Schema.Struct({
  commentDraftId: TrimmedNonEmptyString,
  body: Schema.optional(Schema.String),
  status: Schema.optional(ReviewCommentDraftStatus),
  filePath: Schema.optional(TrimmedNonEmptyString),
  line: Schema.optional(PositiveInt),
  side: Schema.optional(ReviewCommentSide),
  startLine: Schema.optional(Schema.NullOr(PositiveInt)),
  startSide: Schema.optional(Schema.NullOr(ReviewCommentSide)),
});
export type ReviewUpdateCommentDraftInput = typeof ReviewUpdateCommentDraftInput.Type;

export const ReviewSendChatMessageInput = Schema.Struct({
  pullRequestId: TrimmedNonEmptyString,
  message: TrimmedNonEmptyString,
  modelSelection: Schema.optional(ModelSelection),
});
export type ReviewSendChatMessageInput = typeof ReviewSendChatMessageInput.Type;

export const REVIEW_WS_METHODS = {
  getSnapshot: "review.getSnapshot",
  subscribe: "review.subscribe",
  githubBeginOAuth: "review.github.beginOAuth",
  githubCompleteOAuth: "review.github.completeOAuth",
  refreshInbox: "review.refreshInbox",
  setPullRequestPinned: "review.setPullRequestPinned",
  setRepositoryHidden: "review.setRepositoryHidden",
  setPullRequestHidden: "review.setPullRequestHidden",
  trackPullRequest: "review.trackPullRequest",
  upsertMcpConnection: "review.upsertMcpConnection",
  removeMcpConnection: "review.removeMcpConnection",
  installSkill: "review.installSkill",
  setSkillEnabled: "review.setSkillEnabled",
  removeSkill: "review.removeSkill",
  refreshPullRequestDetail: "review.refreshPullRequestDetail",
  updateSummaryDraft: "review.updateSummaryDraft",
  deleteSummaryDraft: "review.deleteSummaryDraft",
  updateCommentDraft: "review.updateCommentDraft",
  sendChatMessage: "review.sendChatMessage",
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
