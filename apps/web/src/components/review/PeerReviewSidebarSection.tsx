import {
  CheckCircle2Icon,
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  FolderGit2Icon,
  GitPullRequestIcon,
  ListCollapseIcon,
  RefreshCwIcon,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  type AtomCommandResult,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ReviewPullRequest,
  ReviewRepository,
  ReviewSidebarGroup,
} from "@t3tools/contracts";

import { cn } from "../../lib/utils";
import {
  buildReviewPullRequestRouteParams,
  buildReviewRepositoryRouteParams,
  findReviewPullRequestRouteMatch,
  findReviewRepositoryRouteMatch,
  parseReviewPullRequestRouteTarget,
  parseReviewRepositoryRouteTarget,
} from "../../reviewRoutes";
import { useReviewAppStore } from "../../reviewAppStore";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { reviewEnvironment } from "../../state/review";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { useUiStateStore } from "../../uiStateStore";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "../ui/sidebar";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { resolveThreadRowClassName } from "../Sidebar.logic";
import {
  getHiddenReviewPullRequests,
  getHiddenReviewRepositories,
  getVisiblePinnedReviewPullRequestItems,
  getVisibleReviewPullRequests,
  getVisibleReviewRepositories,
} from "./reviewSidebarLogic";

const EMPTY_REVIEW_GROUPS = [] as const;

function unwrapCommandResult<A, E>(result: AtomCommandResult<A, E>): A {
  if (result._tag === "Success") {
    return result.value;
  }
  throw squashAtomCommandFailure(result);
}

function reviewTarget<TInput>(environmentId: EnvironmentId, input: TInput) {
  return { environmentId, input };
}

function ownerHiddenSectionId(groupId: string): string {
  return `owner:${groupId}`;
}

function repositoryHiddenSectionId(repositoryId: string): string {
  return `repo:${repositoryId}`;
}

function pullRequestTimestamp(pullRequest: ReviewPullRequest): string | null {
  return pullRequest.lastProviderUpdatedAt;
}

function resolvePullRequestRowClassName({
  isActive,
  withTrailingAction = false,
}: {
  readonly isActive: boolean;
  readonly withTrailingAction?: boolean;
}) {
  return cn(
    resolveThreadRowClassName({ isActive, isSelected: false }),
    "relative isolate min-w-0 text-left",
    withTrailingAction && "flex-1",
  );
}

function resolvePullRequestIconClassName({
  hidden,
  isActive,
  sizeClassName,
}: {
  readonly hidden: boolean;
  readonly isActive: boolean;
  readonly sizeClassName: string;
}) {
  return cn(
    sizeClassName,
    "shrink-0",
    hidden
      ? "text-muted-foreground/35"
      : isActive
        ? "text-foreground/80"
        : "text-muted-foreground/60",
  );
}

function resolvePullRequestTitleClassName({
  hidden,
  isActive,
}: {
  readonly hidden: boolean;
  readonly isActive: boolean;
}) {
  return cn(
    "min-w-0 flex-1 truncate text-xs",
    hidden ? "text-muted-foreground/70" : isActive && "text-foreground",
  );
}

function ReviewItemActionButton({
  label,
  onClick,
  variant,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly variant: "hide" | "show";
}) {
  const Icon = variant === "hide" ? EyeOffIcon : EyeIcon;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/50 opacity-100 outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring md:opacity-0 md:group-hover/review-row:opacity-100"
            onClick={(event) => {
              event.stopPropagation();
              onClick();
            }}
          />
        }
      >
        <Icon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

