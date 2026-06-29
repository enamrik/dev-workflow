"use client";

import { useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Badge, ProgressBar } from "../ui";
import type { MilestoneWithIssues } from "@/lib/types";

interface MilestoneDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: MilestoneWithIssues | null;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 3) + "...";
}

export function MilestoneDetailModal({ isOpen, onClose, data }: MilestoneDetailModalProps) {
  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen || !data || typeof document === "undefined") {
    return null;
  }

  const { milestone, issues, progress } = data;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
        aria-hidden="true"
      />
      {/* Modal */}
      <div
        className="fixed z-50 left-4 right-4 top-1/2 -translate-y-1/2 sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 w-auto sm:w-full sm:max-w-lg bg-white rounded-xl shadow-2xl border border-gray-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="milestone-modal-title"
      >
        <div className="overflow-y-auto max-h-[calc(100vh-2rem)] sm:max-h-[80vh]">
          {/* Header with close button */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-gray-500">M{milestone.number}</span>
              <h2 id="milestone-modal-title" className="font-semibold text-gray-800">
                {milestone.title}
              </h2>
            </div>
            <button
              onClick={handleClose}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
              aria-label="Close modal"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="p-4 space-y-4">
            {/* Status */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Status:</span>
              <Badge variant="status" value={milestone.status} />
            </div>

            {/* Dates */}
            <div className="text-sm text-gray-600">
              <span className="font-medium">Start:</span> {milestone.startDate}
              <span className="mx-2">|</span>
              <span className="font-medium">End:</span> {milestone.endDate}
            </div>

            {/* Description */}
            {milestone.description && (
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-1">Description</h3>
                <p className="text-sm text-gray-600">{milestone.description}</p>
              </div>
            )}

            {/* Progress */}
            <div>
              <div className="flex items-center justify-between text-sm text-gray-600 mb-1">
                <span className="font-medium">Progress</span>
                <span>
                  {progress.closed}/{progress.total} issues ({progress.percentage}%)
                </span>
              </div>
              <ProgressBar completed={progress.closed} total={progress.total} showLabel={false} />
            </div>

            {/* Issues list */}
            <div className="border-t border-gray-100 pt-4">
              <h3 className="text-sm font-medium text-gray-700 mb-3">Assigned Issues</h3>
              {issues.length > 0 ? (
                <ul className="space-y-2 max-h-48 overflow-y-auto">
                  {issues.map((issue) => (
                    <li
                      key={`${issue.projectSlug}-${issue.number}`}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Link
                        href={`/projects/${encodeURIComponent(issue.projectSlug)}/issues/${issue.number}`}
                        className="text-blue-600 hover:underline font-medium"
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                      >
                        #{issue.number}
                      </Link>
                      <span className="text-gray-700 truncate flex-1">
                        {truncate(issue.title, 40)}
                      </span>
                      <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded whitespace-nowrap">
                        {issue.projectName}
                      </span>
                      <Badge variant="status" value={issue.computedStatus} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-400">No issues assigned</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
