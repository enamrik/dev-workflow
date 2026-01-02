"use client";

import { useEffect, useState } from "react";
import { getTaskTimingMessage } from "@/lib/duration";
import type { Task } from "@/lib/types";

interface TaskTimingProps {
  task: Pick<Task, "status" | "startedAt" | "completedAt" | "abandonedAt">;
  className?: string;
}

/**
 * Displays task timing information based on status.
 * For in-progress tasks, updates every minute to show live elapsed time.
 */
export function TaskTiming({ task, className = "" }: TaskTimingProps) {
  const [message, setMessage] = useState<string | null>(() =>
    getTaskTimingMessage(task)
  );

  useEffect(() => {
    // Update message immediately when task changes
    setMessage(getTaskTimingMessage(task));

    // For in-progress tasks, update every minute
    if (task.status === "IN_PROGRESS" && task.startedAt) {
      const interval = setInterval(() => {
        setMessage(getTaskTimingMessage(task));
      }, 60000); // Update every minute

      return () => clearInterval(interval);
    }

    return undefined;
  }, [task, task.status, task.startedAt, task.completedAt, task.abandonedAt]);

  if (!message) {
    return null;
  }

  return (
    <span className={`text-gray-500 ${className}`} title={getTooltip(task)}>
      {message}
    </span>
  );
}

function getTooltip(
  task: Pick<Task, "status" | "startedAt" | "completedAt" | "abandonedAt">
): string {
  const parts: string[] = [];

  if (task.startedAt) {
    parts.push(`Started: ${formatDateTime(task.startedAt)}`);
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
