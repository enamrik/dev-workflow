"use client";

import { clsx } from "clsx";
import { Badge } from "../ui";
import { isTerminal } from "@/lib/types";
import type { Task } from "@/lib/types";

interface TaskDependenciesProps {
  dependencies: Task[];
  className?: string;
}

/**
 * Shows tasks that this task depends on with status indicators.
 */
export function TaskDependencies({ dependencies, className }: TaskDependenciesProps) {
  if (dependencies.length === 0) {
    return null;
  }

  const allComplete = dependencies.every(isTerminal);

  return (
    <div className={clsx("space-y-2", className)}>
      <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <DependencyIcon />
        <span>Dependencies</span>
        {allComplete ? (
          <span className="text-xs text-green-600 font-normal">(all satisfied)</span>
        ) : (
          <span className="text-xs text-orange-600 font-normal">(blocking)</span>
        )}
      </div>
      <div className="space-y-1">
        {dependencies.map((task) => {
          // Format story reference: #issue.task or just title if issue number unavailable
          const storyRef = task.issueNumber != null ? `#${task.issueNumber}.${task.number}` : null;
          return (
            <div key={task.id} className="flex items-center gap-2 text-sm pl-6">
              <StatusIcon status={task.status} />
              <span className="text-gray-600 truncate flex-1">
                {storyRef && <span className="font-medium text-gray-500">{storyRef} </span>}
                {task.title}
              </span>
              <Badge variant="status" value={task.status} className="text-xs" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DependencyIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13 7l5 5m0 0l-5 5m5-5H6"
      />
    </svg>
  );
}

function StatusIcon({ status }: { status: Task["status"] }) {
  if (status === "COMPLETED") {
    return (
      <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
          clipRule="evenodd"
        />
      </svg>
    );
  }

  if (status === "ABANDONED") {
    return (
      <svg className="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
          clipRule="evenodd"
        />
      </svg>
    );
  }

  return (
    <svg className="w-4 h-4 text-orange-500" fill="currentColor" viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
        clipRule="evenodd"
      />
    </svg>
  );
}
