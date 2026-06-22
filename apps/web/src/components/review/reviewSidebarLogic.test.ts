import { describe, expect, it } from "vitest";
import type { ReviewPullRequest, ReviewRepository } from "@t3tools/contracts";

import {
  getHiddenReviewPullRequests,
  getHiddenReviewRepositories,
  getVisibleInactiveReviewPullRequests,
  getVisiblePinnedReviewPullRequestItems,
  getVisibleReviewPullRequests,
  getVisibleReviewRepositories,
  reviewPullRequestChecksStateLabel,
  reviewPullRequestReviewDecisionLabel,
  reviewPullRequestStateLabel,
} from "./reviewSidebarLogic";

function pullRequest(id: string): ReviewPullRequest {
  return {
    id,
    repositoryId: "github:owner/repo",
    provider: "github",
    number: 1,
    title: id,
    url: `https://github.com/owner/repo/pull/${id}`,
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
    tracked: false,
  };
}

function repository(id: string, hidden = false): ReviewRepository {
  const name = id.split("/").at(-1) ?? id;
  return {
    id,
    provider: "github",
    ownerKind: "personal",
    ownerLogin: "owner",
    name,
    nameWithOwner: `owner/${name}`,
    url: `https://github.com/owner/${name}`,
    openPullRequestCount: 1,
    lastProviderUpdatedAt: null,
    hidden,
  };
}

describe("getVisibleReviewPullRequests", () => {
  it("shows all pull requests when the repository is expanded", () => {
    const pullRequests = [pullRequest("pr-1"), pullRequest("pr-2")];

    expect(
      getVisibleReviewPullRequests({
        pullRequests,
        repositoryExpanded: true,
      }),
    ).toEqual(pullRequests);
  });

  it("hides all pull requests while the repository is collapsed, including the active one", () => {
    const pullRequests = [pullRequest("pr-1"), pullRequest("pr-2")];

    expect(
      getVisibleReviewPullRequests({
        pullRequests,
        repositoryExpanded: false,
      }),
    ).toEqual([]);
  });

  it("filters hidden pull requests out of visible children", () => {
    const visible = pullRequest("pr-1");
    const hidden = { ...pullRequest("pr-2"), hidden: true };

    expect(
      getVisibleReviewPullRequests({
        pullRequests: [visible, hidden],
        repositoryExpanded: true,
      }),
    ).toEqual([visible]);
    expect(getHiddenReviewPullRequests([visible, hidden])).toEqual([hidden]);
  });

  it("keeps inactive tracked pull requests out of the normal visible list", () => {
    const open = pullRequest("pr-open");
    const merged = { ...pullRequest("pr-merged"), state: "merged" as const, tracked: true };

    expect(
      getVisibleReviewPullRequests({
        pullRequests: [open, merged],
        repositoryExpanded: true,
      }),
    ).toEqual([open]);
    expect(
      getVisibleInactiveReviewPullRequests({
        pullRequests: [open, merged],
        repositoryExpanded: true,
      }),
    ).toEqual([merged]);
  });

  it("hides children for hidden repositories even when expanded", () => {
    expect(
      getVisibleReviewPullRequests({
        pullRequests: [pullRequest("pr-1")],
        repositoryExpanded: true,
        repositoryHidden: true,
      }),
    ).toEqual([]);
  });
});

describe("review repository visibility", () => {
  it("partitions visible and hidden repositories", () => {
    const visible = repository("github:owner/visible");
    const hidden = repository("github:owner/hidden", true);

    expect(getVisibleReviewRepositories([visible, hidden])).toEqual([visible]);
    expect(getHiddenReviewRepositories([visible, hidden])).toEqual([hidden]);
  });
});

describe("getVisiblePinnedReviewPullRequestItems", () => {
  it("returns visible pinned pull requests as latest-first shortcuts", () => {
    const visibleRepo = repository("github:owner/visible");
    const hiddenRepo = repository("github:owner/hidden", true);
    const olderPinned = {
      ...pullRequest("pr-older"),
      id: "pr-older",
      repositoryId: visibleRepo.id,
      number: 1,
      pinned: true,
      lastProviderUpdatedAt: "2026-01-01T00:00:00.000Z",
    };
    const newerPinned = {
      ...pullRequest("pr-newer"),
      id: "pr-newer",
      repositoryId: visibleRepo.id,
      number: 2,
      pinned: true,
      lastProviderUpdatedAt: "2026-01-02T00:00:00.000Z",
    };
    const hiddenPinned = {
      ...pullRequest("pr-hidden"),
      id: "pr-hidden",
      repositoryId: visibleRepo.id,
      pinned: true,
      hidden: true,
    };
    const repoHiddenPinned = {
      ...pullRequest("pr-repo-hidden"),
      id: "pr-repo-hidden",
      repositoryId: hiddenRepo.id,
      pinned: true,
    };

    expect(
      getVisiblePinnedReviewPullRequestItems({
        pullRequests: [olderPinned, hiddenPinned, repoHiddenPinned, newerPinned],
        repositoryById: new Map([
          [visibleRepo.id, visibleRepo],
          [hiddenRepo.id, hiddenRepo],
        ]),
      }).map((item) => item.pullRequest.id),
    ).toEqual(["pr-newer", "pr-older"]);
  });
});

describe("review pull request status labels", () => {
  it("formats lifecycle, review decision, and check labels", () => {
    expect(reviewPullRequestStateLabel({ ...pullRequest("pr-draft"), draft: true })).toBe("Draft");
    expect(reviewPullRequestStateLabel({ ...pullRequest("pr-merged"), state: "merged" })).toBe(
      "Merged",
    );
    expect(
      reviewPullRequestReviewDecisionLabel({
        ...pullRequest("pr-review"),
        reviewDecision: "CHANGES_REQUESTED",
      }),
    ).toBe("Changes requested");
    expect(
      reviewPullRequestChecksStateLabel({
        ...pullRequest("pr-checks"),
        checksState: "SUCCESS",
      }),
    ).toBe("Checks passed");
  });
});
