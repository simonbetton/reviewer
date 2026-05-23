import { createFileRoute } from "@tanstack/react-router";

import ReviewWorkspace from "../components/review/ReviewWorkspace";

export const Route = createFileRoute("/review")({
  component: ReviewWorkspace,
});
