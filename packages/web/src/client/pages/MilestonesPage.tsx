import { useSearchParams } from "react-router-dom";
import { useMilestones, useProjects } from "../hooks";
import { Timeline } from "../components/milestones";
import { ProjectFilter } from "../components/issues";
import { Card, CardHeader, CardTitle, LoadingState, ErrorState } from "../components/ui";

export function MilestonesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
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
      setSearchParams({ project: projectId });
    } else {
      setSearchParams({});
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
          onRetry={refetch}
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
