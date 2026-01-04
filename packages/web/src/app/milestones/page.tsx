"use client";

import { Suspense } from "react";
import { useMilestones } from "@/hooks";
import { useProjectContext } from "@/contexts";
import { Timeline } from "@/components/milestones";
import { Card, CardHeader, CardTitle, LoadingState, ErrorState } from "@/components/ui";

export default function MilestonesPage() {
  return (
    <Suspense
      fallback={
        <Card>
          <LoadingState message="Loading..." />
        </Card>
      }
    >
      <MilestonesPageContent />
    </Suspense>
  );
}

function MilestonesPageContent() {
  const { projectId, isLoading: projectsLoading } = useProjectContext();

  const {
    data: milestones = [],
    isLoading: milestonesLoading,
    error,
    refetch,
  } = useMilestones({ project: projectId || undefined });

  const isLoading = projectsLoading || milestonesLoading;

  if (isLoading) {
    return (
      <Card>
        <LoadingState message="Loading milestones..." />
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <ErrorState
          message={error instanceof Error ? error.message : "Failed to load milestones"}
          onRetry={() => refetch()}
        />
      </Card>
    );
  }

  const milestoneCount = milestones.length;
  const milestonesWord = milestoneCount === 1 ? "milestone" : "milestones";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Milestones</CardTitle>
        <span className="text-gray-600 text-sm">
          {milestoneCount} {milestonesWord}
        </span>
      </CardHeader>

      <Timeline milestones={milestones} />
    </Card>
  );
}
