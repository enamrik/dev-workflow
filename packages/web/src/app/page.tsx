"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useTasks, useProjects } from "@/hooks";
import { KanbanBoard } from "@/components/kanban";
import { ProjectFilter } from "@/components/issues";
import { Card, CardHeader, CardTitle, LoadingState, ErrorState } from "@/components/ui";

export default function BoardPage() {
  return (
    <Suspense fallback={<Card><LoadingState message="Loading..." /></Card>}>
      <BoardPageContent />
    </Suspense>
  );
}

function BoardPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const projectFilter = searchParams.get("project") ?? "";
  const issueFilter = searchParams.get("issue");
  const issueNumber = issueFilter ? parseInt(issueFilter, 10) : undefined;

  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const {
    data: tasksResponse,
    isLoading: tasksLoading,
    error,
    refetch,
  } = useTasks({
    project: projectFilter || undefined,
    issue: issueNumber,
  });

  const issuesWithTasks = tasksResponse?.issuesWithTasks ?? [];
  const completedTasks = tasksResponse?.completedTasks ?? [];

  const isLoading = projectsLoading || tasksLoading;

  function handleProjectChange(projectId: string) {
    const newParams = new URLSearchParams(searchParams.toString());
    if (projectId) {
      newParams.set("project", projectId);
    } else {
      newParams.delete("project");
    }
    router.push(`/?${newParams.toString()}`);
  }

  function clearIssueFilter() {
    const newParams = new URLSearchParams(searchParams.toString());
    newParams.delete("issue");
    router.push(`/?${newParams.toString()}`);
  }

  if (isLoading) {
    return (
      <Card>
        <LoadingState message="Loading tasks..." />
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <ErrorState
          message={error instanceof Error ? error.message : "Failed to load tasks"}
          onRetry={() => refetch()}
        />
      </Card>
    );
  }

  // Count active tasks (excluding BACKLOG, COMPLETED, and ABANDONED)
  const activeTasks = issuesWithTasks.reduce((sum, item) => {
    const activeCount = item.tasks.filter(
      (t) =>
        t.status === "READY" ||
        t.status === "IN_PROGRESS" ||
        t.status === "PR_REVIEW"
    ).length;
    return sum + activeCount;
  }, 0);

  const headerTitle = issueNumber
    ? `Tasks for Issue #${issueNumber}`
    : "Task Board";

  const issueDetailUrl = issueNumber
    ? projectFilter
      ? `/projects/${encodeURIComponent(projectFilter)}/issues/${issueNumber}`
      : `/issues/${issueNumber}`
    : null;

  return (
    <Card padding="none">
      <div className="p-6 pb-0">
        <CardHeader>
          <div className="flex items-center gap-4">
            {issueNumber && (
              <button
                onClick={clearIssueFilter}
                className="text-gray-600 hover:text-gray-800 text-sm"
              >
                &larr; All Tasks
              </button>
            )}
            <CardTitle>{headerTitle}</CardTitle>
          </div>
          <span className="text-gray-600 text-sm">
            {activeTasks} task{activeTasks !== 1 ? "s" : ""}
          </span>
        </CardHeader>

        <div className="flex items-center justify-between mb-4">
          <ProjectFilter
            projects={projects}
            value={projectFilter}
            onChange={handleProjectChange}
          />
          {issueDetailUrl && (
            <Link
              href={issueDetailUrl}
              className="text-sm text-blue-600 hover:underline"
            >
              View Issue Details
            </Link>
          )}
        </div>
      </div>

      <div className="p-6 pt-0">
        <KanbanBoard
          issuesWithTasks={issuesWithTasks}
          completedTasks={completedTasks}
        />
      </div>
    </Card>
  );
}
