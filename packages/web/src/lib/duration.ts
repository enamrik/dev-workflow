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
 * Returns a human-readable timing message for a task.
 */
export function getTaskTimingMessage(task: {
  status: string;
  startedAt?: string;
  completedAt?: string;
  abandonedAt?: string;
}): string | null {
  const duration = getTaskDuration(task);

  if (duration === null) {
    return null;
  }

  const formatted = formatDuration(duration);

  switch (task.status) {
    case "IN_PROGRESS":
      return `Started ${formatted} ago`;
    case "PR_REVIEW":
      return `In review for ${formatted}`;
    case "COMPLETED":
      return `Completed in ${formatted}`;
    case "ABANDONED":
      return `Abandoned after ${formatted}`;
    default:
      return null;
  }
}
