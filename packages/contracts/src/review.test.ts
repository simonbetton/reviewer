import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";

import {
  REVIEW_WS_METHODS,
  ReviewDeleteSummaryDraftInput,
  ReviewInboxSnapshot,
  ReviewPullRequest,
  ReviewPullRequestDetail,
  ReviewRepository,
  ReviewRun,
} from "./review.ts";

const decodeReviewDeleteSummaryDraftInput = Schema.decodeUnknownSync(ReviewDeleteSummaryDraftInput);
const decodeReviewRepository = Schema.decodeUnknownSync(ReviewRepository);
const decodeReviewPullRequest = Schema.decodeUnknownSync(ReviewPullRequest);
const decodeReviewPullRequestDetail = Schema.decodeUnknownSync(ReviewPullRequestDetail);
const decodeReviewRun = Schema.decodeUnknownSync(ReviewRun);
const decodeReviewInboxSnapshot = Schema.decodeUnknownSync(ReviewInboxSnapshot);

describe("review contracts", () => {
  it("exposes review summary draft deletion as a review RPC method", () => {
    expect(
      decodeReviewDeleteSummaryDraftInput({
        summaryDraftId: "run-1:summary",
      }),
    ).toEqual({
      summaryDraftId: "run-1:summary",
    });
    expect(REVIEW_WS_METHODS.deleteSummaryDraft).toBe("review.deleteSummaryDraft");
    expect(REVIEW_WS_METHODS.trackPullRequest).toBe("review.trackPullRequest");
  });

  it("defaults hidden review item state for persisted repositories and pull requests", () => {
    const repository = decodeReviewRepository({
      id: "github:owner/repo",
      provider: "github",
      ownerKind: "personal",
      ownerLogin: "owner",
      name: "repo",
      nameWithOwner: "owner/repo",
      url: "https://github.com/owner/repo",
      openPullRequestCount: 1,
      lastProviderUpdatedAt: null,
      // Legacy persisted fields should be ignored after removing review recency and repo pins.
      lastInteractedAt: null,
      pinned: false,
    });
    const pullRequest = decodeReviewPullRequest({
      id: "github:owner/repo#1",
      repositoryId: repository.id,
      provider: "github",
      number: 1,
      title: "Test PR",
      url: "https://github.com/owner/repo/pull/1",
      authorLogin: "author",
      baseRefName: "main",
      headRefName: "feature",
      state: "open",
      draft: false,
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      commentCount: 0,
      reviewDecision: null,
      checksState: null,
      lastProviderUpdatedAt: null,
      // Legacy persisted review-recency field should be ignored.
      lastInteractedAt: null,
      pinned: false,
    });

    expect(repository.hidden).toBe(false);
    expect(pullRequest.hidden).toBe(false);
    expect(pullRequest.tracked).toBe(false);
    expect(pullRequest.headSha).toBe(null);
    expect("lastInteractedAt" in repository).toBe(false);
    expect("pinned" in repository).toBe(false);
    expect("lastInteractedAt" in pullRequest).toBe(false);
  });

  it("defaults new persisted review artifact fields for old runs and snapshots", () => {
    const run = decodeReviewRun({
      id: "run-1",
      pullRequestId: "github:owner/repo#1",
      status: "completed",
      categories: ["risk"],
      skillIds: [],
      mcpConnectionIds: [],
      findings: [],
      summary: "summary",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      postedByGitHubUserLogin: null,
    });
    const snapshot = decodeReviewInboxSnapshot({
      github: {
        provider: "github",
        status: "disconnected",
        user: null,
        scopes: [],
        connectedAt: null,
        detail: null,
      },
      groups: [],
      pullRequests: [],
      skills: [],
      mcpConnections: [],
      reviewRuns: [],
      syncedAt: null,
    });

    expect(run.headSha).toBe(null);
    expect(run.summaryDraftId).toBe(null);
    expect(run.commentDraftIds).toEqual([]);
    expect(run.modelSelection).toBe(null);
    expect(snapshot.pullRequestDetails).toEqual([]);
  });

  it("ignores legacy review post cards in pull request details", () => {
    const detail = decodeReviewPullRequestDetail({
      pullRequestId: "github:owner/repo#1",
      headSha: "head-1",
      codeBlocks: [],
      githubReviews: [],
      githubReviewComments: [],
      summaryDrafts: [],
      commentDrafts: [],
      conversationMessages: [],
      postCards: [
        {
          id: "legacy-card",
          pullRequestId: "github:owner/repo#1",
          messageId: "message-1",
          kind: "summary",
          body: "legacy post card",
          status: "draft",
          filePath: null,
          line: null,
          side: null,
          startLine: null,
          startSide: null,
          inReplyToGitHubCommentId: null,
          postedGitHubReviewId: null,
          postedGitHubCommentId: null,
          failureDetail: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      syncedAt: null,
    });

    expect("postCards" in detail).toBe(false);
  });
});
