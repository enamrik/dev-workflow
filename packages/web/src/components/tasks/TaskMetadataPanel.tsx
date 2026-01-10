"use client";

import { clsx } from "clsx";
import { StatusHistoryTimeline } from "./StatusHistoryTimeline";
import { TimeBreakdown } from "./TimeBreakdown";
import { TaskDependencies } from "./TaskDependencies";
import { ExecutionLogList } from "./ExecutionLogList";
import { TaskActions } from "./TaskActions";
import { WorkerBadge } from "./WorkerBadge";
import { Badge } from "../ui";
import { useTaskMetadata } from "@/hooks";
import type { Task } from "@/lib/types";

interface TaskMetadataPanelProps {
  task: Task;
  projectId: string;
  issueNumber: number;
  className?: string;
  /** Hide the copy command button (e.g., when shown in header) */
  hideCopyCommand?: boolean;
  /** Hide timestamps (e.g., when shown in footer) */
  hideTimestamps?: boolean;
  /** Hide the actions section (e.g., when shown above in parent) */
  hideActions?: boolean;
  /** Hide PR status badge (e.g., when shown in subheader) */
  hidePRStatus?: boolean;
}

function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Panel displaying rich task metadata:
 * - Status history timeline
 * - Time breakdown (estimated vs actual)
 * - Dependencies
 * - Execution logs
 * - Worktree/branch info
 * - PR info
 * - Created/updated timestamps
 * - Copy command button
 */
export function TaskMetadataPanel({
  task,
  projectId,
  issueNumber,
  className,
  hideCopyCommand = false,
  hideTimestamps = false,
  hideActions = false,
  hidePRStatus = false,
}: TaskMetadataPanelProps) {
  const { data, isLoading, error } = useTaskMetadata(projectId, task.id);

  if (isLoading) {
    return <div className={clsx("py-4 text-sm text-gray-500", className)}>Loading metadata...</div>;
  }

  if (error) {
    return (
      <div className={clsx("py-4 text-sm text-red-500", className)}>Failed to load metadata</div>
    );
  }

  const { history = [], logs = [], dependencies = [] } = data || {};

  const hasActions = !hideActions && (task.branchName || task.prUrl || !hideCopyCommand);

  return (
    <div className={clsx("space-y-4", className)}>
      {/* Consolidated actions section */}
      {hasActions && (
        <TaskActions task={task} issueNumber={issueNumber} showCopyCommand={!hideCopyCommand} />
      )}

      {/* PR status badge (shown separately for visibility) */}
      {!hidePRStatus && task.prStatus && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">PR Status:</span>
          <Badge variant="prStatus" value={task.prStatus} />
        </div>
      )}

      {/* Worker info (only for tasks with active worker) */}
      {task.workerId && <WorkerBadge workerId={task.workerId} workerName={task.workerName} />}

      {/* Dependencies */}
      {dependencies.length > 0 && <TaskDependencies dependencies={dependencies} />}

      {/* Time breakdown */}
      {task.startedAt && (
        <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            Time Breakdown
          </div>
          <TimeBreakdown task={task} history={history} />
        </div>
      )}

      {/* Status history */}
      {history.length > 0 && (
        <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            Status History
          </div>
          <StatusHistoryTimeline history={history} />
        </div>
      )}

      {/* Execution logs */}
      {logs.length > 0 && <ExecutionLogList logs={logs} />}

      {/* Timestamps */}
      {!hideTimestamps && (
        <div className="pt-2 border-t border-gray-200">
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <dt className="text-gray-500">Created</dt>
              <dd className="text-gray-700">{formatDateTime(task.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Updated</dt>
              <dd className="text-gray-700">{formatDateTime(task.updatedAt)}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
