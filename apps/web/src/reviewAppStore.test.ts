import { beforeEach, describe, expect, it } from "vitest";
import type { ReviewInboxSnapshot } from "@t3tools/contracts";

import { useReviewAppStore } from "./reviewAppStore";

function snapshot(input: {
  readonly repositoryIds: readonly string[];
  readonly pullRequestIds: readonly string[];
}): ReviewInboxSnapshot {
  return {
    github: {
      provider: "github",
      status: "connected",
      user: {
        id: "1",
        login: "octocat",
        name: null,
        avatarUrl: null,
        profileUrl: "https://github.com/octocat",
      },
      scopes: ["repo"],
      connectedAt: "2026-01-01T00:00:00.000Z",
      detail: null,
    },
    groups: [
      {
        id: "personal:octocat",
        title: "Personal",
        ownerKind: "personal",
        repositories: input.repositoryIds.map((id) => ({
          id,
          provider: "github",
          ownerKind: "personal",
          ownerLogin: "octocat",
          name: id,
          nameWithOwner: `octocat/${id}`,
          url: `https://github.com/octocat/${id}`,
          openPullRequestCount: 1,
          lastProviderUpdatedAt: null,
          hidden: false,
        })),
      },
    ],
    pullRequests: input.pullRequestIds.map((id, index) => ({
      id,
      repositoryId: input.repositoryIds[index] ?? input.repositoryIds[0] ?? "repo",
      provider: "github",
      number: index + 1,
      title: id,
      url: `https://github.com/octocat/repo/pull/${index + 1}`,
      authorLogin: "octocat",
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
    })),
    pullRequestDetails: [],
    skills: [],
    mcpConnections: [],
    reviewRuns: [],
    syncedAt: null,
  };
}

describe("reviewAppStore", () => {
  beforeEach(() => {
    useReviewAppStore.setState({
      snapshot: null,
      selectedRepositoryId: null,
      selectedPullRequestId: null,
    });
  });

  it("selects the first repository and pull request from a fresh snapshot", () => {
    useReviewAppStore.getState().setSnapshot(
      snapshot({
        repositoryIds: ["repo-a", "repo-b"],
        pullRequestIds: ["pr-a", "pr-b"],
      }),
    );

    expect(useReviewAppStore.getState().selectedRepositoryId).toBe("repo-a");
    expect(useReviewAppStore.getState().selectedPullRequestId).toBe("pr-a");
  });

  it("preserves existing selections when they still exist", () => {
    useReviewAppStore.getState().setSnapshot(
      snapshot({
        repositoryIds: ["repo-a", "repo-b"],
        pullRequestIds: ["pr-a", "pr-b"],
      }),
    );
    useReviewAppStore.getState().selectRepository("repo-b");
    useReviewAppStore.getState().selectPullRequest("pr-b");
    useReviewAppStore.getState().setSnapshot(
      snapshot({
        repositoryIds: ["repo-a", "repo-b"],
        pullRequestIds: ["pr-a", "pr-b"],
      }),
    );

    expect(useReviewAppStore.getState().selectedRepositoryId).toBe("repo-b");
    expect(useReviewAppStore.getState().selectedPullRequestId).toBe("pr-b");
  });
});
