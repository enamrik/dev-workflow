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
  className?: string;
}

/**
 * Unified actions section for task tiles.
 * Shows icon buttons with labels on hover.
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
          icon={<LinkIcon className="w-3 h-3" />}
        />
      )}

      {/* Copy branch name */}
      {hasBranch && (
        <CopyButton
          text={task.branchName!}
          tooltip={`Copy branch: ${task.branchName}`}
          size="sm"
          icon={<BranchIcon className="w-3 h-3" />}
        />
      )}

      {/* Copy worktree path */}
      {hasWorktree && task.worktreePath && (
        <CopyButton
          text={task.worktreePath}
          tooltip={`Copy worktree: ${task.worktreePath}`}
          size="sm"
          icon={<FolderIcon className="w-3 h-3" />}
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

function LinkIcon({ className }: { className?: string }) {
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
        d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
      />
    </svg>
  );
}

function BranchIcon({ className }: { className?: string }) {
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
        d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
      />
    </svg>
  );
}

function FolderIcon({ className }: { className?: string }) {
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
        d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
      />
    </svg>
  );
}
