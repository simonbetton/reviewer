import { describe, expect, it } from "vitest";
import type { ReviewCommentDraft, ReviewPullRequestDetail, ReviewRun } from "@t3tools/contracts";

import {
  canSubmitReviewRun,
  getActiveReviewCommentDrafts,
  getActiveReviewSummaryDraft,
} from "./reviewDraftPresentation";

const now = "2026-01-01T00:00:00.000Z";

function reviewRun(input: Partial<ReviewRun> = {}): ReviewRun {
  return {
    id: "run-1",
    pullRequestId: "github:owner/repo#1",
    status: "completed",
    categories: ["risk"],
    skillIds: [],
    mcpConnectionIds: [],
    findings: [],
    summary: "summary",
    headSha: "head-1",
    summaryDraftId: "run-1:summary",
    commentDraftIds: ["comment-1"],
    modelSelection: null,
    createdAt: now,
    updatedAt: now,
    postedByGitHubUserLogin: null,
    ...input,
  };
}

function commentDraft(id: string): ReviewCommentDraft {
  return {
    id,
    runId: id.startsWith("comment-1") ? "run-1" : "run-2",
    pullRequestId: "github:owner/repo#1",
    findingId: null,
    body: id,
    filePath: "src/index.ts",
    line: 1,
    side: "RIGHT",
    startLine: null,
    startSide: null,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    postedGitHubCommentId: null,
    postedByGitHubUserLogin: null,
    failureDetail: null,
  };
}

function detail(): ReviewPullRequestDetail {
  return {
    pullRequestId: "github:owner/repo#1",
    headSha: "head-1",
    codeBlocks: [],
    githubReviews: [],
    githubReviewComments: [],
    summaryDrafts: [
      {
        id: "older-run:summary",
        runId: "older-run",
        pullRequestId: "github:owner/repo#1",
        body: "older summary",
        event: "COMMENT",
        status: "draft",
        createdAt: now,
        updatedAt: now,
        postedGitHubReviewId: null,
        postedByGitHubUserLogin: null,
        failureDetail: null,
      },
      {
        id: "run-1:summary",
        runId: "run-1",
        pullRequestId: "github:owner/repo#1",
        body: "active summary",
        event: "COMMENT",
        status: "draft",
        createdAt: now,
        updatedAt: now,
        postedGitHubReviewId: null,
        postedByGitHubUserLogin: null,
        failureDetail: null,
      },
    ],
    commentDrafts: [commentDraft("comment-1"), commentDraft("comment-2")],
    conversationMessages: [],
    postCards: [],
    syncedAt: now,
  };
}

describe("reviewDraftPresentation", () => {
  it("does not fall back to an older summary draft after deletion", () => {
    expect(getActiveReviewSummaryDraft(detail(), reviewRun({ summaryDraftId: null }))).toBe(null);
    expect(
      getActiveReviewSummaryDraft(detail(), reviewRun({ summaryDraftId: "missing-summary" })),
    ).toBe(null);
  });

  it("resolves the active summary and submit state from the latest run", () => {
    const activeSummary = getActiveReviewSummaryDraft(detail(), reviewRun());

    expect(activeSummary?.body).toBe("active summary");
    expect(canSubmitReviewRun(reviewRun(), activeSummary)).toBe(true);
    expect(canSubmitReviewRun(reviewRun({ status: "posted" }), activeSummary)).toBe(false);
    expect(canSubmitReviewRun(reviewRun(), null)).toBe(false);
  });

  it("keeps latest-run comment drafts available when the summary is gone", () => {
    expect(
      getActiveReviewCommentDrafts(detail(), reviewRun({ summaryDraftId: null })).map(
        (draft) => draft.id,
      ),
    ).toEqual(["comment-1"]);
  });
});
