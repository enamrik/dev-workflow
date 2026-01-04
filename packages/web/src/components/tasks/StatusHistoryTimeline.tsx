"use client";

import { clsx } from "clsx";
import { Badge } from "../ui";
import { formatDuration } from "@/lib/duration";
import type { TaskStatusHistory } from "@/lib/types";

interface StatusHistoryTimelineProps {
  history: TaskStatusHistory[];
  className?: string;
}

/**
 * Displays task status transitions as a vertical timeline.
 */
export function StatusHistoryTimeline({ history, className }: StatusHistoryTimelineProps) {
  if (history.length === 0) {
    return (
      <div className={clsx("text-sm text-gray-500", className)}>No status changes recorded</div>
    );
  }

  // Calculate duration between each status change
  const historyWithDuration = history.map((entry, index) => {
    const nextEntry = history[index + 1];
    let durationInStatus: number | null = null;

    if (nextEntry) {
      const endTime = new Date(entry.changedAt).getTime();
      const startTime = new Date(nextEntry.changedAt).getTime();
      durationInStatus = endTime - startTime;
    }

    return { ...entry, durationInStatus };
  });

  return (
    <div className={clsx("space-y-0", className)}>
      {historyWithDuration.map((entry, index) => (
        <div key={entry.id} className="relative flex gap-3">
          {/* Timeline line */}
          {index < history.length - 1 && (
            <div className="absolute left-[7px] top-4 bottom-0 w-0.5 bg-gray-200" />
          )}

          {/* Timeline dot */}
          <div className="relative z-10 mt-1.5 w-4 h-4 rounded-full bg-gray-200 border-2 border-white shadow-sm flex-shrink-0" />

          {/* Content */}
          <div className="flex-1 pb-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="status" value={entry.fromStatus} />
              <span className="text-gray-400">&rarr;</span>
              <Badge variant="status" value={entry.toStatus} />
              {entry.durationInStatus && (
                <span className="text-xs text-gray-500">
                  ({formatDuration(entry.durationInStatus)} in{" "}
                  {entry.fromStatus.toLowerCase().replace("_", " ")})
                </span>
              )}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {formatDateTime(entry.changedAt)}
              {entry.changedBy && <span> by {entry.changedBy}</span>}
            </div>
            {entry.notes && <div className="mt-1 text-sm text-gray-600 italic">{entry.notes}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
