import type { ReviewPullRequest, ReviewRepository } from "@t3tools/contracts";

export interface VisiblePinnedReviewPullRequestItem {
  readonly repository: ReviewRepository;
  readonly pullRequest: ReviewPullRequest;
}

function sortTimestamp(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function getVisibleReviewPullRequests(input: {
  readonly pullRequests: ReadonlyArray<ReviewPullRequest>;
  readonly repositoryExpanded: boolean;
  readonly repositoryHidden?: boolean;
}): ReviewPullRequest[] {
  if (!input.repositoryExpanded || input.repositoryHidden === true) {
    return [];
  }

  return input.pullRequests.filter(
    (pullRequest) => !pullRequest.hidden && pullRequest.state === "open",
  );
}

export function getVisibleInactiveReviewPullRequests(input: {
  readonly pullRequests: ReadonlyArray<ReviewPullRequest>;
  readonly repositoryExpanded: boolean;
  readonly repositoryHidden?: boolean;
}): ReviewPullRequest[] {
  if (!input.repositoryExpanded || input.repositoryHidden === true) {
    return [];
  }

  return input.pullRequests.filter(
    (pullRequest) => !pullRequest.hidden && pullRequest.state !== "open",
  );
}

export function getHiddenReviewPullRequests(
  pullRequests: ReadonlyArray<ReviewPullRequest>,
): ReviewPullRequest[] {
  return pullRequests.filter((pullRequest) => pullRequest.hidden);
}

export function getVisibleReviewRepositories(
  repositories: ReadonlyArray<ReviewRepository>,
): ReviewRepository[] {
  return repositories.filter((repository) => !repository.hidden);
}

export function getHiddenReviewRepositories(
  repositories: ReadonlyArray<ReviewRepository>,
): ReviewRepository[] {
  return repositories.filter((repository) => repository.hidden);
}

export function getVisiblePinnedReviewPullRequestItems(input: {
  readonly pullRequests: ReadonlyArray<ReviewPullRequest>;
  readonly repositoryById: ReadonlyMap<ReviewRepository["id"], ReviewRepository>;
}): VisiblePinnedReviewPullRequestItem[] {
  return input.pullRequests
    .filter((pullRequest) => pullRequest.pinned && !pullRequest.hidden)
    .flatMap((pullRequest) => {
      const repository = input.repositoryById.get(pullRequest.repositoryId);
      return repository && !repository.hidden ? [{ repository, pullRequest }] : [];
    })
    .toSorted((left, right) => {
      const leftUpdated = sortTimestamp(left.pullRequest.lastProviderUpdatedAt);
      const rightUpdated = sortTimestamp(right.pullRequest.lastProviderUpdatedAt);
      if (leftUpdated !== rightUpdated) return rightUpdated - leftUpdated;
      return right.pullRequest.number - left.pullRequest.number;
    });
}

export function reviewPullRequestStateLabel(pullRequest: ReviewPullRequest): string {
  if (pullRequest.state === "merged") return "Merged";
  if (pullRequest.state === "closed") return "Closed";
  return pullRequest.draft ? "Draft" : "Open";
}

export function reviewPullRequestReviewDecisionLabel(
  pullRequest: ReviewPullRequest,
): string | null {
  switch (pullRequest.reviewDecision) {
    case "APPROVED":
      return "Approved";
    case "CHANGES_REQUESTED":
      return "Changes requested";
    case "REVIEW_REQUIRED":
      return "Review required";
    default:
      return null;
  }
}

export function reviewPullRequestChecksStateLabel(pullRequest: ReviewPullRequest): string | null {
  switch (pullRequest.checksState) {
    case "SUCCESS":
      return "Checks passed";
    case "FAILURE":
    case "ERROR":
      return "Checks failed";
    case "PENDING":
    case "EXPECTED":
      return "Checks pending";
    default:
      return null;
  }
}
