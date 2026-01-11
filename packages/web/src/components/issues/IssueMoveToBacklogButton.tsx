"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { Tooltip } from "../ui";
import type { Issue } from "@/lib/types";

interface IssueMoveToBacklogButtonProps {
  issue: Issue;
  projectSlug: string;
  onSuccess?: () => void;
}

/**
 * Button to move a PLANNED issue to backlog status.
 * Only renders for issues in PLANNED status.
 * Follows the TaskTransitionButton styling pattern.
 */
export function IssueMoveToBacklogButton({
  issue,
  projectSlug,
  onSuccess,
}: IssueMoveToBacklogButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only show for PLANNED issues
  if (issue.status !== "PLANNED") {
    return null;
  }

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    if (isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/issues/${issue.number}/move-to-backlog`, {
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
        throw new Error(data.error || "Failed to move issue to backlog");
      }

      onSuccess?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to move issue to backlog";
      setError(message);
      console.error("Move to backlog error:", err);
    } finally {
      setIsLoading(false);
    }
  };

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
      aria-label="Move to Backlog"
    >
      {isLoading ? (
        <SpinnerIcon className="w-4 h-4 animate-spin" />
      ) : (
        <PlayIcon className="w-4 h-4" />
      )}
      <span>Activate</span>
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