function ReviewPullRequestRow({
  pullRequest,
  repository,
  isActive,
  reviewed,
  hidden = false,
  onSelect,
  onToggleHidden,
}: {
  readonly pullRequest: ReviewPullRequest;
  readonly repository: ReviewRepository;
  readonly isActive: boolean;
  readonly reviewed: boolean;
  readonly hidden?: boolean;
  readonly onSelect: (repository: ReviewRepository, pullRequest: ReviewPullRequest) => void;
  readonly onToggleHidden: (
    repository: ReviewRepository,
    pullRequest: ReviewPullRequest,
    hidden: boolean,
  ) => void;
}) {
  const rowButtonRender = useMemo(() => <button type="button" />, []);
  const timestamp = pullRequestTimestamp(pullRequest);

  return (
    <SidebarMenuSubItem className="group/review-row flex w-full items-center gap-1">
      <SidebarMenuSubButton
        render={rowButtonRender}
        size="sm"
        isActive={isActive}
        className={resolvePullRequestRowClassName({
          isActive,
          withTrailingAction: true,
        })}
        onClick={() => onSelect(repository, pullRequest)}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <GitPullRequestIcon
            className={resolvePullRequestIconClassName({
              hidden,
              isActive,
              sizeClassName: "size-3",
            })}
          />
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  className={resolvePullRequestTitleClassName({
                    hidden,
                    isActive,
                  })}
                >
                  #{pullRequest.number} {pullRequest.title}
                </span>
              }
            />
            <TooltipPopup side="top" className="max-w-80 whitespace-normal leading-tight">
              {repository.nameWithOwner} #{pullRequest.number}: {pullRequest.title}
            </TooltipPopup>
          </Tooltip>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {hidden ? <span className="text-[10px] text-muted-foreground/50">Hidden</span> : null}
          {!hidden && pullRequest.draft ? (
            <span className="text-[10px] text-warning-foreground/60">Draft</span>
          ) : null}
          {!hidden && reviewed ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="inline-flex size-3 items-center justify-center text-success" />
                }
              >
                <CheckCircle2Icon className="size-3" />
              </TooltipTrigger>
              <TooltipPopup side="top">Agent reviewed</TooltipPopup>
            </Tooltip>
          ) : null}
          {!hidden && timestamp ? (
            <span
              className={
                isActive ? "text-[10px] text-foreground/72" : "text-[10px] text-muted-foreground/40"
              }
            >
              {formatRelativeTimeLabel(timestamp)}
            </span>
          ) : null}
        </div>
      </SidebarMenuSubButton>
      <ReviewItemActionButton
        label={hidden ? "Show pull request" : "Hide pull request"}
        variant={hidden ? "show" : "hide"}
        onClick={() => onToggleHidden(repository, pullRequest, !hidden)}
      />
    </SidebarMenuSubItem>
  );
}

