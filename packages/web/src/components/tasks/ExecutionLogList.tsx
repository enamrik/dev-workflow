"use client";

import { useState } from "react";
import { clsx } from "clsx";
import type { TaskExecutionLog } from "@/lib/types";

interface ExecutionLogListProps {
  logs: TaskExecutionLog[];
  className?: string;
  defaultExpanded?: boolean;
}

/**
 * Collapsible list of execution progress entries.
 */
export function ExecutionLogList({
  logs,
  className,
  defaultExpanded = false,
}: ExecutionLogListProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  if (logs.length === 0) {
    return null;
  }

  return (
    <div className={clsx("border border-gray-200 rounded-lg", className)}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <span className="flex items-center gap-2">
          <LogIcon />
          Execution Log ({logs.length} {logs.length === 1 ? "entry" : "entries"})
        </span>
        <ChevronIcon isExpanded={isExpanded} />
      </button>

      {isExpanded && (
        <div className="border-t border-gray-200 divide-y divide-gray-100">
          {logs.map((log) => (
            <div key={log.id} className="px-3 py-2">
              <div className="text-sm text-gray-800">{log.message}</div>
              {log.filesModified && log.filesModified.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {log.filesModified.map((file, idx) => (
                    <code
                      key={idx}
                      className="text-xs bg-gray-100 px-1 py-0.5 rounded font-mono text-gray-600"
                    >
                      {file}
                    </code>
                  ))}
                </div>
              )}
              <div className="mt-1 text-xs text-gray-500">{formatDateTime(log.createdAt)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LogIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  );
}

function ChevronIcon({ isExpanded }: { isExpanded: boolean }) {
  return (
    <svg
      className={clsx("w-4 h-4 transition-transform", isExpanded && "rotate-180")}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
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
