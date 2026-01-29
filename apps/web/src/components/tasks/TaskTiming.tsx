"use client";

import { useEffect, useState } from "react";
import { getTaskTimingMessage, getTaskAgeColorClass } from "@/lib/duration";
import { Tooltip } from "@/components/ui";
import type { Task } from "@/lib/types";

interface TaskTimingProps {
  task: Pick<
    Task,
    "status" | "createdAt" | "startedAt" | "submittedForReviewAt" | "completedAt" | "abandonedAt"
  >;
  className?: string;
  /** "compact" shows just duration, "detailed" includes context prefix */
  variant?: "compact" | "detailed";
  /** Show tooltip on hover (default: true for compact, false for detailed) */
  showTooltip?: boolean;
}

/**
 * Displays task timing information based on status.
 * For in-progress tasks, updates every minute to show live elapsed time.
 */
export function TaskTiming({
  task,
  className = "",
  variant = "compact",
  showTooltip,
}: TaskTimingProps) {
  const [message, setMessage] = useState<string | null>(() => getTaskTimingMessage(task, variant));
  const [detailedMessage, setDetailedMessage] = useState<string | null>(() =>
    getTaskTimingMessage(task, "detailed")
  );
  const [ageColorClass, setAgeColorClass] = useState<string | undefined>(() =>
    getTaskAgeColorClass(task)
  );

  useEffect(() => {
    // Update message and color immediately when task changes
    setMessage(getTaskTimingMessage(task, variant));
    setDetailedMessage(getTaskTimingMessage(task, "detailed"));
    setAgeColorClass(getTaskAgeColorClass(task));

    // For active statuses (not completed/abandoned), update every minute
    const isActiveStatus = ["BACKLOG", "READY", "IN_PROGRESS", "PR_REVIEW"].includes(task.status);
    if (isActiveStatus) {
      const interval = setInterval(() => {
        setMessage(getTaskTimingMessage(task, variant));
        setDetailedMessage(getTaskTimingMessage(task, "detailed"));
        setAgeColorClass(getTaskAgeColorClass(task));
      }, 60000); // Update every minute

      return () => clearInterval(interval);
    }

    return undefined;
  }, [
    task,
    task.status,
    task.createdAt,
    task.startedAt,
    task.submittedForReviewAt,
    task.completedAt,
    task.abandonedAt,
    variant,
  ]);

  if (!message) {
    return null;
  }

  // Default: show tooltip for compact variant, hide for detailed
  const shouldShowTooltip = showTooltip ?? variant === "compact";

  // Use age-based color if available, otherwise fall back to default gray
  const colorClass = ageColorClass ?? "text-gray-500";

  if (!shouldShowTooltip || !detailedMessage) {
    return <span className={`${colorClass} ${className}`}>{message}</span>;
  }

  return (
    <Tooltip content={detailedMessage} side="top">
      <span className={`${colorClass} cursor-help ${className}`}>{message}</span>
    </Tooltip>
  );
}
