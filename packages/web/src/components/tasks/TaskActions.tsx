"use client";

import { clsx } from "clsx";
import { CopyButton } from "../ui";
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
 * Groups all copy/link actions in a consistent location.
 */
export function TaskActions({
  task,
  issueNumber,
  showCopyCommand = true,
  compact = false,
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
        "rounded-lg border border-gray-200 bg-gray-50",
        compact ? "p-2" : "p-3",
        className
      )}
    >
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
        Actions
      </div>
      <div className={clsx("space-y-2", compact && "space-y-1.5")}>
        {/* PR link and copy */}
        {hasPR && task.prUrl && (
          <ActionRow compact={compact}>
            <ActionLabel compact={compact}>PR</ActionLabel>
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <a
                href={task.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={clsx(
                  "text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1 truncate",
                  compact ? "text-xs" : "text-sm"
                )}
              >
                <PRIcon className={compact ? "w-3 h-3" : "w-4 h-4"} />
                <span>PR #{task.prNumber}</span>
              </a>
              <CopyButton text={task.prUrl} tooltip="Copy PR URL" size="sm" />
            </div>
          </ActionRow>
        )}

        {/* Branch name and copy */}
        {hasBranch && (
          <ActionRow compact={compact}>
            <ActionLabel compact={compact}>Branch</ActionLabel>
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <code
                className={clsx(
                  "bg-gray-100 px-1.5 py-0.5 rounded font-mono truncate",
                  compact ? "text-xs" : "text-sm"
                )}
              >
                {task.branchName}
              </code>
              <CopyButton text={task.branchName!} tooltip="Copy branch name" size="sm" />
            </div>
          </ActionRow>
        )}

        {/* Worktree path and copy */}
        {hasWorktree && task.worktreePath && (
          <ActionRow compact={compact}>
            <ActionLabel compact={compact}>Worktree</ActionLabel>
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span
                className={clsx(
                  "text-gray-600 truncate",
                  compact ? "text-xs" : "text-sm"
                )}
                title={task.worktreePath}
              >
                {task.worktreePath}
              </span>
              <CopyButton text={task.worktreePath} tooltip="Copy worktree path" size="sm" />
            </div>
          </ActionRow>
        )}

        {/* Claude command */}
        {showCopyCommand && issueNumber && (
          <ActionRow compact={compact}>
            <ActionLabel compact={compact}>Claude</ActionLabel>
            <CopyTaskCommand
              issueNumber={issueNumber}
              taskNumber={task.number}
              size="sm"
            />
          </ActionRow>
        )}
      </div>
    </div>
  );
}

function ActionRow({
  children,
  compact,
}: {
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={clsx(
        "flex items-center",
        compact ? "gap-2" : "gap-3"
      )}
    >
      {children}
    </div>
  );
}

function ActionLabel({
  children,
  compact,
}: {
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <span
      className={clsx(
        "text-gray-500 flex-shrink-0",
        compact ? "text-xs w-14" : "text-xs w-16"
      )}
    >
      {children}
    </span>
  );
}

function PRIcon({ className }: { className?: string }) {
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
        d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
      />
    </svg>
  );
}
