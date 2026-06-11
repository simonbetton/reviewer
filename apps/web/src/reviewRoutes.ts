import type { ReviewInboxSnapshot, ReviewPullRequest, ReviewRepository } from "@t3tools/contracts";

export interface ReviewPullRequestRouteTarget {
  readonly provider: "github";
  readonly ownerLogin: string;
  readonly repositoryName: string;
  readonly number: number;
}

export interface ReviewRepositoryRouteTarget {
  readonly provider: "github";
  readonly ownerLogin: string;
  readonly repositoryName: string;
}

export interface ReviewRepositoryRouteParams {
  readonly owner: string;
  readonly repo: string;
}

export interface ReviewPullRequestRouteParams extends ReviewRepositoryRouteParams {
  readonly number: string;
}

export function buildReviewRepositoryRouteParams(input: {
  readonly repository: ReviewRepository;
}): ReviewRepositoryRouteParams {
  return {
    owner: input.repository.ownerLogin,
    repo: input.repository.name,
  };
}

export function buildReviewPullRequestRouteParams(input: {
  readonly repository: ReviewRepository;
  readonly pullRequest: ReviewPullRequest;
}): ReviewPullRequestRouteParams {
  return {
    ...buildReviewRepositoryRouteParams(input),
    number: String(input.pullRequest.number),
  };
}

export function parseReviewRepositoryRouteTarget(
  input: Partial<Record<"owner" | "repo", string | undefined>>,
): ReviewRepositoryRouteTarget | null {
  const ownerLogin = input.owner?.trim();
  const repositoryName = input.repo?.trim();

  if (!ownerLogin || !repositoryName) {
    return null;
  }

  return {
    provider: "github",
    ownerLogin,
    repositoryName,
  };
}

export function parseReviewPullRequestRouteTarget(
  input: Partial<Record<"owner" | "repo" | "number", string | undefined>>,
): ReviewPullRequestRouteTarget | null {
  const repositoryTarget = parseReviewRepositoryRouteTarget(input);
  const number = Number.parseInt(input.number ?? "", 10);

  if (!repositoryTarget || !Number.isInteger(number) || number <= 0) {
    return null;
  }

  return {
    ...repositoryTarget,
    number,
  };
}

function normalizeRouteSegment(value: string): string {
  return value.trim().toLowerCase();
}

export function findReviewPullRequestRouteMatch(
  snapshot: ReviewInboxSnapshot | null | undefined,
  target: ReviewPullRequestRouteTarget | null | undefined,
): { readonly repository: ReviewRepository; readonly pullRequest: ReviewPullRequest } | null {
  if (!target) {
    return null;
  }

  const repository = findReviewRepositoryRouteMatch(snapshot, target);
  if (!repository) {
    return null;
  }

  const pullRequest =
    snapshot?.pullRequests.find(
      (candidate) =>
        candidate.repositoryId === repository.id &&
        candidate.provider === target.provider &&
        candidate.number === target.number,
    ) ?? null;

  return pullRequest ? { repository, pullRequest } : null;
}

export function findReviewRepositoryRouteMatch(
  snapshot: ReviewInboxSnapshot | null | undefined,
  target: ReviewRepositoryRouteTarget | null | undefined,
): ReviewRepository | null {
  if (!snapshot || !target) {
    return null;
  }

  const ownerLogin = normalizeRouteSegment(target.ownerLogin);
  const repositoryName = normalizeRouteSegment(target.repositoryName);
  return (
    snapshot.groups
      .flatMap((group) => group.repositories)
      .find(
        (candidate) =>
          candidate.provider === target.provider &&
          normalizeRouteSegment(candidate.ownerLogin) === ownerLogin &&
          normalizeRouteSegment(candidate.name) === repositoryName,
      ) ?? null
  );
}
