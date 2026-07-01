import type { ReviewInboxSnapshot } from "@t3tools/contracts";
import { create } from "zustand";

interface ReviewAppState {
  snapshot: ReviewInboxSnapshot | null;
  selectedRepositoryId: string | null;
  selectedPullRequestId: string | null;
  setSnapshot: (snapshot: ReviewInboxSnapshot) => void;
  selectRepository: (repositoryId: string | null) => void;
  selectPullRequest: (pullRequestId: string | null) => void;
}

export const useReviewAppStore = create<ReviewAppState>((set) => ({
  snapshot: null,
  selectedRepositoryId: null,
  selectedPullRequestId: null,
  setSnapshot: (snapshot) =>
    set((state) => {
      const firstRepositoryId = snapshot.groups[0]?.repositories[0]?.id ?? null;
      const selectedRepositoryExists =
        state.selectedRepositoryId !== null &&
        snapshot.groups.some((group) =>
          group.repositories.some((repository) => repository.id === state.selectedRepositoryId),
        );
      const selectedRepositoryId = selectedRepositoryExists
        ? state.selectedRepositoryId
        : firstRepositoryId;
      const selectedPullRequestExists =
        state.selectedPullRequestId !== null &&
        snapshot.pullRequests.some((pullRequest) => pullRequest.id === state.selectedPullRequestId);
      const firstPullRequestId =
        snapshot.pullRequests.find(
          (pullRequest) => pullRequest.repositoryId === selectedRepositoryId,
        )?.id ?? null;
      return {
        snapshot,
        selectedRepositoryId,
        selectedPullRequestId: selectedPullRequestExists
          ? state.selectedPullRequestId
          : firstPullRequestId,
      };
    }),
  selectRepository: (repositoryId) =>
    set((state) => ({
      selectedRepositoryId: repositoryId,
      selectedPullRequestId:
        state.snapshot?.pullRequests.find(
          (pullRequest) => pullRequest.repositoryId === repositoryId,
        )?.id ?? null,
    })),
  selectPullRequest: (pullRequestId) => set({ selectedPullRequestId: pullRequestId }),
}));
