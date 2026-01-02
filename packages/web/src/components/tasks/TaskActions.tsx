"use client";

import { clsx } from "clsx";
import { CopyButton, Tooltip } from "../ui";
import { CopyTaskCommand } from "./CopyTaskCommand";
import type { Task } from "@/lib/types";

interface TaskActionsProps {
  task: Task;
  issueNumber?: number;
  /** Show the Claude command copy button */
  showCopyCommand?: boolean;
  /** Compact layout for smaller spaces */
  compact?: boolean;
  className?: string;
}

/**
 * Unified actions section for task tiles.
 * Shows icon-only buttons with labels on hover.
 */
export function TaskActions({
  task,
  issueNumber,
  showCopyCommand = true,
  className,
}: TaskActionsProps) {
  const hasBranch = !!task.branchName;
  const hasWorktree = !!task.worktreePath;
  const hasPR = !!task.prUrl;
  const hasAnyAction = hasBranch || hasPR || (showCopyCommand && issueNumber);

  if (!hasAnyAction) {
    return null;
  }

  return (
    <div
      className={clsx(
        "flex items-center gap-1",
        className
      )}
    >
      {/* PR link - opens in new tab */}
      {hasPR && task.prUrl && (
        <Tooltip content={`Open PR #${task.prNumber}`}>
          <a
            href={task.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center w-6 h-6 rounded border border-gray-200 bg-gray-50 text-blue-600 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 transition-colors"
          >
            <ExternalLinkIcon className="w-3 h-3" />
          </a>
        </Tooltip>
      )}

      {/* Copy PR URL */}
      {hasPR && task.prUrl && (
        <CopyButton
          text={task.prUrl}
          tooltip={`Copy PR #${task.prNumber} URL`}
          size="sm"
        />
      )}

      {/* Copy branch name */}
      {hasBranch && (
        <CopyButton
          text={task.branchName!}
          tooltip={`Copy branch: ${task.branchName}`}
          size="sm"
        />
      )}

      {/* Copy worktree path */}
      {hasWorktree && task.worktreePath && (
        <CopyButton
          text={task.worktreePath}
          tooltip={`Copy worktree: ${task.worktreePath}`}
          size="sm"
        />
      )}

      {/* Claude command */}
      {showCopyCommand && issueNumber && (
        <CopyTaskCommand
          issueNumber={issueNumber}
          taskNumber={task.number}
          size="sm"
        />
      )}
    </div>
  );
}

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg
      className={clsx("flex-shrink-0", className)}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
      />
    </svg>
  );
}
