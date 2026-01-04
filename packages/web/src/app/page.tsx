"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useTasks } from "@/hooks";
import { useProjectContext } from "@/contexts";
import { KanbanBoard } from "@/components/kanban";
import { Card, CardHeader, CardTitle, LoadingState, ErrorState, Checkbox } from "@/components/ui";

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
  const { projectId, isLoading: projectsLoading } = useProjectContext();
  const issueFilter = searchParams.get("issue");
  const issueNumber = issueFilter ? parseInt(issueFilter, 10) : undefined;
  const showBacklog = searchParams.get("showBacklog") === "true";

  const {
    data: tasksResponse,
    isLoading: tasksLoading,
    error,
    refetch,
  } = useTasks({
    project: projectId || undefined,
    issue: issueNumber,
  });

  const issuesWithTasks = tasksResponse?.issuesWithTasks ?? [];
  const completedTasks = tasksResponse?.completedTasks ?? [];

  const isLoading = projectsLoading || tasksLoading;

  function clearIssueFilter() {
    const newParams = new URLSearchParams(searchParams.toString());
    newParams.delete("issue");
    router.push(`/?${newParams.toString()}`);
  }

  function handleShowBacklogChange(checked: boolean) {
    const newParams = new URLSearchParams(searchParams.toString());
    if (checked) {
      newParams.set("showBacklog", "true");
    } else {
      newParams.delete("showBacklog");
    }
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
    ? projectId
      ? `/projects/${encodeURIComponent(projectId)}/issues/${issueNumber}`
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
          <Checkbox
            label="Show backlog"
            checked={showBacklog}
            onChange={handleShowBacklogChange}
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
          showBacklog={showBacklog}
        />
      </div>
    </Card>
  );
}
