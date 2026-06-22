import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  Code2Icon,
  CopyIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  FileCodeIcon,
  GitPullRequestIcon,
  ListChecksIcon,
  MessageSquareIcon,
  RefreshCwIcon,
  SendIcon,
  Settings2Icon,
  ShieldCheckIcon,
  StarIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useMemo,
  useRef,
  useState,
} from "react";
import { type LegendListRef } from "@legendapp/list/react";
import type {
  ModelSelection,
  ResolvedKeybindingsConfig,
  ReviewCategory,
  ReviewCommentDraft,
  ReviewMcpConnection,
  ReviewPullRequest,
  ReviewPullRequestDetail,
  ReviewRepository,
  ReviewRun,
  ReviewSkill,
  ReviewSubmitEvent,
  ServerProvider,
} from "@t3tools/contracts";
import { EnvironmentId, MessageId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import {
  type AtomCommandResult,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { createModelSelection } from "@t3tools/shared/model";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime";
import { useNavigate } from "@tanstack/react-router";
import type { TimestampFormat, UnifiedSettings } from "@t3tools/contracts/settings";

import { deriveTimelineEntries } from "../../session-logic";
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type ChatMessage,
  type TurnDiffSummary,
} from "../../types";
import { type ComposerImageAttachment, useComposerDraftStore } from "../../composerDraftStore";
import type { TerminalContextDraft } from "../../lib/terminalContext";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useIsMobile } from "../../hooks/useMediaQuery";
import { useMountEffect } from "../../hooks/useMountEffect";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useSettings } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import {
  buildReviewPullRequestRouteParams,
  buildReviewRepositoryRouteParams,
  findReviewPullRequestRouteMatch,
  findReviewRepositoryRouteMatch,
  type ReviewPullRequestRouteTarget,
  type ReviewRepositoryRouteTarget,
} from "../../reviewRoutes";
import { useReviewAppStore } from "../../reviewAppStore";
import { reviewEnvironment } from "../../state/review";
import { useAtomCommand } from "../../state/use-atom-command";
import { getAppModelOptionsForInstance, resolveAppModelSelectionState } from "../../modelSelection";
import {
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { useServerKeybindings, useServerProviders } from "../../rpc/serverState";
import { useUiStateStore } from "../../uiStateStore";
import { isElectron } from "../../env";
import { cn, randomUUID } from "../../lib/utils";
import { ChatComposer, type ChatComposerHandle } from "../chat/ChatComposer";
import { MessagesTimeline } from "../chat/MessagesTimeline";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "../ui/sheet";
import { SidebarInset, SidebarTrigger } from "../ui/sidebar";
import {
  canSubmitReviewRun,
  getActiveReviewCommentDrafts,
  getActiveReviewSummaryDraft,
} from "./reviewDraftPresentation";
import {
  getVisibleInactiveReviewPullRequests,
  getVisibleReviewPullRequests,
  reviewPullRequestChecksStateLabel,
  reviewPullRequestReviewDecisionLabel,
  reviewPullRequestStateLabel,
} from "./reviewSidebarLogic";

const DEFAULT_RUN_CATEGORIES: ReviewCategory[] = ["risk", "security", "ux", "tests"];
const REVIEW_PR_LIST_WIDTH_STORAGE_KEY = "t3code:review-pr-list-width:v1";
const DEFAULT_REVIEW_PR_LIST_WIDTH = 420;
const MIN_REVIEW_PR_LIST_WIDTH = 320;
const MAX_REVIEW_PR_LIST_WIDTH = 640;
const REVIEW_HEADER_ACTION_CLASS =
  "flex shrink-0 items-center justify-end gap-2 @3xl/header-actions:gap-3";
const REVIEW_FALLBACK_ENVIRONMENT_ID = EnvironmentId.make("review");

function unwrapCommandResult<A, E>(result: AtomCommandResult<A, E>): A {
  if (result._tag === "Success") {
    return result.value;
  }
  throw squashAtomCommandFailure(result);
}

function reviewTarget<TInput>(environmentId: EnvironmentId, input: TInput) {
  return { environmentId, input };
}

const REVIEW_EVENT_OPTIONS: ReadonlyArray<{
  readonly event: ReviewSubmitEvent;
  readonly label: string;
  readonly detail: string;
  readonly ariaLabel: string;
}> = [
  {
    event: "COMMENT",
    label: "Comment",
    detail: "Neutral",
    ariaLabel: "Submit a comment review",
  },
  {
    event: "REQUEST_CHANGES",
    label: "Request",
    detail: "Blocking",
    ariaLabel: "Submit a request changes review",
  },
  {
    event: "APPROVE",
    label: "Approve",
    detail: "Passing",
    ariaLabel: "Submit an approve review",
  },
];

type ReviewRouteTarget = ReviewRepositoryRouteTarget | ReviewPullRequestRouteTarget | null;

interface ReviewActionNotice {
  readonly pullRequestId: string;
  readonly variant: "error" | "success";
  readonly title: string;
  readonly detail: string;
}

interface ReviewPendingChatMessage {
  readonly id: string;
  readonly pullRequestId: string;
  readonly body: string;
  readonly createdAt: string;
}

interface ResizeState {
  readonly pointerId: number;
  readonly startX: number;
  readonly startWidth: number;
}

function repositoryHiddenSectionId(repositoryId: string): string {
  return `repo:${repositoryId}`;
}

function repositoryInactiveSectionId(repositoryId: string): string {
  return `inactive:${repositoryId}`;
}

function clampReviewPrListWidth(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_REVIEW_PR_LIST_WIDTH;
  }
  return Math.min(MAX_REVIEW_PR_LIST_WIDTH, Math.max(MIN_REVIEW_PR_LIST_WIDTH, Math.round(value)));
}

function readStoredReviewPrListWidth(): number {
  if (typeof window === "undefined") {
    return DEFAULT_REVIEW_PR_LIST_WIDTH;
  }

  const stored = Number(window.localStorage.getItem(REVIEW_PR_LIST_WIDTH_STORAGE_KEY));
  return clampReviewPrListWidth(stored);
}

function persistReviewPrListWidth(width: number): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(
    REVIEW_PR_LIST_WIDTH_STORAGE_KEY,
    String(clampReviewPrListWidth(width)),
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  if (typeof error === "string" && error.trim().length > 0) return error;
  return fallback;
}

function formatReviewDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function reviewConversationThreadId(pullRequestId: string): ThreadId {
  const slug = pullRequestId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return ThreadId.make(`review-${slug || "pull-request"}`);
}

function fileNameFromPath(filePath: string): string {
  return filePath.split("/").at(-1) ?? filePath;
}

function formatCodeAnchor(
  filePath: string,
  line: number | null,
  side: ReviewCommentDraft["side"] | null,
): string {
  const label = `${fileNameFromPath(filePath)}:${line ?? "-"}`;
  return side === "LEFT" ? `${label} removed line` : label;
}

function draftLocationLabel(draft: ReviewCommentDraft): string {
  return formatCodeAnchor(draft.filePath, draft.line, draft.side);
}

function draftLocationDetail(draft: ReviewCommentDraft): string {
  const lineLabel = draft.side === "LEFT" ? "removed line" : "line";
  return `${draft.filePath} - ${lineLabel} ${draft.line}`;
}

interface GitHubReviewActivityItem {
  readonly id: string;
  readonly kind: "summary" | "inline";
  readonly authorLogin: string;
  readonly state: string;
  readonly body: string;
  readonly location: string | null;
  readonly occurredAt: string | null;
  readonly url: string | null;
}

function githubReviewActivityItems(
  detail: ReviewPullRequestDetail,
): ReadonlyArray<GitHubReviewActivityItem> {
  const reviews = detail.githubReviews.map(
    (review): GitHubReviewActivityItem => ({
      id: `review:${review.id}`,
      kind: "summary",
      authorLogin: review.authorLogin,
      state: review.state,
      body: review.body,
      location: null,
      occurredAt: review.submittedAt,
      url: review.url,
    }),
  );
  const comments = detail.githubReviewComments.map(
    (comment): GitHubReviewActivityItem => ({
      id: `comment:${comment.id}`,
      kind: "inline",
      authorLogin: comment.authorLogin,
      state: comment.inReplyToId ? "Reply" : "Comment",
      body: comment.body,
      location: formatCodeAnchor(comment.path, comment.line, comment.side),
      occurredAt: comment.updatedAt ?? comment.createdAt,
      url: comment.url,
    }),
  );

  return [...reviews, ...comments].toSorted((a, b) => {
    const aTime = a.occurredAt ? Date.parse(a.occurredAt) : 0;
    const bTime = b.occurredAt ? Date.parse(b.occurredAt) : 0;
    return bTime - aTime;
  });
}

function githubReviewParticipantCount(detail: ReviewPullRequestDetail): number {
  return new Set([
    ...detail.githubReviews.map((review) => review.authorLogin),
    ...detail.githubReviewComments.map((comment) => comment.authorLogin),
  ]).size;
}

function isPullRequestRouteTarget(
  target: ReviewRouteTarget,
): target is ReviewPullRequestRouteTarget {
  return target !== null && "number" in target;
}

function HiddenMarker() {
  return (
    <Badge size="sm" variant="secondary">
      Hidden
    </Badge>
  );
}

type ReviewBadgeVariant = "secondary" | "warning" | "success" | "error";

function reviewPullRequestLifecycleBadgeVariant(
  pullRequest: ReviewPullRequest,
): ReviewBadgeVariant {
  if (pullRequest.state === "merged") return "success";
  if (pullRequest.draft) return "warning";
  return "secondary";
}

function reviewPullRequestDecisionBadgeVariant(pullRequest: ReviewPullRequest): ReviewBadgeVariant {
  if (pullRequest.reviewDecision === "APPROVED") return "success";
  if (pullRequest.reviewDecision === "CHANGES_REQUESTED") return "warning";
  return "secondary";
}

function reviewPullRequestChecksBadgeVariant(pullRequest: ReviewPullRequest): ReviewBadgeVariant {
  if (pullRequest.checksState === "SUCCESS") return "success";
  if (pullRequest.checksState === "FAILURE" || pullRequest.checksState === "ERROR") return "error";
  if (pullRequest.checksState === "PENDING" || pullRequest.checksState === "EXPECTED") {
    return "warning";
  }
  return "secondary";
}

function ReviewPullRequestStatusBadges({
  pullRequest,
  reviewed = false,
  hidden = false,
  showComments = false,
  className,
}: {
  readonly pullRequest: ReviewPullRequest;
  readonly reviewed?: boolean;
  readonly hidden?: boolean;
  readonly showComments?: boolean;
  readonly className?: string;
}) {
  const reviewDecisionLabel = reviewPullRequestReviewDecisionLabel(pullRequest);
  const checksStateLabel = reviewPullRequestChecksStateLabel(pullRequest);

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {hidden ? <HiddenMarker /> : null}
      <Badge size="sm" variant={reviewPullRequestLifecycleBadgeVariant(pullRequest)}>
        {reviewPullRequestStateLabel(pullRequest)}
      </Badge>
      {reviewDecisionLabel ? (
        <Badge size="sm" variant={reviewPullRequestDecisionBadgeVariant(pullRequest)}>
          {reviewDecisionLabel}
        </Badge>
      ) : null}
      {checksStateLabel ? (
        <Badge size="sm" variant={reviewPullRequestChecksBadgeVariant(pullRequest)}>
          {checksStateLabel}
        </Badge>
      ) : null}
      {showComments ? (
        <Badge size="sm" variant="secondary">
          {pullRequest.commentCount} comments
        </Badge>
      ) : null}
      {reviewed ? (
        <Badge size="sm" variant="success">
          Agent reviewed
        </Badge>
      ) : null}
    </div>
  );
}

