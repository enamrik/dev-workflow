"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { Tooltip } from "../ui";
import type { Task } from "@/lib/types";

type TransitionType = "toBacklog" | "toReady" | "toReview";

interface TransitionConfig {
  targetStatus: Task["status"];
  label: string;
  icon: React.ReactNode;
  fromStatuses: Task["status"][];
  /** Optional condition check beyond just status */
  isDisabled?: (task: Task) => { disabled: boolean; reason?: string };
}

const transitionConfigs: Record<TransitionType, TransitionConfig> = {
  toBacklog: {
    targetStatus: "BACKLOG",
    label: "Activate",
    fromStatuses: ["PLANNED"],
    icon: <PlayIcon className="w-4 h-4" />,
  },
  toReady: {
    targetStatus: "READY",
    label: "Ready",
    fromStatuses: ["BACKLOG"],
    icon: <RocketIcon className="w-4 h-4" />,
  },
  toReview: {
    targetStatus: "PR_REVIEW",
    label: "Review",
    fromStatuses: ["IN_PROGRESS"],
    isDisabled: (task) => {
      if (!task.prUrl) {
        return { disabled: true, reason: "Create a PR first" };
      }
      return { disabled: false };
    },
    icon: <SendIcon className="w-4 h-4" />,
  },
};

interface TaskTransitionButtonProps {
  task: Task;
  projectSlug: string;
  onTransitionComplete?: (task: Task, newStatus: Task["status"]) => void;
}

/**
 * Renders the appropriate transition button based on task status.
 * Returns null if no transition is available for the current status.
 */
export function TaskTransitionButton({
  task,
  projectSlug,
  onTransitionComplete,
}: TaskTransitionButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Find applicable transition for current task status
  const applicableTransition = Object.entries(transitionConfigs).find(([, config]) =>
    config.fromStatuses.includes(task.status)
  );

  if (!applicableTransition) {
    return null;
  }

  const [transitionType, config] = applicableTransition;

  // Check if disabled
  const disabledCheck = config.isDisabled?.(task);
  const isDisabled = disabledCheck?.disabled ?? false;
  const disabledReason = disabledCheck?.reason;

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent modal from opening
    e.preventDefault();

    if (isLoading || isDisabled) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/tasks/${task.id}/transition`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          targetStatus: config.targetStatus,
          projectSlug,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to transition task");
      }

      onTransitionComplete?.(task, config.targetStatus);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to transition task";
      setError(message);
      console.error("Transition error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // Show tooltip only for errors or disabled reasons
  const tooltipContent = error ?? (isDisabled && disabledReason ? disabledReason : null);

  const button = (
    <button
      onClick={handleClick}
      disabled={isLoading || isDisabled}
      className={clsx(
        "inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors",
        "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1",
        isLoading && "opacity-50 cursor-wait",
        isDisabled && "opacity-40 cursor-not-allowed bg-gray-100 text-gray-400",
        error && "bg-red-50 text-red-600 hover:bg-red-100",
        !error && !isDisabled && "bg-blue-50 text-blue-600 hover:bg-blue-100"
      )}
      aria-label={config.label}
      data-transition-type={transitionType}
    >
      {isLoading ? <SpinnerIcon className="w-4 h-4 animate-spin" /> : config.icon}
      <span>{config.label}</span>
    </button>
  );

  // Only wrap in tooltip if there's content to show
  if (tooltipContent) {
    return (
      <Tooltip content={tooltipContent} side="top">
        {button}
      </Tooltip>
    );
  }

  return button;
}

// =============================================================================
// Icons
// =============================================================================

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

function RocketIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"
      />
    </svg>
  );
}

function SendIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
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
