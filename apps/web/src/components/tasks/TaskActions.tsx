"use client";

import React, { useState, useCallback } from "react";
import { clsx } from "clsx";
import { Tooltip } from "../ui";
import type { Task } from "@/lib/types";
import { getClaudeTaskCommand } from "@/lib/claude-command";

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
  const hasGitHub = !!task.syncConfig?.githubUrl;
  const hasAnyAction = hasBranch || hasPR || hasGitHub || (showCopyCommand && issueNumber);

  if (!hasAnyAction) {
    return null;
  }

  return (
    <div
      className={clsx(
        "inline-flex flex-wrap items-center gap-1 px-2 py-1.5 bg-gray-100 rounded-md",
        className
      )}
    >
      {/* PR link - opens in new tab */}
      {hasPR && task.prUrl && (
        <Tooltip content={`Open PR #${task.prNumber}: ${task.prUrl}`}>
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

      {/* GitHub issue link - opens in new tab with copy */}
      {hasGitHub && task.syncConfig?.githubUrl && (
        <GitHubLinkWithCopy
          href={task.syncConfig.githubUrl}
          issueNumber={task.syncConfig.githubIssueNumber!}
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
          label="Worktree"
          text={task.worktreePath}
          tooltip={`Copy worktree: ${task.worktreePath}`}
        />
      )}

      {/* Claude command */}
      {showCopyCommand && issueNumber && (
        <ActionButton
          label="Claude"
          text={getClaudeTaskCommand(issueNumber, task.number)}
          tooltip={`Copy: ${getClaudeTaskCommand(issueNumber, task.number)}`}
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
        {copied ? <CheckIcon className="w-3 h-3" /> : <CopyIcon className="w-3 h-3" />}
      </button>
    </Tooltip>
  );
}

interface GitHubLinkWithCopyProps {
  href: string;
  issueNumber: number;
}

/**
 * GitHub issue link with the GitHub logo, issue number, and copy button.
 * Clicking the link opens the issue, clicking the copy icon copies the URL.
 */
function GitHubLinkWithCopy({ href, issueNumber }: GitHubLinkWithCopyProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(href);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch (err) {
        console.error("Failed to copy:", err);
      }
    },
    [href]
  );

  return (
    <Tooltip content={copied ? "Copied!" : `Open GitHub issue #${issueNumber}`}>
      <span className="inline-flex items-center">
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 pl-1.5 pr-0.5 py-0.5 text-xs text-gray-700 hover:text-gray-900 hover:bg-gray-200 rounded-l transition-colors"
        >
          <GitHubIcon className="w-3.5 h-3.5" />
          <span>#{issueNumber}</span>
        </a>
        <button
          onClick={handleCopy}
          className={clsx(
            "inline-flex items-center px-1 py-0.5 text-xs rounded-r transition-colors",
            copied
              ? "text-green-700 bg-green-50"
              : "text-gray-500 hover:text-gray-700 hover:bg-gray-200"
          )}
        >
          {copied ? <CheckIcon className="w-3 h-3" /> : <CopyIcon className="w-3 h-3" />}
        </button>
      </span>
    </Tooltip>
  );
}

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}
