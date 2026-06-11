import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { createModelSelection } from "@t3tools/shared/model";
import { ProviderInstanceId, TextGenerationError } from "@t3tools/contracts";

import { ServerSecretStore, layer as ServerSecretStoreLive } from "../auth/ServerSecretStore.ts";
import { ServerConfig } from "../config.ts";
import {
  findJsonSchemaMissingRequiredPropertyPaths,
  toJsonSchemaObject,
} from "../textGeneration/TextGenerationUtils.ts";
import {
  type StructuredTextGenerationInput,
  type TextGenerationShape,
} from "../textGeneration/TextGeneration.ts";
import * as ReviewWorkspace from "./ReviewWorkspace.ts";

const textEncoder = new TextEncoder();
const githubTokenSecretName = "review-github-oauth-token";
const defaultModelSelection = createModelSelection(
  ProviderInstanceId.make("codex"),
  "gpt-5.4-mini",
);

const makeReviewWorkspaceTestServicesLayer = (baseDir: string) => {
  const serverConfigLayer = Layer.fresh(
    ServerConfig.layerTest(process.cwd(), baseDir).pipe(Layer.provide(NodeServices.layer)),
  );
  return Layer.mergeAll(
    serverConfigLayer,
    ServerSecretStoreLive.pipe(Layer.provide(serverConfigLayer)),
  );
};

const provideReviewWorkspaceTestServices =
  (baseDir: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.provide(makeReviewWorkspaceTestServicesLayer(baseDir)));

function jsonResponse(value: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}

function makeStructuredTextGeneration(
  generateStructured: (
    input: StructuredTextGenerationInput<Schema.Top>,
  ) => Effect.Effect<unknown, TextGenerationError>,
): TextGenerationShape {
  return {
    generateCommitMessage: () => Effect.die("generateCommitMessage should not be called"),
    generatePrContent: () => Effect.die("generatePrContent should not be called"),
    generateBranchName: () => Effect.die("generateBranchName should not be called"),
    generateThreadTitle: () => Effect.die("generateThreadTitle should not be called"),
    generateStructured: <S extends Schema.Top>(input: StructuredTextGenerationInput<S>) =>
      generateStructured(input as StructuredTextGenerationInput<Schema.Top>) as Effect.Effect<
        S["Type"],
        TextGenerationError,
        S["DecodingServices"]
      >,
  };
}

