import { describe, expect, it } from "vitest";
import type { ReviewRepository, ReviewPullRequest, ReviewRun } from "@t3tools/contracts";

import {
  buildGitHubInlineReviewPayload,
  buildGitHubReviewBody,
  buildReviewSidebarGroups,
  createReviewCommentDrafts,
  createReviewFindings,
  createReviewSummaryDraft,
  isReviewRunStale,
  markRunPosted,
  parseReviewCodeBlocks,
  summarizeReviewRun,
  sortReviewPullRequests,
  sortReviewRepositories,
} from "./reviewWorkspaceLogic.ts";

const repo = (overrides: Partial<ReviewRepository>): ReviewRepository => ({
  id: "github:owner/repo",
  provider: "github",
  ownerKind: "personal",
  ownerLogin: "owner",
  name: "repo",
  nameWithOwner: "owner/repo",
  url: "https://github.com/owner/repo",
  openPullRequestCount: 1,
  lastProviderUpdatedAt: null,
  hidden: false,
  ...overrides,
});

const pr = (overrides: Partial<ReviewPullRequest>): ReviewPullRequest => ({
  id: "github:owner/repo#1",
  repositoryId: "github:owner/repo",
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
  headSha: null,
  lastProviderUpdatedAt: null,
  pinned: false,
  hidden: false,
  ...overrides,
});

