import { GitPullRequestIcon, RefreshCwIcon, StarIcon } from "lucide-react";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";

import { useReviewAppStore } from "../../reviewAppStore";
import { reviewEnvironment } from "../../state/review";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../ui/sidebar";

const COLLAPSED_REPO_LIMIT = 10;

export function ReviewDataSubscription() {
  const primaryEnvironmentId = usePrimaryEnvironmentId();

  if (primaryEnvironmentId === null) return null;

  return <ReviewEnvironmentDataSubscription environmentId={primaryEnvironmentId} />;
}

function ReviewEnvironmentDataSubscription({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const setSnapshot = useReviewAppStore((store) => store.setSnapshot);
  const snapshotResult = useAtomValue(reviewEnvironment.snapshot({ environmentId, input: {} }));
  const streamedSnapshotResult = useAtomValue(
    reviewEnvironment.snapshots({ environmentId, input: {} }),
  );

  useEffect(() => {
    const snapshot =
      Option.getOrNull(AsyncResult.value(streamedSnapshotResult)) ??
      Option.getOrNull(AsyncResult.value(snapshotResult));
    if (snapshot !== null) {
      setSnapshot(snapshot);
    }
  }, [setSnapshot, snapshotResult, streamedSnapshotResult]);

  return null;
}

export function ReviewSidebar() {
  const navigate = useNavigate();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const snapshot = useReviewAppStore((store) => store.snapshot);
  const selectedRepositoryId = useReviewAppStore((store) => store.selectedRepositoryId);
  const selectRepository = useReviewAppStore((store) => store.selectRepository);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [refreshing, setRefreshing] = useState(false);
  const refreshInbox = useAtomCommand(reviewEnvironment.refreshInbox, { reportFailure: false });
  const recordInteraction = useAtomCommand(reviewEnvironment.recordInteraction, {
    reportFailure: false,
  });

  const groups = useMemo(() => snapshot?.groups ?? [], [snapshot]);

  const refresh = async () => {
    if (primaryEnvironmentId === null) return;
    setRefreshing(true);
    try {
      const result = await refreshInbox({ environmentId: primaryEnvironmentId, input: {} });
      if (result._tag === "Success") {
        useReviewAppStore.getState().setSnapshot(result.value);
      }
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <>
      <ReviewDataSubscription />
      <SidebarHeader className="border-b border-border/70 px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold tracking-[-0.01em]">Peer Review</div>
            <div className="text-xs text-muted-foreground">GitHub PR inbox</div>
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            <RefreshCwIcon className={refreshing ? "size-3.5 animate-spin" : "size-3.5"} />
          </Button>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="mt-3 w-full justify-start"
          onClick={() => void navigate({ to: "/review" })}
        >
          <GitPullRequestIcon className="size-4" />
          Open review workspace
        </Button>
      </SidebarHeader>
      <SidebarContent className="gap-3 px-2 py-3">
        {groups.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            Connect GitHub with OAuth, then refresh to sync repositories with open pull requests.
          </div>
        ) : null}
        {groups.map((group) => {
          const expanded = expandedGroups[group.id] ?? false;
          const visibleRepos = expanded
            ? group.repositories
            : group.repositories.slice(0, COLLAPSED_REPO_LIMIT);
          return (
            <div key={group.id} className="space-y-1">
              <div className="flex items-center justify-between px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span>{group.title}</span>
                <span>{group.repositories.length}</span>
              </div>
              <SidebarMenu>
                {visibleRepos.map((repo) => (
                  <SidebarMenuItem key={repo.id}>
                    <SidebarMenuButton
                      isActive={repo.id === selectedRepositoryId}
                      onClick={() => {
                        selectRepository(repo.id);
                        if (primaryEnvironmentId !== null) {
                          void recordInteraction({
                            environmentId: primaryEnvironmentId,
                            input: { repositoryId: repo.id },
                          });
                        }
                        void navigate({ to: "/review" });
                      }}
                    >
                      {repo.pinned ? <StarIcon className="size-3.5 fill-current" /> : null}
                      <span className="truncate">{repo.name}</span>
                      <Badge size="sm" variant="secondary" className="ml-auto">
                        {repo.openPullRequestCount}
                      </Badge>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
              {group.repositories.length > COLLAPSED_REPO_LIMIT ? (
                <Button
                  size="xs"
                  variant="ghost"
                  className="ml-1 text-xs"
                  onClick={() =>
                    setExpandedGroups((current) => ({ ...current, [group.id]: !expanded }))
                  }
                >
                  {expanded
                    ? "Show fewer"
                    : `More (${group.repositories.length - COLLAPSED_REPO_LIMIT})`}
                </Button>
              ) : null}
            </div>
          );
        })}
      </SidebarContent>
      <SidebarFooter className="border-t border-border/70 p-3 text-xs text-muted-foreground">
        {snapshot?.github.status === "connected" && snapshot.github.user ? (
          <span>Posting reviews as {snapshot.github.user.login}</span>
        ) : (
          <span>GitHub OAuth not connected</span>
        )}
      </SidebarFooter>
    </>
  );
}
