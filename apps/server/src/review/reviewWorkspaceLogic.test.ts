import { describe, expect, it } from "vitest";
import type { ReviewRepository, ReviewPullRequest } from "@t3tools/contracts";

import {
  buildReviewSidebarGroups,
  createReviewFindings,
  markRunPosted,
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
  lastInteractedAt: null,
  pinned: false,
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
  lastProviderUpdatedAt: null,
  lastInteractedAt: null,
  pinned: false,
  ...overrides,
});

describe("review workspace logic", () => {
  it("sorts pinned and recently interacted repositories before provider recency", () => {
    const sorted = sortReviewRepositories([
      repo({
        id: "github:owner/older",
        name: "older",
        nameWithOwner: "owner/older",
        lastProviderUpdatedAt: "2026-01-02T00:00:00.000Z",
      }),
      repo({
        id: "github:owner/recent",
        name: "recent",
        nameWithOwner: "owner/recent",
        lastInteractedAt: "2026-01-01T00:00:00.000Z",
      }),
      repo({
        id: "github:owner/pinned",
        name: "pinned",
        nameWithOwner: "owner/pinned",
        pinned: true,
      }),
    ]);

    expect(sorted.map((entry) => entry.name)).toEqual(["pinned", "recent", "older"]);
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

  it("sorts pull requests using the same pin and app-recency policy", () => {
    const sorted = sortReviewPullRequests([
      pr({ id: "pr-old", number: 1, lastProviderUpdatedAt: "2026-01-02T00:00:00.000Z" }),
      pr({ id: "pr-recent", number: 2, lastInteractedAt: "2026-01-01T00:00:00.000Z" }),
      pr({ id: "pr-pinned", number: 3, pinned: true }),
    ]);

    expect(sorted.map((entry) => entry.id)).toEqual(["pr-pinned", "pr-recent", "pr-old"]);
  });

  it("creates structured findings and marks them posted as the GitHub user", () => {
    const findings = createReviewFindings({
      runId: "run-1",
      pullRequest: pr({ title: "Improve auth flow" }),
      categories: ["risk", "security"],
      now: "2026-01-01T00:00:00.000Z",
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
});