describe("review workspace logic", () => {
  it("sorts repositories alphabetically by name with stable tie-breakers", () => {
    const sorted = sortReviewRepositories([
      repo({
        id: "github:owner/zeta",
        name: "zeta",
        nameWithOwner: "owner/zeta",
      }),
      repo({
        id: "github:acme/api",
        ownerLogin: "acme",
        name: "api",
        nameWithOwner: "acme/api",
      }),
      repo({
        id: "github:owner/API",
        name: "API",
        nameWithOwner: "owner/API",
      }),
    ]);

    expect(sorted.map((entry) => entry.nameWithOwner)).toEqual([
      "acme/api",
      "owner/API",
      "owner/zeta",
    ]);
  });

  it("groups only repositories with open pull requests by personal and organization owners", () => {
    const groups = buildReviewSidebarGroups([
      repo({ id: "github:me/app", ownerLogin: "me", nameWithOwner: "me/app" }),
      repo({
        id: "github:acme/api",
        ownerKind: "organization",
        ownerLogin: "acme",
        nameWithOwner: "acme/api",
      }),
      repo({
        id: "github:acme/empty",
        ownerKind: "organization",
        ownerLogin: "acme",
        nameWithOwner: "acme/empty",
        openPullRequestCount: 0,
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.title).toBe("Personal");
    expect(groups[1]?.title).toBe("acme");
    expect(groups[1]?.repositories).toHaveLength(1);
  });

  it("sorts pull requests by provider update time with number as a tie-breaker", () => {
    const sorted = sortReviewPullRequests([
      pr({ id: "pr-old", number: 1, lastProviderUpdatedAt: "2026-01-02T00:00:00.000Z" }),
      pr({ id: "pr-new", number: 2, lastProviderUpdatedAt: "2026-01-03T00:00:00.000Z" }),
      pr({ id: "pr-same", number: 3, lastProviderUpdatedAt: "2026-01-03T00:00:00.000Z" }),
      pr({ id: "pr-null", number: 4, lastProviderUpdatedAt: null, pinned: true }),
    ]);

    expect(sorted.map((entry) => entry.id)).toEqual(["pr-same", "pr-new", "pr-old", "pr-null"]);
  });

  it("creates structured findings and marks them posted as the GitHub user", () => {
    const findings = createReviewFindings({
      runId: "run-1",
      pullRequest: pr({ title: "Improve auth flow" }),
      categories: ["risk", "security"],
      now: "2026-01-01T00:00:00.000Z",
      files: [
        {
          filename: "apps/server/src/auth/session.ts",
          status: "modified",
          additions: 220,
          deletions: 130,
          changes: 350,
          patch: "@@ -10,1 +10,2 @@\n+const token = process.env.AUTH_TOKEN;",
          previousFilename: null,
        },
      ],
    });

    const posted = markRunPosted(
      {
        id: "run-1",
        pullRequestId: "github:owner/repo#1",
        status: "completed",
        categories: ["risk", "security"],
        skillIds: [],
        mcpConnectionIds: [],
        findings,
        summary: "summary",
        headSha: "abc123",
        summaryDraftId: null,
        commentDraftIds: [],
        modelSelection: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        postedByGitHubUserLogin: null,
      },
      "octocat",
      "2026-01-01T00:01:00.000Z",
    );

    expect(posted.status).toBe("posted");
    expect(posted.postedByGitHubUserLogin).toBe("octocat");
    expect(posted.findings.every((finding) => finding.postedByGitHubUserLogin === "octocat")).toBe(
      true,
    );
  });

  it("summarizes file-backed runs and formats a GitHub review body", () => {
    const pullRequest = pr({ title: "Improve review flow" });
    const files = [
      {
        filename: "apps/web/src/components/review/ReviewWorkspace.tsx",
        status: "modified",
        additions: 80,
        deletions: 12,
        changes: 92,
        patch: "@@ -3,1 +3,2 @@\n+export function ReviewWorkspace() {}",
        previousFilename: null,
      },
    ];
    const findings = createReviewFindings({
      runId: "run-2",
      pullRequest,
      categories: ["ux", "tests"],
      now: "2026-01-01T00:00:00.000Z",
      files,
    });
    const run: ReviewRun = {
      id: "run-2",
      pullRequestId: pullRequest.id,
      status: "completed",
      categories: ["ux", "tests"],
      skillIds: [],
      mcpConnectionIds: [],
      findings,
      summary: summarizeReviewRun({ pullRequest, files, findings }),
      headSha: "abc123",
      summaryDraftId: null,
      commentDraftIds: [],
      modelSelection: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      postedByGitHubUserLogin: null,
    };

    expect(run.summary).toContain("Reviewed 1 changed file");
    expect(buildGitHubReviewBody({ run, pullRequest })).toContain(
      "apps/web/src/components/review/ReviewWorkspace.tsx",
    );
  });

  it("parses diff hunks into stable review code blocks", () => {
    const blocks = parseReviewCodeBlocks({
      pullRequestId: "github:owner/repo#1",
      files: [
        {
          filename: "src/example.ts",
          status: "modified",
          additions: 2,
          deletions: 1,
          changes: 3,
          patch: [
            "@@ -10,2 +10,3 @@",
            " const keep = true;",
            "-const oldValue = 1;",
            "+const newValue = 2;",
            "+export const added = newValue;",
          ].join("\n"),
          previousFilename: null,
        },
      ],
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.lines.map((line) => [line.kind, line.oldLine, line.newLine])).toEqual([
      ["context", 10, 10],
      ["deletion", 11, null],
      ["addition", null, 11],
      ["addition", null, 12],
    ]);
  });

  it("builds GitHub review payloads with current inline line anchors", () => {
    const pullRequest = pr({
      title: "Secure auth flow",
      additions: 2,
      deletions: 0,
      changedFiles: 1,
      headSha: "head-1",
    });
    const files = [
      {
        filename: "src/auth.ts",
        status: "modified",
        additions: 2,
        deletions: 0,
        changes: 2,
        patch: "@@ -1,1 +1,2 @@\n const user = getUser();\n+const token = process.env.AUTH_TOKEN;",
        previousFilename: null,
      },
    ];
    const findings = createReviewFindings({
      runId: "run-3",
      pullRequest,
      categories: ["security"],
      now: "2026-01-01T00:00:00.000Z",
      files,
    });
    const run: ReviewRun = {
      id: "run-3",
      pullRequestId: pullRequest.id,
      status: "completed",
      categories: ["security"],
      skillIds: [],
      mcpConnectionIds: [],
      findings,
      summary: summarizeReviewRun({ pullRequest, files, findings }),
      headSha: "head-1",
      summaryDraftId: "run-3:summary",
      commentDraftIds: ["run-3:comment-1"],
      modelSelection: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      postedByGitHubUserLogin: null,
    };
    const codeBlocks = parseReviewCodeBlocks({ pullRequestId: pullRequest.id, files });
    const commentDrafts = createReviewCommentDrafts({
      runId: run.id,
      pullRequestId: pullRequest.id,
      findings,
      codeBlocks,
      now: "2026-01-01T00:00:00.000Z",
    });
    const summaryDraft = createReviewSummaryDraft({
      run,
      pullRequest,
      now: "2026-01-01T00:00:00.000Z",
      event: "REQUEST_CHANGES",
    });

    const payload = buildGitHubInlineReviewPayload({
      run,
      summaryDraft,
      commentDrafts,
    });

    expect(payload).toMatchObject({
      commit_id: "head-1",
      event: "REQUEST_CHANGES",
      comments: [
        {
          path: "src/auth.ts",
          line: 2,
          side: "RIGHT",
        },
      ],
    });
    expect(isReviewRunStale({ run, currentHeadSha: "head-2" })).toBe(true);
    expect(isReviewRunStale({ run, currentHeadSha: "head-1" })).toBe(false);
  });
});
