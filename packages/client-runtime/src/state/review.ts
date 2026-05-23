import { REVIEW_WS_METHODS, WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export function createReviewEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    snapshot: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:review:snapshot",
      tag: REVIEW_WS_METHODS.getSnapshot,
      staleTimeMs: 5_000,
    }),
    snapshots: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:review:snapshots",
      tag: REVIEW_WS_METHODS.subscribe,
    }),
    beginGitHubOAuth: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:review:github-begin-oauth",
      tag: REVIEW_WS_METHODS.githubBeginOAuth,
    }),
    completeGitHubOAuth: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:review:github-complete-oauth",
      tag: REVIEW_WS_METHODS.githubCompleteOAuth,
    }),
    refreshInbox: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:review:refresh-inbox",
      tag: REVIEW_WS_METHODS.refreshInbox,
    }),
    recordInteraction: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:review:record-interaction",
      tag: REVIEW_WS_METHODS.recordInteraction,
    }),
    setRepositoryPinned: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:review:set-repository-pinned",
      tag: REVIEW_WS_METHODS.setRepositoryPinned,
    }),
    setPullRequestPinned: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:review:set-pull-request-pinned",
      tag: REVIEW_WS_METHODS.setPullRequestPinned,
    }),
    upsertMcpConnection: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:review:upsert-mcp-connection",
      tag: REVIEW_WS_METHODS.upsertMcpConnection,
    }),
    removeMcpConnection: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:review:remove-mcp-connection",
      tag: REVIEW_WS_METHODS.removeMcpConnection,
    }),
    installSkill: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:review:install-skill",
      tag: REVIEW_WS_METHODS.installSkill,
    }),
    setSkillEnabled: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:review:set-skill-enabled",
      tag: REVIEW_WS_METHODS.setSkillEnabled,
    }),
    removeSkill: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:review:remove-skill",
      tag: REVIEW_WS_METHODS.removeSkill,
    }),
    startRun: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:review:start-run",
      tag: REVIEW_WS_METHODS.startRun,
    }),
    submitRun: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:review:submit-run",
      tag: REVIEW_WS_METHODS.submitRun,
    }),
    diffPreview: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:review:diff-preview",
      tag: WS_METHODS.reviewGetDiffPreview,
      staleTimeMs: 5_000,
    }),
  };
}
