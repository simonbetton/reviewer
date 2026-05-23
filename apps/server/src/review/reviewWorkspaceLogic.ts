import type {
  ReviewCategory,
  ReviewFinding,
  ReviewInboxSnapshot,
  ReviewPullRequest,
  ReviewRepository,
  ReviewRun,
  ReviewSidebarGroup,
  ReviewSkill,
} from "@t3tools/contracts";

const DEFAULT_INSTALLED_AT = "2026-01-01T00:00:00.000Z";

export const DEFAULT_REVIEW_SKILLS: ReadonlyArray<ReviewSkill> = [
  {
    id: "default-risk-review",
    name: "Risk Review",
    description: "Ranks the PR by blast radius, risky files, and merge readiness.",
    source: "default",
    packageSpec: null,
    categories: ["risk", "correctness", "maintainability"],
    requiredMcpConnectionIds: [],
    enabled: true,
    installedAt: DEFAULT_INSTALLED_AT,
    updatedAt: DEFAULT_INSTALLED_AT,
  },
  {
    id: "default-security-review",
    name: "Security Review",
    description:
      "Looks for auth, injection, secret handling, dependency, and data exposure issues.",
    source: "default",
    packageSpec: null,
    categories: ["security", "data"],
    requiredMcpConnectionIds: [],
    enabled: true,
    installedAt: DEFAULT_INSTALLED_AT,
    updatedAt: DEFAULT_INSTALLED_AT,
  },
  {
    id: "default-ux-seo-accessibility",
    name: "UX, SEO, and Accessibility",
    description: "Reviews visible behavior, accessibility semantics, metadata, and page quality.",
    source: "default",
    packageSpec: null,
    categories: ["ux", "accessibility", "seo", "performance"],
    requiredMcpConnectionIds: [],
    enabled: true,
    installedAt: DEFAULT_INSTALLED_AT,
    updatedAt: DEFAULT_INSTALLED_AT,
  },
  {
    id: "default-tests-observability",
    name: "Tests and Observability",
    description: "Checks test coverage, logging, error handling, and operational signals.",
    source: "default",
    packageSpec: null,
    categories: ["tests", "observability", "docs"],
    requiredMcpConnectionIds: [],
    enabled: true,
    installedAt: DEFAULT_INSTALLED_AT,
    updatedAt: DEFAULT_INSTALLED_AT,
  },
];

function sortTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortReviewRepositories(
  repositories: ReadonlyArray<ReviewRepository>,
): ReviewRepository[] {
  return repositories.toSorted((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    const leftRecent = sortTimestamp(left.lastInteractedAt);
    const rightRecent = sortTimestamp(right.lastInteractedAt);
    if (leftRecent !== rightRecent) return rightRecent - leftRecent;
    const leftUpdated = sortTimestamp(left.lastProviderUpdatedAt);
    const rightUpdated = sortTimestamp(right.lastProviderUpdatedAt);
    if (leftUpdated !== rightUpdated) return rightUpdated - leftUpdated;
    return left.nameWithOwner.localeCompare(right.nameWithOwner);
  });
}

export function sortReviewPullRequests(
  pullRequests: ReadonlyArray<ReviewPullRequest>,
): ReviewPullRequest[] {
  return pullRequests.toSorted((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    const leftRecent = sortTimestamp(left.lastInteractedAt);
    const rightRecent = sortTimestamp(right.lastInteractedAt);
    if (leftRecent !== rightRecent) return rightRecent - leftRecent;
    const leftUpdated = sortTimestamp(left.lastProviderUpdatedAt);
    const rightUpdated = sortTimestamp(right.lastProviderUpdatedAt);
    if (leftUpdated !== rightUpdated) return rightUpdated - leftUpdated;
    return right.number - left.number;
  });
}

export function buildReviewSidebarGroups(
  repositories: ReadonlyArray<ReviewRepository>,
): ReviewSidebarGroup[] {
  const groupsById = new Map<
    string,
    {
      readonly id: string;
      readonly title: string;
      readonly ownerKind: ReviewSidebarGroup["ownerKind"];
      readonly repositories: ReviewRepository[];
    }
  >();
  for (const repository of repositories.filter((repo) => repo.openPullRequestCount > 0)) {
    const id =
      repository.ownerKind === "personal"
        ? `personal:${repository.ownerLogin}`
        : `organization:${repository.ownerLogin}`;
    const existing = groupsById.get(id);
    if (existing) {
      existing.repositories.push(repository);
      continue;
    }
    groupsById.set(id, {
      id,
      title: repository.ownerKind === "personal" ? "Personal" : repository.ownerLogin,
      ownerKind: repository.ownerKind,
      repositories: [repository],
    });
  }

  return [...groupsById.values()]
    .map((group) =>
      Object.assign({}, group, {
        repositories: sortReviewRepositories(group.repositories),
      }),
    )
    .toSorted((left, right) => {
      if (left.ownerKind !== right.ownerKind) return left.ownerKind === "personal" ? -1 : 1;
      return left.title.localeCompare(right.title);
    });
}

// TODO(review): Replace placeholder findings with provider-backed analysis of PR diffs/files.
// Wire to Codex/provider runtime and selected skills/MCP connections.
// See .plans/21-github-peer-review-handoff.md — P1 agent review intelligence.
export function createReviewFindings(input: {
  readonly runId: string;
  readonly pullRequest: ReviewPullRequest;
  readonly categories: ReadonlyArray<ReviewCategory>;
  readonly now: string;
}): ReviewFinding[] {
  const uniqueCategories = [...new Set(input.categories)];
  return uniqueCategories.map((category, index) => ({
    id: `${input.runId}:${category}`,
    category,
    severity: category === "security" || category === "risk" ? "major" : "minor",
    confidence: category === "security" ? 82 : 76,
    title: `${categoryLabel(category)} review pass`,
    explanation: `Review ${input.pullRequest.title} for ${categoryLabel(category).toLowerCase()} concerns before submitting feedback.`,
    filePath: null,
    line: null,
    suggestedFix:
      index === 0
        ? "Inspect the highest-churn files first, then decide which findings should be posted."
        : null,
    status: "open",
    authoredBy: "agent",
    postedByGitHubUserLogin: null,
    createdAt: input.now,
  }));
}

export function markRunPosted(run: ReviewRun, userLogin: string, now: string): ReviewRun {
  return {
    ...run,
    status: "posted",
    postedByGitHubUserLogin: userLogin,
    updatedAt: now,
    findings: run.findings.map((finding) =>
      finding.status === "dismissed"
        ? finding
        : {
            ...finding,
            status: "posted",
            postedByGitHubUserLogin: userLogin,
          },
    ),
  };
}

export function categoryLabel(category: ReviewCategory): string {
  return category
    .split("-")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

export function buildReviewSnapshot(
  input: Omit<ReviewInboxSnapshot, "groups" | "skills"> & {
    readonly repositories: ReadonlyArray<ReviewRepository>;
    readonly userSkills: ReadonlyArray<ReviewSkill>;
  },
): ReviewInboxSnapshot {
  const { repositories: _repositories, userSkills: _userSkills, ...snapshotRest } = input;
  return {
    ...snapshotRest,
    groups: buildReviewSidebarGroups(input.repositories),
    pullRequests: sortReviewPullRequests(input.pullRequests),
    skills: [...DEFAULT_REVIEW_SKILLS, ...input.userSkills],
  };
}
