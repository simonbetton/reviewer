import * as NodeCrypto from "node:crypto";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import {
  ReviewCategory,
  ReviewFindingSeverity,
  ReviewGitHubAuthState,
  ReviewGitHubReview,
  ReviewGitHubReviewComment,
  ReviewInboxSnapshot,
  ReviewInstallerResult,
  type ReviewCodeBlock,
  ReviewCommentDraft,
  type ReviewConversationMessage,
  type ReviewFinding,
  ReviewMcpConnection,
  ReviewPullRequestDetail,
  ReviewPullRequest,
  ReviewRepository,
  ReviewRun,
  ReviewSkill,
  type ReviewSubmitEvent,
  ReviewSummaryDraft,
  ReviewWorkspaceError,
  type ReviewDeleteSummaryDraftInput,
  type ReviewGitHubBeginOAuthInput,
  type ReviewGitHubBeginOAuthResult,
  type ReviewGitHubCompleteOAuthInput,
  type ReviewInstallSkillInput,
  type ReviewRefreshPullRequestDetailInput,
  type ReviewRemoveMcpConnectionInput,
  type ReviewRemoveSkillInput,
  type ReviewSendChatMessageInput,
  type ReviewSetPullRequestHiddenInput,
  type ReviewSetPullRequestPinnedInput,
  type ReviewSetRepositoryHiddenInput,
  type ReviewSetSkillEnabledInput,
  type ReviewStartRunInput,
  type ReviewSubmitRunInput,
  type ReviewTrackPullRequestInput,
  type ReviewUpdateCommentDraftInput,
  type ReviewUpdateSummaryDraftInput,
  type ReviewUpsertMcpConnectionInput,
  type ModelSelection,
} from "@t3tools/contracts";
import {
  buildGitHubInlineReviewPayload,
  buildReviewSidebarGroups,
  createReviewChatResponse,
  createReviewCommentDrafts,
  createReviewFindings,
  createReviewRunConversationMessage,
  createReviewSummaryDraft,
  DEFAULT_REVIEW_SKILLS,
  isReviewRunStale,
  markRunPosted,
  parseReviewCodeBlocks,
  type ReviewPullRequestFileChange,
  sortReviewPullRequests,
  summarizeReviewRun,
} from "./reviewWorkspaceLogic.ts";
import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";
import { ServerSecretStore } from "../auth/ServerSecretStore.ts";
import { writeFileStringAtomically } from "../atomicWrite.ts";
import { ServerConfig } from "../config.ts";
import type { TextGenerationShape } from "../textGeneration/TextGeneration.ts";

const DEFAULT_GITHUB_OAUTH_SCOPES = ["read:user", "user:email", "repo", "read:org"] as const;
const GITHUB_OAUTH_TOKEN_SECRET_NAME = "review-github-oauth-token";
const REVIEW_WORKSPACE_STATE_FILE = "review-workspace.json";
const REVIEW_INBOX_SYNC_INTERVAL = Duration.seconds(60);
const REVIEW_INBOX_REPOSITORY_LIMIT = 50;
const REVIEW_INBOX_PULL_REQUEST_LIMIT = 20;
const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";
const MAX_REVIEW_GENERATION_PROMPT_CHARS = 100_000;
const MAX_REVIEW_GENERATED_COMMENTS = 25;
const isReviewWorkspaceError = Schema.is(ReviewWorkspaceError);

const NullableReviewCommentSide = Schema.NullOr(Schema.Literals(["LEFT", "RIGHT"]));

export const ReviewAgentCommentOutput = Schema.Struct({
  path: Schema.String,
  line: Schema.Int,
  side: NullableReviewCommentSide,
  startLine: Schema.NullOr(Schema.Int),
  startSide: NullableReviewCommentSide,
  category: Schema.NullOr(ReviewCategory),
  severity: Schema.NullOr(ReviewFindingSeverity),
  confidence: Schema.NullOr(Schema.Int),
  title: Schema.String,
  explanation: Schema.String,
  body: Schema.String,
  suggestedFix: Schema.NullOr(Schema.String),
});

export const ReviewAgentRunOutput = Schema.Struct({
  summary: Schema.String,
  comments: Schema.Array(ReviewAgentCommentOutput),
});
type ReviewAgentRunOutput = typeof ReviewAgentRunOutput.Type;

export const ReviewAgentChatOutput = Schema.Struct({
  body: Schema.String,
});
type ReviewAgentChatOutput = typeof ReviewAgentChatOutput.Type;

const PersistedReviewWorkspaceState = Schema.Struct({
  github: ReviewGitHubAuthState,
  repositories: Schema.Array(ReviewRepository),
  pullRequests: Schema.Array(ReviewPullRequest),
  skills: Schema.Array(ReviewSkill),
  mcpConnections: Schema.Array(ReviewMcpConnection),
  reviewRuns: Schema.Array(ReviewRun),
  pullRequestDetails: Schema.Array(ReviewPullRequestDetail).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
  syncedAt: Schema.NullOr(Schema.String),
});
type PersistedReviewWorkspaceState = typeof PersistedReviewWorkspaceState.Type;
interface GitHubPullRequestHealth {
  readonly repository: ReviewRepository;
  readonly pullRequest: ReviewPullRequest;
}

