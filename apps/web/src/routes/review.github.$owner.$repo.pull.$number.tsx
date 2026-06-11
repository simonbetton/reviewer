import { createFileRoute } from "@tanstack/react-router";

import ReviewWorkspace from "../components/review/ReviewWorkspace";
import { parseReviewPullRequestRouteTarget } from "../reviewRoutes";

function ReviewPullRequestRoute() {
  const params = Route.useParams();
  return <ReviewWorkspace routeTarget={parseReviewPullRequestRouteTarget(params)} />;
}

export const Route = createFileRoute("/review/github/$owner/$repo/pull/$number")({
  component: ReviewPullRequestRoute,
});
