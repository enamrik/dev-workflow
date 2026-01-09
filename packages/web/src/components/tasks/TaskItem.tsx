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
  totalTasks?: number; // Total tasks in the issue for display formatting
  compact?: boolean; // Use compact layout for narrow containers (e.g., preview panels)
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

export function TaskItem({
  task,
  projectId,
  issueNumber,
  totalTasks,
  compact = false,
}: TaskItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const isCompleted = task.status === "COMPLETED";
  const isInProgress = task.status === "IN_PROGRESS";
  const isPRReview = task.status === "PR_REVIEW";
  const isAbandoned = task.status === "ABANDONED";
  const canExpand = !!projectId && issueNumber !== undefined;

  // Format task display: "Task [index/total]:" or fall back to "Task index:"
  const taskDisplayLabel = totalTasks
    ? `Task [${task.index}/${totalTasks}]:`
    : `Task ${task.index}:`;
  const taskNumberTooltip = `Immutable task number: #${task.number}`;

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
      <div
        className={clsx("flex gap-3 p-4", compact ? "flex-col" : "flex-col sm:flex-row sm:gap-4")}
      >
        {/* Mobile/Compact: Status badge at top */}
        <div className={clsx("flex items-center justify-between", compact ? "" : "sm:hidden")}>
          <div className="flex items-center gap-2">
            <div
              className={clsx(
                "w-6 h-6 flex items-center justify-center rounded-full text-sm font-bold flex-shrink-0",
                isCompleted && "bg-green-500 text-white",
                isInProgress && "bg-orange-500 text-white",
                isPRReview && "bg-blue-500 text-white",
                isAbandoned && "bg-red-500 text-white",
                !isCompleted &&
                  !isInProgress &&
                  !isPRReview &&
                  !isAbandoned &&
                  "bg-gray-300 text-gray-600"
              )}
            >
              {getStatusIcon(task.status)}
            </div>
            <Tooltip content={taskNumberTooltip} side="top">
              <span className="text-gray-500 font-medium cursor-help">{taskDisplayLabel}</span>
            </Tooltip>
          </div>
          <Badge variant="status" value={task.status} />
        </div>

        {/* Desktop (non-compact): Icon on left */}
        <div
          className={clsx(
            "w-6 h-6 items-center justify-center rounded-full text-sm font-bold flex-shrink-0",
            compact ? "hidden" : "hidden sm:flex",
            isCompleted && "bg-green-500 text-white",
            isInProgress && "bg-orange-500 text-white",
            isPRReview && "bg-blue-500 text-white",
            isAbandoned && "bg-red-500 text-white",
            !isCompleted &&
              !isInProgress &&
              !isPRReview &&
              !isAbandoned &&
              "bg-gray-300 text-gray-600"
          )}
        >
          {getStatusIcon(task.status)}
        </div>

        <div className="flex-1 min-w-0">
          {/* Desktop (non-compact): Task number and title */}
          <div className={clsx("items-center gap-2", compact ? "hidden" : "hidden sm:flex")}>
            <Tooltip content={taskNumberTooltip} side="top">
              <span className="text-gray-500 font-medium cursor-help">{taskDisplayLabel}</span>
            </Tooltip>
            <span className="font-medium text-gray-800">{task.title}</span>
          </div>

          {/* Mobile/Compact: Just title */}
          <div className={clsx("font-medium text-gray-800 mb-2", compact ? "" : "sm:hidden")}>
            {task.title}
          </div>

          {/* Actions panel - just below title */}
          {(task.branchName || task.prUrl || projectId) && (
            <TaskActions
              task={task}
              issueNumber={issueNumber}
              showCopyCommand={!!projectId}
              className="mt-1"
            />
          )}

          <div className="text-sm text-gray-600 mt-2">
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

          {/* Implementation plan */}
          {task.implementationPlan && (
            <div className="mt-3">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                Implementation Plan
              </div>
              <div className="text-sm text-gray-700 bg-gray-100 p-3 rounded-lg border border-gray-200">
                <Markdown>{task.implementationPlan}</Markdown>
              </div>
            </div>
          )}

          {/* Mobile/Compact: Timing info at bottom of content */}
          <div className={clsx("mt-3", compact ? "" : "sm:hidden")}>
            <TaskTiming task={task} className="text-xs text-gray-500" variant="detailed" />
          </div>

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

        {/* Desktop (non-compact): Status and timing on right */}
        <div
          className={clsx(
            "flex-col items-end gap-2 flex-shrink-0",
            compact ? "hidden" : "hidden sm:flex"
          )}
        >
          <Badge variant="status" value={task.status} />
          <TaskTiming task={task} className="text-xs" variant="detailed" />
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