function installReviewRunGitHubFetchMock() {
  const originalFetch = globalThis.fetch;
  const fetchMock = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url === "https://api.github.com/user") {
      return jsonResponse(
        {
          id: 1,
          login: "octocat",
          name: "Octo Cat",
          avatar_url: "https://github.com/images/error/octocat_happy.gif",
          html_url: "https://github.com/octocat",
        },
        { "x-oauth-scopes": "repo, read:org" },
      );
    }

    if (url.startsWith("https://api.github.com/user/repos?")) {
      return jsonResponse([
        {
          full_name: "octocat/reviewer",
          html_url: "https://github.com/octocat/reviewer",
          owner: { type: "User" },
          pushed_at: "2026-01-02T00:00:00.000Z",
        },
      ]);
    }

    if (url.startsWith("https://api.github.com/repos/octocat/reviewer/pulls?")) {
      return jsonResponse([
        {
          number: 1,
          title: "Improve provider review",
          html_url: "https://github.com/octocat/reviewer/pull/1",
          user: { login: "contrib" },
          base: { ref: "main" },
          head: { ref: "feature/review", sha: "head-1" },
          draft: false,
          comments: 0,
          review_comments: 0,
          updated_at: "2026-01-03T00:00:00.000Z",
        },
      ]);
    }

    if (url === "https://api.github.com/repos/octocat/reviewer/pulls/1/files?per_page=100") {
      return jsonResponse([
        {
          filename: "apps/server/src/review/ReviewWorkspace.ts",
          status: "modified",
          additions: 1,
          deletions: 0,
          changes: 1,
          patch: "@@ -8,1 +8,2 @@\n+export const review = true;",
        },
      ]);
    }

    if (url === "https://api.github.com/repos/octocat/reviewer/pulls/1") {
      return jsonResponse({
        number: 1,
        title: "Improve provider review",
        html_url: "https://github.com/octocat/reviewer/pull/1",
        user: { login: "contrib" },
        base: { ref: "main" },
        head: { ref: "feature/review", sha: "head-1" },
        draft: false,
        comments: 0,
        review_comments: 0,
        additions: 1,
        deletions: 0,
        changed_files: 1,
        updated_at: "2026-01-03T00:00:00.000Z",
      });
    }

    if (url === "https://api.github.com/repos/octocat/reviewer/pulls/1/reviews?per_page=100") {
      return jsonResponse([]);
    }

    if (url === "https://api.github.com/repos/octocat/reviewer/pulls/1/comments?per_page=100") {
      return jsonResponse([]);
    }

    throw new Error(`Unexpected GitHub URL ${url}; body=${String(init?.body ?? "")}`);
  };

  globalThis.fetch = Object.assign(fetchMock, {
    preconnect: originalFetch.preconnect,
  }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

it.layer(NodeServices.layer)("ReviewWorkspace", (it) => {
  it.effect("uses Codex-compatible strict schemas for provider review outputs", () =>
    Effect.sync(() => {
      const missingRequiredPaths = [
        ...findJsonSchemaMissingRequiredPropertyPaths(
          toJsonSchemaObject(ReviewWorkspace.ReviewAgentRunOutput),
        ).map((path) => `run.${path}`),
        ...findJsonSchemaMissingRequiredPropertyPaths(
          toJsonSchemaObject(ReviewWorkspace.ReviewAgentChatOutput),
        ).map((path) => `chat.${path}`),
      ];

      expect(missingRequiredPaths).toEqual([]);
    }),
  );

  it.effect("persists workspace state across service restarts", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-review-workspace-test-",
      });

      yield* Effect.gen(function* () {
        const first = yield* ReviewWorkspace.make();
        const saved = yield* first.upsertMcpConnection({
          name: "GitHub MCP",
          command: "npx",
          args: ["@modelcontextprotocol/server-github"],
          trusted: true,
          enabled: true,
        });

        const second = yield* ReviewWorkspace.make();
        const snapshot = yield* second.getSnapshot;

        expect(snapshot.mcpConnections).toEqual([saved]);
      }).pipe(provideReviewWorkspaceTestServices(baseDir));
    }),
  );

  it.effect("loads a persisted GitHub OAuth token for inbox refresh", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-review-workspace-token-test-",
      });
      const authHeaders: string[] = [];
      const originalFetch = globalThis.fetch;
      const fetchMock = async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        authHeaders.push(new Headers(init?.headers).get("authorization") ?? "");

        if (url === "https://api.github.com/user") {
          return jsonResponse(
            {
              id: 1,
              login: "octocat",
              name: "Octo Cat",
              avatar_url: "https://github.com/images/error/octocat_happy.gif",
              html_url: "https://github.com/octocat",
            },
            { "x-oauth-scopes": "repo, read:org" },
          );
        }

        if (url.startsWith("https://api.github.com/user/repos?")) {
          return jsonResponse([
            {
              full_name: "octocat/reviewer",
              html_url: "https://github.com/octocat/reviewer",
              owner: { type: "User" },
              pushed_at: "2026-01-02T00:00:00.000Z",
            },
          ]);
        }

        if (url.startsWith("https://api.github.com/repos/octocat/reviewer/pulls?")) {
          return jsonResponse([
            {
              number: 1,
              title: "Improve review inbox",
              html_url: "https://github.com/octocat/reviewer/pull/1",
              user: { login: "contrib" },
              base: { ref: "main" },
              head: { ref: "feature/review", sha: "head-1" },
              draft: false,
              comments: 1,
              review_comments: 2,
              updated_at: "2026-01-03T00:00:00.000Z",
            },
          ]);
        }

        throw new Error(`Unexpected GitHub URL ${url}`);
      };
      globalThis.fetch = Object.assign(fetchMock, {
        preconnect: originalFetch.preconnect,
      }) as typeof fetch;

      try {
        yield* Effect.gen(function* () {
          const secretStore = yield* ServerSecretStore;
          yield* secretStore.set(githubTokenSecretName, textEncoder.encode("persisted-token"));

          const workspace = yield* ReviewWorkspace.make();
          const snapshot = yield* workspace.refreshInbox;

          expect(snapshot.github.status).toBe("connected");
          expect(snapshot.github.user?.login).toBe("octocat");
          expect(snapshot.pullRequests.map((pullRequest) => pullRequest.title)).toEqual([
            "Improve review inbox",
          ]);
          expect(snapshot.groups[0]?.repositories[0]?.hidden).toBe(false);
          expect(snapshot.pullRequests[0]?.hidden).toBe(false);
          expect(authHeaders.every((header) => header === "Bearer persisted-token")).toBe(true);

          const repositoryId = snapshot.groups[0]!.repositories[0]!.id;
          const pullRequestId = snapshot.pullRequests[0]!.id;
          const hiddenSnapshot = yield* workspace
            .setRepositoryHidden({
              repositoryId,
              hidden: true,
            })
            .pipe(
              Effect.flatMap(() =>
                workspace.setPullRequestPinned({
                  pullRequestId,
                  pinned: true,
                }),
              ),
              Effect.flatMap(() =>
                workspace.setPullRequestHidden({
                  pullRequestId,
                  hidden: true,
                }),
              ),
            );
          expect(hiddenSnapshot.groups[0]?.repositories[0]?.hidden).toBe(true);
          expect(hiddenSnapshot.pullRequests[0]?.pinned).toBe(true);
          expect(hiddenSnapshot.pullRequests[0]?.hidden).toBe(true);

          const refreshedSnapshot = yield* workspace.refreshInbox;
          expect(refreshedSnapshot.groups[0]?.repositories[0]?.hidden).toBe(true);
          expect(refreshedSnapshot.pullRequests[0]?.pinned).toBe(true);
          expect(refreshedSnapshot.pullRequests[0]?.hidden).toBe(true);
        }).pipe(provideReviewWorkspaceTestServices(baseDir));
      } finally {
        globalThis.fetch = originalFetch;
      }
    }),
  );

  it.effect("reviews real pull request files and posts a GitHub review", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-review-workspace-submit-test-",
      });
      const reviewPayloads: string[] = [];
      const originalFetch = globalThis.fetch;
      const fetchMock = async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

        if (url === "https://api.github.com/user") {
          return jsonResponse(
            {
              id: 1,
              login: "octocat",
              name: "Octo Cat",
              avatar_url: "https://github.com/images/error/octocat_happy.gif",
              html_url: "https://github.com/octocat",
            },
            { "x-oauth-scopes": "repo, read:org" },
          );
        }

        if (url.startsWith("https://api.github.com/user/repos?")) {
          return jsonResponse([
            {
              full_name: "octocat/reviewer",
              html_url: "https://github.com/octocat/reviewer",
              owner: { type: "User" },
              pushed_at: "2026-01-02T00:00:00.000Z",
            },
          ]);
        }

        if (url.startsWith("https://api.github.com/repos/octocat/reviewer/pulls?")) {
          return jsonResponse([
            {
              number: 1,
              title: "Improve review posting",
              html_url: "https://github.com/octocat/reviewer/pull/1",
              user: { login: "contrib" },
              base: { ref: "main" },
              head: { ref: "feature/review", sha: "head-1" },
              draft: false,
              comments: 0,
              review_comments: 0,
              updated_at: "2026-01-03T00:00:00.000Z",
            },
          ]);
        }

        if (url === "https://api.github.com/repos/octocat/reviewer/pulls/1/files?per_page=100") {
          return jsonResponse([
            {
              filename: "apps/server/src/auth/session.ts",
              status: "modified",
              additions: 12,
              deletions: 2,
              changes: 14,
              patch: "@@ -4,1 +4,2 @@\n+const token = process.env.AUTH_TOKEN;",
            },
            {
              filename: "apps/server/src/review/ReviewWorkspace.ts",
              status: "modified",
              additions: 30,
              deletions: 4,
              changes: 34,
              patch: "@@ -8,1 +8,2 @@\n+export const review = true;",
            },
          ]);
        }

        if (url === "https://api.github.com/repos/octocat/reviewer/pulls/1") {
          return jsonResponse({
            number: 1,
            title: "Improve review posting",
            html_url: "https://github.com/octocat/reviewer/pull/1",
            user: { login: "contrib" },
            base: { ref: "main" },
            head: { ref: "feature/review", sha: "head-1" },
            draft: false,
            comments: 0,
            review_comments: 0,
            additions: 42,
            deletions: 6,
            changed_files: 2,
            updated_at: "2026-01-03T00:00:00.000Z",
          });
        }

        if (url === "https://api.github.com/repos/octocat/reviewer/pulls/1/reviews?per_page=100") {
          return jsonResponse([
            {
              id: 7,
              body: "Existing human review",
              state: "COMMENTED",
              user: { login: "human" },
              submitted_at: "2026-01-03T00:05:00.000Z",
              html_url: "https://github.com/octocat/reviewer/pull/1#pullrequestreview-7",
            },
          ]);
        }

        if (url === "https://api.github.com/repos/octocat/reviewer/pulls/1/comments?per_page=100") {
          return jsonResponse([
            {
              id: 8,
              pull_request_review_id: 7,
              body: "Existing inline comment",
              path: "apps/server/src/auth/session.ts",
              line: 4,
              side: "RIGHT",
              user: { login: "human" },
              created_at: "2026-01-03T00:06:00.000Z",
              updated_at: "2026-01-03T00:06:00.000Z",
              html_url: "https://github.com/octocat/reviewer/pull/1#discussion_r8",
            },
          ]);
        }

        if (url === "https://api.github.com/repos/octocat/reviewer/pulls/1/reviews") {
          reviewPayloads.push(String(init?.body ?? ""));
          return jsonResponse({ id: 42 });
        }

        throw new Error(`Unexpected GitHub URL ${url}`);
      };
      globalThis.fetch = Object.assign(fetchMock, {
        preconnect: originalFetch.preconnect,
      }) as typeof fetch;

      try {
        yield* Effect.gen(function* () {
          const secretStore = yield* ServerSecretStore;
          yield* secretStore.set(githubTokenSecretName, textEncoder.encode("persisted-token"));

          const workspace = yield* ReviewWorkspace.make();
          const snapshot = yield* workspace.refreshInbox;
          const pullRequest = snapshot.pullRequests[0];
          expect(pullRequest?.id).toBe("github:octocat/reviewer#1");

          const run = yield* workspace.startRun({
            pullRequestId: pullRequest!.id,
            categories: ["risk", "security", "tests"],
            skillIds: [],
            mcpConnectionIds: [],
          });
          expect(run.summary).toContain("Reviewed 2 changed files");
          expect(run.headSha).toBe("head-1");
          expect(run.summaryDraftId).toBe(`${run.id}:summary`);
          expect(run.commentDraftIds.length).toBeGreaterThan(0);
          expect(run.findings.map((finding) => finding.category)).toContain("security");
          expect(run.findings.map((finding) => finding.category)).toContain("tests");

          const detailSnapshot = yield* workspace.getSnapshot;
          const detail = detailSnapshot.pullRequestDetails.find(
            (entry) => entry.pullRequestId === pullRequest!.id,
          );
          expect(detail?.codeBlocks.length).toBeGreaterThan(0);
          expect(detail?.githubReviews[0]?.authorLogin).toBe("human");
          expect(detail?.githubReviewComments[0]?.body).toBe("Existing inline comment");

          const postedRun = yield* workspace.submitRun({
            runId: run.id,
            event: "REQUEST_CHANGES",
          });
          expect(postedRun.status).toBe("posted");
          expect(reviewPayloads).toHaveLength(1);
          expect(reviewPayloads[0]).toContain('"event":"REQUEST_CHANGES"');
          expect(reviewPayloads[0]).toContain('"commit_id":"head-1"');
          expect(reviewPayloads[0]).toContain('"comments"');
          expect(reviewPayloads[0]).toContain("apps/server/src/auth/session.ts");
        }).pipe(provideReviewWorkspaceTestServices(baseDir));
      } finally {
        globalThis.fetch = originalFetch;
      }
    }),
  );

  it.effect("creates review drafts from provider output with required nullable fields", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-review-workspace-provider-test-",
      });
      const restoreFetch = installReviewRunGitHubFetchMock();
      const textGeneration = makeStructuredTextGeneration(() =>
        Effect.succeed({
          summary: "Provider summary for the pull request.",
          comments: [
            {
              path: "apps/server/src/review/ReviewWorkspace.ts",
              line: 8,
              side: null,
              startLine: null,
              startSide: null,
              category: null,
              severity: null,
              confidence: null,
              title: "Validate generated review output",
              explanation: "The provider output should become a local draft.",
              body: "Please verify this generated review path before merging.",
              suggestedFix: null,
            },
          ],
        }),
      );

      try {
        yield* Effect.gen(function* () {
          const secretStore = yield* ServerSecretStore;
          yield* secretStore.set(githubTokenSecretName, textEncoder.encode("persisted-token"));

          const workspace = yield* ReviewWorkspace.make({ textGeneration });
          const snapshot = yield* workspace.refreshInbox;
          const pullRequest = snapshot.pullRequests[0];
          expect(pullRequest?.id).toBe("github:octocat/reviewer#1");

          const run = yield* workspace.startRun({
            pullRequestId: pullRequest!.id,
            categories: ["security"],
            skillIds: [],
            mcpConnectionIds: [],
            modelSelection: defaultModelSelection,
          });

          expect(run.summary).toBe("Provider summary for the pull request.");
          expect(run.findings).toHaveLength(1);
          expect(run.findings[0]?.category).toBe("security");
          expect(run.findings[0]?.severity).toBe("minor");
          expect(run.findings[0]?.confidence).toBe(80);
          expect(run.commentDraftIds).toHaveLength(1);

          const detail = (yield* workspace.getSnapshot).pullRequestDetails.find(
            (entry) => entry.pullRequestId === pullRequest!.id,
          );
          expect(detail?.summaryDrafts[0]?.body).toBe("Provider summary for the pull request.");
          expect(detail?.commentDrafts[0]?.body).toBe(
            "Please verify this generated review path before merging.",
          );
          expect(detail?.commentDrafts[0]?.side).toBe("RIGHT");
          expect(detail?.commentDrafts[0]?.line).toBe(8);
        }).pipe(provideReviewWorkspaceTestServices(baseDir));
      } finally {
        restoreFetch();
      }
    }),
  );

  it.effect("deletes summary drafts and blocks submitting the affected run", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-review-workspace-delete-summary-test-",
      });
      const restoreFetch = installReviewRunGitHubFetchMock();

      try {
        yield* Effect.gen(function* () {
          const secretStore = yield* ServerSecretStore;
          yield* secretStore.set(githubTokenSecretName, textEncoder.encode("persisted-token"));

          const workspace = yield* ReviewWorkspace.make();
          const snapshot = yield* workspace.refreshInbox;
          const pullRequest = snapshot.pullRequests[0];
          expect(pullRequest?.id).toBe("github:octocat/reviewer#1");

          const run = yield* workspace.startRun({
            pullRequestId: pullRequest!.id,
            categories: ["tests"],
            skillIds: [],
            mcpConnectionIds: [],
          });
          expect(run.summaryDraftId).toBe(`${run.id}:summary`);

          const deletedSnapshot = yield* workspace.deleteSummaryDraft({
            summaryDraftId: run.summaryDraftId!,
          });
          const deletedRun = deletedSnapshot.reviewRuns.find((entry) => entry.id === run.id);
          const detail = deletedSnapshot.pullRequestDetails.find(
            (entry) => entry.pullRequestId === pullRequest!.id,
          );
          expect(deletedRun?.summaryDraftId).toBe(null);
          expect(detail?.summaryDrafts.some((draft) => draft.id === run.summaryDraftId)).toBe(
            false,
          );
          expect(detail?.commentDrafts.length).toBeGreaterThan(0);

          const submitResult = yield* workspace.submitRun({ runId: run.id }).pipe(Effect.result);
          expect(Result.isFailure(submitResult)).toBe(true);
          if (Result.isFailure(submitResult)) {
            expect(submitResult.failure.detail).toBe(
              "Review summary draft was deleted. Run the review again before submitting.",
            );
          }

          const afterSubmitAttempt = yield* workspace.getSnapshot;
          const afterDetail = afterSubmitAttempt.pullRequestDetails.find(
            (entry) => entry.pullRequestId === pullRequest!.id,
          );
          expect(afterDetail?.summaryDrafts.some((draft) => draft.id === run.summaryDraftId)).toBe(
            false,
          );
        }).pipe(provideReviewWorkspaceTestServices(baseDir));
      } finally {
        restoreFetch();
      }
    }),
  );

  it.effect("returns an error when deleting an unknown summary draft", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-review-workspace-missing-summary-test-",
      });

      yield* Effect.gen(function* () {
        const workspace = yield* ReviewWorkspace.make();
        const result = yield* workspace
          .deleteSummaryDraft({ summaryDraftId: "missing-summary" })
          .pipe(Effect.result);

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.detail).toBe("Review summary draft missing-summary was not found.");
        }
      }).pipe(provideReviewWorkspaceTestServices(baseDir));
    }),
  );

  it.effect("returns sanitized provider review errors without raw prompt output", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-review-workspace-provider-error-test-",
      });
      const restoreFetch = installReviewRunGitHubFetchMock();
      const rawProviderDetail = [
        "Codex CLI command failed: OpenAI Codex v0.133.0",
        "-------- user",
        "Diff anchors:",
        "apps/server/src/review/ReviewWorkspace.ts:RIGHT:8: secret prompt content",
        'ERROR: { "type": "error", "error": { "message": "Invalid schema for response_format" } }',
      ].join("\n");
      const textGeneration = makeStructuredTextGeneration(() =>
        Effect.fail(
          new TextGenerationError({
            operation: "review.generateRun",
            detail: rawProviderDetail,
          }),
        ),
      );

      try {
        yield* Effect.gen(function* () {
          const secretStore = yield* ServerSecretStore;
          yield* secretStore.set(githubTokenSecretName, textEncoder.encode("persisted-token"));

          const workspace = yield* ReviewWorkspace.make({ textGeneration });
          const snapshot = yield* workspace.refreshInbox;
          const pullRequest = snapshot.pullRequests[0];

          const result = yield* workspace
            .startRun({
              pullRequestId: pullRequest!.id,
              categories: ["security"],
              skillIds: [],
              mcpConnectionIds: [],
              modelSelection: defaultModelSelection,
            })
            .pipe(Effect.result);

          expect(Result.isFailure(result)).toBe(true);
          if (Result.isFailure(result)) {
            expect(result.failure.detail).toBe(
              "Provider review generation failed. Check server logs for diagnostics and try again.",
            );
            expect(result.failure.message).not.toContain("Diff anchors");
            expect(result.failure.message).not.toContain("secret prompt content");
            expect(result.failure.message).not.toContain("Codex CLI command failed");
          }
        }).pipe(provideReviewWorkspaceTestServices(baseDir));
      } finally {
        restoreFetch();
      }
    }),
  );
});
