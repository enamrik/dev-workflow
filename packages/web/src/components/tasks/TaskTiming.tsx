"use client";

import { useEffect, useState } from "react";
import { getTaskTimingMessage } from "@/lib/duration";
import { Tooltip } from "@/components/ui";
import type { Task } from "@/lib/types";

interface TaskTimingProps {
  task: Pick<Task, "status" | "createdAt" | "startedAt" | "submittedForReviewAt" | "completedAt" | "abandonedAt">;
  className?: string;
  /** "compact" shows just duration, "detailed" includes context prefix */
  variant?: "compact" | "detailed";
}

/**
 * Displays task timing information based on status.
 * For in-progress tasks, updates every minute to show live elapsed time.
 */
export function TaskTiming({ task, className = "", variant = "compact" }: TaskTimingProps) {
  const [message, setMessage] = useState<string | null>(() =>
    getTaskTimingMessage(task, variant)
  );

  useEffect(() => {
    // Update message immediately when task changes
    setMessage(getTaskTimingMessage(task, variant));

    // For active statuses (not completed/abandoned), update every minute
    const isActiveStatus = ["BACKLOG", "READY", "IN_PROGRESS", "PR_REVIEW"].includes(task.status);
    if (isActiveStatus) {
      const interval = setInterval(() => {
        setMessage(getTaskTimingMessage(task, variant));
      }, 60000); // Update every minute

      return () => clearInterval(interval);
    }

    return undefined;
  }, [task, task.status, task.createdAt, task.startedAt, task.submittedForReviewAt, task.completedAt, task.abandonedAt, variant]);

  if (!message) {
    return null;
  }

  const tooltip = getTooltip(task);

  return (
    <Tooltip content={tooltip} side="top">
      <span className={`text-gray-500 cursor-help ${className}`}>
        {message}
      </span>
    </Tooltip>
  );
}

function getTooltip(
  task: Pick<Task, "status" | "startedAt" | "submittedForReviewAt" | "completedAt" | "abandonedAt">
): string {
  const parts: string[] = [];

  if (task.startedAt) {
    parts.push(`Started: ${formatDateTime(task.startedAt)}`);
  }

  if (task.submittedForReviewAt) {
    parts.push(`Submitted for review: ${formatDateTime(task.submittedForReviewAt)}`);
  }

  if (task.completedAt) {
    parts.push(`Completed: ${formatDateTime(task.completedAt)}`);
  }

  if (task.abandonedAt) {
    parts.push(`Abandoned: ${formatDateTime(task.abandonedAt)}`);
  }

  return parts.join("\n");
}

function formatDateTime(isoString: string): string {
  return new Date(isoString).toLocaleString();
}
