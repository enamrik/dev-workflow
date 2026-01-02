"use client";

import { clsx } from "clsx";
import { StatusHistoryTimeline } from "./StatusHistoryTimeline";
import { TimeBreakdown } from "./TimeBreakdown";
import { TaskDependencies } from "./TaskDependencies";
import { ExecutionLogList } from "./ExecutionLogList";
import { CopyTaskCommand } from "./CopyTaskCommand";
import { Badge, CopyButton } from "../ui";
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
}: TaskMetadataPanelProps) {
  const { data, isLoading, error } = useTaskMetadata(projectId, task.id);

  if (isLoading) {
    return (
      <div className={clsx("py-4 text-sm text-gray-500", className)}>
        Loading metadata...
      </div>
    );
  }

  if (error) {
    return (
      <div className={clsx("py-4 text-sm text-red-500", className)}>
        Failed to load metadata
      </div>
    );
  }

  const { history = [], logs = [], dependencies = [] } = data || {};

  return (
    <div className={clsx("space-y-4", className)}>
      {/* Action buttons */}
      {!hideCopyCommand && (
        <div className="flex items-center gap-2">
          <CopyTaskCommand issueNumber={issueNumber} taskNumber={task.number} />
        </div>
      )}

      {/* Worktree and Branch info */}
      {task.branchName && (
        <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            Branch
          </div>
          <div className="flex items-center gap-2">
            <code className="text-sm bg-gray-100 px-2 py-1 rounded font-mono block truncate flex-1">
              {task.branchName}
            </code>
            <CopyButton text={task.branchName} tooltip="Copy branch name" />
          </div>
          {task.worktreePath && (
            <div className="mt-2 flex items-center gap-2">
              <div className="text-xs text-gray-500 truncate flex-1" title={task.worktreePath}>
                Worktree: {task.worktreePath}
              </div>
              <CopyButton text={task.worktreePath} tooltip="Copy worktree path" />
            </div>
          )}
        </div>
      )}

      {/* PR info */}
      {task.prUrl && (
        <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Pull Request
            </div>
            {task.prStatus && <Badge variant="prStatus" value={task.prStatus} />}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <a
              href={task.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1"
            >
              <PRIcon />
              PR #{task.prNumber}
            </a>
            <CopyButton text={task.prUrl} tooltip="Copy PR URL" />
          </div>
        </div>
      )}

      {/* Dependencies */}
      {dependencies.length > 0 && (
        <TaskDependencies dependencies={dependencies} />
      )}

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

function PRIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
      />
    </svg>
  );
}
