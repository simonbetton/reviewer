import { describe, expect, it } from "vitest";
import type { ReviewInboxSnapshot, ReviewPullRequest, ReviewRepository } from "@t3tools/contracts";

import {
  buildReviewPullRequestRouteParams,
  buildReviewRepositoryRouteParams,
  findReviewPullRequestRouteMatch,
  findReviewRepositoryRouteMatch,
  parseReviewPullRequestRouteTarget,
  parseReviewRepositoryRouteTarget,
} from "./reviewRoutes";

const repository: ReviewRepository = {
  id: "github:octocat/reviewer",
  provider: "github",
  ownerKind: "personal",
  ownerLogin: "Octocat",
  name: "Reviewer",
  nameWithOwner: "Octocat/Reviewer",
  url: "https://github.com/Octocat/Reviewer",
  openPullRequestCount: 1,
  lastProviderUpdatedAt: null,
  hidden: false,
};

const pullRequest: ReviewPullRequest = {
  id: "github:octocat/reviewer#42",
  repositoryId: repository.id,
  provider: "github",
  number: 42,
  title: "Add nested review route",
  url: "https://github.com/Octocat/Reviewer/pull/42",
  authorLogin: "mona",
  baseRefName: "main",
  headRefName: "feature/review-route",
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
  tracked: false,
};

const snapshot: ReviewInboxSnapshot = {
  github: {
    provider: "github",
    status: "connected",
    user: null,
    scopes: ["repo"],
    connectedAt: "2026-01-01T00:00:00.000Z",
    detail: null,
  },
  groups: [
    {
      id: "personal:octocat",
      title: "Personal",
      ownerKind: "personal",
      repositories: [repository],
    },
  ],
  pullRequests: [pullRequest],
  pullRequestDetails: [],
  skills: [],
  mcpConnections: [],
  reviewRuns: [],
  syncedAt: null,
};

describe("reviewRoutes", () => {
  it("builds readable GitHub repository route params", () => {
    expect(buildReviewRepositoryRouteParams({ repository })).toEqual({
      owner: "Octocat",
      repo: "Reviewer",
    });
  });

  it("builds readable GitHub pull request route params", () => {
    expect(buildReviewPullRequestRouteParams({ repository, pullRequest })).toEqual({
      owner: "Octocat",
      repo: "Reviewer",
      number: "42",
    });
  });

  it("resolves a nested route target case-insensitively", () => {
    const repositoryTarget = parseReviewRepositoryRouteTarget({
      owner: "octocat",
      repo: "reviewer",
    });
    const target = parseReviewPullRequestRouteTarget({
      owner: "octocat",
      repo: "reviewer",
      number: "42",
    });

    expect(findReviewRepositoryRouteMatch(snapshot, repositoryTarget)).toBe(repository);
    expect(findReviewPullRequestRouteMatch(snapshot, target)).toEqual({
      repository,
      pullRequest,
    });
  });

  it("rejects invalid route params", () => {
    expect(
      parseReviewPullRequestRouteTarget({
        owner: "octocat",
        repo: "reviewer",
        number: "not-a-number",
      }),
    ).toBeNull();
  });
});
