"use client";

import { Suspense, useState, useCallback } from "react";
import { useTasks, useUrlState } from "@/hooks";
import { useProjectContext } from "@/contexts";
import {
  KanbanBoard,
  WorkQueueRibbon,
  IssuePreviewPanel,
  BoardStatsRibbon,
} from "@/components/kanban";
import {
  Card,
  CardTitle,
  LoadingState,
  ErrorState,
  Dropdown,
  DropdownToggle,
} from "@/components/ui";

interface PreviewTarget {
  projectSlug: string;
  issueNumber: number;
}

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
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);

  const showBacklog = state.showBacklog ?? false;
  const showWorkQueue = state.showWorkQueue ?? false;
  const showStats = state.showStats ?? true; // Default to showing stats

  const handleIssueClick = useCallback((target: PreviewTarget) => {
    setPreviewTarget(target);
  }, []);

  const handleClosePreview = useCallback(() => {
    setPreviewTarget(null);
  }, []);

  const {
    data: tasksResponse,
    isLoading: tasksLoading,
    error,
    refetch,
  } = useTasks({
    project: projectId || undefined,
    // Don't filter by source when project is already selected - it's redundant
  });

  const issuesWithTasks = tasksResponse?.issuesWithTasks ?? [];
  const completedTasks = tasksResponse?.completedTasks ?? [];

  const isLoading = projectsLoading || tasksLoading;

  function handleShowBacklogChange(checked: boolean) {
    setProperty("showBacklog", checked || undefined);
  }

  function handleShowWorkQueueChange(checked: boolean) {
    setProperty("showWorkQueue", checked || undefined);
  }

  function handleShowStatsChange(checked: boolean) {
    // Store false explicitly since default is true
    setProperty("showStats", checked ? undefined : false);
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

  // Calculate height: viewport - nav (~56px) - main padding (48px)
  // Fixed height ensures columns are constrained and content scrolls within them
  return (
    <Card padding="none" className="flex flex-col h-[calc(100vh-104px)]">
      <div className="p-6 pb-0">
        <div className="flex items-start justify-between mb-4">
          <div>
            <CardTitle>Task Board</CardTitle>
            {showStats && <BoardStatsRibbon activeTasks={activeTasks} />}
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
              label="Show stats ribbon"
              checked={showStats}
              onChange={handleShowStatsChange}
            />
            <DropdownToggle
              label="Show backlog/planned"
              checked={showBacklog}
              onChange={handleShowBacklogChange}
            />
            <DropdownToggle
              label="Show work queue"
              checked={showWorkQueue}
              onChange={handleShowWorkQueueChange}
            />
          </Dropdown>
        </div>
      </div>

      <div className="flex-1 px-6 overflow-hidden">
        <KanbanBoard
          issuesWithTasks={issuesWithTasks}
          completedTasks={completedTasks}
          showBacklog={showBacklog}
        />
      </div>

      {showWorkQueue && (
        <WorkQueueRibbon issuesWithTasks={issuesWithTasks} onIssueClick={handleIssueClick} />
      )}

      {/* Issue Preview Panel */}
      {previewTarget && (
        <IssuePreviewPanel
          projectSlug={previewTarget.projectSlug}
          issueNumber={previewTarget.issueNumber}
          onClose={handleClosePreview}
        />
      )}
    </Card>
  );
}
