"use client";

import { Suspense } from "react";
import { useTasks, useUrlState } from "@/hooks";
import { useProjectContext } from "@/contexts";
import { KanbanBoard } from "@/components/kanban";
import { Card, CardHeader, CardTitle, LoadingState, ErrorState, Checkbox } from "@/components/ui";

export default function BoardPage() {
  return (
    <Suspense
      fallback={
        <Card>
          <LoadingState message="Loading..." />
        </Card>
      }
    >
      <BoardPageContent />
    </Suspense>
  );
}

function BoardPageContent() {
  const { projectId, isLoading: projectsLoading } = useProjectContext();
  const { state, setProperty } = useUrlState();

  const showBacklog = state.showBacklog ?? false;

  const {
    data: tasksResponse,
    isLoading: tasksLoading,
    error,
    refetch,
  } = useTasks({
    project: projectId || undefined,
  });

  const issuesWithTasks = tasksResponse?.issuesWithTasks ?? [];
  const completedTasks = tasksResponse?.completedTasks ?? [];

  const isLoading = projectsLoading || tasksLoading;

  function handleShowBacklogChange(checked: boolean) {
    setProperty("showBacklog", checked || undefined);
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
      (t) => t.status === "READY" || t.status === "IN_PROGRESS" || t.status === "PR_REVIEW"
    ).length;
    return sum + activeCount;
  }, 0);

  return (
    <Card padding="none">
      <div className="p-6 pb-0">
        <CardHeader>
          <CardTitle>Task Board</CardTitle>
          <span className="text-gray-600 text-sm">
            {activeTasks} task{activeTasks !== 1 ? "s" : ""}
          </span>
        </CardHeader>

        <div className="flex items-center justify-between mb-4">
          <Checkbox
            label="Show backlog/planned"
            checked={showBacklog}
            onChange={handleShowBacklogChange}
          />
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
