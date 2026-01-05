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
 * Returns the duration (in ms) that a task has been in its current status.
 * For terminal statuses (COMPLETED, ABANDONED), returns the duration spent in that final status.
 * Returns null if the relevant timestamp is missing.
 */
export function getTimeInCurrentStatus(task: {
  status: string;
  createdAt?: string;
  startedAt?: string;
  submittedForReviewAt?: string;
  completedAt?: string;
  abandonedAt?: string;
}): number | null {
  const now = Date.now();

  switch (task.status) {
    case "BACKLOG":
    case "READY":
      // Time since task was created
      if (!task.createdAt) return null;
      return now - new Date(task.createdAt).getTime();

    case "IN_PROGRESS":
      // Time since work started
      if (!task.startedAt) return null;
      return now - new Date(task.startedAt).getTime();

    case "PR_REVIEW":
      // Time since submitted for review
      if (!task.submittedForReviewAt) return null;
      return now - new Date(task.submittedForReviewAt).getTime();

    case "COMPLETED":
    case "ABANDONED":
      // Terminal statuses - no aging needed
      return null;

    default:
      return null;
  }
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Returns a Tailwind text color class based on how long a task has been in its current status.
 * Used for visual feedback on stale tasks.
 *
 * Thresholds:
 * - 0-1 days: undefined (keep default styling)
 * - 1-2 days: text-amber-600 (warning)
 * - 2-3 days: text-orange-600
 * - 3+ days: text-red-600
 *
 * Returns undefined for terminal statuses (COMPLETED, ABANDONED) or missing timestamps.
 */
export function getTaskAgeColorClass(task: {
  status: string;
  createdAt?: string;
  startedAt?: string;
  submittedForReviewAt?: string;
  completedAt?: string;
  abandonedAt?: string;
}): string | undefined {
  const timeInStatus = getTimeInCurrentStatus(task);

  if (timeInStatus === null) {
    return undefined;
  }

  const daysInStatus = timeInStatus / ONE_DAY_MS;

  if (daysInStatus >= 3) {
    return "text-red-600";
  }
  if (daysInStatus >= 2) {
    return "text-orange-600";
  }
  if (daysInStatus >= 1) {
    return "text-amber-600";
  }

  // Fresh task (less than 1 day) - use default styling
  return undefined;
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
