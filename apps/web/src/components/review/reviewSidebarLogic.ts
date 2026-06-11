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

  return input.pullRequests.filter((pullRequest) => !pullRequest.hidden);
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
