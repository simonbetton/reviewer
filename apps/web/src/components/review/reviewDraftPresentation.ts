import type {
  ReviewCommentDraft,
  ReviewPullRequestDetail,
  ReviewRun,
  ReviewSummaryDraft,
} from "@t3tools/contracts";

export function getActiveReviewSummaryDraft(
  detail: ReviewPullRequestDetail | null,
  latestRun: ReviewRun | null,
): ReviewSummaryDraft | null {
  if (!detail || !latestRun?.summaryDraftId) return null;
  return detail.summaryDrafts.find((draft) => draft.id === latestRun.summaryDraftId) ?? null;
}

export function getActiveReviewCommentDrafts(
  detail: ReviewPullRequestDetail | null,
  latestRun: ReviewRun | null,
): ReviewCommentDraft[] {
  if (!detail) return [];
  const ids = new Set(latestRun?.commentDraftIds ?? []);
  return detail.commentDrafts.filter((draft) => ids.size === 0 || ids.has(draft.id));
}

export function canSubmitReviewRun(
  latestRun: ReviewRun | null,
  summaryDraft: ReviewSummaryDraft | null,
): boolean {
  return latestRun !== null && latestRun.status !== "posted" && summaryDraft !== null;
}