const PersistedReviewWorkspaceStateJson = fromJsonStringPretty(PersistedReviewWorkspaceState);
const encodePersistedReviewWorkspaceStateJson = Schema.encodeEffect(
  PersistedReviewWorkspaceStateJson,
);
const decodePersistedReviewWorkspaceStateJson = Schema.decodeUnknownEffect(
  PersistedReviewWorkspaceStateJson,
);
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

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
  readonly setPullRequestPinned: (
    input: ReviewSetPullRequestPinnedInput,
  ) => Effect.Effect<ReviewInboxSnapshot, ReviewWorkspaceError>;
  readonly setRepositoryHidden: (
    input: ReviewSetRepositoryHiddenInput,
  ) => Effect.Effect<ReviewInboxSnapshot, ReviewWorkspaceError>;
  readonly setPullRequestHidden: (
    input: ReviewSetPullRequestHiddenInput,
  ) => Effect.Effect<ReviewInboxSnapshot, ReviewWorkspaceError>;
  readonly trackPullRequest: (
    input: ReviewTrackPullRequestInput,
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
  readonly refreshPullRequestDetail: (
    input: ReviewRefreshPullRequestDetailInput,
  ) => Effect.Effect<ReviewInboxSnapshot, ReviewWorkspaceError>;
  readonly updateSummaryDraft: (
    input: ReviewUpdateSummaryDraftInput,
  ) => Effect.Effect<ReviewInboxSnapshot, ReviewWorkspaceError>;
  readonly deleteSummaryDraft: (
    input: ReviewDeleteSummaryDraftInput,
  ) => Effect.Effect<ReviewInboxSnapshot, ReviewWorkspaceError>;
  readonly updateCommentDraft: (
    input: ReviewUpdateCommentDraftInput,
  ) => Effect.Effect<ReviewInboxSnapshot, ReviewWorkspaceError>;
  readonly sendChatMessage: (
    input: ReviewSendChatMessageInput,
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
    pullRequestDetails: [],
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
    groups: buildReviewSidebarGroups(state.repositories, state.pullRequests),
    pullRequests: sortReviewPullRequests(state.pullRequests),
    pullRequestDetails: state.pullRequestDetails,
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

// TODO(review): Execute `npx skills install` via VcsProcess when runInstaller is true.
// See .plans/21-github-peer-review-handoff.md — P1 skills installer.
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

function parseNonNegativeInt(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function parsePositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseIsoDateTime(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

function parseReviewCommentSide(value: unknown): "LEFT" | "RIGHT" | null {
  return value === "LEFT" || value === "RIGHT" ? value : null;
}

function normalizePullRequestFileChange(
  raw: Record<string, unknown>,
): ReviewPullRequestFileChange | null {
  const filename = String(raw.filename ?? "").trim();
  if (!filename) return null;
  return {
    filename,
    status: String(raw.status ?? "modified"),
    additions: parseNonNegativeInt(raw.additions),
    deletions: parseNonNegativeInt(raw.deletions),
    changes: parseNonNegativeInt(raw.changes),
    patch: typeof raw.patch === "string" ? raw.patch : null,
    previousFilename:
      typeof raw.previous_filename === "string" && raw.previous_filename.trim().length > 0
        ? raw.previous_filename
        : null,
  };
}

function normalizeGitHubReview(input: {
  readonly pullRequestId: string;
  readonly raw: Record<string, unknown>;
}): ReviewGitHubReview | null {
  const id = String(input.raw.id ?? "").trim();
  if (!id) return null;
  return {
    id,
    pullRequestId: input.pullRequestId,
    authorLogin: String((input.raw.user as Record<string, unknown> | undefined)?.login ?? "github"),
    body: typeof input.raw.body === "string" ? input.raw.body : "",
    state: String(input.raw.state ?? "COMMENTED"),
    commitId: typeof input.raw.commit_id === "string" ? input.raw.commit_id : null,
    submittedAt: parseIsoDateTime(input.raw.submitted_at),
    url: typeof input.raw.html_url === "string" ? input.raw.html_url : null,
  };
}

function normalizeGitHubReviewComment(input: {
  readonly pullRequestId: string;
  readonly raw: Record<string, unknown>;
}): ReviewGitHubReviewComment | null {
  const id = String(input.raw.id ?? "").trim();
  const path = String(input.raw.path ?? "").trim();
  if (!id || !path) return null;
  return {
    id,
    pullRequestId: input.pullRequestId,
    reviewId:
      input.raw.pull_request_review_id === null || input.raw.pull_request_review_id === undefined
        ? null
        : String(input.raw.pull_request_review_id),
    authorLogin: String((input.raw.user as Record<string, unknown> | undefined)?.login ?? "github"),
    body: typeof input.raw.body === "string" ? input.raw.body : "",
    path,
    line: parsePositiveInt(input.raw.line),
    side: parseReviewCommentSide(input.raw.side),
    startLine: parsePositiveInt(input.raw.start_line),
    startSide: parseReviewCommentSide(input.raw.start_side),
    diffHunk: typeof input.raw.diff_hunk === "string" ? input.raw.diff_hunk : null,
    inReplyToId:
      input.raw.in_reply_to_id === null || input.raw.in_reply_to_id === undefined
        ? null
        : String(input.raw.in_reply_to_id),
    url: typeof input.raw.html_url === "string" ? input.raw.html_url : null,
    createdAt: parseIsoDateTime(input.raw.created_at),
    updatedAt: parseIsoDateTime(input.raw.updated_at),
  };
}

function extractPullRequestHeadSha(raw: Record<string, unknown>): string | null {
  const head = raw.head as Record<string, unknown> | undefined;
  const sha = head?.sha;
  return typeof sha === "string" && sha.trim().length > 0 ? sha : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function graphQlNodes(value: unknown): Record<string, unknown>[] {
  const record = asRecord(value);
  const nodes = Array.isArray(record?.nodes) ? record.nodes : [];
  return nodes.flatMap((node) => {
    const normalized = asRecord(node);
    return normalized ? [normalized] : [];
  });
}

function graphQlTotalCount(value: unknown): number {
  return parseNonNegativeInt(asRecord(value)?.totalCount);
}

function parseTrimmedString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function normalizeGitHubGraphQlPullRequestState(
  raw: Record<string, unknown>,
): ReviewPullRequest["state"] {
  const state = typeof raw.state === "string" ? raw.state.toUpperCase() : "";
  if (state === "MERGED" || raw.merged === true) return "merged";
  if (state === "CLOSED") return "closed";
  return "open";
}

function extractGitHubGraphQlHeadSha(raw: Record<string, unknown>): string | null {
  const headRefOid = raw.headRefOid;
  if (typeof headRefOid === "string" && headRefOid.trim().length > 0) return headRefOid;
  const commit = asRecord(graphQlNodes(raw.commits).at(-1)?.commit);
  const oid = commit?.oid;
  return typeof oid === "string" && oid.trim().length > 0 ? oid : null;
}

function extractGitHubGraphQlChecksState(raw: Record<string, unknown>): string | null {
  const pullRequestRollup = asRecord(raw.statusCheckRollup);
  const pullRequestState = pullRequestRollup?.state;
  if (typeof pullRequestState === "string" && pullRequestState.trim().length > 0) {
    return pullRequestState;
  }
  const commit = asRecord(graphQlNodes(raw.commits).at(-1)?.commit);
  const commitRollup = asRecord(commit?.statusCheckRollup);
  const commitState = commitRollup?.state;
  return typeof commitState === "string" && commitState.trim().length > 0 ? commitState : null;
}

function gitHubRepositoryId(nameWithOwner: string): string {
  return `github:${nameWithOwner.toLowerCase()}`;
}

function normalizeGitHubGraphQlRepository(input: {
  readonly raw: Record<string, unknown>;
  readonly existing?: ReviewRepository;
}): ReviewRepository | null {
  const nameWithOwner = parseTrimmedString(input.raw.nameWithOwner, "");
  if (!nameWithOwner.includes("/")) return null;
  const [ownerLoginFallback = "", nameFallback = ""] = nameWithOwner.split("/");
  const owner = asRecord(input.raw.owner);
  const ownerLogin = parseTrimmedString(owner?.login, ownerLoginFallback);
  const name = parseTrimmedString(input.raw.name, nameFallback);
  if (!ownerLogin || !name) return null;
  return {
    id: gitHubRepositoryId(nameWithOwner),
    provider: "github",
    ownerKind: owner?.__typename === "Organization" ? "organization" : "personal",
    ownerLogin,
    name,
    nameWithOwner,
    url: parseTrimmedString(input.raw.url, `https://github.com/${nameWithOwner}`),
    openPullRequestCount: graphQlTotalCount(input.raw.openPullRequestCount),
    lastProviderUpdatedAt: parseIsoDateTime(input.raw.pushedAt),
    hidden: input.existing?.hidden ?? false,
  };
}

function normalizeGitHubGraphQlPullRequest(input: {
  readonly raw: Record<string, unknown>;
  readonly repository: ReviewRepository;
  readonly existing?: ReviewPullRequest;
  readonly tracked?: boolean;
}): ReviewPullRequest | null {
  const number = parsePositiveInt(input.raw.number);
  if (!number) return null;
  const id = `${input.repository.id}#${number}`;
  return {
    id,
    repositoryId: input.repository.id,
    provider: "github",
    number,
    title: parseTrimmedString(input.raw.title, `PR #${number}`),
    url: parseTrimmedString(
      input.raw.url,
      `https://github.com/${input.repository.nameWithOwner}/pull/${number}`,
    ),
    authorLogin: parseTrimmedString(asRecord(input.raw.author)?.login, "unknown"),
    baseRefName: parseTrimmedString(input.raw.baseRefName, "base"),
    headRefName: parseTrimmedString(input.raw.headRefName, "head"),
    state: normalizeGitHubGraphQlPullRequestState(input.raw),
    draft: Boolean(input.raw.isDraft),
    additions: parseNonNegativeInt(input.raw.additions),
    deletions: parseNonNegativeInt(input.raw.deletions),
    changedFiles: parseNonNegativeInt(input.raw.changedFiles),
    commentCount:
      graphQlTotalCount(input.raw.comments) + graphQlTotalCount(input.raw.reviewThreads),
    reviewDecision:
      typeof input.raw.reviewDecision === "string" && input.raw.reviewDecision.trim().length > 0
        ? input.raw.reviewDecision
        : null,
    checksState: extractGitHubGraphQlChecksState(input.raw),
    headSha: extractGitHubGraphQlHeadSha(input.raw),
    lastProviderUpdatedAt: parseIsoDateTime(input.raw.updatedAt),
    pinned: input.existing?.pinned ?? false,
    hidden: input.existing?.hidden ?? false,
    tracked: input.tracked ?? input.existing?.tracked ?? false,
  };
}

function hasLocalReviewArtifact(
  state: PersistedReviewWorkspaceState,
  pullRequestId: string,
): boolean {
  if (state.reviewRuns.some((run) => run.pullRequestId === pullRequestId)) return true;
  return state.pullRequestDetails.some(
    (detail) =>
      detail.pullRequestId === pullRequestId &&
      (detail.summaryDrafts.length > 0 ||
        detail.commentDrafts.length > 0 ||
        detail.conversationMessages.length > 0),
  );
}

function shouldRetainPullRequest(
  state: PersistedReviewWorkspaceState,
  pullRequest: ReviewPullRequest,
): boolean {
  return (
    pullRequest.state === "open" ||
    pullRequest.tracked ||
    pullRequest.pinned ||
    hasLocalReviewArtifact(state, pullRequest.id)
  );
}

const REVIEW_PULL_REQUEST_HEALTH_GRAPHQL_FRAGMENT = `
fragment ReviewPullRequestHealth on PullRequest {
  number
  title
  url
  author {
    login
  }
  baseRefName
  headRefName
  state
  merged
  isDraft
  additions
  deletions
  changedFiles
  comments {
    totalCount
  }
  reviewThreads {
    totalCount
  }
  reviewDecision
  updatedAt
  headRefOid
  statusCheckRollup {
    state
  }
  commits(last: 1) {
    nodes {
      commit {
        oid
        statusCheckRollup {
          state
        }
      }
    }
  }
}
`;

const REVIEW_INBOX_GRAPHQL_QUERY = `
${REVIEW_PULL_REQUEST_HEALTH_GRAPHQL_FRAGMENT}
query T3ReviewInbox($repositoryFirst: Int!, $pullRequestFirst: Int!) {
  viewer {
    repositories(
      first: $repositoryFirst
      affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
      orderBy: { field: PUSHED_AT, direction: DESC }
    ) {
      nodes {
        name
        nameWithOwner
        url
        pushedAt
        owner {
          __typename
          login
        }
        openPullRequestCount: pullRequests(states: OPEN) {
          totalCount
        }
        openPullRequests: pullRequests(
          first: $pullRequestFirst
          states: OPEN
          orderBy: { field: UPDATED_AT, direction: DESC }
        ) {
          nodes {
            ...ReviewPullRequestHealth
          }
        }
      }
    }
  }
}
`;

const REVIEW_TRACK_PULL_REQUEST_GRAPHQL_QUERY = `
${REVIEW_PULL_REQUEST_HEALTH_GRAPHQL_FRAGMENT}
query T3ReviewTrackPullRequest($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    name
    nameWithOwner
    url
    pushedAt
    owner {
      __typename
      login
    }
    openPullRequestCount: pullRequests(states: OPEN) {
      totalCount
    }
    pullRequest(number: $number) {
      ...ReviewPullRequestHealth
    }
  }
}
`;

function replacePullRequestDetail(
  details: ReadonlyArray<ReviewPullRequestDetail>,
  detail: ReviewPullRequestDetail,
): ReviewPullRequestDetail[] {
  return [detail, ...details.filter((entry) => entry.pullRequestId !== detail.pullRequestId)];
}

function githubRepositoryApiPath(repository: ReviewRepository): string {
  return `${encodeURIComponent(repository.ownerLogin)}/${encodeURIComponent(repository.name)}`;
}

function truncatePromptSection(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n[truncated ${value.length - maxChars} chars]`;
}

function extractProviderJsonMessage(value: string): string | null {
  const match = /"message"\s*:\s*("(?:\\.|[^"\\])*")/u.exec(value);
  if (!match?.[1]) return null;
  try {
    const parsed = JSON.parse(match[1]);
    return typeof parsed === "string" && parsed.trim().length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function sanitizeProviderDiagnostic(detail: string): string {
  const lastErrorIndex = detail.lastIndexOf("ERROR:");
  const focused = lastErrorIndex >= 0 ? detail.slice(lastErrorIndex) : detail;
  const extracted = extractProviderJsonMessage(focused) ?? focused;
  const collapsed = extracted.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return "Provider failed without diagnostic output.";
  if (/--------\s+user\b/iu.test(collapsed)) {
    return "Provider process failed after prompt submission; raw prompt output omitted.";
  }
  return truncatePromptSection(collapsed, 1_000);
}

function providerFailureDetail(kind: "review" | "chat"): string {
  return `Provider ${kind} generation failed. Check server logs for diagnostics and try again.`;
}

function failWithProviderGenerationError(input: {
  readonly kind: "review" | "chat";
  readonly operation: string;
  readonly providerOperation: string;
  readonly pullRequestId: string;
  readonly modelSelection: ModelSelection;
  readonly detail: string;
}): Effect.Effect<never, ReviewWorkspaceError> {
  return Effect.logError("review provider generation failed", {
    operation: input.providerOperation,
    pullRequestId: input.pullRequestId,
    model: input.modelSelection.model,
    instanceId: String(input.modelSelection.instanceId),
    detail: sanitizeProviderDiagnostic(input.detail),
  }).pipe(
    Effect.flatMap(() =>
      Effect.fail(toWorkspaceError(input.operation, providerFailureDetail(input.kind))),
    ),
  );
}

function formatReviewGenerationPrompt(input: {
  readonly repository: ReviewRepository;
  readonly pullRequest: ReviewPullRequest;
  readonly categories: ReadonlyArray<string>;
  readonly skills: ReadonlyArray<ReviewSkill>;
  readonly files: ReadonlyArray<ReviewPullRequestFileChange>;
  readonly detail: ReviewPullRequestDetail;
}): string {
  const fileSections = input.files.map((file) =>
    [
      `### ${file.filename}`,
      `status=${file.status} additions=${file.additions} deletions=${file.deletions}`,
      file.previousFilename ? `previous=${file.previousFilename}` : null,
      "```diff",
      file.patch ?? "[GitHub did not return a patch for this file.]",
      "```",
    ]
      .filter((line): line is string => typeof line === "string")
      .join("\n"),
  );
  const diffAnchors = input.detail.codeBlocks.flatMap((block) =>
    block.lines.flatMap((line) => {
      if (line.kind === "addition" && line.newLine !== null) {
        return [`${block.filePath}:RIGHT:${line.newLine}: ${line.content}`];
      }
      if (line.kind === "deletion" && line.oldLine !== null) {
        return [`${block.filePath}:LEFT:${line.oldLine}: ${line.content}`];
      }
      if (line.kind === "context" && line.newLine !== null) {
        return [`${block.filePath}:RIGHT:${line.newLine}: ${line.content}`];
      }
      return [];
    }),
  );
  const githubContext = [
    ...input.detail.githubReviews.map(
      (review) => `review by ${review.authorLogin} (${review.state}): ${review.body}`,
    ),
    ...input.detail.githubReviewComments.map(
      (comment) =>
        `inline by ${comment.authorLogin} on ${comment.path}:${comment.side ?? "RIGHT"}:${
          comment.line ?? "?"
        }: ${comment.body}`,
    ),
  ];
  const skillContext = input.skills.map((skill) => `${skill.name}: ${skill.description}`);
  const prompt = [
    "You are drafting a GitHub Pull Request Review for T3 Code.",
    "Return JSON only. Do not include markdown fences around the JSON.",
    "Create a concise review summary and actionable inline comments. Inline comments must be suitable for posting directly to GitHub review comments.",
    "Use only line anchors from the supplied diff anchors. For added/new/context lines use side RIGHT and the new line number. For removed lines use side LEFT and the old line number.",
    "Every comment object must include every key shown in Output shape. Set unused values to null; do not omit keys.",
    "Do not invent files or line numbers. If there is no actionable issue, return an empty comments array.",
    `Repository: ${input.repository.nameWithOwner}`,
    `Pull request: #${input.pullRequest.number} ${input.pullRequest.title}`,
    `Head SHA: ${input.pullRequest.headSha ?? "unknown"}`,
    `Requested categories: ${input.categories.length > 0 ? input.categories.join(", ") : "general"}`,
    "",
    "Enabled review skills:",
    skillContext.length > 0 ? skillContext.join("\n") : "None selected.",
    "",
    "Existing GitHub review context:",
    githubContext.length > 0 ? githubContext.join("\n\n") : "No existing reviews or comments.",
    "",
    "Diff anchors:",
    diffAnchors.length > 0 ? diffAnchors.join("\n") : "No diff anchors available.",
    "",
    "Changed file patches:",
    fileSections.join("\n\n"),
    "",
    "Output shape:",
    JSON.stringify({
      summary: "overall review summary",
      comments: [
        {
          path: "path/from/diff",
          line: 123,
          side: "RIGHT",
          startLine: null,
          startSide: null,
          category: "correctness",
          severity: "major",
          confidence: 80,
          title: "short issue title",
          explanation: "why this matters",
          body: "comment to post on this exact line",
          suggestedFix: null,
        },
      ],
    }),
  ].join("\n");
  return truncatePromptSection(prompt, MAX_REVIEW_GENERATION_PROMPT_CHARS);
}

function asPositiveLine(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.trunc(value);
  return rounded > 0 ? rounded : null;
}

function findReviewAnchor(input: {
  readonly codeBlocks: ReadonlyArray<ReviewCodeBlock>;
  readonly path: string;
  readonly line: number | null;
  readonly side: "LEFT" | "RIGHT";
}): { readonly filePath: string; readonly line: number; readonly side: "LEFT" | "RIGHT" } | null {
  const blocks = input.codeBlocks.filter((block) => block.filePath === input.path);
  const line = input.line;
  if (line !== null) {
    for (const block of blocks) {
      const matchingLine = block.lines.find((candidate) => {
        if (input.side === "RIGHT") {
          return candidate.newLine === line;
        }
        return candidate.oldLine === line;
      });
      if (matchingLine) {
        return { filePath: block.filePath, line, side: input.side };
      }
    }
  }

  const fallbackBlocks = blocks.length > 0 ? blocks : input.codeBlocks;
  for (const block of fallbackBlocks) {
    const addition = block.lines.find((candidate) => candidate.newLine !== null);
    if (addition?.newLine !== null && addition?.newLine !== undefined) {
      return { filePath: block.filePath, line: addition.newLine, side: "RIGHT" };
    }
  }
  return null;
}

function normalizeGeneratedReviewArtifacts(input: {
  readonly output: ReviewAgentRunOutput;
  readonly runId: string;
  readonly pullRequestId: string;
  readonly categories: ReadonlyArray<ReviewStartRunInput["categories"][number]>;
  readonly codeBlocks: ReadonlyArray<ReviewCodeBlock>;
  readonly now: string;
}): {
  readonly findings: ReviewFinding[];
  readonly commentDrafts: ReviewCommentDraft[];
  readonly summary: string;
} {
  const fallbackCategory = input.categories[0] ?? "risk";
  const findings: ReviewFinding[] = [];
  const commentDrafts: ReviewCommentDraft[] = [];
  const summary = input.output.summary.trim();

  input.output.comments.slice(0, MAX_REVIEW_GENERATED_COMMENTS).forEach((comment, index) => {
    const body = comment.body.trim();
    if (body.length === 0) return;
    const side = comment.side ?? "RIGHT";
    const anchor = findReviewAnchor({
      codeBlocks: input.codeBlocks,
      path: comment.path,
      line: asPositiveLine(comment.line),
      side,
    });
    if (!anchor) return;

    const findingId = `${input.runId}:agent:${index + 1}`;
    const draftId = `${input.runId}:comment:${index + 1}`;
    const startLine = asPositiveLine(comment.startLine ?? null);
    const startSide = startLine === null ? null : (comment.startSide ?? anchor.side);
    const confidence = Math.max(0, Math.min(100, Math.trunc(comment.confidence ?? 80)));

    findings.push({
      id: findingId,
      category: comment.category ?? fallbackCategory,
      severity: comment.severity ?? "minor",
      confidence,
      title: comment.title.trim() || "Review comment",
      explanation: comment.explanation.trim() || body,
      filePath: anchor.filePath,
      line: anchor.line,
      suggestedFix: comment.suggestedFix?.trim() || null,
      status: "open",
      authoredBy: "agent",
      postedByGitHubUserLogin: null,
      createdAt: input.now,
    });
    commentDrafts.push({
      id: draftId,
      runId: input.runId,
      pullRequestId: input.pullRequestId,
      findingId,
      body,
      filePath: anchor.filePath,
      line: anchor.line,
      side: anchor.side,
      startLine,
      startSide,
      status: "draft",
      createdAt: input.now,
      updatedAt: input.now,
      postedGitHubCommentId: null,
      postedByGitHubUserLogin: null,
      failureDetail: null,
    });
  });

  return { findings, commentDrafts, summary };
}

function formatReviewChatPrompt(input: {
  readonly pullRequest: ReviewPullRequest;
  readonly detail: ReviewPullRequestDetail;
  readonly message: string;
}): string {
  const conversation = input.detail.conversationMessages
    .slice(-20)
    .map((entry) => `${entry.role}: ${entry.body}`)
    .join("\n\n");
  const drafts = [
    ...input.detail.summaryDrafts.map((draft) => `summary draft (${draft.status}): ${draft.body}`),
    ...input.detail.commentDrafts.map(
      (draft) =>
        `inline draft (${draft.status}) ${draft.filePath}:${draft.side}:${draft.line}: ${draft.body}`,
    ),
  ];
  const githubContext = [
    ...input.detail.githubReviews.map(
      (review) => `review by ${review.authorLogin} (${review.state}): ${review.body}`,
    ),
    ...input.detail.githubReviewComments.map(
      (comment) =>
        `inline by ${comment.authorLogin} id=${comment.id} ${comment.path}:${
          comment.side ?? "RIGHT"
        }:${comment.line ?? "?"}: ${comment.body}`,
    ),
  ];
  const anchors = input.detail.codeBlocks.flatMap((block) =>
    block.lines.flatMap((line) => {
      if (line.kind === "addition" && line.newLine !== null) {
        return [`${block.filePath}:RIGHT:${line.newLine}: ${line.content}`];
      }
      if (line.kind === "deletion" && line.oldLine !== null) {
        return [`${block.filePath}:LEFT:${line.oldLine}: ${line.content}`];
      }
      if (line.kind === "context" && line.newLine !== null) {
        return [`${block.filePath}:RIGHT:${line.newLine}: ${line.content}`];
      }
      return [];
    }),
  );

  return truncatePromptSection(
    [
      "You are the PR review agent inside T3 Code. Reply directly to the user's latest message.",
      "Return JSON only. This is an in-app Q&A response, not postable GitHub feedback.",
      "Do not draft GitHub review summaries, inline comments, replies, or post text in this response.",
      `Pull request: #${input.pullRequest.number} ${input.pullRequest.title}`,
      `Head SHA: ${input.pullRequest.headSha ?? input.detail.headSha ?? "unknown"}`,
      "",
      "Conversation so far:",
      conversation || "No earlier local conversation.",
      "",
      "Local T3 drafts:",
      drafts.length > 0 ? drafts.join("\n\n") : "No local drafts.",
      "",
      "GitHub reviews and inline comments:",
      githubContext.length > 0 ? githubContext.join("\n\n") : "No GitHub review context.",
      "",
      "Diff anchors:",
      anchors.length > 0 ? anchors.join("\n") : "No diff anchors available.",
      "",
      "Latest user message:",
      input.message,
      "",
      "Output shape:",
      JSON.stringify({
        body: "direct in-app reply to the user",
      }),
    ].join("\n"),
    MAX_REVIEW_GENERATION_PROMPT_CHARS,
  );
}

function formatReviewDraftPrompt(input: {
  readonly pullRequest: ReviewPullRequest;
  readonly detail: ReviewPullRequestDetail;
  readonly message: string;
}): string {
  const conversation = input.detail.conversationMessages
    .slice(-20)
    .map((entry) => `${entry.role}: ${entry.body}`)
    .join("\n\n");
  const drafts = [
    ...input.detail.summaryDrafts.map((draft) => `summary draft (${draft.status}): ${draft.body}`),
    ...input.detail.commentDrafts.map(
      (draft) =>
        `inline draft (${draft.status}) ${draft.filePath}:${draft.side}:${draft.line}: ${draft.body}`,
    ),
  ];
  const githubContext = [
    ...input.detail.githubReviews.map(
      (review) => `review by ${review.authorLogin} (${review.state}): ${review.body}`,
    ),
    ...input.detail.githubReviewComments.map(
      (comment) =>
        `inline by ${comment.authorLogin} id=${comment.id} ${comment.path}:${
          comment.side ?? "RIGHT"
        }:${comment.line ?? "?"}: ${comment.body}`,
    ),
  ];
  const anchors = input.detail.codeBlocks.flatMap((block) =>
    block.lines.flatMap((line) => {
      if (line.kind === "addition" && line.newLine !== null) {
        return [`${block.filePath}:RIGHT:${line.newLine}: ${line.content}`];
      }
      if (line.kind === "deletion" && line.oldLine !== null) {
        return [`${block.filePath}:LEFT:${line.oldLine}: ${line.content}`];
      }
      if (line.kind === "context" && line.newLine !== null) {
        return [`${block.filePath}:RIGHT:${line.newLine}: ${line.content}`];
      }
      return [];
    }),
  );

  return truncatePromptSection(
    [
      "You are drafting local Review Drafts for T3 Code from a PR chat request.",
      "Return JSON only. Do not include markdown fences around the JSON.",
      "Create a neutral pull request review summary and, only when useful, actionable inline comments.",
      "The generated summary and inline comments stay local until the user submits the Review Drafts.",
      "Use only line anchors from the supplied diff anchors. For added/new/context lines use side RIGHT and the new line number. For removed lines use side LEFT and the old line number.",
      "Every comment object must include every key shown in Output shape. Set unused values to null; do not omit keys.",
      "Do not invent files or line numbers. If the user only asked for a summary, return an empty comments array.",
      `Pull request: #${input.pullRequest.number} ${input.pullRequest.title}`,
      `Head SHA: ${input.pullRequest.headSha ?? input.detail.headSha ?? "unknown"}`,
      "",
      "Conversation so far:",
      conversation || "No earlier local conversation.",
      "",
      "Local T3 drafts:",
      drafts.length > 0 ? drafts.join("\n\n") : "No local drafts.",
      "",
      "GitHub reviews and inline comments:",
      githubContext.length > 0 ? githubContext.join("\n\n") : "No GitHub review context.",
      "",
      "Diff anchors:",
      anchors.length > 0 ? anchors.join("\n") : "No diff anchors available.",
      "",
      "Latest user message:",
      input.message,
      "",
      "Output shape:",
      JSON.stringify({
        summary: "neutral pull request review summary draft",
        comments: [
          {
            path: "path/from/diff",
            line: 123,
            side: "RIGHT",
            startLine: null,
            startSide: null,
            category: "correctness",
            severity: "major",
            confidence: 80,
            title: "short issue title",
            explanation: "why this matters",
            body: "inline review comment draft",
            suggestedFix: null,
          },
        ],
      }),
    ].join("\n"),
    MAX_REVIEW_GENERATION_PROMPT_CHARS,
  );
}

function isExplicitReviewDraftRequest(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    /\b(draft|compose|write|prepare|suggest)\b[\s\S]{0,100}\b(comment|reply|review|summary|feedback|github post)\b/u.test(
      normalized,
    ) ||
    /\b(comment|reply|review|summary|feedback|github post)\b[\s\S]{0,100}\b(draft|compose|write|prepare|suggest)\b/u.test(
      normalized,
    ) ||
    /\b(create|make|leave)\b[\s\S]{0,80}\b(review comment|inline comment|github comment|review summary)\b/u.test(
      normalized,
    )
  );
}

function createGeneratedChatResponse(input: {
  readonly output: ReviewAgentChatOutput;
  readonly pullRequest: ReviewPullRequest;
  readonly message: string;
  readonly modelSelection: ModelSelection;
  readonly now: string;
}): {
  readonly userMessage: ReviewConversationMessage;
  readonly agentMessage: ReviewConversationMessage;
} {
  const userMessageId = `message-${NodeCrypto.randomUUID()}`;
  const agentMessageId = `message-${NodeCrypto.randomUUID()}`;

  return {
    userMessage: {
      id: userMessageId,
      pullRequestId: input.pullRequest.id,
      role: "user",
      body: input.message,
      modelSelection: input.modelSelection,
      createdAt: input.now,
    },
    agentMessage: {
      id: agentMessageId,
      pullRequestId: input.pullRequest.id,
      role: "agent",
      body: input.output.body.trim() || "I could not produce a useful response.",
      modelSelection: input.modelSelection,
      createdAt: input.now,
    },
  };
}

export const make = Effect.fn("makeReviewWorkspace")(function* (options?: {
  readonly textGeneration?: TextGenerationShape;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig;
  const secretStore = yield* ServerSecretStore;
  const statePath = path.join(serverConfig.stateDir, REVIEW_WORKSPACE_STATE_FILE);
  const changes = yield* PubSub.unbounded<ReviewInboxSnapshot>();
  const writeSemaphore = yield* Semaphore.make(1);

  const loadState = Effect.gen(function* () {
    const exists = yield* fileSystem.exists(statePath).pipe(Effect.orElseSucceed(() => false));
    if (!exists) return defaultState();

    const raw = yield* fileSystem.readFileString(statePath);
    return yield* decodePersistedReviewWorkspaceStateJson(raw);
  }).pipe(
    Effect.catch((cause) =>
      Effect.logWarning("Failed to load review workspace state; using defaults.", {
        path: statePath,
        cause,
      }).pipe(Effect.as(defaultState())),
    ),
  );

  const persistState = (state: PersistedReviewWorkspaceState) =>
    encodePersistedReviewWorkspaceStateJson(state).pipe(
      Effect.map((encoded) => `${encoded}\n`),
      Effect.flatMap((contents) =>
        writeFileStringAtomically({
          filePath: statePath,
          contents,
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
        ),
      ),
      Effect.mapError((cause) =>
        toWorkspaceError("review.persist", "Failed to persist review workspace state.", cause),
      ),
    );

  const loadToken = secretStore.get(GITHUB_OAUTH_TOKEN_SECRET_NAME).pipe(
    Effect.map(
      Option.match({
        onNone: () => null,
        onSome: (bytes) => {
          const token = textDecoder.decode(bytes).trim();
          return token.length > 0 ? token : null;
        },
      }),
    ),
    Effect.catch((cause) =>
      Effect.logWarning("Failed to load persisted GitHub OAuth token.", {
        secret: GITHUB_OAUTH_TOKEN_SECRET_NAME,
        cause,
      }).pipe(Effect.as(null)),
    ),
  );

  const initialState = yield* loadState;
  const initialToken = yield* loadToken;
  const stateRef = yield* Ref.make<PersistedReviewWorkspaceState>(initialState);
  const tokenRef = yield* Ref.make<string | null>(initialToken);

  const publishState = (state: PersistedReviewWorkspaceState) =>
    PubSub.publish(changes, snapshotFromState(state)).pipe(Effect.asVoid);

  const updateState = (
    operation: string,
    apply: (state: PersistedReviewWorkspaceState) => PersistedReviewWorkspaceState,
  ) =>
    writeSemaphore.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(stateRef);
        const next = apply(current);
        yield* persistState(next);
        yield* Ref.set(stateRef, next);
        yield* publishState(next);
        return snapshotFromState(next);
      }).pipe(
        Effect.mapError((cause) =>
          isReviewWorkspaceError(cause)
            ? cause
            : toWorkspaceError(operation, "Failed to update review workspace.", cause),
        ),
      ),
    );

  const getToken = Ref.get(tokenRef);
  const setToken = (token: string) =>
    secretStore.set(GITHUB_OAUTH_TOKEN_SECRET_NAME, textEncoder.encode(token)).pipe(
      Effect.mapError((cause) =>
        toWorkspaceError("github.oauth.persist", "Failed to persist GitHub OAuth token.", cause),
      ),
      Effect.flatMap(() => Ref.set(tokenRef, token)),
    );

  const githubJson = <A>(input: {
    readonly token: string;
    readonly url: string;
    readonly init?: RequestInit;
  }) =>
    Effect.tryPromise({
      try: async () => {
        // @effect-diagnostics-next-line globalFetchInEffect:off - Review workspace GitHub transport uses the existing fetch wrapper.
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
          const responseBody = await response.text().catch(() => "");
          throw new Error(
            `GitHub API returned ${response.status} for ${input.url}${
              responseBody ? `: ${responseBody.slice(0, 500)}` : ""
            }`,
          );
        }
        return {
          json: (await response.json()) as A,
          nextUrl: parseGitHubLinkNext(response.headers.get("link")),
          scopes: response.headers.get("x-oauth-scopes"),
        };
      },
      catch: (cause) => toWorkspaceError("github.api", "GitHub API request failed.", cause),
    });

  const githubGraphql = <A>(input: {
    readonly token: string;
    readonly query: string;
    readonly variables?: Record<string, unknown>;
  }) =>
    Effect.tryPromise({
      try: async () => {
        // @effect-diagnostics-next-line globalFetchInEffect:off - Review workspace GitHub transport uses the existing fetch wrapper.
        const response = await fetch(GITHUB_GRAPHQL_URL, {
          method: "POST",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${input.token}`,
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          // @effect-diagnostics-next-line preferSchemaOverJson:off - GraphQL request bodies are ad-hoc provider payloads.
          body: JSON.stringify({
            query: input.query,
            variables: input.variables ?? {},
          }),
        });
        if (!response.ok) {
          const responseBody = await response.text().catch(() => "");
          throw new Error(
            `GitHub GraphQL returned ${response.status}${
              responseBody ? `: ${responseBody.slice(0, 500)}` : ""
            }`,
          );
        }
        const json = (await response.json()) as {
          readonly data?: A;
          readonly errors?: ReadonlyArray<unknown>;
        };
        if (json.errors && json.errors.length > 0) {
          // @effect-diagnostics-next-line preferSchemaOverJson:off - Error payload is provider-owned and only summarized.
          throw new Error(`GitHub GraphQL errors: ${JSON.stringify(json.errors).slice(0, 500)}`);
        }
        if (!json.data) {
          throw new Error("GitHub GraphQL response did not include data.");
        }
        return json.data;
      },
      catch: (cause) => toWorkspaceError("github.graphql", "GitHub GraphQL request failed.", cause),
    });

  const githubPaginatedJson = <A>(input: { readonly token: string; readonly url: string }) =>
    Effect.gen(function* () {
      const items: A[] = [];
      let nextUrl: string | null = input.url;
      while (nextUrl) {
        const page: {
          readonly json: ReadonlyArray<A>;
          readonly nextUrl: string | null;
          readonly scopes: string | null;
        } = yield* githubJson<ReadonlyArray<A>>({ token: input.token, url: nextUrl });
        items.push(...page.json);
        nextUrl = page.nextUrl;
      }
      return items;
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

  const readPullRequestHealthByRoute = (input: {
    readonly token: string;
    readonly ownerLogin: string;
    readonly repositoryName: string;
    readonly number: number;
    readonly existingRepository?: ReviewRepository;
    readonly existingPullRequest?: ReviewPullRequest;
    readonly tracked?: boolean;
    readonly operation: string;
  }) =>
    githubGraphql<{
      readonly repository?: Record<string, unknown> | null;
    }>({
      token: input.token,
      query: REVIEW_TRACK_PULL_REQUEST_GRAPHQL_QUERY,
      variables: {
        owner: input.ownerLogin,
        name: input.repositoryName,
        number: input.number,
      },
    }).pipe(
      Effect.flatMap((data) => {
        const rawRepository = asRecord(data.repository);
        if (!rawRepository) {
          return Effect.fail(
            toWorkspaceError(
              input.operation,
              `Repository ${input.ownerLogin}/${input.repositoryName} was not found.`,
            ),
          );
        }
        const repository = normalizeGitHubGraphQlRepository({
          raw: rawRepository,
          ...(input.existingRepository ? { existing: input.existingRepository } : {}),
        });
        if (!repository) {
          return Effect.fail(
            toWorkspaceError(
              input.operation,
              `Repository ${input.ownerLogin}/${input.repositoryName} could not be read.`,
            ),
          );
        }
        const rawPullRequest = asRecord(rawRepository.pullRequest);
        if (!rawPullRequest) {
          return Effect.fail(
            toWorkspaceError(
              input.operation,
              `Pull request ${input.ownerLogin}/${input.repositoryName}#${input.number} was not found.`,
            ),
          );
        }
        const pullRequest = normalizeGitHubGraphQlPullRequest({
          raw: rawPullRequest,
          repository,
          ...(input.existingPullRequest ? { existing: input.existingPullRequest } : {}),
          ...(input.tracked === undefined ? {} : { tracked: input.tracked }),
        });
        if (!pullRequest) {
          return Effect.fail(
            toWorkspaceError(
              input.operation,
              `Pull request ${input.ownerLogin}/${input.repositoryName}#${input.number} could not be read.`,
            ),
          );
        }
        return Effect.succeed({ repository, pullRequest } satisfies GitHubPullRequestHealth);
      }),
      Effect.mapError((cause) =>
        isReviewWorkspaceError(cause)
          ? cause
          : toWorkspaceError(input.operation, "Failed to fetch GitHub pull request status.", cause),
      ),
    );

  const readReviewInboxHealth = (input: {
    readonly token: string;
    readonly previous: PersistedReviewWorkspaceState;
  }) =>
    Effect.gen(function* () {
      const data = yield* githubGraphql<{
        readonly viewer?: {
          readonly repositories?: Record<string, unknown> | null;
        } | null;
      }>({
        token: input.token,
        query: REVIEW_INBOX_GRAPHQL_QUERY,
        variables: {
          repositoryFirst: REVIEW_INBOX_REPOSITORY_LIMIT,
          pullRequestFirst: REVIEW_INBOX_PULL_REQUEST_LIMIT,
        },
      });
      const previousRepos = new Map(input.previous.repositories.map((repo) => [repo.id, repo]));
      const previousPrs = new Map(input.previous.pullRequests.map((pr) => [pr.id, pr]));
      const repositoryById = new Map<string, ReviewRepository>();
      const pullRequestById = new Map<string, ReviewPullRequest>();

      for (const rawRepository of graphQlNodes(data.viewer?.repositories)) {
        const repositoryId = gitHubRepositoryId(
          parseTrimmedString(rawRepository.nameWithOwner, ""),
        );
        const existingRepository = previousRepos.get(repositoryId);
        const repository = normalizeGitHubGraphQlRepository({
          raw: rawRepository,
          ...(existingRepository ? { existing: existingRepository } : {}),
        });
        if (!repository) continue;
        repositoryById.set(repository.id, repository);
        for (const rawPullRequest of graphQlNodes(rawRepository.openPullRequests)) {
          const number = parsePositiveInt(rawPullRequest.number);
          const existing = number ? previousPrs.get(`${repository.id}#${number}`) : undefined;
          const pullRequest = normalizeGitHubGraphQlPullRequest({
            raw: rawPullRequest,
            repository,
            ...(existing ? { existing } : {}),
          });
          if (!pullRequest) continue;
          pullRequestById.set(pullRequest.id, pullRequest);
        }
      }

      const retainedCandidates = input.previous.pullRequests.filter(
        (pullRequest) =>
          !pullRequestById.has(pullRequest.id) &&
          shouldRetainPullRequest(input.previous, pullRequest),
      );
      const retained = yield* Effect.all(
        retainedCandidates.map((pullRequest) => {
          const repository = previousRepos.get(pullRequest.repositoryId);
          if (!repository) return Effect.succeed(null);
          return readPullRequestHealthByRoute({
            token: input.token,
            ownerLogin: repository.ownerLogin,
            repositoryName: repository.name,
            number: pullRequest.number,
            existingRepository: repository,
            existingPullRequest: pullRequest,
            operation: "github.refresh.retainedPullRequest",
          }).pipe(
            Effect.catch((cause) =>
              Effect.logWarning("GitHub retained pull request sync failed.", {
                pullRequestId: pullRequest.id,
                cause,
              }).pipe(
                Effect.as({
                  repository,
                  pullRequest,
                } satisfies GitHubPullRequestHealth),
              ),
            ),
          );
        }),
        { concurrency: 4 },
      );

      for (const entry of retained) {
        if (!entry) continue;
        repositoryById.set(entry.repository.id, entry.repository);
        if (shouldRetainPullRequest(input.previous, entry.pullRequest)) {
          pullRequestById.set(entry.pullRequest.id, entry.pullRequest);
        }
      }

      return {
        repositories: [...repositoryById.values()],
        pullRequests: [...pullRequestById.values()],
      };
    });

  const readPullRequestFiles = (input: {
    readonly token: string;
    readonly repository: ReviewRepository;
    readonly pullRequest: ReviewPullRequest;
  }) =>
    githubPaginatedJson<Record<string, unknown>>({
      token: input.token,
      url: `https://api.github.com/repos/${githubRepositoryApiPath(input.repository)}/pulls/${input.pullRequest.number}/files?per_page=100`,
    }).pipe(
      Effect.map((entries) =>
        entries.flatMap((entry) => {
          const normalized = normalizePullRequestFileChange(entry);
          return normalized ? [normalized] : [];
        }),
      ),
      Effect.mapError((cause) =>
        isReviewWorkspaceError(cause)
          ? new ReviewWorkspaceError({
              operation: "review.startRun",
              detail: "Failed to fetch pull request files from GitHub.",
              cause,
            })
          : toWorkspaceError(
              "review.startRun",
              "Failed to fetch pull request files from GitHub.",
              cause,
            ),
      ),
    );

  const readPullRequestReviewDetail = (input: {
    readonly token: string;
    readonly repository: ReviewRepository;
    readonly pullRequest: ReviewPullRequest;
  }) =>
    Effect.gen(function* () {
      const repoPath = githubRepositoryApiPath(input.repository);
      const [pull, files, reviews, comments] = yield* Effect.all(
        [
          githubJson<Record<string, unknown>>({
            token: input.token,
            url: `https://api.github.com/repos/${repoPath}/pulls/${input.pullRequest.number}`,
          }),
          readPullRequestFiles(input),
          githubPaginatedJson<Record<string, unknown>>({
            token: input.token,
            url: `https://api.github.com/repos/${repoPath}/pulls/${input.pullRequest.number}/reviews?per_page=100`,
          }),
          githubPaginatedJson<Record<string, unknown>>({
            token: input.token,
            url: `https://api.github.com/repos/${repoPath}/pulls/${input.pullRequest.number}/comments?per_page=100`,
          }),
        ],
        { concurrency: "unbounded" },
      );
      const current = yield* Ref.get(stateRef);
      const existingDetail = current.pullRequestDetails.find(
        (detail) => detail.pullRequestId === input.pullRequest.id,
      );
      const headSha = extractPullRequestHeadSha(pull.json);
      const syncedAt = yield* nowIso;
      const detail: ReviewPullRequestDetail = {
        pullRequestId: input.pullRequest.id,
        headSha,
        codeBlocks: parseReviewCodeBlocks({
          pullRequestId: input.pullRequest.id,
          files,
        }),
        githubReviews: reviews.flatMap((raw) => {
          const normalized = normalizeGitHubReview({
            pullRequestId: input.pullRequest.id,
            raw,
          });
          return normalized ? [normalized] : [];
        }),
        githubReviewComments: comments.flatMap((raw) => {
          const normalized = normalizeGitHubReviewComment({
            pullRequestId: input.pullRequest.id,
            raw,
          });
          return normalized ? [normalized] : [];
        }),
        summaryDrafts: existingDetail?.summaryDrafts ?? [],
        commentDrafts: existingDetail?.commentDrafts ?? [],
        conversationMessages: existingDetail?.conversationMessages ?? [],
        syncedAt,
      };
      return {
        files,
        detail,
        pullRequest: {
          ...input.pullRequest,
          additions: parseNonNegativeInt(pull.json.additions),
          deletions: parseNonNegativeInt(pull.json.deletions),
          changedFiles: parseNonNegativeInt(pull.json.changed_files),
          commentCount:
            parseNonNegativeInt(pull.json.comments) +
            parseNonNegativeInt(pull.json.review_comments),
          headSha,
          lastProviderUpdatedAt:
            typeof pull.json.updated_at === "string"
              ? pull.json.updated_at
              : input.pullRequest.lastProviderUpdatedAt,
        } satisfies ReviewPullRequest,
      };
    }).pipe(
      Effect.mapError((cause) =>
        isReviewWorkspaceError(cause)
          ? new ReviewWorkspaceError({
              operation: "review.refreshPullRequestDetail",
              detail: "Failed to fetch pull request review detail from GitHub.",
              cause,
            })
          : toWorkspaceError(
              "review.refreshPullRequestDetail",
              "Failed to fetch pull request review detail from GitHub.",
              cause,
            ),
      ),
    );

  const refreshPullRequestDetailWithToken = (input: {
    readonly token: string;
    readonly pullRequestId: string;
    readonly operation: string;
  }) =>
    Effect.gen(function* () {
      const state = yield* Ref.get(stateRef);
      const pullRequest = state.pullRequests.find((entry) => entry.id === input.pullRequestId);
      if (!pullRequest) {
        return yield* toWorkspaceError(
          input.operation,
          `Pull request ${input.pullRequestId} was not found.`,
        );
      }
      const repository = state.repositories.find((entry) => entry.id === pullRequest.repositoryId);
      if (!repository) {
        return yield* toWorkspaceError(
          input.operation,
          `Repository ${pullRequest.repositoryId} was not found.`,
        );
      }
      const result = yield* readPullRequestReviewDetail({
        token: input.token,
        repository,
        pullRequest,
      });
      return yield* updateState(input.operation, (current) => ({
        ...current,
        pullRequests: current.pullRequests.map((entry) =>
          entry.id === result.pullRequest.id ? result.pullRequest : entry,
        ),
        pullRequestDetails: replacePullRequestDetail(current.pullRequestDetails, result.detail),
      }));
    });

  const postGitHubReview = (input: {
    readonly token: string;
    readonly repository: ReviewRepository;
    readonly pullRequest: ReviewPullRequest;
    readonly run: ReviewRun;
    readonly summaryDraft: ReviewSummaryDraft;
    readonly commentDrafts: ReadonlyArray<ReviewCommentDraft>;
    readonly event?: ReviewSubmitEvent;
  }) =>
    githubJson<Record<string, unknown>>({
      token: input.token,
      url: `https://api.github.com/repos/${githubRepositoryApiPath(input.repository)}/pulls/${input.pullRequest.number}/reviews`,
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          buildGitHubInlineReviewPayload({
            run: input.run,
            summaryDraft: input.summaryDraft,
            commentDrafts: input.commentDrafts,
            ...(input.event ? { event: input.event } : {}),
          }),
        ),
      },
    }).pipe(
      Effect.map(({ json }) => json),
      Effect.mapError((cause) =>
        isReviewWorkspaceError(cause)
          ? new ReviewWorkspaceError({
              operation: "review.submitRun",
              detail: "Failed to post GitHub pull request review.",
              cause,
            })
          : toWorkspaceError(
              "review.submitRun",
              "Failed to post GitHub pull request review.",
              cause,
            ),
      ),
    );

  const refreshInboxWithToken = (token: string) =>
    Effect.gen(function* () {
      const viewer = yield* readViewer(token);
      const previous = yield* Ref.get(stateRef);
      const inboxHealth = yield* readReviewInboxHealth({ token, previous });
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
        repositories: inboxHealth.repositories
          .map((repository) => ({
            ...repository,
            hidden:
              state.repositories.find((entry) => entry.id === repository.id)?.hidden ??
              repository.hidden,
          }))
          .filter((repository) => {
            const retainedPullRequests = inboxHealth.pullRequests.some(
              (pullRequest) => pullRequest.repositoryId === repository.id,
            );
            return repository.openPullRequestCount > 0 || retainedPullRequests;
          }),
        pullRequests: inboxHealth.pullRequests
          .map((pullRequest) => {
            const current = state.pullRequests.find((entry) => entry.id === pullRequest.id);
            return {
              ...pullRequest,
              pinned: current?.pinned ?? pullRequest.pinned,
              hidden: current?.hidden ?? pullRequest.hidden,
              tracked: current?.tracked ?? pullRequest.tracked,
            };
          })
          .filter((pullRequest) => shouldRetainPullRequest(state, pullRequest)),
        syncedAt,
      }));
    });

  const trackPullRequestWithToken = (input: ReviewTrackPullRequestInput & { token: string }) =>
    Effect.gen(function* () {
      const previous = yield* Ref.get(stateRef);
      const existingRepository = previous.repositories.find(
        (repository) =>
          repository.provider === input.provider &&
          repository.ownerLogin.toLowerCase() === input.ownerLogin.toLowerCase() &&
          repository.name.toLowerCase() === input.repositoryName.toLowerCase(),
      );
      const existingPullRequest = existingRepository
        ? previous.pullRequests.find(
            (pullRequest) =>
              pullRequest.repositoryId === existingRepository.id &&
              pullRequest.number === input.number,
          )
        : undefined;
      const result = yield* readPullRequestHealthByRoute({
        token: input.token,
        ownerLogin: input.ownerLogin,
        repositoryName: input.repositoryName,
        number: input.number,
        ...(existingRepository ? { existingRepository } : {}),
        ...(existingPullRequest ? { existingPullRequest } : {}),
        tracked: true,
        operation: "review.trackPullRequest",
      });
      const syncedAt = yield* nowIso;
      return yield* updateState("review.trackPullRequest", (state) => {
        const currentRepository = state.repositories.find(
          (repository) => repository.id === result.repository.id,
        );
        const currentPullRequest = state.pullRequests.find(
          (pullRequest) => pullRequest.id === result.pullRequest.id,
        );
        const repository = {
          ...result.repository,
          hidden: currentRepository?.hidden ?? result.repository.hidden,
        };
        const pullRequest = {
          ...result.pullRequest,
          pinned: currentPullRequest?.pinned ?? result.pullRequest.pinned,
          hidden: currentPullRequest?.hidden ?? result.pullRequest.hidden,
          tracked: true,
        };
        return {
          ...state,
          repositories: [
            ...state.repositories.filter((entry) => entry.id !== repository.id),
            repository,
          ],
          pullRequests: [
            ...state.pullRequests.filter((entry) => entry.id !== pullRequest.id),
            pullRequest,
          ],
          syncedAt,
        };
      });
    });

  const refreshInboxFromStoredToken = (operation: string) =>
    getToken.pipe(
      Effect.flatMap((token) =>
        token ? refreshInboxWithToken(token).pipe(Effect.asVoid) : Effect.void,
      ),
      Effect.catch((cause) =>
        Effect.logWarning("GitHub review inbox background sync failed.", {
          operation,
          cause,
        }).pipe(
          Effect.flatMap(() =>
            updateState(operation, (state) =>
              state.github.status === "connected" || state.github.status === "error"
                ? {
                    ...state,
                    github: {
                      ...state.github,
                      status: "error",
                      detail: "GitHub inbox sync failed. Refresh to retry or reconnect GitHub.",
                    },
                  }
                : state,
            ).pipe(Effect.ignore),
          ),
        ),
      ),
    );

  yield* Effect.forever(
    Effect.sleep(REVIEW_INBOX_SYNC_INTERVAL).pipe(
      Effect.flatMap(() => refreshInboxFromStoredToken("github.refresh.background")),
    ),
    { disableYield: true },
  ).pipe(Effect.forkScoped);

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
        return updateState("github.oauth.begin", (state) => ({
          ...state,
          github: {
            ...state.github,
            status: "not_configured",
            detail: "Set T3_GITHUB_OAUTH_CLIENT_ID on the server to enable GitHub OAuth.",
          },
        })).pipe(
          Effect.as({
            status: "not_configured" as const,
            deviceCode: null,
            userCode: null,
            verificationUri: null,
            expiresAt: null,
            intervalSeconds: 5,
            detail: "Set T3_GITHUB_OAUTH_CLIENT_ID on the server to enable GitHub OAuth.",
          }),
        );
      }
      return Effect.gen(function* () {
        const result = yield* Effect.tryPromise({
          try: async () => {
            const body = new URLSearchParams({
              client_id: clientId,
              scope: scopes.join(" "),
            });
            // @effect-diagnostics-next-line globalFetchInEffect:off - Existing GitHub OAuth device flow transport uses fetch.
            const response = await fetch("https://github.com/login/device/code", {
              method: "POST",
              headers: { Accept: "application/json" },
              body,
            });
            if (!response.ok) throw new Error(`GitHub device flow returned ${response.status}`);
            const json = (await response.json()) as Record<string, unknown>;
            const expiresInSeconds = Math.max(1, Number(json.expires_in ?? 900));
            return {
              status: "pending" as const,
              deviceCode: String(json.device_code ?? ""),
              userCode: String(json.user_code ?? ""),
              verificationUri: String(json.verification_uri ?? "https://github.com/login/device"),
              expiresInSeconds,
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
        const currentTimeMillis = yield* Clock.currentTimeMillis;
        yield* updateState("github.oauth.begin", (state) => ({
          ...state,
          github: {
            ...state.github,
            status: "pending",
            scopes,
            detail: result.userCode
              ? `Authorize GitHub device code ${result.userCode}.`
              : "Authorize GitHub device flow in your browser.",
          },
        }));
        const { expiresInSeconds, ...oauthResult } = result;
        return {
          ...oauthResult,
          expiresAt: DateTime.formatIso(
            DateTime.makeUnsafe(currentTimeMillis + expiresInSeconds * 1000),
          ),
        };
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
        const exchange = yield* Effect.tryPromise({
          try: async () => {
            // @effect-diagnostics-next-line globalFetchInEffect:off - Existing GitHub OAuth device flow transport uses fetch.
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
              const error = String(json.error);
              if (error === "authorization_pending" || error === "slow_down") {
                return {
                  status: "pending" as const,
                  detail: String(json.error_description ?? json.error),
                };
              }
              throw new Error(String(json.error_description ?? json.error));
            }
            const accessToken = String(json.access_token ?? "");
            if (!accessToken)
              throw new Error("GitHub token exchange did not return an access token.");
            return { status: "authorized" as const, token: accessToken };
          },
          catch: (cause) =>
            toWorkspaceError(
              "github.oauth.complete",
              "Failed to complete GitHub OAuth device flow.",
              cause,
            ),
        });
        if (exchange.status === "pending") {
          return yield* updateState("github.oauth.complete", (state) => ({
            ...state,
            github: {
              ...state.github,
              status: "pending",
              detail: exchange.detail,
            },
          }));
        }
        yield* setToken(exchange.token);
        return yield* refreshInboxWithToken(exchange.token);
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
    setPullRequestPinned: (input) =>
      updateState("pinPullRequest", (state) => ({
        ...state,
        pullRequests: state.pullRequests.map((pr) =>
          pr.id === input.pullRequestId ? { ...pr, pinned: input.pinned } : pr,
        ),
      })),
    setRepositoryHidden: (input) =>
      updateState("hideRepository", (state) => ({
        ...state,
        repositories: state.repositories.map((repo) =>
          repo.id === input.repositoryId ? { ...repo, hidden: input.hidden } : repo,
        ),
      })),
    setPullRequestHidden: (input) =>
      updateState("hidePullRequest", (state) => ({
        ...state,
        pullRequests: state.pullRequests.map((pr) =>
          pr.id === input.pullRequestId ? { ...pr, hidden: input.hidden } : pr,
        ),
      })),
    trackPullRequest: (input) =>
      getToken.pipe(
        Effect.flatMap((token) =>
          token
            ? trackPullRequestWithToken({ ...input, token })
            : updateState("review.trackPullRequest", (state) => ({
                ...state,
                github: {
                  ...state.github,
                  status: state.github.status === "connected" ? "error" : state.github.status,
                  detail: "Connect GitHub with OAuth before tracking a pull request.",
                },
              })),
        ),
      ),
    upsertMcpConnection: (input) =>
      Effect.gen(function* () {
        const at = yield* nowIso;
        let saved: ReviewMcpConnection | null = null;
        yield* updateState("mcp.upsert", (state) => {
          const id = input.id ?? `mcp-${NodeCrypto.randomUUID()}`;
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
    refreshPullRequestDetail: (input) =>
      getToken.pipe(
        Effect.flatMap((token) =>
          token
            ? refreshPullRequestDetailWithToken({
                token,
                pullRequestId: input.pullRequestId,
                operation: "review.refreshPullRequestDetail",
              })
            : updateState("review.refreshPullRequestDetail", (state) => ({
                ...state,
                github: {
                  ...state.github,
                  status: state.github.status === "connected" ? "error" : state.github.status,
                  detail: "Connect GitHub with OAuth before refreshing pull request detail.",
                },
              })),
        ),
      ),
    updateSummaryDraft: (input) =>
      Effect.gen(function* () {
        const at = yield* nowIso;
        let found = false;
        const snapshot = yield* updateState("review.updateSummaryDraft", (state) => ({
          ...state,
          pullRequestDetails: state.pullRequestDetails.map((detail) => ({
            ...detail,
            summaryDrafts: detail.summaryDrafts.map((draft) => {
              if (draft.id !== input.summaryDraftId) return draft;
              found = true;
              return {
                ...draft,
                ...(input.body !== undefined ? { body: input.body } : {}),
                ...(input.event !== undefined ? { event: input.event } : {}),
                updatedAt: at,
                failureDetail: null,
              };
            }),
          })),
        }));
        if (!found) {
          return yield* toWorkspaceError(
            "review.updateSummaryDraft",
            `Review summary draft ${input.summaryDraftId} was not found.`,
          );
        }
        return snapshot;
      }),
    deleteSummaryDraft: (input) =>
      Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        const found = state.pullRequestDetails.some((detail) =>
          detail.summaryDrafts.some((draft) => draft.id === input.summaryDraftId),
        );
        if (!found) {
          return yield* toWorkspaceError(
            "review.deleteSummaryDraft",
            `Review summary draft ${input.summaryDraftId} was not found.`,
          );
        }

        const at = yield* nowIso;
        return yield* updateState("review.deleteSummaryDraft", (current) => ({
          ...current,
          pullRequestDetails: current.pullRequestDetails.map((detail) => ({
            ...detail,
            summaryDrafts: detail.summaryDrafts.filter(
              (draft) => draft.id !== input.summaryDraftId,
            ),
          })),
          reviewRuns: current.reviewRuns.map((run) =>
            run.summaryDraftId === input.summaryDraftId
              ? {
                  ...run,
                  summaryDraftId: null,
                  updatedAt: at,
                }
              : run,
          ),
        }));
      }),
    updateCommentDraft: (input) =>
      Effect.gen(function* () {
        const at = yield* nowIso;
        let found = false;
        const snapshot = yield* updateState("review.updateCommentDraft", (state) => ({
          ...state,
          pullRequestDetails: state.pullRequestDetails.map((detail) => ({
            ...detail,
            commentDrafts: detail.commentDrafts.map((draft) => {
              if (draft.id !== input.commentDraftId) return draft;
              found = true;
              return {
                ...draft,
                ...(input.body !== undefined ? { body: input.body } : {}),
                ...(input.status !== undefined ? { status: input.status } : {}),
                ...(input.filePath !== undefined ? { filePath: input.filePath } : {}),
                ...(input.line !== undefined ? { line: input.line } : {}),
                ...(input.side !== undefined ? { side: input.side } : {}),
                ...(input.startLine !== undefined ? { startLine: input.startLine } : {}),
                ...(input.startSide !== undefined ? { startSide: input.startSide } : {}),
                updatedAt: at,
                failureDetail: null,
              };
            }),
          })),
        }));
        if (!found) {
          return yield* toWorkspaceError(
            "review.updateCommentDraft",
            `Review comment draft ${input.commentDraftId} was not found.`,
          );
        }
        return snapshot;
      }),
    sendChatMessage: (input) =>
      Effect.gen(function* () {
        const at = yield* nowIso;
        const state = yield* Ref.get(stateRef);
        const pullRequest = state.pullRequests.find((entry) => entry.id === input.pullRequestId);
        if (!pullRequest) {
          return yield* toWorkspaceError(
            "review.sendChatMessage",
            `Pull request ${input.pullRequestId} was not found.`,
          );
        }
        const detail = state.pullRequestDetails.find(
          (entry) => entry.pullRequestId === input.pullRequestId,
        );
        const selectedModel = input.modelSelection;
        const shouldCreateDrafts = isExplicitReviewDraftRequest(input.message);
        if (shouldCreateDrafts && selectedModel && options?.textGeneration && detail) {
          const runId = `run-${NodeCrypto.randomUUID()}`;
          const generatedArtifacts = yield* options.textGeneration
            .generateStructured({
              cwd: serverConfig.cwd,
              operation: "review.chatDraft",
              prompt: formatReviewDraftPrompt({
                pullRequest,
                detail,
                message: input.message,
              }),
              outputSchema: ReviewAgentRunOutput,
              modelSelection: selectedModel,
            })
            .pipe(
              Effect.map((output) =>
                normalizeGeneratedReviewArtifacts({
                  output,
                  runId,
                  pullRequestId: input.pullRequestId,
                  categories: ["risk"],
                  codeBlocks: detail.codeBlocks,
                  now: at,
                }),
              ),
              Effect.catch((cause) =>
                failWithProviderGenerationError({
                  kind: "chat",
                  operation: "review.sendChatMessage",
                  providerOperation: "review.chatDraft",
                  pullRequestId: input.pullRequestId,
                  modelSelection: selectedModel,
                  detail: cause.detail,
                }),
              ),
            );
          const generatedCategories = [
            ...new Set(generatedArtifacts.findings.map((finding) => finding.category)),
          ];
          const categories: ReviewStartRunInput["categories"] =
            generatedCategories.length > 0 ? generatedCategories : ["risk"];
          const run: ReviewRun = {
            id: runId,
            pullRequestId: input.pullRequestId,
            status: "completed",
            categories,
            skillIds: [],
            mcpConnectionIds: [],
            findings: generatedArtifacts.findings,
            summary: generatedArtifacts.summary || "Drafted GitHub review feedback from PR chat.",
            headSha: detail.headSha ?? pullRequest.headSha,
            summaryDraftId: `${runId}:summary`,
            commentDraftIds: [],
            modelSelection: selectedModel,
            createdAt: at,
            updatedAt: at,
            postedByGitHubUserLogin: null,
          };
          const commentDrafts = generatedArtifacts.commentDrafts;
          const baseSummaryDraft = createReviewSummaryDraft({
            run: { ...run, commentDraftIds: commentDrafts.map((draft) => draft.id) },
            pullRequest,
            now: at,
          });
          const summaryDraft = {
            ...baseSummaryDraft,
            body: generatedArtifacts.summary || baseSummaryDraft.body,
          };
          const runWithDrafts: ReviewRun = {
            ...run,
            summaryDraftId: summaryDraft.id,
            commentDraftIds: commentDrafts.map((draft) => draft.id),
          };
          const userMessage: ReviewConversationMessage = {
            id: `${runId}:conversation-user`,
            pullRequestId: input.pullRequestId,
            role: "user",
            body: input.message,
            modelSelection: selectedModel,
            createdAt: at,
          };
          const agentMessage = createReviewRunConversationMessage({
            run: runWithDrafts,
            commentDrafts,
            summaryDraft,
            now: at,
          });

          return yield* updateState("review.sendChatMessage", (current) => {
            const existing = current.pullRequestDetails.find(
              (entry) => entry.pullRequestId === input.pullRequestId,
            ) ?? {
              pullRequestId: input.pullRequestId,
              headSha: pullRequest.headSha,
              codeBlocks: [],
              githubReviews: [],
              githubReviewComments: [],
              summaryDrafts: [],
              commentDrafts: [],
              conversationMessages: [],
              syncedAt: null,
            };
            return {
              ...current,
              pullRequestDetails: replacePullRequestDetail(current.pullRequestDetails, {
                ...existing,
                summaryDrafts: [
                  summaryDraft,
                  ...existing.summaryDrafts.filter((draft) => draft.runId !== runId),
                ],
                commentDrafts: [
                  ...commentDrafts,
                  ...existing.commentDrafts.filter((draft) => draft.runId !== runId),
                ],
                conversationMessages: [...existing.conversationMessages, userMessage, agentMessage],
              }),
              reviewRuns: [runWithDrafts, ...current.reviewRuns],
            };
          });
        }

        const response =
          selectedModel && options?.textGeneration && detail
            ? yield* options.textGeneration
                .generateStructured({
                  cwd: serverConfig.cwd,
                  operation: "review.chat",
                  prompt: formatReviewChatPrompt({
                    pullRequest,
                    detail,
                    message: input.message,
                  }),
                  outputSchema: ReviewAgentChatOutput,
                  modelSelection: selectedModel,
                })
                .pipe(
                  Effect.map((output) =>
                    createGeneratedChatResponse({
                      output,
                      pullRequest,
                      message: input.message,
                      modelSelection: selectedModel,
                      now: at,
                    }),
                  ),
                  Effect.catch((cause) =>
                    failWithProviderGenerationError({
                      kind: "chat",
                      operation: "review.sendChatMessage",
                      providerOperation: "review.chat",
                      pullRequestId: input.pullRequestId,
                      modelSelection: selectedModel,
                      detail: cause.detail,
                    }),
                  ),
                )
            : createReviewChatResponse({
                pullRequest,
                message: input.message,
                modelSelection: input.modelSelection ?? null,
                commentDrafts: detail?.commentDrafts ?? [],
                githubCommentCount: detail?.githubReviewComments.length ?? 0,
                now: at,
              });
        return yield* updateState("review.sendChatMessage", (current) => {
          const existing = current.pullRequestDetails.find(
            (entry) => entry.pullRequestId === input.pullRequestId,
          ) ?? {
            pullRequestId: input.pullRequestId,
            headSha: pullRequest.headSha,
            codeBlocks: [],
            githubReviews: [],
            githubReviewComments: [],
            summaryDrafts: [],
            commentDrafts: [],
            conversationMessages: [],
            syncedAt: null,
          };
          return {
            ...current,
            pullRequestDetails: replacePullRequestDetail(current.pullRequestDetails, {
              ...existing,
              conversationMessages: [
                ...existing.conversationMessages,
                response.userMessage,
                response.agentMessage,
              ],
            }),
          };
        });
      }),
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
        const repository = state.repositories.find((repo) => repo.id === pullRequest.repositoryId);
        if (!repository) {
          return yield* toWorkspaceError(
            "review.startRun",
            `Repository ${pullRequest.repositoryId} was not found.`,
          );
        }
        const token = yield* getToken;
        if (!token) {
          return yield* toWorkspaceError(
            "review.startRun",
            "Connect GitHub with OAuth before running a review.",
          );
        }
        const at = yield* nowIso;
        const runId = `run-${NodeCrypto.randomUUID()}`;
        const detailResult = yield* readPullRequestReviewDetail({
          token,
          repository,
          pullRequest,
        });
        const files = detailResult.files;
        const selectedSkills = [...DEFAULT_REVIEW_SKILLS, ...state.skills].filter(
          (skill) => input.skillIds.includes(skill.id) && skill.enabled,
        );
        const selectedModel = input.modelSelection;
        const generatedArtifacts =
          selectedModel && options?.textGeneration
            ? yield* options.textGeneration
                .generateStructured({
                  cwd: serverConfig.cwd,
                  operation: "review.generateRun",
                  prompt: formatReviewGenerationPrompt({
                    repository,
                    pullRequest: detailResult.pullRequest,
                    categories: input.categories,
                    skills: selectedSkills,
                    files,
                    detail: detailResult.detail,
                  }),
                  outputSchema: ReviewAgentRunOutput,
                  modelSelection: selectedModel,
                })
                .pipe(
                  Effect.map((output) =>
                    normalizeGeneratedReviewArtifacts({
                      output,
                      runId,
                      pullRequestId: input.pullRequestId,
                      categories: input.categories,
                      codeBlocks: detailResult.detail.codeBlocks,
                      now: at,
                    }),
                  ),
                  Effect.catch((cause) =>
                    failWithProviderGenerationError({
                      kind: "review",
                      operation: "review.startRun",
                      providerOperation: "review.generateRun",
                      pullRequestId: input.pullRequestId,
                      modelSelection: selectedModel,
                      detail: cause.detail,
                    }),
                  ),
                )
            : null;
        const findings =
          generatedArtifacts?.findings ??
          createReviewFindings({
            runId,
            pullRequest: detailResult.pullRequest,
            categories: input.categories,
            now: at,
            files,
          });
        const run: ReviewRun = {
          id: runId,
          pullRequestId: input.pullRequestId,
          status: "completed",
          categories: input.categories,
          skillIds: input.skillIds,
          mcpConnectionIds: input.mcpConnectionIds,
          findings,
          summary:
            generatedArtifacts?.summary ||
            summarizeReviewRun({ pullRequest: detailResult.pullRequest, files, findings }),
          headSha: detailResult.detail.headSha,
          summaryDraftId: `${runId}:summary`,
          commentDraftIds: [],
          modelSelection: input.modelSelection ?? null,
          createdAt: at,
          updatedAt: at,
          postedByGitHubUserLogin: null,
        };
        const commentDrafts =
          generatedArtifacts?.commentDrafts ??
          createReviewCommentDrafts({
            runId,
            pullRequestId: input.pullRequestId,
            findings,
            codeBlocks: detailResult.detail.codeBlocks,
            now: at,
          });
        const baseSummaryDraft = createReviewSummaryDraft({
          run: { ...run, commentDraftIds: commentDrafts.map((draft) => draft.id) },
          pullRequest: detailResult.pullRequest,
          now: at,
        });
        const summaryDraft = {
          ...baseSummaryDraft,
          body: generatedArtifacts?.summary || baseSummaryDraft.body,
        };
        const runWithDrafts: ReviewRun = {
          ...run,
          summaryDraftId: summaryDraft.id,
          commentDraftIds: commentDrafts.map((draft) => draft.id),
        };
        const agentMessage = createReviewRunConversationMessage({
          run: runWithDrafts,
          commentDrafts,
          summaryDraft,
          now: at,
        });
        yield* updateState("review.startRun", (current) => ({
          ...current,
          pullRequests: current.pullRequests.map((entry) =>
            entry.id === detailResult.pullRequest.id ? detailResult.pullRequest : entry,
          ),
          pullRequestDetails: replacePullRequestDetail(current.pullRequestDetails, {
            ...detailResult.detail,
            summaryDrafts: [
              summaryDraft,
              ...detailResult.detail.summaryDrafts.filter((draft) => draft.runId !== runId),
            ],
            commentDrafts: [
              ...commentDrafts,
              ...detailResult.detail.commentDrafts.filter((draft) => draft.runId !== runId),
            ],
            conversationMessages: [...detailResult.detail.conversationMessages, agentMessage],
          }),
          reviewRuns: [runWithDrafts, ...current.reviewRuns],
        }));
        return runWithDrafts;
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
        const token = yield* getToken;
        if (!token) {
          return yield* toWorkspaceError(
            "review.submitRun",
            "Connect GitHub with OAuth before submitting a review.",
          );
        }
        const pullRequest = state.pullRequests.find((entry) => entry.id === run.pullRequestId);
        if (!pullRequest) {
          return yield* toWorkspaceError(
            "review.submitRun",
            `Pull request ${run.pullRequestId} was not found.`,
          );
        }
        const repository = state.repositories.find(
          (entry) => entry.id === pullRequest.repositoryId,
        );
        if (!repository) {
          return yield* toWorkspaceError(
            "review.submitRun",
            `Repository ${pullRequest.repositoryId} was not found.`,
          );
        }
        const detailResult = yield* readPullRequestReviewDetail({
          token,
          repository,
          pullRequest,
        });
        if (
          isReviewRunStale({
            run,
            currentHeadSha: detailResult.detail.headSha,
          })
        ) {
          return yield* toWorkspaceError(
            "review.submitRun",
            "The pull request head changed after this review was generated. Refresh and run the review again before submitting.",
          );
        }
        const detail = detailResult.detail;
        if (!run.summaryDraftId) {
          return yield* toWorkspaceError(
            "review.submitRun",
            "Review summary draft was deleted. Run the review again before submitting.",
          );
        }
        const summaryDraft = detail.summaryDrafts.find((draft) => draft.id === run.summaryDraftId);
        if (!summaryDraft) {
          return yield* toWorkspaceError(
            "review.submitRun",
            `Review summary draft ${run.summaryDraftId} was not found.`,
          );
        }
        const commentDrafts = detail.commentDrafts.filter((draft) =>
          run.commentDraftIds.includes(draft.id),
        );
        const posted = yield* postGitHubReview({
          token,
          repository,
          pullRequest: detailResult.pullRequest,
          run,
          summaryDraft,
          commentDrafts,
          ...(input.event ? { event: input.event } : {}),
        });
        const postedRun = markRunPosted(run, userLogin, yield* nowIso);
        yield* updateState("review.submitRun", (current) => ({
          ...current,
          pullRequests: current.pullRequests.map((entry) =>
            entry.id === detailResult.pullRequest.id ? detailResult.pullRequest : entry,
          ),
          pullRequestDetails: replacePullRequestDetail(current.pullRequestDetails, {
            ...detail,
            summaryDrafts: detail.summaryDrafts.map((draft) =>
              draft.id === summaryDraft.id
                ? {
                    ...draft,
                    event: input.event ?? draft.event,
                    status: "posted",
                    postedGitHubReviewId: String(posted.id ?? ""),
                    postedByGitHubUserLogin: userLogin,
                    updatedAt: postedRun.updatedAt,
                    failureDetail: null,
                  }
                : draft,
            ),
            commentDrafts: detail.commentDrafts.map((draft) =>
              run.commentDraftIds.includes(draft.id) && draft.status !== "dismissed"
                ? Object.assign({}, draft, {
                    status: "posted" as const,
                    postedByGitHubUserLogin: userLogin,
                    updatedAt: postedRun.updatedAt,
                    failureDetail: null,
                  })
                : draft,
            ),
          }),
          reviewRuns: current.reviewRuns.map((entry) =>
            entry.id === input.runId ? postedRun : entry,
          ),
        }));
        yield* refreshPullRequestDetailWithToken({
          token,
          pullRequestId: run.pullRequestId,
          operation: "review.submitRun.refresh",
        }).pipe(Effect.ignore);
        return postedRun;
      }),
  });
});

export const layer = Layer.effect(ReviewWorkspace, make());
