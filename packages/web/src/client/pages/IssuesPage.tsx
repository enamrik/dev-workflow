import { useSearchParams } from "react-router-dom";
import { useIssues, useProjects } from "../hooks";
import { IssueTable, ProjectFilter } from "../components/issues";
import { Card, CardHeader, CardTitle, LoadingState, ErrorState } from "../components/ui";

export function IssuesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const projectFilter = searchParams.get("project") ?? "";

  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const {
    data: issues = [],
    isLoading: issuesLoading,
    error,
    refetch,
  } = useIssues({ project: projectFilter || undefined });

  const isLoading = projectsLoading || issuesLoading;

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
        <LoadingState message="Loading issues..." />
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <ErrorState
          message={error instanceof Error ? error.message : "Failed to load issues"}
          onRetry={refetch}
        />
      </Card>
    );
  }

  const issueCount = issues.length;
  const issuesWord = issueCount === 1 ? "issue" : "issues";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Issues</CardTitle>
        <span className="text-gray-600 text-sm">
          {issueCount} {issuesWord}
        </span>
      </CardHeader>

      <ProjectFilter
        projects={projects}
        value={projectFilter}
        onChange={handleProjectChange}
      />

      <IssueTable issues={issues} />
    </Card>
  );
}
