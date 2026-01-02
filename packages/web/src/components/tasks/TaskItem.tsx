"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { Badge, Markdown, Tooltip } from "../ui";
import { TaskTiming } from "./TaskTiming";
import { TaskMetadataPanel } from "./TaskMetadataPanel";
import { TaskActions } from "./TaskActions";
import type { Task } from "@/lib/types";

interface TaskItemProps {
  task: Task;
  projectId?: string;
  issueNumber?: number;
}

function getStatusIcon(status: Task["status"]): string {
  switch (status) {
    case "COMPLETED":
      return "\u2713";
    case "IN_PROGRESS":
      return "\u2192";
    case "PR_REVIEW":
      return "\u21C4"; // arrows left right
    case "ABANDONED":
      return "\u2717";
    default:
      return "\u25CB";
  }
}

export function TaskItem({ task, projectId, issueNumber }: TaskItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const isCompleted = task.status === "COMPLETED";
  const isInProgress = task.status === "IN_PROGRESS";
  const isPRReview = task.status === "PR_REVIEW";
  const isAbandoned = task.status === "ABANDONED";
  const hasWorktree = !!task.worktreePath;
  const hasPR = !!task.prUrl;
  const canExpand = !!projectId && issueNumber !== undefined;

  return (
    <li
      className={clsx(
        "rounded-lg border transition-colors",
        isCompleted && "bg-green-50 border-green-200",
        isInProgress && "bg-orange-50 border-orange-200",
        isPRReview && "bg-blue-50 border-blue-200",
        isAbandoned && "bg-red-50 border-red-200",
        !isCompleted && !isInProgress && !isPRReview && !isAbandoned && "bg-gray-50 border-gray-200"
      )}
    >
      {/* Main content */}
      <div className="flex gap-4 p-4">
        <div
          className={clsx(
            "w-6 h-6 flex items-center justify-center rounded-full text-sm font-bold flex-shrink-0",
            isCompleted && "bg-green-500 text-white",
            isInProgress && "bg-orange-500 text-white",
            isPRReview && "bg-blue-500 text-white",
            isAbandoned && "bg-red-500 text-white",
            !isCompleted && !isInProgress && !isPRReview && !isAbandoned && "bg-gray-300 text-gray-600"
          )}
        >
          {getStatusIcon(task.status)}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-800">{task.title}</span>
            {/* Worktree indicator */}
            {hasWorktree && (
              <Tooltip content={task.worktreePath || ""}>
                <span className="text-gray-500" title="Has worktree">
                  <BranchIcon />
                </span>
              </Tooltip>
            )}
            {/* PR indicator */}
            {hasPR && (
              <Tooltip content={`PR #${task.prNumber}`}>
                <span className="text-gray-500" title="Has PR">
                  <PRIcon />
                </span>
              </Tooltip>
            )}
          </div>
          <div className="text-sm text-gray-600 mt-1">
            <Markdown>{task.description}</Markdown>
          </div>

          {/* PR status badge (shown separately for visibility) */}
          {task.prStatus && (
            <div className="mt-2">
              <Badge variant="prStatus" value={task.prStatus} />
            </div>
          )}

          {task.acceptanceCriteria.length > 0 && (
            <ul className="mt-2 text-sm text-gray-600 list-disc list-inside">
              {task.acceptanceCriteria.map((criterion, idx) => (
                <li key={idx}>{criterion}</li>
              ))}
            </ul>
          )}

          {task.labels.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {task.labels.map((label) => (
                <Badge key={label} variant="label" value={label} />
              ))}
            </div>
          )}

          {/* Actions section - always visible */}
          {(task.branchName || task.prUrl || projectId) && (
            <TaskActions
              task={task}
              issueNumber={issueNumber}
              showCopyCommand={!!projectId}
              compact
              className="mt-3"
            />
          )}

          {/* Toggle link for details */}
          {canExpand && (
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="mt-3 text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
            >
              <span>{isExpanded ? "Hide details" : "Show details"}</span>
              <ChevronIcon isExpanded={isExpanded} />
            </button>
          )}
        </div>

        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <Badge variant="status" value={task.status} />
          <TaskTiming task={task} className="text-xs" />
          {task.estimatedMinutes && (
            <span className="text-xs text-gray-500">Est: {task.estimatedMinutes}m</span>
          )}
        </div>
      </div>

      {/* Expanded metadata panel */}
      {isExpanded && canExpand && (
        <div className="px-4 pb-4 pt-0 border-t border-gray-200 mt-0">
          <TaskMetadataPanel
            task={task}
            projectId={projectId}
            issueNumber={issueNumber}
            className="mt-4"
            hideActions
          />
        </div>
      )}
    </li>
  );
}

function BranchIcon() {
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
        d="M13 10V3L4 14h7v7l9-11h-7z"
      />
    </svg>
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

function ChevronIcon({ isExpanded, className }: { isExpanded: boolean; className?: string }) {
  return (
    <svg
      className={clsx("w-4 h-4 transition-transform", isExpanded && "rotate-180", className)}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}