function PinnedPullRequestRow({
  pullRequest,
  repository,
  isActive,
  reviewed,
  onSelect,
}: {
  readonly pullRequest: ReviewPullRequest;
  readonly repository: ReviewRepository;
  readonly isActive: boolean;
  readonly reviewed: boolean;
  readonly onSelect: (repository: ReviewRepository, pullRequest: ReviewPullRequest) => void;
}) {
  const timestamp = pullRequestTimestamp(pullRequest);

  return (
    <SidebarMenuItem className="rounded-md">
      <SidebarMenuButton
        render={<button type="button" />}
        size="sm"
        isActive={isActive}
        className={cn(resolvePullRequestRowClassName({ isActive }), "gap-2 py-1.5")}
        onClick={() => onSelect(repository, pullRequest)}
      >
        <FolderGit2Icon
          className={
            pullRequest.draft
              ? "size-3.5 shrink-0 text-warning"
              : resolvePullRequestIconClassName({
                  hidden: false,
                  isActive,
                  sizeClassName: "size-3.5",
                })
          }
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cn("truncate text-xs font-medium", isActive && "text-foreground")}>
            #{pullRequest.number} {pullRequest.title}
          </span>
          <span
            className={cn(
              "truncate text-[10px]",
              isActive ? "text-foreground/70" : "text-muted-foreground/55",
            )}
          >
            {repository.nameWithOwner}
          </span>
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {reviewed ? <CheckCircle2Icon className="size-3 text-success" /> : null}
          {timestamp ? (
            <span
              className={
                isActive ? "text-[10px] text-foreground/72" : "text-[10px] text-muted-foreground/40"
              }
            >
              {formatRelativeTimeLabel(timestamp)}
            </span>
          ) : null}
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function ReviewHiddenSection({
  id,
  label,
  count,
  itemKind,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly itemKind: "menu" | "sub";
  readonly children: ReactNode;
}) {
  const expanded = useUiStateStore((state) => state.reviewHiddenSectionExpandedById[id] ?? false);
  const toggle = useUiStateStore((state) => state.toggleReviewHiddenSection);
  const Item = itemKind === "sub" ? SidebarMenuSubItem : SidebarMenuItem;

  if (count === 0) {
    return null;
  }

  return (
    <Item className="mt-1">
      <button
        type="button"
        className="flex h-7 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-muted-foreground/65 text-xs outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => toggle(id)}
      >
        <ChevronRightIcon
          className={`size-3 shrink-0 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
        />
        <EyeOffIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        <span className="shrink-0 text-[10px]">{count}</span>
      </button>
      {expanded ? <div className="mt-0.5">{children}</div> : null}
    </Item>
  );
}

function ReviewRepositoryRow({
  repository,
  pullRequests,
  activeRepositoryId,
  activePullRequestId,
  reviewedPullRequestIds,
  onSelectPullRequest,
  onToggleRepositoryHidden,
  onTogglePullRequestHidden,
}: {
  readonly repository: ReviewRepository;
  readonly pullRequests: ReadonlyArray<ReviewPullRequest>;
  readonly activeRepositoryId: string | null;
  readonly activePullRequestId: string | null;
  readonly reviewedPullRequestIds: ReadonlySet<string>;
  readonly onSelectPullRequest: (
    repository: ReviewRepository,
    pullRequest: ReviewPullRequest,
  ) => void;
  readonly onToggleRepositoryHidden: (repository: ReviewRepository, hidden: boolean) => void;
  readonly onTogglePullRequestHidden: (
    repository: ReviewRepository,
    pullRequest: ReviewPullRequest,
    hidden: boolean,
  ) => void;
}) {
  const repositoryExpanded = useUiStateStore(
    (state) => state.reviewRepositoryExpandedById[repository.id] ?? true,
  );
  const toggleRepository = useUiStateStore((state) => state.toggleReviewRepository);
  const visiblePullRequests = useMemo(
    () =>
      getVisibleReviewPullRequests({
        pullRequests,
        repositoryExpanded,
        repositoryHidden: repository.hidden,
      }),
    [pullRequests, repository.hidden, repositoryExpanded],
  );
  const hiddenPullRequests = useMemo(
    () => getHiddenReviewPullRequests(pullRequests),
    [pullRequests],
  );

  return (
    <SidebarMenuItem className="rounded-md">
      <div className="group/review-row relative rounded-md">
        <SidebarMenuButton
          render={<button type="button" />}
          size="sm"
          isActive={repository.id === activeRepositoryId}
          className="min-w-0 gap-2 px-2 py-1.5 pr-8 text-left"
          onClick={() => toggleRepository(repository.id)}
        >
          <ChevronRightIcon
            className={`-ml-0.5 size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150 ${
              repositoryExpanded ? "rotate-90" : ""
            }`}
          />
          <FolderGit2Icon className="size-3.5 shrink-0 text-muted-foreground/60" />
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate text-xs font-medium text-foreground/90">
              {repository.name}
            </span>
            <span className="shrink-0 text-[10px] text-muted-foreground/60">
              {repository.openPullRequestCount}
            </span>
          </span>
        </SidebarMenuButton>
        <div className="absolute right-1 top-1">
          <ReviewItemActionButton
            label="Hide repository"
            variant="hide"
            onClick={() => onToggleRepositoryHidden(repository, true)}
          />
        </div>
      </div>
      {repositoryExpanded ? (
        <SidebarMenuSub className="mx-1 my-0 w-full translate-x-0 gap-0.5 overflow-hidden px-1.5 py-0">
          {visiblePullRequests.map((pullRequest) => (
            <ReviewPullRequestRow
              key={pullRequest.id}
              pullRequest={pullRequest}
              repository={repository}
              isActive={pullRequest.id === activePullRequestId}
              reviewed={reviewedPullRequestIds.has(pullRequest.id)}
              onSelect={onSelectPullRequest}
              onToggleHidden={onTogglePullRequestHidden}
            />
          ))}
          <ReviewHiddenSection
            id={repositoryHiddenSectionId(repository.id)}
            label="Hidden pull requests"
            count={hiddenPullRequests.length}
            itemKind="sub"
          >
            <SidebarMenuSub className="mx-0 border-l-0 px-0 py-0">
              {hiddenPullRequests.map((pullRequest) => (
                <ReviewPullRequestRow
                  key={pullRequest.id}
                  pullRequest={pullRequest}
                  repository={repository}
                  isActive={pullRequest.id === activePullRequestId}
                  reviewed={reviewedPullRequestIds.has(pullRequest.id)}
                  hidden
                  onSelect={onSelectPullRequest}
                  onToggleHidden={onTogglePullRequestHidden}
                />
              ))}
            </SidebarMenuSub>
          </ReviewHiddenSection>
        </SidebarMenuSub>
      ) : null}
    </SidebarMenuItem>
  );
}

function HiddenRepositoryRow({
  repository,
  activeRepositoryId,
  onSelectRepository,
  onToggleRepositoryHidden,
}: {
  readonly repository: ReviewRepository;
  readonly activeRepositoryId: string | null;
  readonly onSelectRepository: (repository: ReviewRepository) => void;
  readonly onToggleRepositoryHidden: (repository: ReviewRepository, hidden: boolean) => void;
}) {
  return (
    <SidebarMenuItem className="group/review-row flex items-center gap-1 rounded-md">
      <SidebarMenuButton
        render={<button type="button" />}
        size="sm"
        isActive={repository.id === activeRepositoryId}
        className="min-w-0 flex-1 gap-2 px-2 py-1.5 text-left"
        onClick={() => onSelectRepository(repository)}
      >
        <EyeOffIcon className="size-4 shrink-0 text-muted-foreground/50" />
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-xs font-medium text-muted-foreground/80">
            {repository.name}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground/50">
            {repository.openPullRequestCount}
          </span>
        </span>
      </SidebarMenuButton>
      <ReviewItemActionButton
        label="Show repository"
        variant="show"
        onClick={() => onToggleRepositoryHidden(repository, false)}
      />
    </SidebarMenuItem>
  );
}

function ReviewOwnerGroup({
  group,
  pullRequestsByRepositoryId,
  activeRepositoryId,
  activePullRequestId,
  reviewedPullRequestIds,
  onSelectRepository,
  onSelectPullRequest,
  onToggleRepositoryHidden,
  onTogglePullRequestHidden,
}: {
  readonly group: ReviewSidebarGroup;
  readonly pullRequestsByRepositoryId: ReadonlyMap<string, ReviewPullRequest[]>;
  readonly activeRepositoryId: string | null;
  readonly activePullRequestId: string | null;
  readonly reviewedPullRequestIds: ReadonlySet<string>;
  readonly onSelectRepository: (repository: ReviewRepository) => void;
  readonly onSelectPullRequest: (
    repository: ReviewRepository,
    pullRequest: ReviewPullRequest,
  ) => void;
  readonly onToggleRepositoryHidden: (repository: ReviewRepository, hidden: boolean) => void;
  readonly onTogglePullRequestHidden: (
    repository: ReviewRepository,
    pullRequest: ReviewPullRequest,
    hidden: boolean,
  ) => void;
}) {
  const expanded = useUiStateStore((state) => state.reviewOwnerGroupExpandedById[group.id] ?? true);
  const toggleOwnerGroup = useUiStateStore((state) => state.toggleReviewOwnerGroup);
  const visibleRepositories = useMemo(
    () => getVisibleReviewRepositories(group.repositories),
    [group.repositories],
  );
  const hiddenRepositories = useMemo(
    () => getHiddenReviewRepositories(group.repositories),
    [group.repositories],
  );

  return (
    <div className="mb-2 last:mb-0">
      <button
        type="button"
        className="mb-1 flex h-7 w-full cursor-pointer items-center gap-1 rounded-md px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50 outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => toggleOwnerGroup(group.id)}
      >
        <ChevronRightIcon
          className={`size-3 shrink-0 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
        />
        <span className="min-w-0 flex-1 truncate text-left">{group.title}</span>
        <span className="shrink-0">{group.repositories.length}</span>
      </button>
      {expanded ? (
        <SidebarMenu>
          {visibleRepositories.map((repository) => (
            <ReviewRepositoryRow
              key={repository.id}
              repository={repository}
              pullRequests={pullRequestsByRepositoryId.get(repository.id) ?? []}
              activeRepositoryId={activeRepositoryId}
              activePullRequestId={activePullRequestId}
              reviewedPullRequestIds={reviewedPullRequestIds}
              onSelectPullRequest={onSelectPullRequest}
              onToggleRepositoryHidden={onToggleRepositoryHidden}
              onTogglePullRequestHidden={onTogglePullRequestHidden}
            />
          ))}
          <ReviewHiddenSection
            id={ownerHiddenSectionId(group.id)}
            label="Hidden repositories"
            count={hiddenRepositories.length}
            itemKind="menu"
          >
            <SidebarMenu>
              {hiddenRepositories.map((repository) => (
                <HiddenRepositoryRow
                  key={repository.id}
                  repository={repository}
                  activeRepositoryId={activeRepositoryId}
                  onSelectRepository={onSelectRepository}
                  onToggleRepositoryHidden={onToggleRepositoryHidden}
                />
              ))}
            </SidebarMenu>
          </ReviewHiddenSection>
        </SidebarMenu>
      ) : null}
    </div>
  );
}

export function PeerReviewSidebarSection() {
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const { isMobile, setOpenMobile } = useSidebar();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const snapshot = useReviewAppStore((store) => store.snapshot);
  const selectRepository = useReviewAppStore((store) => store.selectRepository);
  const selectPullRequest = useReviewAppStore((store) => store.selectPullRequest);
  const collapseReviewItems = useUiStateStore((state) => state.collapseReviewItems);
  const [refreshing, setRefreshing] = useState(false);
  const refreshReviewInbox = useAtomCommand(reviewEnvironment.refreshInbox, {
    reportFailure: false,
  });
  const setRepositoryHidden = useAtomCommand(reviewEnvironment.setRepositoryHidden, {
    reportFailure: false,
  });
  const setPullRequestHidden = useAtomCommand(reviewEnvironment.setPullRequestHidden, {
    reportFailure: false,
  });
  const routePullRequestTarget = parseReviewPullRequestRouteTarget(params);
  const routePullRequestMatch = findReviewPullRequestRouteMatch(snapshot, routePullRequestTarget);
  const routeRepositoryTarget = parseReviewRepositoryRouteTarget(params);
  const routeRepositoryMatch =
    routePullRequestMatch?.repository ??
    findReviewRepositoryRouteMatch(snapshot, routeRepositoryTarget);
  const activeRepositoryId = routeRepositoryMatch?.id ?? null;
  const activePullRequestId = routePullRequestMatch?.pullRequest.id ?? null;
  const groups = snapshot?.groups ?? EMPTY_REVIEW_GROUPS;
  const repositories = useMemo(() => groups.flatMap((group) => group.repositories), [groups]);
  const repositoryById = useMemo(
    () => new Map(repositories.map((repository) => [repository.id, repository] as const)),
    [repositories],
  );
  const pullRequestsByRepositoryId = useMemo(() => {
    const next = new Map<string, ReviewPullRequest[]>();
    for (const pullRequest of snapshot?.pullRequests ?? []) {
      const existing = next.get(pullRequest.repositoryId);
      if (existing) {
        existing.push(pullRequest);
      } else {
        next.set(pullRequest.repositoryId, [pullRequest]);
      }
    }
    return next;
  }, [snapshot?.pullRequests]);
  const pinnedPullRequestItems = useMemo(
    () =>
      getVisiblePinnedReviewPullRequestItems({
        pullRequests: snapshot?.pullRequests ?? [],
        repositoryById,
      }),
    [repositoryById, snapshot?.pullRequests],
  );
  const reviewedPullRequestIds = useMemo(
    () =>
      new Set(
        (snapshot?.reviewRuns ?? [])
          .filter((run) => run.status === "completed" || run.status === "posted")
          .map((run) => run.pullRequestId),
      ),
    [snapshot?.reviewRuns],
  );

  const refresh = async () => {
    if (primaryEnvironmentId === null) return;
    setRefreshing(true);
    try {
      const next = unwrapCommandResult(
        await refreshReviewInbox(reviewTarget(primaryEnvironmentId, {})),
      );
      useReviewAppStore.getState().setSnapshot(next);
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to refresh peer review",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    } finally {
      setRefreshing(false);
    }
  };

  const collapseAll = () => {
    const hiddenSectionIds = [
      ...groups
        .filter((group) => getHiddenReviewRepositories(group.repositories).length > 0)
        .map((group) => ownerHiddenSectionId(group.id)),
      ...repositories
        .filter(
          (repository) =>
            getHiddenReviewPullRequests(pullRequestsByRepositoryId.get(repository.id) ?? [])
              .length > 0,
        )
        .map((repository) => repositoryHiddenSectionId(repository.id)),
    ];

    collapseReviewItems({
      ownerGroupIds: groups.map((group) => group.id),
      repositoryIds: repositories.map((repository) => repository.id),
      hiddenSectionIds,
    });
  };

  const selectRepositoryFromSidebar = (repository: ReviewRepository) => {
    selectRepository(repository.id);
    selectPullRequest(null);
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({
      to: "/review/github/$owner/$repo",
      params: buildReviewRepositoryRouteParams({ repository }),
    });
  };

  const selectPullRequestFromSidebar = (
    repository: ReviewRepository,
    pullRequest: ReviewPullRequest,
  ) => {
    selectRepository(repository.id);
    selectPullRequest(pullRequest.id);
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({
      to: "/review/github/$owner/$repo/pull/$number",
      params: buildReviewPullRequestRouteParams({ repository, pullRequest }),
    });
  };

  const toggleRepositoryHidden = async (repository: ReviewRepository, hidden: boolean) => {
    if (primaryEnvironmentId === null) return;
    try {
      const next = unwrapCommandResult(
        await setRepositoryHidden(
          reviewTarget(primaryEnvironmentId, {
            repositoryId: repository.id,
            hidden,
          }),
        ),
      );
      useReviewAppStore.getState().setSnapshot(next);
      if (hidden && activeRepositoryId === repository.id) {
        selectRepository(null);
        selectPullRequest(null);
        void navigate({ to: "/review" });
      }
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: hidden ? "Failed to hide repository" : "Failed to show repository",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    }
  };

  const togglePullRequestHidden = async (
    repository: ReviewRepository,
    pullRequest: ReviewPullRequest,
    hidden: boolean,
  ) => {
    if (primaryEnvironmentId === null) return;
    try {
      const next = unwrapCommandResult(
        await setPullRequestHidden(
          reviewTarget(primaryEnvironmentId, {
            pullRequestId: pullRequest.id,
            hidden,
          }),
        ),
      );
      useReviewAppStore.getState().setSnapshot(next);
      if (hidden && activePullRequestId === pullRequest.id) {
        selectRepository(repository.id);
        selectPullRequest(null);
        void navigate({
          to: "/review/github/$owner/$repo",
          params: buildReviewRepositoryRouteParams({ repository }),
        });
      }
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: hidden ? "Failed to hide pull request" : "Failed to show pull request",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    }
  };

  return (
    <SidebarGroup className="px-2 py-2">
      <div className="mb-1 flex items-center justify-between pl-2 pr-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          Peer Review
        </span>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="Collapse all peer review items"
                  className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                  onClick={collapseAll}
                />
              }
            >
              <ListCollapseIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="right">Collapse all peer review items</TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="Refresh peer review"
                  className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-50"
                  disabled={refreshing || primaryEnvironmentId === null}
                  onClick={() => void refresh()}
                />
              }
            >
              <RefreshCwIcon className={refreshing ? "size-3.5 animate-spin" : "size-3.5"} />
            </TooltipTrigger>
            <TooltipPopup side="right">Refresh peer review</TooltipPopup>
          </Tooltip>
        </div>
      </div>

      {pinnedPullRequestItems.length > 0 ? (
        <SidebarMenu className="mb-2">
          {pinnedPullRequestItems.map(({ repository, pullRequest }) => (
            <PinnedPullRequestRow
              key={pullRequest.id}
              pullRequest={pullRequest}
              repository={repository}
              isActive={pullRequest.id === activePullRequestId}
              reviewed={reviewedPullRequestIds.has(pullRequest.id)}
              onSelect={selectPullRequestFromSidebar}
            />
          ))}
        </SidebarMenu>
      ) : null}

      {groups.map((group) => (
        <ReviewOwnerGroup
          key={group.id}
          group={group}
          pullRequestsByRepositoryId={pullRequestsByRepositoryId}
          activeRepositoryId={activeRepositoryId}
          activePullRequestId={activePullRequestId}
          reviewedPullRequestIds={reviewedPullRequestIds}
          onSelectRepository={selectRepositoryFromSidebar}
          onSelectPullRequest={selectPullRequestFromSidebar}
          onToggleRepositoryHidden={(repository, hidden) => {
            void toggleRepositoryHidden(repository, hidden);
          }}
          onTogglePullRequestHidden={(repository, pullRequest, hidden) => {
            void togglePullRequestHidden(repository, pullRequest, hidden);
          }}
        />
      ))}

      {repositories.length === 0 ? (
        <div className="px-2 pt-4 text-center text-xs text-muted-foreground/60">
          No Repositories yet
        </div>
      ) : null}
    </SidebarGroup>
  );
}
