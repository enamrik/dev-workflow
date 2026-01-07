"use client";

import { Suspense, useState, useCallback } from "react";
import { useTasks, useUrlState } from "@/hooks";
import { useProjectContext } from "@/contexts";
import { KanbanBoard, WorkQueueRibbon, IssuePreviewPanel } from "@/components/kanban";
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
  const { projectId, sourceId, isLoading: projectsLoading } = useProjectContext();
  const { state, setProperty } = useUrlState();
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);

  const showBacklog = state.showBacklog ?? false;
  const showWorkQueue = state.showWorkQueue ?? false;

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
    source: sourceId || undefined,
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
            <span className="text-gray-500 text-sm">
              {activeTasks} active task{activeTasks !== 1 ? "s" : ""}
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
