"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { ConfirmDialog, Tooltip } from "../ui";
import { isIssueClosed, isIssueInPlanning, isTerminal, allTasksTerminal } from "@/lib/types";
import type { Issue, Task } from "@/lib/types";

interface IssueCloseButtonProps {
  issue: Issue;
  tasks: Task[];
  projectSlug: string;
  onSuccess?: () => void;
}

/**
 * Button to close an issue with confirmation dialog.
 *
 * Shows for non-closed issues. Behavior depends on task status:
 * - All tasks terminal: closes immediately without modal
 * - Incomplete tasks exist: shows warning modal listing incomplete tasks
 */
export function IssueCloseButton({ issue, tasks, projectSlug, onSuccess }: IssueCloseButtonProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Don't render if issue is already closed or still in planning
  // PLANNED issues should be deleted, not closed
  if (isIssueClosed(issue) || isIssueInPlanning(issue)) {
    return null;
  }

  // Get incomplete tasks for the warning modal
  const incompleteTasks = tasks.filter((task) => !isTerminal(task));
  const canCloseImmediately = tasks.length === 0 || allTasksTerminal(tasks);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    // If all tasks are complete (or no tasks), close immediately
    if (canCloseImmediately) {
      await closeIssue();
    } else {
      // Show confirmation modal for incomplete tasks
      setShowConfirm(true);
    }
  };

  const closeIssue = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/issues/${issue.number}/close`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectSlug,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to close issue");
      }

      setShowConfirm(false);
      onSuccess?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to close issue";
      setError(message);
      console.error("Close issue error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    if (!isLoading) {
      setShowConfirm(false);
      setError(null);
    }
  };

  const button = (
    <button
      onClick={handleClick}
      disabled={isLoading}
      className={clsx(
        "inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors",
        "focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-1",
        isLoading && "opacity-50 cursor-wait",
        error
          ? "bg-red-100 text-red-700 hover:bg-red-200"
          : "bg-green-50 text-green-600 hover:bg-green-100"
      )}
      aria-label="Close issue"
    >
      <CheckCircleIcon className="w-4 h-4" />
      <span>Complete Issue</span>
    </button>
  );

  return (
    <>
      {error ? (
        <Tooltip content={error} side="top">
          {button}
        </Tooltip>
      ) : (
        button
      )}
      <ConfirmDialog
        isOpen={showConfirm}
        onConfirm={closeIssue}
        onCancel={handleCancel}
        title="Close Issue with Incomplete Tasks"
        message={
          <div className="space-y-3">
            <p>
              Issue #{issue.number} has {incompleteTasks.length} incomplete{" "}
              {incompleteTasks.length === 1 ? "task" : "tasks"} that will be abandoned:
            </p>
            <ul className="text-sm space-y-1 max-h-32 overflow-y-auto">
              {incompleteTasks.map((task) => (
                <li key={task.id} className="flex items-center gap-2">
                  <span className="text-amber-600">•</span>
                  <span className="text-gray-700">
                    #{issue.number}.{task.number}: {task.title}
                  </span>
                  <span className="text-gray-400 text-xs">({task.status})</span>
                </li>
              ))}
            </ul>
            <p className="text-amber-600 font-medium">
              Are you sure you want to close this issue and abandon these tasks?
            </p>
          </div>
        }
        confirmLabel="Close Issue"
        variant="warning"
        isLoading={isLoading}
      />
    </>
  );
}

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}
