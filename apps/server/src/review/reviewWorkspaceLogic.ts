import * as NodeCrypto from "node:crypto";
import type {
  ReviewCategory,
  ReviewCodeBlock,
  ReviewCodeBlockLine,
  ReviewCommentSide,
  ReviewCommentDraft,
  ReviewConversationMessage,
  ReviewFinding,
  ReviewInboxSnapshot,
  ReviewPullRequest,
  ReviewRepository,
  ReviewRun,
  ReviewSubmitEvent,
  ReviewSummaryDraft,
  ReviewSidebarGroup,
  ReviewSkill,
} from "@t3tools/contracts";

const DEFAULT_INSTALLED_AT = "2026-01-01T00:00:00.000Z";
const LARGE_REVIEW_FILE_COUNT = 12;
const LARGE_REVIEW_CHANGE_COUNT = 800;
const HIGH_CHURN_FILE_CHANGE_COUNT = 300;
const MAX_GITHUB_REVIEW_BODY_LENGTH = 60_000;

export interface ReviewPullRequestFileChange {
  readonly filename: string;
  readonly status: string;
  readonly additions: number;
  readonly deletions: number;
  readonly changes: number;
  readonly patch: string | null;
  readonly previousFilename: string | null;
}

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
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function sortReviewRepositories(
  repositories: ReadonlyArray<ReviewRepository>,
): ReviewRepository[] {
  return repositories.toSorted((left, right) => {
    const byName = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    if (byName !== 0) return byName;
    const byOwner = left.ownerLogin.localeCompare(right.ownerLogin, undefined, {
      sensitivity: "base",
    });
    if (byOwner !== 0) return byOwner;
    return left.id.localeCompare(right.id);
  });
}

export function sortReviewPullRequests(
  pullRequests: ReadonlyArray<ReviewPullRequest>,
): ReviewPullRequest[] {
  return pullRequests.toSorted((left, right) => {
    const leftUpdated = sortTimestamp(left.lastProviderUpdatedAt);
    const rightUpdated = sortTimestamp(right.lastProviderUpdatedAt);
    if (leftUpdated !== rightUpdated) return rightUpdated - leftUpdated;
    return right.number - left.number;
  });
}

