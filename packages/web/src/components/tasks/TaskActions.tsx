"use client";

import { useState, useCallback } from "react";
import { clsx } from "clsx";
import { Tooltip } from "../ui";
import type { Task } from "@/lib/types";

interface TaskActionsProps {
  task: Task;
  issueNumber?: number;
  /** Show the Claude command copy button */
  showCopyCommand?: boolean;
  className?: string;
}

/**
 * Unified actions panel for task tiles.
 * Shows single-word labels with copy icons, full text on hover.
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
        "flex items-center gap-1 px-2 py-1.5 bg-gray-100 rounded-md",
        className
      )}
    >
      {/* PR link - opens in new tab */}
      {hasPR && task.prUrl && (
        <Tooltip content={`Open PR #${task.prNumber} in GitHub`}>
          <a
            href={task.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition-colors"
          >
            <span>PR</span>
            <ExternalLinkIcon className="w-3 h-3" />
          </a>
        </Tooltip>
      )}

      {/* Copy PR URL */}
      {hasPR && task.prUrl && (
        <ActionButton
          label="URL"
          text={task.prUrl}
          tooltip={`Copy PR URL: ${task.prUrl}`}
        />
      )}

      {/* Copy branch name */}
      {hasBranch && (
        <ActionButton
          label="Branch"
          text={task.branchName!}
          tooltip={`Copy branch: ${task.branchName}`}
        />
      )}

      {/* Copy worktree path */}
      {hasWorktree && task.worktreePath && (
        <ActionButton
          label="Path"
          text={task.worktreePath}
          tooltip={`Copy worktree: ${task.worktreePath}`}
        />
      )}

      {/* Claude command */}
      {showCopyCommand && issueNumber && (
        <ActionButton
          label="Claude"
          text={`/dwf-work-task start #${issueNumber}.${task.number}`}
          tooltip={`Copy: /dwf-work-task start #${issueNumber}.${task.number}`}
        />
      )}
    </div>
  );
}

interface ActionButtonProps {
  label: string;
  text: string;
  tooltip: string;
}

function ActionButton({ label, text, tooltip }: ActionButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [text]);

  return (
    <Tooltip content={copied ? "Copied!" : tooltip}>
      <button
        onClick={handleCopy}
        className={clsx(
          "inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded transition-colors",
          copied
            ? "text-green-700 bg-green-50"
            : "text-gray-600 hover:text-gray-800 hover:bg-gray-200"
        )}
      >
        <span>{label}</span>
        {copied ? (
          <CheckIcon className="w-3 h-3" />
        ) : (
          <CopyIcon className="w-3 h-3" />
        )}
      </button>
    </Tooltip>
  );
}

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
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

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}
