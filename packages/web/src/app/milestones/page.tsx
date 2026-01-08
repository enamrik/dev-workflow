"use client";

import { Suspense, useMemo } from "react";
import { useMilestones, useUrlState } from "@/hooks";
import { useProjectContext } from "@/contexts";
import { Timeline } from "@/components/milestones";
import {
  Card,
  CardTitle,
  LoadingState,
  ErrorState,
  Dropdown,
  DropdownToggle,
} from "@/components/ui";

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
  const { projectId, sourceId, isLoading: projectsLoading } = useProjectContext();
  const { state, setProperty } = useUrlState();

  const showCompleted = state.showCompleted ?? false;

  function handleShowCompletedChange(checked: boolean) {
    setProperty("showCompleted", checked || undefined);
  }

  const {
    data: milestones = [],
    isLoading: milestonesLoading,
    error,
    refetch,
  } = useMilestones({
    project: projectId || undefined,
    source: sourceId || undefined,
  });

  // Count visible milestones (respecting showCompleted filter)
  const visibleCount = useMemo(() => {
    if (showCompleted) {
      return milestones.length;
    }
    return milestones.filter((m) => m.milestone.status !== "COMPLETED").length;
  }, [milestones, showCompleted]);

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

  return (
    <Card padding="none">
      <div className="p-6 pb-0">
        <div className="flex items-start justify-between mb-4">
          <div>
            <CardTitle>Milestones</CardTitle>
            <span className="text-gray-500 text-sm">
              {visibleCount} milestone{visibleCount !== 1 ? "s" : ""}
            </span>
          </div>
          <Dropdown
            trigger={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M4 6h3m4 0h9M6 6a2 2 0 104 0 2 2 0 00-4 0zM4 12h9m4 0h3M12 12a2 2 0 104 0 2 2 0 00-4 0zM4 18h5m4 0h7M8 18a2 2 0 104 0 2 2 0 00-4 0z"
                />
              </svg>
            }
          >
            <DropdownToggle
              label="Show completed milestones"
              checked={showCompleted}
              onChange={handleShowCompletedChange}
            />
          </Dropdown>
        </div>
      </div>

      <div className="p-6 pt-0">
        <Timeline milestones={milestones} showCompleted={showCompleted} />
      </div>
    </Card>
  );
}
