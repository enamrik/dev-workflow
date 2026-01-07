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
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
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
