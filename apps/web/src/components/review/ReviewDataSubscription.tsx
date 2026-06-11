import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect } from "react";

import { useReviewAppStore } from "../../reviewAppStore";
import { reviewEnvironment } from "../../state/review";
import { usePrimaryEnvironmentId } from "../../state/environments";

function ReviewEnvironmentDataSubscription({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
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

export function ReviewDataSubscription() {
  const primaryEnvironmentId = usePrimaryEnvironmentId();

  if (primaryEnvironmentId === null) return null;

  return <ReviewEnvironmentDataSubscription environmentId={primaryEnvironmentId} />;
}
