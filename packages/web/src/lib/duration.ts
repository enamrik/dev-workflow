/**
 * Duration formatting utilities for task timing display.
 */

/**
 * Formats a duration in milliseconds to a human-readable string.
 * Examples: "2m", "1h 30m", "2d 4h", "3d"
 */
export function formatDuration(ms: number): string {
  if (ms < 0) {
    return "0m";
  }

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    if (remainingHours > 0) {
      return `${days}d ${remainingHours}h`;
    }
    return `${days}d`;
  }

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    if (remainingMinutes > 0) {
      return `${hours}h ${remainingMinutes}m`;
    }
    return `${hours}h`;
  }

  if (minutes > 0) {
    return `${minutes}m`;
  }

  return "<1m";
}

/**
 * Calculates the duration for a task based on its status and timestamps.
 * Returns the duration in milliseconds, or null if not applicable.
 */
export function getTaskDuration(task: {
  status: string;
  startedAt?: string;
  completedAt?: string;
  abandonedAt?: string;
}): number | null {
  if (!task.startedAt) {
    return null;
  }

  const startTime = new Date(task.startedAt).getTime();

  if (task.status === "COMPLETED" && task.completedAt) {
    return new Date(task.completedAt).getTime() - startTime;
  }

  if (task.status === "ABANDONED" && task.abandonedAt) {
    return new Date(task.abandonedAt).getTime() - startTime;
  }

  if (task.status === "IN_PROGRESS" || task.status === "PR_REVIEW") {
    return Date.now() - startTime;
  }

  return null;
}

/**
 * Returns the duration a task has been in its current status.
 * For COMPLETED tasks, returns the cycle time (IN_PROGRESS to COMPLETED).
 *
 * @param variant - "compact" returns just duration (e.g., "2h"),
 *                  "detailed" includes context (e.g., "Active 2h")
 */
export function getTaskTimingMessage(
  task: {
    status: string;
    createdAt?: string;
    startedAt?: string;
    submittedForReviewAt?: string;
    completedAt?: string;
    abandonedAt?: string;
  },
  variant: "compact" | "detailed" = "compact"
): string | null {
  const now = Date.now();

  switch (task.status) {
    case "BACKLOG": {
      // Time since task was created (waiting to be started)
      if (!task.createdAt) return null;
      const duration = now - new Date(task.createdAt).getTime();
      const formatted = formatDuration(duration);
      return variant === "detailed" ? `Backlog: ${formatted}` : formatted;
    }
    case "READY": {
      // Time since task was created (waiting to be started)
      if (!task.createdAt) return null;
      const duration = now - new Date(task.createdAt).getTime();
      const formatted = formatDuration(duration);
      return variant === "detailed" ? `Ready: ${formatted}` : formatted;
    }
    case "IN_PROGRESS": {
      // Time since work started
      if (!task.startedAt) return null;
      const duration = now - new Date(task.startedAt).getTime();
      const formatted = formatDuration(duration);
      return variant === "detailed" ? `In progress: ${formatted}` : formatted;
    }
    case "PR_REVIEW": {
      // Time since submitted for review
      if (!task.submittedForReviewAt) return null;
      const duration = now - new Date(task.submittedForReviewAt).getTime();
      const formatted = formatDuration(duration);
      return variant === "detailed" ? `In review: ${formatted}` : formatted;
    }
    case "COMPLETED": {
      // Cycle time: from IN_PROGRESS to COMPLETED
      if (!task.startedAt || !task.completedAt) return null;
      const duration = new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime();
      const formatted = formatDuration(duration);
      return variant === "detailed" ? `Completed: ${formatted}` : formatted;
    }
    case "ABANDONED": {
      // Time from start to abandonment
      if (!task.startedAt || !task.abandonedAt) return null;
      const duration = new Date(task.abandonedAt).getTime() - new Date(task.startedAt).getTime();
      const formatted = formatDuration(duration);
      return variant === "detailed" ? `Abandoned: ${formatted}` : formatted;
    }
    default:
      return null;
  }
}
