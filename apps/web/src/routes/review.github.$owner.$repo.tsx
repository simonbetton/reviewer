import { createFileRoute } from "@tanstack/react-router";

import ReviewWorkspace from "../components/review/ReviewWorkspace";
import { parseReviewRepositoryRouteTarget } from "../reviewRoutes";

function ReviewRepositoryRoute() {
  const params = Route.useParams();
  return <ReviewWorkspace routeTarget={parseReviewRepositoryRouteTarget(params)} />;
}

export const Route = createFileRoute("/review/github/$owner/$repo")({
  component: ReviewRepositoryRoute,
});
