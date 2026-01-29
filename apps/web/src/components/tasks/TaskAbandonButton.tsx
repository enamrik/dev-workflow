"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { ConfirmDialog, Tooltip } from "../ui";
import type { Task } from "@/lib/types";

interface TaskAbandonButtonProps {
  task: Task;
  projectSlug: string;
  onSuccess?: () => void;
  className?: string;
}

/**
 * Check if a task is in a terminal state (COMPLETED or ABANDONED).
 * Local implementation to avoid importing from @dev-workflow/tracking which requires
 * full Task type with all internal fields.
 */
function isTerminal(task: Task): boolean {
  return task.status === "COMPLETED" || task.status === "ABANDONED";
}

/**
 * Button to abandon a task with confirmation dialog.
 *
 * Only renders for non-terminal tasks (not COMPLETED or ABANDONED).
 * Shows a confirmation dialog warning that abandonment is irreversible.
 */
export function TaskAbandonButton({
  task,
  projectSlug,
  onSuccess,
  className,
}: TaskAbandonButtonProps) {
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Don't render for terminal tasks
  if (isTerminal(task)) {
    return null;
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsConfirmOpen(true);
  };

  const handleConfirm = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/tasks/${task.id}/abandon`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectSlug,
          reason: "User abandoned via UI",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to abandon task");
      }

      setIsConfirmOpen(false);
      onSuccess?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to abandon task";
      setError(message);
      console.error("Abandon error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    if (!isLoading) {
      setIsConfirmOpen(false);
      setError(null);
    }
  };

  const button = (
    <button
      onClick={handleClick}
      className={clsx(
        "inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors",
        "focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1",
        error
          ? "bg-red-100 text-red-700 hover:bg-red-200"
          : "bg-red-50 text-red-600 hover:bg-red-100",
        className
      )}
      aria-label="Abandon task"
    >
      <StopIcon className="w-4 h-4" />
      <span>Abandon</span>
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
        isOpen={isConfirmOpen}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
        title="Abandon Task"
        message="Are you sure you want to abandon this task? This action is irreversible. The task will be marked as abandoned and any associated worktree or branch will be cleaned up."
        confirmLabel="Abandon Task"
        cancelLabel="Cancel"
        variant="danger"
        isLoading={isLoading}
      />
    </>
  );
}

function StopIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"
      />
    </svg>
  );
}
