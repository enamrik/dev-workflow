"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { ConfirmDialog, Tooltip } from "../ui";
import { isIssueClosed } from "@/lib/types";
import type { Issue } from "@/lib/types";

interface IssueCloseButtonProps {
  issue: Issue;
  projectSlug: string;
  onSuccess?: () => void;
}

/**
 * Button to close an issue with confirmation dialog.
 *
 * Shows for non-closed issues. Clicking opens a confirmation dialog
 * warning that the action is irreversible and will abandon incomplete tasks.
 */
export function IssueCloseButton({ issue, projectSlug, onSuccess }: IssueCloseButtonProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Don't render if issue is already closed
  if (isIssueClosed(issue)) {
    return null;
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setShowConfirm(true);
  };

  const handleConfirm = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/issues/${issue.number}/close`, {
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
        throw new Error(data.error || "Failed to close issue");
      }

      setShowConfirm(false);
      onSuccess?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to close issue";
      setError(message);
      console.error("Close issue error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    if (!isLoading) {
      setShowConfirm(false);
      setError(null);
    }
  };

  const button = (
    <button
      onClick={handleClick}
      disabled={isLoading}
      className={clsx(
        "inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors",
        "focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1",
        isLoading && "opacity-50 cursor-wait",
        error && "bg-red-50 text-red-600 hover:bg-red-100",
        !error && "bg-gray-100 text-gray-600 hover:bg-gray-200"
      )}
      aria-label="Close issue"
    >
      <XCircleIcon className="w-4 h-4" />
      <span>Close</span>
    </button>
  );

  return (
    <>
      {error ? (
        <Tooltip content={error} side="top">
          {button}
        </Tooltip>
      ) : (
        button
      )}
      <ConfirmDialog
        isOpen={showConfirm}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
        title="Close Issue"
        message={
          <div className="space-y-2">
            <p>Are you sure you want to close issue #{issue.number}?</p>
            <p className="text-amber-600 font-medium">
              This action is irreversible. Any incomplete tasks will be abandoned.
            </p>
          </div>
        }
        confirmLabel="Close Issue"
        variant="warning"
        isLoading={isLoading}
      />
    </>
  );
}

function XCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}
