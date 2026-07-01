import { createFileRoute, redirect, useParams } from "@tanstack/react-router";

import ReviewWorkspace from "../components/review/ReviewWorkspace";
import {
  parseReviewPullRequestRouteTarget,
  parseReviewRepositoryRouteTarget,
} from "../reviewRoutes";

function ReviewRouteView() {
  const routeTarget = useParams({
    strict: false,
    select: (params) =>
      parseReviewPullRequestRouteTarget(params) ?? parseReviewRepositoryRouteTarget(params),
  });

  return <ReviewWorkspace routeTarget={routeTarget} />;
}

export const Route = createFileRoute("/review")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: ReviewRouteView,
});