function ReviewRouteTracker({
  environmentId,
  target,
}: {
  readonly environmentId: EnvironmentId;
  readonly target: ReviewPullRequestRouteTarget;
}) {
  const trackPullRequest = useAtomCommand(reviewEnvironment.trackPullRequest, {
    reportFailure: false,
  });

  useMountEffect(() => {
    let disposed = false;
    void trackPullRequest(reviewTarget(environmentId, target))
      .then((result) => unwrapCommandResult(result))
      .then((next) => {
        if (!disposed) {
          useReviewAppStore.getState().setSnapshot(next);
        }
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
    };
  });

  return null;
}

function ReviewCodeMenu({
  repository,
  selectedPullRequest,
}: {
  readonly repository: ReviewRepository;
  readonly selectedPullRequest: ReviewPullRequest | null;
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const openUrl = selectedPullRequest?.url ?? repository.url;
  const checkoutCommand = selectedPullRequest
    ? `gh pr checkout ${selectedPullRequest.number}`
    : `git clone ${repository.url}`;
  const branchLabel = selectedPullRequest?.headRefName ?? null;

  const openOnGitHub = () => {
    window.open(openUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <Menu>
      <MenuTrigger render={<Button size="xs" variant="outline" className="gap-1.5" />}>
        <Code2Icon className="size-3.5" />
        <span className="hidden sm:inline">Code</span>
        {branchLabel ? (
          <span className="hidden max-w-28 truncate text-muted-foreground lg:inline">
            {branchLabel}
          </span>
        ) : null}
        <ChevronDownIcon aria-hidden="true" className="size-3.5 opacity-60" />
      </MenuTrigger>
      <MenuPopup align="end" className="w-80">
        <MenuItem className="min-h-7 !text-xs" onClick={openOnGitHub}>
          <ExternalLinkIcon className="size-3.5" />
          {selectedPullRequest ? "Open pull request on GitHub" : "Open repository on GitHub"}
        </MenuItem>
        <MenuSeparator />
        <div className="space-y-2 px-2 py-1.5">
          {selectedPullRequest ? (
            <div className="space-y-1">
              <div className="text-muted-foreground text-xs font-medium">PR branch</div>
              <div className="truncate text-sm">{selectedPullRequest.headRefName}</div>
            </div>
          ) : null}
          <div className="text-muted-foreground text-xs font-medium">
            {selectedPullRequest ? "Checkout command" : "Clone command"}
          </div>
          <div className="flex min-w-0 items-center gap-1.5">
            <input
              readOnly
              aria-label={selectedPullRequest ? "Pull request checkout command" : "Clone command"}
              value={checkoutCommand}
              className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-mono text-xs outline-none"
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button
              size="icon-xs"
              variant="outline"
              aria-label={selectedPullRequest ? "Copy checkout command" : "Copy clone command"}
              onClick={() => copyToClipboard(checkoutCommand)}
            >
              {isCopied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
            </Button>
          </div>
        </div>
      </MenuPopup>
    </Menu>
  );
}

function ReviewToolsMenu({
  enabledSkills,
  installSpec,
  mcpName,
  mcpCommand,
  mcpConnectionBadges,
  onInstallSpecChange,
  onInstallSkill,
  onMcpNameChange,
  onMcpCommandChange,
  onAddMcpConnection,
}: {
  readonly enabledSkills: ReadonlyArray<ReviewSkill>;
  readonly installSpec: string;
  readonly mcpName: string;
  readonly mcpCommand: string;
  readonly mcpConnectionBadges: ReadonlyArray<ReviewMcpConnection>;
  readonly onInstallSpecChange: (value: string) => void;
  readonly onInstallSkill: () => void;
  readonly onMcpNameChange: (value: string) => void;
  readonly onMcpCommandChange: (value: string) => void;
  readonly onAddMcpConnection: () => void;
}) {
  const trustedConnectionCount = mcpConnectionBadges.filter(
    (connection) => connection.enabled && connection.trusted,
  ).length;

  return (
    <Menu>
      <MenuTrigger render={<Button size="xs" variant="outline" className="gap-1.5" />}>
        <Settings2Icon className="size-3.5" />
        <span className="hidden lg:inline">Review tools</span>
        <ChevronDownIcon aria-hidden="true" className="size-3.5 opacity-60" />
      </MenuTrigger>
      <MenuPopup align="end" className="w-96 max-w-[calc(100vw-2rem)] p-2">
        <div className="space-y-4">
          <div className="space-y-2 rounded-md border border-border/70 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Skills</div>
                <div className="text-muted-foreground text-xs">
                  Included in review and chat prompts.
                </div>
              </div>
              <Badge size="sm" variant="secondary">
                {enabledSkills.length} enabled
              </Badge>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {enabledSkills.slice(0, 6).map((skill) => (
                <Badge
                  key={skill.id}
                  size="sm"
                  variant={skill.source === "default" ? "secondary" : "success"}
                >
                  {skill.name}
                </Badge>
              ))}
              {enabledSkills.length > 6 ? (
                <Badge size="sm" variant="secondary">
                  +{enabledSkills.length - 6}
                </Badge>
              ) : null}
            </div>
            <div className="flex gap-2">
              <input
                aria-label="Skill package"
                value={installSpec}
                onChange={(event) => onInstallSpecChange(event.target.value)}
                onKeyDown={(event) => event.stopPropagation()}
                placeholder="@company/review-skills"
                className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
              />
              <Button size="sm" disabled={installSpec.trim().length === 0} onClick={onInstallSkill}>
                Install
              </Button>
            </div>
          </div>

          <div className="space-y-2 rounded-md border border-border/70 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">MCP connections</div>
                <div className="text-muted-foreground text-xs">
                  Trusted tools available to review runs.
                </div>
              </div>
              <Badge size="sm" variant={trustedConnectionCount > 0 ? "success" : "secondary"}>
                {trustedConnectionCount} trusted
              </Badge>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {mcpConnectionBadges.length === 0 ? (
                <span className="text-muted-foreground text-xs">
                  No MCP connections configured.
                </span>
              ) : (
                mcpConnectionBadges.slice(0, 6).map((connection) => (
                  <Badge
                    key={connection.id}
                    size="sm"
                    variant={connection.trusted ? "success" : "warning"}
                  >
                    {connection.name}
                  </Badge>
                ))
              )}
              {mcpConnectionBadges.length > 6 ? (
                <Badge size="sm" variant="secondary">
                  +{mcpConnectionBadges.length - 6}
                </Badge>
              ) : null}
            </div>
            <div className="grid gap-2">
              <input
                aria-label="MCP connection name"
                value={mcpName}
                onChange={(event) => onMcpNameChange(event.target.value)}
                onKeyDown={(event) => event.stopPropagation()}
                placeholder="GitHub MCP"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
              <div className="flex gap-2">
                <input
                  aria-label="MCP command"
                  value={mcpCommand}
                  onChange={(event) => onMcpCommandChange(event.target.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                  placeholder="npx @modelcontextprotocol/server-github"
                  className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                />
                <Button
                  size="sm"
                  disabled={mcpName.trim().length === 0 || mcpCommand.trim().length === 0}
                  onClick={onAddMcpConnection}
                >
                  Add
                </Button>
              </div>
            </div>
          </div>
        </div>
      </MenuPopup>
    </Menu>
  );
}

function ExistingGitHubFeedbackDialog({
  detail,
  refreshing,
  onRefresh,
}: {
  readonly detail: ReviewPullRequestDetail | null;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
}) {
  const activities = detail ? githubReviewActivityItems(detail) : [];
  const participantCount = detail ? githubReviewParticipantCount(detail) : 0;
  const reviewCount = detail?.githubReviews.length ?? 0;
  const commentCount = detail?.githubReviewComments.length ?? 0;

  return (
    <Dialog>
      <DialogTrigger
        render={<Button size="xs" variant="outline" className="gap-1.5" disabled={!detail} />}
      >
        <ListChecksIcon className="size-3.5" />
        <span className="hidden lg:inline">Feedback</span>
        {detail ? (
          <span className="rounded-full bg-muted px-1.5 text-muted-foreground text-[10px]">
            {reviewCount + commentCount}
          </span>
        ) : null}
      </DialogTrigger>
      <DialogPopup className="max-h-[84dvh] max-w-4xl overflow-hidden">
        <DialogHeader className="border-b border-border/70 bg-background pr-14">
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle>Existing GitHub feedback</DialogTitle>
              <DialogDescription>
                Synced review summaries and inline threads included in agent context.
              </DialogDescription>
            </div>
            <Button
              size="xs"
              variant="outline"
              className="mt-0.5 shrink-0 gap-1.5"
              disabled={refreshing}
              onClick={onRefresh}
            >
              <RefreshCwIcon className="size-3.5" />
              <span>{refreshing ? "Refreshing" : "Refresh"}</span>
            </Button>
          </div>
        </DialogHeader>
        {detail ? (
          <DialogPanel className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge size="sm" variant="secondary">
                {reviewCount} summaries
              </Badge>
              <Badge size="sm" variant="secondary">
                {commentCount} inline comments
              </Badge>
              <Badge size="sm" variant="secondary">
                {participantCount} participants
              </Badge>
              {detail.syncedAt ? (
                <Badge size="sm" variant="secondary">
                  Synced {formatReviewDateTime(detail.syncedAt)}
                </Badge>
              ) : null}
            </div>
            {activities.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-4 text-muted-foreground text-sm">
                No GitHub review feedback has been synced yet.
              </div>
            ) : (
              <div className="overflow-hidden rounded-md border border-border/70">
                {activities.map((item) => (
                  <div
                    key={item.id}
                    className="min-w-0 border-border/70 border-b p-3 last:border-b-0"
                  >
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Badge
                          size="sm"
                          variant={item.kind === "summary" ? "secondary" : "success"}
                        >
                          {item.kind === "summary" ? "Review" : "Inline"}
                        </Badge>
                        <span className="text-sm font-medium">{item.authorLogin}</span>
                        <Badge size="sm" variant="secondary">
                          {item.state}
                        </Badge>
                        {item.location ? (
                          <span className="min-w-0 max-w-full truncate text-muted-foreground text-xs">
                            {item.location}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex min-w-0 shrink items-center gap-2 text-muted-foreground text-xs">
                        {item.occurredAt ? (
                          <span className="truncate">{formatReviewDateTime(item.occurredAt)}</span>
                        ) : null}
                        {item.url ? (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="Open GitHub feedback"
                            className="inline-flex size-7 items-center justify-center rounded-md hover:bg-muted hover:text-foreground"
                          >
                            <ExternalLinkIcon className="size-3.5" />
                          </a>
                        ) : null}
                      </div>
                    </div>
                    <p className="mt-2 max-h-24 overflow-hidden whitespace-pre-wrap break-words text-muted-foreground text-sm [overflow-wrap:anywhere]">
                      {item.body.trim().length > 0 ? item.body : "(empty comment)"}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </DialogPanel>
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}

function EmptyState() {
  const navigate = useNavigate();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const snapshot = useReviewAppStore((store) => store.snapshot);
  const setSnapshot = useReviewAppStore((store) => store.setSnapshot);
  const [pending, setPending] = useState(false);
  const refreshReviewInbox = useAtomCommand(reviewEnvironment.refreshInbox, {
    reportFailure: false,
  });
  const connectedUser =
    snapshot?.github.status === "connected" && snapshot.github.user ? snapshot.github.user : null;

  const refreshInbox = async () => {
    if (primaryEnvironmentId === null) return;
    setPending(true);
    try {
      const next = unwrapCommandResult(
        await refreshReviewInbox(reviewTarget(primaryEnvironmentId, {})),
      );
      setSnapshot(next);
    } finally {
      setPending(false);
    }
  };
  const openSourceControlSettings = () => {
    void navigate({ to: "/settings/source-control" });
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <div className="rounded-full border border-border bg-card p-4">
        <GitPullRequestIcon className="size-8 text-muted-foreground" />
      </div>
      <div>
        <h1 className="text-xl font-semibold tracking-[-0.02em]">
          {connectedUser ? "No open pull requests" : "Connect GitHub to start peer review"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {connectedUser
            ? `Posting reviews as ${connectedUser.login}. The inbox will keep syncing in the background.`
            : "Connect GitHub from Source Control settings to sync personal and organization repositories with open PRs."}
        </p>
      </div>
      <Button
        disabled={connectedUser ? pending || primaryEnvironmentId === null : false}
        onClick={() => void (connectedUser ? refreshInbox() : openSourceControlSettings())}
      >
        {connectedUser ? "Refresh inbox" : "Open Source Control settings"}
      </Button>
    </div>
  );
}

function ReviewWorkspaceHeader({
  repository,
  selectedPullRequest,
  detail,
  refreshingDetail,
  enabledSkills,
  installSpec,
  mcpName,
  mcpCommand,
  mcpConnectionBadges,
  onPinPullRequest,
  onRefreshDetail,
  onInstallSpecChange,
  onInstallSkill,
  onMcpNameChange,
  onMcpCommandChange,
  onAddMcpConnection,
}: {
  readonly repository: ReviewRepository | null;
  readonly selectedPullRequest: ReviewPullRequest | null;
  readonly detail: ReviewPullRequestDetail | null;
  readonly refreshingDetail: boolean;
  readonly enabledSkills: ReadonlyArray<ReviewSkill>;
  readonly installSpec: string;
  readonly mcpName: string;
  readonly mcpCommand: string;
  readonly mcpConnectionBadges: ReadonlyArray<ReviewMcpConnection>;
  readonly onPinPullRequest: () => void;
  readonly onRefreshDetail: () => void;
  readonly onInstallSpecChange: (value: string) => void;
  readonly onInstallSkill: () => void;
  readonly onMcpNameChange: (value: string) => void;
  readonly onMcpCommandChange: (value: string) => void;
  readonly onAddMcpConnection: () => void;
}) {
  const headerTitle = repository ? repository.nameWithOwner : "Open pull requests";
  const headerContext = selectedPullRequest
    ? `#${selectedPullRequest.number} ${selectedPullRequest.title}`
    : repository
      ? `${repository.openPullRequestCount} open pull request${repository.openPullRequestCount === 1 ? "" : "s"}`
      : "Review inbox";

  return (
    <header
      className={cn(
        "border-b border-border",
        isElectron
          ? "drag-region flex h-[52px] items-center px-3 sm:px-5 wco:h-[env(titlebar-area-height)]"
          : "pb-2 pl-[calc(env(safe-area-inset-left)+0.75rem)] pr-[calc(env(safe-area-inset-right)+0.75rem)] pt-2 sm:pb-3 sm:pl-[calc(env(safe-area-inset-left)+1.25rem)] sm:pr-[calc(env(safe-area-inset-right)+1.25rem)] sm:pt-3",
      )}
    >
      <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
          <SidebarTrigger className="size-7 shrink-0 md:hidden" />
          <h2
            className="min-w-0 shrink truncate text-sm font-semibold text-foreground"
            title={headerTitle}
          >
            {headerTitle}
          </h2>
          {repository ? (
            <Badge
              variant="outline"
              className="min-w-0 shrink overflow-hidden"
              title={headerContext}
            >
              <span className="min-w-0 truncate">{headerContext}</span>
            </Badge>
          ) : null}
          {repository?.hidden || selectedPullRequest?.hidden ? <HiddenMarker /> : null}
          {selectedPullRequest ? (
            <ReviewPullRequestStatusBadges
              pullRequest={selectedPullRequest}
              className="hidden min-w-0 shrink lg:flex"
            />
          ) : null}
        </div>
        {repository ? (
          <div className={REVIEW_HEADER_ACTION_CLASS}>
            <ReviewCodeMenu repository={repository} selectedPullRequest={selectedPullRequest} />
            {selectedPullRequest ? (
              <>
                <ExistingGitHubFeedbackDialog
                  detail={detail}
                  refreshing={refreshingDetail}
                  onRefresh={onRefreshDetail}
                />
                <ReviewToolsMenu
                  enabledSkills={enabledSkills}
                  installSpec={installSpec}
                  mcpName={mcpName}
                  mcpCommand={mcpCommand}
                  mcpConnectionBadges={mcpConnectionBadges}
                  onInstallSpecChange={onInstallSpecChange}
                  onInstallSkill={onInstallSkill}
                  onMcpNameChange={onMcpNameChange}
                  onMcpCommandChange={onMcpCommandChange}
                  onAddMcpConnection={onAddMcpConnection}
                />
                <Button
                  size="xs"
                  variant="outline"
                  className="gap-1.5"
                  disabled={refreshingDetail}
                  onClick={onRefreshDetail}
                >
                  <RefreshCwIcon className="size-3.5" />
                  <span className="hidden xl:inline">
                    {refreshingDetail ? "Refreshing" : "Refresh"}
                  </span>
                </Button>
                <Button size="xs" variant="outline" className="gap-1.5" onClick={onPinPullRequest}>
                  <StarIcon
                    className={selectedPullRequest.pinned ? "size-3.5 fill-current" : "size-3.5"}
                  />
                  <span className="hidden xl:inline">
                    {selectedPullRequest.pinned ? "Pinned" : "Pin"}
                  </span>
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}

function ReviewRunControlPanel({
  className,
  latestRun,
  summaryDraft,
  runningReview,
  reviewEvent,
  selectedModelSelection,
  providerInstanceEntries,
  modelOptionsByInstance,
  onRunReview,
  onSubmitRun,
  onReviewEventChange,
  onModelSelectionChange,
  onUpdateSummaryDraft,
}: {
  readonly className?: string;
  readonly latestRun: ReviewRun | null;
  readonly summaryDraft: ReturnType<typeof getActiveReviewSummaryDraft>;
  readonly runningReview: boolean;
  readonly reviewEvent: ReviewSubmitEvent;
  readonly selectedModelSelection: ModelSelection;
  readonly providerInstanceEntries: ReturnType<typeof sortProviderInstanceEntries>;
  readonly modelOptionsByInstance: ReadonlyMap<
    ProviderInstanceId,
    ReturnType<typeof getAppModelOptionsForInstance>
  >;
  readonly onRunReview: () => void;
  readonly onSubmitRun: () => void;
  readonly onReviewEventChange: (event: ReviewSubmitEvent) => void;
  readonly onModelSelectionChange: (selection: ModelSelection) => void;
  readonly onUpdateSummaryDraft: (input: {
    readonly summaryDraftId: string;
    readonly event?: ReviewSubmitEvent;
  }) => void;
}) {
  const selectedInstanceId = selectedModelSelection.instanceId;
  const selectedModel = selectedModelSelection.model;
  const modelPickerDisabled = providerInstanceEntries.length === 0;
  const runActionLabel = runningReview ? "Reviewing" : latestRun ? "Run again" : "Run review";
  const submitActionLabel = latestRun?.status === "posted" ? "Posted to GitHub" : "Post to GitHub";
  const submitDisabled = !canSubmitReviewRun(latestRun, summaryDraft);
  const submitStatus =
    latestRun && latestRun.status !== "posted" && !summaryDraft ? "Summary required" : undefined;
  const panelStatus = runningReview
    ? "Running"
    : latestRun?.status === "posted"
      ? "Posted"
      : latestRun
        ? "Draft ready"
        : "Not run";

  const updateReviewEvent = (next: ReviewSubmitEvent) => {
    onReviewEventChange(next);
    if (summaryDraft) {
      onUpdateSummaryDraft({ summaryDraftId: summaryDraft.id, event: next });
    }
  };

  return (
    <ReviewFloatingPanel
      title="Review"
      status={panelStatus}
      busy={runningReview}
      className={className ?? ""}
    >
      <div className="mt-3 space-y-2.5">
        <ProviderModelPicker
          activeInstanceId={selectedInstanceId}
          model={selectedModel}
          lockedProvider={null}
          instanceEntries={providerInstanceEntries}
          modelOptionsByInstance={modelOptionsByInstance}
          disabled={modelPickerDisabled}
          triggerVariant="outline"
          triggerClassName="h-8 w-full max-w-none justify-start gap-2 px-2 text-xs sm:h-8 sm:max-w-none [&_svg]:mx-0"
          onInstanceModelChange={(instanceId, model) => {
            onModelSelectionChange(createModelSelection(instanceId, model));
          }}
        />

        <ReviewPanelActionButton
          variant="primary"
          icon={<ShieldCheckIcon className="size-4" />}
          label={runActionLabel}
          disabled={runningReview}
          onClick={onRunReview}
        />

        <div className="rounded-xl border border-border/70 bg-background/48 p-1">
          <ReviewEventSegmentedControl
            value={reviewEvent}
            options={REVIEW_EVENT_OPTIONS}
            onChange={updateReviewEvent}
          />
          <ReviewPanelActionButton
            className="mt-1"
            icon={<SendIcon className="size-4" />}
            label={submitActionLabel}
            {...(submitStatus ? { status: submitStatus } : {})}
            disabled={submitDisabled}
            onClick={onSubmitRun}
          />
        </div>
      </div>
    </ReviewFloatingPanel>
  );
}

function ReviewFloatingPanelStack({
  className,
  children,
}: {
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return <div className={cn("flex flex-col gap-3", className)}>{children}</div>;
}

function ReviewSummaryDraftPanel({
  latestRun,
  summaryDraft,
  body,
  onBodyChange,
  onSaveBody,
  onDelete,
}: {
  readonly latestRun: ReviewRun | null;
  readonly summaryDraft: ReturnType<typeof getActiveReviewSummaryDraft>;
  readonly body: string;
  readonly onBodyChange: (body: string) => void;
  readonly onSaveBody: (body: string) => void;
  readonly onDelete: () => void;
}) {
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  if (!summaryDraft || summaryDraft.status === "posted") {
    return null;
  }

  return (
    <>
      <ReviewFloatingPanel title="Review summary" status={summaryDraft.status}>
        <div className="mt-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2 text-muted-foreground text-xs">
            <span className="truncate">
              {latestRun ? `Generated ${formatReviewDateTime(latestRun.createdAt)}` : "Draft"}
            </span>
            <Button
              size="icon-xs"
              variant="destructive-outline"
              aria-label="Delete review summary draft"
              onClick={() => setDeleteConfirmOpen(true)}
            >
              <Trash2Icon className="size-3.5" />
            </Button>
          </div>
          <textarea
            aria-label="Review summary draft"
            value={body}
            rows={6}
            className="max-h-[12.5rem] min-h-32 w-full resize-none overflow-y-auto rounded-md border border-input bg-background px-3 py-2 text-sm"
            onChange={(event) => onBodyChange(event.currentTarget.value)}
            onBlur={() => onSaveBody(body)}
          />
        </div>
      </ReviewFloatingPanel>
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete review summary?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the local Review Summary draft permanently. The Review Run cannot be
              posted to GitHub until another summary exists.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setDeleteConfirmOpen(false);
                onDelete();
              }}
            >
              Delete summary
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}

function ReviewInlineCommentDraftsPanel({
  activeDraftCount,
  onOpen,
}: {
  readonly activeDraftCount: number;
  readonly onOpen: () => void;
}) {
  return (
    <ReviewFloatingPanel title="Inline comment drafts" status={`${activeDraftCount} active`}>
      <div className="mt-3">
        <ReviewPanelActionButton
          icon={<MessageSquareIcon className="size-4" />}
          label="Open drafts"
          {...(activeDraftCount === 0 ? { status: "No drafts" } : {})}
          onClick={onOpen}
        />
      </div>
    </ReviewFloatingPanel>
  );
}

function ReviewFloatingPanel({
  title,
  status,
  busy = false,
  className,
  children,
}: {
  readonly title: string;
  readonly status: string;
  readonly busy?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className={cn("flex justify-end", className)}>
      <div className="w-full rounded-2xl border border-border/80 bg-popover/95 px-3 pt-2.5 pb-3 text-popover-foreground shadow-xl shadow-black/10 ring-1 ring-white/5 backdrop-blur sm:w-[19rem]">
        <div className="flex min-w-0 items-center justify-between gap-3 text-sm">
          <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
            <span className="truncate">{title}</span>
            <ChevronDownIcon className="-rotate-90 size-4 shrink-0" />
          </div>
          <ReviewPanelStatusMessage label={status} busy={busy} />
        </div>
        {children}
      </div>
    </div>
  );
}

function ReviewPanelStatusMessage({
  label,
  busy,
}: {
  readonly label: string;
  readonly busy: boolean;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1.5 text-sm",
        busy ? "text-primary" : "text-muted-foreground",
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", busy ? "bg-primary" : "bg-muted-foreground/48")}
      />
      {label}
    </span>
  );
}

function ReviewEventSegmentedControl({
  value,
  options,
  className,
  onChange,
}: {
  readonly value: ReviewSubmitEvent;
  readonly options: ReadonlyArray<{
    readonly event: ReviewSubmitEvent;
    readonly label: string;
    readonly detail: string;
    readonly ariaLabel: string;
  }>;
  readonly className?: string;
  readonly onChange: (event: ReviewSubmitEvent) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="GitHub review post outcome"
      className={cn("grid min-w-0 grid-cols-3 gap-1", className)}
    >
      {options.map((option) => {
        const selected = value === option.event;
        return (
          <button
            key={option.event}
            type="button"
            role="radio"
            aria-label={option.ariaLabel}
            aria-checked={selected}
            title={option.detail}
            className={cn(
              "h-7 min-w-0 rounded-lg px-2 text-center text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              selected
                ? "bg-accent text-foreground shadow-xs"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
            onClick={() => onChange(option.event)}
          >
            <span className="block truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function ReviewPanelActionButton({
  variant = "secondary",
  icon,
  label,
  status,
  className,
  disabled,
  onClick,
}: {
  readonly variant?: "primary" | "secondary";
  readonly icon: ReactNode;
  readonly label: string;
  readonly status?: string;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}) {
  const primary = variant === "primary";

  return (
    <button
      type="button"
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-60",
        primary
          ? "border border-primary bg-primary text-primary-foreground shadow-primary/20 shadow-xs hover:bg-primary/90"
          : "border border-border/70 bg-background/48 text-foreground hover:bg-accent/50",
        className,
      )}
      disabled={disabled}
      onClick={onClick}
    >
      <span
        className={cn("shrink-0", primary ? "text-primary-foreground/80" : "text-muted-foreground")}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {status ? (
        <span
          className={cn(
            "shrink-0 text-[13px]",
            primary ? "text-primary-foreground/72" : "text-muted-foreground",
          )}
        >
          {status}
        </span>
      ) : null}
    </button>
  );
}

function ReviewLanding() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-16 text-center">
      <div className="max-w-sm">
        <GitPullRequestIcon className="mx-auto size-8 text-muted-foreground" />
        <h2 className="mt-4 text-lg font-semibold">Select a review repository</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Open a repository from Peer Review to browse its open pull requests.
        </p>
      </div>
    </div>
  );
}

function PullRequestList({
  repository,
  visiblePullRequests,
  inactivePullRequests,
  hiddenPullRequests,
  selectedPullRequestId,
  reviewedPullRequestIds,
  onSelectPullRequest,
  onTogglePullRequestHidden,
}: {
  readonly repository: ReviewRepository;
  readonly visiblePullRequests: ReadonlyArray<ReviewPullRequest>;
  readonly inactivePullRequests: ReadonlyArray<ReviewPullRequest>;
  readonly hiddenPullRequests: ReadonlyArray<ReviewPullRequest>;
  readonly selectedPullRequestId: string | null;
  readonly reviewedPullRequestIds: ReadonlySet<string>;
  readonly onSelectPullRequest: (pullRequest: ReviewPullRequest) => void;
  readonly onTogglePullRequestHidden: (pullRequest: ReviewPullRequest, hidden: boolean) => void;
}) {
  const hiddenSectionId = repositoryHiddenSectionId(repository.id);
  const inactiveSectionId = repositoryInactiveSectionId(repository.id);
  const hiddenExpanded = useUiStateStore(
    (state) => state.reviewHiddenSectionExpandedById[hiddenSectionId] ?? false,
  );
  const inactiveExpanded = useUiStateStore(
    (state) => state.reviewHiddenSectionExpandedById[inactiveSectionId] ?? false,
  );
  const toggleHiddenSection = useUiStateStore((state) => state.toggleReviewHiddenSection);

  return (
    <section className="min-h-0 overflow-auto border-r border-border">
      <div className="divide-y divide-border/70">
        {visiblePullRequests.map((pullRequest) => (
          <PullRequestListItem
            key={pullRequest.id}
            pullRequest={pullRequest}
            selected={pullRequest.id === selectedPullRequestId}
            reviewed={reviewedPullRequestIds.has(pullRequest.id)}
            onSelect={onSelectPullRequest}
            onToggleHidden={onTogglePullRequestHidden}
          />
        ))}
        {visiblePullRequests.length === 0 ? (
          <div className="px-5 py-8 text-sm text-muted-foreground">
            No open pull requests for {repository.nameWithOwner}.
          </div>
        ) : null}
      </div>
      {inactivePullRequests.length > 0 ? (
        <div className="border-t border-border/70">
          <button
            type="button"
            className="flex h-10 w-full cursor-pointer items-center gap-2 px-5 text-left text-muted-foreground text-sm transition-colors hover:bg-muted/40 hover:text-foreground"
            onClick={() => toggleHiddenSection(inactiveSectionId)}
          >
            <GitPullRequestIcon className="size-4" />
            <span className="min-w-0 flex-1">Tracked pull requests</span>
            <span className="text-xs">{inactivePullRequests.length}</span>
          </button>
          {inactiveExpanded ? (
            <div className="divide-y divide-border/70 border-t border-border/70">
              {inactivePullRequests.map((pullRequest) => (
                <PullRequestListItem
                  key={pullRequest.id}
                  pullRequest={pullRequest}
                  selected={pullRequest.id === selectedPullRequestId}
                  reviewed={reviewedPullRequestIds.has(pullRequest.id)}
                  onSelect={onSelectPullRequest}
                  onToggleHidden={onTogglePullRequestHidden}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {hiddenPullRequests.length > 0 ? (
        <div className="border-t border-border/70">
          <button
            type="button"
            className="flex h-10 w-full cursor-pointer items-center gap-2 px-5 text-left text-muted-foreground text-sm transition-colors hover:bg-muted/40 hover:text-foreground"
            onClick={() => toggleHiddenSection(hiddenSectionId)}
          >
            <EyeOffIcon className="size-4" />
            <span className="min-w-0 flex-1">Hidden pull requests</span>
            <span className="text-xs">{hiddenPullRequests.length}</span>
          </button>
          {hiddenExpanded ? (
            <div className="divide-y divide-border/70 border-t border-border/70">
              {hiddenPullRequests.map((pullRequest) => (
                <PullRequestListItem
                  key={pullRequest.id}
                  pullRequest={pullRequest}
                  selected={pullRequest.id === selectedPullRequestId}
                  reviewed={reviewedPullRequestIds.has(pullRequest.id)}
                  hidden
                  onSelect={onSelectPullRequest}
                  onToggleHidden={onTogglePullRequestHidden}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function PullRequestListItem({
  pullRequest,
  selected,
  reviewed,
  hidden = false,
  onSelect,
  onToggleHidden,
}: {
  readonly pullRequest: ReviewPullRequest;
  readonly selected: boolean;
  readonly reviewed: boolean;
  readonly hidden?: boolean;
  readonly onSelect: (pullRequest: ReviewPullRequest) => void;
  readonly onToggleHidden: (pullRequest: ReviewPullRequest, hidden: boolean) => void;
}) {
  return (
    <div
      className={selected ? "group/review-row bg-muted/60" : "group/review-row hover:bg-muted/40"}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 px-5 py-4">
        <button type="button" className="min-w-0 text-left" onClick={() => onSelect(pullRequest)}>
          <div className="min-w-0">
            <div
              className={
                hidden
                  ? "truncate text-muted-foreground text-sm font-medium"
                  : "truncate text-sm font-medium"
              }
            >
              #{pullRequest.number} {pullRequest.title}
            </div>
            <div className="mt-1 flex flex-wrap gap-2 text-muted-foreground text-xs">
              <span>{pullRequest.authorLogin}</span>
              <span>
                {pullRequest.headRefName} {"->"} {pullRequest.baseRefName}
              </span>
            </div>
          </div>
          <ReviewPullRequestStatusBadges
            pullRequest={pullRequest}
            hidden={hidden}
            reviewed={reviewed}
            showComments
            className="mt-3"
          />
        </button>
        <div className="flex h-7 shrink-0 items-center gap-1">
          {pullRequest.pinned ? (
            <span className="inline-flex size-7 items-center justify-center text-foreground">
              <StarIcon aria-hidden="true" className="size-4 fill-current" />
            </span>
          ) : null}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={hidden ? "Show pull request" : "Hide pull request"}
            className="opacity-100 focus-visible:opacity-100 md:opacity-0 md:group-hover/review-row:opacity-100"
            onClick={() => onToggleHidden(pullRequest, !hidden)}
          >
            {hidden ? <EyeIcon className="size-4" /> : <EyeOffIcon className="size-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

function reviewConversationChatMessages(
  messages: ReviewPullRequestDetail["conversationMessages"],
  pendingMessage: ReviewPendingChatMessage | null,
): ChatMessage[] {
  const confirmedMessages: ChatMessage[] = messages.map((message) => ({
    id: MessageId.make(message.id),
    role: message.role === "agent" ? "assistant" : "user",
    text: message.body,
    createdAt: message.createdAt,
    completedAt: message.createdAt,
    streaming: false,
  }));

  if (!pendingMessage) {
    return confirmedMessages;
  }

  return [
    ...confirmedMessages,
    {
      id: MessageId.make(`${pendingMessage.id}:user`),
      role: "user",
      text: pendingMessage.body,
      createdAt: pendingMessage.createdAt,
      completedAt: pendingMessage.createdAt,
      streaming: false,
    } satisfies ChatMessage,
    {
      id: MessageId.make(`${pendingMessage.id}:agent`),
      role: "assistant",
      text: "Reviewing the PR diff, existing feedback, and local drafts...",
      createdAt: pendingMessage.createdAt,
      streaming: true,
    } satisfies ChatMessage,
  ];
}

function ReviewChatComposer({
  pullRequestId,
  environmentId,
  serverProviders,
  settings,
  keybindings,
  resolvedTheme,
  selectedModelSelection,
  sendingChat,
  listRef,
  shouldAutoScrollRef,
  onModelSelectionChange,
  onSendChatMessage,
}: {
  readonly pullRequestId: string;
  readonly environmentId: EnvironmentId;
  readonly serverProviders: ReadonlyArray<ServerProvider>;
  readonly settings: UnifiedSettings;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly resolvedTheme: "light" | "dark";
  readonly selectedModelSelection: ModelSelection;
  readonly sendingChat: boolean;
  readonly listRef: RefObject<LegendListRef | null>;
  readonly shouldAutoScrollRef: RefObject<boolean>;
  readonly onModelSelectionChange: (selection: ModelSelection) => void;
  readonly onSendChatMessage: (message: string, modelSelection: ModelSelection) => Promise<boolean>;
}) {
  const threadId = useMemo(() => reviewConversationThreadId(pullRequestId), [pullRequestId]);
  const routeThreadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const promptRef = useRef("");
  const composerImagesRef = useRef<ComposerImageAttachment[]>([]);
  const composerTerminalContextsRef = useRef<TerminalContextDraft[]>([]);
  const composerRef = useRef<ChatComposerHandle | null>(null);
  const clearComposerDraftContent = useComposerDraftStore((store) => store.clearComposerContent);
  const setComposerDraftPrompt = useComposerDraftStore((store) => store.setPrompt);
  const setComposerDraftModelSelection = useComposerDraftStore((store) => store.setModelSelection);
  const [runtimeMode, setRuntimeMode] = useState(DEFAULT_RUNTIME_MODE);
  const [interactionMode, setInteractionMode] = useState(DEFAULT_INTERACTION_MODE);

  const focusComposer = () => composerRef.current?.focusAtEnd();
  const scrollToEnd = () => listRef.current?.scrollToEnd?.({ animated: true });

  const sendComposerMessage = (event?: { preventDefault: () => void }) => {
    event?.preventDefault();
    if (sendingChat) return;

    const sendContext = composerRef.current?.getSendContext();
    const message = (sendContext?.prompt ?? promptRef.current).trim();
    if (message.length === 0) return;

    void (async () => {
      promptRef.current = "";
      clearComposerDraftContent(routeThreadRef);
      composerRef.current?.resetCursorState();
      scrollToEnd();

      const posted = await onSendChatMessage(
        message,
        sendContext?.selectedModelSelection ?? selectedModelSelection,
      );
      if (!posted) {
        promptRef.current = message;
        setComposerDraftPrompt(routeThreadRef, message);
        focusComposer();
        return;
      }
      scrollToEnd();
    })();
  };

  const handleProviderModelSelect = (instanceId: ProviderInstanceId, model: string) => {
    const selection = createModelSelection(instanceId, model);
    setComposerDraftModelSelection(routeThreadRef, selection);
    onModelSelectionChange(selection);
    focusComposer();
  };

  return (
    <div className="pl-[calc(env(safe-area-inset-left)+0.75rem)] pr-[calc(env(safe-area-inset-right)+0.75rem)] pt-1.5 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:pl-[calc(env(safe-area-inset-left)+1.25rem)] sm:pr-[calc(env(safe-area-inset-right)+1.25rem)] sm:pt-2 sm:pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      <ChatComposer
        composerRef={composerRef}
        composerDraftTarget={routeThreadRef}
        environmentId={environmentId}
        routeKind="server"
        routeThreadRef={routeThreadRef}
        draftId={null}
        activeThreadId={null}
        activeThreadEnvironmentId={undefined}
        activeThread={undefined}
        isServerThread={false}
        isLocalDraftThread={false}
        phase="ready"
        isConnecting={false}
        isSendBusy={sendingChat}
        isPreparingWorktree={false}
        environmentUnavailable={null}
        activePendingApproval={null}
        pendingApprovals={[]}
        pendingUserInputs={[]}
        activePendingProgress={null}
        activePendingResolvedAnswers={null}
        activePendingIsResponding={false}
        activePendingDraftAnswers={{}}
        activePendingQuestionIndex={0}
        respondingRequestIds={[]}
        showPlanFollowUpPrompt={false}
        activeProposedPlan={null}
        activePlan={null}
        sidebarProposedPlan={null}
        planSidebarLabel="Plan"
        planSidebarOpen={false}
        runtimeMode={runtimeMode}
        interactionMode={interactionMode}
        showModeControls={false}
        lockedProvider={null}
        providerStatuses={serverProviders as ServerProvider[]}
        activeProjectDefaultModelSelection={selectedModelSelection}
        activeThreadModelSelection={selectedModelSelection}
        activeThreadActivities={[]}
        resolvedTheme={resolvedTheme}
        settings={settings}
        keybindings={keybindings}
        terminalOpen={false}
        gitCwd={null}
        promptRef={promptRef}
        composerImagesRef={composerImagesRef}
        composerTerminalContextsRef={composerTerminalContextsRef}
        shouldAutoScrollRef={shouldAutoScrollRef}
        scheduleStickToBottom={scrollToEnd}
        onSend={sendComposerMessage}
        onInterrupt={() => undefined}
        onImplementPlanInNewThread={() => undefined}
        onRespondToApproval={async () => undefined}
        onSelectActivePendingUserInputOption={() => undefined}
        onAdvanceActivePendingUserInput={() => undefined}
        onPreviousActivePendingUserInputQuestion={() => undefined}
        onChangeActivePendingUserInputCustomAnswer={() => undefined}
        onProviderModelSelect={handleProviderModelSelect}
        getModelDisabledReason={() => null}
        toggleInteractionMode={() =>
          setInteractionMode((current) => (current === "plan" ? "default" : "plan"))
        }
        handleRuntimeModeChange={setRuntimeMode}
        handleInteractionModeChange={setInteractionMode}
        togglePlanSidebar={() => undefined}
        focusComposer={focusComposer}
        scheduleComposerFocus={focusComposer}
        setThreadError={() => undefined}
        onExpandImage={() => undefined}
      />
    </div>
  );
}

function ReviewConversationThread({
  pullRequestId,
  environmentId,
  serverProviders,
  settings,
  keybindings,
  selectedModelSelection,
  conversationMessages,
  pendingChatMessage,
  sendingChat,
  timestampFormat,
  resolvedTheme,
  onModelSelectionChange,
  onSendChatMessage,
}: {
  readonly pullRequestId: string;
  readonly environmentId: EnvironmentId;
  readonly serverProviders: ReadonlyArray<ServerProvider>;
  readonly settings: UnifiedSettings;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly selectedModelSelection: ModelSelection;
  readonly conversationMessages: ReviewPullRequestDetail["conversationMessages"];
  readonly pendingChatMessage: ReviewPendingChatMessage | null;
  readonly sendingChat: boolean;
  readonly timestampFormat: TimestampFormat;
  readonly resolvedTheme: "light" | "dark";
  readonly onModelSelectionChange: (selection: ModelSelection) => void;
  readonly onSendChatMessage: (message: string, modelSelection: ModelSelection) => Promise<boolean>;
}) {
  const listRef = useRef<LegendListRef | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const [isAtEnd, setIsAtEnd] = useState(true);
  shouldAutoScrollRef.current = isAtEnd;
  const timelineMessages = useMemo(
    () => reviewConversationChatMessages(conversationMessages, pendingChatMessage),
    [conversationMessages, pendingChatMessage],
  );
  const timelineEntries = useMemo(
    () => deriveTimelineEntries(timelineMessages, [], []),
    [timelineMessages],
  );
  const emptyTurnDiffSummaryByAssistantMessageId = useMemo(
    () => new Map<MessageId, TurnDiffSummary>(),
    [],
  );
  const emptyRevertTurnCountByUserMessageId = useMemo(() => new Map<MessageId, number>(), []);
  const routeThreadKey = useMemo(
    () => scopedThreadKey(scopeThreadRef(environmentId, reviewConversationThreadId(pullRequestId))),
    [environmentId, pullRequestId],
  );

  return (
    <section className="flex min-h-[34rem] flex-col overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1 flex-col">
          {timelineEntries.length === 0 ? (
            <div className="flex min-h-72 flex-1 items-center justify-center px-6 text-center">
              <div className="max-w-sm">
                <MessageSquareIcon className="mx-auto size-8 text-muted-foreground" />
                <h3 className="mt-3 font-semibold">Start the review conversation</h3>
                <p className="mt-1 text-muted-foreground text-sm">
                  Ask the agent about this PR. Draft feedback appears in the Review Summary and
                  Inline Comment Drafts panels.
                </p>
              </div>
            </div>
          ) : (
            <MessagesTimeline
              isWorking={sendingChat}
              activeTurnInProgress={sendingChat}
              activeTurnStartedAt={null}
              listRef={listRef}
              timelineEntries={timelineEntries}
              latestTurn={null}
              turnDiffSummaryByAssistantMessageId={emptyTurnDiffSummaryByAssistantMessageId}
              routeThreadKey={routeThreadKey}
              onOpenTurnDiff={() => undefined}
              revertTurnCountByUserMessageId={emptyRevertTurnCountByUserMessageId}
              onRevertUserMessage={() => undefined}
              isRevertingCheckpoint={false}
              onImageExpand={() => undefined}
              activeThreadEnvironmentId={environmentId}
              markdownCwd={undefined}
              resolvedTheme={resolvedTheme}
              timestampFormat={timestampFormat}
              workspaceRoot={undefined}
              onIsAtEndChange={setIsAtEnd}
            />
          )}
          {!isAtEnd && timelineEntries.length > 0 ? (
            <div className="pointer-events-none absolute bottom-1 left-1/2 z-30 flex -translate-x-1/2 justify-center py-1.5">
              <button
                type="button"
                onClick={() => listRef.current?.scrollToEnd?.({ animated: true })}
                className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1 text-muted-foreground text-xs shadow-sm transition-colors hover:border-border hover:text-foreground"
              >
                <ChevronDownIcon className="size-3.5" />
                Scroll to bottom
              </button>
            </div>
          ) : null}
        </div>

        <ReviewChatComposer
          pullRequestId={pullRequestId}
          environmentId={environmentId}
          serverProviders={serverProviders}
          settings={settings}
          keybindings={keybindings}
          resolvedTheme={resolvedTheme}
          selectedModelSelection={selectedModelSelection}
          sendingChat={sendingChat}
          listRef={listRef}
          shouldAutoScrollRef={shouldAutoScrollRef}
          onModelSelectionChange={onModelSelectionChange}
          onSendChatMessage={onSendChatMessage}
        />
      </div>
    </section>
  );
}

function PullRequestDetail({
  repository,
  selectedPullRequest,
  detail,
  latestRun,
  runningReview,
  reviewEvent,
  environmentId,
  serverProviders,
  settings,
  keybindings,
  selectedModelSelection,
  providerInstanceEntries,
  modelOptionsByInstance,
  timestampFormat,
  resolvedTheme,
  selectedReviewNotice,
  sendingChat,
  pendingChatMessage,
  onBackToList,
  onModelSelectionChange,
  onRunReview,
  onSubmitRun,
  onReviewEventChange,
  onSendChatMessage,
  onUpdateSummaryDraft,
  onDeleteSummaryDraft,
  onUpdateCommentDraft,
}: {
  readonly repository: ReviewRepository;
  readonly selectedPullRequest: ReviewPullRequest | null;
  readonly detail: ReviewPullRequestDetail | null;
  readonly latestRun: ReviewRun | null;
  readonly runningReview: boolean;
  readonly reviewEvent: ReviewSubmitEvent;
  readonly environmentId: EnvironmentId;
  readonly serverProviders: ReadonlyArray<ServerProvider>;
  readonly settings: UnifiedSettings;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly selectedModelSelection: ModelSelection;
  readonly providerInstanceEntries: ReturnType<typeof sortProviderInstanceEntries>;
  readonly modelOptionsByInstance: ReadonlyMap<
    ProviderInstanceId,
    ReturnType<typeof getAppModelOptionsForInstance>
  >;
  readonly timestampFormat: TimestampFormat;
  readonly resolvedTheme: "light" | "dark";
  readonly selectedReviewNotice: ReviewActionNotice | null;
  readonly sendingChat: boolean;
  readonly pendingChatMessage: ReviewPendingChatMessage | null;
  readonly onBackToList: () => void;
  readonly onModelSelectionChange: (selection: ModelSelection) => void;
  readonly onRunReview: () => void;
  readonly onSubmitRun: () => void;
  readonly onReviewEventChange: (event: ReviewSubmitEvent) => void;
  readonly onSendChatMessage: (message: string, modelSelection: ModelSelection) => Promise<boolean>;
  readonly onUpdateSummaryDraft: (input: {
    readonly summaryDraftId: string;
    readonly body?: string;
    readonly event?: ReviewSubmitEvent;
  }) => void;
  readonly onDeleteSummaryDraft: (input: { readonly summaryDraftId: string }) => void;
  readonly onUpdateCommentDraft: (input: {
    readonly commentDraftId: string;
    readonly body?: string;
    readonly status?: ReviewCommentDraft["status"];
    readonly filePath?: string;
    readonly line?: number;
    readonly side?: ReviewCommentDraft["side"];
    readonly startLine?: number | null;
    readonly startSide?: ReviewCommentDraft["startSide"];
  }) => void;
}) {
  const [summaryEdits, setSummaryEdits] = useState<Record<string, string>>({});
  const [commentEdits, setCommentEdits] = useState<Record<string, string>>({});
  const [retargetDraftId, setRetargetDraftId] = useState<string | null>(null);
  const [inlineDraftsSheetOpen, setInlineDraftsSheetOpen] = useState(false);

  if (!selectedPullRequest) {
    return (
      <aside className="min-h-0 overflow-auto">
        <div className="p-8 text-sm text-muted-foreground">Select a pull request.</div>
      </aside>
    );
  }

  const summaryDraft = getActiveReviewSummaryDraft(detail, latestRun);
  const commentDrafts = getActiveReviewCommentDrafts(detail, latestRun);
  const activeDrafts = commentDrafts.filter((draft) => draft.status !== "dismissed");
  const conversationMessages = detail?.conversationMessages ?? [];
  const findingsById = new Map((latestRun?.findings ?? []).map((finding) => [finding.id, finding]));
  const summaryDraftBody = summaryDraft ? (summaryEdits[summaryDraft.id] ?? summaryDraft.body) : "";

  const updateSummaryBody = (draftId: string, body: string) => {
    setSummaryEdits((current) => ({ ...current, [draftId]: body }));
  };
  const updateCommentBody = (draftId: string, body: string) => {
    setCommentEdits((current) => ({ ...current, [draftId]: body }));
  };
  const deleteSummaryDraft = (draftId: string) => {
    setSummaryEdits((current) => {
      const { [draftId]: _removed, ...remaining } = current;
      return remaining;
    });
    onDeleteSummaryDraft({ summaryDraftId: draftId });
  };
  const updateInlineDraftsSheetOpen = (open: boolean) => {
    setInlineDraftsSheetOpen(open);
    if (!open) {
      setRetargetDraftId(null);
    }
  };
  const updateCommentTarget = (
    draftId: string,
    target: {
      readonly filePath: string;
      readonly line: number;
      readonly side: ReviewCommentDraft["side"];
    },
  ) => {
    onUpdateCommentDraft({
      commentDraftId: draftId,
      filePath: target.filePath,
      line: target.line,
      side: target.side,
      startLine: null,
      startSide: null,
    });
    setRetargetDraftId(null);
  };

  const renderDiffBlock = (
    block: ReviewPullRequestDetail["codeBlocks"][number],
    options: {
      readonly currentDraft?: ReviewCommentDraft | null;
      readonly targetDraftId?: string | null;
      readonly maxHeightClassName?: string;
    } = {},
  ) => {
    const targetDraftId = options.targetDraftId ?? null;
    const currentDraft = options.currentDraft ?? null;
    const maxHeightClassName = options.maxHeightClassName ?? "max-h-72";

    return (
      <div className="overflow-hidden rounded-md border border-border/70 bg-muted/20 font-mono text-xs">
        <div className="border-b border-border/70 px-3 py-2 text-muted-foreground">
          {block.filePath}
        </div>
        <div className={cn(maxHeightClassName, "overflow-auto")}>
          {block.lines.map((line) => {
            const targetLine = line.newLine ?? line.oldLine;
            const targetSide = line.newLine ? "RIGHT" : "LEFT";
            const selectable = targetDraftId !== null && targetLine !== null;
            const isCurrentAnchor =
              currentDraft !== null &&
              block.filePath === currentDraft.filePath &&
              targetLine === currentDraft.line &&
              targetSide === currentDraft.side;
            const toneClass = isCurrentAnchor
              ? "bg-primary/10 ring-1 ring-inset ring-primary/40"
              : line.kind === "addition"
                ? "bg-emerald-500/10"
                : line.kind === "deletion"
                  ? "bg-destructive/10"
                  : "";
            const hoverClass = selectable
              ? line.kind === "addition"
                ? "cursor-pointer hover:bg-emerald-500/20"
                : line.kind === "deletion"
                  ? "cursor-pointer hover:bg-destructive/20"
                  : "cursor-pointer hover:bg-muted/60"
              : "cursor-default";

            return (
              <button
                key={line.id}
                type="button"
                className={cn(
                  "grid w-full grid-cols-[4rem_minmax(0,1fr)] gap-3 px-3 py-0.5 text-left disabled:pointer-events-none",
                  toneClass,
                  hoverClass,
                )}
                disabled={!selectable}
                aria-label={
                  targetDraftId !== null && targetLine !== null
                    ? `Set target to ${formatCodeAnchor(block.filePath, targetLine, targetSide)}`
                    : undefined
                }
                onClick={() => {
                  if (targetDraftId === null || targetLine === null) return;
                  updateCommentTarget(targetDraftId, {
                    filePath: block.filePath,
                    line: targetLine,
                    side: targetSide,
                  });
                }}
              >
                <span className="select-none text-muted-foreground">
                  {line.oldLine ?? "-"}:{line.newLine ?? "-"}
                </span>
                <span className="min-w-0 whitespace-pre-wrap break-words">
                  {line.kind === "addition" ? "+" : line.kind === "deletion" ? "-" : " "}
                  {line.content}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderCodeBlockForDraft = (draft: ReviewCommentDraft) => {
    const block =
      detail?.codeBlocks.find(
        (candidate) =>
          candidate.filePath === draft.filePath &&
          candidate.lines.some((line) =>
            draft.side === "RIGHT" ? line.newLine === draft.line : line.oldLine === draft.line,
          ),
      ) ?? detail?.codeBlocks.find((candidate) => candidate.filePath === draft.filePath);

    if (!block) {
      return (
        <div className="rounded-md border border-dashed border-border p-3 text-muted-foreground text-xs">
          Refresh PR detail to load the diff hunk for this draft.
        </div>
      );
    }

    return renderDiffBlock(block, {
      currentDraft: draft,
    });
  };

  return (
    <>
      <aside className="min-h-0 overflow-auto">
        <div className="p-5 md:p-6">
          <Button
            size="sm"
            variant="ghost"
            className="mb-4 gap-1.5 md:hidden"
            onClick={onBackToList}
          >
            <ArrowLeftIcon className="size-4" />
            Pull requests
          </Button>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
            <div className="min-w-0 space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <GitPullRequestIcon className="size-4" />
                    <span>PR #{selectedPullRequest.number}</span>
                    {selectedPullRequest.hidden || repository.hidden ? <HiddenMarker /> : null}
                  </div>
                  <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">
                    {selectedPullRequest.title}
                  </h2>
                  <ReviewPullRequestStatusBadges
                    pullRequest={selectedPullRequest}
                    className="mt-3"
                  />
                  <div className="mt-2 flex flex-wrap gap-2 text-muted-foreground text-xs">
                    <span>{selectedPullRequest.headRefName}</span>
                    <span>{"->"}</span>
                    <span>{selectedPullRequest.baseRefName}</span>
                    {detail?.headSha ? <span>head {detail.headSha.slice(0, 7)}</span> : null}
                  </div>
                </div>
              </div>

              <ReviewFloatingPanelStack className="lg:hidden">
                <ReviewRunControlPanel
                  latestRun={latestRun}
                  summaryDraft={summaryDraft}
                  runningReview={runningReview}
                  reviewEvent={reviewEvent}
                  selectedModelSelection={selectedModelSelection}
                  providerInstanceEntries={providerInstanceEntries}
                  modelOptionsByInstance={modelOptionsByInstance}
                  onRunReview={onRunReview}
                  onSubmitRun={onSubmitRun}
                  onReviewEventChange={onReviewEventChange}
                  onModelSelectionChange={onModelSelectionChange}
                  onUpdateSummaryDraft={onUpdateSummaryDraft}
                />
                <ReviewSummaryDraftPanel
                  latestRun={latestRun}
                  summaryDraft={summaryDraft}
                  body={summaryDraftBody}
                  onBodyChange={(body) => {
                    if (summaryDraft) updateSummaryBody(summaryDraft.id, body);
                  }}
                  onSaveBody={(body) => {
                    if (summaryDraft) {
                      onUpdateSummaryDraft({
                        summaryDraftId: summaryDraft.id,
                        body,
                      });
                    }
                  }}
                  onDelete={() => {
                    if (summaryDraft) deleteSummaryDraft(summaryDraft.id);
                  }}
                />
                <ReviewInlineCommentDraftsPanel
                  activeDraftCount={activeDrafts.length}
                  onOpen={() => updateInlineDraftsSheetOpen(true)}
                />
              </ReviewFloatingPanelStack>

              {selectedReviewNotice ? (
                <Alert variant={selectedReviewNotice.variant}>
                  <AlertTitle>{selectedReviewNotice.title}</AlertTitle>
                  <AlertDescription>{selectedReviewNotice.detail}</AlertDescription>
                </Alert>
              ) : null}

              <ReviewConversationThread
                pullRequestId={selectedPullRequest.id}
                environmentId={environmentId}
                serverProviders={serverProviders}
                settings={settings}
                keybindings={keybindings}
                selectedModelSelection={selectedModelSelection}
                conversationMessages={conversationMessages}
                pendingChatMessage={pendingChatMessage}
                sendingChat={sendingChat}
                timestampFormat={timestampFormat}
                resolvedTheme={resolvedTheme}
                onModelSelectionChange={onModelSelectionChange}
                onSendChatMessage={onSendChatMessage}
              />
            </div>

            <ReviewFloatingPanelStack className="sticky top-0 z-20 hidden w-[19rem] flex-col gap-3 justify-self-end lg:flex">
              <ReviewRunControlPanel
                latestRun={latestRun}
                summaryDraft={summaryDraft}
                runningReview={runningReview}
                reviewEvent={reviewEvent}
                selectedModelSelection={selectedModelSelection}
                providerInstanceEntries={providerInstanceEntries}
                modelOptionsByInstance={modelOptionsByInstance}
                onRunReview={onRunReview}
                onSubmitRun={onSubmitRun}
                onReviewEventChange={onReviewEventChange}
                onModelSelectionChange={onModelSelectionChange}
                onUpdateSummaryDraft={onUpdateSummaryDraft}
              />
              <ReviewSummaryDraftPanel
                latestRun={latestRun}
                summaryDraft={summaryDraft}
                body={summaryDraftBody}
                onBodyChange={(body) => {
                  if (summaryDraft) updateSummaryBody(summaryDraft.id, body);
                }}
                onSaveBody={(body) => {
                  if (summaryDraft) {
                    onUpdateSummaryDraft({
                      summaryDraftId: summaryDraft.id,
                      body,
                    });
                  }
                }}
                onDelete={() => {
                  if (summaryDraft) deleteSummaryDraft(summaryDraft.id);
                }}
              />
              <ReviewInlineCommentDraftsPanel
                activeDraftCount={activeDrafts.length}
                onOpen={() => updateInlineDraftsSheetOpen(true)}
              />
            </ReviewFloatingPanelStack>
          </div>
        </div>
      </aside>
      <Sheet open={inlineDraftsSheetOpen} onOpenChange={updateInlineDraftsSheetOpen}>
        <SheetPopup side="right" className="!w-[calc(100%-(--spacing(8)))] !max-w-5xl">
          <SheetHeader>
            <SheetTitle>Inline comment drafts</SheetTitle>
            <SheetDescription>
              Edit, dismiss, or retarget local Review Comment Drafts before posting the review.
            </SheetDescription>
          </SheetHeader>
          <SheetPanel className="space-y-4">
            {activeDrafts.length > 0 ? (
              <div className="space-y-4">
                {activeDrafts.map((draft) => {
                  const body = commentEdits[draft.id] ?? draft.body;
                  const finding = draft.findingId ? findingsById.get(draft.findingId) : null;
                  const targetPickerOpen = retargetDraftId === draft.id;
                  const codeBlocks = detail?.codeBlocks ?? [];
                  return (
                    <div key={draft.id} className="rounded-lg border border-border/70 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge size="sm" variant="secondary">
                              {draft.status}
                            </Badge>
                            {finding ? (
                              <>
                                <Badge size="sm" variant="secondary">
                                  {finding.category}
                                </Badge>
                                <Badge size="sm" variant="warning">
                                  {finding.severity}
                                </Badge>
                              </>
                            ) : null}
                            <span className="text-muted-foreground text-xs">
                              {draftLocationLabel(draft)}
                            </span>
                          </div>
                          <h3 className="mt-2 text-sm font-semibold">
                            {finding?.title ?? "Draft inline comment"}
                          </h3>
                          <p className="mt-1 truncate text-muted-foreground text-xs">
                            {draftLocationDetail(draft)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Button
                            size="sm"
                            variant={targetPickerOpen ? "secondary" : "outline"}
                            className="gap-1.5"
                            onClick={() => setRetargetDraftId(targetPickerOpen ? null : draft.id)}
                          >
                            <FileCodeIcon className="size-4" />
                            {targetPickerOpen ? "Cancel" : "Change target"}
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Dismiss draft comment"
                            onClick={() =>
                              onUpdateCommentDraft({
                                commentDraftId: draft.id,
                                status: "dismissed",
                              })
                            }
                          >
                            <XIcon className="size-4" />
                          </Button>
                        </div>
                      </div>
                      {finding?.explanation ? (
                        <p className="mt-3 rounded-md bg-muted/40 px-3 py-2 text-muted-foreground text-sm">
                          {finding.explanation}
                        </p>
                      ) : null}
                      <div className="mt-3">{renderCodeBlockForDraft(draft)}</div>
                      {targetPickerOpen ? (
                        <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="font-medium text-sm">Select target line</div>
                            <Badge size="sm" variant="secondary">
                              {codeBlocks.length} hunks
                            </Badge>
                          </div>
                          {codeBlocks.length > 0 ? (
                            <div className="mt-3 space-y-3">
                              {codeBlocks.map((block) => (
                                <div key={block.id}>
                                  {renderDiffBlock(block, {
                                    currentDraft: draft,
                                    targetDraftId: draft.id,
                                    maxHeightClassName: "max-h-80",
                                  })}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="mt-3 rounded-md border border-dashed border-border bg-background/72 p-3 text-muted-foreground text-sm">
                              Refresh PR detail to load diff hunks.
                            </div>
                          )}
                        </div>
                      ) : null}
                      <textarea
                        aria-label="Inline comment draft"
                        value={body}
                        rows={5}
                        className="mt-3 min-h-28 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
                        onChange={(event) => updateCommentBody(draft.id, event.currentTarget.value)}
                        onBlur={() =>
                          onUpdateCommentDraft({
                            commentDraftId: draft.id,
                            body,
                          })
                        }
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border p-6 text-center text-muted-foreground text-sm">
                No active inline comment drafts.
              </div>
            )}
          </SheetPanel>
        </SheetPopup>
      </Sheet>
    </>
  );
}

export default function ReviewWorkspace({
  routeTarget = null,
}: {
  readonly routeTarget?: ReviewRouteTarget;
}) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const snapshot = useReviewAppStore((store) => store.snapshot);
  const selectRepository = useReviewAppStore((store) => store.selectRepository);
  const selectPullRequest = useReviewAppStore((store) => store.selectPullRequest);
  const [installSpec, setInstallSpec] = useState("");
  const [mcpName, setMcpName] = useState("");
  const [mcpCommand, setMcpCommand] = useState("");
  const [runningReview, setRunningReview] = useState(false);
  const [refreshingDetail, setRefreshingDetail] = useState(false);
  const [sendingChat, setSendingChat] = useState(false);
  const [reviewEvent, setReviewEvent] = useState<ReviewSubmitEvent>("COMMENT");
  const [reviewModelSelectionOverride, setReviewModelSelectionOverride] =
    useState<ModelSelection | null>(null);
  const [reviewNotice, setReviewNotice] = useState<ReviewActionNotice | null>(null);
  const [pendingReviewChatMessage, setPendingReviewChatMessage] =
    useState<ReviewPendingChatMessage | null>(null);
  const [listWidth, setListWidth] = useState(readStoredReviewPrListWidth);
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);
  const serverProviders = useServerProviders();
  const keybindings = useServerKeybindings();
  const settings = useSettings();
  const { resolvedTheme } = useTheme();
  const setPullRequestPinned = useAtomCommand(reviewEnvironment.setPullRequestPinned, {
    reportFailure: false,
  });
  const setPullRequestHidden = useAtomCommand(reviewEnvironment.setPullRequestHidden, {
    reportFailure: false,
  });
  const refreshReviewPullRequestDetail = useAtomCommand(
    reviewEnvironment.refreshPullRequestDetail,
    {
      reportFailure: false,
    },
  );
  const updateReviewSummaryDraft = useAtomCommand(reviewEnvironment.updateSummaryDraft, {
    reportFailure: false,
  });
  const deleteReviewSummaryDraft = useAtomCommand(reviewEnvironment.deleteSummaryDraft, {
    reportFailure: false,
  });
  const updateReviewCommentDraft = useAtomCommand(reviewEnvironment.updateCommentDraft, {
    reportFailure: false,
  });
  const sendReviewChatMessage = useAtomCommand(reviewEnvironment.sendChatMessage, {
    reportFailure: false,
  });
  const postReviewSummaryCard = useAtomCommand(reviewEnvironment.postSummaryCard, {
    reportFailure: false,
  });
  const postReviewInlineCard = useAtomCommand(reviewEnvironment.postInlineCard, {
    reportFailure: false,
  });
  const startReviewRun = useAtomCommand(reviewEnvironment.startRun, { reportFailure: false });
  const submitReviewRun = useAtomCommand(reviewEnvironment.submitRun, { reportFailure: false });
  const installReviewSkill = useAtomCommand(reviewEnvironment.installSkill, {
    reportFailure: false,
  });
  const upsertReviewMcpConnection = useAtomCommand(reviewEnvironment.upsertMcpConnection, {
    reportFailure: false,
  });
  const refreshReviewInbox = useAtomCommand(reviewEnvironment.refreshInbox, {
    reportFailure: false,
  });
  const setComposerDraftModelSelection = useComposerDraftStore((store) => store.setModelSelection);
  const providerInstanceEntries = useMemo(
    () => sortProviderInstanceEntries(deriveProviderInstanceEntries(serverProviders)),
    [serverProviders],
  );
  const defaultReviewModelSelection = useMemo(
    () => resolveAppModelSelectionState(settings, serverProviders),
    [serverProviders, settings],
  );
  const selectedReviewModelSelection = reviewModelSelectionOverride ?? defaultReviewModelSelection;
  const modelOptionsByInstance = useMemo(() => {
    const options = new Map<ProviderInstanceId, ReturnType<typeof getAppModelOptionsForInstance>>();
    for (const entry of providerInstanceEntries) {
      options.set(entry.instanceId, getAppModelOptionsForInstance(settings, entry));
    }
    return options;
  }, [providerInstanceEntries, settings]);
  const routePullRequestTarget = isPullRequestRouteTarget(routeTarget) ? routeTarget : null;
  const routeRepositoryTarget = routePullRequestTarget ?? routeTarget;
  const routeMatch = useMemo(
    () => findReviewPullRequestRouteMatch(snapshot, routePullRequestTarget),
    [routePullRequestTarget, snapshot],
  );
  const repository = useMemo(
    () => routeMatch?.repository ?? findReviewRepositoryRouteMatch(snapshot, routeRepositoryTarget),
    [routeMatch?.repository, routeRepositoryTarget, snapshot],
  );
  const allRepositoryPullRequests = useMemo(
    () =>
      snapshot?.pullRequests.filter((pullRequest) => pullRequest.repositoryId === repository?.id) ??
      [],
    [repository?.id, snapshot],
  );
  const visiblePullRequests = useMemo(
    () =>
      getVisibleReviewPullRequests({
        pullRequests: allRepositoryPullRequests,
        repositoryExpanded: true,
        repositoryHidden: repository?.hidden ?? false,
      }),
    [allRepositoryPullRequests, repository?.hidden],
  );
  const inactivePullRequests = useMemo(
    () =>
      getVisibleInactiveReviewPullRequests({
        pullRequests: allRepositoryPullRequests,
        repositoryExpanded: true,
        repositoryHidden: repository?.hidden ?? false,
      }),
    [allRepositoryPullRequests, repository?.hidden],
  );
  const hiddenPullRequests = useMemo(
    () =>
      allRepositoryPullRequests.filter((pullRequest) => pullRequest.hidden || repository?.hidden),
    [allRepositoryPullRequests, repository?.hidden],
  );
  const selectedPullRequest = routeMatch?.pullRequest ?? null;
  const selectedDetail =
    snapshot?.pullRequestDetails.find(
      (detail) => detail.pullRequestId === selectedPullRequest?.id,
    ) ?? null;
  const latestRun = snapshot?.reviewRuns.find(
    (run) => run.pullRequestId === selectedPullRequest?.id,
  );
  const reviewEnvironmentId = primaryEnvironmentId ?? REVIEW_FALLBACK_ENVIRONMENT_ID;
  const selectedReviewThreadRef = useMemo(
    () =>
      selectedPullRequest
        ? scopeThreadRef(reviewEnvironmentId, reviewConversationThreadId(selectedPullRequest.id))
        : null,
    [reviewEnvironmentId, selectedPullRequest],
  );
  const selectedReviewNotice =
    reviewNotice?.pullRequestId === selectedPullRequest?.id ? reviewNotice : null;
  const selectedPendingReviewChatMessage =
    pendingReviewChatMessage?.pullRequestId === selectedPullRequest?.id
      ? pendingReviewChatMessage
      : null;
  const enabledSkills = snapshot?.skills.filter((skill) => skill.enabled) ?? [];
  const enabledTrustedMcpConnectionIds =
    snapshot?.mcpConnections.reduce<string[]>((ids, connection) => {
      if (connection.enabled && connection.trusted) ids.push(connection.id);
      return ids;
    }, []) ?? [];
  const reviewedPullRequestIds = useMemo(
    () =>
      new Set(
        (snapshot?.reviewRuns ?? [])
          .filter((run) => run.status === "completed" || run.status === "posted")
          .map((run) => run.pullRequestId),
      ),
    [snapshot?.reviewRuns],
  );
  const routeTracker =
    primaryEnvironmentId !== null && routePullRequestTarget ? (
      <ReviewRouteTracker
        key={`${primaryEnvironmentId}:${routePullRequestTarget.ownerLogin}/${routePullRequestTarget.repositoryName}#${routePullRequestTarget.number}`}
        environmentId={primaryEnvironmentId}
        target={routePullRequestTarget}
      />
    ) : null;

  const setReviewModelSelection = (selection: ModelSelection) => {
    setReviewModelSelectionOverride(selection);
    if (selectedReviewThreadRef) {
      setComposerDraftModelSelection(selectedReviewThreadRef, selection);
    }
  };

  const pinPullRequest = async () => {
    if (primaryEnvironmentId === null || !selectedPullRequest) return;
    const next = unwrapCommandResult(
      await setPullRequestPinned(
        reviewTarget(primaryEnvironmentId, {
          pullRequestId: selectedPullRequest.id,
          pinned: !selectedPullRequest.pinned,
        }),
      ),
    );
    useReviewAppStore.getState().setSnapshot(next);
  };

  const togglePullRequestHidden = async (pullRequest: ReviewPullRequest, hidden: boolean) => {
    if (primaryEnvironmentId === null || !repository) return;
    const next = unwrapCommandResult(
      await setPullRequestHidden(
        reviewTarget(primaryEnvironmentId, {
          pullRequestId: pullRequest.id,
          hidden,
        }),
      ),
    );
    useReviewAppStore.getState().setSnapshot(next);
    if (hidden && selectedPullRequest?.id === pullRequest.id) {
      selectRepository(repository.id);
      selectPullRequest(null);
      await navigate({
        to: "/review/github/$owner/$repo",
        params: buildReviewRepositoryRouteParams({ repository }),
      });
    }
  };

  const refreshPullRequestDetail = async () => {
    if (primaryEnvironmentId === null || !selectedPullRequest) return;
    setRefreshingDetail(true);
    setReviewNotice(null);
    try {
      const next = unwrapCommandResult(
        await refreshReviewPullRequestDetail(
          reviewTarget(primaryEnvironmentId, {
            pullRequestId: selectedPullRequest.id,
          }),
        ),
      );
      useReviewAppStore.getState().setSnapshot(next);
    } catch (error) {
      setReviewNotice({
        pullRequestId: selectedPullRequest.id,
        variant: "error",
        title: "Refresh failed",
        detail: errorMessage(error, "Failed to refresh pull request detail."),
      });
    } finally {
      setRefreshingDetail(false);
    }
  };

  const updateSummaryDraft = async (input: {
    readonly summaryDraftId: string;
    readonly body?: string;
    readonly event?: ReviewSubmitEvent;
  }) => {
    if (primaryEnvironmentId === null) return;
    const next = unwrapCommandResult(
      await updateReviewSummaryDraft(reviewTarget(primaryEnvironmentId, input)),
    );
    useReviewAppStore.getState().setSnapshot(next);
  };

  const deleteSummaryDraft = async (input: { readonly summaryDraftId: string }) => {
    if (primaryEnvironmentId === null) return;
    const next = unwrapCommandResult(
      await deleteReviewSummaryDraft(reviewTarget(primaryEnvironmentId, input)),
    );
    useReviewAppStore.getState().setSnapshot(next);
  };

  const updateCommentDraft = async (input: {
    readonly commentDraftId: string;
    readonly body?: string;
    readonly status?: ReviewCommentDraft["status"];
    readonly filePath?: string;
    readonly line?: number;
    readonly side?: ReviewCommentDraft["side"];
    readonly startLine?: number | null;
    readonly startSide?: ReviewCommentDraft["startSide"];
  }) => {
    if (primaryEnvironmentId === null) return;
    const next = unwrapCommandResult(
      await updateReviewCommentDraft(reviewTarget(primaryEnvironmentId, input)),
    );
    useReviewAppStore.getState().setSnapshot(next);
  };

  const sendChatMessage = async (
    message: string,
    modelSelection: ModelSelection,
  ): Promise<boolean> => {
    const trimmed = message.trim();
    if (primaryEnvironmentId === null || !selectedPullRequest || trimmed.length === 0) return false;
    const pullRequestId = selectedPullRequest.id;
    const pendingMessage: ReviewPendingChatMessage = {
      id: `pending-review-chat-${randomUUID()}`,
      pullRequestId,
      body: trimmed,
      createdAt: new Date().toISOString(),
    };
    setSendingChat(true);
    setReviewNotice(null);
    setPendingReviewChatMessage(pendingMessage);
    try {
      const next = unwrapCommandResult(
        await sendReviewChatMessage(
          reviewTarget(primaryEnvironmentId, {
            pullRequestId,
            message: trimmed,
            modelSelection,
          }),
        ),
      );
      useReviewAppStore.getState().setSnapshot(next);
      return true;
    } catch (error) {
      setReviewNotice({
        pullRequestId,
        variant: "error",
        title: "Chat failed",
        detail: errorMessage(error, "Failed to send chat message."),
      });
      return false;
    } finally {
      setPendingReviewChatMessage((current) =>
        current?.id === pendingMessage.id ? null : current,
      );
      setSendingChat(false);
    }
  };

  const postSummaryCard = async (postCard: ReviewPostCard, body: string) => {
    if (primaryEnvironmentId === null || !selectedPullRequest) return;
    try {
      const next = unwrapCommandResult(
        await postReviewSummaryCard(
          reviewTarget(primaryEnvironmentId, {
            postCardId: postCard.id,
            body,
          }),
        ),
      );
      useReviewAppStore.getState().setSnapshot(next);
      setReviewNotice({
        pullRequestId: selectedPullRequest.id,
        variant: "success",
        title: "Summary posted",
        detail: "Posted a neutral GitHub pull request review summary.",
      });
    } catch (error) {
      setReviewNotice({
        pullRequestId: selectedPullRequest.id,
        variant: "error",
        title: "Summary post failed",
        detail: errorMessage(error, "Failed to post summary card."),
      });
    }
  };

  const postInlineCard = async (
    postCard: ReviewPostCard,
    input: {
      readonly body: string;
      readonly inReplyToGitHubCommentId?: string | null;
    },
  ) => {
    if (primaryEnvironmentId === null || !selectedPullRequest) return;
    try {
      const next = unwrapCommandResult(
        await postReviewInlineCard(
          reviewTarget(primaryEnvironmentId, {
            postCardId: postCard.id,
            body: input.body,
            inReplyToGitHubCommentId: input.inReplyToGitHubCommentId ?? null,
          }),
        ),
      );
      useReviewAppStore.getState().setSnapshot(next);
      setReviewNotice({
        pullRequestId: selectedPullRequest.id,
        variant: "success",
        title: "Inline comment posted",
        detail: "Posted the approved inline card to GitHub.",
      });
    } catch (error) {
      setReviewNotice({
        pullRequestId: selectedPullRequest.id,
        variant: "error",
        title: "Inline post failed",
        detail: errorMessage(error, "Failed to post inline card."),
      });
    }
  };

  const runReview = async () => {
    if (!selectedPullRequest) return;
    if (primaryEnvironmentId === null) {
      setReviewNotice({
        pullRequestId: selectedPullRequest.id,
        variant: "error",
        title: "Review backend unavailable",
        detail: "Reconnect to the backend and try again.",
      });
      return;
    }
    setRunningReview(true);
    setReviewNotice(null);
    try {
      const run = unwrapCommandResult(
        await startReviewRun(
          reviewTarget(primaryEnvironmentId, {
            pullRequestId: selectedPullRequest.id,
            categories: DEFAULT_RUN_CATEGORIES,
            skillIds: enabledSkills.map((skill) => skill.id),
            mcpConnectionIds: enabledTrustedMcpConnectionIds,
            modelSelection: selectedReviewModelSelection,
          }),
        ),
      );
      const next = unwrapCommandResult(await refreshReviewInbox(reviewTarget(primaryEnvironmentId, {})));
      useReviewAppStore.getState().setSnapshot({
        ...next,
        reviewRuns: [run, ...next.reviewRuns.filter((existing) => existing.id !== run.id)],
      });
      setReviewNotice({
        pullRequestId: run.pullRequestId,
        variant: "success",
        title: "Review run completed",
        detail: `${run.findings.length} draft finding${run.findings.length === 1 ? "" : "s"} ready below.`,
      });
    } catch (error) {
      setReviewNotice({
        pullRequestId: selectedPullRequest.id,
        variant: "error",
        title: "Review run failed",
        detail: errorMessage(error, "Failed to run review."),
      });
    } finally {
      setRunningReview(false);
    }
  };

  const submitRun = async () => {
    if (!latestRun) return;
    if (primaryEnvironmentId === null) {
      setReviewNotice({
        pullRequestId: latestRun.pullRequestId,
        variant: "error",
        title: "Review backend unavailable",
        detail: "Reconnect to the backend and try again.",
      });
      return;
    }
    try {
      const postedRun = unwrapCommandResult(
        await submitReviewRun(
          reviewTarget(primaryEnvironmentId, { runId: latestRun.id, event: reviewEvent }),
        ),
      );
      const next = unwrapCommandResult(await refreshReviewInbox(reviewTarget(primaryEnvironmentId, {})));
      useReviewAppStore.getState().setSnapshot(next);
      setReviewNotice({
        pullRequestId: postedRun.pullRequestId,
        variant: "success",
        title: "Review posted to GitHub",
        detail: postedRun.postedByGitHubUserLogin
          ? `Posted as ${postedRun.postedByGitHubUserLogin}.`
          : "Review was posted to GitHub.",
      });
    } catch (error) {
      setReviewNotice({
        pullRequestId: latestRun.pullRequestId,
        variant: "error",
        title: "Review submit failed",
        detail: errorMessage(error, "Failed to submit review."),
      });
    }
  };

  const installSkill = async () => {
    if (primaryEnvironmentId === null || installSpec.trim().length === 0) return;
    const result = unwrapCommandResult(
      await installReviewSkill(
        reviewTarget(primaryEnvironmentId, {
          packageSpec: installSpec.trim(),
          runInstaller: true,
        }),
      ),
    );
    setInstallSpec("");
    useReviewAppStore.getState().setSnapshot(result.snapshot);
  };

  const addMcpConnection = async () => {
    if (
      primaryEnvironmentId === null ||
      mcpName.trim().length === 0 ||
      mcpCommand.trim().length === 0
    ) {
      return;
    }
    await upsertReviewMcpConnection(
      reviewTarget(primaryEnvironmentId, {
        name: mcpName.trim(),
        command: mcpCommand.trim(),
        trusted: true,
        enabled: true,
      }),
    );
    setMcpName("");
    setMcpCommand("");
    useReviewAppStore
      .getState()
      .setSnapshot(unwrapCommandResult(await refreshReviewInbox(reviewTarget(primaryEnvironmentId, {}))));
  };

  const selectPullRequestForRoute = async (pullRequest: ReviewPullRequest) => {
    if (!repository) return;
    selectRepository(repository.id);
    selectPullRequest(pullRequest.id);
    await navigate({
      to: "/review/github/$owner/$repo/pull/$number",
      params: buildReviewPullRequestRouteParams({ repository, pullRequest }),
    });
  };

  const navigateToRepository = async () => {
    if (!repository) return;
    await navigate({
      to: "/review/github/$owner/$repo",
      params: buildReviewRepositoryRouteParams({ repository }),
    });
  };

  const onResizePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizeState({
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: listWidth,
    });
  };

  const onResizePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    setListWidth(
      clampReviewPrListWidth(resizeState.startWidth + event.clientX - resizeState.startX),
    );
  };

  const finishResize = (event: PointerEvent<HTMLDivElement>) => {
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    const nextWidth = clampReviewPrListWidth(
      resizeState.startWidth + event.clientX - resizeState.startX,
    );
    setListWidth(nextWidth);
    persistReviewPrListWidth(nextWidth);
    setResizeState(null);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  if (!snapshot || snapshot.groups.length === 0) {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-auto bg-background text-foreground">
        {routeTracker}
        <ReviewWorkspaceHeader
          repository={null}
          selectedPullRequest={null}
          detail={null}
          refreshingDetail={refreshingDetail}
          enabledSkills={[]}
          installSpec={installSpec}
          mcpName={mcpName}
          mcpCommand={mcpCommand}
          mcpConnectionBadges={[]}
          onPinPullRequest={() => undefined}
          onRefreshDetail={() => undefined}
          onInstallSpecChange={setInstallSpec}
          onInstallSkill={() => undefined}
          onMcpNameChange={setMcpName}
          onMcpCommandChange={setMcpCommand}
          onAddMcpConnection={() => undefined}
        />
        <EmptyState />
      </SidebarInset>
    );
  }

  const header = (
    <ReviewWorkspaceHeader
      repository={repository}
      selectedPullRequest={selectedPullRequest}
      detail={selectedDetail}
      refreshingDetail={refreshingDetail}
      enabledSkills={enabledSkills}
      installSpec={installSpec}
      mcpName={mcpName}
      mcpCommand={mcpCommand}
      mcpConnectionBadges={snapshot.mcpConnections}
      onPinPullRequest={() => void pinPullRequest()}
      onRefreshDetail={() => void refreshPullRequestDetail()}
      onInstallSpecChange={setInstallSpec}
      onInstallSkill={() => void installSkill()}
      onMcpNameChange={setMcpName}
      onMcpCommandChange={setMcpCommand}
      onAddMcpConnection={() => void addMcpConnection()}
    />
  );

  if (!repository) {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
        {routeTracker}
        <div className="flex h-full min-h-0 flex-col">
          {header}
          <ReviewLanding />
        </div>
      </SidebarInset>
    );
  }

  const list = (
    <PullRequestList
      repository={repository}
      visiblePullRequests={visiblePullRequests}
      inactivePullRequests={inactivePullRequests}
      hiddenPullRequests={hiddenPullRequests}
      selectedPullRequestId={selectedPullRequest?.id ?? null}
      reviewedPullRequestIds={reviewedPullRequestIds}
      onSelectPullRequest={(pullRequest) => {
        void selectPullRequestForRoute(pullRequest);
      }}
      onTogglePullRequestHidden={(pullRequest, hidden) => {
        void togglePullRequestHidden(pullRequest, hidden);
      }}
    />
  );

  const detail = (
    <PullRequestDetail
      repository={repository}
      selectedPullRequest={selectedPullRequest}
      detail={selectedDetail}
      latestRun={latestRun ?? null}
      runningReview={runningReview}
      reviewEvent={reviewEvent}
      environmentId={reviewEnvironmentId}
      serverProviders={serverProviders}
      settings={settings}
      keybindings={keybindings}
      selectedModelSelection={selectedReviewModelSelection}
      providerInstanceEntries={providerInstanceEntries}
      modelOptionsByInstance={modelOptionsByInstance}
      timestampFormat={settings.timestampFormat}
      resolvedTheme={resolvedTheme}
      selectedReviewNotice={selectedReviewNotice}
      sendingChat={sendingChat}
      pendingChatMessage={selectedPendingReviewChatMessage}
      onBackToList={() => {
        void navigateToRepository();
      }}
      onModelSelectionChange={setReviewModelSelection}
      onRunReview={() => void runReview()}
      onSubmitRun={() => void submitRun()}
      onReviewEventChange={setReviewEvent}
      onSendChatMessage={sendChatMessage}
      onUpdateSummaryDraft={(input) => void updateSummaryDraft(input)}
      onDeleteSummaryDraft={(input) => void deleteSummaryDraft(input)}
      onUpdateCommentDraft={(input) => void updateCommentDraft(input)}
    />
  );

  if (isMobile) {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
        {routeTracker}
        <div className="flex h-full min-h-0 flex-col">
          {header}
          {selectedPullRequest ? detail : list}
        </div>
      </SidebarInset>
    );
  }

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      {routeTracker}
      <div className="flex h-full min-h-0 flex-col">
        {header}
        <div
          className="grid min-h-0 flex-1"
          style={{ gridTemplateColumns: `${listWidth}px 4px minmax(0, 1fr)` }}
        >
          {list}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize pull request list"
            className="cursor-col-resize bg-border/60 transition-colors hover:bg-border"
            onPointerDown={onResizePointerDown}
            onPointerMove={onResizePointerMove}
            onPointerUp={finishResize}
            onPointerCancel={finishResize}
          />
          {detail}
        </div>
      </div>
    </SidebarInset>
  );
}
