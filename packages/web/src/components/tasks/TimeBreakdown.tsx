"use client";

import { clsx } from "clsx";
import { formatDuration } from "@/lib/duration";
import type { Task, TaskStatusHistory } from "@/lib/types";

interface TimeBreakdownProps {
  task: Task;
  history: TaskStatusHistory[];
  className?: string;
}

interface StatusDuration {
  status: Task["status"];
  duration: number;
  percentage: number;
}

/**
 * Shows time spent in each status and total elapsed time.
 * Also compares estimated vs actual time when available.
 */
export function TimeBreakdown({
  task,
  history,
  className,
}: TimeBreakdownProps) {
  const { totalElapsed, statusDurations } = calculateTimeBreakdown(task, history);

  if (!totalElapsed) {
    return null;
  }

  const estimatedMs = task.estimatedMinutes ? task.estimatedMinutes * 60 * 1000 : null;
  const overUnder = estimatedMs ? totalElapsed - estimatedMs : null;

  return (
    <div className={clsx("space-y-3", className)}>
      {/* Total time */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-600">Total time:</span>
        <span className="font-medium text-gray-800">{formatDuration(totalElapsed)}</span>
      </div>

      {/* Estimated vs actual */}
      {estimatedMs && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">Estimated:</span>
          <span className="font-medium text-gray-800">
            {formatDuration(estimatedMs)}
            {overUnder !== null && (
              <span
                className={clsx(
                  "ml-2 text-xs",
                  overUnder > 0 ? "text-red-600" : "text-green-600"
                )}
              >
                ({overUnder > 0 ? "+" : ""}{formatDuration(Math.abs(overUnder))})
              </span>
            )}
          </span>
        </div>
      )}

      {/* Time per status bar */}
      {statusDurations.length > 1 && (
        <div className="space-y-1">
          <div className="text-xs text-gray-500">Time per status:</div>
          <div className="flex h-2 rounded-full overflow-hidden bg-gray-200">
            {statusDurations.map((sd, idx) => (
              <div
                key={idx}
                className={clsx(getStatusColor(sd.status))}
                style={{ width: `${sd.percentage}%` }}
                title={`${sd.status}: ${formatDuration(sd.duration)}`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {statusDurations.map((sd, idx) => (
              <div key={idx} className="flex items-center gap-1">
                <div className={clsx("w-2 h-2 rounded-full", getStatusColor(sd.status))} />
                <span className="text-gray-600">
                  {formatStatusLabel(sd.status)}: {formatDuration(sd.duration)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function calculateTimeBreakdown(
  task: Task,
  history: TaskStatusHistory[]
): { totalElapsed: number | null; statusDurations: StatusDuration[] } {
  if (!task.startedAt) {
    return { totalElapsed: null, statusDurations: [] };
  }

  const startTime = new Date(task.startedAt).getTime();
  let endTime: number;

  if (task.status === "COMPLETED" && task.completedAt) {
    endTime = new Date(task.completedAt).getTime();
  } else if (task.status === "ABANDONED" && task.abandonedAt) {
    endTime = new Date(task.abandonedAt).getTime();
  } else {
    endTime = Date.now();
  }

  const totalElapsed = endTime - startTime;

  // Calculate time in each status from history
  const durations = new Map<Task["status"], number>();

  // History is sorted newest first, so we need to process in reverse
  const sortedHistory = [...history].reverse();

  for (let i = 0; i < sortedHistory.length; i++) {
    const entry = sortedHistory[i];
    if (!entry) continue;

    const nextEntry = sortedHistory[i + 1];

    const statusStartTime = new Date(entry.changedAt).getTime();
    const statusEndTime = nextEntry
      ? new Date(nextEntry.changedAt).getTime()
      : endTime;

    const duration = statusEndTime - statusStartTime;
    const currentDuration = durations.get(entry.toStatus) || 0;
    durations.set(entry.toStatus, currentDuration + duration);
  }

  // If no history, count all time as current status
  if (sortedHistory.length === 0) {
    durations.set(task.status, totalElapsed);
  }

  // Convert to array with percentages
  const statusDurations: StatusDuration[] = [];
  for (const [status, duration] of durations.entries()) {
    if (duration > 0) {
      statusDurations.push({
        status,
        duration,
        percentage: (duration / totalElapsed) * 100,
      });
    }
  }

  // Sort by duration descending
  statusDurations.sort((a, b) => b.duration - a.duration);

  return { totalElapsed, statusDurations };
}

function getStatusColor(status: Task["status"]): string {
  switch (status) {
    case "PENDING":
      return "bg-gray-400";
    case "IN_PROGRESS":
      return "bg-orange-400";
    case "PR_REVIEW":
      return "bg-blue-400";
    case "COMPLETED":
      return "bg-green-400";
    case "ABANDONED":
      return "bg-red-400";
    default:
      return "bg-gray-400";
  }
}

function formatStatusLabel(status: Task["status"]): string {
  return status.toLowerCase().replace("_", " ");
}
