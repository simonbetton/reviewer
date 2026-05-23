import {
  type AtomCommandResult,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  CheckCircle2Icon,
  ExternalLinkIcon,
  GitPullRequestIcon,
  PlugIcon,
  ShieldCheckIcon,
  StarIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { EnvironmentId, ReviewCategory } from "@t3tools/contracts";

import { useReviewAppStore } from "../../reviewAppStore";
import { reviewEnvironment } from "../../state/review";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";

const DEFAULT_RUN_CATEGORIES: ReviewCategory[] = ["risk", "security", "ux", "tests"];

function unwrapCommandResult<A, E>(result: AtomCommandResult<A, E>): A {
  if (result._tag === "Success") {
    return result.value;
  }
  throw squashAtomCommandFailure(result);
}

function reviewTarget<TInput>(environmentId: EnvironmentId, input: TInput) {
  return { environmentId, input };
}

function EmptyState() {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const [oauth, setOauth] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const beginGitHubOAuth = useAtomCommand(reviewEnvironment.beginGitHubOAuth, {
    reportFailure: false,
  });

  const beginOAuth = async () => {
    if (primaryEnvironmentId === null) return;
    setPending(true);
    try {
      const result = unwrapCommandResult(
        await beginGitHubOAuth(reviewTarget(primaryEnvironmentId, {})),
      );
      if (result.status === "not_configured") {
        setOauth(result.detail ?? "GitHub OAuth is not configured.");
        return;
      }
      setOauth(
        result.userCode && result.verificationUri
          ? `Open ${result.verificationUri} and enter code ${result.userCode}.`
          : result.detail,
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <div className="rounded-full border border-border bg-card p-4">
        <GitPullRequestIcon className="size-8 text-muted-foreground" />
      </div>
      <div>
        <h1 className="text-xl font-semibold tracking-[-0.02em]">
          Connect GitHub to start peer review
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          GitHub is installed as an OAuth-backed integration. Once connected, this app syncs
          personal and organization repositories with open PRs and posts approved agent reviews as
          you.
        </p>
      </div>
      <Button disabled={pending} onClick={() => void beginOAuth()}>
        <PlugIcon className="size-4" />
        Start GitHub OAuth
      </Button>
      {oauth ? (
        <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          {oauth}
        </div>
      ) : null}
    </div>
  );
}

export default function ReviewWorkspace() {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const snapshot = useReviewAppStore((store) => store.snapshot);
  const selectedRepositoryId = useReviewAppStore((store) => store.selectedRepositoryId);
  const selectedPullRequestId = useReviewAppStore((store) => store.selectedPullRequestId);
  const selectPullRequest = useReviewAppStore((store) => store.selectPullRequest);
  const [installSpec, setInstallSpec] = useState("");
  const [mcpName, setMcpName] = useState("");
  const [mcpCommand, setMcpCommand] = useState("");
  const [runningReview, setRunningReview] = useState(false);
  const setRepositoryPinned = useAtomCommand(reviewEnvironment.setRepositoryPinned, {
    reportFailure: false,
  });
  const setPullRequestPinned = useAtomCommand(reviewEnvironment.setPullRequestPinned, {
    reportFailure: false,
  });
  const startRun = useAtomCommand(reviewEnvironment.startRun, { reportFailure: false });
  const submitReviewRun = useAtomCommand(reviewEnvironment.submitRun, { reportFailure: false });
  const installReviewSkill = useAtomCommand(reviewEnvironment.installSkill, {
    reportFailure: false,
  });
  const upsertMcpConnection = useAtomCommand(reviewEnvironment.upsertMcpConnection, {
    reportFailure: false,
  });
  const refreshInbox = useAtomCommand(reviewEnvironment.refreshInbox, { reportFailure: false });
  const recordInteraction = useAtomCommand(reviewEnvironment.recordInteraction, {
    reportFailure: false,
  });

  const repository = useMemo(
    () =>
      snapshot?.groups
        .flatMap((group) => group.repositories)
        .find((repo) => repo.id === selectedRepositoryId),
    [selectedRepositoryId, snapshot],
  );
  const pullRequests = useMemo(
    () =>
      snapshot?.pullRequests.filter(
        (pullRequest) => pullRequest.repositoryId === selectedRepositoryId,
      ) ?? [],
    [selectedRepositoryId, snapshot],
  );
  const selectedPullRequest =
    pullRequests.find((pullRequest) => pullRequest.id === selectedPullRequestId) ??
    pullRequests[0] ??
    null;
  const latestRun = snapshot?.reviewRuns.find(
    (run) => run.pullRequestId === selectedPullRequest?.id,
  );
  const enabledSkills = snapshot?.skills.filter((skill) => skill.enabled) ?? [];

  const pinRepository = async () => {
    if (primaryEnvironmentId === null || !repository) return;
    const next = unwrapCommandResult(
      await setRepositoryPinned(
        reviewTarget(primaryEnvironmentId, {
          repositoryId: repository.id,
          pinned: !repository.pinned,
        }),
      ),
    );
    useReviewAppStore.getState().setSnapshot(next);
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

  const runReview = async () => {
    if (primaryEnvironmentId === null || !selectedPullRequest) return;
    setRunningReview(true);
    try {
      const run = unwrapCommandResult(
        await startRun(
          reviewTarget(primaryEnvironmentId, {
            pullRequestId: selectedPullRequest.id,
            categories: DEFAULT_RUN_CATEGORIES,
            skillIds: enabledSkills.map((skill) => skill.id),
            mcpConnectionIds:
              snapshot?.mcpConnections
                .filter((connection) => connection.enabled && connection.trusted)
                .map((connection) => connection.id) ?? [],
          }),
        ),
      );
      const next = unwrapCommandResult(await refreshInbox(reviewTarget(primaryEnvironmentId, {})));
      useReviewAppStore.getState().setSnapshot({
        ...next,
        reviewRuns: [run, ...next.reviewRuns.filter((existing) => existing.id !== run.id)],
      });
    } finally {
      setRunningReview(false);
    }
  };

  const submitRun = async () => {
    if (primaryEnvironmentId === null || !latestRun) return;
    await submitReviewRun(reviewTarget(primaryEnvironmentId, { runId: latestRun.id }));
    const next = unwrapCommandResult(await refreshInbox(reviewTarget(primaryEnvironmentId, {})));
    useReviewAppStore.getState().setSnapshot(next);
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
    await upsertMcpConnection(
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
      .setSnapshot(unwrapCommandResult(await refreshInbox(reviewTarget(primaryEnvironmentId, {}))));
  };

  if (!snapshot || snapshot.groups.length === 0) {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-auto bg-background text-foreground">
        <EmptyState />
      </SidebarInset>
    );
  }

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <div className="grid h-full min-h-0 grid-cols-[minmax(22rem,32rem)_minmax(28rem,1fr)]">
        <section className="min-h-0 overflow-auto border-r border-border">
          <header className="sticky top-0 z-10 border-b border-border bg-background/95 px-5 py-4 backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {repository?.nameWithOwner ?? "Repository"}
                </div>
                <h1 className="mt-1 text-xl font-semibold tracking-[-0.02em]">
                  Open pull requests
                </h1>
              </div>
              {repository ? (
                <Button size="sm" variant="outline" onClick={() => void pinRepository()}>
                  <StarIcon className={repository.pinned ? "size-4 fill-current" : "size-4"} />
                  {repository.pinned ? "Pinned" : "Pin repo"}
                </Button>
              ) : null}
            </div>
          </header>
          <div className="divide-y divide-border/70">
            {pullRequests.map((pullRequest) => (
              <button
                type="button"
                key={pullRequest.id}
                className={
                  pullRequest.id === selectedPullRequest?.id
                    ? "block w-full bg-muted/60 px-5 py-4 text-left"
                    : "block w-full px-5 py-4 text-left hover:bg-muted/40"
                }
                onClick={() => {
                  selectPullRequest(pullRequest.id);
                  if (primaryEnvironmentId !== null) {
                    void recordInteraction(
                      reviewTarget(primaryEnvironmentId, {
                        repositoryId: pullRequest.repositoryId,
                        pullRequestId: pullRequest.id,
                      }),
                    );
                  }
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      #{pullRequest.number} {pullRequest.title}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>{pullRequest.authorLogin}</span>
                      <span>
                        {pullRequest.headRefName} {"->"} {pullRequest.baseRefName}
                      </span>
                    </div>
                  </div>
                  {pullRequest.pinned ? (
                    <StarIcon className="size-4 shrink-0 fill-current" />
                  ) : null}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge size="sm" variant={pullRequest.draft ? "warning" : "secondary"}>
                    {pullRequest.draft ? "Draft" : "Open"}
                  </Badge>
                  <Badge size="sm" variant="secondary">
                    {pullRequest.commentCount} comments
                  </Badge>
                  {snapshot.reviewRuns.some((run) => run.pullRequestId === pullRequest.id) ? (
                    <Badge size="sm" variant="success">
                      Agent reviewed
                    </Badge>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        </section>

        <aside className="min-h-0 overflow-auto">
          {selectedPullRequest ? (
            <div className="space-y-6 p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <GitPullRequestIcon className="size-4" />
                    PR #{selectedPullRequest.number}
                  </div>
                  <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
                    {selectedPullRequest.title}
                  </h2>
                  <a
                    href={selectedPullRequest.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                  >
                    Open on GitHub <ExternalLinkIcon className="size-3.5" />
                  </a>
                </div>
                <Button size="sm" variant="outline" onClick={() => void pinPullRequest()}>
                  <StarIcon
                    className={selectedPullRequest.pinned ? "size-4 fill-current" : "size-4"}
                  />
                  {selectedPullRequest.pinned ? "Pinned" : "Pin PR"}
                </Button>
              </div>

              <section className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">Agent review</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Runs selected default and installed skills with trusted MCP connections.
                      Findings stay local until submitted as the connected GitHub user.
                    </p>
                  </div>
                  <Button disabled={runningReview} onClick={() => void runReview()}>
                    <ShieldCheckIcon className="size-4" />
                    {runningReview ? "Running..." : "Run review"}
                  </Button>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {DEFAULT_RUN_CATEGORIES.map((category) => (
                    <Badge key={category} size="sm" variant="secondary">
                      {category}
                    </Badge>
                  ))}
                </div>
              </section>

              {latestRun ? (
                <section className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">Latest review run</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{latestRun.summary}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={latestRun.status === "posted"}
                      onClick={() => void submitRun()}
                    >
                      <CheckCircle2Icon className="size-4" />
                      {latestRun.status === "posted"
                        ? `Posted as ${latestRun.postedByGitHubUserLogin}`
                        : "Submit as GitHub user"}
                    </Button>
                  </div>
                  <div className="mt-4 space-y-3">
                    {latestRun.findings.map((finding) => (
                      <div key={finding.id} className="rounded-lg border border-border/70 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            size="sm"
                            variant={finding.severity === "major" ? "warning" : "secondary"}
                          >
                            {finding.severity}
                          </Badge>
                          <span className="text-sm font-medium">{finding.title}</span>
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">{finding.explanation}</p>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-border bg-card p-4">
                  <h3 className="font-semibold">Install skills</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    User-installed skills sit alongside app defaults and can be included in reviews.
                  </p>
                  <div className="mt-4 flex gap-2">
                    <input
                      value={installSpec}
                      onChange={(event) => setInstallSpec(event.target.value)}
                      placeholder="@company/review-skills"
                      className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                    <Button size="sm" onClick={() => void installSkill()}>
                      npx skills
                    </Button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {enabledSkills.slice(0, 8).map((skill) => (
                      <Badge
                        key={skill.id}
                        size="sm"
                        variant={skill.source === "default" ? "secondary" : "success"}
                      >
                        {skill.name}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-card p-4">
                  <h3 className="font-semibold">MCP connections</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Trusted MCP connections can be granted to review runs for richer context.
                  </p>
                  <div className="mt-4 grid gap-2">
                    <input
                      value={mcpName}
                      onChange={(event) => setMcpName(event.target.value)}
                      placeholder="GitHub MCP"
                      className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                    <div className="flex gap-2">
                      <input
                        value={mcpCommand}
                        onChange={(event) => setMcpCommand(event.target.value)}
                        placeholder="npx @modelcontextprotocol/server-github"
                        className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                      />
                      <Button size="sm" onClick={() => void addMcpConnection()}>
                        Add
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {snapshot.mcpConnections.map((connection) => (
                      <Badge
                        key={connection.id}
                        size="sm"
                        variant={connection.trusted ? "success" : "warning"}
                      >
                        {connection.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          ) : (
            <div className="p-8 text-sm text-muted-foreground">Select a pull request.</div>
          )}
        </aside>
      </div>
    </SidebarInset>
  );
}
