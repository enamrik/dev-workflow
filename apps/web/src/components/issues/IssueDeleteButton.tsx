"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import { ConfirmDialog, Tooltip } from "../ui";
import { isIssueInPlanning } from "@/lib/types";
import type { Issue } from "@/lib/types";

interface IssueDeleteButtonProps {
  issue: Issue;
  projectSlug: string;
  onSuccess?: () => void;
  /** Called when the panel should close (for modal usage) */
  onClose?: () => void;
}

/**
 * Button to delete an issue with confirmation dialog.
 *
 * Only shows for PLANNED issues. Deleting navigates to the issues list.
 */
export function IssueDeleteButton({
  issue,
  projectSlug,
  onSuccess,
  onClose,
}: IssueDeleteButtonProps) {
  const router = useRouter();
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only show for PLANNED issues
  if (!isIssueInPlanning(issue)) {
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
      const response = await fetch(`/api/issues/${issue.number}/delete`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectSlug,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to delete issue");
      }

      setShowConfirm(false);
      onSuccess?.();

      // Close modal if in modal context
      onClose?.();

      // Navigate to issues list
      router.push("/");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete issue";
      setError(message);
      console.error("Delete issue error:", err);
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
        !error && "bg-red-50 text-red-600 hover:bg-red-100"
      )}
      aria-label="Delete issue"
    >
      <TrashIcon className="w-4 h-4" />
      <span>Delete</span>
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
        title="Delete Issue"
        message={
          <div className="space-y-2">
            <p>Are you sure you want to delete issue #{issue.number}?</p>
            <p className="text-red-600 font-medium">
              This action cannot be undone. The issue and all associated data will be permanently
              removed.
            </p>
          </div>
        }
        confirmLabel="Delete Issue"
        variant="danger"
        isLoading={isLoading}
      />
    </>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  );
}