export function buildReviewSidebarGroups(
  repositories: ReadonlyArray<ReviewRepository>,
  pullRequests: ReadonlyArray<ReviewPullRequest> = [],
): ReviewSidebarGroup[] {
  const repositoryIdsWithPullRequests = new Set(
    pullRequests.map((pullRequest) => pullRequest.repositoryId),
  );
  const groupsById = new Map<
    string,
    {
      readonly id: string;
      readonly title: string;
      readonly ownerKind: ReviewSidebarGroup["ownerKind"];
      readonly repositories: ReviewRepository[];
    }
  >();
  for (const repository of repositories.filter(
    (repo) => repo.openPullRequestCount > 0 || repositoryIdsWithPullRequests.has(repo.id),
  )) {
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

// TODO(review): Replace these file-signal heuristics with provider-backed semantic analysis.
// This still inspects the real PR file list and patch snippets, but it is not an LLM review yet.
export function createReviewFindings(input: {
  readonly runId: string;
  readonly pullRequest: ReviewPullRequest;
  readonly categories: ReadonlyArray<ReviewCategory>;
  readonly now: string;
  readonly files?: ReadonlyArray<ReviewPullRequestFileChange>;
}): ReviewFinding[] {
  const uniqueCategories = [...new Set(input.categories)];
  const files = input.files ?? [];
  const totalChanges = files.reduce((sum, file) => sum + file.changes, 0);
  const changedSourceFiles = files.filter(
    (file) => isSourceFile(file.filename) && !isTestFile(file.filename),
  );
  const changedTestFiles = files.filter((file) => isTestFile(file.filename));
  const findings: ReviewFinding[] = [];

  const pushFinding = (
    finding: Omit<ReviewFinding, "authoredBy" | "createdAt" | "id" | "status">,
  ) => {
    findings.push({
      id: `${input.runId}:${finding.category}:${findings.length + 1}`,
      ...finding,
      status: "open",
      authoredBy: "agent",
      createdAt: input.now,
    });
  };

  for (const category of uniqueCategories) {
    if (category === "risk") {
      const highChurnFiles = files
        .filter((file) => file.changes >= HIGH_CHURN_FILE_CHANGE_COUNT)
        .toSorted((left, right) => right.changes - left.changes);
      if (
        files.length >= LARGE_REVIEW_FILE_COUNT ||
        totalChanges >= LARGE_REVIEW_CHANGE_COUNT ||
        highChurnFiles.length > 0
      ) {
        const primaryFile = highChurnFiles[0] ?? files.toSorted((a, b) => b.changes - a.changes)[0];
        pushFinding({
          category,
          severity: totalChanges >= LARGE_REVIEW_CHANGE_COUNT ? "major" : "minor",
          confidence: 84,
          title: "High-change PR needs focused review",
          explanation: `This PR changes ${formatCount(files.length, "file")} with ${formatCount(totalChanges, "line")} touched. Start with ${formatFileList(highChurnFiles.length > 0 ? highChurnFiles : files)} before merging.`,
          filePath: primaryFile?.filename ?? null,
          line: firstAddedLine(primaryFile?.patch ?? null),
          suggestedFix:
            "Split unrelated changes where possible, or add a reviewer note that calls out the highest-churn files and expected behavior.",
          postedByGitHubUserLogin: null,
        });
      }
      continue;
    }

    if (category === "security") {
      const securityFiles = files.filter(isSecuritySensitiveFile);
      if (securityFiles.length > 0) {
        const primaryFile = securityFiles[0];
        pushFinding({
          category,
          severity: "major",
          confidence: 82,
          title: "Security-sensitive change needs explicit validation",
          explanation: `Security-adjacent paths or tokens/config patterns changed in ${formatFileList(securityFiles)}. Confirm auth boundaries, secret handling, and failure behavior before this lands.`,
          filePath: primaryFile?.filename ?? null,
          line: firstAddedLine(primaryFile?.patch ?? null),
          suggestedFix:
            "Document the security expectation in the PR and add or update tests around the changed auth/session/config path.",
          postedByGitHubUserLogin: null,
        });
      }
      continue;
    }

    if (category === "tests") {
      if (changedSourceFiles.length > 0 && changedTestFiles.length === 0) {
        pushFinding({
          category,
          severity: changedSourceFiles.length >= 4 ? "major" : "minor",
          confidence: 86,
          title: "Source changes landed without matching tests",
          explanation: `${formatCount(changedSourceFiles.length, "source file")} changed, but no test files changed. Cover the main behavior touched in ${formatFileList(changedSourceFiles)} or call out why existing tests are sufficient.`,
          filePath: changedSourceFiles[0]?.filename ?? null,
          line: firstAddedLine(changedSourceFiles[0]?.patch ?? null),
          suggestedFix:
            "Add focused regression coverage for the changed behavior or note the existing test command that covers it.",
          postedByGitHubUserLogin: null,
        });
      }
      continue;
    }

    if (category === "ux" || category === "accessibility" || category === "seo") {
      const uiFiles = files.filter((file) => isUiFile(file.filename));
      if (uiFiles.length > 0) {
        const primaryFile = uiFiles[0];
        pushFinding({
          category,
          severity: "minor",
          confidence: 72,
          title: "UI-facing changes need browser verification",
          explanation: `UI-facing files changed in ${formatFileList(uiFiles)}. Verify the affected flow in a browser, including loading, empty, error, and narrow-width states where relevant.`,
          filePath: primaryFile?.filename ?? null,
          line: firstAddedLine(primaryFile?.patch ?? null),
          suggestedFix:
            "Attach or describe the browser verification evidence for the changed surface.",
          postedByGitHubUserLogin: null,
        });
      }
    }
  }

  return findings;
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

export function summarizeReviewRun(input: {
  readonly pullRequest: ReviewPullRequest;
  readonly files: ReadonlyArray<ReviewPullRequestFileChange>;
  readonly findings: ReadonlyArray<ReviewFinding>;
}): string {
  const totalAdditions = input.files.reduce((sum, file) => sum + file.additions, 0);
  const totalDeletions = input.files.reduce((sum, file) => sum + file.deletions, 0);
  return `Reviewed ${formatCount(input.files.length, "changed file")} for #${input.pullRequest.number} with +${totalAdditions}/-${totalDeletions}. ${formatCount(input.findings.length, "draft finding")} generated from the PR file list.`;
}

export function parseReviewCodeBlocks(input: {
  readonly pullRequestId: string;
  readonly files: ReadonlyArray<ReviewPullRequestFileChange>;
}): ReviewCodeBlock[] {
  const blocks: ReviewCodeBlock[] = [];
  for (const file of input.files) {
    if (!file.patch) continue;
    let oldLine: number | null = null;
    let newLine: number | null = null;
    let currentLines: ReviewCodeBlockLine[] = [];
    let hunkIndex = 0;

    const flush = () => {
      if (currentLines.length === 0) return;
      const lineNumbers = currentLines.flatMap((line) => [
        ...(line.newLine ? [line.newLine] : []),
        ...(line.oldLine ? [line.oldLine] : []),
      ]);
      blocks.push({
        id: `${input.pullRequestId}:${file.filename}:hunk-${hunkIndex}`,
        pullRequestId: input.pullRequestId,
        filePath: file.filename,
        status: file.status,
        patch: file.patch,
        additions: file.additions,
        deletions: file.deletions,
        startLine: lineNumbers.length > 0 ? Math.min(...lineNumbers) : null,
        endLine: lineNumbers.length > 0 ? Math.max(...lineNumbers) : null,
        lines: currentLines,
      });
      currentLines = [];
    };

    for (const patchLine of file.patch.split("\n")) {
      const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(patchLine);
      if (hunk) {
        flush();
        hunkIndex += 1;
        oldLine = Number(hunk[1]);
        newLine = Number(hunk[2]);
        continue;
      }

      if (oldLine === null || newLine === null || patchLine.startsWith("\\")) continue;
      const rawPrefix = patchLine.slice(0, 1);
      const content = patchLine.slice(1);
      const lineId = `${input.pullRequestId}:${file.filename}:hunk-${hunkIndex}:line-${
        currentLines.length + 1
      }`;

      if (rawPrefix === "+" && !patchLine.startsWith("+++")) {
        currentLines.push({
          id: lineId,
          kind: "addition",
          content,
          oldLine: null,
          newLine: newLine > 0 ? newLine : null,
        });
        newLine += 1;
        continue;
      }

      if (rawPrefix === "-" && !patchLine.startsWith("---")) {
        currentLines.push({
          id: lineId,
          kind: "deletion",
          content,
          oldLine: oldLine > 0 ? oldLine : null,
          newLine: null,
        });
        oldLine += 1;
        continue;
      }

      currentLines.push({
        id: lineId,
        kind: "context",
        content: rawPrefix === " " ? content : patchLine,
        oldLine: oldLine > 0 ? oldLine : null,
        newLine: newLine > 0 ? newLine : null,
      });
      oldLine += 1;
      newLine += 1;
    }

    flush();
  }

  return blocks;
}

function findingDraftBody(finding: ReviewFinding): string {
  const lines = [`**${finding.title}**`, "", finding.explanation];
  if (finding.suggestedFix) {
    lines.push("", `Suggested fix: ${finding.suggestedFix}`);
  }
  return lines.join("\n");
}

function coerceDraftLine(input: {
  readonly finding: ReviewFinding;
  readonly codeBlocks: ReadonlyArray<ReviewCodeBlock>;
}): {
  readonly filePath: string;
  readonly line: number;
  readonly side: ReviewCommentSide;
} | null {
  if (!input.finding.filePath) return null;
  const sameFileBlocks = input.codeBlocks.filter(
    (block) => block.filePath === input.finding.filePath,
  );
  if (input.finding.line) {
    const matchingAddedLine = sameFileBlocks
      .flatMap((block) => block.lines)
      .find((line) => line.kind !== "deletion" && line.newLine === input.finding.line);
    if (matchingAddedLine?.newLine) {
      return { filePath: input.finding.filePath, line: matchingAddedLine.newLine, side: "RIGHT" };
    }
  }
  const firstAddedLine = sameFileBlocks
    .flatMap((block) => block.lines)
    .find((line) => line.kind === "addition" && line.newLine !== null);
  if (firstAddedLine?.newLine) {
    return { filePath: input.finding.filePath, line: firstAddedLine.newLine, side: "RIGHT" };
  }
  const firstDeletedLine = sameFileBlocks
    .flatMap((block) => block.lines)
    .find((line) => line.kind === "deletion" && line.oldLine !== null);
  if (firstDeletedLine?.oldLine) {
    return { filePath: input.finding.filePath, line: firstDeletedLine.oldLine, side: "LEFT" };
  }
  return null;
}

export function createReviewCommentDrafts(input: {
  readonly runId: string;
  readonly pullRequestId: string;
  readonly findings: ReadonlyArray<ReviewFinding>;
  readonly codeBlocks: ReadonlyArray<ReviewCodeBlock>;
  readonly now: string;
}): ReviewCommentDraft[] {
  return input.findings.flatMap((finding, index) => {
    const target = coerceDraftLine({ finding, codeBlocks: input.codeBlocks });
    if (!target) return [];
    return [
      {
        id: `${input.runId}:comment-${index + 1}`,
        runId: input.runId,
        pullRequestId: input.pullRequestId,
        findingId: finding.id,
        body: findingDraftBody(finding),
        filePath: target.filePath,
        line: target.line,
        side: target.side,
        startLine: null,
        startSide: null,
        status: "draft",
        createdAt: input.now,
        updatedAt: input.now,
        postedGitHubCommentId: null,
        postedByGitHubUserLogin: null,
        failureDetail: null,
      },
    ];
  });
}

export function buildReviewSummaryDraftBody(input: {
  readonly run: ReviewRun;
  readonly pullRequest: ReviewPullRequest;
}): string {
  const findings = input.run.findings.filter((finding) => finding.status !== "dismissed");
  const lines = [
    `<!-- t3-review-run:${input.run.id} -->`,
    `Agent review for PR #${input.pullRequest.number}: ${input.pullRequest.title}`,
    "",
    input.run.summary,
  ];
  if (findings.length > 0) {
    lines.push("", "Draft inline comments:");
    findings.forEach((finding, index) => {
      lines.push(`${index + 1}. [${finding.severity}/${finding.category}] ${finding.title}`);
    });
  }
  return truncateGitHubReviewBody(lines.join("\n").trim());
}

export function createReviewSummaryDraft(input: {
  readonly run: ReviewRun;
  readonly pullRequest: ReviewPullRequest;
  readonly now: string;
  readonly event?: ReviewSubmitEvent;
}): ReviewSummaryDraft {
  return {
    id: `${input.run.id}:summary`,
    runId: input.run.id,
    pullRequestId: input.run.pullRequestId,
    body: buildReviewSummaryDraftBody({ run: input.run, pullRequest: input.pullRequest }),
    event: input.event ?? "COMMENT",
    status: "draft",
    createdAt: input.now,
    updatedAt: input.now,
    postedGitHubReviewId: null,
    postedByGitHubUserLogin: null,
    failureDetail: null,
  };
}

export function isReviewRunStale(input: {
  readonly run: ReviewRun;
  readonly currentHeadSha: string | null;
}): boolean {
  return Boolean(
    input.run.headSha && input.currentHeadSha && input.run.headSha !== input.currentHeadSha,
  );
}

export interface GitHubInlineReviewPayload {
  readonly commit_id?: string;
  readonly event: ReviewSubmitEvent;
  readonly body: string;
  readonly comments: ReadonlyArray<{
    readonly path: string;
    readonly body: string;
    readonly line: number;
    readonly side: ReviewCommentSide;
    readonly start_line?: number;
    readonly start_side?: ReviewCommentSide;
  }>;
}

export function buildGitHubInlineReviewPayload(input: {
  readonly run: ReviewRun;
  readonly summaryDraft: ReviewSummaryDraft;
  readonly commentDrafts: ReadonlyArray<ReviewCommentDraft>;
  readonly event?: ReviewSubmitEvent;
}): GitHubInlineReviewPayload {
  const comments = input.commentDrafts
    .filter((draft) => draft.status === "draft")
    .map((draft) => {
      const comment: GitHubInlineReviewPayload["comments"][number] = {
        path: draft.filePath,
        body: draft.body,
        line: draft.line,
        side: draft.side,
      };
      if (draft.startLine) {
        Object.assign(comment, { start_line: draft.startLine });
      }
      if (draft.startSide) {
        Object.assign(comment, { start_side: draft.startSide });
      }
      return comment;
    });
  return {
    ...(input.run.headSha ? { commit_id: input.run.headSha } : {}),
    event: input.event ?? input.summaryDraft.event,
    body: truncateGitHubReviewBody(input.summaryDraft.body),
    comments,
  };
}

export function buildGitHubReviewBody(input: {
  readonly run: ReviewRun;
  readonly pullRequest: ReviewPullRequest;
}): string {
  const findings = input.run.findings.filter((finding) => finding.status !== "dismissed");
  const lines = [
    `<!-- t3-review-run:${input.run.id} -->`,
    `Agent review for PR #${input.pullRequest.number}: ${input.pullRequest.title}`,
    "",
    input.run.summary,
    "",
  ];

  if (findings.length === 0) {
    lines.push("No draft findings were generated for this run.");
  } else {
    lines.push("Findings:");
    findings.forEach((finding, index) => {
      lines.push("");
      lines.push(`${index + 1}. [${finding.severity}/${finding.category}] ${finding.title}`);
      if (finding.filePath) {
        lines.push(`   Location: \`${finding.filePath}${finding.line ? `:${finding.line}` : ""}\``);
      }
      lines.push(`   ${finding.explanation}`);
      if (finding.suggestedFix) {
        lines.push(`   Suggested fix: ${finding.suggestedFix}`);
      }
    });
  }

  const body = lines.join("\n").trim();
  return truncateGitHubReviewBody(body);
}

export function createReviewRunConversationMessage(input: {
  readonly run: ReviewRun;
  readonly commentDrafts: ReadonlyArray<ReviewCommentDraft>;
  readonly summaryDraft: ReviewSummaryDraft;
  readonly now: string;
}): ReviewConversationMessage {
  const inlineCount = input.commentDrafts.filter((draft) => draft.status === "draft").length;
  return {
    id: `${input.run.id}:conversation-agent`,
    pullRequestId: input.run.pullRequestId,
    role: "agent",
    body: `${input.summaryDraft.body}\n\nPrepared ${formatCount(inlineCount, "inline draft comment")}. Edit, dismiss, or retarget the cards before submitting the review.`,
    modelSelection: input.run.modelSelection,
    createdAt: input.now,
  };
}

export function createReviewChatResponse(input: {
  readonly pullRequest: ReviewPullRequest;
  readonly message: string;
  readonly modelSelection: ReviewRun["modelSelection"];
  readonly commentDrafts: ReadonlyArray<ReviewCommentDraft>;
  readonly githubCommentCount: number;
  readonly now: string;
}): {
  readonly userMessage: ReviewConversationMessage;
  readonly agentMessage: ReviewConversationMessage;
} {
  const messageIdBase = `chat-${NodeCrypto.randomUUID()}`;
  const activeDraft = input.commentDrafts.find((draft) => draft.status === "draft") ?? null;
  const responseLines = [
    `I reviewed that against PR #${input.pullRequest.number}.`,
    `Current context includes ${formatCount(input.commentDrafts.length, "T3 draft")} and ${formatCount(input.githubCommentCount, "GitHub review comment")}.`,
  ];
  if (activeDraft) {
    responseLines.push(
      `The strongest inline follow-up is on \`${activeDraft.filePath}:${activeDraft.line}\`.`,
    );
  }
  responseLines.push(`User request: ${input.message}`);

  return {
    userMessage: {
      id: `${messageIdBase}:user`,
      pullRequestId: input.pullRequest.id,
      role: "user",
      body: input.message,
      modelSelection: input.modelSelection,
      createdAt: input.now,
    },
    agentMessage: {
      id: `${messageIdBase}:agent`,
      pullRequestId: input.pullRequest.id,
      role: "agent",
      body: responseLines.join("\n\n"),
      modelSelection: input.modelSelection,
      createdAt: input.now,
    },
  };
}

function truncateGitHubReviewBody(body: string): string {
  return body.length > MAX_GITHUB_REVIEW_BODY_LENGTH
    ? `${body.slice(0, MAX_GITHUB_REVIEW_BODY_LENGTH - 120)}\n\n[Review body truncated by T3 Code.]`
    : body;
}

function isSourceFile(filename: string): boolean {
  return /\.(c|cc|cpp|cs|css|go|h|html|java|js|jsx|kt|mjs|php|py|rb|rs|scss|sql|swift|ts|tsx)$/u.test(
    filename,
  );
}

function isTestFile(filename: string): boolean {
  return /(^|[/_.-])(__tests__|tests?|spec|test)([/_.-]|$)/iu.test(filename);
}

function isUiFile(filename: string): boolean {
  return (
    /\.(css|html|jsx|scss|tsx)$/iu.test(filename) ||
    /(^|\/)(components|pages|routes|app|ui)\//iu.test(filename)
  );
}

function isSecuritySensitiveFile(file: ReviewPullRequestFileChange): boolean {
  return (
    /(auth|credential|crypto|csrf|jwt|oauth|password|permission|policy|secret|security|session|token)/iu.test(
      file.filename,
    ) ||
    /(Authorization|Bearer\s+|child_process|dangerouslySetInnerHTML|eval\(|exec\(|password|process\.env|secret|spawn\(|token)/u.test(
      file.patch ?? "",
    )
  );
}

function firstAddedLine(patch: string | null): number | null {
  if (!patch) return null;
  let nextLine: number | null = null;
  for (const line of patch.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(line);
    if (hunk) {
      nextLine = Number(hunk[1]);
      continue;
    }
    if (nextLine === null) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) return nextLine > 0 ? nextLine : null;
    if (!line.startsWith("-")) nextLine += 1;
  }
  return null;
}

function formatFileList(files: ReadonlyArray<ReviewPullRequestFileChange>): string {
  if (files.length === 0) return "the changed files";
  const visibleFiles = files.slice(0, 4).map((file) => `\`${file.filename}\``);
  const remaining = files.length - visibleFiles.length;
  return remaining > 0
    ? `${visibleFiles.join(", ")} and ${remaining} more`
    : visibleFiles.join(", ");
}

function formatCount(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
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
