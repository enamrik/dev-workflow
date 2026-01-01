"use client";

import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useMilestones, useProjects } from "@/hooks";
import { Timeline } from "@/components/milestones";
import { ProjectFilter } from "@/components/issues";
import { Card, CardHeader, CardTitle, LoadingState, ErrorState } from "@/components/ui";

export default function MilestonesPage() {
  return (
    <Suspense fallback={<Card><LoadingState message="Loading..." /></Card>}>
      <MilestonesPageContent />
    </Suspense>
  );
}

function MilestonesPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const projectFilter = searchParams.get("project") ?? "";

  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const {
    data: milestones = [],
    isLoading: milestonesLoading,
    error,
    refetch,
  } = useMilestones({ project: projectFilter || undefined });

  const isLoading = projectsLoading || milestonesLoading;

  function handleProjectChange(projectId: string) {
    if (projectId) {
      router.push(`/milestones?project=${encodeURIComponent(projectId)}`);
    } else {
      router.push("/milestones");
    }
  }

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

      <ProjectFilter
        projects={projects}
        value={projectFilter}
        onChange={handleProjectChange}
      />

      <Timeline milestones={milestones} />
    </Card>
  );
}
