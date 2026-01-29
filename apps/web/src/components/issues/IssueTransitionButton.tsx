"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { Tooltip } from "../ui";
import { isIssueInPlanning } from "@/lib/types";
import type { Issue, Task } from "@/lib/types";

interface IssueTransitionButtonProps {
  issue: Issue;
  tasks: Task[];
  projectSlug: string;
  onSuccess?: () => void;
}

type TransitionAction = "activate" | "ready" | null;

/**
 * Determine which transition action is available for an issue.
 *
 * Actions:
 * - "activate": Issue is PLANNED with PLANNED tasks → moves to BACKLOG (tasks PLANNED → BACKLOG)
 * - "ready": Issue is OPEN with BACKLOG tasks → moves tasks to READY
 * - null: No transition available
 */
function getTransitionAction(issue: Issue, tasks: Task[]): TransitionAction {
  // PLANNED issues with PLANNED tasks can be activated (requires a plan with tasks)
  if (isIssueInPlanning(issue)) {
    const hasPlannedTasks = tasks.some((t) => t.status === "PLANNED");
    if (hasPlannedTasks) {
      return "activate";
    }
  }

  // OPEN issues with BACKLOG tasks can be readied
  // Note: Checking specific status for state machine transition
  if (issue.status === "OPEN") {
    const hasBacklogTasks = tasks.some((t) => t.status === "BACKLOG");
    if (hasBacklogTasks) {
      return "ready";
    }
  }

  return null;
}

/**
 * Button to transition an issue to the next state.
 *
 * For PLANNED issues: Shows "Activate" to move issue to OPEN and tasks to BACKLOG.
 * For OPEN issues with BACKLOG tasks: Shows "Ready" to move tasks to READY.
 * Hidden for issues without actionable transitions.
 */
export function IssueTransitionButton({
  issue,
  tasks,
  projectSlug,
  onSuccess,
}: IssueTransitionButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const action = getTransitionAction(issue, tasks);

  // Don't render if no action available
  if (!action) {
    return null;
  }

  const config = {
    activate: {
      label: "Activate",
      endpoint: `/api/issues/${issue.number}/move-to-backlog`,
      errorMessage: "Failed to activate issue",
      icon: PlayIcon,
    },
    ready: {
      label: "Ready",
      endpoint: `/api/issues/${issue.number}/move-to-ready`,
      errorMessage: "Failed to ready issue",
      icon: CheckCircleIcon,
    },
  }[action];

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    if (isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectSlug,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || config.errorMessage);
      }

      onSuccess?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : config.errorMessage;
      setError(message);
      console.error(`${config.label} error:`, err);
    } finally {
      setIsLoading(false);
    }
  };

  const IconComponent = config.icon;

  const button = (
    <button
      onClick={handleClick}
      disabled={isLoading}
      className={clsx(
        "inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors",
        "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1",
        isLoading && "opacity-50 cursor-wait",
        error && "bg-red-50 text-red-600 hover:bg-red-100",
        !error && "bg-blue-50 text-blue-600 hover:bg-blue-100"
      )}
      aria-label={config.label}
    >
      {isLoading ? (
        <SpinnerIcon className="w-4 h-4 animate-spin" />
      ) : (
        <IconComponent className="w-4 h-4" />
      )}
      <span>{config.label}</span>
    </button>
  );

  // Wrap in tooltip if there's an error
  if (error) {
    return (
      <Tooltip content={error} side="top">
        {button}
      </Tooltip>
    );
  }

  return button;
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}
